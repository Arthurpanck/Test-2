// Test d'interface du widget dans Chromium (Playwright).
// Usage : node tests/ui/run-ui.mjs <dossier des captures>
// - mode autonome (page ouverte seule) ;
// - mode Grist simulé : la page est chargée dans une iframe avec une API `grist` factice
//   qui renvoie les métadonnées de l'exemple, comme le ferait docApi.fetchTable().
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseGristCodeCorrected, metadataFromModel } from '../helpers.mjs';
import { EXAMPLE_CODE } from '../../assets/example.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.resolve(process.argv[2] || 'screenshots');
await mkdir(outDir, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__harness') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html><body style="margin:0"><iframe src="/index.html" style="border:0;width:100vw;height:100vh"></iframe></body></html>`);
    return;
  }
  try {
    const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// Derrière un proxy HTTPS, le serveur local doit rester en accès direct.
const args = process.env.HTTPS_PROXY
  ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=127.0.0.1;localhost']
  : [];
const browser = await chromium.launch({ args });
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '✓' : '✗'} ${msg}`); };

async function newPage(viewport, { dark = false } = {}) {
  const context = await browser.newContext({ viewport, colorScheme: dark ? 'dark' : 'light', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push(`requête échouée : ${r.url()} (${r.failure()?.errorText})`));
  return { context, page, errors };
}

// ---------------------------------------------------------------------------
// 1. Mode autonome
// ---------------------------------------------------------------------------
{
  const { context, page, errors } = await newPage({ width: 1280, height: 800 });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  check(await page.locator('#standalone-notice').isVisible(), 'autonome : bandeau d\'information visible');
  check(await page.locator('#source-doc').isDisabled(), 'autonome : « Ce document » désactivé');
  await page.screenshot({ path: path.join(outDir, '01-autonome-vide.png') });

  await page.locator('[data-action="example"]').first().click();
  await page.waitForSelector('.code .ln');
  const dbml = await page.locator('.code').innerText();
  check(dbml.includes('Table Agents {'), 'exemple : DBML affiché');
  check((await page.locator('#summary').textContent()).includes('5 tables'), 'exemple : résumé affiché (5 tables)');
  check(await page.locator('#analysis-count').isVisible(), 'exemple : compteur d\'analyse visible (écarts)');
  await page.screenshot({ path: path.join(outDir, '02-exemple-dbml.png') });

  await page.locator('#btn-copy').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip.startsWith('Table Agents {'), 'copie : DBML dans le presse-papiers');

  await page.locator('#tab-analysis').click();
  await page.screenshot({ path: path.join(outDir, '03-exemple-analyse.png') });
  const analysis = await page.locator('#analysis-body').innerText();
  check(analysis.includes('Relation perdue'), 'analyse : relation perdue signalée');

  await page.locator('#tab-tables').click();
  await page.screenshot({ path: path.join(outDir, '04-exemple-tables.png') });
  await page.locator('#filter-input').fill('service');
  await page.waitForTimeout(300);
  check((await page.locator('.tbl').count()) >= 2, 'filtre : tables contenant « service »');
  await page.locator('#filter-input').fill('');

  await page.locator('#strict-toggle').evaluate((el) => el.click());
  await page.waitForTimeout(100);
  const corrected = await page.locator('#summary').textContent();
  check(corrected.includes('Conversion corrigée'), 'bascule : conversion corrigée');

  await page.locator('#tab-schema').click();
  await page.waitForSelector('#schema-body svg', { timeout: 30000 }).catch(() => {});
  check(await page.locator('#schema-body svg').count() === 1, 'schéma : SVG Mermaid rendu');
  await page.screenshot({ path: path.join(outDir, '05-schema.png') });

  await page.locator('#tab-dbml').click();
  await page.locator('#tab-dbml').press('ArrowRight');
  check(await page.locator('#tab-tables').getAttribute('aria-selected') === 'true', 'clavier : flèche droite change d\'onglet');
  check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

// ---------------------------------------------------------------------------
// 2. Petit format et thème sombre
// ---------------------------------------------------------------------------
for (const [name, viewport, dark] of [['06-etroit', { width: 420, height: 900 }, false], ['07-sombre', { width: 1100, height: 760 }, true]]) {
  const { context, page, errors } = await newPage(viewport, { dark });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.locator('[data-action="example"]').first().click();
  await page.waitForSelector('.code .ln');
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: name === '06-etroit' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `${name} : pas de défilement horizontal de page (${overflow}px)`);
  if (dark) check(await page.evaluate(() => document.documentElement.dataset.frTheme) === 'dark', 'sombre : thème DSFR sombre appliqué');
  check(errors.length === 0, `${name} : aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

// ---------------------------------------------------------------------------
// 3. Dans Grist (API simulée)
// ---------------------------------------------------------------------------
{
  const meta = metadataFromModel(parseGristCodeCorrected(EXAMPLE_CODE));
  const { context, page, errors } = await newPage({ width: 1280, height: 800 });
  await context.route('https://docs.getgrist.com/grist-plugin-api.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '/* API simulée */' }));
  await context.addInitScript((m) => {
    if (window.self === window.top) return;
    const handlers = { options: [], record: [], records: [] };
    window.__updates = [];
    window.__options = {};
    window.grist = {
      ready(opts) { window.__ready = opts; setTimeout(() => {
        handlers.options.forEach((cb) => cb(null, {}));
        handlers.record.forEach((cb) => cb({ id: 7, Code: '' }, { code: null, dbml: 'DBML_genere' }));
      }, 50); },
      onOptions(cb) { handlers.options.push(cb); },
      onRecord(cb) { handlers.record.push(cb); },
      onRecords(cb) { handlers.records.push(cb); },
      setOption(k, v) { window.__options[k] = v; return Promise.resolve(); },
      docApi: { fetchTable: async (t) => {
        await new Promise((r) => setTimeout(r, 30));
        if (t === '_grist_Tables') return m.tables;
        if (t === '_grist_Tables_column') return m.cols;
        throw new Error('table inconnue');
      } },
      selectedTable: { update: async (rec) => { window.__updates.push(rec); } },
    };
  }, meta);
  await page.goto(`${base}/__harness`, { waitUntil: 'networkidle' });
  const frame = page.frames().find((f) => f.url().endsWith('/index.html'));
  await frame.waitForSelector('.code .ln', { timeout: 10000 });
  check(await frame.evaluate(() => window.__ready?.requiredAccess) === 'full', 'Grist : accès complet demandé');
  check((await frame.locator('#doc-status').innerText()).includes('4 tables'), 'Grist : structure lue (4 tables)');
  const dbml = await frame.locator('.code').innerText();
  check(dbml.includes('Table Interventions_Summary {'), 'Grist : table de synthèse reconstituée');
  check(await frame.locator('#btn-save').isVisible(), 'Grist : bouton d\'enregistrement visible (colonne liée)');
  await page.screenshot({ path: path.join(outDir, '08-grist-document.png') });
  await frame.locator('#btn-save').click();
  await page.waitForTimeout(100);
  const updates = await frame.evaluate(() => window.__updates);
  check(updates.length === 1 && updates[0].id === 7 && updates[0].fields.DBML_genere.startsWith('Table Agents'), 'Grist : DBML enregistré dans la ligne');

  await frame.locator('#btn-edit-code').click();
  check(await frame.locator('#panel-code').isVisible(), 'Grist : « Modifier comme code » bascule en code collé');
  const code = await frame.locator('#code-input').inputValue();
  check(code.startsWith('import grist') && code.includes('class _Summary:'), 'Grist : Vue du code reconstituée');
  check(await frame.evaluate(() => window.__options.source) === 'code', 'Grist : option « source » enregistrée');
  await page.screenshot({ path: path.join(outDir, '09-grist-code.png') });
  check(errors.length === 0, `Grist : aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

await browser.close();
server.close();
if (failures.length) {
  console.error(`\n${failures.length} échec(s)`);
  process.exit(1);
}
console.log('\nTous les contrôles d\'interface passent.');
