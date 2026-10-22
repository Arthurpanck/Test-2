// Tests du visualiseur de schéma dans Chromium (Playwright).
// Usage : node tests/ui/run-erd.mjs <dossier des captures>
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseGristCodeCorrected, metadataFromModel } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.resolve(process.argv[2] || 'captures');
await mkdir(outDir, { recursive: true });
const fixture = (name) => readFile(path.join(root, 'tests/fixtures', name), 'utf8');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
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

async function open(viewport = { width: 1400, height: 860 }, { dark = false } = {}) {
  const context = await browser.newContext({ viewport, colorScheme: dark ? 'dark' : 'light', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { context, page, errors };
}

async function loadSchema(page, code, { corrected = false } = {}) {
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.locator('#code-input').fill(code);
  await page.waitForTimeout(300);
  if (corrected) await page.locator('#strict-toggle').evaluate((el) => el.click());
  await page.locator('#tab-schema').click();
  await page.waitForSelector('.erd-node', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.erd__status')?.textContent);
}

/** Géométrie en coordonnées du monde : tables et premiers/derniers points des relations. */
const readGeometry = (page) => page.evaluate(() => {
  const nodes = {};
  for (const el of document.querySelectorAll('.erd-node')) {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
    nodes[el.dataset.id] = { x: +m[1], y: +m[2], w: el.offsetWidth, h: el.offsetHeight };
  }
  const edges = [...document.querySelectorAll('.erd-edge')].map((g) => {
    const d = g.querySelector('.erd-edge__line').getAttribute('d');
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    return { d, start: [nums[0], nums[1]], end: [nums[nums.length - 2], nums[nums.length - 1]], title: g.querySelector('title').textContent };
  });
  return { nodes, edges };
});

// ---------------------------------------------------------------------------
// 1. Schéma du document d'origine (Conversion-DBML), conversion corrigée
// ---------------------------------------------------------------------------
{
  const { context, page, errors } = await open();
  await loadSchema(page, await fixture('document-exemple.code.py'), { corrected: true });
  const geo = await readGeometry(page);
  const ids = Object.keys(geo.nodes);
  check(ids.length === 6, `6 tables dessinées (${ids.length})`);
  const engine = await page.locator('.erd').getAttribute('data-layout-engine');
  check(engine === 'worker', `disposition calculée dans un Web Worker (${engine})`);
  check(geo.edges.length === 6, `6 relations dessinées (${geo.edges.length})`);

  // Aucune table ne se chevauche
  let overlap = null;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = geo.nodes[ids[i]]; const b = geo.nodes[ids[j]];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap = `${ids[i]} / ${ids[j]}`;
    }
  }
  check(!overlap, `disposition sans chevauchement${overlap ? ` (${overlap})` : ''}`);

  // Chaque relation part du bord de la table source, à la hauteur de sa colonne, et arrive sur la clé de la cible
  let anchored = 0;
  for (const e of geo.edges) {
    const [src, rest] = e.title.split('.');
    const tgt = rest.split(' → ')[1].replace(' (plusieurs)', '');
    const s = geo.nodes[src]; const t = geo.nodes[tgt];
    const onSide = (p, n) => (Math.abs(p[0] - n.x) < 1 || Math.abs(p[0] - (n.x + n.w)) < 1) && p[1] > n.y && p[1] < n.y + n.h;
    if (onSide(e.start, s) && onSide(e.end, t)) anchored++;
  }
  check(anchored === geo.edges.length, `relations ancrées sur les bords des tables (${anchored}/${geo.edges.length})`);
  const idRowY = await page.evaluate(() => {
    const n = document.querySelector('.erd-node[data-id="Document_a_etudier_espace_metier"]');
    const row = n.querySelector('.erd-row[data-col="id"]');
    return row.offsetTop + row.offsetHeight / 2;
  });
  const toDoc = geo.edges.filter((e) => e.title.endsWith('→ Document_a_etudier_espace_metier'));
  check(toDoc.every((e) => Math.abs(e.end[1] - (geo.nodes.Document_a_etudier_espace_metier.y + idRowY)) < 1),
    'les relations arrivent sur la ligne « id » de la table cible');
  await page.screenshot({ path: path.join(outDir, 'erd-01-document-origine.png') });

  // Survol d'une table : ses relations en évidence, le reste estompé
  await page.locator('#find-table').fill('Suivi_projets');
  await page.locator('#find-table').press('Enter');
  await page.waitForTimeout(150);
  await page.locator('.erd-node[data-id="Suivi_projets"] .erd-node__head').hover();
  const hl = await page.evaluate(() => ({
    focus: document.querySelector('.erd').classList.contains('has-focus'),
    active: [...document.querySelectorAll('.erd-edge.is-active title')].map((t) => t.textContent),
    dimmed: [...document.querySelectorAll('.erd-node:not(.is-related)')].map((n) => n.dataset.id),
  }));
  check(hl.focus && hl.active.length === 2, `survol : 2 relations de Suivi_projets en évidence (${hl.active.join(' | ')})`);
  check(hl.dimmed.includes('Reunion') && !hl.dimmed.includes('Suivi_projets'), 'survol : tables sans lien estompées');
  await page.screenshot({ path: path.join(outDir, 'erd-02-survol.png') });

  // Clic sur une colonne de relation : seule cette relation reste en évidence
  await page.locator('.erd-node[data-id="Suivi_projets"] .erd-row[data-col="Document_lie"]').click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(100);
  const sel = await page.evaluate(() => [...document.querySelectorAll('.erd-edge.is-active title')].map((t) => t.textContent));
  check(sel.length === 1 && sel[0].startsWith('Suivi_projets.Document_lie'), `sélection d'une colonne : une seule relation (${sel.join(' | ')})`);
  const linked = await page.locator('.erd-row.is-linked').count();
  check(linked === 2, `colonne source et clé cible surlignées (${linked})`);
  await page.keyboard.press('Escape');

  // Glisser une table : elle se déplace, ses relations suivent
  await page.locator('#btn-zoom-fit').click();
  const before = await readGeometry(page);
  const head = page.locator('.erd-node[data-id="Reunion"] .erd-node__head');
  const box = await head.boundingBox();
  const k = parseInt(await page.locator('#zoom-value').textContent(), 10) / 100;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  const after = await readGeometry(page);
  const moved = { dx: after.nodes.Reunion.x - before.nodes.Reunion.x, dy: after.nodes.Reunion.y - before.nodes.Reunion.y };
  check(Math.abs(moved.dx - 100 / k) < 3 && Math.abs(moved.dy - 60 / k) < 3, `glisser : table déplacée (${moved.dx.toFixed(0)}, ${moved.dy.toFixed(0)})`);
  const edgeToReunion = (g) => g.edges.find((e) => e.title.includes('→ Reunion')).end;
  check(edgeToReunion(after)[0] !== edgeToReunion(before)[0], 'glisser : la relation vers la table suit');

  // Clavier : flèche droite sur une table active
  await page.locator('.erd-node[data-id="Reunion"]').focus();
  await page.keyboard.press('ArrowRight');
  const kb = await readGeometry(page);
  check(Math.abs(kb.nodes.Reunion.x - after.nodes.Reunion.x - 16) < 0.5, 'clavier : flèche droite déplace la table de 16 px');

  // Zoom
  const z0 = await page.locator('#zoom-value').textContent();
  await page.locator('#btn-zoom-in').click();
  const z1 = await page.locator('#zoom-value').textContent();
  check(parseInt(z1, 10) > parseInt(z0, 10), `zoom : ${z0} → ${z1}`);
  await page.locator('.erd__viewport').hover();
  await page.mouse.wheel(0, 400);
  const z2 = await page.locator('#zoom-value').textContent();
  check(parseInt(z2, 10) < parseInt(z1, 10), `molette : ${z1} → ${z2}`);
  await page.locator('#btn-zoom-fit').click();

  // Réorganiser : la table déplacée retrouve sa place calculée
  await page.locator('#btn-relayout').click();
  await page.waitForTimeout(400);
  const re = await readGeometry(page);
  check(Math.abs(re.nodes.Reunion.x - before.nodes.Reunion.x) < 1 && Math.abs(re.nodes.Reunion.y - before.nodes.Reunion.y) < 1,
    'réorganiser : disposition automatique rétablie');

  // Niveaux de détail
  await page.locator('label[for="detail-keys"]').click();
  await page.waitForTimeout(400);
  const keysRows = await page.locator('.erd-node[data-id="Suivi_projets"] .erd-row').allTextContents();
  check(keysRows.length === 3 && keysRows[2].includes('autres colonnes'), `détail « Relations » : id, clé, résumé (${keysRows.length} lignes)`);
  await page.locator('label[for="detail-tables"]').click();
  await page.waitForTimeout(400);
  check(await page.locator('.erd-row').count() === 0, 'détail « Tables » : en-têtes seuls');
  const tablesGeo = await readGeometry(page);
  check(tablesGeo.edges.length === 6, 'détail « Tables » : relations conservées');
  await page.screenshot({ path: path.join(outDir, 'erd-03-tables.png') });
  await page.locator('label[for="detail-all"]').click();
  await page.waitForTimeout(400);

  // Exports
  const [svgDl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-svg').click()]);
  await svgDl.saveAs(path.join(outDir, 'erd-export.svg'));
  const svg = await readFile(await svgDl.path(), 'utf8');
  check(svg.startsWith('<svg') && svg.includes('Documentation_technique_espace_metier') && (svg.match(/<path d="M/g) || []).length >= 12,
    `export SVG (${svgDl.suggestedFilename()}, ${svg.length} octets)`);
  const [pngDl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-png').click()]);
  await pngDl.saveAs(path.join(outDir, 'erd-export.png'));
  const png = await readFile(await pngDl.path());
  check(png.subarray(1, 4).toString() === 'PNG' && png.length > 20000, `export PNG (${pngDl.suggestedFilename()}, ${png.length} octets)`);

  check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

// ---------------------------------------------------------------------------
// 2. Tables absentes, thème sombre
// ---------------------------------------------------------------------------
{
  const { context, page, errors } = await open({ width: 1200, height: 760 }, { dark: true });
  await loadSchema(page, await fixture('cas-limites.code.py'), { corrected: true });
  const ghosts = await page.locator('.erd-node--ghost').evaluateAll((els) => els.map((e) => e.dataset.id));
  check(ghosts.includes('Choix_categories') && ghosts.includes('Textes_modeles'), `tables absentes dessinées en pointillés (${ghosts.join(', ')})`);
  const headBg = await page.locator('.erd-node:not(.erd-node--ghost) .erd-node__head').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  check(headBg !== 'rgb(0, 0, 145)', `thème sombre appliqué aux en-têtes (${headBg})`);
  await page.screenshot({ path: path.join(outDir, 'erd-04-sombre-absentes.png') });
  check(errors.length === 0, `sombre : aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

// ---------------------------------------------------------------------------
// 3. Grist simulé : disposition mémorisée dans les options du widget
// ---------------------------------------------------------------------------
{
  const meta = metadataFromModel(parseGristCodeCorrected(await fixture('document-exemple.code.py')));
  const { context, page, errors } = await open();
  await context.route('https://docs.getgrist.com/grist-plugin-api.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.addInitScript(({ m }) => {
    if (window.self === window.top) return;
    window.__options = {};
    const saved = { diagram: { detail: 'all', positions: { Reunion: [1500, 40] } } };
    const handlers = { options: [], record: [], records: [] };
    window.grist = {
      ready() { setTimeout(() => { handlers.options.forEach((cb) => cb(saved, {})); handlers.record.forEach((cb) => cb(null, null)); }, 30); },
      onOptions(cb) { handlers.options.push(cb); },
      onRecord(cb) { handlers.record.push(cb); },
      onRecords(cb) { handlers.records.push(cb); },
      setOption(k, v) { window.__options[k] = JSON.parse(JSON.stringify(v)); return Promise.resolve(); },
      docApi: { fetchTable: async (t) => (t === '_grist_Tables' ? m.tables : m.cols) },
      selectedTable: { update: async () => {} },
    };
  }, { m: meta });
  await page.goto(`${base}/__harness`, { waitUntil: 'networkidle' });
  const frame = page.frames().find((f) => f.url().endsWith('/index.html'));
  await frame.waitForSelector('.code .ln', { timeout: 10000 });
  await frame.locator('#tab-schema').click();
  await frame.waitForSelector('.erd-node', { timeout: 30000 });
  await frame.waitForFunction(() => !document.querySelector('.erd__status')?.textContent);
  const g = await readGeometry(frame);
  check(g.nodes.Reunion && g.nodes.Reunion.x === 1500 && g.nodes.Reunion.y === 40, 'position mémorisée appliquée (Reunion en 1500, 40)');
  const others = Object.entries(g.nodes).filter(([id]) => id !== 'Reunion');
  check(others.every(([, n]) => n.y > 40 + g.nodes.Reunion.h), 'nouvelles tables placées sous les tables déjà positionnées');

  const head = frame.locator('.erd-node[data-id="Categories_outils"] .erd-node__head');
  const box = await head.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 48, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(1100);
  const opt = await frame.evaluate(() => window.__options.diagram);
  check(opt && opt.positions && Array.isArray(opt.positions.Categories_outils) && opt.positions.Reunion[0] === 1500,
    'déplacement enregistré dans les options du widget');
  await page.screenshot({ path: path.join(outDir, 'erd-05-grist.png') });
  check(errors.length === 0, `Grist : aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

await browser.close();
server.close();
if (failures.length) { console.error(`\n${failures.length} échec(s)`); process.exit(1); }
console.log('\nTous les contrôles du visualiseur passent.');
