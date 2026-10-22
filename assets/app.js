import {
  convertAll, analyze, computeStats, schemaFromMetadata,
} from './converter.js?v=1.2.1';
import { EXAMPLE_CODE } from './example.js?v=1.2.1';
import { ErdViewer } from './erd.js?v=1.2.1';

const MAX_SAVED_CODE = 200_000;
const DIFF_CODES = new Set(['lost-relation', 'phantom-column', 'phantom-table', 'missing-column',
  'missing-table', 'wrong-type', 'type-leak', 'bool', 'datetime']);

const gristApi = window.grist;
const inGrist = Boolean(gristApi) && window.self !== window.top;

const $ = (id) => document.getElementById(id);
const els = {};
for (const id of ['standalone-notice', 'source-doc', 'source-code', 'panel-doc', 'panel-code', 'doc-status', 'doc-alert',
  'btn-refresh', 'btn-edit-code', 'code-input', 'row-info', 'btn-example', 'btn-clear', 'strict-toggle', 'summary',
  'btn-copy', 'btn-download', 'btn-open', 'btn-save', 'dbml-body', 'filter-input', 'tables-body', 'schema-body',
  'btn-zoom-in', 'btn-zoom-out', 'btn-zoom-fit', 'zoom-value', 'btn-svg', 'btn-png', 'btn-relayout', 'find-table',
  'find-table-list', 'detail-all', 'detail-keys', 'detail-tables', 'analysis-body', 'analysis-count',
  'toast', 'live']) {
  els[id] = $(id);
}
const tabs = ['dbml', 'tables', 'schema', 'analysis'];

const state = {
  source: inGrist ? 'doc' : 'code',
  strict: true,
  code: '',
  schema: null,
  schemaAt: null,
  schemaError: null,
  schemaLoading: false,
  result: null,
  findings: [],
  tab: 'dbml',
  record: null,
  mappings: null,
  filter: '',
  diagramKey: null,
  diagram: { detail: 'all', positions: null }, // mémorisé dans les options du widget
  lines: { table: new Map(), column: new Map() },
  optionsApplied: false,
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function shown() {
  if (!state.result) return null;
  return state.strict ? state.result.strict : state.result.corrected;
}

let toastTimer;
function toast(message, level = 'success') {
  clearTimeout(toastTimer);
  els.toast.innerHTML = `<div class="fr-alert fr-alert--${level} fr-alert--sm"><p>${esc(message)}</p></div>`;
  toastTimer = setTimeout(() => { els.toast.innerHTML = ''; }, level === 'error' ? 7000 : 3500);
}

const announce = debounce((message) => { els.live.textContent = message; }, 600);

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileBaseName() {
  const first = shown()?.tables?.[0]?.name;
  return state.source === 'doc' ? 'schema-document' : first ? `schema-${first.toLowerCase()}` : 'schema';
}

// ---------------------------------------------------------------------------
// Thème : suit l'apparence de Grist (ou celle du système hors Grist)
// ---------------------------------------------------------------------------

const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function syncTheme() {
  const appearance = document.documentElement.getAttribute('data-grist-appearance');
  const dark = appearance ? appearance === 'dark' : Boolean(darkQuery && darkQuery.matches);
  const theme = dark ? 'dark' : 'light';
  if (document.documentElement.getAttribute('data-fr-theme') !== theme) {
    document.documentElement.setAttribute('data-fr-theme', theme);
    if (state.tab === 'schema') renderDiagram();
  }
}
new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-grist-appearance'] });
darkQuery?.addEventListener?.('change', syncTheme);

// ---------------------------------------------------------------------------
// Calcul
// ---------------------------------------------------------------------------

function recompute() {
  let result = null;
  if (state.source === 'doc') {
    result = state.schema ? convertAll({ schema: state.schema }) : null;
  } else if (state.code.trim()) {
    result = convertAll({ code: state.code });
  }
  state.result = result;
  state.findings = result ? analyze(result, state.strict ? 'strict' : 'corrected') : [];
  render();
  const out = shown();
  if (out && !(state.strict && result.strict.error)) {
    const s = computeStats(out.tables);
    announce(`DBML mis à jour : ${plural(s.tables, 'table', 'tables')}, ${plural(s.relations, 'relation', 'relations')}.`);
  }
}

async function loadSchema() {
  if (!inGrist || state.schemaLoading) return;
  state.schemaLoading = true;
  renderSource();
  try {
    const [tables, columns] = await Promise.all([
      gristApi.docApi.fetchTable('_grist_Tables'),
      gristApi.docApi.fetchTable('_grist_Tables_column'),
    ]);
    state.schema = schemaFromMetadata(tables, columns);
    state.schemaError = null;
    state.schemaAt = new Date();
  } catch (err) {
    state.schema = null;
    state.schemaError = err;
  } finally {
    state.schemaLoading = false;
  }
  if (state.source === 'doc') recompute();
  else renderSource();
}
const loadSchemaSoon = debounce(loadSchema, 1200);

// ---------------------------------------------------------------------------
// Options du widget (enregistrées dans le document Grist)
// ---------------------------------------------------------------------------

function saveOption(key, value) {
  if (!inGrist) return;
  Promise.resolve(gristApi.setOption(key, value)).catch(() => { /* accès en lecture seule */ });
}
const saveCodeSoon = debounce(() => {
  if (state.mappings?.code) return; // le code vient alors de la ligne sélectionnée
  saveOption('code', state.code.length <= MAX_SAVED_CODE ? state.code : '');
}, 1000);

function applyOptions(options) {
  if (!options) { state.optionsApplied = true; return; }
  let changed = false;
  if (typeof options.strict === 'boolean' && options.strict !== state.strict) { state.strict = options.strict; changed = true; }
  if ((options.source === 'doc' || options.source === 'code') && options.source !== state.source) { state.source = options.source; changed = true; }
  if (options.diagram && typeof options.diagram === 'object') {
    const d = options.diagram;
    state.diagram = {
      detail: ['all', 'keys', 'tables'].includes(d.detail) ? d.detail : 'all',
      positions: d.positions && typeof d.positions === 'object' ? d.positions : null,
    };
  }
  if (typeof options.code === 'string' && !state.mappings?.code && options.code !== state.code && document.activeElement !== els['code-input']) {
    state.code = options.code;
    changed = true;
  }
  state.optionsApplied = true;
  if (changed) recompute();
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function render() {
  renderSource();
  renderSummary();
  renderDbml();
  renderTables();
  renderAnalysis();
  if (state.tab === 'schema') renderDiagram();
}

function renderSource() {
  els['source-doc'].checked = state.source === 'doc';
  els['source-code'].checked = state.source === 'code';
  els['source-doc'].disabled = !inGrist;
  els['standalone-notice'].hidden = inGrist;
  els['panel-doc'].hidden = state.source !== 'doc';
  els['panel-code'].hidden = state.source !== 'code';
  els['strict-toggle'].checked = state.strict;
  if (els['code-input'].value !== state.code) els['code-input'].value = state.code;

  // Mode « Ce document »
  if (state.schemaLoading && !state.schema) {
    els['doc-status'].textContent = 'Lecture de la structure du document…';
  } else if (state.schema) {
    const n = state.result?.corrected?.tables?.filter((t) => t.kind === 'table').length
      ?? [...state.schema.keys()].length;
    const time = state.schemaAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    els['doc-status'].innerHTML = `<strong>${esc(plural(n, 'table', 'tables'))}</strong> lue${n > 1 ? 's' : ''} à ${esc(time)}.`;
  } else {
    els['doc-status'].textContent = '';
  }
  if (state.schemaError) {
    els['doc-alert'].innerHTML = `
      <div class="fr-alert fr-alert--warning fr-alert--sm">
        <p><strong>Accès complet requis.</strong> Pour lire la structure, le widget doit avoir l'accès
        « Accès complet au document » (panneau de droite, rubrique Widget). Vous pouvez aussi passer en
        « Code collé ».</p>
        <p class="fr-hint-text">Détail : ${esc(state.schemaError.message || state.schemaError)}</p>
      </div>`;
  } else {
    els['doc-alert'].innerHTML = '';
  }
  els['btn-refresh'].disabled = state.schemaLoading;
  els['btn-edit-code'].disabled = !state.result?.codeView || state.source !== 'doc';

  // Mode « Code collé » lié à une colonne
  const codeCol = state.mappings?.code;
  if (codeCol && state.source === 'code') {
    els['row-info'].hidden = false;
    els['row-info'].textContent = state.record
      ? `Code lu dans la colonne « ${codeCol} » de la ligne sélectionnée. Les modifications faites ici ne sont pas enregistrées dans la ligne.`
      : `Sélectionnez une ligne pour lire le code de la colonne « ${codeCol} ».`;
  } else {
    els['row-info'].hidden = true;
  }
}

function renderSummary() {
  const out = shown();
  if (!out || (state.strict && state.result.strict.error)) {
    els.summary.innerHTML = '';
    return;
  }
  const s = computeStats(out.tables);
  const errors = state.findings.filter((f) => f.level === 'error').length;
  const diffs = state.findings.filter((f) => DIFF_CODES.has(f.code)).length;
  const tags = [
    plural(s.tables, 'table', 'tables'),
    plural(s.columns, 'colonne', 'colonnes'),
    plural(s.relations, 'relation', 'relations'),
    plural(s.formulas, 'formule', 'formules'),
  ].map((t) => `<li><p class="fr-tag fr-tag--sm">${esc(t)}</p></li>`).join('');
  const mode = state.strict
    ? '<p class="fr-badge fr-badge--sm fr-badge--info fr-badge--no-icon">Formule d\'origine</p>'
    : '<p class="fr-badge fr-badge--sm fr-badge--success fr-badge--no-icon">Conversion corrigée</p>';
  let note = '';
  if (errors) {
    note = `<button class="fr-link fr-link--sm fr-icon-error-warning-line fr-link--icon-left" type="button" data-goto-tab="analysis">${esc(plural(errors, 'erreur bloque', 'erreurs bloquent'))} l'import</button>`;
  } else if (state.strict && diffs) {
    note = `<button class="fr-link fr-link--sm fr-icon-warning-line fr-link--icon-left" type="button" data-goto-tab="analysis">${esc(plural(diffs, 'écart', 'écarts'))} avec la conversion corrigée</button>`;
  }
  els.summary.innerHTML = `<ul class="fr-tags-group fr-tags-group--sm">${tags}</ul>${mode}${note}`;
}

function emptyState(html) {
  return `<div class="empty">${html}</div>`;
}

function sourceEmptyMessage() {
  if (state.source === 'doc') {
    if (state.schemaLoading) return emptyState('<p>Lecture de la structure du document…</p>');
    return emptyState('<p>La structure du document n\'est pas disponible. Vérifiez l\'accès du widget ou passez en « Code collé ».</p>');
  }
  return emptyState(`
    <p>Collez le contenu de la Vue du code de votre document pour obtenir son schéma en DBML.</p>
    <button class="fr-btn fr-btn--sm fr-btn--secondary fr-btn--icon-left fr-icon-file-text-line" type="button" data-action="example">Charger l'exemple</button>`);
}

function highlightType(rest) {
  const m = /^("formula\[[^\]]*\]"|\S*)(.*)$/.exec(rest);
  if (!m) return esc(rest);
  const cls = m[1].startsWith('"') ? 't-formula' : 't-type';
  const settings = esc(m[2])
    .replace(/\[ref: (&lt;&gt;|&gt;) ([^\]]+)\]/g, '<span class="t-ref">[ref: $1 $2]</span>')
    .replace(/\[primary key\]/g, '<span class="t-pk">[primary key]</span>');
  return `<span class="${cls}">${esc(m[1])}</span>${settings}`;
}

function highlightDbml(dbml) {
  const table = new Map();
  const column = new Map();
  let current = null;
  const html = dbml.split('\n').map((line, i) => {
    const n = i + 1;
    let inner;
    let m;
    if ((m = /^Table (.+) \{$/.exec(line))) {
      current = m[1];
      if (!table.has(current)) table.set(current, n);
      inner = `<span class="t-kw">Table</span> <span class="t-table">${esc(current)}</span> <span class="t-punct">{</span>`;
    } else if (line === '}') {
      current = null;
      inner = '<span class="t-punct">}</span>';
    } else if (current !== null && line.startsWith('  ')) {
      const body = line.slice(2);
      const sp = body.indexOf(' ');
      const name = sp < 0 ? body : body.slice(0, sp);
      const key = `${current}.${name}`;
      if (!column.has(key)) column.set(key, n);
      inner = `  <span class="t-col">${esc(name)}</span>${sp < 0 ? '' : ' ' + highlightType(body.slice(sp + 1))}`;
    } else {
      inner = esc(line);
    }
    return `<span class="ln" data-line="${n}" id="dbml-L${n}">${inner}</span>`;
  }).join('');
  return { html, table, column };
}

function renderDbml() {
  const out = shown();
  const failing = state.strict && state.result?.strict.error;
  const usable = Boolean(out && out.dbml && !failing);
  for (const id of ['btn-copy', 'btn-download']) els[id].disabled = !usable;
  els['btn-open'].setAttribute('aria-disabled', String(!usable));
  els['btn-open'].classList.toggle('is-disabled', !usable);
  if (!usable) els['btn-open'].removeAttribute('href'); else els['btn-open'].href = 'https://dbdiagram.io/d';
  els['btn-save'].hidden = !(inGrist && state.mappings?.dbml);
  els['btn-save'].disabled = !usable || !state.record;
  if (state.mappings?.dbml) els['btn-save'].textContent = `Enregistrer dans « ${state.mappings.dbml} »`;

  if (!state.result) {
    state.lines = { table: new Map(), column: new Map() };
    els['dbml-body'].innerHTML = sourceEmptyMessage();
    return;
  }
  if (failing) {
    const e = state.result.strict.error;
    state.lines = { table: new Map(), column: new Map() };
    els['dbml-body'].innerHTML = `
      <div class="fr-alert fr-alert--error">
        <h3 class="fr-alert__title">La formule d'origine échoue sur ce code</h3>
        <p>Elle lève « ${esc(e.message)} » à la ligne ${e.line} : une déclaration de colonne apparaît avant toute table.
        Dans Grist, la cellule afficherait une erreur.</p>
        <button class="fr-btn fr-btn--sm fr-btn--secondary fr-mt-2w" type="button" data-action="corrected">Utiliser la conversion corrigée</button>
      </div>`;
    return;
  }
  if (!out.dbml) {
    state.lines = { table: new Map(), column: new Map() };
    els['dbml-body'].innerHTML = emptyState('<p>Aucune table détectée. Le texte collé doit provenir de la Vue du code (il commence par « import grist »).</p>');
    return;
  }
  const { html, table, column } = highlightDbml(out.dbml);
  state.lines = { table, column };
  els['dbml-body'].innerHTML = `<pre class="code" aria-label="Code DBML"><code>${html}</code></pre>`;
}

function slug(name) {
  return 'tbl-' + String(name).replace(/[^A-Za-z0-9_-]/g, '_');
}

function renderTables() {
  const out = shown();
  if (!out || (state.strict && state.result.strict.error)) {
    els['tables-body'].innerHTML = state.result ? '' : sourceEmptyMessage();
    return;
  }
  const q = state.filter.trim().toLowerCase();
  const incoming = new Map();
  for (const t of out.tables) {
    for (const c of t.columns) {
      if (!c.ref) continue;
      if (!incoming.has(c.ref.table)) incoming.set(c.ref.table, []);
      incoming.get(c.ref.table).push({ table: t.name, column: c.name });
    }
  }
  const known = new Set(out.tables.map((t) => t.name));
  const matches = (s) => q && String(s).toLowerCase().includes(q);
  const visible = out.tables.filter((t) => !q || matches(t.name) || t.columns.some((c) => matches(c.name)));
  if (!visible.length) {
    els['tables-body'].innerHTML = emptyState(q ? `<p>Aucune table ni colonne ne contient « ${esc(state.filter)} ».</p>` : '<p>Aucune table.</p>');
    return;
  }
  const cards = visible.map((t) => {
    const rows = t.columns.map((c) => {
      let rel = '';
      if (c.ref) {
        const label = c.ref.kind === '<>' ? 'plusieurs vers' : 'vers';
        rel = known.has(c.ref.table)
          ? `${label} <a href="#${slug(c.ref.table)}" data-goto-table="${esc(c.ref.table)}">${esc(c.ref.table)}</a>`
          : `${label} <strong>${esc(c.ref.table)}</strong> (table absente)`;
      }
      const cls = [c.isFormula ? 'is-formula' : '', matches(c.name) ? 'is-match' : ''].filter(Boolean).join(' ');
      return `<tr${cls ? ` class="${cls}"` : ''}>
        <th scope="row">${esc(c.name)}</th>
        <td class="tbl__type"><code>${esc(c.base)}</code>${c.isFormula ? ' <span class="col-flag">formule</span>' : ''}</td>
        <td class="tbl__rel">${rel}</td></tr>`;
    }).join('');
    const refs = incoming.get(t.name) || [];
    const inc = refs.length
      ? `<p class="tbl__incoming">Référencée par ${refs.map((r) => `<a href="#${slug(r.table)}" data-goto-table="${esc(r.table)}">${esc(r.table)}.${esc(r.column)}</a>`).join(', ')}</p>`
      : '';
    const line = state.lines.table.get(t.name);
    return `<article class="tbl" id="${slug(t.name)}">
      <header class="tbl__head">
        <h3 class="tbl__name">${esc(t.name)}</h3>
        ${t.kind === 'summary' ? '<p class="fr-tag fr-tag--sm">Synthèse</p>' : ''}
        <span class="tbl__meta">${esc(plural(t.columns.length, 'colonne', 'colonnes'))}</span>
        <span class="tbl__actions">
          <button class="fr-btn fr-btn--sm fr-btn--tertiary-no-outline" type="button" data-goto-schema="${esc(t.name)}">Schéma</button>
          ${line ? `<button class="fr-btn fr-btn--sm fr-btn--tertiary-no-outline" type="button" data-goto-line="${line}">DBML</button>` : ''}
        </span>
      </header>
      <table class="tbl__cols">
        <caption class="fr-sr-only">Colonnes de ${esc(t.name)}</caption>
        <thead class="fr-sr-only"><tr><th scope="col">Colonne</th><th scope="col">Type</th><th scope="col">Relation</th></tr></thead>
        <tbody>
          <tr><th scope="row">id</th><td class="tbl__type"><code>integer</code> <span class="col-pk">clé primaire</span></td><td class="tbl__rel"></td></tr>
          ${rows}
        </tbody>
      </table>
      ${inc}
    </article>`;
  }).join('');
  els['tables-body'].innerHTML = `<div class="tables__list">${cards}</div>`;
}

const GROUPS = [
  { level: 'error', title: 'À corriger avant l\'import', intro: 'Ces points font échouer l\'import dans dbdiagram.io et les autres outils DBML.' },
  { level: 'warning', title: 'Points d\'attention', intro: 'Le DBML s\'importe, mais ne décrit pas fidèlement le document.' },
  { level: 'fixed', title: 'Corrigé par rapport à la formule d\'origine', intro: 'La formule d\'origine produirait un résultat différent sur ces points.' },
  { level: 'info', title: 'Pour information', intro: '' },
];

function renderAnalysis() {
  const count = els['analysis-count'];
  if (!state.result) {
    count.hidden = true;
    els['analysis-body'].innerHTML = sourceEmptyMessage();
    return;
  }
  const findings = state.findings.map((f) => (!state.strict && DIFF_CODES.has(f.code) ? { ...f, level: 'fixed' } : f));
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.filter((f) => f.level === 'warning').length;
  count.hidden = !(errors || warnings);
  count.textContent = String(errors || warnings);
  count.className = 'tabs__count' + (errors ? ' tabs__count--error' : '');
  count.setAttribute('aria-label', errors ? plural(errors, 'erreur', 'erreurs') : plural(warnings, 'point d\'attention', 'points d\'attention'));

  if (!findings.length) {
    els['analysis-body'].innerHTML = `<div class="fr-alert fr-alert--success fr-alert--sm"><p>Aucun problème détecté : le DBML s'importe tel quel et correspond à la structure du document.</p></div>`;
    return;
  }
  const html = GROUPS.map((g) => {
    const items = findings.filter((f) => f.level === g.level);
    if (!items.length) return '';
    const alertLevel = g.level === 'fixed' ? 'success' : g.level;
    const list = items.map((f) => {
      const actions = [];
      const line = f.column ? state.lines.column.get(`${f.table}.${f.column}`) : f.table ? state.lines.table.get(f.table) : null;
      if (line) actions.push(`<button class="fr-link fr-link--sm" type="button" data-goto-line="${line}">Voir dans le DBML</button>`);
      if (f.line && state.source === 'code') actions.push(`<button class="fr-link fr-link--sm" type="button" data-goto-code="${f.line}">Ligne ${f.line} du code</button>`);
      return `<div class="fr-alert fr-alert--${alertLevel} fr-alert--sm finding">
        <p class="finding__title">${esc(f.title)}</p>
        <p>${esc(f.detail)}</p>
        ${actions.length ? `<p class="finding__actions">${actions.join('')}</p>` : ''}
      </div>`;
    }).join('');
    return `<section class="findings__group" aria-label="${esc(g.title)}">
      <h3>${esc(g.title)} (${items.length})</h3>
      ${g.intro ? `<p>${esc(g.intro)}</p>` : ''}
      <div class="findings__list">${list}</div>
    </section>`;
  }).join('');
  const hint = state.strict && findings.some((f) => DIFF_CODES.has(f.code))
    ? `<div class="fr-callout fr-callout--blue-france fr-mb-0"><p class="fr-callout__text fr-text--md">Ces écarts viennent de la formule d'origine. Désactivez « Reproduire exactement la formule d'origine » pour les corriger.</p>
       <button class="fr-btn fr-btn--sm" type="button" data-action="corrected">Utiliser la conversion corrigée</button></div>`
    : '';
  els['analysis-body'].innerHTML = `<div class="findings">${hint}${html}</div>`;
}

// ---------------------------------------------------------------------------
// Schéma (visualiseur maison + disposition ELK, chargée à la demande)
// ---------------------------------------------------------------------------

let viewer = null;
let diagramReady = Promise.resolve();
const DIAGRAM_CONTROLS = ['btn-zoom-in', 'btn-zoom-out', 'btn-zoom-fit', 'btn-relayout', 'btn-svg', 'btn-png', 'find-table',
  'detail-all', 'detail-keys', 'detail-tables'];

const saveDiagramSoon = debounce(() => saveOption('diagram', { ...state.diagram }), 800);

function ensureViewer() {
  if (viewer) return viewer;
  els['schema-body'].innerHTML = '';
  viewer = new ErdViewer(els['schema-body'], {
    onViewChange: (view) => { els['zoom-value'].textContent = `${Math.round(view.k * 100)} %`; },
    onLayoutChange: (positions) => {
      state.diagram = { ...state.diagram, positions };
      saveDiagramSoon();
    },
  });
  return viewer;
}

function updateZoomControls(enabled) {
  for (const id of DIAGRAM_CONTROLS) els[id].disabled = !enabled;
}

async function renderDiagram() {
  const out = shown();
  const body = els['schema-body'];
  for (const id of ['detail-all', 'detail-keys', 'detail-tables']) els[id].checked = els[id].value === state.diagram.detail;
  if (!out || (state.strict && state.result.strict.error) || !out.tables.length) {
    viewer?.destroy();
    viewer = null;
    state.diagramKey = null;
    body.innerHTML = state.result ? emptyState('<p>Aucune table à dessiner.</p>') : sourceEmptyMessage();
    updateZoomControls(false);
    return;
  }
  const key = JSON.stringify(out.tables.map((t) => [t.name, t.kind, t.columns.map((c) => [c.name, c.base, c.isFormula, c.ref])]));
  if (key === state.diagramKey && viewer) return diagramReady;
  state.diagramKey = key;
  const v = ensureViewer();
  updateZoomControls(true);
  els['find-table-list'].innerHTML = out.tables.map((t) => `<option value="${esc(t.name)}"></option>`).join('');
  diagramReady = v.setData(out.tables, { positions: state.diagram.positions, detail: state.diagram.detail })
    .catch((err) => {
      console.error(err);
      toast(`Le schéma n'a pas pu être dessiné : ${err.message || err}`, 'error');
    });
  return diagramReady;
}

/** Ouvre l'onglet Schéma centré sur une table. */
async function showOnDiagram(name) {
  selectTab('schema');
  await renderDiagram();
  viewer?.focusTable(name);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function selectTab(name, { focus = false } = {}) {
  state.tab = name;
  for (const t of tabs) {
    const tab = $(`tab-${t}`);
    const panel = $(`tabpanel-${t}`);
    const active = t === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  }
  if (focus) $(`tab-${name}`).focus();
  if (name === 'schema') renderDiagram();
}

function flash(el) {
  el.classList.add('is-target');
  setTimeout(() => el.classList.remove('is-target'), 1800);
}

function gotoDbmlLine(line) {
  selectTab('dbml');
  const el = $(`dbml-L${line}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  flash(el);
}

function gotoTable(name) {
  if (state.filter && !name.toLowerCase().includes(state.filter.toLowerCase())) {
    state.filter = '';
    els['filter-input'].value = '';
    renderTables();
  }
  selectTab('tables');
  const el = $(slug(name));
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  flash(el);
}

function gotoCodeLine(line) {
  const ta = els['code-input'];
  const lines = ta.value.split('\n');
  let start = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
  const end = start + (lines[line - 1] || '').length;
  ta.focus();
  ta.setSelectionRange(start, end);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
  ta.scrollTop = Math.max(0, (line - 4) * lh);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function setSource(source) {
  if (source === state.source) return;
  state.source = source;
  saveOption('source', source);
  recompute();
  if (source === 'doc' && !state.schema && !state.schemaLoading) loadSchema();
}

function setStrict(strict) {
  if (strict === state.strict) return;
  state.strict = strict;
  saveOption('strict', strict);
  recompute();
}

function setCode(code, { save = true } = {}) {
  state.code = code;
  if (save) saveCodeSoon();
  recompute();
}

async function saveToRow() {
  const col = state.mappings?.dbml;
  const out = shown();
  if (!col || !state.record || !out) return;
  try {
    await gristApi.selectedTable.update({ id: state.record.id, fields: { [col]: out.dbml } });
    toast(`DBML enregistré dans la colonne « ${col} ».`);
  } catch (err) {
    toast(`Enregistrement impossible dans « ${col} » : ${err.message || err}. Choisissez une colonne de données (pas une formule).`, 'error');
  }
}

function buttonFeedback(btn, label) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = label;
  btn.classList.replace('fr-icon-clipboard-line', 'fr-icon-check-line');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.replace('fr-icon-check-line', 'fr-icon-clipboard-line');
  }, 2000);
}

function bindEvents() {
  for (const input of [els['source-doc'], els['source-code']]) {
    input.addEventListener('change', () => { if (input.checked) setSource(input.value); });
  }
  els['strict-toggle'].addEventListener('change', () => setStrict(els['strict-toggle'].checked));
  const onInput = debounce(() => setCode(els['code-input'].value), 200);
  els['code-input'].addEventListener('input', onInput);
  els['btn-example'].addEventListener('click', () => setCode(EXAMPLE_CODE));
  els['btn-clear'].addEventListener('click', () => { setCode(''); els['code-input'].focus(); });
  els['btn-refresh'].addEventListener('click', () => loadSchema());
  els['btn-edit-code'].addEventListener('click', () => {
    if (!state.result?.codeView) return;
    state.code = state.result.codeView;
    saveCodeSoon();
    setSource('code');
    els['code-input'].focus();
    els['code-input'].setSelectionRange(0, 0);
    toast('Vue du code reconstituée copiée dans « Code collé ».', 'info');
  });

  els['btn-copy'].addEventListener('click', async () => {
    const out = shown();
    if (!out) return;
    if (await copyText(out.dbml)) buttonFeedback(els['btn-copy'], 'Copié');
    else toast('La copie a été refusée par le navigateur : utilisez « Télécharger ».', 'error');
  });
  els['btn-download'].addEventListener('click', () => {
    const out = shown();
    if (out) downloadFile(`${fileBaseName()}.dbml`, out.dbml, 'text/plain;charset=utf-8');
  });
  els['btn-open'].addEventListener('click', (ev) => {
    const out = shown();
    if (!out || els['btn-open'].classList.contains('is-disabled')) { ev.preventDefault(); return; }
    copyText(out.dbml).then((ok) => {
      toast(ok ? 'DBML copié : collez-le dans l\'éditeur de dbdiagram.io.' : 'Copie refusée : copiez le DBML manuellement.', ok ? 'success' : 'error');
    });
  });
  els['btn-save'].addEventListener('click', saveToRow);

  els['filter-input'].addEventListener('input', debounce(() => {
    state.filter = els['filter-input'].value;
    renderTables();
  }, 120));

  els['btn-zoom-in'].addEventListener('click', () => viewer?.zoomAt(1.25));
  els['btn-zoom-out'].addEventListener('click', () => viewer?.zoomAt(0.8));
  els['btn-zoom-fit'].addEventListener('click', () => viewer?.fit());
  els['btn-relayout'].addEventListener('click', async () => {
    if (!viewer) return;
    await viewer.layout({ relayout: true });
    state.diagram = { ...state.diagram, positions: null };
    saveDiagramSoon();
    toast('Disposition recalculée.', 'info');
  });
  for (const id of ['detail-all', 'detail-keys', 'detail-tables']) {
    els[id].addEventListener('change', () => {
      if (!els[id].checked) return;
      state.diagram = { ...state.diagram, detail: els[id].value };
      viewer?.setDetail(els[id].value);
      saveDiagramSoon();
    });
  }
  const findTable = () => {
    const name = els['find-table'].value.trim();
    if (!viewer || !name) return;
    const match = [...viewer.nodes.keys()].find((id) => id.toLowerCase() === name.toLowerCase());
    if (match) { viewer.focusTable(match); els['find-table'].value = ''; }
  };
  els['find-table'].addEventListener('change', findTable);
  els['find-table'].addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); findTable(); } });
  els['btn-svg'].addEventListener('click', () => {
    if (viewer) downloadFile(`${fileBaseName()}.svg`, viewer.toSvg(), 'image/svg+xml');
  });
  els['btn-png'].addEventListener('click', async () => {
    if (!viewer) return;
    try {
      const blob = await viewer.toPng();
      downloadFile(`${fileBaseName()}.png`, blob, 'image/png');
    } catch (err) {
      toast(`Export PNG impossible : ${err.message || err}. Utilisez le SVG.`, 'error');
    }
  });

  // Onglets : clic et clavier (flèches, Début, Fin)
  for (const t of tabs) {
    const tab = $(`tab-${t}`);
    tab.addEventListener('click', () => selectTab(t));
    tab.addEventListener('keydown', (ev) => {
      const i = tabs.indexOf(t);
      let next = null;
      if (ev.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      else if (ev.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (ev.key === 'Home') next = tabs[0];
      else if (ev.key === 'End') next = tabs[tabs.length - 1];
      if (next) { ev.preventDefault(); selectTab(next, { focus: true }); }
    });
  }

  // Liens et boutons rendus dynamiquement
  document.addEventListener('click', (ev) => {
    const target = ev.target.closest('[data-goto-line],[data-goto-table],[data-goto-code],[data-goto-tab],[data-goto-schema],[data-action]');
    if (!target) return;
    if (target.dataset.gotoSchema) { ev.preventDefault(); showOnDiagram(target.dataset.gotoSchema); }
    else if (target.dataset.gotoLine) { ev.preventDefault(); gotoDbmlLine(Number(target.dataset.gotoLine)); }
    else if (target.dataset.gotoTable) { ev.preventDefault(); gotoTable(target.dataset.gotoTable); }
    else if (target.dataset.gotoCode) { ev.preventDefault(); gotoCodeLine(Number(target.dataset.gotoCode)); }
    else if (target.dataset.gotoTab) { ev.preventDefault(); selectTab(target.dataset.gotoTab, { focus: true }); }
    else if (target.dataset.action === 'example') setCode(EXAMPLE_CODE);
    else if (target.dataset.action === 'corrected') setStrict(false);
  });
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

function connectGrist() {
  gristApi.ready({
    requiredAccess: 'full',
    allowSelectBy: false,
    columns: [
      {
        name: 'code',
        title: 'Code Grist (source)',
        optional: true,
        type: 'Text',
        description: 'Colonne contenant le texte de la Vue du code. En mode « Code collé », le widget lit la ligne sélectionnée.',
      },
      {
        name: 'dbml',
        title: 'DBML (destination)',
        optional: true,
        type: 'Text',
        description: 'Colonne de données où le bouton « Enregistrer » écrit le DBML produit.',
      },
    ],
  });
  gristApi.onOptions((options) => applyOptions(options));
  gristApi.onRecord((record, mappings) => {
    state.record = record || null;
    state.mappings = mappings || null;
    const col = mappings?.code;
    if (col && record && typeof record[col] === 'string' && record[col] !== state.code) {
      state.code = record[col];
      if (state.source === 'code') { recompute(); return; }
    }
    renderSource();
    renderDbml();
  });
  gristApi.onRecords(() => { if (state.source === 'doc') loadSchemaSoon(); });
  loadSchema();
}

bindEvents();
syncTheme();
if (inGrist) connectGrist();
recompute();
