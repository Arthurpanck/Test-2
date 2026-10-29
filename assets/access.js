/**
 * Droits d'accès du document : lecture des tables `_grist_ACLResources` et `_grist_ACLRules`,
 * mise en forme lisible (qui, quoi, permissions en clair) et contrôles.
 *
 * Reprend le rapport « Tables et permissions » (github.com/jtab87/grist-plugins), en corrigeant
 * ses limites : règles par défaut et réglages spéciaux affichés, ordre des règles respecté,
 * permissions en clair (Lire, Modifier…) au lieu de « +CRUD », conditions traduites quand
 * c'est possible, attributs utilisateur vérifiés, et constats avec la marche à suivre.
 *
 * Module pur : testé sous Node.
 */
import { effectivePermission } from './audit-engine.js?v=3.2.0';
import { columnarToRows } from './converter.js?v=3.2.0';

/** Permissions Grist, dans l'ordre de l'écran « Règles d'accès ». */
export const PERMISSIONS = [
  { bit: 'R', label: 'Lire' },
  { bit: 'U', label: 'Modifier' },
  { bit: 'C', label: 'Créer' },
  { bit: 'D', label: 'Supprimer' },
  { bit: 'S', label: 'Structure' },
];
const TABLE_BITS = ['R', 'U', 'C', 'D'];
const COLUMN_BITS = ['R', 'U'];
const DEFAULT_BITS = ['R', 'U', 'C', 'D', 'S'];

/** Réglages spéciaux (`*SPECIAL`) connus. */
export const SPECIAL = {
  FullCopies: {
    label: 'Copier le document entier',
    allowed: 'Les personnes visées peuvent copier tout le document ou l\'ouvrir en mode bac à sable, données protégées comprises.',
    byDefault: 'Seuls les propriétaires peuvent copier le document entier.',
  },
  AccessRules: {
    label: 'Voir les droits d’accès',
    allowed: 'Les personnes visées peuvent lire les règles d\'accès du document.',
    byDefault: 'Seuls les propriétaires voient les règles d\'accès.',
  },
  DocCopies: {
    label: 'Copies du document',
    allowed: 'Réglage spécial « DocCopies » activé pour les personnes visées.',
    byDefault: 'Réglage spécial « DocCopies » non utilisé.',
  },
  SchemaEdit: {
    label: 'Modifier la structure (ancien réglage)',
    allowed: 'Réglage spécial « SchemaEdit » défini.',
    byDefault: '',
  },
  SeedRules: {
    label: 'Modèle pour les nouvelles tables',
    allowed: 'Règles proposées par défaut à chaque nouvelle table (Grist ne les applique pas d\'elles-mêmes).',
    byDefault: '',
  },
};

/** Propriétés de `user` fournies par Grist. */
const USER_BUILTINS = new Set(['Access', 'Email', 'UserID', 'UserRef', 'Name', 'LinkKey', 'Origin', 'SessionID', 'IsLoggedIn', 'ShareRef', 'Type']);

const ROLES = { OWNER: 'propriétaires', EDITOR: 'éditeurs', VIEWER: 'lecteurs' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const joinFr = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}` : list[0] || '');

/** Texte des permissions (« +R-CD », « all », « none ») → { R: 'allow' | 'deny', … }. */
export function parsePermissions(text) {
  const t = String(text || '').trim();
  const out = {};
  if (t === 'all') { for (const p of PERMISSIONS) out[p.bit] = 'allow'; return out; }
  if (t === 'none') { for (const p of PERMISSIONS) out[p.bit] = 'deny'; return out; }
  for (const m of t.matchAll(/([+-])([A-Z]+)/g)) {
    for (const bit of m[2]) out[bit] = m[1] === '+' ? 'allow' : 'deny';
  }
  return out;
}

/**
 * Condition Grist → qui est concerné, en clair quand la forme est reconnue.
 * @returns {{ text: string, kind: 'everyone'|'role'|'email'|'attribute'|'row'|'formula', row: boolean }}
 */
export function describeCondition(formula, { first = true } = {}) {
  const f = String(formula || '').trim();
  const row = /\b(rec|newRec)\b/.test(f);
  if (!f) return { text: first ? 'Tout le monde' : 'Tous les autres', kind: 'everyone', row: false };
  let m = /^user\.Access\s*(==|!=|in|not in)\s*\[?\s*([A-Z_,\s]+?)\s*\]?$/.exec(f);
  if (m) {
    const roles = m[2].split(',').map((r) => ROLES[r.trim()]).filter(Boolean);
    if (roles.length) {
      const neg = m[1] === '!=' || m[1] === 'not in';
      return { text: neg ? `Tous sauf les ${joinFr(roles)}` : cap(joinFr(roles)), kind: 'role', row: false };
    }
  }
  const emails = [];
  const emailOr = f.split(/\s+or\s+/);
  if (emailOr.every((part) => { const e = /^user\.Email\s*==\s*['"]([^'"]+)['"]$/.exec(part.trim()); if (e) emails.push(e[1]); return Boolean(e); })) {
    return { text: emails.join(' ou '), kind: 'email', row: false };
  }
  m = /^user\.Email\s+in\s+\[([^\]]*)\]$/.exec(f);
  if (m) {
    const list = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    if (list.length) return { text: list.join(', '), kind: 'email', row: false };
  }
  m = /^user\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*(==|!=)\s*['"]([^'"]*)['"]$/.exec(f);
  if (m) {
    return { text: `Personnes dont « ${m[1]}.${m[2]} » ${m[3] === '==' ? 'vaut' : 'ne vaut pas'} « ${m[4]} »`, kind: 'attribute', row: false };
  }
  if (/^rec\.[A-Za-z_]\w*\s*==\s*user\.Email$/.test(f) || /^user\.Email\s*==\s*rec\.[A-Za-z_]\w*$/.test(f)) {
    return { text: 'Sur les lignes où la personne est désignée par son adresse', kind: 'row', row: true };
  }
  if (/^not\s+user\.IsLoggedIn$/.test(f)) return { text: 'Personnes non connectées', kind: 'role', row: false };
  return { text: row ? 'Selon le contenu de la ligne' : 'Selon une condition', kind: row ? 'row' : 'formula', row };
}

const emailLiterals = (f) => [...String(f || '').matchAll(/['"]([^'"\s]+@[^'"\s]+)['"]/g)].map((m) => m[1]);
const userAttrs = (f) => [...String(f || '').matchAll(/\buser\.([A-Za-z_]\w*)/g)].map((m) => m[1]);
const recCols = (f) => [...String(f || '').matchAll(/\b(?:rec|newRec)\.([A-Za-z_]\w*)/g)].map((m) => m[1]);
const byPos = (a, b) => ((a.rulePos ?? Infinity) - (b.rulePos ?? Infinity)) || (a.id - b.id);

/**
 * @param {object} p
 * @param {Array|object} p.resources  `_grist_ACLResources` (lignes ou format colonnaire)
 * @param {Array|object} p.rules      `_grist_ACLRules`
 * @param {Map} [p.schema]            schemaFromMetadata() : pour vérifier tables et colonnes
 */
export function buildAccess({ resources, rules, schema = null } = {}) {
  const resRows = columnarToRows(resources || []);
  const ruleRows = columnarToRows(rules || []);
  const resById = new Map(resRows.map((r) => [r.id, { id: r.id, tableId: String(r.tableId || ''), colIds: String(r.colIds || '') }]));
  const tableExists = (t) => !schema || schema.has(t);
  const columnExists = (t, c) => !schema || (schema.has(t) && (c === 'id' || schema.get(t).columns.has(c)));

  // Attributs utilisateur
  const attributes = [];
  for (const r of ruleRows.slice().sort(byPos)) {
    if (!r.userAttributes) continue;
    let a;
    try { a = JSON.parse(r.userAttributes); } catch { a = null; }
    if (!a || !a.name) continue;
    const problems = [];
    if (!tableExists(a.tableId)) problems.push(`table « ${a.tableId} » introuvable`);
    else if (!columnExists(a.tableId, a.lookupColId)) problems.push(`colonne « ${a.tableId}.${a.lookupColId} » introuvable`);
    const charRoot = String(a.charId || '').split('.')[0];
    if (charRoot && !USER_BUILTINS.has(charRoot) && !attributes.some((x) => x.name === charRoot)) problems.push(`« user.${a.charId} » n'est pas une propriété connue`);
    attributes.push({ id: r.id, name: a.name, tableId: a.tableId, lookupColId: a.lookupColId, charId: a.charId, problems });
  }
  const attrNames = new Set(attributes.map((a) => a.name));

  // Règles par ressource
  const groups = new Map(); // resourceId → rules
  for (const r of ruleRows) {
    if (r.userAttributes) continue;
    const res = resById.get(r.resource);
    if (!res || !res.tableId) continue; // ressource vide créée par Grist
    if (!groups.has(res.id)) groups.set(res.id, []);
    groups.get(res.id).push(r);
  }
  const makeRules = (res, list, bits) => list.sort(byPos).map((r, i) => {
    const formula = String(r.aclFormula || '').trim();
    const who = describeCondition(formula, { first: i === 0 });
    const perms = parsePermissions(r.permissionsText);
    const problems = [];
    for (const name of userAttrs(formula)) {
      if (!USER_BUILTINS.has(name) && !attrNames.has(name)) problems.push({ kind: 'unknown-attribute', text: `« user.${name} » n'est défini nulle part` });
    }
    if (res.tableId !== '*' && !res.tableId.startsWith('*')) {
      for (const c of recCols(formula)) if (tableExists(res.tableId) && !columnExists(res.tableId, c)) problems.push({ kind: 'missing-rec-column', text: `colonne « ${res.tableId}.${c} » introuvable` });
    }
    const unusable = Object.keys(perms).filter((b) => !bits.includes(b));
    return {
      id: r.id, pos: r.rulePos, formula, who, perms, permText: String(r.permissionsText || ''), memo: String(r.memo || ''),
      emails: emailLiterals(formula), unusable, problems,
    };
  });

  const defaults = [];
  const special = [];
  const tableMap = new Map();
  for (const [resId, list] of groups) {
    const res = resById.get(resId);
    if (res.tableId === '*') {
      defaults.push(...makeRules(res, list, DEFAULT_BITS));
    } else if (res.tableId === '*SPECIAL') {
      const info = SPECIAL[res.colIds] || { label: res.colIds, allowed: `Réglage spécial « ${res.colIds} ».`, byDefault: '' };
      const rs = makeRules(res, list, DEFAULT_BITS);
      special.push({ id: res.colIds, ...info, rules: rs, allowedForAll: rs.some((x) => !x.formula && Object.values(x.perms).includes('allow')) });
    } else {
      if (!tableMap.has(res.tableId)) tableMap.set(res.tableId, { tableId: res.tableId, missing: !tableExists(res.tableId), rules: [], columns: [] });
      const entry = tableMap.get(res.tableId);
      if (res.colIds === '*' || !res.colIds) entry.rules.push(...makeRules(res, list, TABLE_BITS));
      else {
        const colIds = res.colIds.split(',').map((c) => c.trim()).filter(Boolean);
        entry.columns.push({ colIds, missing: colIds.filter((c) => !columnExists(res.tableId, c)), rules: makeRules(res, list, COLUMN_BITS) });
      }
    }
  }
  const tables = [...tableMap.values()].sort((a, b) => a.tableId.localeCompare(b.tableId, 'fr'));
  const allRules = [...defaults, ...tables.flatMap((t) => [...t.rules, ...t.columns.flatMap((c) => c.rules)])];
  const structureRestricted = defaults.some((r) => r.perms.S === 'deny');
  const restrictsRead = allRules.some((r) => r.perms.R === 'deny');
  const ruleCount = allRules.length + special.reduce((s, x) => s + x.rules.length, 0);
  const userTables = schema ? [...schema.keys()].filter((t) => !t.startsWith('_grist_') && !schema.get(t).summarySourceTable) : [];
  const covered = new Set(tables.map((t) => t.tableId));
  const uncovered = userTables.filter((t) => !covered.has(t)).sort((a, b) => a.localeCompare(b, 'fr'));

  return {
    hasRules: ruleCount > 0 || attributes.length > 0,
    ruleCount,
    attributes,
    defaults,
    special,
    tables,
    uncovered,
    structureRestricted,
    restrictsRead,
    rowRules: allRules.filter((r) => r.who.row).length,
  };
}

const REFRESH_STEP = 'Revenez dans ce widget et cliquez sur « Relire le document ».';
const OPEN_RULES = 'Ouvrez la page « Règles d\'accès » du document (menu de gauche, rubrique Outils).';

/** Constats sur les droits d'accès, au même format que ceux de la structure (insights.js). */
export function accessInsights(access) {
  if (!access) return [];
  const items = [];
  const push = (it) => items.push({ area: 'access', ...it });

  if (!access.hasRules) {
    push({
      id: 'acl-none', severity: 'info',
      title: 'Aucune règle d\'accès avancée',
      summary: 'Chaque personne invitée voit et modifie tout le document selon son rôle de partage : propriétaire, éditeur ou lecteur.',
      why: 'C\'est suffisant si tous les invités peuvent voir toutes les données. Sinon, les règles d\'accès permettent de restreindre une table, une colonne ou certaines lignes.',
      steps: [], targets: [],
    });
    return items;
  }

  const brokenAttr = access.attributes.filter((a) => a.problems.length);
  if (brokenAttr.length) {
    push({
      id: 'acl-attribute', severity: 'improve',
      title: 'Attribut utilisateur inexistant',
      summary: 'La source de cet attribut utilisateur n’apparaît pas dans les éléments lisibles : sa table ou sa colonne peut être absente, ou masquée à l’utilisateur concerné par les droits d’accès. Le widget ne peut pas distinguer ces situations.',
      why: 'Si la source a été supprimée, les droits d’accès qui utilisent cet attribut ne trouvent plus la fiche prévue. Si elle est masquée, il s’agit d’une limite de l’audit.',
      steps: [OPEN_RULES, 'Dans « Attributs utilisateur », vérifiez la table et la colonne ; choisissez-en d\'existantes ou supprimez l\'attribut.', REFRESH_STEP],
      targets: brokenAttr.map((a) => ({ table: a.tableId, note: `user.${a.name} : ${a.problems.join(', ')}` })),
    });
  }

  const unknown = [];
  const missingCols = [];
  const forEachRule = (fn) => {
    for (const r of access.defaults) fn(r, '*');
    for (const t of access.tables) {
      for (const r of t.rules) fn(r, t.tableId);
      for (const c of t.columns) for (const r of c.rules) fn(r, t.tableId, c.colIds);
    }
  };
  forEachRule((r, table) => {
    for (const p of r.problems) (p.kind === 'unknown-attribute' ? unknown : missingCols).push({ table, note: p.text, rule: r });
  });
  for (const t of access.tables) {
    if (t.missing) missingCols.push({ table: t.tableId, note: 'table invisible pour vous' });
    for (const c of t.columns) for (const col of c.missing) missingCols.push({ table: t.tableId, column: col, note: 'colonne invisible pour vous' });
  }
  if (unknown.length) {
    push({
      id: 'acl-unknown-attribute', severity: 'blocking',
      title: 'Condition de droit d’accès utilisant un attribut inconnu',
      summary: 'La condition fait appel à « user.… » pour un attribut qui n\'est défini nulle part.',
      why: 'Cet attribut utilisateur n’est pas déclaré dans les éléments lus. La condition des droits d’accès peut ne jamais correspondre ; vérifiez sa définition et son nom.',
      steps: [OPEN_RULES, 'Corrigez la condition, ou créez l\'attribut manquant dans « Attributs utilisateur ».', REFRESH_STEP],
      targets: unknown.map((u) => ({ table: u.table === '*' ? 'Droits d’accès par défaut' : u.table, note: `${u.rule.formula}` })),
    });
  }
  if (missingCols.length) {
    push({
      id: 'acl-hidden', severity: 'choice',
      intended: 'Ces éléments sont volontairement masqués à l’utilisateur concerné : conservez les droits d’accès. Une personne habilitée peut compléter l’audit.',
      title: 'Colonnes utilisées pour les droits d’accès non visibles pour l’utilisateur concerné',
      summary: 'Des droits d’accès utilisent ou protègent des colonnes ou des tables que l’utilisateur connecté ne peut pas lire. Le widget d’audit ne peut donc pas les examiner ; une suppression reste aussi possible.',
      why: 'Ces éléments peuvent manquer au schéma, aux tables et au rapport. Les droits d’accès d’une colonne sont prioritaires sur ceux de sa table, propriétaires compris.',
      steps: [
        OPEN_RULES,
        'Sinon, si les propriétaires doivent les voir : dans les droits d’accès de ces colonnes, ajoutez en premier une condition « user.Access in [OWNER] » avec Lire autorisé.',
        'Si elles ont été supprimées : retirez-les des droits d’accès.',
        REFRESH_STEP,
      ],
      targets: missingCols.map((m) => ({ table: m.table, column: m.column, note: m.note })),
    });
  }

  if (access.restrictsRead && effectivePermission(access, '*', null, 'EDITOR', 'S') === 'allow') {
    push({
      id: 'acl-bypass', severity: 'choice',
      intended: 'Les droits réels dépendent des profils et de l’ordre des conditions des droits d’accès. Vérifiez que seuls les profils prévus peuvent modifier les formules.',
      title: 'Modification des formules à vérifier sous restrictions de lecture',
      summary: 'Des données sont cachées par des droits d’accès, mais les éditeurs peuvent toujours modifier la structure et écrire des formules.',
      why: 'Une formule peut lire n\'importe quelle table, données cachées comprises : un éditeur peut ainsi les afficher.',
      steps: [
        OPEN_RULES,
        'Dans les droits d’accès spéciaux, décochez l\'autorisation donnée aux éditeurs de modifier la structure.',
        'Ou ajoutez aux droits d’accès par défaut : condition « user.Access != OWNER », permission Structure refusée.',
        REFRESH_STEP,
      ],
      targets: [],
    });
  }
  const withEmails = [];
  forEachRule((r, table) => { if (r.emails.length) withEmails.push({ table: table === '*' ? 'Droits d’accès par défaut' : table, note: r.emails.join(', ') }); });
  if (withEmails.length) {
    push({
      id: 'acl-emails', severity: 'improve',
      title: 'Courriels écrits en dur dans les conditions',
      summary: 'Des personnes sont désignées directement par leur adresse dans la condition.',
      why: 'À chaque arrivée ou départ, il faut modifier les conditions des droits d’accès. Une table des habilitations et un attribut utilisateur sont plus simples à tenir à jour.',
      steps: [
        'Créez (ou complétez) une table qui associe chaque adresse à un rôle.',
        OPEN_RULES,
        'Ajoutez un attribut utilisateur qui cherche la personne dans cette table, puis écrivez la condition avec ce rôle (ex. user.Habilitation.Role == \'RH\').',
        REFRESH_STEP,
      ],
      targets: withEmails,
    });
  }
  const denyNoMemo = [];
  forEachRule((r, table) => { if (Object.values(r.perms).includes('deny') && !r.memo) denyNoMemo.push({ table: table === '*' ? 'Droits d’accès par défaut' : table, note: r.who.text }); });
  if (denyNoMemo.length) {
    push({
      id: 'acl-no-memo', severity: 'info',
      title: 'Refus de droits d’accès sans message explicatif',
      summary: 'Ces refus de droits d’accès ne comportent aucun message explicatif (« mémo »). La personne concernée comprend plus difficilement pourquoi une action est refusée.',
      why: 'Un message court (« Réservé au service RH ») évite les demandes d\'aide.',
      steps: [OPEN_RULES, 'Ouvrez le menu du droit d’accès concerné et ajoutez un mémo.'],
      targets: denyNoMemo,
    });
  }
  if (access.uncovered.length && access.tables.length) {
    push({
      id: 'acl-uncovered', severity: 'choice',
      intended: 'Tables sans donnée sensible : rien à faire.',
      title: 'Table sans aucune règle d’accès avancée',
      summary: 'Aucune règle d’accès avancée n’est définie directement sur ces tables. Elles suivent les droits d’accès par défaut du document et les rôles de partage.',
      why: 'Leurs accès dépendent des droits d’accès généraux et des rôles de partage. Une absence de règle d’accès avancée propre à la table ne signifie pas une absence de protection.',
      steps: ['Sinon : ouvrez « Règles d\'accès » et ajoutez une règle d’accès avancée à la table (bouton « Ajouter des règles de table »).', REFRESH_STEP],
      targets: access.uncovered.map((t) => ({ table: t })),
    });
  }
  return items;
}

/** Lignes du tableau des règles (pour l'aperçu, le CSV et le rapport). */
export function permissionCells(rule, bits) {
  return bits.map((bit) => ({ bit, state: rule.perms[bit] || null }));
}
export const BITS = { table: TABLE_BITS, column: COLUMN_BITS, defaults: DEFAULT_BITS };
export const PERMISSION_LABEL = Object.fromEntries(PERMISSIONS.map((p) => [p.bit, p.label]));


