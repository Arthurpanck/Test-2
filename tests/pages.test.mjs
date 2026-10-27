// Widgets : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPages, pageInsights, originText, typeCounts } from '../assets/pages.js';
import { definition, metadataFromDefinition } from './fixtures/mal-structure.mjs';

const SELF = 'https://raw.githack.com/Arthurpanck/Test-2/main/index.html?v=2.4.0';
const model = () => { const m = metadataFromDefinition(definition); return buildPages({ pages: m.pages, views: m.views, sections: m.sections, tables: m.tables, selfUrl: SELF }); };

test('les tableaux sont comptés mais pas détaillés', () => {
  const m = model();
  assert.ok(m.tableWidgetCount >= 8);
  assert.ok([...m.custom, ...m.views].every((w) => w.type !== 'record'));
  assert.deepEqual(m.views.map((w) => w.typeLabel), ['Fiche', 'Graphique (barres)']);
  assert.equal(m.views[0].linkedTo, 'Clients');
  assert.ok(m.tableOnlyPages.includes('Commandes') && !m.tableOnlyPages.includes('Suivi clients'));
  assert.deepEqual(m.tablesWithoutPage, ['Brouillon', 'Test']);
  assert.equal(typeCounts(m), '1 fiche, 1 graphique (barres), 2 widgets personnalisés, 3 widgets non officiels');
  assert.deepEqual([m.unofficial.length, m.gallery.length], [3, 2]);
});

test('widgets personnalisés : origine, auteur, accès, colonnes manquantes', () => {
  const by = Object.fromEntries(model().custom.map((w) => [w.id, w.custom]));
  assert.equal(by[2004].origin, 'self');
  assert.deepEqual([by[2005].origin, by[2005].name, by[2005].maintained], ['gallery', 'Carte', true]);
  assert.deepEqual(by[2005].missingColumns, ['Name', 'Longitude', 'Latitude']);
  assert.equal(originText(by[2006]), 'Galerie Grist — Tableau croisé dynamique (jperon, hors Grist Labs)');
  assert.deepEqual([by[2007].origin, by[2007].codeLines], ['document', 3]);
  assert.deepEqual([by[2008].origin, by[2008].host, by[2008].access], ['external', 'widgets.exemple.fr', 'full']);
});

test('constats sur les widgets', () => {
  const items = pageInsights(model());
  assert.deepEqual(items.map((i) => [i.id, i.severity]), [
    ['widget-unmapped', 'blocking'], ['page-default-name', 'improve'], ['widget-full-access', 'choice'],
    ['table-without-page', 'choice'], ['widget-community', 'info'], ['widget-in-document', 'info'],
  ]);
  const full = items.find((i) => i.id === 'widget-full-access');
  assert.equal(full.targets.length, 1, 'le widget d\'audit lui-même n\'est pas signalé');
  assert.ok(items.every((i) => i.area === 'pages'));
});
