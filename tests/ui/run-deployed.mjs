// Test de la version PUBLIÉE du widget (URL réelle), dans une iframe comme dans Grist,
// avec les métadonnées réelles d'un document (tests/fixtures/*.metadata.json).
// Usage : node tests/ui/run-deployed.mjs <url du widget> <dossier des captures> [fixture.metadata.json]
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const widgetUrl = process.argv[2];
const outDir = path.resolve(process.argv[3] || 'captures');
const metaFile = process.argv[4] || 'document-test-grist.metadata.json';
if (!widgetUrl) throw new Error('URL du widget requise');
await mkdir(outDir, { recursive: true });
const meta = JSON.parse(await readFile(path.join(root, 'tests/fixtures', metaFile), 'utf8'));

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><html><body style="margin:0"><iframe src="${widgetUrl}" style="border:0;width:100vw;height:100vh"></iframe></body></html>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const args = process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=127.0.0.1;localhost'] : [];
const browser = await chromium.launch({ args });
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '✓' : '✗'} ${msg}`); };

const context = await browser.newContext({ viewport: { width: 1512, height: 793 } });
await context.route('https://docs.getgrist.com/grist-plugin-api.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
await context.addInitScript(({ m }) => {
  if (window.self === window.top) return;
  window.__options = {};
  const handlers = { options: [], record: [], records: [] };
  window.grist = {
    ready(opts) { window.__ready = opts; setTimeout(() => { handlers.options.forEach((cb) => cb(null, {})); handlers.record.forEach((cb) => cb(null, null)); }, 30); },
    onOptions(cb) { handlers.options.push(cb); },
    onRecord(cb) { handlers.record.push(cb); },
    onRecords(cb) { handlers.records.push(cb); },
    setOption(k, v) { window.__options[k] = v; return Promise.resolve(); },
    docApi: { fetchTable: async (t) => (t === '_grist_Tables' ? m.tables : m.columns) },
    selectedTable: { update: async () => {} },
  };
}, { m: meta });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
const frame = page.frames().find((f) => f.url().startsWith(widgetUrl.split('?')[0]));
check(Boolean(frame), `widget chargé depuis ${widgetUrl}`);
const t0 = Date.now();
await frame.waitForSelector('.erd-node', { timeout: 30000 });
await frame.waitForFunction(() => !document.querySelector('.erd__status')?.textContent, null, { timeout: 30000 });
console.log(`  schéma prêt en ${Date.now() - t0} ms (ELK depuis le CDN)`);
const info = await frame.evaluate(() => ({
  nodes: document.querySelectorAll('.erd-node').length,
  edges: document.querySelectorAll('.erd-edge').length,
  engine: document.querySelector('.erd').dataset.layoutEngine,
}));
check(info.nodes > 0 && info.edges > 0, `${info.nodes} tables et ${info.edges} relations dessinées`);
check(info.engine === 'worker', `moteur de disposition en Web Worker (${info.engine})`);
await page.screenshot({ path: path.join(outDir, 'deploye-schema.png') });
await frame.locator('label[for="detail-keys"]').click();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, 'deploye-relations.png') });
check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
await browser.close();
server.close();
if (failures.length) { console.error(`\n${failures.length} échec(s)`); process.exit(1); }
console.log('\nVersion publiée vérifiée.');
