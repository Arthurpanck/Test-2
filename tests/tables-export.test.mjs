// Exports Excel des tables et des règles d'accès : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { tablesWorkbook, tablesXlsx } from '../assets/tables-export.js';
import { accessWorkbook, accessXlsx } from '../assets/rights-export.js';
import { buildMatrix } from '../assets/rights-matrix.js';
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

test('droits d’accès : présentés comme les tables, avec la matrice en onglets', async () => {
  const access = buildAccess({ resources: doc.resources, rules: doc.rules });
  const mx = buildMatrix(
    { resources: doc.resources, rules: doc.rules },
    access.tables.map((t) => t.tableId),
  );
  const wb = accessWorkbook(access, generalSettings(access), mx, { docName: 'Doc', date });
  assert.deepEqual(
    wb.sheets.map((s) => s.name),
    ["Droits d'accès", 'Toutes les règles', 'Qui peut faire quoi', 'Détail par case', 'Paramètres'],
  );
  const main = texts(wb.sheets[0]);
  assert.match(main[0][0], /^Droits d'accès · \d+ conditions$/);
  // Blocs : réglages (dans l'ordre de Grist), attributs, défaut, puis chaque table
  const titles = wb.sheets[0].rows.filter((r) => r.cells[0]?.s === 'aTitle').map((r) => r.cells[0].v);
  assert.deepEqual(titles.slice(0, 3), ['Réglages généraux', 'Attributs utilisateur', 'Droits d’accès par défaut']);
  assert.ok(titles.includes('Agents'));
  const first = main.findIndex((r) => r[0] === 'Réglage');
  assert.deepEqual(
    main.slice(first + 1, first + 5).map((r) => r[0]),
    [
      'Permissions avancées',
      'Ajouter automatiquement une règle pour les propriétaires',
      'Autoriser les éditeurs à modifier la structure',
      'Autoriser tout le monde à voir les permissions avancées',
    ],
  );
  assert.ok(main.some((r) => r[0] === 'Colonnes Quotite, Derniere_connexion'));
  const flat = texts(wb.sheets[1]);
  const agents = flat.find((r) => r[0] === 'Agents' && r[1] === 'Quotite, Derniere_connexion');
  assert.deepEqual(agents.slice(5, 7), ['Refusé', '—']);
  assert.equal(wb.sheets[1].table.ref.split(':')[0], 'A1');
  const zip = await JSZip.loadAsync(accessXlsx(access, generalSettings(access), mx, { docName: 'Doc', date }));
  assert.ok(zip.file('xl/tables/table2.xml'), 'deux tableaux Excel : règles et détail de la matrice');
  // Excel ne recalcule pas la hauteur des lignes à l'ouverture : un texte long renvoyé à la ligne a une hauteur posée.
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const row = (n) => Number(new RegExp(`<row r="${n}" ht="([\\d.]+)"`).exec(sheet)?.[1] || 0);
  const structure = main.findIndex((r) => r[0] === 'Autoriser les éditeurs à modifier la structure') + 1;
  assert.ok(row(structure) >= 60, `ligne ${structure} : ${row(structure)}`);
});
