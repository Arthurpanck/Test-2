import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaFromMetadata } from '../../assets/converter.js';
import { convertAll } from '../../assets/converter-code.js';
import { buildInsights } from '../../assets/insights.js';
import { profileTables, profileValues } from '../../assets/datacheck.js';
import { runAudit } from '../../assets/audit-engine.js';
import { AUDIT_CATALOG, RETAINED_IDS, REMOVED_FINDING_IDS } from '../audit-decisions.mjs';
import { buildAccess, accessInsights } from '../../assets/access.js';
import { buildPages } from '../../assets/pages.js';
import { definition, metadataFromDefinition } from '../fixtures/mal-structure.mjs';

function scenario(columns, rows) {
  const cs = columns.map(([colId, type, extra = {}], i) => ({
    id: i + 1,
    parentId: 1,
    parentPos: i + 1,
    colId,
    label: colId,
    type,
    isFormula: false,
    formula: '',
    widgetOptions: '',
    ...extra,
  }));
  const schema = schemaFromMetadata([{ id: 1, tableId: 'T' }], cs),
    tables = convertAll({ schema }).corrected.tables,
    data = { T: { id: rows.map((_, i) => i + 1) } };
  for (const [c] of columns) data.T[c] = rows.map((r) => r[c] ?? null);
  return { schema, tables, data, profiles: profileTables(data) };
}
const inspect = (x) => buildInsights(x.tables, null, { profiles: x.profiles, audit: { schema: x.schema, data: x.data } });

test('les colonnes Any de saisie et de formule sont regroupées dans un seul constat À corriger', () => {
  const x = scenario(
    [
      ['Saisie', 'Any'],
      ['Formule', 'Any', { isFormula: true, formula: '1 + 1' }],
      ['Calcule_tape', 'Numeric', { isFormula: true, formula: '1 + 1' }],
    ],
    [{ Saisie: 'a', Formule: 2, Calcule_tape: 2 }],
  );
  const ins = inspect(x),
    untyped = ins.items.find((i) => i.id === 'empty');
  assert.equal(untyped.severity, 'blocking');
  assert.deepEqual(untyped.targets.map((t) => t.column).sort(), ['Formule', 'Saisie']);
  assert.ok(!ins.items.some((i) => i.id === 'untyped'));
});
test('les modalités simples et multiples absentes donnent une seule carte À corriger', () => {
  const options = { widgetOptions: JSON.stringify({ choices: ['Accueil', 'Cuisine'] }) };
  const x = scenario(
    [
      ['Simple', 'Choice', options],
      ['Multiple', 'ChoiceList', options],
    ],
    [
      { Simple: 'Acceuil', Multiple: ['L', 'Accueil', 'Acceuil'] },
      { Simple: 'Accueil', Multiple: ['L', 'Cuisine', 'Accueil'] },
    ],
  );
  const ins = inspect(x),
    cards = ins.items.filter((i) => ['choice-outside', 'N64'].includes(i.id));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].severity, 'blocking');
  assert.match(cards[0].title, /modalités/);
  assert.deepEqual(
    cards[0].targets.map((t) => t.column),
    ['Simple', 'Multiple'],
  );
  assert.ok(!runAudit(x).items.some((i) => i.id === 'N64'));
});
test('les modalités sont comparées exactement, sans confondre liste valide, censure et valeur absente', () => {
  const options = { widgetOptions: JSON.stringify({ choices: ['Accueil', 'Cuisine', ' Accueil'] }) };
  const x = scenario(
    [
      ['Simple', 'Choice', options],
      ['Multiple', 'ChoiceList', options],
    ],
    [
      { Simple: ' Accueil', Multiple: ['L', 'Cuisine', 'Accueil'] },
      { Simple: 'Cuisine', Multiple: ['C'] },
      { Simple: '', Multiple: ['E', 'Erreur'] },
      { Simple: 'Accueil', Multiple: ['L'] },
    ],
  );
  assert.ok(!inspect(x).items.some((i) => i.id === 'choice-outside'));
  const profile = profileValues([['L', ' Accueil', 'Accueil'], ['C'], ['E', 'Erreur']]);
  assert.deepEqual([...profile.choiceItems], [' Accueil', 'Accueil']);
  const capped = profileValues([['L', ...Array.from({ length: 10000 }, (_, i) => 'V' + i)]]);
  assert.equal(capped.choiceItems.size, 2000);
});
test('le constat fusionné de choix fonctionne sans le moteur enrichi et sans données de tables voisines', () => {
  const x = scenario([['Multiple', 'ChoiceList', { widgetOptions: JSON.stringify({ choices: ['A'] }) }]], [{ Multiple: ['L', 'B'] }]);
  const ins = buildInsights(x.tables, null, { profiles: x.profiles });
  assert.ok(ins.items.some((i) => i.id === 'choice-outside' && i.severity === 'blocking'));
  assert.ok(
    !inspect(scenario([['Multiple', 'ChoiceList', { widgetOptions: '{"choices":[]}' }]], [{ Multiple: ['L', 'B'] }])).items.some(
      (i) => i.id === 'choice-outside',
    ),
  );
});
test('les niveaux demandés sont appliqués et les calculs supprimés ne sont plus enregistrés', () => {
  const m = metadataFromDefinition(definition),
    schema = schemaFromMetadata(m.tables, m.cols),
    tables = convertAll({ schema }).corrected.tables,
    access = buildAccess({ schema, resources: m.aclResources, rules: m.aclRules });
  const ins = buildInsights(tables, access, { profiles: profileTables(m.records), audit: { schema, data: m.records } });
  for (const id of ['empty', 'default-name', 'acl-bypass']) assert.equal(ins.items.find((i) => i.id === id).severity, 'blocking', id);
  assert.equal(ins.items.find((i) => i.id === 'acl-uncovered').severity, 'info');
  for (const id of ['N34', 'N41']) assert.equal(AUDIT_CATALOG.find((i) => i.id === id).severity, 'blocking');
  for (const id of ['N09', 'N64', 'untyped']) {
    assert.ok(REMOVED_FINDING_IDS.has(id));
    assert.ok(!RETAINED_IDS.includes(id));
    assert.ok(!ins.items.some((i) => i.id === id));
  }
});
test('les explications courantes parlent de vues et évitent les précisions de lecture dans les tables ou colonnes vides', () => {
  const m = metadataFromDefinition(definition),
    schema = schemaFromMetadata(m.tables, m.cols),
    tables = convertAll({ schema }).corrected.tables,
    access = buildAccess({ schema, resources: m.aclResources, rules: m.aclRules }),
    pages = buildPages({ tables: m.tables, columns: m.cols, pages: m.pages, views: m.views, sections: m.sections });
  const ins = buildInsights(tables, access, { profiles: profileTables(m.records), pages, audit: { schema, data: m.records } });
  for (const i of ins.items)
    assert.doesNotMatch([i.title, i.summary, i.why, i.intended || '', ...i.steps].join(' '), /\bwidgets?\b/i, i.id);
  assert.equal(ins.items.find((i) => i.id === 'empty-table').summary, 'Ces tables ne contiennent aucune ligne.');
  const empty = ins.items.find((i) => i.id === 'never-filled');
  assert.match(empty.title, /colonne.*vide/i);
  assert.doesNotMatch(empty.summary, /lues|lisibles|masqu|lecture/i);
  const wide = ins.items.find((i) => i.id === 'wide-table');
  assert.match(wide.why, /entité/);
  assert.match(wide.why, /Choix multiple/);
  assert.match(wide.intended, /autre système/);
  const isolated = ins.items.find((i) => i.id === 'isolated');
  assert.match(isolated.why, /rapport/);
  assert.match(isolated.why, /liste déroulante/);
});
