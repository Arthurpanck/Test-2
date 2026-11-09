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
import {
  PERMISSIONS,
  PERMISSION_LABEL,
  TABLE_BITS,
  COLUMN_BITS,
  DEFAULT_BITS,
  USER_BUILTINS,
  byRulePos as byPos,
  parsePermissions,
  readAcl,
  editorsStructure,
} from './acl-model.js';
import { maskPython } from './python-text.js';

export { PERMISSIONS, PERMISSION_LABEL, parsePermissions };

/** Libellés des réglages spéciaux (`*SPECIAL`), pour la liste des règles. */
export const SPECIAL_LABELS = {
  FullCopies: 'Copier le document entier',
  AccessRules: 'Voir les droits d’accès',
  DocCopies: 'Copies du document',
  SchemaEdit: 'Modifier la structure (ancien réglage)',
  SeedRule: "Règles ajoutées d'office",
  SeedRules: "Règles ajoutées d'office", // orthographe des anciens documents
};

/**
 * Réglages généraux à signaler : l'état des permissions avancées, puis les trois cases de la page
 * « Règles d'accès » de Grist (version open source) :
 *  - « Pour chaque ajout de règle pour une table, ajouter automatiquement une règle donnant tous les droits au groupe OWNER » (SeedRule) ;
 *  - « Autoriser les Éditeurs à modifier la structure » : décochée, Grist écrit dans les règles par défaut
 *    `user.Access != OWNER` → `-S` ; cochée, aucune règle (ou `user.Access == EDITOR` → `+S`) ;
 *  - « Autoriser tout le monde à voir les permissions avancées » (AccessRules).
 * @returns {Array<{ id, name, on: boolean, state, level: 'success' | 'warning' | 'info', text }>}
 */
export function generalSettings(a) {
  const special = (id) => a.special.find((x) => x.id === id || (id === 'SeedRule' && x.id === 'SeedRules'));
  const allowed = (sp) => (sp ? sp.rules.filter((r) => Object.values(r.perms).includes('allow')).map((r) => r.who.text) : []);
  const seed = special('SeedRule');
  const viewers = allowed(special('AccessRules'));
  const editorsEditSchema = !a.structureRestricted;
  const deny = a.defaults.filter((r) => r.perms.S === 'deny').map((r) => r.who.text);
  const explicitAllow = a.defaults.some((r) => r.perms.S === 'allow');
  return [
    {
      id: 'acl',
      name: 'Permissions avancées',
      on: a.hasRules,
      state: a.hasRules ? 'Activées' : 'Non activées',
      level: 'info',
      text: a.hasRules
        ? `Le document a des règles d'accès : ${a.ruleCount} condition${a.ruleCount > 1 ? 's' : ''}${a.attributes.length ? `, ${a.attributes.length} attribut${a.attributes.length > 1 ? 's' : ''} utilisateur` : ''}.`
        : 'Aucune règle : chaque personne invitée voit et modifie tout selon son rôle de partage (propriétaire, éditeur, lecteur).',
    },
    {
      id: 'seed',
      name: 'Ajouter automatiquement une règle pour les propriétaires',
      on: Boolean(seed?.rules.length),
      state: seed?.rules.length ? 'Oui' : 'Non',
      level: 'info',
      text: seed?.rules.length
        ? `Pour chaque ajout de règle pour une table, Grist ajoute d'abord une règle donnant tous les droits au groupe OWNER (${seed.rules.map((r) => r.who.text).join(' ; ')}).`
        : "Les nouvelles règles de table ne donnent pas d'office tous les droits aux propriétaires.",
    },
    {
      id: 'schema',
      name: 'Autoriser les éditeurs à modifier la structure',
      on: editorsEditSchema,
      state: editorsEditSchema ? 'Oui' : 'Non',
      level: editorsEditSchema && a.restrictsRead ? 'warning' : editorsEditSchema ? 'info' : 'success',
      text: editorsEditSchema
        ? `Les éditeurs modifient tables, colonnes et dispositions, et écrivent des formules${a.restrictsRead ? ' : une formule peut lire toutes les données, malgré les règles qui en restreignent la lecture' : ''}.${
            a.hasRules
              ? explicitAllow
                ? ' La case est cochée dans Grist, et ce choix a été confirmé (avertissement écarté).'
                : ' C’est le réglage par défaut : la case est cochée dans Grist, qui affiche un avertissement tant qu’elle n’est pas décochée.'
              : ''
          }`
        : `Seuls les propriétaires modifient la structure et écrivent des formules (règle par défaut refusant la permission Structure : ${deny.join(' ; ')}).`,
    },
    {
      id: 'access-rules',
      name: 'Autoriser tout le monde à voir les permissions avancées',
      on: viewers.length > 0,
      state: viewers.length ? 'Oui' : 'Non',
      level: 'info',
      text: viewers.length
        ? `Les règles d'accès sont lisibles par : ${viewers.join(' ; ')}.`
        : "Seuls les propriétaires voient les règles d'accès.",
    },
  ];
}

const ROLES = { OWNER: 'propriétaires', EDITOR: 'éditeurs', VIEWER: 'lecteurs' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const joinFr = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}` : list[0] || '');

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
    const roles = m[2]
      .split(',')
      .map((r) => ROLES[r.trim()])
      .filter(Boolean);
    if (roles.length) {
      const neg = m[1] === '!=' || m[1] === 'not in';
      return { text: neg ? `Tous sauf les ${joinFr(roles)}` : cap(joinFr(roles)), kind: 'role', row: false };
    }
  }
  const emails = [];
  const emailOr = f.split(/\s+or\s+/);
  if (
    emailOr.every((part) => {
      const e = /^user\.Email\s*==\s*['"]([^'"]+)['"]$/.exec(part.trim());
      if (e) emails.push(e[1]);
      return Boolean(e);
    })
  ) {
    return { text: emails.join(' ou '), kind: 'email', row: false };
  }
  m = /^user\.Email\s+in\s+\[([^\]]*)\]$/.exec(f);
  if (m) {
    const list = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    if (list.length) return { text: list.join(', '), kind: 'email', row: false };
  }
  m = /^user\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*(==|!=)\s*['"]([^'"]*)['"]$/.exec(f);
  if (m) {
    return {
      text: `Personnes dont « ${m[1]}.${m[2]} » ${m[3] === '==' ? 'vaut' : 'ne vaut pas'} « ${m[4]} »`,
      kind: 'attribute',
      row: false,
    };
  }
  if (/^rec\.[A-Za-z_]\w*\s*==\s*user\.Email$/.test(f) || /^user\.Email\s*==\s*rec\.[A-Za-z_]\w*$/.test(f)) {
    return { text: 'Sur les lignes où la personne est désignée par son adresse', kind: 'row', row: true };
  }
  if (/^not\s+user\.IsLoggedIn$/.test(f)) return { text: 'Personnes non connectées', kind: 'role', row: false };
  const both = describeConjunction(f);
  if (both) return both;
  return { text: row ? 'Selon le contenu de la ligne' : 'Selon une condition', kind: row ? 'row' : 'formula', row };
}

/**
 * « A and B » dont chaque partie est simple : attribut comparé à un texte (« Fonction » vaut « Manager »),
 * ligne comparée à la personne (« Service » correspond au sien). Sinon null.
 * « user.Habilitation.Fonction == 'Manager' and user.Habilitation.Pole == 'RH' »
 *   → Personnes dont « Habilitation.Fonction » vaut « Manager » et « Habilitation.Pole » vaut « RH »
 */
function describeConjunction(f) {
  if (/[()]|\bor\b|\bnot\b/.test(maskPython(f))) return null;
  const parts = f.split(/\s+and\s+/);
  if (parts.length < 2) return null;
  const who = [],
    rows = [];
  for (const raw of parts) {
    const p = raw.trim();
    let m = /^user\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*(==|!=)\s*['"]([^'"]*)['"]$/.exec(p);
    if (m) {
      who.push(`« ${m[1]}.${m[2]} » ${m[3] === '==' ? 'vaut' : 'ne vaut pas'} « ${m[4]} »`);
      continue;
    }
    // Ligne comparée à la personne, dans un sens ou dans l'autre
    const [x, y] = p.split(/\s*==\s*/);
    const rowSide = [x, y].find((v) => /^(?:rec|newRec)\.[A-Za-z_]\w*$/.test(v || ''));
    const userSide = [x, y].find((v) => /^user\.[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?$/.test(v || ''));
    if (y !== undefined && rowSide && userSide) {
      rows.push(`« ${rowSide.split('.')[1]} » correspond à son « ${userSide.slice(5)} »`);
      continue;
    }
    return null;
  }
  if (!who.length) return { text: `Sur les lignes où ${joinFr(rows)}`, kind: 'row', row: true };
  const text = `Personnes dont ${joinFr(who)}${rows.length ? `, sur les lignes où ${joinFr(rows)}` : ''}`;
  return { text, kind: rows.length ? 'row' : 'attribute', row: rows.length > 0 };
}

// Attributs et colonnes cités par une condition (hors chaînes) : « user.Habilitation… », « rec.Service ».
const userAttrs = (f) => [...maskPython(f).matchAll(/\buser\.([A-Za-z_]\w*)/g)].map((m) => m[1]);
const recCols = (f) => [...maskPython(f).matchAll(/\b(?:rec|newRec)\.([A-Za-z_]\w*)/g)].map((m) => m[1]);

/**
 * @param {object} p
 * @param {Array|object} p.resources  `_grist_ACLResources` (lignes ou format colonnaire)
 * @param {Array|object} p.rules      `_grist_ACLRules`
 * @param {Map} [p.schema]            schemaFromMetadata() : pour vérifier tables et colonnes
 */
export function buildAccess({ resources, rules, schema = null } = {}) {
  const acl = readAcl({ resources, rules });
  const resById = new Map(acl.resources.map((r) => [r.id, { id: r.id, tableId: r.tableId, colIds: r.colIds }]));
  const tableExists = (t) => !schema || schema.has(t);
  const columnExists = (t, c) => !schema || (schema.has(t) && (c === 'id' || schema.get(t).columns.has(c)));

  // Attributs utilisateur
  const attributes = [];
  for (const { row: r, def: a } of acl.attributes) {
    const problems = [];
    if (!tableExists(a.tableId)) problems.push(`table « ${a.tableId} » introuvable`);
    else if (!columnExists(a.tableId, a.lookupColId)) problems.push(`colonne « ${a.tableId}.${a.lookupColId} » introuvable`);
    const charRoot = String(a.charId || '').split('.')[0];
    if (charRoot && !USER_BUILTINS.has(charRoot) && !attributes.some((x) => x.name === charRoot))
      problems.push(`« user.${a.charId} » n'est pas une propriété connue`);
    attributes.push({ id: r.id, name: a.name, tableId: a.tableId, lookupColId: a.lookupColId, charId: a.charId, problems });
  }
  const attrNames = new Set(attributes.map((a) => a.name));

  // Règles par ressource
  const groups = new Map(); // resourceId → rules
  for (const r of acl.rules) {
    const res = resById.get(r.resource);
    if (!res || !res.tableId) continue; // ressource vide créée par Grist
    if (!groups.has(res.id)) groups.set(res.id, []);
    groups.get(res.id).push(r);
  }
  const makeRules = (res, list, bits) =>
    list.sort(byPos).map((r, i) => {
      const formula = String(r.aclFormula || '').trim();
      const who = describeCondition(formula, { first: i === 0 });
      const perms = parsePermissions(r.permissionsText);
      const problems = [];
      for (const name of userAttrs(formula)) {
        if (!USER_BUILTINS.has(name) && !attrNames.has(name))
          problems.push({ kind: 'unknown-attribute', text: `« user.${name} » n'est défini nulle part` });
      }
      if (res.tableId !== '*' && !res.tableId.startsWith('*')) {
        for (const c of recCols(formula))
          if (tableExists(res.tableId) && !columnExists(res.tableId, c))
            problems.push({ kind: 'missing-rec-column', text: `colonne « ${res.tableId}.${c} » introuvable` });
      }
      const unusable = Object.keys(perms).filter((b) => !bits.includes(b));
      return {
        id: r.id,
        pos: r.rulePos,
        formula,
        who,
        perms,
        permText: String(r.permissionsText || ''),
        memo: String(r.memo || ''),
        unusable,
        problems,
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
      special.push({ id: res.colIds, label: SPECIAL_LABELS[res.colIds] || res.colIds, rules: makeRules(res, list, DEFAULT_BITS) });
    } else {
      if (!tableMap.has(res.tableId))
        tableMap.set(res.tableId, { tableId: res.tableId, missing: !tableExists(res.tableId), rules: [], columns: [] });
      const entry = tableMap.get(res.tableId);
      if (res.colIds === '*' || !res.colIds) entry.rules.push(...makeRules(res, list, TABLE_BITS));
      else {
        const colIds = res.colIds
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
        entry.columns.push({
          colIds,
          missing: colIds.filter((c) => !columnExists(res.tableId, c)),
          rules: makeRules(res, list, COLUMN_BITS),
        });
      }
    }
  }
  const tables = [...tableMap.values()].sort((a, b) => a.tableId.localeCompare(b.tableId, 'fr'));
  const allRules = [...defaults, ...tables.flatMap((t) => [...t.rules, ...t.columns.flatMap((c) => c.rules)])];
  // Droits de structure des éditeurs : la même lecture que le constat et la matrice (rôle Éditeur).
  const structure = editorsStructure({ defaults, special, tables });
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
    structure,
    structureRestricted: structure === 'deny',
    restrictsRead,
    rowRules: allRules.filter((r) => r.who.row).length,
  };
}

const REFRESH_STEP = 'Revenez dans cette vue et cliquez sur « Relire le document ».';
const OPEN_RULES = "Ouvrez la page « Règles d'accès » du document (menu de gauche, rubrique Outils).";

/** Constats sur les droits d'accès, au même format que ceux de la structure (insights.js). */
export function accessInsights(access) {
  if (!access) return [];
  const items = [];
  const push = (it) => items.push({ area: 'access', ...it });

  if (!access.hasRules) {
    push({
      id: 'acl-none',
      severity: 'info',
      title: "Aucune règle d'accès avancée dans le document",
      summary: 'Chaque personne invitée voit et modifie tout le document selon son rôle de partage : propriétaire, éditeur ou lecteur.',
      why: "C'est suffisant si tous les invités peuvent voir toutes les données. Sinon, les règles d'accès permettent de restreindre une table, une colonne ou certaines lignes.",
      steps: [
        OPEN_RULES,
        'Si vous avez besoin de limiter les accès, cliquez sur « Activer les règles d’accès », puis confirmez après avoir lu les changements proposés.',
        'Ajoutez les droits nécessaires pour une table, une colonne ou certaines lignes ; vérifiez leur effet pour les profils concernés avant de les enregistrer.',
        REFRESH_STEP,
      ],
      targets: [],
    });
    return items;
  }

  const forEachRule = (fn) => {
    for (const r of access.defaults) fn(r, '*');
    for (const t of access.tables) {
      for (const r of t.rules) fn(r, t.tableId);
      for (const c of t.columns) for (const r of c.rules) fn(r, t.tableId, c.colIds);
    }
  };
  if (access.restrictsRead && (access.structure ?? editorsStructure(access)) === 'allow') {
    push({
      id: 'acl-bypass',
      severity: 'blocking',
      intended:
        'Les droits réels dépendent des profils et de l’ordre des conditions des droits d’accès. Vérifiez que seuls les profils prévus peuvent modifier les formules.',
      title: 'Accès des éditeurs aux droits de structure et donc aux données malgré les droits d’accès',
      summary:
        'Des restrictions de lecture existent via les droits d’accès, mais les éditeurs peuvent modifier la structure et écrire des formules.',
      why: "Une formule peut lire n'importe quelle table, données cachées comprises : un éditeur peut ainsi les afficher.",
      steps: [
        OPEN_RULES,
        'Dans les droits d’accès spéciaux, décochez la case « Autoriser les éditeurs à modifier la structure » (cochée par défaut).',
        REFRESH_STEP,
      ],
      targets: [],
    });
  }
  const denyNoMemo = [];
  forEachRule((r, table) => {
    if (Object.values(r.perms).includes('deny') && !r.memo)
      denyNoMemo.push({ table: table === '*' ? 'Droits d’accès par défaut' : table, note: r.who.text });
  });
  if (denyNoMemo.length) {
    push({
      id: 'acl-no-memo',
      severity: 'improve',
      title: 'Message de refus de droits d’accès sans explication',
      summary:
        'Ces refus de droits d’accès ne comportent aucun message explicatif (« mémo »). La personne concernée comprend plus difficilement pourquoi une action est refusée.',
      why: "Un message court (« Réservé au service RH ») évite les demandes d'aide.",
      steps: [
        OPEN_RULES,
        'À droite de la condition concernée, cliquez sur la petite icône de discussion (bulle de commentaire) pour ajouter un mémo.',
        'Écrivez une explication courte, par exemple « Réservé au service RH », puis enregistrez les droits d’accès.',
        REFRESH_STEP,
      ],
      targets: denyNoMemo,
    });
  }
  if (access.uncovered.length && access.tables.length) {
    push({
      id: 'acl-uncovered',
      severity: 'info',
      intended: 'Tables sans donnée sensible : rien à faire.',
      title: 'Table non concernée par des règles avancées',
      summary:
        'Aucune règle d’accès avancée n’est définie directement sur ces tables. Elles suivent les droits d’accès par défaut du document et les rôles de partage.',
      why: 'Leurs accès dépendent des droits d’accès généraux et des rôles de partage. Une absence de règle d’accès avancée propre à la table ne signifie pas une absence de protection.',
      steps: [
        "Sinon : ouvrez « Règles d'accès » et ajoutez une règle d’accès avancée à la table (bouton « Ajouter des règles de table »).",
        REFRESH_STEP,
      ],
      targets: access.uncovered.map((t) => ({ table: t })),
    });
  }
  return items;
}

export const BITS = { table: TABLE_BITS, column: COLUMN_BITS, defaults: DEFAULT_BITS };
