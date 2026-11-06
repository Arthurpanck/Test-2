/**
 * Conversion depuis le code : portage strict, ligne à ligne, de la formule Python du document
 * « Conversion-DBML » (elle-même basée sur grist-db-parser d'Arnaud Robin), sortie identique à
 * l'octet près, défauts compris ; génération et lecture de la « Vue du code » de Grist ; analyse
 * des écarts entre les deux moteurs. Utilisé par les tests et les documents donnés sous forme de
 * code ; le widget, lui, lit les métadonnées (converter.js).
 */
import {
  DEFAULT_FORMULA_TYPE, PythonFormulaError, W, convertModelCorrected, getGristTypeCode, modelFromSchema, parseGristTypeExpr, pyReprStr, pyStrip, renderDbml, toOutputColumn, userViewTables,
} from './converter.js?v=3.18.0';
import { maskPython } from './python-text.js?v=3.18.0';

export { PythonFormulaError };

// ---------------------------------------------------------------------------
// Moteur strict : portage exact de la formule d'origine
// ---------------------------------------------------------------------------

const RE_CLASS = new RegExp(`class (${W}+):`, 'u');
const RE_FIELD = new RegExp(`(${W}+) = grist\\.(${W}+)`, 'u');
const RE_FORMULA = new RegExp(`def (?!_default_|gristHelper_)(${W}+)`, 'u');
// En Python, `.` capture tout sauf `\n` (y compris `\r`) : on l'écrit donc `[^\n]`.
const RE_FORMULA_TYPE = /grist[^\n]formulaType\(grist\.([^\n]+)\)/u;
const RE_REF_TABLE = new RegExp(`'(${W}+)'`, 'u');


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
  const masked = maskPython(code);
  let out = '';
  for (let i = 0; i < code.length; i++) out += masked[i] === '$' && /[A-Za-z_]/.test(code[i + 1] || '') ? 'rec.' : code[i];
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
