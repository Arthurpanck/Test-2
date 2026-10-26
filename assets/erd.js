/**
 * Visualiseur de schéma de base de données (façon dbdiagram.io), aux couleurs du DSFR.
 *
 * - Tables en cartes HTML (lisibles, accessibles au clavier), relations en SVG de colonne à colonne
 *   avec symboles de cardinalité (patte d'oie = plusieurs, barre = un).
 * - Disposition automatique par ELK (Eclipse Layout Kernel, EPL-2.0), chargé à la demande dans un Web Worker.
 * - Glisser les tables, déplacer la vue, zoomer (molette, boutons, clavier), mini-carte.
 * - Survol ou sélection d'une table ou d'une colonne : ses relations sont mises en évidence.
 * - Export SVG (et PNG pour le rapport Word).
 */
import {
  edgeGeometry, boundsOf, fitTransform, buildElkGraph,
} from './erd-geometry.js?v=2.4.0';
import { readTheme } from './report.js?v=2.4.0';
import { columnTypeLabel, ID_TYPE_LABEL } from './types.js?v=2.4.0';

const ELK_VERSION = '0.12.0';
const ELK_API_URL = `https://cdn.jsdelivr.net/npm/elkjs@${ELK_VERSION}/lib/elk-api.js`; // 10 Ko
const ELK_WORKER_URL = `https://cdn.jsdelivr.net/npm/elkjs@${ELK_VERSION}/lib/elk-worker.min.js`; // moteur, 1,6 Mo
const ELK_BUNDLED_URL = `https://cdn.jsdelivr.net/npm/elkjs@${ELK_VERSION}/lib/elk.bundled.js`; // repli
const LAYOUT_TIMEOUT = 20000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;

// Icônes (24 × 24). Le maillon est l'icône « links-line » du DSFR (Remix Icon, Apache-2.0).
const ICON_KEY = 'M7 7a5 5 0 1 1 0 10a5 5 0 1 1 0-10ZM7 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5ZM11 11h10v2h-1.5v3h-2v-3h-1v2h-2v-2H11Z';
const ICON_LINK = 'm12.89 7.939 1.414 1.415a7 7 0 0 1 0 9.9l-.354.353a7 7 0 0 1-9.9-9.9l1.415 1.415a5 5 0 1 0 7.071 7.07l.354-.353a5 5 0 0 0 0-7.07l-1.415-1.415L12.89 7.94v-.001Zm6.717 6.01-1.414-1.413a5 5 0 1 0-7.07-7.071l-.355.354a5 5 0 0 0 0 7.07l1.415 1.415-1.415 1.414-1.414-1.414a7 7 0 0 1 0-9.9l.354-.353a7 7 0 1 1 9.9 9.9v-.001Z';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const icon = (d, cls) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`chargement impossible : ${url}`));
    document.head.append(script);
  });
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
}

let elkPromise = null;
/**
 * Instance ELK partagée. Le moteur tourne dans un Web Worker (créé depuis une URL blob qui
 * importe le script du CDN) pour ne jamais bloquer l'interface ; à défaut, il tourne sur le fil
 * principal.
 */
export function getElk() {
  if (!elkPromise) {
    elkPromise = (async () => {
      try {
        if (!window.ELK) await loadScript(ELK_API_URL);
        const source = `importScripts(${JSON.stringify(ELK_WORKER_URL)});`;
        const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const elk = new window.ELK({ workerUrl: ELK_WORKER_URL, workerFactory: () => new Worker(blobUrl) });
        await withTimeout(elk.layout({ id: 'test', children: [{ id: 'a', width: 10, height: 10 }], edges: [] }),
          LAYOUT_TIMEOUT, 'le moteur de disposition ne répond pas');
        elk.mode = 'worker';
        return elk;
      } catch (err) {
        console.warn('ELK en Web Worker indisponible, repli sur le fil principal :', err);
        await loadScript(ELK_BUNDLED_URL);
        const elk = new window.ELK();
        elk.mode = 'main';
        return elk;
      }
    })().catch((err) => { elkPromise = null; throw err; });
  }
  return elkPromise;
}

/** Rangement simple en étagères, si ELK n'est pas disponible. */
function shelfLayout(nodes, maxWidth = 1400, gap = 48) {
  const pos = new Map();
  let x = gap; let y = gap; let rowH = 0;
  for (const n of nodes) {
    if (x > gap && x + n.w > maxWidth) { x = gap; y += rowH + gap; rowH = 0; }
    pos.set(n.id, { x, y });
    x += n.w + gap;
    rowH = Math.max(rowH, n.h);
  }
  return pos;
}

export class ErdViewer {
  /**
   * @param {HTMLElement} root  conteneur (doit avoir une hauteur)
   * @param {object} callbacks  onViewChange(view), onLayoutChange(positions), onStatus(message)
   */
  constructor(root, callbacks = {}) {
    this.root = root;
    this.cb = callbacks;
    this.view = { x: 0, y: 0, k: 1 };
    this.nodes = new Map();
    this.edges = [];
    this.positions = new Map(); // positions connues (mémorisées ou calculées)
    this.manual = false; // l'utilisateur a déplacé des tables
    this.detail = 'all';
    this.hover = null;
    this.selected = null;
    this.signature = '';
    this.layoutSeq = 0;
    this.build();
  }

  // -------------------------------------------------------------------------
  // Construction du DOM
  // -------------------------------------------------------------------------

  build() {
    this.root.classList.add('erd');
    this.root.innerHTML = `
      <div class="erd__viewport" tabindex="0" role="region"
        aria-label="Schéma des tables. Glisser pour se déplacer, molette ou touches plus et moins pour zoomer, 0 pour ajuster. Tabulation pour parcourir les tables, flèches pour déplacer la table active.">
        <div class="erd__world">
          <svg class="erd__edges" aria-hidden="true" focusable="false"></svg>
          <div class="erd__nodes"></div>
        </div>
        <p class="erd__status" aria-live="polite"></p>
        <div class="erd__legend" aria-hidden="true">
          <span><svg viewBox="0 0 28 14"><path d="M2 7h18M20 7 6 1M20 7 6 13M20 7H6"/></svg>plusieurs</span>
          <span><svg viewBox="0 0 28 14"><path d="M2 7h24M14 1v12"/></svg>un</span>
          <span><i>ƒ</i> formule</span>
        </div>
        <svg class="erd__minimap" role="img" aria-label="Mini-carte : cliquer pour centrer la vue"></svg>
      </div>`;
    this.viewport = this.root.querySelector('.erd__viewport');
    this.world = this.root.querySelector('.erd__world');
    this.edgeLayer = this.root.querySelector('.erd__edges');
    this.nodeLayer = this.root.querySelector('.erd__nodes');
    this.statusEl = this.root.querySelector('.erd__status');
    this.minimap = this.root.querySelector('.erd__minimap');
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.updateMinimap());
    this.resizeObserver.observe(this.viewport);
    this.watchFonts();
  }

  status(message) {
    this.statusEl.textContent = message || '';
    this.statusEl.hidden = !message;
    this.cb.onStatus?.(message);
  }

  // -------------------------------------------------------------------------
  // Données
  // -------------------------------------------------------------------------

  /**
   * @param {Array} tables  tables de sortie du convertisseur ({ name, kind, columns: [{ name, base, isFormula, ref }] })
   * @param {object} options  { positions: { Table: [x, y] }, detail: 'all' | 'keys' | 'tables' }
   */
  async setData(tables, { positions = null, detail } = {}) {
    if (detail) this.detail = detail;
    if (positions && !this.positions.size) {
      for (const [id, p] of Object.entries(positions)) {
        if (Array.isArray(p) && p.length === 2) this.positions.set(id, { x: p[0], y: p[1] });
      }
      this.manual = this.positions.size > 0;
    }
    const known = new Set(tables.map((t) => t.name));
    const model = tables.map((t) => ({
      id: t.name,
      kind: t.kind === 'summary' ? 'summary' : 'table',
      ghost: false,
      columns: t.columns.map((c) => ({ name: c.name, base: c.base, type: columnTypeLabel(c), isFormula: c.isFormula, ref: c.ref, label: c.label })),
    }));
    const edges = [];
    for (const t of tables) {
      for (const c of t.columns) {
        if (!c.ref) continue;
        edges.push({ source: t.name, column: c.name, target: c.ref.table, kind: c.ref.kind });
        if (!known.has(c.ref.table)) {
          known.add(c.ref.table);
          model.push({ id: c.ref.table, kind: 'table', ghost: true, columns: [] });
        }
      }
    }
    // Relations parallèles entre deux mêmes tables : léger décalage pour qu'elles restent distinctes.
    const pairs = new Map();
    for (const e of edges) {
      const key = [e.source, e.target].sort().join('\u0000');
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push(e);
    }
    for (const group of pairs.values()) group.forEach((e, i) => { e.shift = (i - (group.length - 1) / 2) * 10; });

    this.model = model;
    this.edges = edges;
    this.signature = JSON.stringify([model.map((n) => [n.id, n.columns.map((c) => c.name + c.base + (c.ref?.table || ''))]), this.detail]);
    this.renderNodes();
    await this.layout();
  }

  setDetail(detail) {
    if (detail === this.detail || !this.model) return;
    this.detail = detail;
    this.renderNodes();
    // Les tailles changent : on refait la disposition sauf si l'utilisateur a placé les tables.
    this.layout({ relayout: !this.manual });
  }

  visibleColumns(node) {
    if (this.detail === 'tables') return [];
    if (this.detail === 'keys') return node.columns.filter((c) => c.ref);
    return node.columns;
  }

  renderNodes() {
    const html = this.model.map((n) => {
      const cols = this.visibleColumns(n);
      const hidden = n.columns.length - cols.length;
      const rows = n.ghost ? '' : [
        this.detail === 'tables' ? '' : `<li class="erd-row erd-row--pk" data-col="id">${icon(ICON_KEY, 'erd-row__icon')}<span class="erd-row__name">id</span><span class="erd-row__type">${ID_TYPE_LABEL}</span></li>`,
        ...cols.map((c) => {
          const cls = ['erd-row', c.ref ? 'erd-row--fk' : '', c.isFormula ? 'erd-row--formula' : ''].filter(Boolean).join(' ');
          const lead = c.ref ? icon(ICON_LINK, 'erd-row__icon') : c.isFormula ? '<span class="erd-row__icon erd-row__fx" aria-hidden="true">ƒ</span>' : '<span class="erd-row__icon"></span>';
          const title = [
            `${c.name}${c.label && c.label !== c.name ? ` (${c.label})` : ''} : ${c.type}${c.isFormula ? ', formule' : ''}`,
            c.ref ? `${c.ref.kind === '<>' ? 'plusieurs' : 'une'} ligne${c.ref.kind === '<>' ? 's' : ''} de ${c.ref.table}` : '',
          ].filter(Boolean).join(' – ');
          return `<li class="${cls}" data-col="${esc(c.name)}" title="${esc(title)}">${lead}<span class="erd-row__name">${esc(c.name)}</span><span class="erd-row__type">${esc(c.type)}</span></li>`;
        }),
        hidden && this.detail === 'keys' ? `<li class="erd-row erd-row--more">${esc(plural(hidden, 'autre colonne', 'autres colonnes'))}</li>` : '',
      ].join('');
      const badge = n.ghost ? '<span class="erd-node__badge">absente</span>' : n.kind === 'summary' ? '<span class="erd-node__badge">synthèse</span>' : '';
      const label = n.ghost
        ? `Table ${n.id}, absente du schéma`
        : `Table ${n.id}${n.kind === 'summary' ? ' (synthèse)' : ''}, ${plural(n.columns.length + 1, 'colonne', 'colonnes')}`;
      return `<div class="erd-node${n.kind === 'summary' ? ' erd-node--summary' : ''}${n.ghost ? ' erd-node--ghost' : ''}" data-id="${esc(n.id)}"
          tabindex="0" role="group" aria-label="${esc(label)}">
        <div class="erd-node__head"><span class="erd-node__name">${esc(n.id)}</span>${badge}</div>
        ${rows ? `<ul class="erd-node__rows">${rows}</ul>` : ''}
      </div>`;
    }).join('');
    this.nodeLayer.innerHTML = html;
    this.nodes.clear();
    for (const el of this.nodeLayer.children) {
      const n = this.model.find((m) => m.id === el.dataset.id);
      this.nodes.set(n.id, { ...n, el, x: 0, y: 0 });
    }
    this.measure();
    this.edgeLayer.innerHTML = this.edges.map((e, i) => `
      <g class="erd-edge${e.kind === '<>' ? ' erd-edge--many' : ''}" data-edge="${i}">
        <path class="erd-edge__hit"><title>${esc(`${e.source}.${e.column} → ${e.target}${e.kind === '<>' ? ' (plusieurs)' : ''}`)}</title></path>
        <path class="erd-edge__line"/>
        <path class="erd-edge__mark"/>
      </g>`).join('');
    this.edges.forEach((e, i) => { e.el = this.edgeLayer.querySelector(`[data-edge="${i}"]`); });
  }

  /** Mesure la taille de chaque table et la position de ses lignes ; vrai si quelque chose a changé. */
  measure() {
    let changed = false;
    for (const n of this.nodes.values()) {
      const el = n.el;
      const rowY = new Map();
      for (const row of el.querySelectorAll('.erd-row[data-col]')) rowY.set(row.dataset.col, row.offsetTop + row.offsetHeight / 2);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const headY = el.firstElementChild.offsetHeight / 2;
      if (w !== n.w || h !== n.h || headY !== n.headY || JSON.stringify([...rowY]) !== JSON.stringify([...(n.rowY || [])])) changed = true;
      Object.assign(n, { w, h, headY, rowY });
    }
    return changed;
  }

  /** Les polices web (Marianne) changent la taille des tables : on re-mesure une fois chargées. */
  watchFonts() {
    if (!document.fonts?.ready) return;
    document.fonts.ready.then(() => {
      if (this.nodes.size && this.measure()) { this.drawEdges(); this.updateMinimap(); }
    });
    document.fonts.addEventListener?.('loadingdone', () => {
      if (this.nodes.size && this.measure()) { this.drawEdges(); this.updateMinimap(); }
    });
  }

  /** Ordonnée d'ancrage d'une colonne dans une table (centre de l'en-tête si elle n'est pas affichée). */
  anchorY(node, column) {
    const y = node.rowY.get(column);
    return node.y + (y ?? node.headY);
  }

  // -------------------------------------------------------------------------
  // Disposition
  // -------------------------------------------------------------------------

  async layout({ relayout = false } = {}) {
    const seq = ++this.layoutSeq;
    const list = [...this.nodes.values()];
    if (relayout) { this.positions.clear(); this.manual = false; }
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    if (seq !== this.layoutSeq) return;
    this.measure();
    const missing = list.filter((n) => !this.positions.has(n.id));
    const refit = relayout || missing.length > 0 || !this.fitted;
    if (missing.length) {
      let computed;
      try {
        this.status('Calcul de la disposition…');
        const elk = await getElk();
        this.root.dataset.layoutEngine = elk.mode; // diagnostic : « worker » ou « main »
        const vw = this.viewport.clientWidth || 1200;
        const vh = this.viewport.clientHeight || 700;
        const graph = buildElkGraph(
          list.map((n) => ({ id: n.id, w: n.w, h: n.h, ports: { id: n.rowY.get('id') ?? n.headY, ...Object.fromEntries([...n.rowY].filter(([k]) => k !== 'id')) } })),
          this.edges,
          { aspectRatio: Math.max(1, Math.min(3, vw / vh)) },
        );
        // Colonnes masquées (mode « Tables ») : les ports se placent au centre de l'en-tête.
        for (const child of graph.children) {
          const n = this.nodes.get(child.id);
          for (const p of child.ports) {
            const col = p.id.split('::')[1];
            p.y = n.rowY.get(col) ?? n.headY;
          }
        }
        const res = await withTimeout(elk.layout(graph), LAYOUT_TIMEOUT, 'délai de calcul dépassé');
        computed = new Map(res.children.map((c) => [c.id, { x: c.x, y: c.y }]));
        this.status('');
      } catch (err) {
        computed = shelfLayout(list);
        this.status(`Disposition automatique indisponible (${err.message || err}) : tables rangées en grille.`);
      }
      if (seq !== this.layoutSeq) return;
      const placed = list.filter((n) => this.positions.has(n.id));
      if (placed.length) {
        // Nouvelles tables : sous les tables déjà placées, en gardant leur arrangement relatif.
        const pb = boundsOf(placed.map((n) => ({ ...this.positions.get(n.id), w: n.w, h: n.h })));
        const mb = boundsOf(missing.map((n) => ({ ...computed.get(n.id), w: n.w, h: n.h })));
        for (const n of missing) {
          const p = computed.get(n.id);
          this.positions.set(n.id, { x: p.x - mb.x + pb.x, y: p.y - mb.y + pb.y + pb.h + 80 });
        }
      } else {
        for (const n of missing) this.positions.set(n.id, computed.get(n.id));
      }
    }
    for (const n of list) {
      const p = this.positions.get(n.id);
      n.x = p.x;
      n.y = p.y;
      n.el.style.transform = `translate(${n.x}px, ${n.y}px)`;
    }
    this.drawEdges();
    if (refit) { this.fit(); this.fitted = true; } else this.updateMinimap();
    this.applyHighlight();
  }

  /** Positions actuelles, arrondies, pour les mémoriser dans les options du widget. */
  exportPositions() {
    const out = {};
    for (const n of this.nodes.values()) out[n.id] = [Math.round(n.x), Math.round(n.y)];
    return out;
  }

  // -------------------------------------------------------------------------
  // Dessin
  // -------------------------------------------------------------------------

  drawEdges(onlyFor = null) {
    for (const e of this.edges) {
      if (onlyFor && e.source !== onlyFor && e.target !== onlyFor) continue;
      const s = this.nodes.get(e.source);
      const t = this.nodes.get(e.target);
      if (!s || !t || !e.el) continue;
      const g = edgeGeometry(
        { x: s.x, y: s.y, w: s.w, h: s.h }, this.anchorY(s, e.column),
        { x: t.x, y: t.y, w: t.w, h: t.h }, this.anchorY(t, 'id'),
        e.kind, { shift: e.shift },
      );
      e.geometry = g;
      const [hit, line, mark] = e.el.querySelectorAll('path');
      hit.setAttribute('d', g.path);
      line.setAttribute('d', g.path);
      mark.setAttribute('d', `${g.sourceMarker} ${g.targetMarker}`);
    }
    this.sizeEdgeLayer();
  }

  /** Le calque SVG couvre tout le contenu (pour que le survol des relations fonctionne partout). */
  sizeEdgeLayer() {
    const m = 400;
    const b = this.bounds();
    const x = Math.floor(b.x - m);
    const y = Math.floor(b.y - m);
    const w = Math.ceil(b.w + 2 * m);
    const h = Math.ceil(b.h + 2 * m);
    Object.assign(this.edgeLayer.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    this.edgeLayer.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }

  applyView() {
    const { x, y, k } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    const grid = 20 * k;
    this.viewport.style.backgroundSize = `${grid}px ${grid}px`;
    this.viewport.style.backgroundPosition = `${x}px ${y}px`;
    this.updateMinimap();
    this.cb.onViewChange?.(this.view);
  }

  bounds() {
    return boundsOf([...this.nodes.values()].map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })));
  }

  fit() {
    const b = this.bounds();
    this.view = fitTransform(b, this.viewport.clientWidth, this.viewport.clientHeight, { padding: 32, minScale: MIN_ZOOM, maxScale: 1 });
    this.applyView();
  }

  zoomAt(factor, cx = this.viewport.clientWidth / 2, cy = this.viewport.clientHeight / 2) {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.view.k * factor));
    const f = k / this.view.k;
    this.view = { k, x: cx - (cx - this.view.x) * f, y: cy - (cy - this.view.y) * f };
    this.applyView();
  }

  /** Centre la vue sur une table et la sélectionne. */
  focusTable(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    const k = Math.max(this.view.k, 0.8);
    this.view = {
      k,
      x: this.viewport.clientWidth / 2 - (n.x + n.w / 2) * k,
      y: Math.min(40, this.viewport.clientHeight / 2 - (n.y + n.h / 2) * k),
    };
    this.applyView();
    this.select({ table: id });
    n.el.focus({ preventScroll: true });
  }

  updateMinimap() {
    if (!this.nodes.size) { this.minimap.innerHTML = ''; return; }
    const b = this.bounds();
    const pad = 40;
    const vb = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
    const { x, y, k } = this.view;
    const vw = this.viewport.clientWidth / k;
    const vh = this.viewport.clientHeight / k;
    const rects = [...this.nodes.values()].map((n) => `<rect class="${n.kind === 'summary' ? 'is-summary' : ''}${n.ghost ? ' is-ghost' : ''}" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4"/>`).join('');
    this.minimap.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    this.minimap.innerHTML = `${rects}<rect class="erd__minimap-view" x="${-x / k}" y="${-y / k}" width="${vw}" height="${vh}" vector-effect="non-scaling-stroke"/>`;
    // La mini-carte n'a d'intérêt que si le schéma déborde de la vue.
    this.minimap.classList.toggle('is-hidden', b.w * k <= this.viewport.clientWidth && b.h * k <= this.viewport.clientHeight);
    this.minimapBox = vb;
  }

  // -------------------------------------------------------------------------
  // Mise en évidence
  // -------------------------------------------------------------------------

  select(focus) {
    this.selected = focus;
    this.applyHighlight();
  }

  applyHighlight() {
    const focus = this.hover || this.selected;
    this.root.classList.toggle('has-focus', Boolean(focus));
    const related = new Set();
    const linkedRows = new Set();
    const active = [];
    for (const e of this.edges) {
      let on = false;
      if (focus?.edge !== undefined) on = this.edges[focus.edge] === e;
      else if (focus?.column) on = e.source === focus.table && e.column === focus.column;
      else if (focus?.table) on = e.source === focus.table || e.target === focus.table;
      e.el?.classList.toggle('is-active', on);
      if (on) {
        active.push(e);
        related.add(e.source); related.add(e.target);
        linkedRows.add(`${e.source}\u0000${e.column}`);
        linkedRows.add(`${e.target}\u0000id`);
      }
    }
    if (focus?.table) related.add(focus.table);
    for (const n of this.nodes.values()) {
      n.el.classList.toggle('is-related', related.has(n.id));
      n.el.classList.toggle('is-selected', this.selected?.table === n.id && !this.selected.column);
      for (const row of n.el.querySelectorAll('.erd-row[data-col]')) {
        row.classList.toggle('is-linked', linkedRows.has(`${n.id}\u0000${row.dataset.col}`));
      }
    }
    // Les relations actives passent au premier plan.
    for (const e of active) this.edgeLayer.append(e.el);
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------

  bindEvents() {
    const vp = () => this.viewport;
    let drag = null;

    this.root.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      if (ev.target.closest('.erd__minimap')) { this.minimapNavigate(ev); drag = { type: 'minimap' }; vp().setPointerCapture(ev.pointerId); return; }
      if (!ev.target.closest('.erd__viewport')) return;
      const nodeEl = ev.target.closest('.erd-node');
      const node = nodeEl && this.nodes.get(nodeEl.dataset.id);
      drag = {
        type: node ? 'node' : 'pan', node, startX: ev.clientX, startY: ev.clientY, moved: false,
        origin: node ? { x: node.x, y: node.y } : { x: this.view.x, y: this.view.y },
        rowCol: ev.target.closest('.erd-row[data-col]')?.dataset.col,
      };
      vp().setPointerCapture(ev.pointerId);
      vp().classList.toggle('is-panning', !node);
    });

    this.root.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      if (drag.type === 'minimap') { this.minimapNavigate(ev); return; }
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      if (drag.type === 'pan') {
        this.view = { ...this.view, x: drag.origin.x + dx, y: drag.origin.y + dy };
        this.applyView();
      } else {
        const n = drag.node;
        n.x = drag.origin.x + dx / this.view.k;
        n.y = drag.origin.y + dy / this.view.k;
        n.el.style.transform = `translate(${n.x}px, ${n.y}px)`;
        n.el.classList.add('is-dragging');
        this.drawEdges(n.id);
      }
    });

    const end = (ev) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      vp().classList.remove('is-panning');
      if (vp().hasPointerCapture?.(ev.pointerId)) vp().releasePointerCapture(ev.pointerId);
      if (d.type === 'node') {
        d.node.el.classList.remove('is-dragging');
        if (d.moved) {
          this.positions.set(d.node.id, { x: d.node.x, y: d.node.y });
          this.manual = true;
          this.updateMinimap();
          this.cb.onLayoutChange?.(this.exportPositions());
        } else {
          const same = this.selected?.table === d.node.id && this.selected?.column === d.rowCol;
          this.select(same ? null : { table: d.node.id, column: d.rowCol && d.rowCol !== 'id' ? d.rowCol : undefined });
        }
      } else if (d.type === 'pan' && !d.moved) {
        this.select(null);
      }
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);

    this.viewport.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = this.viewport.getBoundingClientRect();
      const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015));
      this.zoomAt(factor, ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });

    // Survol : table, colonne ou relation
    this.root.addEventListener('pointerover', (ev) => {
      if (drag?.moved) return;
      const edgeEl = ev.target.closest('.erd-edge');
      const nodeEl = ev.target.closest('.erd-node');
      let next = null;
      if (edgeEl) next = { edge: Number(edgeEl.dataset.edge) };
      else if (nodeEl) {
        const row = ev.target.closest('.erd-row--fk');
        next = row ? { table: nodeEl.dataset.id, column: row.dataset.col } : { table: nodeEl.dataset.id };
      }
      if (JSON.stringify(next) !== JSON.stringify(this.hover)) { this.hover = next; this.applyHighlight(); }
    });
    this.root.addEventListener('pointerleave', () => { this.hover = null; this.applyHighlight(); });

    // Clavier
    this.root.addEventListener('keydown', (ev) => {
      const nodeEl = ev.target.closest?.('.erd-node');
      const step = ev.shiftKey ? 64 : 16;
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (nodeEl && arrows[ev.key]) {
        ev.preventDefault();
        const n = this.nodes.get(nodeEl.dataset.id);
        n.x += arrows[ev.key][0] * step;
        n.y += arrows[ev.key][1] * step;
        n.el.style.transform = `translate(${n.x}px, ${n.y}px)`;
        this.drawEdges(n.id);
        this.positions.set(n.id, { x: n.x, y: n.y });
        this.manual = true;
        this.updateMinimap();
        this.cb.onLayoutChange?.(this.exportPositions());
      } else if (nodeEl && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        const id = nodeEl.dataset.id;
        this.select(this.selected?.table === id ? null : { table: id });
      } else if (!nodeEl && arrows[ev.key]) {
        ev.preventDefault();
        this.view = { ...this.view, x: this.view.x - arrows[ev.key][0] * 48, y: this.view.y - arrows[ev.key][1] * 48 };
        this.applyView();
      } else if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); this.zoomAt(1.2); }
      else if (ev.key === '-') { ev.preventDefault(); this.zoomAt(1 / 1.2); }
      else if (ev.key === '0') { ev.preventDefault(); this.fit(); }
      else if (ev.key === 'Escape') { this.select(null); }
    });
    this.root.addEventListener('focusin', (ev) => {
      const nodeEl = ev.target.closest?.('.erd-node');
      if (nodeEl) { this.hover = { table: nodeEl.dataset.id }; this.applyHighlight(); }
    });
    this.root.addEventListener('focusout', () => { this.hover = null; this.applyHighlight(); });
  }

  minimapNavigate(ev) {
    if (!this.minimapBox) return;
    const r = this.minimap.getBoundingClientRect();
    const vb = this.minimapBox;
    const scale = Math.max(vb.w / r.width, vb.h / r.height);
    const offX = (r.width - vb.w / scale) / 2;
    const offY = (r.height - vb.h / scale) / 2;
    const wx = vb.x + (ev.clientX - r.left - offX) * scale;
    const wy = vb.y + (ev.clientY - r.top - offY) * scale;
    this.view = { ...this.view, x: this.viewport.clientWidth / 2 - wx * this.view.k, y: this.viewport.clientHeight / 2 - wy * this.view.k };
    this.applyView();
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  /** SVG autonome du schéma (couleurs du thème clair DSFR). */
  toSvg() {
    const b = this.bounds();
    const pad = 32;
    // Couleurs du thème clair DSFR, quel que soit le thème affiché (document destiné à être partagé).
    // Couleurs du document (variables --doc-*), identiques à celles du rapport Word.
    const t = readTheme();
    const c = {
      bg: '#ffffff', border: t.border, head: t.primary, headText: t.onPrimary, summary: t.summary,
      ghost: '#eeeeee', text: t.text, mention: t.muted, type: t.type, formula: t.formula, line: '#929292', key: t.key,
    };
    const font = `${t.font}, 'Segoe UI', Arial, sans-serif`;
    const parts = [];
    parts.push(`<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + 2 * pad}" height="${b.h + 2 * pad}" fill="${t.surface}"/>`);
    for (const e of this.edges) {
      if (!e.geometry) continue;
      parts.push(`<path d="${e.geometry.path}" fill="none" stroke="${c.line}" stroke-width="1.5"/>`);
      parts.push(`<path d="${e.geometry.sourceMarker} ${e.geometry.targetMarker}" fill="none" stroke="${c.line}" stroke-width="1.5"/>`);
    }
    for (const n of this.nodes.values()) {
      const headH = n.el.firstElementChild.offsetHeight;
      const headFill = n.ghost ? c.ghost : n.kind === 'summary' ? c.summary : c.head;
      const headColor = n.ghost ? c.mention : c.headText;
      parts.push(`<g transform="translate(${n.x},${n.y})">`);
      parts.push(`<rect width="${n.w}" height="${n.h}" rx="4" fill="${c.bg}" stroke="${c.border}"${n.ghost ? ' stroke-dasharray="4 3"' : ''}/>`);
      parts.push(`<path d="M0 4a4 4 0 0 1 4-4h${n.w - 8}a4 4 0 0 1 4 4v${headH - 4}H0Z" fill="${headFill}"/>`);
      parts.push(`<text x="12" y="${headH / 2}" dominant-baseline="central" font-family="${font}" font-size="14" font-weight="700" fill="${headColor}">${esc(n.id)}</text>`);
      for (const row of n.el.querySelectorAll('.erd-row')) {
        const y = row.offsetTop + row.offsetHeight / 2;
        const name = row.querySelector('.erd-row__name')?.textContent ?? row.textContent;
        const type = row.querySelector('.erd-row__type')?.textContent ?? '';
        const isPk = row.classList.contains('erd-row--pk');
        const isFk = row.classList.contains('erd-row--fk');
        const isFx = row.classList.contains('erd-row--formula');
        parts.push(`<line x1="0" x2="${n.w}" y1="${row.offsetTop}" y2="${row.offsetTop}" stroke="#eeeeee"/>`);
        if (isPk || isFk) parts.push(`<path transform="translate(10,${y - 7}) scale(0.58)" d="${isPk ? ICON_KEY : ICON_LINK}" fill="${isPk ? c.key : c.head}"/>`);
        if (isFx && !isFk) parts.push(`<text x="17" y="${y}" dominant-baseline="central" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="13" fill="${c.formula}">ƒ</text>`);
        parts.push(`<text x="30" y="${y}" dominant-baseline="central" font-family="${font}" font-size="13" font-weight="${isPk ? 700 : 400}" fill="${row.classList.contains('erd-row--more') ? c.mention : c.text}">${esc(name)}</text>`);
        if (type) parts.push(`<text x="${n.w - 10}" y="${y}" dominant-baseline="central" text-anchor="end" font-family="${font}" font-size="11.5" fill="${isFx ? c.formula : c.type}">${esc(type)}</text>`);
      }
      parts.push('</g>');
    }
    const w = Math.ceil(b.w + 2 * pad);
    const h = Math.ceil(b.h + 2 * pad);
    return `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="${b.x - pad} ${b.y - pad} ${w} ${h}">${parts.join('')}</svg>`;
  }

  /** PNG (×2) du schéma, via le SVG. */
  async toPng(scale = 2) {
    const svg = this.toSvg();
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.root.innerHTML = '';
  }
}
