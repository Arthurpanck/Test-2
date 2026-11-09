/**
 * Matrice « Qui peut faire quoi ? » : pour chaque table et chaque rôle métier, ce que permettent
 * les règles d'accès (Lire, Modifier, Créer, Supprimer), en supposant le rôle Grist « Éditeur ».
 *
 * Lecture seule et sans exécution : les conditions sont analysées dans un langage fermé
 * (chemins, littéraux, listes, comparaisons, and / or / not, in, is). Tout ce qui sort de ce
 * sous-ensemble est « indéterminé ». Aucun eval, aucune ligne métier lue, aucune règle modifiée.
 * Repris du widget de démonstration « Qui peut faire quoi ? » (parseCondition, evaluateCondition,
 * permissionBits, prepareMatrixModel, permissionFor, combinePermissions), adapté au widget.
 *
 * Module pur : testé sous Node.
 */
import {
  readAcl,
  byRulePos,
  parseCondition,
  evaluateCondition,
  permissionBits,
  unknown,
  USER_BUILTINS as BUILTIN_USER,
} from './acl-model.js';
import { columnarToRows } from './util.js';

export { parseCondition, evaluateCondition, permissionBits };

export const ACTIONS = [
  ['R', 'Lire'],
  ['U', 'Modifier'],
  ['C', 'Créer'],
  ['D', 'Supprimer'],
];
const ACTION_LABEL = { R: 'Lire', U: 'Modifier', C: 'Créer', D: 'Supprimer', S: 'Structure' };
/** Rôle Grist supposé : éditeur. */
const ROLE_NAMES = /^(r[oô]le|profil|fonction)$/i;

// ---------------------------------------------------------------------------
// Règles
// ---------------------------------------------------------------------------

/** Ressources et règles triées, conditions analysées. */
export function prepareMatrixModel({ resources = [], rules = [] } = {}) {
  const acl = readAcl({ resources, rules });
  const groups = new Map(acl.resources.map((r) => [r.id, { ...r, rules: [] }]));
  const attributes = acl.attributes.map((a) => a.def);
  for (const r of acl.rules) {
    if (!r.permissionsText) continue;
    const g = groups.get(r.resource);
    if (!g) continue;
    let tree = null,
      parseError = '';
    try {
      tree = parseCondition(r.aclFormula);
    } catch (e) {
      parseError = e.message;
    }
    g.rules.push({
      id: r.id,
      formula: String(r.aclFormula || ''),
      permissionsText: r.permissionsText,
      memo: r.memo || '',
      rulePos: r.rulePos,
      bits: permissionBits(r.permissionsText),
      tree,
      parseError,
    });
  }
  for (const g of groups.values()) g.rules.sort(byRulePos);
  return { resources: [...groups.values()], attributes };
}

/**
 * Rôle métier : le couple (attribut, colonne) comparé au plus grand nombre de valeurs texte
 * (« user.Habilitation.Role == 'RH' », « != 'RH' », « in ['RH', 'Finances'] »).
 * @returns {{ attr, col, values: string[] } | null}
 */
export function detectRole(model) {
  const found = new Map(); // "Attr.Col" → { attr, col, values (ordre d'apparition) }
  const visit = (t) => {
    if (!t || typeof t !== 'object') return;
    if (t.type === 'compare' && ['==', '!=', 'in', 'not in'].includes(t.op)) {
      const pairs = [
        [t.a, t.b],
        [t.b, t.a],
      ];
      for (const [p, v] of pairs) {
        const m = p?.type === 'path' && /^user\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(p.value);
        if (!m || BUILTIN_USER.has(m[1])) continue;
        const texts =
          v?.type === 'literal' && typeof v.value === 'string'
            ? [v.value]
            : v?.type === 'list'
              ? v.values.filter((x) => x.type === 'literal' && typeof x.value === 'string').map((x) => x.value)
              : [];
        if (!texts.length) continue;
        const key = `${m[1]}.${m[2]}`;
        if (!found.has(key)) found.set(key, { attr: m[1], col: m[2], values: [] });
        for (const x of texts) if (!found.get(key).values.includes(x)) found.get(key).values.push(x);
      }
    }
    for (const k of ['a', 'b']) visit(t[k]);
    if (t.type === 'list') t.values.forEach(visit);
  };
  for (const g of model.resources) for (const r of g.rules) visit(r.tree);
  // Une colonne qui ne vient jamais qu'en précision d'une autre (« Fonction == 'RH' and Grade == 'Manager' »)
  // est un sous-rôle : le rôle est la colonne citée en premier.
  const leading = new Set();
  const conjuncts = (t) => (t?.type === 'and' ? [...conjuncts(t.a), ...conjuncts(t.b)] : [t]);
  const colOf = (t) => {
    if (t?.type !== 'compare') return null;
    for (const p of [t.a, t.b]) {
      const m = p?.type === 'path' && /^user\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(p.value);
      if (m && !BUILTIN_USER.has(m[1])) return `${m[1]}.${m[2]}`;
    }
    return null;
  };
  const lead = (t) => {
    if (!t || typeof t !== 'object') return;
    if (t.type === 'and') {
      const first = conjuncts(t).map(colOf).find(Boolean);
      if (first) leading.add(first);
      return;
    }
    if (t.type === 'compare') {
      const c = colOf(t);
      if (c) leading.add(c);
      return;
    }
    for (const k of ['a', 'b']) lead(t[k]);
  };
  for (const g of model.resources) for (const r of g.rules) lead(r.tree);
  const defined = new Set(model.attributes.map((a) => a.name));
  const candidates = [...found.values()].filter((c) => defined.has(c.attr));
  if (!candidates.length) return null;
  const isLeading = (c) => Number(leading.has(`${c.attr}.${c.col}`));
  candidates.sort(
    (a, b) =>
      isLeading(b) - isLeading(a) || b.values.length - a.values.length || Number(ROLE_NAMES.test(b.col)) - Number(ROLE_NAMES.test(a.col)),
  );
  return candidates[0];
}

/** Colonnes de la personne qui filtrent les lignes (« rec.Service == user.Habilitation.Service »). */
export function filteringColumns(model, attr) {
  const out = [];
  const visit = (t) => {
    if (!t || typeof t !== 'object') return;
    if (t.type === 'compare' && ['==', 'is'].includes(t.op)) {
      for (const [p, q] of [
        [t.a, t.b],
        [t.b, t.a],
      ]) {
        const m = q?.type === 'path' && new RegExp(`^user\\.${attr}\\.([A-Za-z_]\\w*)$`).exec(q.value);
        if (m && p?.type === 'path' && /^(rec|newRec)\./.test(p.value) && !out.includes(m[1])) out.push(m[1]);
      }
    }
    for (const k of ['a', 'b']) visit(t[k]);
  };
  for (const g of model.resources) for (const r of g.rules) visit(r.tree);
  return out;
}

/** Valeur « autre » d'un sous-rôle : différente de toutes celles que citent les règles. */
export const OTHER_VALUE = '\u0000autre';

/**
 * Sous-rôles : une deuxième colonne de la même habilitation, comparée à des valeurs texte dans les
 * mêmes conditions que le rôle (« Fonction == 'Manager' and Pole == 'RH' »). Le rôle « Manager » se
 * divise alors en « Manager · Pole RH », « Manager · Pole Finances » et « Manager · autre Pole ».
 * @returns {Map<string, { col, values: string[] }>} par valeur du rôle
 */
export function detectSubRoles(model, role) {
  const found = new Map(); // valeur du rôle → Map(colonne → valeurs)
  const literalsOf = (t) => {
    // « user.Attr.Col == 'x' » ou « 'x' == user.Attr.Col » ou « user.Attr.Col in ['x', 'y'] »
    if (t?.type !== 'compare' || !['==', 'in'].includes(t.op)) return null;
    for (const [p, v] of [
      [t.a, t.b],
      [t.b, t.a],
    ]) {
      const m = p?.type === 'path' && new RegExp(`^user\\.${role.attr}\\.([A-Za-z_]\\w*)$`).exec(p.value);
      if (!m) continue;
      const texts =
        v?.type === 'literal' && typeof v.value === 'string'
          ? [v.value]
          : v?.type === 'list'
            ? v.values.filter((x) => x.type === 'literal' && typeof x.value === 'string').map((x) => x.value)
            : [];
      if (texts.length) return { col: m[1], texts };
    }
    return null;
  };
  const conjuncts = (t) => (t?.type === 'and' ? [...conjuncts(t.a), ...conjuncts(t.b)] : [t]);
  const visit = (t) => {
    if (!t || typeof t !== 'object') return;
    if (t.type === 'and') {
      const parts = conjuncts(t).map(literalsOf).filter(Boolean);
      const main = parts.filter((x) => x.col === role.col);
      const others = parts.filter((x) => x.col !== role.col);
      for (const m of main)
        for (const v of m.texts)
          for (const o of others) {
            if (!found.has(v)) found.set(v, new Map());
            const cols = found.get(v);
            if (!cols.has(o.col)) cols.set(o.col, []);
            for (const x of o.texts) if (!cols.get(o.col).includes(x)) cols.get(o.col).push(x);
          }
      return;
    }
    for (const k of ['a', 'b']) visit(t[k]);
  };
  for (const g of model.resources) for (const r of g.rules) visit(r.tree);
  const out = new Map();
  for (const [value, cols] of found) {
    // La colonne la plus citée pour cette valeur du rôle
    const [col, values] = [...cols.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    out.set(value, { col, values });
  }
  return out;
}

/**
 * Deux valeurs du rôle toujours citées ensemble : chaque condition qui nomme l'une nomme aussi l'autre
 * (« Poste == 'Commercial' or Poste == 'Commerciale' »).
 * @returns {(a: string, b: string) => boolean}
 */
function coMentioned(model, role) {
  const mentions = [];
  const collect = (t, set) => {
    if (!t || typeof t !== 'object') return;
    if (t.type === 'compare')
      for (const [p, v] of [
        [t.a, t.b],
        [t.b, t.a],
      ]) {
        if (p?.type !== 'path' || p.value !== `user.${role.attr}.${role.col}`) continue;
        if (v?.type === 'literal') set.add(v.value);
        if (v?.type === 'list') v.values.forEach((x) => x.type === 'literal' && set.add(x.value));
      }
    for (const k of ['a', 'b']) collect(t[k], set);
  };
  for (const g of model.resources)
    for (const r of g.rules) {
      const set = new Set();
      collect(r.tree, set);
      if (set.size) mentions.push(set);
    }
  return (a, b) => mentions.every((set) => set.has(a) === set.has(b));
}

/**
 * Groupes de colonnes de la matrice : une valeur du rôle métier par groupe, plus « Tous les autres ».
 * @param {object} attrData  données colonnaires de la table de l'attribut (facultatif), pour « 7 services »
 */
export function matrixGroups(model, attrData = null) {
  const role = detectRole(model);
  if (!role) return { role: null, groups: [{ key: 'editors', name: 'Éditeurs', sub: 'Rôle Grist Éditeur', value: null }] };
  const attr = model.attributes.find((a) => a.name === role.attr);
  const filter = filteringColumns(model, role.attr)[0];
  const rows = attrData ? columnarToRows(attrData) : [];
  const subRoles = detectSubRoles(model, role);
  /** « · 4 services » : valeurs distinctes de la colonne filtrante parmi les habilitations du groupe. */
  const count = (keep) => {
    if (!filter || !rows.length) return '';
    const n = new Set(
      rows
        .filter(keep)
        .map((r) => r[filter])
        .filter((x) => x !== null && x !== undefined && x !== ''),
    ).size;
    return n > 1 ? ` · ${n} ${filter.toLowerCase()}s` : '';
  };
  /** Valeurs de la sous-colonne présentes dans les habilitations, hors de celles que citent les règles. */
  const others = (value, sr) => [
    ...new Set(
      rows
        .filter((r) => r[role.col] === value && !sr.values.includes(r[sr.col]))
        .map((r) => r[sr.col])
        .filter((x) => x !== null && x !== undefined && x !== ''),
    ),
  ];
  const groups = role.values.flatMap((value) => {
    const base = `${role.attr}.${role.col} = « ${value} »`;
    const sr = subRoles.get(value);
    if (!sr) return [{ key: value, name: value, sub: base + count((r) => r[role.col] === value), value }];
    // Rôle divisé par ses sous-rôles, puis « autre » pour les habilitations hors des valeurs citées.
    // Habilitations lues et personne hors des valeurs citées : pas de colonne « autre ».
    const noOther = rows.length > 0 && !rows.some((r) => r[role.col] === value && !sr.values.includes(r[sr.col]));
    return [
      ...sr.values.map((w) => ({
        key: `${value}|${w}`,
        name: `${value} · ${sr.col} ${w}`,
        sub: `${base} et ${sr.col} = « ${w} »` + count((r) => r[role.col] === value && r[sr.col] === w),
        value,
        subCol: sr.col,
        subValue: w,
      })),
      ...(noOther
        ? []
        : [
            {
              key: `${value}|*`,
              // Avec les habilitations lues : les valeurs réellement concernées (« RH · Grade Assistant »).
              name: others(value, sr).length === 1 ? `${value} · ${sr.col} ${others(value, sr)[0]}` : `${value} · autre ${sr.col}`,
              sub:
                `${base}, ${sr.col} autre que ${sr.values.map((w) => `« ${w} »`).join(', ')}` +
                (others(value, sr).length > 1 ? ` (${others(value, sr).join(', ')})` : '') +
                count((r) => r[role.col] === value && !sr.values.includes(r[sr.col])),
              value,
              subCol: sr.col,
              subValue: OTHER_VALUE,
            },
          ]),
    ];
  });
  groups.push({ key: '__autres', name: 'Tous les autres', sub: 'Autre rôle ou sans habilitation', value: null });
  return { role: { ...role, table: attr?.tableId || '' }, groups };
}

// ---------------------------------------------------------------------------
// Calcul d'une case
// ---------------------------------------------------------------------------

/** Couches de règles pour une table (et une colonne) : colonne, puis table, puis document. */
function layers(model, table, column) {
  const res = model.resources;
  // Droits de structure : l'ancien réglage spécial « SchemaEdit » passe avant les règles du document.
  if (table === '*')
    return [
      res.filter((g) => g.tableId === '*SPECIAL' && g.colIds === 'SchemaEdit'),
      res.filter((g) => g.tableId === '*' && g.colIds === '*'),
    ];
  const colRes = column
    ? res.filter(
        (g) =>
          g.tableId === table &&
          g.colIds !== '*' &&
          g.colIds
            .split(',')
            .map((x) => x.trim())
            .includes(column),
      )
    : [];
  return [colRes, res.filter((g) => g.tableId === table && g.colIds === '*'), res.filter((g) => g.tableId === '*' && g.colIds === '*')];
}

/**
 * Droit d'un groupe pour une action.
 * @returns {{ state: 'allow'|'deny'|'rows-allow'|'rows-deny'|'unknown', labels: string[], steps: Array, decidedBy }}
 */
export function permissionFor(model, { table, column = null, bit, group, role }) {
  const ctx = {
    attributes: new Set(model.attributes.map((a) => a.name)),
    roleAttr: role?.attr,
    roleCol: role?.col,
    roleValue: group?.value ?? null,
    subCol: group?.subCol,
    subValue: group?.subValue,
  };
  const ls = layers(model, table, column);
  if (ls.some((l) => l.length > 1))
    return { state: 'unknown', labels: [], steps: [], note: 'Plusieurs ressources se recouvrent : à vérifier dans Grist.' };
  const steps = [];
  const branches = []; // { allow, rows, profile }
  let unknownSeen = false,
    final = null;
  for (const r of ls.flat().flatMap((g) => g.rules)) {
    if (!Object.hasOwn(r.bits, bit)) {
      steps.push({ rule: r, effect: 'off-action' });
      continue;
    }
    const v = r.tree ? evaluateCondition(r.tree, ctx) : unknown(r.formula);
    if (v === false) {
      steps.push({ rule: r, effect: 'skip' });
      continue;
    }
    if (v === true) {
      steps.push({ rule: r, effect: 'decide' });
      final = r.bits[bit];
      break;
    }
    if (v.unknown) unknownSeen = true;
    steps.push({ rule: r, effect: v.unknown ? 'unknown' : 'branch', rows: v.rows, profile: v.profile });
    branches.push({ allow: r.bits[bit], rows: v.rows, profile: v.profile });
  }
  if (final === null) {
    steps.push({ rule: null, effect: 'default' });
    final = true;
  } // éditeur : tout autorisé par défaut
  if (unknownSeen) return { state: 'unknown', labels: [], steps };
  const opposite = branches.filter((b) => b.allow !== final);
  if (!opposite.length) return { state: final ? 'allow' : 'deny', labels: [], steps };
  // Branche la plus large : celle qui demande le moins de colonnes (la première en cas d'égalité).
  const best = opposite.reduce((m, b) => (b.rows.length + b.profile.length < m.rows.length + m.profile.length ? b : m));
  return {
    state: final ? 'rows-deny' : 'rows-allow',
    labels: [...best.rows, ...best.profile],
    rows: best.rows,
    profile: best.profile,
    steps,
  };
}

/** Lignes de la matrice : droits de structure, puis chaque table et, sur demande, ses colonnes à règles. */
export function matrixRows(model, tableIds) {
  const rows = [
    { key: '*structure', kind: 'structure', label: 'Droits de structure', sub: 'Tables, colonnes et formules, pour toutes les tables' },
  ];
  for (const table of tableIds) {
    rows.push({ key: table, kind: 'table', label: table, table });
    const cols = [];
    for (const g of model.resources) {
      if (g.tableId !== table || g.colIds === '*' || !g.rules.length) continue;
      for (const c of g.colIds
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean))
        if (!cols.includes(c)) cols.push(c);
    }
    for (const c of cols) rows.push({ key: `${table}.${c}`, kind: 'column', label: c, table, column: c });
  }
  return rows;
}

/** Toutes les cases d'une ligne pour un groupe. */
export function rowCells(model, row, group, role) {
  if (row.kind === 'structure') return [{ bit: 'S', ...permissionFor(model, { table: '*', bit: 'S', group, role }) }];
  return ACTIONS.map(([bit]) =>
    row.kind === 'column' && (bit === 'C' || bit === 'D')
      ? { bit, state: 'na', labels: [], steps: [] }
      : { bit, ...permissionFor(model, { table: row.table, column: row.column || null, bit, group, role }) },
  );
}

// ---------------------------------------------------------------------------
// Libellés et explications
// ---------------------------------------------------------------------------

/** Texte de la case : OUI, NON, ?, ou les colonnes qui décident (deux au plus, puis « … »). */
export function cellText(cell) {
  if (cell.state === 'allow') return 'Oui';
  if (cell.state === 'deny') return 'Non';
  if (cell.state === 'unknown') return '?';
  if (cell.state === 'na') return '—';
  const l = cell.labels;
  return l.length > 2 ? `${l.slice(0, 2).join(' + ')} + …` : l.join(' + ');
}

/** Couleur : ok (vert), ko (rouge), uk (gris). */
export function cellTone(cell) {
  if (cell.state === 'allow' || cell.state === 'rows-allow') return 'ok';
  if (cell.state === 'deny' || cell.state === 'rows-deny') return 'ko';
  return 'uk';
}

const rowsPhrase = (rows) => rows.map((r) => `son ${r}`).join(' et ');
/** Phrase complète (infobulle et détail). */
export function cellSentence(cell, { attrTable = '' } = {}) {
  const rows = cell.rows || [],
    profile = cell.profile || [];
  const profilePart = profile.length
    ? `${profile.map((p) => `la case ${p}`).join(' et ')} ${profile.length > 1 ? 'doivent être cochées ou renseignées' : 'doit être cochée ou renseignée'}${attrTable ? ` dans ${attrTable}` : ''}`
    : '';
  switch (cell.state) {
    case 'allow':
      return cell.steps?.some((s) => s.effect === 'default') && !cell.steps.some((s) => s.effect === 'decide')
        ? "Oui : aucune règle ne restreint cette action, le droit par défaut d'un éditeur s'applique."
        : 'Oui, sur toutes les lignes.';
    case 'deny':
      return 'Non, sur aucune ligne.';
    case 'unknown': {
      const s = cell.steps?.find((x) => x.effect === 'unknown');
      return `Indéterminé : la condition « ${s?.rule?.formula || '…'} » utilise un attribut inexistant ou une forme non comprise.`;
    }
    case 'na':
      return 'Sans objet pour une colonne.';
    case 'rows-allow':
      if (rows.length + profile.length > 1)
        return `Oui, mais ${rows.length + profile.length} colonnes décident : ${[rows.length ? `la ligne doit appartenir à ${rowsPhrase(rows)}` : '', profilePart].filter(Boolean).join(', et ')}.`;
      return rows.length ? `Oui, seulement sur les lignes de ${rowsPhrase(rows)}.` : `Oui, seulement si ${profilePart}.`;
    case 'rows-deny':
      return rows.length
        ? `Oui, sauf sur les lignes de ${rowsPhrase(rows)}${profilePart ? `, quand ${profilePart}` : ''}.`
        : `Oui, sauf quand ${profilePart}.`;
    default:
      return '';
  }
}

/** Effet d'une règle en clair : « autorise tout », « lire et modifier seulement »… */
export function ruleEffect(rule) {
  const b = rule.bits,
    keys = ['R', 'U', 'C', 'D', 'S'].filter((k) => Object.hasOwn(b, k));
  const on = keys.filter((k) => b[k]),
    off = keys.filter((k) => !b[k]);
  const names = (ks) =>
    ks
      .map((k) => ACTION_LABEL[k].toLowerCase())
      .join(', ')
      .replace(/, ([^,]*)$/, ' et $1');
  const crud = (ks) => ['R', 'U', 'C', 'D'].every((k) => ks.includes(k));
  if (!off.length && crud(on)) return 'autorise tout';
  if (!on.length && crud(off)) return 'refuse tout';
  if (on.length && !off.length) return `autorise ${names(on)}`;
  if (off.length && !on.length) return `refuse ${names(off)}`;
  return `autorise ${names(on)} ; refuse ${names(off)}`;
}

/** Étapes du détail : numéro de règle, effet, condition, badge. */
export function cellSteps(cell, bit) {
  const act = bit === 'S' ? 'la structure' : ACTION_LABEL[bit] || bit;
  return (cell.steps || []).map((s) => {
    if (s.effect === 'default')
      return { title: "Droit par défaut d'un éditeur", condition: "Aucune règle n'a décidé", badge: 'Décide', tone: 'ok', off: false };
    const label = [...(s.rows || []), ...(s.profile || [])].join(' + ');
    const badge = {
      decide: ['Décide', 'ok'],
      skip: ["Ne s'applique pas", ''],
      'off-action': [`Ne porte pas sur ${act}`, ''],
      unknown: ['Indéterminée', ''],
      branch: [s.rows?.length ? `Selon la ligne (${label})` : `Selon le profil (${label})`, 'info'],
    }[s.effect];
    return {
      title: `Règle ${s.rule.id} · ${ruleEffect(s.rule)}`,
      condition: s.rule.formula || 'Tous les autres',
      badge: badge[0],
      tone: badge[1],
      off: s.effect === 'skip' || s.effect === 'off-action',
    };
  });
}

export { ACTION_LABEL };

// ---------------------------------------------------------------------------
// Matrice complète (onglet Accès, rapport Word, export Excel)
// ---------------------------------------------------------------------------

/**
 * Toutes les cases d'un document, calculées une fois.
 * @param {object} acl       { resources, rules } lus dans le document
 * @param {string[]} tableIds tables dans l'ordre du document
 * @param {object} attrData  table de l'attribut du rôle (facultatif, pour « 7 services »)
 */
export function buildMatrix(acl, tableIds, attrData = null) {
  const model = prepareMatrixModel(acl);
  const { role, groups: allGroups } = matrixGroups(model, attrData);
  const rows = matrixRows(model, tableIds);
  const computed = allGroups.map((g) => rows.map((row) => rowCells(model, row, g, role)));
  // Des valeurs que les règles ne distinguent jamais (« Commercial » et « Commerciale », toujours
  // citées ensemble, dans les mêmes conditions) ont les mêmes cases : une seule colonne
  // « Commercial ou Commerciale ». Deux fonctions qui ont seulement les mêmes droits restent séparées.
  const signature = (gi) => JSON.stringify(computed[gi].map((cs) => cs.map((c) => [c.state, c.labels])));
  const together = role ? coMentioned(model, role) : () => false;
  const mergeable = (g) => g.value !== null && !g.subCol;
  const merged = []; // { group, gi (cases de référence), values }
  allGroups.forEach((g, gi) => {
    const same =
      mergeable(g) &&
      merged.find((m) => mergeable(m.group) && m.values.every((v) => together(v, g.value)) && signature(m.gi) === signature(gi));
    if (same) same.values.push(g.value);
    else merged.push({ group: g, gi, values: g.value !== null ? [g.value] : [] });
  });
  const groups = merged.map(({ group, values }) =>
    values.length > 1
      ? {
          ...group,
          key: values.join('|'),
          name: values.join(' ou '),
          sub: `${role.attr}.${role.col} = ${values.map((v) => `« ${v} »`).join(' ou ')} · mêmes droits`,
          values,
        }
      : group,
  );
  const cells = new Map();
  merged.forEach((m, gi) => rows.forEach((row, ri) => computed[m.gi][ri].forEach((c) => cells.set(`${row.key}|${gi}|${c.bit}`, c))));
  return {
    model,
    role,
    groups,
    rows,
    cells,
    hasRules: model.resources.some((g) => g.rules.length),
    tableCount: rows.filter((r) => r.kind === 'table').length,
    cell: (rowKey, gi, bit) => cells.get(`${rowKey}|${gi}|${bit}`),
  };
}

/** Catégorie de la case, pour filtrer : Oui, Non, Sous condition, Sauf exception, Indéterminé, Sans objet. */
export function cellCategory(cell) {
  return (
    { allow: 'Oui', deny: 'Non', 'rows-allow': 'Sous condition', 'rows-deny': 'Sauf exception', unknown: 'Indéterminé', na: 'Sans objet' }[
      cell.state
    ] || ''
  );
}

/** Règle qui tranche : « Règle 7 · refuse tout » ou « Droit par défaut d'un éditeur ». */
export function decisiveRule(cell) {
  const s = (cell.steps || []).find((x) => x.effect === 'decide' || x.effect === 'default');
  if (!s) return '';
  return s.effect === 'default' ? "Droit par défaut d'un éditeur" : `Règle ${s.rule.id} · ${ruleEffect(s.rule)}`;
}

/** Cases indéterminées, regroupées par table et par condition (pour « À vérifier dans Grist »). */
export function unknownCases(mx) {
  const out = new Map();
  for (const row of mx.rows) {
    mx.groups.forEach((g, gi) => {
      for (const [bit] of row.kind === 'structure' ? [['S']] : ACTIONS) {
        const c = mx.cell(row.key, gi, bit);
        if (!c || c.state !== 'unknown') continue;
        const step = c.steps.find((s) => s.effect === 'unknown');
        const formula = step?.rule?.formula || '';
        const key = `${row.key}|${formula}|${c.note || ''}`;
        if (!out.has(key)) out.set(key, { row, formula, note: c.note || '', actions: new Set(), groups: new Set() });
        out.get(key).actions.add(ACTION_LABEL[bit]);
        out.get(key).groups.add(g.name);
      }
    });
  }
  return [...out.values()].map((x) => ({ ...x, actions: [...x.actions], groups: [...x.groups] }));
}
