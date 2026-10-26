// Banc de test commun : serveur local + Chromium + Grist simulé.
// Le widget est chargé dans une iframe, avec une API `grist` factice qui renvoie
// des métadonnées réelles (docApi.fetchTable) et enregistre les écritures.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseGristCodeCorrected, metadataFromModel } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright');

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const fixture = (name) => readFile(path.join(root, 'tests/fixtures', name), 'utf8');

/** Métadonnées au format docApi.fetchTable, depuis une Vue du code ou un export JSON. */
export async function metadata(name) {
  if (name.endsWith('.mjs')) {
    const mod = await import(path.join(root, 'tests/fixtures', name));
    return mod.metadataFromDefinition(mod.definition);
  }
  if (name.endsWith('.json')) {
    const m = JSON.parse(await fixture(name));
    const cols = m.columns.id ? m.columns : m.columns.map((c) => ({
      parentPos: c.id, label: c.colId, formula: '', reverseCol: 0, description: '', widgetOptions: '', recalcWhen: 0, recalcDeps: null, isFormula: 0, ...c,
    }));
    return { tables: m.tables, cols, sections: m.sections || [], aclResources: m.aclResources || [], aclRules: m.aclRules || [] };
  }
  return metadataFromModel(parseGristCodeCorrected(await fixture(name)));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

export async function start(outDir) {
  await mkdir(outDir, { recursive: true });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__harness') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><body style="margin:0"><iframe src="/index.html" style="border:0;width:100vw;height:100vh"></iframe></body></html>');
      return;
    }
    try {
      const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const args = process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=127.0.0.1;localhost'] : [];
  const browser = await chromium.launch({ args });
  const failures = [];
  const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '✓' : '✗'} ${msg}`); };

  /**
   * Ouvre le widget dans un Grist simulé.
   * @param {object} o  meta, options (options du widget), mappings, viewport, dark, fail (fetchTable en erreur)
   */
  async function openWidget(o = {}) {
    const context = await browser.newContext({
      viewport: o.viewport || { width: 1400, height: 860 },
      colorScheme: o.dark ? 'dark' : 'light',
      acceptDownloads: true,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await context.route('https://docs.getgrist.com/grist-plugin-api.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await context.addInitScript((cfg) => {
      if (window.self === window.top) return;
      window.__options = {};
      window.__updates = [];
      const handlers = { options: [], record: [], records: [] };
      window.grist = {
        ready(opts) {
          window.__ready = opts;
          setTimeout(() => {
            handlers.options.forEach((cb) => cb(cfg.options || null, {}));
            handlers.record.forEach((cb) => cb({ id: 1 }, cfg.mappings || null));
          }, 20);
        },
        onOptions(cb) { handlers.options.push(cb); },
        onRecord(cb) { handlers.record.push(cb); },
        onRecords(cb) { handlers.records.push(cb); },
        setOption(k, v) { window.__options[k] = JSON.parse(JSON.stringify(v)); return Promise.resolve(); },
        docApi: {
          getDocName: async () => cfg.docName ?? 'swd2QJbkiCiN8Wjx6DS9yx',
          fetchTable: async (t) => {
            await new Promise((r) => setTimeout(r, 30));
            if (cfg.fail) throw new Error('Access denied');
            const extra = { _grist_Views_section: cfg.meta.sections, _grist_ACLResources: cfg.meta.aclResources, _grist_ACLRules: cfg.meta.aclRules };
            if (cfg.meta.pages) Object.assign(extra, { _grist_Pages: cfg.meta.pages, _grist_Views: cfg.meta.views });
            if (t in extra) return extra[t] || [];
            if (t === '_grist_Tables') return cfg.meta.tables;
            if (t === '_grist_Tables_column') return cfg.meta.cols;
            if (cfg.meta.records && cfg.meta.records[t]) return cfg.meta.records[t];
            throw new Error(`Table ${t} illisible`);
          },
        },
        selectedTable: { update: async (rec) => { window.__updates.push(rec); } },
      };
    }, { meta: o.meta, options: o.options, mappings: o.mappings, fail: o.fail, docName: o.docName });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}/__harness`, { waitUntil: 'networkidle' });
    const frame = page.frames().find((f) => f.url().endsWith('/index.html'));
    return { context, page, frame, errors };
  }

  async function waitDiagram(frame) {
    await frame.waitForSelector('.erd-node', { timeout: 30000 });
    await frame.waitForFunction(() => !document.querySelector('.erd__status')?.textContent);
  }

  async function finish() {
    await browser.close();
    server.close();
    if (failures.length) { console.error(`\n${failures.length} échec(s)`); process.exit(1); }
  }

  return { base, browser, check, openWidget, waitDiagram, finish, page: (url) => browser.newPage().then(async (p) => { await p.goto(base + url); return p; }) };
}
