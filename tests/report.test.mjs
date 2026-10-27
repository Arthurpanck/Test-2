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
import { buildAccess } from '../assets/access.js';
import { buildReport, renderDocx, renderHtml, readTheme, REPORT_SECTIONS } from '../assets/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// PNG 1×1 valide, pour remplacer l'image du schéma (produite par le navigateur).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Métadonnées d'une fixture ; valeurs par défaut rétablies (fixture compacte du document complexe). */
export function loadMeta(name) {
  const m = JSON.parse(readFileSync(path.join(here, 'fixtures', name), 'utf8'));
  const cols = m.columns.id ? m.columns : m.columns.map((c) => ({
    parentPos: c.id, label: c.colId, formula: '', reverseCol: 0, description: '', widgetOptions: '', recalcWhen: 0, recalcDeps: null, isFormula: 0, ...c,
  }));
  return { tables: m.tables, columns: cols, sections: m.sections || [], acl: m.aclResources ? { resources: m.aclResources, rules: m.aclRules } : { resources: [], rules: [] } };
}

function context(name = 'document-test-grist.metadata.json') {
  const meta = loadMeta(name);
  const schema = schemaFromMetadata(meta.tables, meta.columns, { sections: meta.sections });
  const out = convertAll({ schema }).corrected;
  const access = buildAccess({ ...meta.acl, schema });
  return {
    docName: 'Test widget DBML (DSFR)', date: new Date(2026, 9, 26, 14, 5),
    stats: computeStats(out.tables), tables: out.tables, insights: buildInsights(out.tables, access), access, dbml: out.dbml,
    schema: { png: PNG, width: 1600, height: 900 },
  };
}
const has = (xml, text) => [text, text.replace(/'/g, '&apos;'), text.replace(/'/g, '&#39;')].some((t) => xml.includes(t));

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
  for (const s of REPORT_SECTIONS) assert.ok(has(xml, `>${s.title}<`), `section « ${s.title} »`);
  for (const t of ctx.tables) assert.ok(xml.includes(`>${t.name}<`) || xml.includes(`>${t.name} (synthèse)<`), `table ${t.name}`);
  assert.ok(xml.includes('Aucun problème bloquant détecté'), 'verdict');
  assert.ok(xml.includes('Comment corriger dans Grist'), 'étapes de correction');
  assert.ok(!xml.includes('>Code DBML<'), 'plus de section DBML');
  assert.ok(xml.includes('>Non défini<') && xml.includes('>Référence multiple<') && xml.includes('>Date et Heure<'), 'types de colonnes en français');
  assert.ok(Object.keys(zip.files).some((f) => f.startsWith('word/media/')), 'image du schéma intégrée');
});

test('le choix des sections est respecté', async () => {
  const { xml } = await docxXml(buildReport(context(), ['summary', 'access']));
  assert.ok(xml.includes('>Résumé<') && (xml.includes('>Droits d&apos;accès<') || xml.includes(">Droits d'accès<")));
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
  for (const s of REPORT_SECTIONS) assert.ok(has(html, ` ${s.title}</h2>`), s.title);
  assert.ok(html.includes('<img src="schema.png"'));
});

test('document complexe : droits d\'accès, formules et détails dans le Word', async () => {
  const ctx = context('document-complexe.metadata.json');
  const { buf, xml } = await docxXml(buildReport(ctx));
  writeFileSync(path.join(here, '..', 'captures', 'rapport-complexe.docx'), buf);
  assert.ok(has(xml, 'Structure et droits d\'accès'), 'titre adapté aux sections');
  assert.ok(has(xml, '>Droits d\'accès<'), 'section droits d\'accès');
  assert.ok(xml.includes('user.Habilitation'), 'attribut utilisateur');
  assert.ok(xml.includes('Fiches réservées au service RH.'), 'message de refus');
  assert.ok(xml.includes('>Refusé<') && xml.includes('>Autorisé<'), 'permissions en clair');
  assert.ok(has(xml, 'Formule d\'initialisation') && xml.includes('NOW()'), 'formule d\'initialisation');
  assert.ok(xml.includes('quand cette colonne change : Statut'), 'déclenchement sur une colonne');
  assert.ok(xml.includes('Catégorie A · Catégorie B'), 'choix');
  assert.ok(xml.includes('choice.Service == $Projet.Service_pilote'), 'liste filtrée');
  assert.ok(xml.includes('Données RH sensibles'), 'description de table');
  assert.ok(xml.includes('user.Profil'), 'attribut inexistant signalé');
});

test('sommaire cliquable : liens internes vers des signets sur chaque titre', async () => {
  const { xml } = await docxXml(buildReport(context()));
  const anchors = [...xml.matchAll(/w:hyperlink[^>]*w:anchor="(sec\d+)"/g)].map((m) => m[1]);
  const marks = new Set([...xml.matchAll(/w:bookmarkStart[^>]*w:name="(sec\d+)"/g)].map((m) => m[1]));
  assert.ok(anchors.length >= 5, `${anchors.length} entrées`);
  assert.ok(anchors.every((a) => marks.has(a)), 'chaque entrée mène à un signet');
  assert.ok(xml.includes('>Table des matières<'));
  assert.ok(xml.includes('PAGEREF sec1') && xml.includes('w:leader="dot"'), 'numéros de page et points de conduite');
  assert.ok(xml.includes('>1.  <') || xml.includes('1.\t'), 'titres numérotés');
});

test('section Widgets : widgets personnalisés détaillés, tableaux exclus, dans le sommaire', async () => {
  const { buildPages, pageInsights } = await import('../assets/pages.js');
  const { definition, metadataFromDefinition } = await import('./fixtures/mal-structure.mjs');
  const m = metadataFromDefinition(definition);
  const pages = buildPages({ pages: m.pages, views: m.views, sections: m.sections, tables: m.tables });
  const ctx = { ...context(), pages, insights: { ...context().insights, items: pageInsights(pages) } };
  const blocks = buildReport(ctx, ['summary', 'pages']);
  const toc = blocks.find((b) => b.type === 'toc');
  assert.deepEqual(toc.entries.filter((e) => e.level === 2).map((e) => e.text).slice(1), ['Widgets non officiels', 'Widgets personnalisés', 'Fiches, listes, graphiques et formulaires', 'Points d\'attention']);
  const { xml } = await docxXml(blocks);
  for (const t of ['Tableau croisé dynamique', 'widgets.exemple.fr', 'Code dans le document', '• Name → à associer', 'Fiche client', 'Accès complet au document']) assert.ok(xml.includes(t), t);
  assert.ok(!xml.includes('>Tableau<'), 'aucun widget « Tableau » listé');
});
