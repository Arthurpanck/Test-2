// Tests du rapport Word : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as docx from 'docx';
import JSZip from 'jszip';
import { convertAll, schemaFromMetadata, computeStats } from '../assets/converter.js';
import { buildInsights } from '../assets/insights.js';
import { buildReport, renderDocx, renderHtml, readTheme, REPORT_SECTIONS } from '../assets/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// PNG 1×1 valide, pour remplacer l'image du schéma (produite par le navigateur).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function context() {
  const meta = JSON.parse(readFileSync(path.join(here, 'fixtures/document-test-grist.metadata.json'), 'utf8'));
  const out = convertAll({ schema: schemaFromMetadata(meta.tables, meta.columns) }).corrected;
  return {
    docName: 'Test widget DBML (DSFR)', date: new Date(2026, 9, 26, 14, 5),
    stats: computeStats(out.tables), tables: out.tables, insights: buildInsights(out.tables), dbml: out.dbml,
    schema: { png: PNG, width: 1600, height: 900 },
  };
}

async function docxXml(blocks, theme = readTheme(null)) {
  const buf = await docx.Packer.toBuffer(renderDocx(blocks, theme, docx));
  const zip = await JSZip.loadAsync(buf);
  return { buf, zip, xml: await zip.file('word/document.xml').async('string'), styles: await zip.file('word/styles.xml').async('string') };
}

test('le rapport Word contient toutes les sections et les données du document', async () => {
  const ctx = context();
  const { buf, zip, xml } = await docxXml(buildReport(ctx));
  mkdirSync(path.join(here, '..', 'captures'), { recursive: true });
  writeFileSync(path.join(here, '..', 'captures', 'rapport-test.docx'), buf);
  for (const s of REPORT_SECTIONS) assert.ok(xml.includes(`>${s.title}<`), `section « ${s.title} »`);
  for (const t of ctx.tables) assert.ok(xml.includes(`>${t.name}<`) || xml.includes(`>${t.name} (synthèse)<`), `table ${t.name}`);
  assert.ok(xml.includes('Prêt pour l&apos;import') || xml.includes("Prêt pour l'import"), 'verdict');
  assert.ok(xml.includes('Comment corriger dans Grist'), 'étapes de correction');
  assert.ok(xml.includes('Echeance integer [ref: &gt; Dates_cles.id]'), 'code DBML');
  assert.ok(xml.includes('sans type'), 'type lisible pour les formules sans type');
  assert.ok(Object.keys(zip.files).some((f) => f.startsWith('word/media/')), 'image du schéma intégrée');
});

test('le choix des sections est respecté', async () => {
  const { xml } = await docxXml(buildReport(context(), ['summary', 'dbml']));
  assert.ok(xml.includes('>Résumé<') && xml.includes('>Code DBML<'));
  assert.ok(!xml.includes('>Analyse<') && !xml.includes('>Tables et colonnes<'));
});

test('le Word suit le thème du design (variables --doc-*)', async () => {
  const fake = { getPropertyValue: (k) => ({ '--doc-primary': '#123456', '--doc-font': '"Spectral", serif' }[k] || '') };
  const theme = readTheme(fake);
  assert.equal(theme.primary, '#123456');
  assert.equal(theme.font, 'Spectral');
  const { xml, styles } = await docxXml(buildReport(context(), ['tables']), theme);
  assert.ok(xml.includes('w:fill="123456"'), 'en-têtes de tableau à la couleur primaire');
  assert.ok(styles.includes('w:ascii="Spectral"'), 'police du design');
  assert.ok(styles.includes('w:val="123456"'), 'titres à la couleur primaire');
});

test('l\'aperçu HTML reprend les mêmes blocs', () => {
  const html = renderHtml(buildReport(context()), { imageUrl: () => 'schema.png' });
  for (const s of REPORT_SECTIONS) assert.ok(html.includes(`>${s.title}</h2>`), s.title);
  assert.ok(html.includes('<img src="schema.png"'));
});
