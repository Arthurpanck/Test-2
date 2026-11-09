/**
 * Modèle des droits d'accès de Grist, partagé par l'onglet Accès (access.js), la matrice
 * « Qui peut faire quoi ? » (rights-matrix.js) et les contrôles (audit-engine.js) :
 *  - lecture des tables `_grist_ACLResources` / `_grist_ACLRules` (ressources, règles, attributs utilisateur) ;
 *  - texte des permissions (« +R-CD », « all », « none ») ;
 *  - analyse des conditions dans un langage fermé, sans exécution (parseCondition), et leur évaluation
 *    pour un groupe de personnes (evaluateCondition) ou pour un rôle de partage (conditionForRole) ;
 *  - droit effectif d'un rôle (effectivePermission), dont les droits de structure des éditeurs.
 * Module pur.
 */
import { columnarToRows } from './util.js';

export const PERMISSIONS = [
  { bit: 'R', label: 'Lire' },
  { bit: 'U', label: 'Modifier' },
  { bit: 'C', label: 'Créer' },
  { bit: 'D', label: 'Supprimer' },
  { bit: 'S', label: 'Structure' },
];
export const PERMISSION_LABEL = Object.fromEntries(PERMISSIONS.map((p) => [p.bit, p.label]));
export const TABLE_BITS = ['R', 'U', 'C', 'D'];
export const COLUMN_BITS = ['R', 'U'];
export const DEFAULT_BITS = ['R', 'U', 'C', 'D', 'S'];

/** Propriétés de `user` qui désignent une personne précise. */
const NAMED = new Set(['Email', 'Name', 'UserID', 'UserRef', 'SessionID']);
/** Propriétés de `user` fournies par Grist. */
export const USER_BUILTINS = new Set([
  'Access',
  'Email',
  'UserID',
  'UserRef',
  'Name',
  'LinkKey',
  'Origin',
  'SessionID',
  'IsLoggedIn',
  'ShareRef',
  'Type',
]);

/** Ordre d'application des règles d'une ressource. */
export const byRulePos = (a, b) => (a.rulePos ?? Infinity) - (b.rulePos ?? Infinity) || a.id - b.id;

/** Texte des permissions (« +R-CD », « all », « none ») → { R: 'allow' | 'deny', … }. */
export function parsePermissions(text) {
  const t = String(text || '').trim();
  const out = {};
  if (t === 'all') {
    for (const p of PERMISSIONS) out[p.bit] = 'allow';
    return out;
  }
  if (t === 'none') {
    for (const p of PERMISSIONS) out[p.bit] = 'deny';
    return out;
  }
  for (const m of t.matchAll(/([+-])([A-Z]+)/g)) {
    for (const bit of m[2]) out[bit] = m[1] === '+' ? 'allow' : 'deny';
  }
  return out;
}

/** Bits d'une permission Grist, en booléens : « +R-CD » → { R: true, C: false, D: false } (C, R, U, D, S seulement). */
export function permissionBits(text) {
  const perms = parsePermissions(text);
  const t = String(text || '').trim();
  const order = t === 'all' || t === 'none' ? [...'CRUDS'] : Object.keys(perms);
  return Object.fromEntries(order.filter((b) => 'CRUDS'.includes(b) && perms[b]).map((b) => [b, perms[b] === 'allow']));
}

/**
 * Lignes des règles d'accès, lues une fois :
 *  - resources : { id, tableId, colIds } (textes) ;
 *  - rules : règles ordinaires, dans l'ordre des lignes (les attributs utilisateur à part) ;
 *  - attributes : attributs utilisateur dans l'ordre d'application, { row, def } (def : le JSON lu).
 */
export function readAcl({ resources = [], rules = [] } = {}) {
  const resourceRows = columnarToRows(resources || []).map((r) => ({
    ...r,
    id: r.id,
    tableId: String(r.tableId || ''),
    colIds: String(r.colIds || ''),
  }));
  const ruleRows = columnarToRows(rules || []);
  const attributes = [];
  for (const r of ruleRows.slice().sort(byRulePos)) {
    if (!r.userAttributes) continue;
    let def;
    try {
      def = JSON.parse(r.userAttributes);
    } catch {
      def = null;
    }
    if (def && def.name) attributes.push({ row: r, def });
  }
  return { resources: resourceRows, rules: ruleRows.filter((r) => !r.userAttributes), attributes };
}

// ---------------------------------------------------------------------------
// Analyse des conditions (langage fermé)
// ---------------------------------------------------------------------------

/** Arbre d'une condition Grist ; lève une erreur si elle sort du sous-ensemble compris. */
export function parseCondition(code) {
  const text = String(code || '');
  if (!text.trim()) return { type: 'literal', value: true };
  const tokens = [];
  let p = 0;
  while (p < text.length) {
    if (/\s/.test(text[p])) {
      p++;
      continue;
    }
    const rest = text.slice(p);
    let m;
    if ((m = /^(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/.exec(rest))) {
      tokens.push({ type: 'literal', value: m[0].slice(1, -1).replace(/\\(['"\\])/g, '$1') });
      p += m[0].length;
      continue;
    }
    if ((m = /^-?\d+(?:\.\d+)?/.exec(rest))) {
      tokens.push({ type: 'literal', value: Number(m[0]) });
      p += m[0].length;
      continue;
    }
    if ((m = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/.exec(rest))) {
      tokens.push({ type: 'word', value: m[0] });
      p += m[0].length;
      continue;
    }
    if ((m = /^(==|!=|<=|>=|[<>()[\],])/.exec(rest))) {
      tokens.push({ type: 'op', value: m[0] });
      p += m[0].length;
      continue;
    }
    throw new Error(`Syntaxe hors du sous-ensemble : ${rest.slice(0, 20)}`);
  }
  let at = 0;
  const peek = () => tokens[at]?.value;
  const take = (v) => {
    if (peek() !== v) throw new Error(`Attendu ${v}`);
    at++;
  };
  const atom = () => {
    const t = tokens[at++];
    if (!t) throw new Error('Expression incomplète');
    if (t.type === 'literal') return { type: 'literal', value: t.value };
    if (t.value === '(') {
      const x = or();
      take(')');
      return x;
    }
    if (t.value === '[') {
      const values = [];
      if (peek() !== ']') {
        values.push(atom());
        while (peek() === ',') {
          at++;
          values.push(atom());
        }
      }
      take(']');
      return { type: 'list', values };
    }
    if (t.type === 'word' && !['and', 'or', 'not', 'in', 'is'].includes(t.value)) return { type: 'path', value: t.value };
    throw new Error('Expression non reconnue');
  };
  const cmp = () => {
    let x = atom();
    let op = peek();
    if (['==', '!=', '<', '>', '<=', '>=', 'in', 'not', 'is'].includes(op)) {
      at++;
      if (op === 'not') {
        take('in');
        op = 'not in';
      }
      if (op === 'is' && peek() === 'not') {
        at++;
        op = 'is not';
      }
      x = { type: 'compare', op, a: x, b: atom() };
    }
    return x;
  };
  const neg = () => (peek() === 'not' ? (at++, { type: 'not', a: neg() }) : cmp());
  const and = () => {
    let x = neg();
    while (peek() === 'and') {
      at++;
      x = { type: 'and', a: x, b: neg() };
    }
    return x;
  };
  const or = () => {
    let x = and();
    while (peek() === 'or') {
      at++;
      x = { type: 'or', a: x, b: and() };
    }
    return x;
  };
  const tree = or();
  if (at !== tokens.length) throw new Error('Fin non reconnue');
  return tree;
}

// Valeurs symboliques : ce que la lecture des règles ne peut pas trancher seule.
const ROW = 'row'; // une valeur de la ligne (rec / newRec)
const USERVAR = 'uservar'; // une caractéristique de la personne qui varie dans le groupe (user.Habilitation.Service, user.Email)
const COND = 'cond'; // une condition variable : { rows: [libellés], profile: [libellés], unknown, sources }
const sym = (kind, extra) => ({ symbolic: kind, ...extra });
const isSym = (x) => Boolean(x && typeof x === 'object' && x.symbolic);
const lastSegment = (path) => String(path).split('.').pop();
const uniq = (a) => [...new Set(a)];
export const unknown = (source) => sym(COND, { rows: [], profile: [], unknown: true, sources: [source] });

/** Une valeur symbolique ramenée à une condition (contexte booléen). */
function asCond(v) {
  if (!isSym(v)) return Boolean(v);
  if (v.symbolic === COND) return v;
  if (v.symbolic === ROW) return sym(COND, { rows: [lastSegment(v.path)], profile: [], unknown: false, sources: [v.path] });
  if (v.symbolic === USERVAR) return v.named ? false : sym(COND, { rows: [], profile: [v.label], unknown: false, sources: [v.path] });
  return unknown(String(v.path || ''));
}
function mergeCond(a, b) {
  const x = asCond(a),
    y = asCond(b);
  const parts = [x, y].filter(isSym);
  const rows = uniq(parts.flatMap((p) => p.rows));
  return sym(COND, {
    rows,
    // « user.Droits.SRH and rec.X == user.Droits.SRH » : la ligne demande déjà le SRH de la personne,
    // le critère de profil sur la même colonne n'ajoute rien (pas de « SRH + SRH »).
    profile: uniq(parts.flatMap((p) => p.profile)).filter((p) => !rows.includes(p)),
    unknown: parts.some((p) => p.unknown),
    sources: uniq(parts.flatMap((p) => p.sources)),
  });
}

/**
 * Évalue une condition pour un groupe.
 * @param {object} ctx { attributes: Set des attributs définis, roleAttr, roleCol, roleValue, subCol, subValue }
 * @returns true, false, ou une condition variable { symbolic: 'cond', rows, profile, unknown }
 */
export function evaluateCondition(tree, ctx) {
  const v = evalNode(tree, ctx);
  return isSym(v) ? asCond(v) : Boolean(v);
}

function resolvePath(path, ctx) {
  const constants = { OWNER: 'owners', EDITOR: 'editors', VIEWER: 'viewers', True: true, False: false, None: null };
  if (Object.hasOwn(constants, path)) return constants[path];
  const parts = path.split('.');
  if (parts[0] === 'rec' || parts[0] === 'newRec') return parts.length > 1 ? sym(ROW, { path }) : unknown(path);
  if (parts[0] !== 'user' || parts.length < 2) return unknown(path);
  const [, attr, col, ...more] = parts;
  if (attr === 'Access') return parts.length === 2 ? (ctx.access ?? 'editors') : unknown(path);
  if (attr === 'IsLoggedIn') return parts.length === 2 ? true : unknown(path);
  if (NAMED.has(attr)) return parts.length === 2 ? sym(USERVAR, { path, label: attr, named: true }) : unknown(path);
  if (USER_BUILTINS.has(attr)) return unknown(path); // LinkKey, Origin, ShareRef : hors du sous-ensemble
  if (!ctx.attributes.has(attr)) return unknown(path); // attribut inexistant
  if (!col) return sym(USERVAR, { path, label: attr });
  if (more.length) return sym(USERVAR, { path, label: col });
  if (attr === ctx.roleAttr && col === ctx.roleCol) return ctx.roleValue;
  // Sous-rôle du groupe (« Pole » pour « Manager · Pole RH ») : sa valeur est connue aussi.
  if (attr === ctx.roleAttr && ctx.subCol && col === ctx.subCol && ctx.subValue !== undefined) return ctx.subValue;
  return sym(USERVAR, { path, label: col });
}

function evalNode(t, ctx) {
  switch (t.type) {
    case 'literal':
      return t.value;
    case 'path':
      return resolvePath(t.value, ctx);
    case 'list': {
      const vs = t.values.map((x) => evalNode(x, ctx));
      return vs.some(isSym) ? unknown('liste dynamique') : vs;
    }
    case 'not': {
      const a = evalNode(t.a, ctx);
      if (isSym(a)) {
        const c = asCond(a);
        return c === false ? true : c;
      }
      return !a;
    }
    case 'and':
    case 'or': {
      const a = evalNode(t.a, ctx),
        b = evalNode(t.b, ctx);
      const ca = isSym(a) ? asCond(a) : Boolean(a),
        cb = isSym(b) ? asCond(b) : Boolean(b);
      if (t.type === 'and') {
        if (ca === false || cb === false) return false;
        if (ca === true) return cb;
        if (cb === true) return ca;
        return mergeCond(ca, cb);
      }
      if (ca === true || cb === true) return true;
      if (ca === false) return cb;
      if (cb === false) return ca;
      return mergeCond(ca, cb);
    }
    case 'compare':
      return compare(t.op, evalNode(t.a, ctx), evalNode(t.b, ctx));
    default:
      return unknown('expression');
  }
}

function compare(op, a, b) {
  const symA = isSym(a),
    symB = isSym(b);
  if (!symA && !symB) {
    if (op === 'in' || op === 'not in') {
      if (!Array.isArray(b)) return unknown('appartenance hors liste');
      return op === 'in' ? b.includes(a) : !b.includes(a);
    }
    switch (op) {
      case '==':
      case 'is':
        return a === b;
      case '!=':
      case 'is not':
        return a !== b;
      case '<':
        return a < b;
      case '<=':
        return a <= b;
      case '>':
        return a > b;
      case '>=':
        return a >= b;
      default:
        return unknown(`comparaison ${op}`);
    }
  }
  const named = (x) => isSym(x) && x.symbolic === USERVAR && x.named;
  const constant = (x) => !isSym(x);
  // Personne nommée (« user.Email == 'adresse' ») : faux pour tous les groupes, la case montre le cas général.
  if ((named(a) && constant(b)) || (named(b) && constant(a))) return ['!=', 'is not', 'not in'].includes(op);
  const row = (x) => isSym(x) && x.symbolic === ROW;
  const uservar = (x) => isSym(x) && x.symbolic === USERVAR;
  // Ligne comparée à la personne : droit limité aux lignes de la personne (libellé côté user).
  if ((row(a) && uservar(b)) || (row(b) && uservar(a))) {
    const u = uservar(a) ? a : b,
      r = row(a) ? a : b;
    return sym(COND, { rows: [u.label], profile: [], unknown: false, sources: [`${r.path} ~ ${u.path}`] });
  }
  if ([a, b].some((x) => isSym(x) && x.symbolic === COND && x.unknown)) return mergeCond(a, b);
  // Ligne comparée à une constante : selon la ligne (libellé : la colonne de la ligne).
  if ((row(a) && constant(b)) || (row(b) && constant(a)) || (row(a) && row(b))) return mergeCond(row(a) ? a : null, row(b) ? b : null);
  // Critère de profil (user.Habilitation.Manager == True…) : reste variable dans le groupe.
  if ((uservar(a) && constant(b)) || (uservar(b) && constant(a)) || (uservar(a) && uservar(b))) {
    return sym(COND, {
      rows: [],
      profile: uniq([a, b].filter(uservar).map((x) => x.label)),
      unknown: false,
      sources: [a, b].filter(uservar).map((x) => x.path),
    });
  }
  return mergeCond(a, b);
}

// ---------------------------------------------------------------------------
// Droit d'un rôle de partage (propriétaire, éditeur, lecteur)
// ---------------------------------------------------------------------------

const ROLE_CONSTANTS = new Set(['OWNER', 'EDITOR', 'VIEWER']);
/** Évalue une condition qui ne parle que du rôle de partage ; lève une erreur pour tout le reste. */
function evalRole(t, role) {
  const bool = (v) => {
    if (typeof v !== 'boolean') throw new Error('non booléen');
    return v;
  };
  switch (t.type) {
    case 'path':
      if (t.value === 'user.Access') return role;
      if (ROLE_CONSTANTS.has(t.value)) return t.value;
      if (t.value === 'True') return true;
      if (t.value === 'False') return false;
      throw new Error('hors du rôle');
    case 'list':
      return t.values.map((v) => evalRole(v, role));
    case 'not':
      return !bool(evalRole(t.a, role));
    case 'and': {
      const a = bool(evalRole(t.a, role)),
        b = bool(evalRole(t.b, role));
      return a && b;
    }
    case 'or': {
      const a = bool(evalRole(t.a, role)),
        b = bool(evalRole(t.b, role));
      return a || b;
    }
    case 'compare': {
      const a = evalRole(t.a, role),
        b = evalRole(t.b, role);
      if (t.op === '==') return a === b;
      if (t.op === '!=') return a !== b;
      if ((t.op === 'in' || t.op === 'not in') && Array.isArray(b)) return t.op === 'in' ? b.includes(a) : !b.includes(a);
      throw new Error('comparaison hors du rôle');
    }
    default:
      throw new Error('hors du rôle');
  }
}

/**
 * Condition évaluée pour un rôle de partage (OWNER, EDITOR, VIEWER) : true, false, ou null si elle
 * dépend d'autre chose que du rôle (personne, ligne, attribut) ou sort du langage compris.
 */
export function conditionForRole(formula, role) {
  const f = String(formula || '').trim();
  if (!f) return true;
  try {
    const v = evalRole(parseCondition(f), role);
    return typeof v === 'boolean' ? v : null;
  } catch {
    return null;
  }
}

/** Première règle qui décide (`bit`) pour le rôle ; null si une règle incertaine la précède, undefined si aucune. */
function ruleDecision(rules, role, bit) {
  let uncertain = false;
  for (const r of rules || []) {
    if (!r.perms?.[bit]) continue;
    const c = conditionForRole(r.formula, role);
    if (c === null) {
      uncertain = true;
      continue;
    }
    if (c) return uncertain ? null : r.perms[bit];
  }
  return uncertain ? null : undefined;
}

/**
 * Droit effectif d'un rôle de partage sur une table (ou une colonne), à partir de buildAccess() :
 * règles de la colonne, puis de la table, puis du document (droits de structure : l'ancien réglage
 * spécial « SchemaEdit » d'abord). 'allow', 'deny', ou null si une condition ne se lit pas.
 */
export function effectivePermission(access, table, col, role, bit) {
  if (!access) return null;
  const t = access.tables?.find((x) => x.tableId === table);
  const legacySchema = table === '*' && bit === 'S' ? (access.special || []).filter((s) => s.id === 'SchemaEdit').map((s) => s.rules) : [];
  const groups = [
    ...(col ? (t?.columns || []).filter((c) => c.colIds.includes(col)).map((c) => c.rules) : []),
    ...legacySchema,
    t?.rules || [],
    access.defaults || [],
  ];
  for (const rs of groups) {
    const d = ruleDecision(rs, role, bit);
    if (d !== undefined) return d;
  }
  return bit === 'R' || role === 'OWNER' || role === 'EDITOR' ? 'allow' : 'deny';
}

/** Les éditeurs peuvent-ils modifier la structure (et écrire des formules) ? 'allow', 'deny' ou null (selon la personne). */
export const editorsStructure = (access) => effectivePermission(access, '*', null, 'EDITOR', 'S');

/**
 * Droits des propriétaires (rôle de partage OWNER) sur chaque table protégée et chaque groupe de
 * colonnes : les règles de la colonne, puis de la table, puis du document, comme Grist les applique.
 * Une condition qui ne dépend pas du rôle (« Habilitation.Fonction == 'RH' ») peut viser ou non un
 * propriétaire : si elle autorise, on poursuit (le propriétaire n'en fait peut-être pas partie) ; si
 * elle refuse, le refus reste possible.
 * @returns {{ gaps: Array<{ table, cols: string[]|null, bits: Array<{ bit, state: 'deny'|'unless'|'maybe' }> }>,
 *             ownerRule: { defaults: boolean, tables: string[] } }}
 *   state : deny (refusé), unless (refusé sauf si l'habilitation du propriétaire le permet), maybe (peut être refusé)
 */
export function ownerAccess(access) {
  const decide = (groups, bit) => {
    let uncertainAllow = false,
      uncertainDeny = false;
    for (const rules of groups)
      for (const r of rules) {
        const p = r.perms?.[bit];
        if (!p) continue;
        const c = conditionForRole(r.formula, 'OWNER');
        if (c === false) continue;
        if (c === null) {
          if (p === 'allow') uncertainAllow = true;
          else uncertainDeny = true;
          continue;
        }
        if (p === 'deny') return uncertainAllow ? 'unless' : 'deny';
        return uncertainDeny ? 'maybe' : 'allow';
      }
    return uncertainDeny ? 'maybe' : 'allow'; // règle intégrée : les propriétaires ont tout
  };
  const gaps = [];
  const check = (table, cols, groups, bits) => {
    const res = bits.map((bit) => ({ bit, state: decide(groups, bit) })).filter((x) => x.state !== 'allow');
    if (res.length) gaps.push({ table, cols, bits: res });
  };
  for (const t of access.tables || []) {
    check(t.tableId, null, [t.rules, access.defaults || []], TABLE_BITS);
    for (const c of t.columns) check(t.tableId, c.colIds, [c.rules, t.rules, access.defaults || []], COLUMN_BITS);
  }
  // Une règle « tout autoriser » propre aux propriétaires (user.Access == OWNER → all)
  const isOwnerRule = (r) =>
    conditionForRole(r.formula, 'OWNER') === true &&
    conditionForRole(r.formula, 'EDITOR') === false &&
    TABLE_BITS.every((b) => r.perms?.[b] === 'allow');
  return {
    gaps,
    ownerRule: {
      defaults: (access.defaults || []).some(isOwnerRule),
      tables: (access.tables || []).filter((t) => t.rules.some(isOwnerRule)).map((t) => t.tableId),
    },
  };
}
