// Exports Excel des tables et des règles d'accès : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { tablesWorkbook, tablesXlsx } from '../assets/tables-export.js';
import { rulesWorkbook, rulesXlsx } from '../assets/rights-export.js';
import { buildAccess, generalSettings } from '../assets/access.js';
import * as doc from './fixtures/droits-complexe.mjs';

const date = new Date(2026, 10, 9, 10, 30);
const tables = [
  {
    name: 'Agents',
    kind: 'table',
    description: 'Une ligne par agent.',
    columns: [
      { name: 'Nom', label: 'Nom', gristType: { name: 'Text' }, isFormula: false, details: { description: 'Nom de naissance' } },
      { name: 'Total', label: 'Total', gristType: { name: 'Numeric' }, isFormula: true, details: { formula: '$A + $B' } },
    ],
  },
];
const texts = (sheet) => sheet.rows.map((r) => r.cells.map((c) => (c && typeof c === 'object' ? c.v : c)));

test('tables : descriptions reprises, pastilles, feuilles de détail et de paramètres', async () => {
  const wb = tablesWorkbook(tables, { docName: 'Doc', date });
  assert.deepEqual(
    wb.sheets.map((s) => s.name),
    ['Tables', 'Toutes les colonnes', 'Paramètres'],
  );
  const flat = texts(wb.sheets[1]);
  assert.equal(flat[0].at(-1), 'Description');
  assert.deepEqual(
    flat.find((r) => r[1] === 'Nom'),
    ['Agents', 'Nom', '', 'TEXT', 'Texte', 'Donnée', 'Non calculé', '', '—', 'Nom de naissance'],
  );
  const total = wb.sheets[0].rows.find((r) => r.cells[0]?.v === 'Total');
  assert.equal(total.cells[7].v, 'Pas de documentation');
  assert.equal(total.cells[7].s, 'noDoc');
  assert.ok(
    texts(wb.sheets[0]).some((r) => r[0] === 'Une ligne par agent.'),
    'description de la table',
  );
  assert.match(texts(wb.sheets[0])[1][0], /^Doc · lu le 9 novembre 2026/);
  const zip = await JSZip.loadAsync(tablesXlsx(tables, { docName: 'Doc', date }));
  assert.ok(zip.file('xl/tables/table1.xml'));
});

test('règles d’accès : une ligne par condition, réglages et attributs, au nom du document', async () => {
  const access = buildAccess({ resources: doc.resources, rules: doc.rules });
  const wb = rulesWorkbook(access, generalSettings(access), { docName: 'Doc', date });
  assert.deepEqual(
    wb.sheets.map((s) => s.name),
    ["Règles d'accès", 'Réglages et attributs'],
  );
  const rows = texts(wb.sheets[0]);
  assert.match(rows[0][0], /^Règles d'accès · \d+ conditions$/);
  const header = rows.findIndex((r) => r[0] === 'Table');
  assert.equal(wb.sheets[0].table.ref.split(':')[0], `A${header + 1}`, 'tableau Excel à partir de la ligne d’en-tête');
  const agents = rows.find((r) => r[0] === 'Agents' && r[1] === 'Quotite, Derniere_connexion');
  assert.deepEqual(agents.slice(5, 7), ['Refusé', '—']);
  assert.ok(texts(wb.sheets[1]).some((r) => r[0] === 'user.Habilitation'));
  const zip = await JSZip.loadAsync(rulesXlsx(access, generalSettings(access), { docName: 'Doc', date }));
  assert.ok(zip.file('xl/tables/table1.xml'));
});
