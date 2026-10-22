// Tests du convertisseur : node --test tests/
// Le test différentiel exécute la formule Python d'origine (tests/reference) comme oracle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  convertCodeStrict, parseGristCodeStrict, PythonFormulaError, parseGristCodeCorrected,
  convertModelCorrected, schemaFromMetadata, generateCodeView, modelFromSchema, convertAll,
  analyze, toMermaid, computeStats, convertTypeStrict, getGristTypeCode,
} from '../assets/converter.js';
import { metadataFromModel } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

function runPython(inputs) {
  const res = spawnSync('python3', [path.join(here, 'reference', 'run_reference.py')], {
    input: JSON.stringify(inputs), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

function runJs(text) {
  try {
    return { ok: true, dbml: convertCodeStrict(text).dbml };
  } catch (err) {
    if (err instanceof PythonFormulaError) return { ok: false, error: err.pyType };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Générateur aléatoire déterministe
// ---------------------------------------------------------------------------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Agents', 'Interventions', 'Dates', 'Textes', 'Choix', 'Choices', 'Numerics', 'Notes',
  'Projet_lie', 'Été', '名前', 'Int', 'A', 'Reference', 'Attachments_x', 'Sujet', 'Document_lie', '_x', 'x1'];
const TYPES = ['Text', 'Int', 'Numeric', 'Date', 'DateTime', 'Bool', 'Choice', 'ChoiceList', 'Any',
  'Attachments', 'PositionNumber', 'Ref', 'RefList', 'Blob', 'ManualSortPos'];
const WS = ['', ' ', '  ', '\t', '\xa0', '\u3000', '\x1c', '\x85', '\ufeff'];

function randomLine(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const name = pick(NAMES);
  const type = pick(TYPES);
  const arg = r() < 0.5 ? `'${pick(NAMES)}'` : r() < 0.5 ? `'Europe/Paris'` : '';
  const rev = r() < 0.2 ? `, reverse_of='${pick(NAMES)}'` : '';
  const typeExpr = `grist.${type === 'Ref' ? 'Reference' : type === 'RefList' ? 'ReferenceList' : type}(${arg}${arg ? rev : ''})`;
  const options = [
    () => '',
    () => '@grist.UserTable',
    () => `class ${name}:`,
    () => `  class _Summary:`,
    () => `${pick(WS)}${name} = ${typeExpr}${pick(WS)}`,
    () => `  ${name} = ${typeExpr}`,
    () => `  ${name}=${typeExpr}`,
    () => `  ${name} = ${typeExpr}  # a = b`,
    () => `  @grist.formulaType(${typeExpr})`,
    () => `    @grist.formulaType(${typeExpr})  `,
    () => `  @gristXformulaType(${typeExpr})`,
    () => `  def ${name}(rec, table):`,
    () => `  def _default_${name}(rec, table, value, user):`,
    () => `  def gristHelper_${name}(rec, table):`,
    () => `    return rec.${name}`,
    () => `    def helper_${name}(x):`,
    () => `    x = "subclass ${name}: def ${name}"`,
    () => `    # undef ${name} = grist.Text()`,
    () => `  pass`,
    () => `import grist`,
    () => `${name} = ${typeExpr}\r`,
    () => `  def ${name}(rec, table):\r`,
    () => `class ${name}:\r`,
    () => `  ${name} = grist.${pick(TYPES)}()\u2028extra`,
    () => `x = ${typeExpr} = y`,
  ];
  return pick(options)();
}

function randomCode(r) {
  const n = Math.floor(r() * 40);
  const lines = [];
  if (r() < 0.8) lines.push('@grist.UserTable', `class ${NAMES[Math.floor(r() * NAMES.length)]}:`);
  for (let i = 0; i < n; i++) lines.push(randomLine(r));
  return lines.join(r() < 0.1 ? '\r\n' : '\n');
}

/** Métadonnées Grist aléatoires (format colonnaire de docApi.fetchTable). */
function randomMetadata(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const nTables = 1 + Math.floor(r() * 6);
  const tableIds = [];
  while (tableIds.length < nTables) {
    const t = pick(['Agents', 'Services', 'Interventions', 'Dates_cles', 'Projets', 'Textes', 'Budget', 'Zones']);
    if (!tableIds.includes(t)) tableIds.push(t);
  }
  const tables = { id: [], tableId: [], summarySourceTable: [] };
  const cols = { id: [], parentId: [], parentPos: [], colId: [], type: [], isFormula: [], formula: [], reverseCol: [] };
  let colRef = 1;
  const addCol = (parentId, pos, colId, type, isFormula, formula, reverseCol = 0) => {
    cols.id.push(colRef); cols.parentId.push(parentId); cols.parentPos.push(pos); cols.colId.push(colId);
    cols.type.push(type); cols.isFormula.push(isFormula); cols.formula.push(formula); cols.reverseCol.push(reverseCol);
    return colRef++;
  };
  tableIds.forEach((tableId, i) => {
    const tref = i + 1;
    tables.id.push(tref); tables.tableId.push(tableId); tables.summarySourceTable.push(0);
    addCol(tref, 0.5, 'manualSort', 'ManualSortPos', false, '');
    const nCols = Math.floor(r() * 8);
    for (let k = 0; k < nCols; k++) {
      let type = pick(TYPES.filter((t) => t !== 'ManualSortPos'));
      if (type === 'Ref' || type === 'RefList') type += ':' + pick(tableIds);
      if (type === 'DateTime') type += ':Europe/Paris';
      const isFormula = r() < 0.4;
      const formula = isFormula ? pick(['', '$Nom', 'len($group)', 'x = 1\nx + 1', 'return 5', '# rien']) : (r() < 0.2 ? '$Nom' : '');
      addCol(tref, k + 1 + r(), `Col_${k}_${pick(['a', 'b', 'Note'])}`, type, isFormula, formula);
    }
    if (r() < 0.3) addCol(tref, 99, 'gristHelper_Display', 'Any', true, '$Col_0_a');
  });
  if (r() < 0.5) {
    const src = 1 + Math.floor(r() * tableIds.length);
    const sref = tableIds.length + 1;
    tables.id.push(sref); tables.tableId.push(`${tableIds[src - 1]}_summary`); tables.summarySourceTable.push(src);
    addCol(sref, 1, 'group', `RefList:${tableIds[src - 1]}`, true, 'table.getSummarySourceGroup(rec)');
    addCol(sref, 2, 'count', 'Int', true, 'len($group)');
    if (r() < 0.5) addCol(sref, 3, 'Total', 'Numeric', true, 'SUM($group.Montant)');
  }
  return { tables, cols };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('reproduit exactement la cellule du document Conversion-DBML', () => {
  const code = fixture('document-exemple.code.py');
  const expected = fixture('document-exemple.expected.dbml');
  assert.equal(convertCodeStrict(code).dbml, expected);
});

test('différentiel : JS strict ≡ formule Python sur les fixtures et 3 000 entrées aléatoires', () => {
  const inputs = [
    fixture('document-exemple.code.py'),
    fixture('cas-limites.code.py'),
    fixture('cas-limites.code.py').replace(/\n/g, '\r\n'),
    '',
    '\n\n',
    '  def orphelin(rec, table):',
    '  class _Summary:',
    'class A:\n  def x(rec, table):\n  class _Summary:\nclass A:\n  y = grist.Int()',
    'class A:\n  a = grist.Reference()\n  b = grist.ReferenceList()\n  @grist.formulaType(grist.Reference())\n  def c(rec, table):',
    'class Été:\n  名前 = grist.Text()\n  ½ = grist.Int()',
  ];
  const r = rng(42);
  for (let i = 0; i < 2500; i++) inputs.push(randomCode(r));
  for (let i = 0; i < 500; i++) {
    const { tables, cols } = randomMetadata(r);
    inputs.push(generateCodeView(schemaFromMetadata(tables, cols)));
  }
  const expected = runPython(inputs);
  let errors = 0;
  inputs.forEach((text, i) => {
    const got = runJs(text);
    if (!expected[i].ok) errors++;
    assert.deepEqual(got, expected[i], `Entrée n°${i} :\n${JSON.stringify(text).slice(0, 400)}`);
  });
  assert.ok(errors > 10, 'le générateur doit aussi couvrir les cas d\'erreur Python');
});

test('cas limites : erreurs Python reproduites', () => {
  assert.throws(() => parseGristCodeStrict('  def x(rec, table):'), (e) => e.pyType === 'KeyError');
  assert.throws(() => parseGristCodeStrict('class _Summary:'), (e) => e.pyType === 'TypeError');
});

test('convert_type : détection par sous-chaîne reproduite', () => {
  assert.equal(convertTypeStrict("grist.Reference('Interventions')"), 'integer');
  assert.equal(convertTypeStrict("grist.Reference('Dates_cles')"), 'date');
  assert.equal(convertTypeStrict("grist.ReferenceList('Agents')"), 'integer_list [ref: <> Agents.id]');
  assert.equal(convertTypeStrict('grist.Bool()'), 'varchar');
  assert.equal(convertTypeStrict('grist.Reference()'), 'integer ');
  assert.equal(convertTypeStrict("Reference('Suivi_projets')", true), '"formula[integer]" [ref: > Suivi_projets.id]');
});

test('get_grist_type : format de gencode.py', () => {
  assert.equal(getGristTypeCode('Ref:Agents'), "grist.Reference('Agents')");
  assert.equal(getGristTypeCode('RefList:Agents', 'Service'), "grist.ReferenceList('Agents', reverse_of='Service')");
  assert.equal(getGristTypeCode('DateTime:Europe/Paris'), "grist.DateTime('Europe/Paris')");
  assert.equal(getGristTypeCode('Text'), 'grist.Text()');
  assert.equal(getGristTypeCode('Int', 'x'), 'grist.Int()');
});

test('mode « Ce document » : la Vue du code reconstituée donne le même DBML que la cellule', () => {
  const code = fixture('document-exemple.code.py');
  const model = parseGristCodeCorrected(code);
  const { tables, cols } = metadataFromModel(model);
  const schema = schemaFromMetadata(tables, cols);
  const view = generateCodeView(schema);
  assert.equal(convertCodeStrict(view).dbml, fixture('document-exemple.expected.dbml'));
  // Les lignes structurelles sont identiques à la vraie Vue du code.
  // (Le code collé dans le document a des fins de ligne Windows ; les formules de valeur
  // par défaut `_default_*` ne sont pas reconstruites par cet aller-retour.)
  const structural = (t) => t.replace(/\r/g, '').split('\n')
    .filter((l) => /^(@grist|class |  class |\s*@grist\.formulaType|\s*def |\s*\w+ = grist\.)/.test(l))
    .filter((l) => !l.includes('def _default_'));
  assert.deepEqual(structural(view), structural(code));
});

test('moteur corrigé ≡ moteur strict sur des schémas aléatoires, hors corrections documentées', () => {
  const r = rng(7);
  for (let i = 0; i < 400; i++) {
    const { tables, cols } = randomMetadata(r);
    const result = convertAll({ schema: schemaFromMetadata(tables, cols) });
    assert.ok(!result.strict.error);
    const findings = analyze(result, 'corrected');
    const allowed = new Set(['lost-relation', 'bool', 'datetime', 'wrong-type', 'summary', 'two-way', 'unknown-ref', 'empty']);
    for (const f of findings) assert.ok(allowed.has(f.code), `${f.code} : ${f.title}`);
    // Sans colonne piégeuse, les deux sorties coïncident.
    const strictT = result.strict.tables;
    const corrT = result.corrected.tables;
    assert.deepEqual(strictT.map((t) => t.name), corrT.map((t) => t.name));
    strictT.forEach((t, k) => assert.deepEqual(t.columns.map((c) => c.name), corrT[k].columns.map((c) => c.name)));
  }
});

test('analyse des cas limites', () => {
  const result = convertAll({ code: fixture('cas-limites.code.py') });
  const codes = (mode) => analyze(result, mode).map((f) => `${f.code}:${f.table || ''}.${f.column || ''}`);
  const strictCodes = codes('strict');
  for (const expected of [
    'lost-relation:Agents.Interventions_suivies',
    'lost-relation:Interventions.Echeance',
    'lost-relation:Interventions.Modele',
    'bool:Agents.Actif',
    'datetime:Agents.Arrivee',
    'phantom-column:Agents.compter',
    'phantom-table:Brouillon.',
    'missing-column:Agents.Sans_type',
    'summary:.',
    'two-way:.',
  ]) assert.ok(strictCodes.includes(expected), `attendu : ${expected}\nobtenu : ${strictCodes.join(', ')}`);
  const corrCodes = codes('corrected');
  assert.ok(corrCodes.includes('unknown-ref:Interventions.Categorie'));
  assert.ok(corrCodes.includes('unknown-ref:Interventions.Modele'));

  const corr = result.corrected.tables.find((t) => t.name === 'Agents');
  const types = Object.fromEntries(corr.columns.map((c) => [c.name, c.dbmlType]));
  assert.equal(types.Actif, 'boolean');
  assert.equal(types.Arrivee, 'timestamp');
  assert.equal(types.Interventions_suivies, 'integer_list [ref: <> Interventions.id]');
  assert.equal(types.Nb_interventions, '"formula[integer]"');
  assert.equal(types.Sans_type, '"formula[default]"');
  assert.equal(types.compter, undefined);
  assert.ok(!result.corrected.tables.some((t) => t.name === 'Brouillon'));
  assert.deepEqual(result.corrected.tables.map((t) => t.name),
    ['Agents', 'Dates_cles', 'Interventions', 'Interventions_Summary', 'Services', 'Vide']);
});

test('statistiques et schéma Mermaid', () => {
  const result = convertAll({ code: fixture('document-exemple.code.py') });
  const stats = computeStats(result.strict.tables);
  assert.deepEqual(stats, { tables: 6, columns: 61, relations: 6, formulas: 16 });
  const mermaid = toMermaid(result.strict.tables);
  assert.match(mermaid, /^erDiagram/);
  assert.match(mermaid, /Detail_documents }o--\|\| Document_a_etudier_espace_metier : "ref_document"/);
  assert.ok(!/\[|\]/.test(mermaid.replace(/"[^"]*"/g, '')), 'pas de crochets hors chaînes');
});
