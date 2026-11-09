// Export Excel complet (onglet Rapport) et assemblage de classeurs : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { fullWorkbook, fullXlsx } from '../assets/full-export.js';
import { combineWorkbooks } from '../assets/xlsx-kit.js';
import { writeXlsx } from '../assets/xlsx.js';
import { buildPages } from '../assets/pages.js';
import { buildAccess, generalSettings } from '../assets/access.js';
import { buildMatrix } from '../assets/rights-matrix.js';
import { convertSchema, computeStats, schemaFromMetadata } from '../assets/converter.js';
import * as rights from './fixtures/droits-complexe.mjs';
import { definition, metadataFromDefinition } from './fixtures/mal-structure.mjs';

const date = new Date(2026, 10, 9, 10, 30);
const texts = (sheet) => sheet.rows.map((r) => r.cells.map((c) => (c && typeof c === 'object' ? c.v : c)));

test('assemblage : styles préfixés, noms de feuilles et de tableaux uniques', () => {
  const a = {
    styles: { x: { font: { bold: true } } },
    sheets: [{ name: 'Paramètres', rows: [{ cells: [{ v: 1, s: 'x' }] }], table: { name: 'T', ref: 'A1:A1' } }],
  };
  const b = {
    styles: { x: { font: { italic: true } } },
    sheets: [{ name: 'Paramètres', rows: [{ cells: [{ v: 2, s: 'x' }, 'brut'] }], table: { name: 'T', ref: 'A1:A1' } }],
  };
  const wb = combineWorkbooks([
    { book: a, label: 'tables' },
    { book: b, label: 'vues' },
  ]);
  assert.deepEqual(
    wb.sheets.map((s) => s.name),
    ['Paramètres', 'Paramètres · vues'],
  );
  assert.deepEqual(
    wb.sheets.map((s) => s.table.name),
    ['T', 'T_vues'],
  );
  assert.equal(wb.sheets[1].rows[0].cells[0].s, 'b1.x');
  assert.equal(wb.sheets[1].rows[0].cells[1], 'brut');
  assert.deepEqual(wb.styles['b1.x'], { font: { italic: true } });
  assert.ok(writeXlsx(wb).length > 0);
});

test('classeur complet : sommaire, puis tables, accès et vues avec leurs paramètres', async () => {
  const m = metadataFromDefinition(definition);
  const out = convertSchema(schemaFromMetadata(m.tables, m.cols, { sections: m.sections }));
  const access = buildAccess({ resources: rights.resources, rules: rights.rules });
  const data = {
    tables: out.tables,
    access,
    settings: generalSettings(access),
    mx: buildMatrix({ resources: rights.resources, rules: rights.rules }, rights.tables, rights.habilitations),
    pages: buildPages({ pages: m.pages, views: m.views, sections: m.sections, tables: m.tables }),
    stats: computeStats(out.tables),
  };
  const wb = fullWorkbook(data, { docName: 'Doc', date });
  assert.deepEqual(
    wb.sheets.map((s) => s.name),
    [
      'Sommaire',
      'Tables',
      'Toutes les colonnes',
      'Paramètres · tables',
      "Droits d'accès",
      'Qui peut faire quoi',
      'Paramètres · accès',
      'Vues',
      'Toutes les vues',
      'Paramètres · vues',
    ],
  );
  const cover = texts(wb.sheets[0]);
  assert.equal(cover[0][0], 'Audit de structure · Doc');
  // Une ligne par feuille dans le sommaire, avec son contenu
  const from = cover.findIndex((r) => r[0] === 'Feuille') + 1;
  const listed = cover.slice(from, from + wb.sheets.length - 1);
  assert.deepEqual(
    listed.map((r) => r[0]),
    wb.sheets.slice(1).map((s) => s.name),
  );
  assert.ok(
    listed.every((r) => r[1]),
    'contenu de chaque feuille',
  );
  assert.ok(
    cover.some((r) => r[0] === 'Tables' && /^\d+ tables$/.test(r[1])),
    'chiffres clés',
  );
  const zip = await JSZip.loadAsync(fullXlsx(data, { docName: 'Doc', date }));
  assert.ok(zip.file('xl/worksheets/sheet10.xml'));
  assert.ok(zip.file('xl/tables/table2.xml'), 'deux tableaux Excel filtrables (colonnes, vues)');
});

test('classeur complet sans règles ni pages : parties absentes signalées', () => {
  const m = metadataFromDefinition(definition);
  const out = convertSchema(schemaFromMetadata(m.tables, m.cols, { sections: m.sections }));
  const wb = fullWorkbook({ tables: out.tables }, { docName: 'Doc', date });
  assert.deepEqual(
    wb.sheets.map((s) => s.name),
    ['Sommaire', 'Tables', 'Toutes les colonnes', 'Paramètres · tables'],
  );
  const cover = texts(wb.sheets[0]).flat().join(' | ');
  assert.match(cover, /n’a pas de règles d’accès/);
  assert.match(cover, /pages du document n’ont pas pu être lues/);
});
