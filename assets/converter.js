/**
 * Conversion de la structure d'un document Grist en DBML.
 *
 * Moteur « corrigé » : lecture structurée des métadonnées du document, qui corrige les défauts
 * connus de la formule d'origine (relations, types). C'est le seul que le widget charge.
 * Le portage strict de la formule et la lecture de la Vue du code sont dans converter-code.js
 * (tests de parité et documents donnés sous forme de code).
 *
 * Fonctionne dans le navigateur comme sous Node.
 */
import { columnarToRows, parseJsonObject, isVisibleColumn } from './util.js?v=3.18.0';

// ---------------------------------------------------------------------------
// Compatibilité Python
// ---------------------------------------------------------------------------

/** Équivalent de `\w` en Python 3 (classes Unicode L* et N*, plus `_`). */
export const W = '[\\p{L}\\p{N}_]';

/** Caractères retirés par `str.strip()` en Python (différent de `String.trim()`). */
const PY_WHITESPACE = new Set([
  '\t',
  '\n',
  '\v',
  '\f',
  '\r',
  '\x1c',
  '\x1d',
  '\x1e',
  '\x1f',
  ' ',
  '\x85',
  '\xa0',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  '　',
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

/** Type DBML d'une formule au type indéterminé. */
export const DEFAULT_FORMULA_TYPE = '"formula[default]"';

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

export function toOutputColumn(name, dbmlType, extra = {}) {
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
  Any: 'any',
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

/** Liste de références des métadonnées : ['L', 1, 2], [1, 2] ou "[1, 2]" → [1, 2] (null si absente). */
export function refListValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    try {
      return refListValue(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  return (value[0] === 'L' ? value.slice(1) : value).filter((v) => typeof v === 'number');
}

/**
 * Portage de `build_schema()` : colonnes triées par (table, position).
 * `sections` (facultatif) : lignes de `_grist_Views_section`, pour la description des tables.
 */
export function schemaFromMetadata(metaTables, metaColumns, { sections } = {}) {
  const tables = columnarToRows(metaTables)
    .slice()
    .sort((a, b) => a.id - b.id);
  const cols = columnarToRows(metaColumns);
  const sectionDescription = new Map(columnarToRows(sections || []).map((s) => [s.id, s.description || '']));
  const colIdByRef = new Map(cols.map((c) => [c.id, c.colId]));
  const tableIdByRef = new Map(tables.map((t) => [t.id, t.tableId]));
  const sorted = cols.slice().sort((a, b) => a.parentId - b.parentId || a.parentPos - b.parentPos);
  const byTable = new Map();
  for (const c of sorted) {
    if (!byTable.has(c.parentId)) byTable.set(c.parentId, []);
    byTable.get(c.parentId).push(c);
  }
  const schema = new Map();
  for (const t of tables) {
    // Grist efface le nom des tables et colonnes que la personne connectée ne peut pas lire.
    if (!t.tableId) continue;
    const columns = new Map();
    for (const c of byTable.get(t.id) || []) {
      if (!c.colId) continue;
      const deps = refListValue(c.recalcDeps);
      columns.set(c.colId, {
        colId: c.colId,
        type: c.type || 'Any',
        visibleCol: colIdByRef.get(c.visibleCol || 0) || (typeof c.visibleCol === 'string' ? c.visibleCol : null),
        isFormula: Boolean(c.isFormula),
        formula: c.formula || '',
        reverseColId: colIdByRef.get(c.reverseCol || 0) || null,
        summarySourceColId: colIdByRef.get(c.summarySourceCol || 0) || null,
        label: c.label || '',
        description: c.description || '',
        widgetOptions: parseJsonObject(c.widgetOptions),
        recalcWhen: Number(c.recalcWhen) || 0,
        recalcDeps: deps ? deps.map((id) => colIdByRef.get(id)).filter(Boolean) : null,
      });
    }
    schema.set(t.tableId, {
      tableId: t.tableId,
      columns,
      summarySourceTable: t.summarySourceTable || 0,
      summarySourceTableId: tableIdByRef.get(t.summarySourceTable) || null,
      description: sectionDescription.get(t.rawViewSectionRef) || '',
    });
  }
  return schema;
}

/**
 * Ce que Grist montre d'une colonne dans son panneau : formule, formule d'initialisation
 * (« formule de déclenchement ») et quand elle s'applique, choix, condition de liste, description.
 */
export function columnDetails(c) {
  const formula = String(c.formula || '');
  const wo = c.widgetOptions || {};
  let trigger = null;
  if (!c.isFormula && formula.trim()) {
    // recalcWhen : 0 = nouvelles lignes (+ colonnes de recalcDeps), 1 = jamais, 2 = toute modification.
    const when = c.recalcWhen === 2 ? 'any' : c.recalcWhen === 1 ? 'never' : c.recalcDeps && c.recalcDeps.length ? 'deps' : 'new';
    trigger = { when, deps: when === 'deps' ? c.recalcDeps : [] };
  }
  return {
    formula: c.isFormula || trigger ? formula : '',
    trigger,
    choices: Array.isArray(wo.choices) ? wo.choices.map(String) : [],
    dropdown: wo.dropdownCondition && typeof wo.dropdownCondition.text === 'string' ? wo.dropdownCondition.text : '',
    label: c.label || '',
    description: c.description || '',
  };
}

/** Portage de `summary.decode_summary_table_name()`. */
export function decodeSummaryTableName(tableInfo) {
  const group = tableInfo.columns.get('group');
  if (group && String(group.formula).includes('getSummarySourceGroup') && String(group.type).startsWith('RefList:')) {
    return group.type.slice(8);
  }
  return null;
}

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Tables visibles dans la Vue du code, dans le même ordre que Grist. */
export function userViewTables(schema) {
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
      .sort((a, b) => Number(a[0].isFormula) - Number(b[0].isFormula) || a[1] - b[1])
      .map(([c]) => c)
      .filter((c) => isVisibleColumn(c.colId));
    const sums = summaries.get(t.tableId);
    let summaryFormulas = null;
    if (sums && sums.length) {
      summaryFormulas = new Map();
      for (const s of sums) for (const c of s.columns.values()) if (c.isFormula) summaryFormulas.set(c.colId, c);
    }
    result.push({ tableId: t.tableId, columns, summaryFormulas, description: t.description || '' });
  }
  return result;
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
      description: t.description,
      columns: t.columns.map((c) => {
        // Colonne « vide » (créée sans type ni formule, comme A, B, C d'un nouveau document) :
        // Grist la range parmi les formules, mais elle n'en a aucune.
        const empty = c.isFormula && !String(c.formula || '').trim();
        return {
          name: c.colId,
          isFormula: c.isFormula && !empty,
          empty,
          gristType: gristTypeFromColType(c.type, c.reverseColId),
          label: c.label,
          description: c.description,
          details: columnDetails(c),
        };
      }),
    });
    if (t.summaryFormulas) {
      tables.push({
        name: t.tableId + '_Summary',
        kind: 'summary',
        source: t.tableId,
        columns: [...t.summaryFormulas.values()]
          .filter((c) => !c.colId.startsWith('gristHelper_'))
          .map((c) => ({
            name: c.colId,
            isFormula: true,
            gristType: gristTypeFromColType(c.type, c.reverseColId),
            label: c.label,
            details: columnDetails(c),
          })),
      });
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
    description: t.description || '',
    columns: t.columns.map((c) =>
      toOutputColumn(c.name, convertTypeCorrected(c.gristType, c.isFormula), {
        line: c.line,
        gristType: c.gristType,
        sourceIsFormula: c.isFormula,
        label: c.label,
        description: c.description,
        empty: Boolean(c.empty),
        details: c.details || null,
      }),
    ),
  }));
}

export function convertModelCorrected(model) {
  const tables = outputFromModel(model);
  return { tables, dbml: renderDbml(tables) };
}

// ---------------------------------------------------------------------------
// Statistiques et analyse
// ---------------------------------------------------------------------------

/** Conversion corrigée du schéma lu dans le document : ce dont le widget a besoin. */
export function convertSchema(schema) {
  return convertModelCorrected(modelFromSchema(schema));
}

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
