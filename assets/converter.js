/**
 * Conversion de la structure d'un document Grist en DBML.
 *
 * Deux moteurs cohabitent :
 *  - « strict »  : portage fidèle, ligne à ligne, de la formule Python du document
 *                  « Conversion-DBML » (elle-même basée sur grist-db-parser d'Arnaud Robin).
 *                  La sortie est identique à l'octet près, défauts compris.
 *  - « corrigé » : lecture structurée (métadonnées du document ou code analysé par
 *                  indentation) qui corrige les défauts connus de la formule d'origine.
 *
 * Le module est sans dépendance et fonctionne dans le navigateur comme sous Node.
 */

// ---------------------------------------------------------------------------
// Compatibilité Python
// ---------------------------------------------------------------------------

/** Équivalent de `\w` en Python 3 (classes Unicode L* et N*, plus `_`). */
const W = '[\\p{L}\\p{N}_]';

/** Caractères retirés par `str.strip()` en Python (différent de `String.trim()`). */
const PY_WHITESPACE = new Set([
  '\t', '\n', '\v', '\f', '\r', '\x1c', '\x1d', '\x1e', '\x1f', ' ', '\x85', '\xa0',
  ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ',
  ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　',
]);

export function pyStrip(s) {
  let a = 0;
  let b = s.length;
  while (a < b && PY_WHITESPACE.has(s[a])) a++;
  while (b > a && PY_WHITESPACE.has(s[b - 1])) b--;
  return s.slice(a, b);
}

/** repr() Python d'une chaîne (suffisant pour des identifiants et des textes simples). */
export function pyReprStr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of s) {
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += '\\' + quote;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return quote + out + quote;
}

/** Erreur que la formule Python d'origine lèverait sur la même entrée. */
export class PythonFormulaError extends Error {
  constructor(pyType, pyMessage, line) {
    super(`${pyType}: ${pyMessage}`);
    this.name = 'PythonFormulaError';
    this.pyType = pyType;
    this.pyMessage = pyMessage;
    this.line = line;
  }
}

// ---------------------------------------------------------------------------
// Moteur strict : portage exact de la formule d'origine
// ---------------------------------------------------------------------------

const RE_CLASS = new RegExp(`class (${W}+):`, 'u');
const RE_FIELD = new RegExp(`(${W}+) = grist\\.(${W}+)`, 'u');
const RE_FORMULA = new RegExp(`def (?!_default_|gristHelper_)(${W}+)`, 'u');
// En Python, `.` capture tout sauf `\n` (y compris `\r`) : on l'écrit donc `[^\n]`.
const RE_FORMULA_TYPE = /grist[^\n]formulaType\(grist\.([^\n]+)\)/u;
const RE_REF_TABLE = new RegExp(`'(${W}+)'`, 'u');

const DEFAULT_FORMULA_TYPE = '"formula[default]"';

/** Portage exact de `convert_type(grist_type, formula=False)`. */
export function convertTypeStrict(gristType, formula = false) {
  let baseType;
  let refInfo; // `undefined` ⇔ absent de locals() en Python
  if (gristType.includes('Text')) {
    baseType = 'varchar';
  } else if (gristType.includes('Int')) {
    baseType = 'integer';
  } else if (gristType.includes('Numeric')) {
    baseType = 'numeric';
  } else if (gristType.includes('Date')) {
    baseType = 'date';
  } else if (gristType.includes('ChoiceList')) {
    baseType = 'multiple_choice';
  } else if (gristType.includes('Choice')) {
    baseType = 'single_choice';
  } else if (gristType.includes('Reference')) {
    const refTable = RE_REF_TABLE.exec(gristType);
    if (gristType.includes('ReferenceList')) {
      refInfo = refTable ? `[ref: <> ${refTable[1]}.id]` : '';
      baseType = 'integer_list';
    } else {
      refInfo = refTable ? `[ref: > ${refTable[1]}.id]` : '';
      baseType = 'integer';
    }
  } else if (gristType.includes('Attachments')) {
    baseType = 'file';
  } else {
    baseType = 'varchar';
  }

  let finalType = baseType;
  if (formula) finalType = `"formula[${baseType}]"`;
  if (refInfo !== undefined) return finalType + ' ' + refInfo;
  return finalType;
}

/**
 * Portage exact de `parse_grist_code(grist_content)` (partie analyse).
 * Retourne une Map ordonnée : nom de table → [{ name, type, raw, line, isFormula }].
 * Lève PythonFormulaError dans les cas où la formule Python échouerait.
 */
export function parseGristCodeStrict(content) {
  const tables = new Map();
  const tableLines = new Map();
  let currentClass = null;
  let currentFormulaType = DEFAULT_FORMULA_TYPE;
  let currentFormulaRaw = null;

  const lines = String(content).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const classMatch = RE_CLASS.exec(line);
    const fieldMatch = RE_FIELD.exec(line);
    const formulaMatch = RE_FORMULA.exec(line);
    const formulaTypeMatch = RE_FORMULA_TYPE.exec(line);

    if (formulaMatch) {
      const fieldName = formulaMatch[1];
      if (currentClass === null || !tables.has(currentClass)) {
        throw new PythonFormulaError('KeyError', currentClass === null ? 'None' : pyReprStr(currentClass), i + 1);
      }
      tables.get(currentClass).push({
        name: fieldName, type: currentFormulaType, raw: currentFormulaRaw, line: i + 1, isFormula: true,
      });
      currentFormulaType = DEFAULT_FORMULA_TYPE;
      currentFormulaRaw = null;
    } else if (formulaTypeMatch) {
      currentFormulaType = convertTypeStrict(formulaTypeMatch[1], true);
      currentFormulaRaw = formulaTypeMatch[1];
    } else if (classMatch) {
      const newClass = classMatch[1];
      if (newClass === '_Summary') {
        if (currentClass === null) {
          throw new PythonFormulaError('TypeError',
            "unsupported operand type(s) for +=: 'NoneType' and 'str'", i + 1);
        }
        currentClass += '_Summary';
      } else {
        currentClass = newClass;
      }
      tables.set(currentClass, []);
      tableLines.set(currentClass, i + 1);
    } else if (fieldMatch && currentClass) {
      const eq = line.indexOf('=');
      const fieldName = pyStrip(line.slice(0, eq));
      const gristType = pyStrip(line.slice(eq + 1));
      tables.get(currentClass).push({
        name: fieldName, type: convertTypeStrict(gristType), raw: gristType, line: i + 1, isFormula: false,
      });
    }
  }
  return { tables, tableLines };
}

// ---------------------------------------------------------------------------
// Modèle de sortie commun et rendu DBML
// ---------------------------------------------------------------------------

const RE_DBML_TYPE = /^(?:"formula\[([^\]]*)\]"|(\S+))(?: \[ref: (<>|>) ([^\s\]]+)\.id\])?\s*$/;

/** Décompose un type DBML produit par ce module (pour l'aperçu, le schéma et l'analyse). */
export function describeDbmlType(dbmlType) {
  const m = RE_DBML_TYPE.exec(dbmlType);
  if (!m) return { base: dbmlType.trim(), isFormula: false, ref: null };
  const isFormula = m[1] !== undefined;
  return {
    base: isFormula ? m[1] : m[2],
    isFormula,
    ref: m[3] ? { kind: m[3], table: m[4], column: 'id' } : null,
  };
}

function toOutputColumn(name, dbmlType, extra = {}) {
  const d = describeDbmlType(dbmlType);
  return { name, dbmlType, base: d.base, isFormula: d.isFormula, ref: d.ref, ...extra };
}

/** Rendu DBML, identique au bloc « Generating DBML output » de la formule d'origine. */
export function renderDbml(outputTables) {
  const out = [];
  for (const table of outputTables) {
    out.push(`Table ${table.name} {`);
    out.push('  id integer [primary key]');
    for (const col of table.columns) out.push(`  ${col.name} ${col.dbmlType}`);
    out.push('}\n');
  }
  return out.join('\n');
}

/** Conversion stricte : texte de la Vue du code → résultat complet. */
export function convertCodeStrict(content) {
  const { tables, tableLines } = parseGristCodeStrict(content);
  const outputTables = [];
  for (const [name, fields] of tables) {
    outputTables.push({
      name,
      line: tableLines.get(name),
      kind: name.endsWith('_Summary') ? 'summary' : 'table',
      columns: fields.map((f) => toOutputColumn(f.name, f.type, { line: f.line, raw: f.raw, sourceIsFormula: f.isFormula })),
    });
  }
  return { tables: outputTables, dbml: renderDbml(outputTables) };
}

// ---------------------------------------------------------------------------
// Types Grist
// ---------------------------------------------------------------------------

/** Analyse une expression `grist.Type('arg', reverse_of='col')`. */
export function parseGristTypeExpr(expr) {
  const text = String(expr).trim();
  const m = /^grist\.([A-Za-z_]\w*)\(([\s\S]*)\)$/.exec(text);
  if (!m) return { name: 'Unknown', arg: null, reverse: null, raw: text };
  const args = m[2];
  const first = /^\s*'((?:[^'\\]|\\.)*)'/.exec(args) || /^\s*"((?:[^"\\]|\\.)*)"/.exec(args);
  const rev = /reverse_of\s*=\s*['"]((?:[^'"\\]|\\.)*)['"]/.exec(args);
  return {
    name: m[1],
    arg: first ? first[1].replace(/\\(.)/g, '$1') : null,
    reverse: rev ? rev[1] : null,
    raw: text,
  };
}

/** Type de colonne des métadonnées (`Ref:Table`) → description structurée. */
export function gristTypeFromColType(colType, reverseColId = null) {
  const s = String(colType || 'Any');
  const idx = s.indexOf(':');
  let name = idx >= 0 ? s.slice(0, idx) : s;
  const arg = idx >= 0 ? pyStrip(s.slice(idx + 1)) : '';
  if (name === 'Ref') name = 'Reference';
  else if (name === 'RefList') name = 'ReferenceList';
  const isRef = name === 'Reference' || name === 'ReferenceList';
  return { name, arg: arg || null, reverse: isRef ? reverseColId || null : null, raw: getGristTypeCode(colType, reverseColId) };
}

/** Portage de `get_grist_type()` de gencode.py : `Ref:Table` → `grist.Reference('Table')`. */
export function getGristTypeCode(colType, reverseColId = null) {
  const s = String(colType);
  const idx = s.indexOf(':');
  let typename = idx >= 0 ? s.slice(0, idx) : s;
  if (typename === 'Ref') typename = 'Reference';
  else if (typename === 'RefList') typename = 'ReferenceList';
  let arg = idx >= 0 ? s.slice(idx + 1) : '';
  arg = pyStrip(arg).replace(/'/g, "\\'");
  const args = [];
  if (arg) args.push(`'${arg}'`);
  if (reverseColId && (typename === 'Reference' || typename === 'ReferenceList')) {
    args.push('reverse_of=' + pyReprStr(reverseColId));
  }
  return `grist.${typename}(${args.join(', ')})`;
}

const CORRECTED_BASE = {
  Text: 'varchar',
  Int: 'integer',
  Numeric: 'numeric',
  Date: 'date',
  DateTime: 'timestamp',
  Bool: 'boolean',
  Choice: 'single_choice',
  ChoiceList: 'multiple_choice',
  Reference: 'integer',
  ReferenceList: 'integer_list',
  Attachments: 'file',
  Id: 'integer',
  PositionNumber: 'numeric',
  ManualSortPos: 'numeric',
};

/** Conversion corrigée d'un type Grist structuré en type DBML. */
export function convertTypeCorrected(gristType, isFormula) {
  const name = gristType ? gristType.name : 'Any';
  if (isFormula && name === 'Any') return DEFAULT_FORMULA_TYPE;
  const base = CORRECTED_BASE[name] || 'varchar';
  let ref = '';
  if (name === 'Reference' && gristType.arg) ref = ` [ref: > ${gristType.arg}.id]`;
  if (name === 'ReferenceList' && gristType.arg) ref = ` [ref: <> ${gristType.arg}.id]`;
  return (isFormula ? `"formula[${base}]"` : base) + ref;
}

// ---------------------------------------------------------------------------
// Métadonnées du document → schéma (portage de schema.py / gencode.py)
// ---------------------------------------------------------------------------

/** Données colonnaires renvoyées par `grist.docApi.fetchTable()` → tableau de lignes. */
export function columnarToRows(data) {
  if (Array.isArray(data)) return data;
  const keys = Object.keys(data || {});
  const n = keys.length ? data[keys[0]].length : 0;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = {};
    for (const k of keys) row[k] = data[k][i];
    rows.push(row);
  }
  return rows;
}

/** Portage de `build_schema()` : colonnes triées par (table, position). */
export function schemaFromMetadata(metaTables, metaColumns) {
  const tables = columnarToRows(metaTables).slice().sort((a, b) => a.id - b.id);
  const cols = columnarToRows(metaColumns);
  const colIdByRef = new Map(cols.map((c) => [c.id, c.colId]));
  const sorted = cols.slice().sort((a, b) => (a.parentId - b.parentId) || (a.parentPos - b.parentPos));
  const byTable = new Map();
  for (const c of sorted) {
    if (!byTable.has(c.parentId)) byTable.set(c.parentId, []);
    byTable.get(c.parentId).push(c);
  }
  const schema = new Map();
  for (const t of tables) {
    const columns = new Map();
    for (const c of byTable.get(t.id) || []) {
      columns.set(c.colId, {
        colId: c.colId,
        type: c.type || 'Any',
        isFormula: Boolean(c.isFormula),
        formula: c.formula || '',
        reverseColId: colIdByRef.get(c.reverseCol || 0) || null,
        label: c.label || '',
        description: c.description || '',
      });
    }
    schema.set(t.tableId, { tableId: t.tableId, columns, summarySourceTable: t.summarySourceTable || 0 });
  }
  return schema;
}

/** Portage de `summary.decode_summary_table_name()`. */
export function decodeSummaryTableName(tableInfo) {
  const group = tableInfo.columns.get('group');
  if (group && String(group.formula).includes('getSummarySourceGroup') && String(group.type).startsWith('RefList:')) {
    return group.type.slice(8);
  }
  return null;
}

/** Portage de `column.is_visible_column()`. */
export function isVisibleColumn(colId) {
  return colId !== 'id' && colId !== 'manualSort' && !colId.startsWith('#') && !colId.startsWith('gristHelper_');
}

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Tables visibles dans la Vue du code, dans le même ordre que Grist. */
function userViewTables(schema) {
  const summaries = new Map();
  for (const t of schema.values()) {
    const src = decodeSummaryTableName(t);
    if (src) {
      if (!summaries.has(src)) summaries.set(src, []);
      summaries.get(src).push(t);
    }
  }
  const result = [];
  for (const t of [...schema.values()].sort((a, b) => byCodePoint(a.tableId, b.tableId))) {
    if (t.tableId.startsWith('_grist_') || decodeSummaryTableName(t)) continue;
    const columns = [...t.columns.values()]
      .map((c, i) => [c, i])
      .sort((a, b) => (Number(a[0].isFormula) - Number(b[0].isFormula)) || (a[1] - b[1]))
      .map(([c]) => c)
      .filter((c) => isVisibleColumn(c.colId));
    const sums = summaries.get(t.tableId);
    let summaryFormulas = null;
    if (sums && sums.length) {
      summaryFormulas = new Map();
      for (const s of sums) for (const c of s.columns.values()) if (c.isFormula) summaryFormulas.set(c.colId, c);
    }
    result.push({ tableId: t.tableId, columns, summaryFormulas });
  }
  return result;
}

// --- Reconstitution du corps des formules (affichage de la Vue du code) ---

const TYPE_DEFAULTS = {
  Any: 'None', Attachments: 'None', Blob: 'None', Bool: 'False', Choice: "''", ChoiceList: 'None',
  Date: 'None', DateTime: 'None', Id: '0', Int: '0', ManualSortPos: 'inf', Numeric: '0.0',
  PositionNumber: 'inf', Ref: '0', RefList: 'None', Text: "''",
};

function dedent(text) {
  const stripped = text.replace(/^[ \t]+$/gm, '');
  const indents = [...stripped.matchAll(/(^[ \t]*)(?:[^ \t\n])/gm)].map((m) => m[1]);
  if (!indents.length) return text;
  let prefix = indents[0];
  for (const ind of indents) {
    let k = 0;
    while (k < prefix.length && k < ind.length && prefix[k] === ind[k]) k++;
    prefix = prefix.slice(0, k);
  }
  if (!prefix) return text;
  return text.split('\n').map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l)).join('\n');
}

/** Remplace `$col` par `rec.col` hors chaînes et commentaires. */
function replaceDollars(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '#') {
      const end = code.indexOf('\n', i);
      const stop = end < 0 ? code.length : end;
      out += code.slice(i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'") {
      const triple = code.slice(i, i + 3) === ch.repeat(3);
      const q = triple ? ch.repeat(3) : ch;
      let j = i + q.length;
      while (j < code.length) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code.startsWith(q, j)) { j += q.length; break; }
        if (!triple && code[j] === '\n') break;
        j++;
      }
      out += code.slice(i, j);
      i = j;
    } else if (ch === '$' && /[A-Za-z_]/.test(code[i + 1] || '')) {
      out += 'rec.';
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const STATEMENT_KEYWORDS = /^(return|if|elif|else|for|while|try|except|finally|with|def|class|import|from|raise|pass|break|continue|global|nonlocal|assert|del|async|match|case|@)\b/;
const ASSIGNMENT = /^[A-Za-z_][\w.]*(\s*\[[^\]]*\])*\s*(:[^=]+)?(\+|-|\*|\/|\/\/|%|\*\*|>>|<<|&|\^|\|)?=(?!=)/;

/** Insère `return` devant la dernière expression, comme Grist (heuristique d'affichage). */
function insertReturn(code) {
  const lines = code.split('\n');
  let depth = 0;
  let inTriple = null;
  let lastStart = -1;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const startsStatement = depth === 0 && !inTriple && /^\S/.test(line) && !line.startsWith('#');
    if (startsStatement && !(li > 0 && /\\\s*$/.test(lines[li - 1]))) lastStart = li;
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (inTriple) {
        if (line.startsWith(inTriple, k)) { k += 2; inTriple = null; }
        continue;
      }
      if (c === '#') break;
      if (c === '"' || c === "'") {
        if (line.startsWith(c.repeat(3), k)) { inTriple = c.repeat(3); k += 2; continue; }
        let j = k + 1;
        while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
        k = j;
        continue;
      }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    }
  }
  if (lastStart < 0) return code + '\npass';
  const stmt = lines[lastStart];
  if (STATEMENT_KEYWORDS.test(stmt) || ASSIGNMENT.test(stmt)) return code;
  lines[lastStart] = 'return ' + stmt;
  return lines.join('\n');
}

function makeFormulaBody(formula, colType, indent) {
  let body;
  if (!pyStrip(formula || '')) {
    body = 'return ' + (TYPE_DEFAULTS[String(colType).split(':')[0]] ?? 'None');
  } else {
    body = insertReturn(replaceDollars(dedent(formula)));
  }
  return body.replace(/^(?=.*\S)/gm, indent);
}

function makeFormulaField(col, { name, includeType = true, params = [], indent }) {
  const decl = `${indent}def ${name || col.colId}(${['rec', 'table', ...params].join(', ')}):\n`;
  const decorator = includeType && col.type !== 'Any'
    ? `${indent}@grist.formulaType(${getGristTypeCode(col.type, col.reverseColId)})\n`
    : '';
  return '\n' + decorator + decl + makeFormulaBody(col.formula, col.type, '  ' + indent) + '\n';
}

function makeField(col, indent) {
  if (col.isFormula) return makeFormulaField(col, { indent });
  let out = '';
  if (col.formula) {
    out += makeFormulaField(col, { name: '_default_' + col.colId, includeType: false, params: ['value', 'user'], indent });
  }
  return out + `${indent}${col.colId} = ${getGristTypeCode(col.type, col.reverseColId)}\n`;
}

export const CODE_VIEW_HEADER = 'import grist\n'
  + 'from functions import *       # global uppercase functions\n'
  + 'import datetime, math, re     # modules commonly needed in formulas\n';

/**
 * Reconstitue le texte de la « Vue du code » de Grist à partir des métadonnées
 * (portage de GenCode.make_module, partie utilisateur). Les corps de formules sont
 * reproduits de façon approchée ; ils n'influencent pas la conversion hors cas limites.
 */
export function generateCodeView(schema) {
  const parts = [CODE_VIEW_HEADER];
  for (const t of userViewTables(schema)) {
    const tparts = [`@grist.UserTable\nclass ${t.tableId}:\n`];
    for (const c of t.columns) tparts.push(makeField(c, '  '));
    if (t.summaryFormulas) {
      tparts.push('\n  class _Summary:\n');
      for (const c of t.summaryFormulas.values()) tparts.push(makeField(c, '    '));
    }
    if (tparts.length === 1) tparts.push('  pass');
    parts.push('\n\n', tparts.join(''));
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Moteur corrigé
// ---------------------------------------------------------------------------

/** Modèle structuré depuis le schéma du document (mode « Ce document »). */
export function modelFromSchema(schema) {
  const tables = [];
  for (const t of userViewTables(schema)) {
    tables.push({
      name: t.tableId,
      kind: 'table',
      columns: t.columns.map((c) => ({
        name: c.colId, isFormula: c.isFormula, gristType: gristTypeFromColType(c.type, c.reverseColId),
        label: c.label, description: c.description,
      })),
    });
    if (t.summaryFormulas) {
      tables.push({
        name: t.tableId + '_Summary',
        kind: 'summary',
        source: t.tableId,
        columns: [...t.summaryFormulas.values()]
          .filter((c) => !c.colId.startsWith('gristHelper_'))
          .map((c) => ({ name: c.colId, isFormula: true, gristType: gristTypeFromColType(c.type, c.reverseColId) })),
      });
    }
  }
  return { tables };
}

const ID = '[\\p{L}_][\\p{L}\\p{N}_]*';
const RE_USERTABLE = /^@grist\.UserTable\s*$/;
const RE_TOP_CLASS = new RegExp(`^class (${ID})\\s*(?:\\(\\s*\\))?:\\s*(?:#.*)?$`, 'u');
const RE_SUMMARY_CLASS = /^ {2}class _Summary:\s*(?:#.*)?$/;

/** Analyse le texte de la Vue du code en tenant compte de l'indentation (mode corrigé). */
export function parseGristCodeCorrected(content) {
  const lines = String(content).split('\n').map((l) => l.replace(/\r$/, ''));
  const requireDecorator = lines.some((l) => RE_USERTABLE.test(l));
  const tables = [];
  let table = null;
  let summary = null;
  let pending = null;
  let expectClass = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (RE_USERTABLE.test(line)) { expectClass = true; continue; }
    const classMatch = RE_TOP_CLASS.exec(line);
    if (classMatch && (expectClass || !requireDecorator)) {
      table = { name: classMatch[1], line: i + 1, kind: 'table', columns: [] };
      tables.push(table);
      summary = null;
      pending = null;
      expectClass = false;
      continue;
    }
    if (line.trim()) expectClass = false;
    if (!table) continue;

    if (RE_SUMMARY_CLASS.test(line)) {
      summary = { name: table.name + '_Summary', line: i + 1, kind: 'summary', source: table.name, columns: [] };
      tables.push(summary);
      pending = null;
      continue;
    }
    const indent = summary ? '    ' : '  ';
    const target = summary || table;
    if (!line.startsWith(indent) || /^\s/.test(line.slice(indent.length))) continue;
    const member = line.slice(indent.length);

    let m = /^@grist\.formulaType\((.*)\)\s*(?:#.*)?$/.exec(member);
    if (m) { pending = parseGristTypeExpr(m[1]); continue; }

    m = new RegExp(`^def (${ID})\\s*\\(`, 'u').exec(member);
    if (m) {
      const name = m[1];
      if (!name.startsWith('_default_') && !name.startsWith('gristHelper_')) {
        target.columns.push({ name, line: i + 1, isFormula: true, gristType: pending || { name: 'Any', arg: null, reverse: null, raw: '' } });
      }
      pending = null;
      continue;
    }

    m = new RegExp(`^(${ID}) = (grist\\.[A-Za-z_]\\w*\\(.*\\))\\s*(?:#.*)?$`, 'u').exec(member);
    if (m && !summary) {
      target.columns.push({ name: m[1], line: i + 1, isFormula: false, gristType: parseGristTypeExpr(m[2]) });
      pending = null;
    }
  }
  return { tables };
}

/** Modèle structuré → tables de sortie (mode corrigé). */
export function outputFromModel(model) {
  return model.tables.map((t) => ({
    name: t.name,
    line: t.line,
    kind: t.kind,
    source: t.source,
    columns: t.columns.map((c) => toOutputColumn(c.name, convertTypeCorrected(c.gristType, c.isFormula), {
      line: c.line, gristType: c.gristType, sourceIsFormula: c.isFormula, label: c.label, description: c.description,
    })),
  }));
}

export function convertModelCorrected(model) {
  const tables = outputFromModel(model);
  return { tables, dbml: renderDbml(tables) };
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

/**
 * Conversion complète, avec les deux moteurs pour pouvoir les comparer.
 * @param {{ code?: string, schema?: Map }} source  code collé OU schéma du document
 * @returns {{ strict, corrected, codeView }}
 */
export function convertAll(source) {
  const codeView = source.schema ? generateCodeView(source.schema) : String(source.code ?? '');
  let strict;
  try {
    strict = convertCodeStrict(codeView);
  } catch (err) {
    if (!(err instanceof PythonFormulaError)) throw err;
    strict = { error: err, tables: [], dbml: '' };
  }
  const model = source.schema ? modelFromSchema(source.schema) : parseGristCodeCorrected(codeView);
  const corrected = convertModelCorrected(model);
  return { strict, corrected, codeView };
}

// ---------------------------------------------------------------------------
// Statistiques, analyse et schéma Mermaid
// ---------------------------------------------------------------------------

export function computeStats(tables) {
  let columns = 0;
  let relations = 0;
  let formulas = 0;
  for (const t of tables) {
    for (const c of t.columns) {
      columns++;
      if (c.ref) relations++;
      if (c.isFormula) formulas++;
    }
  }
  return { tables: tables.length, columns, relations, formulas };
}

const DBML_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPE_KEYWORDS = ['Text', 'Int', 'Numeric', 'Date', 'ChoiceList', 'Choice'];

function keywordFound(raw) {
  if (!raw) return null;
  return TYPE_KEYWORDS.find((k) => raw.includes(k)) || null;
}

/**
 * Analyse le résultat : écarts entre la formule d'origine et la version corrigée,
 * erreurs qui empêcheraient l'import dans un outil DBML, informations utiles.
 * Niveaux : error | warning | info.
 */
export function analyze(result, mode) {
  const findings = [];
  const add = (level, code, title, detail, where = {}) => findings.push({ level, code, title, detail, ...where });
  const { strict, corrected } = result;

  if (strict.error) {
    add(mode === 'strict' ? 'error' : 'warning', 'python-error',
      'La formule d\'origine échouerait sur ce code',
      `Elle lèverait « ${strict.error.message} » (ligne ${strict.error.line}). `
      + (mode === 'strict' ? 'Passez en conversion corrigée pour obtenir un résultat.' : 'La conversion corrigée n\'est pas concernée.'),
      { line: strict.error.line });
  }

  // Écarts entre les deux moteurs
  if (!strict.error) {
    const corrByName = new Map(corrected.tables.map((t) => [t.name, t]));
    const strictByName = new Map(strict.tables.map((t) => [t.name, t]));
    for (const st of strict.tables) {
      const ct = corrByName.get(st.name);
      if (!ct) {
        add('warning', 'phantom-table', `Table fantôme « ${st.name} »`,
          `La formule d'origine crée cette table à partir de la ligne ${st.line}, qui n'est pas une déclaration de table (probablement du texte dans une formule).`,
          { table: st.name, line: st.line });
        continue;
      }
      const ccols = new Map(ct.columns.map((c) => [c.name, c]));
      const seen = new Set();
      for (const sc of st.columns) {
        const cc = ccols.get(sc.name);
        if (!cc || seen.has(sc.name)) {
          add('warning', 'phantom-column', `Colonne fantôme « ${st.name}.${sc.name} »`,
            `La ligne ${sc.line} est lue comme une colonne alors qu'elle fait partie du corps d'une formule (fonction ou affectation internes).`,
            { table: st.name, column: sc.name, line: sc.line });
          continue;
        }
        seen.add(sc.name);
        if (sc.dbmlType === cc.dbmlType) continue;
        const gt = cc.gristType || {};
        if (cc.ref && (!sc.ref || sc.ref.table !== cc.ref.table || sc.ref.kind !== cc.ref.kind)) {
          const kw = keywordFound(sc.raw);
          add('warning', 'lost-relation', `Relation perdue : ${st.name}.${sc.name} → ${cc.ref.table}`,
            kw
              ? `La formule d'origine détecte les types par sous-chaîne : « ${sc.raw} » contient « ${kw} », la colonne devient « ${sc.dbmlType} » sans relation.`
              : `La formule d'origine produit « ${sc.dbmlType} » au lieu de « ${cc.dbmlType} ».`,
            { table: st.name, column: sc.name, line: sc.line });
        } else if (gt.name === 'Bool') {
          add('info', 'bool', `Booléen exporté en varchar : ${st.name}.${sc.name}`,
            'La formule d\'origine ne connaît pas le type Bool ; la conversion corrigée utilise « boolean ».',
            { table: st.name, column: sc.name, line: sc.line });
        } else if (gt.name === 'DateTime') {
          add('info', 'datetime', `Date-heure exportée en date : ${st.name}.${sc.name}`,
            'La formule d\'origine confond Date et DateTime ; la conversion corrigée utilise « timestamp ».',
            { table: st.name, column: sc.name, line: sc.line });
        } else if (sc.isFormula && cc.isFormula && sc.base !== cc.base && cc.base === 'default') {
          add('warning', 'type-leak', `Type de formule hérité à tort : ${st.name}.${sc.name}`,
            `Un décorateur @grist.formulaType destiné à une autre fonction est appliqué à cette colonne (« ${sc.dbmlType} »).`,
            { table: st.name, column: sc.name, line: sc.line });
        } else {
          const kw = keywordFound(sc.raw);
          add('warning', 'wrong-type', `Type mal détecté : ${st.name}.${sc.name}`,
            `Formule d'origine : « ${sc.dbmlType} », attendu : « ${cc.dbmlType} »`
            + (kw ? ` (le texte « ${sc.raw} » contient « ${kw} »).` : '.'),
            { table: st.name, column: sc.name, line: sc.line });
        }
      }
      for (const cc of ct.columns) {
        if (!st.columns.some((c) => c.name === cc.name)) {
          add('warning', 'missing-column', `Colonne omise : ${st.name}.${cc.name}`,
            'La formule d\'origine ne produit pas cette colonne.', { table: st.name, column: cc.name, line: cc.line });
        }
      }
    }
    for (const ct of corrected.tables) {
      if (!strictByName.has(ct.name)) {
        add('warning', 'missing-table', `Table omise : ${ct.name}`, 'La formule d\'origine ne produit pas cette table.', { table: ct.name });
      }
    }
  }

  // Contrôles sur la sortie affichée
  const shown = mode === 'strict' ? strict : corrected;
  const tableNames = new Set(shown.tables.map((t) => t.name));
  if (!shown.tables.length && !(mode === 'strict' && strict.error)) {
    add('warning', 'empty', 'Aucune table détectée',
      'Vérifiez que le texte collé provient bien de la « Vue du code » de Grist (il commence par « import grist »).');
  }
  for (const t of shown.tables) {
    if (!DBML_IDENTIFIER.test(t.name)) {
      add('error', 'bad-table-name', `Nom de table invalide en DBML : « ${t.name} »`, 'Les outils DBML refuseront ce nom.', { table: t.name, line: t.line });
    }
    const names = new Set();
    for (const c of t.columns) {
      if (!DBML_IDENTIFIER.test(c.name)) {
        add('error', 'bad-column-name', `Nom de colonne invalide en DBML : « ${t.name}.${c.name} »`,
          'Les outils DBML refuseront cette ligne.', { table: t.name, column: c.name, line: c.line });
      }
      if (names.has(c.name) || c.name === 'id') {
        add('error', 'duplicate-column', `Colonne en double : « ${t.name}.${c.name} »`,
          'Une table DBML ne peut pas déclarer deux fois la même colonne.', { table: t.name, column: c.name, line: c.line });
      }
      names.add(c.name);
      if (c.ref && !tableNames.has(c.ref.table)) {
        add('error', 'unknown-ref', `Relation vers une table absente : ${t.name}.${c.name} → ${c.ref.table}`,
          'La table cible n\'existe pas dans le schéma : dbdiagram.io et les autres outils DBML refuseront l\'import.',
          { table: t.name, column: c.name, line: c.line });
      }
    }
  }
  const summaries = shown.tables.filter((t) => t.kind === 'summary').length;
  if (summaries) {
    add('info', 'summary', `${summaries} table${summaries > 1 ? 's' : ''} de synthèse`,
      'Les colonnes de formule des tables de synthèse sont regroupées dans une table « <Source>_Summary », comme dans la Vue du code.');
  }
  const reverse = shown.tables.flatMap((t) => t.columns)
    .filter((c) => (c.gristType && c.gristType.reverse) || (c.raw && c.raw.includes('reverse_of='))).length;
  if (reverse) {
    add('info', 'two-way', `${reverse} colonne${reverse > 1 ? 's' : ''} de référence bidirectionnelle`,
      'Chaque côté d\'une référence bidirectionnelle produit sa propre relation : elles apparaissent en double sur le schéma.');
  }
  return findings;
}

function mermaidId(name) {
  const s = String(name).replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(s) ? s : '_' + s;
}

/** Schéma entité-relation Mermaid à partir des tables de sortie. */
export function toMermaid(tables, direction = 'LR') {
  const lines = ['erDiagram', `  direction ${direction}`];
  for (const t of tables) {
    const id = mermaidId(t.name);
    lines.push(`  ${id} {`);
    lines.push('    integer id PK');
    for (const c of t.columns) {
      const type = mermaidId(c.base || 'varchar');
      const keys = c.ref ? ' FK' : '';
      const comment = c.isFormula ? ' "formule"' : '';
      lines.push(`    ${type} ${mermaidId(c.name)}${keys}${comment}`);
    }
    lines.push('  }');
  }
  for (const t of tables) {
    for (const c of t.columns) {
      if (!c.ref) continue;
      const card = c.ref.kind === '<>' ? '}o--o{' : '}o--||';
      lines.push(`  ${mermaidId(t.name)} ${card} ${mermaidId(c.ref.table)} : "${String(c.name).replace(/"/g, "'")}"`);
    }
  }
  return lines.join('\n');
}
