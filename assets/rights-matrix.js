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
import { columnarToRows } from './converter.js?v=3.5.0';

export const ACTIONS = [['R', 'Lire'], ['U', 'Modifier'], ['C', 'Créer'], ['D', 'Supprimer']];
const ACTION_LABEL = { R: 'Lire', U: 'Modifier', C: 'Créer', D: 'Supprimer', S: 'Structure' };
/** Rôle Grist supposé : éditeur. */
const ACCESS = 'editors';
const BUILTIN_USER = new Set(['Access', 'Email', 'Name', 'UserID', 'UserRef', 'SessionID', 'IsLoggedIn', 'LinkKey', 'Origin', 'ShareRef']);
const NAMED = new Set(['Email', 'Name', 'UserID', 'UserRef', 'SessionID']); // désignent une personne précise
const ROLE_NAMES = /^(r[oô]le|profil|fonction)$/i;

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
    if (/\s/.test(text[p])) { p++; continue; }
    const rest = text.slice(p);
    let m;
    if ((m = /^(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/.exec(rest))) { tokens.push({ type: 'literal', value: m[0].slice(1, -1).replace(/\\(['"\\])/g, '$1') }); p += m[0].length; continue; }
    if ((m = /^-?\d+(?:\.\d+)?/.exec(rest))) { tokens.push({ type: 'literal', value: Number(m[0]) }); p += m[0].length; continue; }
    if ((m = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/.exec(rest))) { tokens.push({ type: 'word', value: m[0] }); p += m[0].length; continue; }
    if ((m = /^(==|!=|<=|>=|[<>()[\],])/.exec(rest))) { tokens.push({ type: 'op', value: m[0] }); p += m[0].length; continue; }
    throw new Error(`Syntaxe hors du sous-ensemble : ${rest.slice(0, 20)}`);
  }
  let at = 0;
  const peek = () => tokens[at]?.value;
  const take = (v) => { if (peek() !== v) throw new Error(`Attendu ${v}`); at++; };
  const atom = () => {
    const t = tokens[at++];
    if (!t) throw new Error('Expression incomplète');
    if (t.type === 'literal') return { type: 'literal', value: t.value };
    if (t.value === '(') { const x = or(); take(')'); return x; }
    if (t.value === '[') {
      const values = [];
      if (peek() !== ']') { values.push(atom()); while (peek() === ',') { at++; values.push(atom()); } }
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
      if (op === 'not') { take('in'); op = 'not in'; }
      if (op === 'is' && peek() === 'not') { at++; op = 'is not'; }
      x = { type: 'compare', op, a: x, b: atom() };
    }
    return x;
  };
  const neg = () => (peek() === 'not' ? (at++, { type: 'not', a: neg() }) : cmp());
  const and = () => { let x = neg(); while (peek() === 'and') { at++; x = { type: 'and', a: x, b: neg() }; } return x; };
  const or = () => { let x = and(); while (peek() === 'or') { at++; x = { type: 'or', a: x, b: and() }; } return x; };
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
const unknown = (source) => sym(COND, { rows: [], profile: [], unknown: true, sources: [source] });

/** Une valeur symbolique ramenée à une condition (contexte booléen). */
function asCond(v) {
  if (!isSym(v)) return Boolean(v);
  if (v.symbolic === COND) return v;
  if (v.symbolic === ROW) return sym(COND, { rows: [lastSegment(v.path)], profile: [], unknown: false, sources: [v.path] });
  if (v.symbolic === USERVAR) return v.named ? false : sym(COND, { rows: [], profile: [v.label], unknown: false, sources: [v.path] });
  return unknown(String(v.path || ''));
}
function mergeCond(a, b) {
  const x = asCond(a), y = asCond(b);
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
 * @param {object} ctx { attributes: Set des attributs définis, roleAttr, roleCol, roleValue }
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
  if (attr === 'Access') return parts.length === 2 ? ACCESS : unknown(path);
  if (attr === 'IsLoggedIn') return parts.length === 2 ? true : unknown(path);
  if (NAMED.has(attr)) return parts.length === 2 ? sym(USERVAR, { path, label: attr, named: true }) : unknown(path);
  if (BUILTIN_USER.has(attr)) return unknown(path); // LinkKey, Origin, ShareRef : hors du sous-ensemble
  if (!ctx.attributes.has(attr)) return unknown(path); // attribut inexistant
  if (!col) return sym(USERVAR, { path, label: attr });
  if (more.length) return sym(USERVAR, { path, label: col });
  if (attr === ctx.roleAttr && col === ctx.roleCol) return ctx.roleValue;
  return sym(USERVAR, { path, label: col });
}

function evalNode(t, ctx) {
  switch (t.type) {
    case 'literal': return t.value;
    case 'path': return resolvePath(t.value, ctx);
    case 'list': {
      const vs = t.values.map((x) => evalNode(x, ctx));
      return vs.some(isSym) ? unknown('liste dynamique') : vs;
    }
    case 'not': {
      const a = evalNode(t.a, ctx);
      if (isSym(a)) { const c = asCond(a); return c === false ? true : c; }
      return !a;
    }
    case 'and': case 'or': {
      const a = evalNode(t.a, ctx), b = evalNode(t.b, ctx);
      const ca = isSym(a) ? asCond(a) : Boolean(a), cb = isSym(b) ? asCond(b) : Boolean(b);
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
    case 'compare': return compare(t.op, evalNode(t.a, ctx), evalNode(t.b, ctx));
    default: return unknown('expression');
  }
}

function compare(op, a, b) {
  const symA = isSym(a), symB = isSym(b);
  if (!symA && !symB) {
    if (op === 'in' || op === 'not in') {
      if (!Array.isArray(b)) return unknown('appartenance hors liste');
      return op === 'in' ? b.includes(a) : !b.includes(a);
    }
    switch (op) {
      case '==': case 'is': return a === b;
      case '!=': case 'is not': return a !== b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      default: return unknown(`comparaison ${op}`);
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
    const u = uservar(a) ? a : b, r = row(a) ? a : b;
    return sym(COND, { rows: [u.label], profile: [], unknown: false, sources: [`${r.path} ~ ${u.path}`] });
  }
  if ([a, b].some((x) => isSym(x) && x.symbolic === COND && x.unknown)) return mergeCond(a, b);
  // Ligne comparée à une constante : selon la ligne (libellé : la colonne de la ligne).
  if ((row(a) && constant(b)) || (row(b) && constant(a)) || (row(a) && row(b))) return mergeCond(row(a) ? a : null, row(b) ? b : null);
  // Critère de profil (user.Habilitation.Manager == True…) : reste variable dans le groupe.
  if ((uservar(a) && constant(b)) || (uservar(b) && constant(a)) || (uservar(a) && uservar(b))) {
    return sym(COND, { rows: [], profile: uniq([a, b].filter(uservar).map((x) => x.label)), unknown: false, sources: [a, b].filter(uservar).map((x) => x.path) });
  }
  return mergeCond(a, b);
}

// ---------------------------------------------------------------------------
// Règles
// ---------------------------------------------------------------------------

/** Bits d'une permission Grist : « +R-CD » → { R: true, C: false, D: false }. */
export function permissionBits(text) {
  const out = {};
  const t = String(text || '').trim();
  if (t === 'all' || t === 'none') { for (const b of 'CRUDS') out[b] = t === 'all'; return out; }
  let value;
  for (const c of t) {
    if (c === '+') value = true;
    else if (c === '-') value = false;
    else if ('CRUDS'.includes(c) && value !== undefined) out[c] = value;
  }
  return out;
}

/** Ressources et règles triées, conditions analysées. */
export function prepareMatrixModel({ resources = [], rules = [] } = {}) {
  const groups = new Map(columnarToRows(resources).map((r) => [r.id, { ...r, colIds: String(r.colIds || ''), rules: [] }]));
  const attributes = [];
  for (const r of columnarToRows(rules)) {
    if (r.userAttributes) { try { const a = JSON.parse(r.userAttributes); if (a?.name) attributes.push(a); } catch { /* ignoré */ } continue; }
    if (!r.permissionsText) continue;
    const g = groups.get(r.resource);
    if (!g) continue;
    let tree = null, parseError = '';
    try { tree = parseCondition(r.aclFormula); } catch (e) { parseError = e.message; }
    g.rules.push({ id: r.id, formula: String(r.aclFormula || ''), permissionsText: r.permissionsText, memo: r.memo || '', rulePos: r.rulePos, bits: permissionBits(r.permissionsText), tree, parseError });
  }
  for (const g of groups.values()) g.rules.sort((a, b) => (a.rulePos ?? Infinity) - (b.rulePos ?? Infinity) || a.id - b.id);
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
      const pairs = [[t.a, t.b], [t.b, t.a]];
      for (const [p, v] of pairs) {
        const m = p?.type === 'path' && /^user\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(p.value);
        if (!m || BUILTIN_USER.has(m[1])) continue;
        const texts = v?.type === 'literal' && typeof v.value === 'string' ? [v.value]
          : v?.type === 'list' ? v.values.filter((x) => x.type === 'literal' && typeof x.value === 'string').map((x) => x.value) : [];
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
  const defined = new Set(model.attributes.map((a) => a.name));
  const candidates = [...found.values()].filter((c) => defined.has(c.attr));
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.values.length - a.values.length) || (Number(ROLE_NAMES.test(b.col)) - Number(ROLE_NAMES.test(a.col))));
  return candidates[0];
}

/** Colonnes de la personne qui filtrent les lignes (« rec.Service == user.Habilitation.Service »). */
export function filteringColumns(model, attr) {
  const out = [];
  const visit = (t) => {
    if (!t || typeof t !== 'object') return;
    if (t.type === 'compare' && ['==', 'is'].includes(t.op)) {
      for (const [p, q] of [[t.a, t.b], [t.b, t.a]]) {
        const m = q?.type === 'path' && new RegExp(`^user\\.${attr}\\.([A-Za-z_]\\w*)$`).exec(q.value);
        if (m && p?.type === 'path' && /^(rec|newRec)\./.test(p.value) && !out.includes(m[1])) out.push(m[1]);
      }
    }
    for (const k of ['a', 'b']) visit(t[k]);
  };
  for (const g of model.resources) for (const r of g.rules) visit(r.tree);
  return out;
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
  const groups = role.values.map((value) => {
    let sub = `${role.attr}.${role.col} = « ${value} »`;
    if (filter && rows.length) {
      const n = new Set(rows.filter((r) => r[role.col] === value).map((r) => r[filter]).filter((x) => x !== null && x !== undefined && x !== '')).size;
      if (n > 1) sub += ` · ${n} ${filter.toLowerCase()}s`;
    }
    return { key: value, name: value, sub, value };
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
  if (table === '*') return [res.filter((g) => g.tableId === '*SPECIAL' && g.colIds === 'SchemaEdit'), res.filter((g) => g.tableId === '*' && g.colIds === '*')];
  const colRes = column ? res.filter((g) => g.tableId === table && g.colIds !== '*' && g.colIds.split(',').map((x) => x.trim()).includes(column)) : [];
  return [colRes, res.filter((g) => g.tableId === table && g.colIds === '*'), res.filter((g) => g.tableId === '*' && g.colIds === '*')];
}

/**
 * Droit d'un groupe pour une action.
 * @returns {{ state: 'allow'|'deny'|'rows-allow'|'rows-deny'|'unknown', labels: string[], steps: Array, decidedBy }}
 */
export function permissionFor(model, { table, column = null, bit, group, role }) {
  const ctx = { attributes: new Set(model.attributes.map((a) => a.name)), roleAttr: role?.attr, roleCol: role?.col, roleValue: group?.value ?? null };
  const ls = layers(model, table, column);
  if (ls.some((l) => l.length > 1)) return { state: 'unknown', labels: [], steps: [], note: 'Plusieurs ressources se recouvrent : à vérifier dans Grist.' };
  const steps = [];
  const branches = []; // { allow, rows, profile }
  let unknownSeen = false, final = null;
  for (const r of ls.flat().flatMap((g) => g.rules)) {
    if (!Object.hasOwn(r.bits, bit)) { steps.push({ rule: r, effect: 'off-action' }); continue; }
    const v = r.tree ? evaluateCondition(r.tree, ctx) : unknown(r.formula);
    if (v === false) { steps.push({ rule: r, effect: 'skip' }); continue; }
    if (v === true) { steps.push({ rule: r, effect: 'decide' }); final = r.bits[bit]; break; }
    if (v.unknown) unknownSeen = true;
    steps.push({ rule: r, effect: v.unknown ? 'unknown' : 'branch', rows: v.rows, profile: v.profile });
    branches.push({ allow: r.bits[bit], rows: v.rows, profile: v.profile });
  }
  if (final === null) { steps.push({ rule: null, effect: 'default' }); final = true; } // éditeur : tout autorisé par défaut
  if (unknownSeen) return { state: 'unknown', labels: [], steps };
  const opposite = branches.filter((b) => b.allow !== final);
  if (!opposite.length) return { state: final ? 'allow' : 'deny', labels: [], steps };
  // Branche la plus large : celle qui demande le moins de colonnes (la première en cas d'égalité).
  const best = opposite.reduce((m, b) => ((b.rows.length + b.profile.length) < (m.rows.length + m.profile.length) ? b : m));
  return { state: final ? 'rows-deny' : 'rows-allow', labels: [...best.rows, ...best.profile], rows: best.rows, profile: best.profile, steps };
}

/** Lignes de la matrice : droits de structure, puis chaque table et, sur demande, ses colonnes à règles. */
export function matrixRows(model, tableIds) {
  const rows = [{ key: '*structure', kind: 'structure', label: 'Droits de structure', sub: 'Tables, colonnes et formules, pour toutes les tables' }];
  for (const table of tableIds) {
    rows.push({ key: table, kind: 'table', label: table, table });
    const cols = [];
    for (const g of model.resources) {
      if (g.tableId !== table || g.colIds === '*' || !g.rules.length) continue;
      for (const c of g.colIds.split(',').map((x) => x.trim()).filter(Boolean)) if (!cols.includes(c)) cols.push(c);
    }
    for (const c of cols) rows.push({ key: `${table}.${c}`, kind: 'column', label: c, table, column: c });
  }
  return rows;
}

/** Toutes les cases d'une ligne pour un groupe. */
export function rowCells(model, row, group, role) {
  if (row.kind === 'structure') return [{ bit: 'S', ...permissionFor(model, { table: '*', bit: 'S', group, role }) }];
  return ACTIONS.map(([bit]) => (row.kind === 'column' && (bit === 'C' || bit === 'D'))
    ? { bit, state: 'na', labels: [], steps: [] }
    : { bit, ...permissionFor(model, { table: row.table, column: row.column || null, bit, group, role }) });
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
  const rows = cell.rows || [], profile = cell.profile || [];
  const profilePart = profile.length ? `${profile.map((p) => `la case ${p}`).join(' et ')} ${profile.length > 1 ? 'doivent être cochées ou renseignées' : 'doit être cochée ou renseignée'}${attrTable ? ` dans ${attrTable}` : ''}` : '';
  switch (cell.state) {
    case 'allow': return cell.steps?.some((s) => s.effect === 'default') && !cell.steps.some((s) => s.effect === 'decide')
      ? 'Oui : aucune règle ne restreint cette action, le droit par défaut d\'un éditeur s\'applique.'
      : 'Oui, sur toutes les lignes.';
    case 'deny': return 'Non, sur aucune ligne.';
    case 'unknown': {
      const s = cell.steps?.find((x) => x.effect === 'unknown');
      return `Indéterminé : la condition « ${s?.rule?.formula || '…'} » utilise un attribut inexistant ou une forme non comprise.`;
    }
    case 'na': return 'Sans objet pour une colonne.';
    case 'rows-allow':
      if (rows.length + profile.length > 1) return `Oui, mais ${rows.length + profile.length} colonnes décident : ${[rows.length ? `la ligne doit appartenir à ${rowsPhrase(rows)}` : '', profilePart].filter(Boolean).join(', et ')}.`;
      return rows.length ? `Oui, seulement sur les lignes de ${rowsPhrase(rows)}.` : `Oui, seulement si ${profilePart}.`;
    case 'rows-deny':
      return rows.length ? `Oui, sauf sur les lignes de ${rowsPhrase(rows)}${profilePart ? `, quand ${profilePart}` : ''}.` : `Oui, sauf quand ${profilePart}.`;
    default: return '';
  }
}

/** Effet d'une règle en clair : « autorise tout », « lire et modifier seulement »… */
export function ruleEffect(rule) {
  const b = rule.bits, keys = ['R', 'U', 'C', 'D', 'S'].filter((k) => Object.hasOwn(b, k));
  const on = keys.filter((k) => b[k]), off = keys.filter((k) => !b[k]);
  const names = (ks) => ks.map((k) => ACTION_LABEL[k].toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' et $1');
  const crud = (ks) => ['R', 'U', 'C', 'D'].every((k) => ks.includes(k));
  if (!off.length && crud(on)) return 'autorise tout';
  if (!on.length && crud(off)) return 'refuse tout';
  if (on.length && !off.length) return `autorise ${names(on)}`;
  if (off.length && !on.length) return `refuse ${names(off)}`;
  return `autorise ${names(on)} ; refuse ${names(off)}`;
}

/** Étapes du détail : numéro de règle, effet, condition, badge. */
export function cellSteps(cell, bit) {
  const act = bit === 'S' ? 'la structure' : (ACTION_LABEL[bit] || bit);
  return (cell.steps || []).map((s) => {
    if (s.effect === 'default') return { title: 'Droit par défaut d\'un éditeur', condition: 'Aucune règle n\'a décidé', badge: 'Décide', tone: 'ok', off: false };
    const label = [...(s.rows || []), ...(s.profile || [])].join(' + ');
    const badge = { decide: ['Décide', 'ok'], skip: ['Ne s\'applique pas', ''], 'off-action': [`Ne porte pas sur ${act}`, ''], unknown: ['Indéterminée', ''], branch: [s.rows?.length ? `Selon la ligne (${label})` : `Selon le profil (${label})`, 'info'] }[s.effect];
    return { title: `Règle ${s.rule.id} · ${ruleEffect(s.rule)}`, condition: s.rule.formula || 'Tous les autres', badge: badge[0], tone: badge[1], off: s.effect === 'skip' || s.effect === 'off-action' };
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
  const { role, groups } = matrixGroups(model, attrData);
  const rows = matrixRows(model, tableIds);
  const cells = new Map();
  for (const row of rows) groups.forEach((g, gi) => rowCells(model, row, g, role).forEach((c) => cells.set(`${row.key}|${gi}|${c.bit}`, c)));
  return {
    model, role, groups, rows, cells,
    hasRules: model.resources.some((g) => g.rules.length),
    tableCount: rows.filter((r) => r.kind === 'table').length,
    cell: (rowKey, gi, bit) => cells.get(`${rowKey}|${gi}|${bit}`),
  };
}

/** Catégorie de la case, pour filtrer : Oui, Non, Sous condition, Sauf exception, Indéterminé, Sans objet. */
export function cellCategory(cell) {
  return { allow: 'Oui', deny: 'Non', 'rows-allow': 'Sous condition', 'rows-deny': 'Sauf exception', unknown: 'Indéterminé', na: 'Sans objet' }[cell.state] || '';
}

/** Règle qui tranche : « Règle 7 · refuse tout » ou « Droit par défaut d'un éditeur ». */
export function decisiveRule(cell) {
  const s = (cell.steps || []).find((x) => x.effect === 'decide' || x.effect === 'default');
  if (!s) return '';
  return s.effect === 'default' ? 'Droit par défaut d\'un éditeur' : `Règle ${s.rule.id} · ${ruleEffect(s.rule)}`;
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

