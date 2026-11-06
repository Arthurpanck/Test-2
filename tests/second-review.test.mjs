import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runAudit } from '../assets/audit-engine.js';
import { AUDIT_CATALOG, RETAINED_IDS } from './audit-decisions.mjs';
import { REMOVED_FINDING_IDS } from './audit-decisions.mjs';
import { buildAccess, accessInsights } from '../assets/access.js';
import { buildInsights } from '../assets/insights.js';
import { schemaFromMetadata } from '../assets/converter.js';
import { convertAll } from '../assets/converter-code.js';
import { profileTables } from '../assets/datacheck.js';
import { definition, metadataFromDefinition } from './fixtures/mal-structure.mjs';

const cols = (names) => names.map((colId) => ({ colId, label: colId, type: 'Numeric', isFormula: false }));
const context = (columns) => ({ schema: new Map([['T', { tableId: 'T', columns: new Map(columns.map((c) => [c.colId, c])) }]]), data: {} });

test('N41 est retiré de l’audit (et son module de détection supprimé)', () => {
  const c = cols(['Cotisation_Annee_1', 'Cotisation_Annee_2', 'Cotisation_Annee_3']);
  assert.ok(!runAudit(context(c)).items.some((i) => i.id === 'N41'));
  assert.ok(!RETAINED_IDS.includes('N41'));
  assert.ok(REMOVED_FINDING_IDS.has('N41'));
});
test('deuxième revue : niveaux des contrôles enrichis et absence des calculs supprimés', () => {
  for (const id of ['N06', 'N09', 'N31', 'N50', 'N53', 'N57'])
    assert.equal(AUDIT_CATALOG.find((x) => x.id === id).severity, 'blocking', id);
  assert.equal(AUDIT_CATALOG.find((x) => x.id === 'N34').severity, 'blocking');
  const engine = readFileSync(new URL('../assets/audit-engine.js', import.meta.url), 'utf8');
  for (const id of ['N07', 'N10', 'N13', 'N14', 'N36', 'N38']) {
    assert.ok(!RETAINED_IDS.includes(id));
    assert.ok(!engine.includes("'" + id + "'"));
  }
  assert.equal(RETAINED_IDS.length, 15);
});
test('deuxième revue : attribut inutilisé, table vide et colonne vide sont À corriger ; courriels retirés', () => {
  const m = metadataFromDefinition(definition),
    schema = schemaFromMetadata(m.tables, m.cols),
    access = buildAccess({ resources: m.aclResources, rules: m.aclRules, schema });
  const ins = buildInsights(convertAll({ schema }).corrected.tables, access, { profiles: profileTables(m.records) });
  for (const id of ['empty-table', 'never-filled']) assert.equal(ins.items.find((x) => x.id === id).severity, 'blocking', id);
  assert.ok(!ins.items.some((x) => x.id === 'acl-emails'));
  assert.ok(!accessInsights(access).some((x) => x.id === 'acl-emails'));
  assert.equal(ins.items.find((x) => x.id === 'acl-no-memo').severity, 'improve');
  assert.equal(
    ins.items.find((x) => x.id === 'acl-bypass').title,
    'Accès des éditeurs aux droits de structure et donc aux données malgré les droits d’accès',
  );
});
test('attribut déclaré à source absente : À corriger, avec la limite de lecture explicitée', () => {
  const a = {
    hasRules: true,
    attributes: [{ name: 'Habilitation', tableId: 'Invisible', lookupColId: 'Email', problems: ['source absente de la lecture'] }],
    defaults: [],
    tables: [],
    special: [],
    uncovered: [],
  };
  const item = accessInsights(a).find((x) => x.id === 'acl-attribute');
  assert.equal(item, undefined);
  assert.equal(a.attributes[0].name, 'Habilitation');
});
test('acl-none et acl-uncovered diffèrent par leur périmètre ; acl-hidden est maintenant retiré', () => {
  const empty = buildAccess({ resources: [], rules: [], schema: new Map() });
  assert.deepEqual(
    accessInsights(empty).map((x) => x.id),
    ['acl-none'],
  );
  const a = {
    hasRules: true,
    attributes: [],
    defaults: [],
    special: [],
    uncovered: ['Autre'],
    restrictsRead: false,
    tables: [{ tableId: 'Invisible', missing: true, rules: [], columns: [] }],
  };
  const items = accessInsights(a);
  assert.ok(items.some((x) => x.id === 'acl-uncovered'));
  assert.ok(!items.some((x) => x.id === 'acl-none'));
  assert.ok(!items.some((x) => x.id === 'acl-hidden'));
  assert.ok(REMOVED_FINDING_IDS.has('acl-hidden'));
});
