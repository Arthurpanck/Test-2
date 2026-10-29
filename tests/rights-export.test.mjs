// Export Excel de « Qui peut faire quoi ? » : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { buildMatrix } from '../assets/rights-matrix.js';
import { matrixWorkbook, matrixXlsx } from '../assets/rights-export.js';
import { writeXlsx, colName, crc32 } from '../assets/xlsx.js';
import * as doc from './fixtures/droits-complexe.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mx = buildMatrix({ resources: doc.resources, rules: doc.rules }, doc.tables, doc.habilitations);
const date = new Date(2026, 9, 29, 17, 20);

test('écrivain xlsx : lettres de colonnes, CRC, zip lisible', async () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(colName), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const buf = writeXlsx({ sheets: [{ name: 'Essai: [1]', rows: [{ cells: ['a & <b>', 2, null, { v: 'x', s: 'gras' }] }] }], styles: { gras: { font: { bold: true } } } });
  const zip = await JSZip.loadAsync(buf);
  for (const f of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']) assert.ok(zip.file(f), f);
  assert.match(await zip.file('xl/workbook.xml').async('string'), /name="Essai\s+1\s*"/, 'nom de feuille nettoyé');
  assert.match(await zip.file('xl/sharedStrings.xml').async('string'), /a &amp; &lt;b&gt;/);
  assert.throws(() => writeXlsx({ sheets: [{ name: 'a', rows: [{ cells: [{ v: 1, s: 'absent' }] }] }] }), /Style inconnu/);
});

test('matrice : groupes, structure, filtres, volets figés, couleurs', async () => {
  const wb = matrixWorkbook(mx, { docName: 'Test widget – document complexe', date });
  const [m, d, p] = wb.sheets;
  assert.deepEqual(wb.sheets.map((s) => s.name), ['Qui peut faire quoi', 'Détail par case', 'Paramètres']);
  const text = (r) => m.rows[r].cells.map((c) => (c && typeof c === 'object' ? c.v : c));
  assert.equal(text(4)[3], 'RH\nHabilitation.Role = « RH » · 7 services');
  assert.deepEqual(text(5).filter(Boolean), ['Droits de structure : tables, colonnes et formules', 'Oui', 'Oui', 'Oui']);
  assert.deepEqual(text(6).slice(0, 7), ['Niveau', 'Table', 'Colonne', 'Lire', 'Modifier', 'Créer', 'Supprimer']);
  assert.equal(m.autoFilter, `A7:O${m.rows.length}`);
  assert.deepEqual(m.freeze, { rows: 7, cols: 3 });
  const row = (key) => m.rows.find((r) => r.cells[1]?.v === key.split('.')[0] && (r.cells[2]?.v || '') === (key.split('.')[1] || ''));
  assert.deepEqual(row('Agents').cells.slice(7, 11).map((c) => c.v), ['Email', 'Non', 'Non', 'Non']);
  assert.deepEqual(row('Agents').cells.slice(7, 9).map((c) => c.s), ['ok', 'ko']);
  assert.deepEqual(row('Agents.Quotite').cells.slice(3, 7).map((c) => c.v), ['Oui', 'Oui', '—', '—']);
  assert.equal(row('Agents.Quotite').cells[0].v, 'Colonne');
  assert.equal(row('Formations').cells[4].s, 'uk');
  assert.equal(m.rows.length, 7 + 22 + 4, 'tables puis colonnes à règles');
  // Détail : une ligne par case (structure, 4 actions par table, Lire et Modifier par colonne), en tableau Excel
  assert.equal(d.rows.length - 1, 3 * (1 + 22 * 4 + 4 * 2));
  assert.equal(d.table.ref, `A1:J${d.rows.length}`);
  const agentsF = d.rows.find((r) => r.cells[0].v === 'Finances' && r.cells[2].v === 'Agents' && r.cells[4].v === 'Lire').cells.map((c) => c.v);
  assert.deepEqual(agentsF.slice(5, 9), ['Sous condition', 'Email', 'Oui, seulement sur les lignes de son Email.', 'Règle 7 · refuse tout']);
  assert.match(agentsF[9], /^1\. Règle 4 · autorise tout — Ne s'applique pas — user\.Access in \[OWNER\]\n/);
  assert.ok(p.rows.some((r) => r.cells[0]?.v === 'Formations · Modifier'), 'cases à vérifier');
});

test('fichier .xlsx : parties, tableau, filtre nommé, titres d\'impression', async () => {
  const buf = matrixXlsx(mx, { docName: 'Test widget – document complexe', date });
  mkdirSync(path.join(here, '..', 'captures'), { recursive: true });
  writeFileSync(path.join(here, '..', 'captures', 'qui-peut-faire-quoi.xlsx'), buf);
  const zip = await JSZip.loadAsync(buf);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  assert.match(wbXml, /_xlnm\._FilterDatabase" localSheetId="0" hidden="1">'Qui peut faire quoi'!\$A\$7:\$O\$33</);
  assert.match(wbXml, /_xlnm\.Print_Titles" localSheetId="0">'Qui peut faire quoi'!\$5:\$7</);
  const table = await zip.file('xl/tables/table1.xml').async('string');
  assert.match(table, /name="Droits" displayName="Droits" ref="A1:J\d+"/);
  assert.match(table, /<tableColumn id="6" name="Résultat"\/>/);
  const s1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(s1, /<pane xSplit="3" ySplit="7" topLeftCell="D8" activePane="bottomRight" state="frozen"\/>/);
  assert.match(s1, /<mergeCell ref="D5:G5"\/>/);
  assert.match(s1, /orientation="landscape"/);
  const styles = await zip.file('xl/styles.xml').async('string');
  assert.ok(styles.includes('FFDFFEE6') && styles.includes('FFFFE9E9') && styles.includes('FF000091'));
  assert.ok(zip.file('xl/worksheets/_rels/sheet2.xml.rels'));
});
