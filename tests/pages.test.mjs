// Pages et widgets : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPages, pageInsights } from '../assets/pages.js';
import { definition, metadataFromDefinition } from './fixtures/mal-structure.mjs';

const model = () => { const m = metadataFromDefinition(definition); return buildPages({ pages: m.pages, views: m.views, sections: m.sections, tables: m.tables }); };

test('pages dans l\'ordre du menu, widgets typés et liés', () => {
  const m = model();
  const suivi = m.pages.find((p) => p.name === 'Suivi clients');
  assert.deepEqual(suivi.widgets.map((w) => w.typeLabel), ['Tableau', 'Fiche', 'Graphique (barres)']);
  assert.equal(suivi.widgets[1].linkedTo, 'Clients');
  const audit = m.pages.find((p) => p.name === 'Audit (widget)');
  assert.equal(audit.indentation, 1);
  assert.deepEqual([audit.widgets[0].typeLabel, audit.widgets[0].custom.host, audit.widgets[0].custom.access], ['Widget personnalisé', 'raw.githack.com', 'full']);
  assert.deepEqual(m.tablesWithoutPage, ['Brouillon', 'Test']);
});

test('constats : nom de page par défaut, widget externe en accès complet, table sans page', () => {
  const items = pageInsights(model());
  const ids = items.map((i) => i.id);
  assert.deepEqual(ids, ['page-default-name', 'widget-full-access', 'table-without-page']);
  assert.equal(items.find((i) => i.id === 'widget-full-access').severity, 'choice');
  assert.ok(items.every((i) => i.area === 'pages'));
});
