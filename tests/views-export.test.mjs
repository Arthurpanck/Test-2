// Export Excel de l'onglet Vues : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildPages } from '../assets/pages.js';
import { viewsWorkbook, viewsXlsx, viewAttention } from '../assets/views-export.js';
import { definition, metadataFromDefinition } from './fixtures/mal-structure.mjs';

const SELF = 'https://raw.githack.com/Arthurpanck/Test-2/main/index.html?v=3.14.0';
const date = new Date(2026, 10, 9, 10, 30);
const model = () => {
  const m = metadataFromDefinition(definition);
  return buildPages({ pages: m.pages, views: m.views, sections: m.sections, tables: m.tables, selfUrl: SELF });
};
const texts = (sheet) => sheet.rows.map((r) => r.cells.map((c) => (c && typeof c === 'object' ? c.v : c)));

test('vues : une page par bloc, toutes les vues, puis le reste ; feuille filtrable et paramètres', async () => {
  const m = model();
  const wb = viewsWorkbook(m, { docName: 'Doc', date });
  assert.deepEqual(
    wb.sheets.map((s) => s.name),
    ['Vues', 'Toutes les vues', 'Paramètres'],
  );
  const main = texts(wb.sheets[0]);
  assert.match(main[0][0], new RegExp(`^Vues du document · ${m.pages.length} pages, ${m.widgetCount} vues$`));
  assert.match(main[1][0], /^Doc · lu le 9 novembre 2026/);
  // Un bloc par page, dans l'ordre du document, puis les deux listes du bas de l'onglet
  const titles = wb.sheets[0].rows.filter((r) => r.cells[0]?.s === 'page').map((r) => r.cells[0].v.replace(/^↳ /, ''));
  assert.deepEqual(titles, [
    ...m.pages.map((p) => p.name || '(sans nom)'),
    'Pages qui ne contiennent que des tableaux',
    'Tables affichées sur aucune page',
  ]);
  assert.ok(main.some((r) => r[0] === 'Brouillon'));
  // Inventaire complet : les tableaux sont listés aussi
  const flat = texts(wb.sheets[1]);
  assert.equal(flat.length - 1, m.widgetCount);
  assert.equal(flat.filter((r) => r[2] === 'Tableau').length, m.tableWidgetCount);
  // Vue externe avec accès complet : pastille rouge, adresse, colonnes associées
  const ext = m.custom.find((w) => w.custom.origin === 'external');
  const extRow = wb.sheets[1].rows.find((r) => r.cells[8]?.v === ext.custom.url);
  assert.ok(extRow, 'adresse de la vue externe');
  assert.equal(extRow.cells[6].s, 'ko', 'accès complet donné à un site externe');
  assert.equal(extRow.cells[9].s, 'ko');
  // Vue de la galerie avec des champs à associer
  const map = m.gallery.find((w) => w.custom.missingColumns.length);
  const mapRow = wb.sheets[1].rows.find(
    (r) => r.cells[1]?.v === (map.title || map.table || map.typeLabel) && r.cells[2]?.v === map.typeLabel,
  );
  assert.match(mapRow.cells[7].v, /Name → à associer/);
  assert.match(mapRow.cells[9].v, /^3 champs à associer/);

  const zip = await JSZip.loadAsync(viewsXlsx(m, { docName: 'Doc', date }));
  assert.ok(zip.file('xl/tables/table1.xml'), 'tableau Excel filtrable');
  assert.ok(zip.file('xl/worksheets/sheet3.xml'));
});

test('points à vérifier : les badges de l’onglet Vues', () => {
  const by = Object.fromEntries(model().custom.map((w) => [w.id, w]));
  assert.deepEqual(viewAttention(by[2004]), ["Cette vue d'audit", 'ok']);
  assert.deepEqual(viewAttention(by[2005]), ['3 champs à associer', 'ko']);
  assert.deepEqual(viewAttention(by[2006])[1], 'warn');
  assert.deepEqual(viewAttention(by[2007]), ['Code dans le document', 'warn']);
  assert.deepEqual(viewAttention(by[2008]), ['Site externe, accès complet', 'ko']);
  assert.equal(viewAttention({ type: 'single', custom: null }), null);
});

test('document sans page : classeur valide, sans tableau Excel vide', async () => {
  const m = buildPages({});
  const wb = viewsWorkbook(m, { docName: 'Vide', date });
  assert.ok(!wb.sheets[1].table);
  assert.ok((await JSZip.loadAsync(viewsXlsx(m, { date }))).file('xl/workbook.xml'));
});
