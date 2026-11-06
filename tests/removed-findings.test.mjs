// Les constats retirés ne réapparaissent nulle part : on fait tourner toute la chaîne d'analyse
// (structure, données, droits, vues, rapport) sur chaque document de test et on regarde ce qui sort.
import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaFromMetadata } from '../assets/converter.js';
import { convertAll } from '../assets/converter-code.js';
import { buildAccess } from '../assets/access.js';
import { profileTables } from '../assets/datacheck.js';
import { buildPages } from '../assets/pages.js';
import { buildInsights } from '../assets/insights.js';
import { buildReport, renderHtml } from '../assets/report.js';
import { RETAINED_IDS, REMOVED_FINDING_IDS } from './audit-decisions.mjs';
import { documentFixtures, fixtureMetadata } from './helpers.mjs';

/** Même enchaînement que `recompute()` du widget. */
function analyse(m) {
  const schema = schemaFromMetadata(m.tables, m.cols, { sections: m.sections });
  const tables = convertAll({ schema }).corrected.tables;
  const access =
    m.aclResources?.length || m.aclRules?.length ? buildAccess({ resources: m.aclResources, rules: m.aclRules, schema }) : null;
  const data = m.records || {};
  const pages =
    m.pages && m.views && m.sections
      ? buildPages({ pages: m.pages, views: m.views, sections: m.sections, tables: m.tables, columns: m.cols })
      : null;
  const insights = buildInsights(tables, access, { profiles: profileTables(data), pages, audit: { schema, data } });
  return { tables, insights };
}

const fixtures = await documentFixtures();

test('les documents de test couvrent les trois formats de fixture', () => {
  assert.ok(fixtures.some((f) => f.endsWith('.code.py')));
  assert.ok(fixtures.some((f) => f.endsWith('.metadata.json')));
  assert.ok(fixtures.some((f) => f.endsWith('.mjs')));
});

for (const name of fixtures) {
  test(`${name} : aucun constat retiré, seuls les contrôles retenus sont évalués`, async () => {
    const { tables, insights } = analyse(await fixtureMetadata(name));
    for (const item of [...insights.items, ...insights.accepted]) assert.ok(!REMOVED_FINDING_IDS.has(item.id), `${name} : ${item.id}`);
    for (const check of insights.audit?.checks || []) {
      assert.ok(RETAINED_IDS.includes(check.id), `${name} : contrôle ${check.id}`);
      assert.ok(!REMOVED_FINDING_IDS.has(check.id), `${name} : contrôle ${check.id}`);
    }
    // Le rapport Word ne montre que ce que l'analyse a produit.
    const html = renderHtml(
      buildReport({ tables, insights, stats: { tables: tables.length, relations: 0 }, date: new Date(0), docName: name }, ['analysis']),
    );
    assert.doesNotMatch(
      html,
      /Des années sont réparties|Attribut utilisateur inexistant|Attribut utilisateur inutilisé|Copie possible dont les accès|Des lignes répètent les mêmes informations/,
      name,
    );
  });
}
