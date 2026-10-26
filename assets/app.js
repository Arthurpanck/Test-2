import {
  convertAll, analyzeDocument, computeStats, schemaFromMetadata,
} from './converter.js?v=2.0.0';
import { ErdViewer } from './erd.js?v=2.0.0';

// Le widget lit toujours la structure du document où il est installé et produit
// la conversion corrigée (relations et types fidèles au document).

const gristApi = window.grist;
const inGrist = Boolean(gristApi) && window.self !== window.top;

const $ = (id) => document.getElementById(id);
const els = {};
for (const id of ['stats', 'read-at', 'btn-refresh', 'doc-alert', 'analysis-count',
  'btn-zoom-out', 'zoom-value', 'btn-zoom-in', 'btn-zoom-fit', 'btn-relayout', 'detail-all', 'detail-keys', 'detail-tables',
  'btn-minimap', 'find-table', 'find-table-list', 'btn-svg', 'btn-png', 'schema-body',
  'filter-input', 'cols-all', 'cols-refs', 'cols-formulas', 'btn-csv', 'tables-body',
  'level-all', 'level-error', 'level-info', 'level-all-label', 'level-error-label', 'level-info-label', 'btn-report', 'analysis-body',
  'btn-copy', 'btn-download', 'btn-save', 'btn-wrap', 'dbml-body', 'toast', 'live']) {
  els[id] = $(id);
}
const tabs = ['schema', 'tables', 'analysis', 'dbml'];

const state = {
  schema: null,
  schemaAt: null,
  schemaError: null,
  schemaLoading: false,
  out: null, // { tables, dbml }
  findings: [],
  tab: 'schema',
  record: null,
  mappings: null,
  filter: '',
  cols: 'all',
  level: 'all',
  wrap: false,
  minimap: true,
  diagramKey: null,
  diagram: { detail: 'all', positions: null }, // mémorisé dans les options du widget
  lines: { table: new Map(), column: new Map() },
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
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buttonFeedback(btn, label) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = original; }, 2000);
}

// ---------------------------------------------------------------------------
// Thème : suit l'apparence de Grist (ou celle du système hors Grist)
// ---------------------------------------------------------------------------

const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function syncTheme() {
  const appearance = document.documentElement.getAttribute('data-grist-appearance');
  const dark = appearance ? appearance === 'dark' : Boolean(darkQuery && darkQuery.matches);
  document.documentElement.setAttribute('data-fr-theme', dark ? 'dark' : 'light');
}
new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-grist-appearance'] });
darkQuery?.addEventListener?.('change', syncTheme);

// ---------------------------------------------------------------------------
// Lecture de la structure et calcul
// ---------------------------------------------------------------------------

function recompute() {
  state.out = state.schema ? convertAll({ schema: state.schema }).corrected : null;
  state.findings = state.out ? analyzeDocument(state.out) : [];
  render();
  if (state.out) {
    const s = computeStats(state.out.tables);
    announce(`Structure mise à jour : ${plural(s.tables, 'table', 'tables')}, ${plural(s.relations, 'relation', 'relations')}.`);
  }
}

async function loadSchema({ manual = false } = {}) {
  if (!inGrist || state.schemaLoading) return;
  state.schemaLoading = true;
  renderHeader();
  try {
    const [tables, columns] = await Promise.all([
      gristApi.docApi.fetchTable('_grist_Tables'),
      gristApi.docApi.fetchTable('_grist_Tables_column'),
    ]);
    state.schema = schemaFromMetadata(tables, columns);
    state.schemaError = null;
    state.schemaAt = new Date();
  } catch (err) {
    state.schemaError = err;
  } finally {
    state.schemaLoading = false;
  }
  recompute();
  if (manual && !state.schemaError) toast('Structure du document relue.', 'info');
}
const loadSchemaSoon = debounce(() => loadSchema(), 1200);

// ---------------------------------------------------------------------------
// Options du widget (enregistrées dans le document Grist)
// ---------------------------------------------------------------------------

function saveOption(key, value) {
  if (!inGrist) return;
  Promise.resolve(gristApi.setOption(key, value)).catch(() => { /* accès en lecture seule */ });
}
const saveDiagramSoon = debounce(() => saveOption('diagram', { ...state.diagram }), 800);

function applyOptions(options) {
  const d = options?.diagram;
  if (d && typeof d === 'object') {
    state.diagram = {
      detail: ['all', 'keys', 'tables'].includes(d.detail) ? d.detail : 'all',
      positions: d.positions && typeof d.positions === 'object' ? d.positions : null,
    };
  }
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function render() {
  renderHeader();
  renderDbml();
  renderTables();
  renderAnalysis();
  if (state.tab === 'schema') renderDiagram();
}

function emptyState(html) {
  return `<div class="empty">${html}</div>`;
}

function unavailableMessage() {
  if (!inGrist) return emptyState('<p>Ce widget s\'utilise dans Grist : ajoutez-le comme widget personnalisé avec l\'accès « Accès complet au document ».</p>');
  if (state.schemaLoading) return emptyState('<p>Lecture de la structure du document…</p>');
  return emptyState('<p>La structure du document n\'est pas disponible.</p>');
}

function renderHeader() {
  if (state.out) {
    const s = computeStats(state.out.tables);
    els.stats.textContent = [
      plural(s.tables, 'table', 'tables'), plural(s.columns, 'colonne', 'colonnes'),
      plural(s.relations, 'relation', 'relations'), plural(s.formulas, 'formule', 'formules'),
    ].join(' · ');
  } else {
    els.stats.textContent = '';
  }
  if (state.schemaLoading) els['read-at'].textContent = 'Lecture en cours…';
  else if (state.schemaAt) els['read-at'].textContent = `Structure lue à ${state.schemaAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  else els['read-at'].textContent = '';
  els['btn-refresh'].disabled = !inGrist || state.schemaLoading;

  if (!inGrist) {
    els['doc-alert'].innerHTML = `<div class="fr-alert fr-alert--info fr-alert--sm"><p>Ouvrez ce widget dans un document Grist : il lit directement la structure du document où il est installé.</p></div>`;
  } else if (state.schemaError) {
    els['doc-alert'].innerHTML = `
      <div class="fr-alert fr-alert--warning fr-alert--sm">
        <p><strong>Accès complet requis.</strong> Dans le panneau de droite de Grist, rubrique Widget, choisissez
        « Accès complet au document », puis cliquez sur « Relire le document ».</p>
        <p class="fr-hint-text">Détail : ${esc(state.schemaError.message || state.schemaError)}</p>
      </div>`;
  } else {
    els['doc-alert'].innerHTML = '';
  }
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
      if (!column.has(`${current}.${name}`)) column.set(`${current}.${name}`, n);
      inner = `  <span class="t-col">${esc(name)}</span>${sp < 0 ? '' : ' ' + highlightType(body.slice(sp + 1))}`;
    } else {
      inner = esc(line);
    }
    return `<span class="ln" data-line="${n}" id="dbml-L${n}">${inner}</span>`;
  }).join('');
  return { html, table, column };
}

function renderDbml() {
  const out = state.out;
  const usable = Boolean(out && out.dbml);
  els['btn-copy'].disabled = !usable;
  els['btn-download'].disabled = !usable;
  els['btn-save'].hidden = !(inGrist && state.mappings?.dbml);
  els['btn-save'].disabled = !usable || !state.record;
  if (state.mappings?.dbml) els['btn-save'].textContent = `Enregistrer dans « ${state.mappings.dbml} »`;
  els['btn-wrap'].setAttribute('aria-pressed', String(state.wrap));
  if (!out) {
    state.lines = { table: new Map(), column: new Map() };
    els['dbml-body'].innerHTML = unavailableMessage();
    return;
  }
  if (!out.dbml) {
    state.lines = { table: new Map(), column: new Map() };
    els['dbml-body'].innerHTML = emptyState('<p>Ce document ne contient aucune table.</p>');
    return;
  }
  const { html, table, column } = highlightDbml(out.dbml);
  state.lines = { table, column };
  els['dbml-body'].innerHTML = `<pre class="code${state.wrap ? ' code--wrap' : ''}" aria-label="Code DBML"><code>${html}</code></pre>`;
}

function slug(name) {
  return 'tbl-' + String(name).replace(/[^A-Za-z0-9_-]/g, '_');
}

function renderTables() {
  const out = state.out;
  if (!out) { els['tables-body'].innerHTML = unavailableMessage(); return; }
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
  const keep = (c) => state.cols === 'all' || (state.cols === 'refs' ? Boolean(c.ref) : c.isFormula);
  const visible = out.tables
    .map((t) => ({ ...t, shownColumns: t.columns.filter(keep) }))
    .filter((t) => (!q || matches(t.name) || t.shownColumns.some((c) => matches(c.name)))
      && (state.cols === 'all' || t.shownColumns.length));
  if (!visible.length) {
    els['tables-body'].innerHTML = emptyState(q ? `<p>Aucune table ni colonne ne contient « ${esc(state.filter)} ».</p>` : '<p>Aucune table ne correspond.</p>');
    return;
  }
  const cards = visible.map((t) => {
    const rows = t.shownColumns.map((c) => {
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
    const pk = state.cols === 'all'
      ? '<tr><th scope="row">id</th><td class="tbl__type"><code>integer</code> <span class="col-pk">clé primaire</span></td><td class="tbl__rel"></td></tr>'
      : '';
    return `<article class="tbl" id="${slug(t.name)}">
      <header class="tbl__head">
        <h3 class="tbl__name">${esc(t.name)}</h3>
        ${t.kind === 'summary' ? '<p class="fr-tag fr-tag--sm">Synthèse</p>' : ''}
        <span class="tbl__meta">${esc(plural(t.columns.length + 1, 'colonne', 'colonnes'))}</span>
        <span class="tbl__actions">
          <button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-git-merge-line" type="button" data-goto-schema="${esc(t.name)}">Schéma</button>
          ${line ? `<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-code-s-slash-line" type="button" data-goto-line="${line}">DBML</button>` : ''}
        </span>
      </header>
      <table class="tbl__cols">
        <caption class="fr-sr-only">Colonnes de ${esc(t.name)}</caption>
        <thead class="fr-sr-only"><tr><th scope="col">Colonne</th><th scope="col">Type</th><th scope="col">Relation</th></tr></thead>
        <tbody>${pk}${rows}</tbody>
      </table>
      ${inc}
    </article>`;
  }).join('');
  els['tables-body'].innerHTML = `<div class="tables__list">${cards}</div>`;
}

function columnsCsv() {
  const cell = (v) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [['Table', 'Colonne', 'Type DBML', 'Formule', 'Relation vers']];
  for (const t of state.out.tables) {
    rows.push([t.name, 'id', 'integer', 'non', '']);
    for (const c of t.columns) rows.push([t.name, c.name, c.base, c.isFormula ? 'oui' : 'non', c.ref ? c.ref.table : '']);
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

const CHECKS = [
  { codes: ['unknown-ref'], label: 'Relations vers des tables existantes' },
  { codes: ['bad-table-name', 'bad-column-name'], label: 'Noms de tables et de colonnes valides en DBML' },
  { codes: ['duplicate-column'], label: 'Aucune colonne en double' },
];

function renderAnalysis() {
  const count = els['analysis-count'];
  if (!state.out) {
    count.hidden = true;
    els['analysis-body'].innerHTML = unavailableMessage();
    return;
  }
  const errors = state.findings.filter((f) => f.level === 'error');
  const infos = state.findings.filter((f) => f.level !== 'error');
  count.hidden = !errors.length;
  count.textContent = String(errors.length);
  count.setAttribute('aria-label', plural(errors.length, 'point à corriger', 'points à corriger'));
  els['level-all-label'].textContent = `Tout (${state.findings.length})`;
  els['level-error-label'].textContent = `À corriger (${errors.length})`;
  els['level-info-label'].textContent = `Pour information (${infos.length})`;

  const item = (f) => {
    const line = f.column ? state.lines.column.get(`${f.table}.${f.column}`) : f.table ? state.lines.table.get(f.table) : null;
    const actions = [];
    if (f.table && state.out.tables.some((t) => t.name === f.table)) actions.push(`<button class="fr-link fr-link--sm" type="button" data-goto-schema="${esc(f.table)}">Voir sur le schéma</button>`);
    if (f.tables?.length) actions.push(`<button class="fr-link fr-link--sm" type="button" data-goto-schema="${esc(f.tables[0])}">Voir sur le schéma</button>`);
    if (line) actions.push(`<button class="fr-link fr-link--sm" type="button" data-goto-line="${line}">Voir dans le DBML</button>`);
    return `<div class="fr-alert fr-alert--${f.level === 'error' ? 'error' : 'info'} fr-alert--sm finding">
      <p class="finding__title">${esc(f.title)}</p>
      <p>${esc(f.detail)}</p>
      ${actions.length ? `<p class="finding__actions">${actions.join('')}</p>` : ''}
    </div>`;
  };
  const show = (lvl) => state.level === 'all' || state.level === lvl;
  const parts = [];
  if (show('error')) {
    parts.push(errors.length
      ? `<section class="findings__group"><h3>À corriger avant l'import (${errors.length})</h3><p>Ces points font échouer l'import dans dbdiagram.io et les autres outils DBML.</p><div class="findings__list">${errors.map(item).join('')}</div></section>`
      : '<div class="fr-alert fr-alert--success fr-alert--sm"><p class="finding__title">Le DBML s\'importe sans erreur</p><p>Toutes les relations pointent vers une table existante et tous les noms sont valides.</p></div>');
  }
  if (show('info') && infos.length) {
    parts.push(`<section class="findings__group"><h3>Pour information (${infos.length})</h3><div class="findings__list">${infos.map(item).join('')}</div></section>`);
  }
  if (!parts.length) parts.push(emptyState('<p>Rien à afficher pour ce filtre.</p>'));
  const failed = new Set(errors.map((f) => f.code));
  const checks = CHECKS.map((c) => `<li class="${c.codes.some((k) => failed.has(k)) ? 'is-ko' : ''}">${esc(c.label)}</li>`).join('');
  els['analysis-body'].innerHTML = `<div class="analysis">
    <div class="findings">${parts.join('')}</div>
    <aside class="checks" aria-label="Contrôles effectués"><h3>Contrôles effectués</h3><ul>${checks}</ul></aside>
  </div>`;
}

function reportText() {
  const lines = ['Analyse de la structure du document (widget Structure en DBML)', ''];
  if (!state.findings.some((f) => f.level === 'error')) lines.push('Le DBML s\'importe sans erreur.', '');
  for (const f of state.findings) lines.push(`- [${f.level === 'error' ? 'À corriger' : 'Info'}] ${f.title} : ${f.detail}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Schéma (visualiseur maison + disposition ELK, chargée à la demande)
// ---------------------------------------------------------------------------

let viewer = null;
let diagramReady = Promise.resolve();
const DIAGRAM_CONTROLS = ['btn-zoom-in', 'btn-zoom-out', 'btn-zoom-fit', 'btn-relayout', 'btn-svg', 'btn-png', 'find-table',
  'detail-all', 'detail-keys', 'detail-tables', 'btn-minimap'];

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

function updateDiagramControls(enabled) {
  for (const id of DIAGRAM_CONTROLS) els[id].disabled = !enabled;
}

function renderDiagram() {
  const out = state.out;
  const body = els['schema-body'];
  for (const id of ['detail-all', 'detail-keys', 'detail-tables']) els[id].checked = els[id].value === state.diagram.detail;
  els['btn-minimap'].setAttribute('aria-pressed', String(state.minimap));
  body.classList.toggle('no-minimap', !state.minimap);
  if (!out || !out.tables.length) {
    viewer?.destroy();
    viewer = null;
    state.diagramKey = null;
    body.innerHTML = out ? emptyState('<p>Ce document ne contient aucune table.</p>') : unavailableMessage();
    updateDiagramControls(false);
    return Promise.resolve();
  }
  const key = JSON.stringify(out.tables.map((t) => [t.name, t.kind, t.columns.map((c) => [c.name, c.base, c.isFormula, c.ref])]));
  if (key === state.diagramKey && viewer) return diagramReady;
  state.diagramKey = key;
  const v = ensureViewer();
  updateDiagramControls(true);
  els['find-table-list'].innerHTML = out.tables.map((t) => `<option value="${esc(t.name)}"></option>`).join('');
  diagramReady = v.setData(out.tables, { positions: state.diagram.positions, detail: state.diagram.detail })
    .catch((err) => {
      console.error(err);
      toast(`Le schéma n'a pas pu être dessiné : ${err.message || err}`, 'error');
    });
  return diagramReady;
}

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
    const active = t === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(`tabpanel-${t}`).hidden = !active;
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
  if (state.filter || state.cols !== 'all') {
    state.filter = '';
    els['filter-input'].value = '';
    state.cols = 'all';
    els['cols-all'].checked = true;
    renderTables();
  }
  selectTab('tables');
  const el = $(slug(name));
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  flash(el);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function saveToRow() {
  const col = state.mappings?.dbml;
  if (!col || !state.record || !state.out) return;
  try {
    await gristApi.selectedTable.update({ id: state.record.id, fields: { [col]: state.out.dbml } });
    toast(`DBML enregistré dans la colonne « ${col} ».`);
  } catch (err) {
    toast(`Enregistrement impossible dans « ${col} » : ${err.message || err}. Choisissez une colonne de données (pas une formule).`, 'error');
  }
}

function bindEvents() {
  els['btn-refresh'].addEventListener('click', () => loadSchema({ manual: true }));

  // DBML
  els['btn-copy'].addEventListener('click', async () => {
    if (!state.out) return;
    if (await copyText(state.out.dbml)) buttonFeedback(els['btn-copy'], 'Copié');
    else toast('La copie a été refusée par le navigateur : utilisez « Télécharger ».', 'error');
  });
  els['btn-download'].addEventListener('click', () => {
    if (state.out) downloadFile('schema-document.dbml', state.out.dbml, 'text/plain;charset=utf-8');
  });
  els['btn-save'].addEventListener('click', saveToRow);
  els['btn-wrap'].addEventListener('click', () => { state.wrap = !state.wrap; renderDbml(); });

  // Tables
  els['filter-input'].addEventListener('input', debounce(() => { state.filter = els['filter-input'].value; renderTables(); }, 120));
  for (const id of ['cols-all', 'cols-refs', 'cols-formulas']) {
    els[id].addEventListener('change', () => { if (els[id].checked) { state.cols = els[id].value; renderTables(); } });
  }
  els['btn-csv'].addEventListener('click', () => {
    if (state.out) downloadFile('colonnes-document.csv', columnsCsv(), 'text/csv;charset=utf-8');
  });

  // Analyse
  for (const id of ['level-all', 'level-error', 'level-info']) {
    els[id].addEventListener('change', () => { if (els[id].checked) { state.level = els[id].value; renderAnalysis(); } });
  }
  els['btn-report'].addEventListener('click', async () => {
    if (!state.out) return;
    if (await copyText(reportText())) buttonFeedback(els['btn-report'], 'Rapport copié');
    else toast('La copie a été refusée par le navigateur.', 'error');
  });

  // Schéma
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
  els['btn-minimap'].addEventListener('click', () => {
    state.minimap = !state.minimap;
    els['btn-minimap'].setAttribute('aria-pressed', String(state.minimap));
    els['schema-body'].classList.toggle('no-minimap', !state.minimap);
  });
  const findTable = () => {
    const name = els['find-table'].value.trim();
    if (!viewer || !name) return;
    const match = [...viewer.nodes.keys()].find((id) => id.toLowerCase() === name.toLowerCase());
    if (match) { viewer.focusTable(match); els['find-table'].value = ''; }
  };
  els['find-table'].addEventListener('change', findTable);
  els['find-table'].addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); findTable(); } });
  els['btn-svg'].addEventListener('click', () => {
    if (viewer) downloadFile('schema-document.svg', viewer.toSvg(), 'image/svg+xml');
  });
  els['btn-png'].addEventListener('click', async () => {
    if (!viewer) return;
    try {
      downloadFile('schema-document.png', await viewer.toPng(), 'image/png');
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
    const target = ev.target.closest('[data-goto-line],[data-goto-table],[data-goto-schema]');
    if (!target) return;
    ev.preventDefault();
    if (target.dataset.gotoSchema) showOnDiagram(target.dataset.gotoSchema);
    else if (target.dataset.gotoLine) gotoDbmlLine(Number(target.dataset.gotoLine));
    else if (target.dataset.gotoTable) gotoTable(target.dataset.gotoTable);
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
        name: 'dbml',
        title: 'DBML (destination)',
        optional: true,
        type: 'Text',
        description: 'Colonne de données où le bouton « Enregistrer » écrit le DBML produit.',
      },
    ],
  });
  gristApi.onOptions((options) => {
    applyOptions(options);
    if (state.tab === 'schema' && state.out && !viewer) renderDiagram();
  });
  gristApi.onRecord((record, mappings) => {
    state.record = record || null;
    state.mappings = mappings || null;
    renderDbml();
  });
  gristApi.onRecords(() => loadSchemaSoon());
  loadSchema();
}

bindEvents();
syncTheme();
selectTab('schema');
if (inGrist) connectGrist();
recompute();
