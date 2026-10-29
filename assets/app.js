import { convertAll, computeStats, schemaFromMetadata } from './converter.js?v=3.1.0';
import { ErdViewer } from './erd.js?v=3.1.0';
import { buildInsights, SEVERITIES, LEVELS, AREAS, targetLabel, insightKey, stepsAfterIntended } from './insights.js?v=3.1.0';
import { sampleAuditData, AUDIT_LIMITS } from './audit-engine.js?v=3.1.0';
import { profileTables } from './datacheck.js?v=3.1.0';
import { buildPages, originText, typeCounts, columnLines, ACCESS_LABELS } from './pages.js?v=3.1.0';
import { buildAccess, BITS, PERMISSION_LABEL, SPECIAL } from './access.js?v=3.1.0';
import { columnTypeLabel, detailLines, ID_TYPE_LABEL } from './types.js?v=3.1.0';
import {
  REPORT_SECTIONS, buildReport, renderHtml, renderDocx, readTheme, loadDocx, accessSummary,
} from './report.js?v=3.1.0';

// Le widget lit toujours la structure du document où il est installé et produit
// la conversion corrigée (relations et types fidèles au document).

const gristApi = window.grist;
const inGrist = Boolean(gristApi) && window.self !== window.top;

const $ = (id) => document.getElementById(id);
const els = {};
for (const id of ['stats', 'read-at', 'btn-refresh', 'doc-alert', 'analysis-count',
  'btn-zoom-out', 'zoom-value', 'btn-zoom-in', 'btn-zoom-fit', 'btn-relayout', 'detail-all', 'detail-keys', 'detail-tables',
  'find-table', 'find-table-list', 'btn-svg', 'schema-body',
  'filter-input', 'cols-all', 'cols-refs', 'cols-formulas', 'btn-csv', 'tables-body',
  'access-filter', 'btn-access-csv', 'access-body',
  'widgets-filter', 'wkind-all', 'wkind-unofficial', 'wkind-gallery', 'wkind-views', 'widgets-body',
  'analysis-filter', 'area-all', 'area-structure', 'area-data', 'area-access', 'area-pages', 'btn-audit-settings', 'analysis-body',
  'report-sections', 'report-count', 'btn-docx', 'report-body', 'toast', 'live']) {
  els[id] = $(id);
}
const tabs = ['schema', 'tables', 'access', 'widgets', 'analysis', 'report'];

const state = {
  schema: null,
  schemaAt: null,
  schemaError: null,
  schemaLoading: false,
  out: null, // { tables, dbml }
  insights: null,
  acl: null, // { resources, rules } lus dans le document, ou null si illisibles
  access: null, // buildAccess()
  pages: null, // buildPages() : pages et widgets
  pagesMeta: null,
  data: {}, failedTables: [], auditMeta: {},
  profiles: null, // profileTables() : données lues, pour les constats sur les données
  profileKey: null,
  accepted: new Set(), // constats « C'est voulu », mémorisés dans les options du widget
  details: false,
  accessFilter: '',
  accessView: 'all', // toutes les tables, toujours
  docName: '',
  tab: 'schema',
  filter: '',
  cols: 'all',
  level: 'all',
  area: 'all', // domaine des constats affichés
  analysisFilter: '',
  auditOpen: false, // panneau « Périmètre des contrôles »
  widgetsFilter: '',
  wkind: 'all',
  reportSections: new Set(REPORT_SECTIONS.map((r) => r.id)),
  snapshot: null, // image du schéma pour le rapport : { key, png, width, height, url }
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
  state.access = state.out && state.acl ? buildAccess({ ...state.acl, schema: state.schema }) : null;
  state.pages = state.out && state.pagesMeta ? buildPages(state.pagesMeta) : null;
  state.insights = state.out ? buildInsights(state.out.tables, state.access, { profiles: state.profiles, accepted: state.accepted, pages: state.pages, audit: {schema: state.schema, data: state.data, meta: state.auditMeta, failedTables: state.failedTables} }) : null;
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
    const optional = (name) => Promise.resolve(gristApi.docApi.fetchTable(name)).catch(() => null);
    const [tables, columns, sections, resources, rules, pages, views, filters] = await Promise.all([
      gristApi.docApi.fetchTable('_grist_Tables'),
      gristApi.docApi.fetchTable('_grist_Tables_column'),
      optional('_grist_Views_section'),
      optional('_grist_ACLResources'),
      optional('_grist_ACLRules'),
      optional('_grist_Pages'),
      optional('_grist_Views'),
      optional('_grist_Filters'),
    ]);
    state.auditMeta = {filters, sections, tables, columns, views};
    state.pagesMeta = pages && views && sections ? { pages, views, sections, tables, columns, selfUrl: location.href } : null;
    state.schema = schemaFromMetadata(tables, columns, { sections });
    state.acl = resources && rules ? { resources, rules } : null;
    await loadData({ force: manual });
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

/**
 * Lit les données des tables (pas des synthèses) pour les constats sur les données.
 * Relu à l'ouverture, sur « Relire le document », ou quand la liste des tables ou colonnes change.
 */
async function loadData({ force = false } = {}) {
  const ids = [...state.schema.values()].filter((t) => !t.tableId.startsWith('_grist_')).map((t) => t.tableId);
  const key = JSON.stringify(ids.map((id) => [id, [...state.schema.get(id).columns.keys()]]));
  if (!force && key === state.profileKey && state.profiles) return;
  const data = {};
  state.failedTables = [];
  const queue = ids.slice();
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try { data[id] = await gristApi.docApi.fetchTable(id); } catch { state.failedTables.push(id); }
    }
  };
  await Promise.all([worker(), worker()]);
  state.data = data;
  const sampled = sampleAuditData(data);
  state.profiles = profileTables(sampled.data);
  for (const c of sampled.coverage) { const p = state.profiles.get(c.table); if(p) { p.rows=c.visibleRows; p.sampled=c.sampled; } }
  state.profileKey = key;
}

// ---------------------------------------------------------------------------
// Options du widget (enregistrées dans le document Grist)
// ---------------------------------------------------------------------------

function saveOption(key, value) {
  if (!inGrist) return;
  Promise.resolve(gristApi.setOption(key, value)).catch(() => { /* accès en lecture seule */ });
}
const saveDiagramSoon = debounce(() => saveOption('diagram', { ...state.diagram }), 800);

function applyOptions(options) {
  if (Array.isArray(options?.accepted)) state.accepted = new Set(options.accepted.map(String));
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
  renderTables();
  renderAnalysis();
  renderAccess();
  renderWidgets();
  if (state.tab === 'schema') renderDiagram();
  if (state.tab === 'report') renderReport();
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
      plural(s.tables, 'table', 'tables'), plural(s.columns, 'colonne', 'colonnes'), plural(s.relations, 'relation', 'relations'),
    ].join(' · ');
    els.stats.title = `${els.stats.textContent} · ${plural(s.formulas, 'formule', 'formules')}`;
  } else {
    els.stats.textContent = '';
  }
  if (state.schemaLoading) els['read-at'].textContent = 'Lecture en cours…';
  else if (state.schemaAt) els['read-at'].textContent = `Lue à ${state.schemaAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
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

function aclSlug(name) {
  return 'acl-' + String(name).replace(/[^A-Za-z0-9_-]/g, '_');
}

function slug(name) {
  return 'tbl-' + String(name).replace(/[^A-Za-z0-9_-]/g, '_');
}

// ---------------------------------------------------------------------------
// Composants communs : en-tête de page, en-tête de section, badge
// ---------------------------------------------------------------------------

/** En-tête de page : titre, une phrase, chiffres clés et action, au même endroit sur chaque onglet. */
function pageHeader({ title, lead = '', kpis = [], side = '' }) {
  const figures = kpis.length
    ? `<dl class="kpis">${kpis.map((k) => `<div class="kpi"><dt>${esc(k.label)}</dt><dd>${esc(Number(k.value).toLocaleString('fr-FR'))}</dd></div>`).join('')}</dl>`
    : '';
  return `<header class="ph"><div class="ph__text"><h2 class="ph__title">${esc(title)}</h2>${lead ? `<p class="ph__lead">${esc(lead)}</p>` : ''}</div>
    ${figures || side ? `<div class="ph__side">${figures}${side}</div>` : ''}</header>`;
}

/** En-tête de section : titre, compteur, une ligne d'aide. */
function sectionHead(title, { count = null, hint = '', hintHtml = '' } = {}) {
  return `<div class="sec__head"><div class="sec__row"><h3 class="sec__title">${esc(title)}</h3>${count === null ? '' : `<span class="count">${esc(count)}</span>`}</div>
    ${hintHtml || hint ? `<p class="sec__hint">${hintHtml || esc(hint)}</p>` : ''}</div>`;
}

/** Badge : un état ou une nature (MAJUSCULES). kind : blocking, improve, choice, info, ok, ou rien (neutre). */
const badge = (text, kind = '') => `<span class="badge${kind ? ` badge--${kind}` : ''}">${esc(text)}</span>`;

function attentionButton(issues, area) {
  return issues.length
    ? `<button class="fr-btn fr-btn--sm fr-btn--secondary fr-btn--icon-left fr-icon-lightbulb-line" type="button" data-goto-analysis="${esc(area)}">${esc(plural(issues.length, 'point d\'attention', 'points d\'attention'))}</button>`
    : '';
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

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
  const keep = (c) => state.cols === 'all' || (state.cols === 'refs' ? Boolean(c.ref) : c.isFormula || Boolean(c.details?.trigger));
  const visible = out.tables
    .map((t) => ({ ...t, shownColumns: t.columns.filter(keep) }))
    .filter((t) => (!q || matches(t.name) || t.shownColumns.some((c) => matches(c.name) || matches(c.label)))
      && (state.cols === 'all' || t.shownColumns.length));

  const s = computeStats(out.tables);
  const summaries = out.tables.filter((t) => t.kind === 'summary').length;
  const header = pageHeader({
    title: 'Tables et colonnes',
    lead: 'Chaque table avec ses colonnes, leur type, leurs liens, formules et listes de choix.',
    kpis: [
      { value: s.tables, label: summaries ? `${s.tables > 1 ? 'tables' : 'table'} dont ${plural(summaries, 'synthèse', 'synthèses')}` : (s.tables > 1 ? 'tables' : 'table') },
      { value: s.columns, label: s.columns > 1 ? 'colonnes' : 'colonne' },
      { value: s.relations, label: s.relations > 1 ? 'relations' : 'relation' },
      { value: s.formulas, label: s.formulas > 1 ? 'formules' : 'formule' },
    ],
  });
  if (!visible.length) {
    els['tables-body'].innerHTML = `<div class="view">${header}${emptyState(q ? `<p>Aucune table ni colonne ne contient « ${esc(state.filter)} ».</p>` : '<p>Aucune table ne correspond.</p>')}</div>`;
    return;
  }

  const cards = visible.map((t) => {
    const rows = t.shownColumns.map((c) => {
      let link = '';
      if (c.ref) {
        link = known.has(c.ref.table)
          ? `<button class="chip" type="button" data-goto-table="${esc(c.ref.table)}">${esc(c.ref.table)}</button>`
          : `<span class="chip chip--plain">${esc(c.ref.table)} · table absente</span>`;
        if (c.ref.kind === '<>') link += '<span class="col-many">plusieurs</span>';
      }
      const cls = [c.isFormula ? 'is-formula' : '', c.ref ? 'is-ref' : '', c.empty ? 'is-empty' : '', matches(c.name) || matches(c.label) ? 'is-match' : ''].filter(Boolean).join(' ');
      const flag = c.isFormula ? '<span class="col-flag">formule</span>' : c.details?.trigger ? '<span class="col-flag">initialisée</span>' : '';
      const label = c.label && c.label !== c.name ? `<span class="col-label">${esc(c.label)}</span>` : '';
      return `<tr${cls ? ` class="${cls}"` : ''}>
        <td><span class="col-name">${esc(c.name)}</span>${label}</td>
        <td><span class="col-type">${esc(columnTypeLabel(c))}</span>${flag}</td>
        <td>${link}</td>
        <td>${columnDetailsHtml(c)}</td></tr>`;
    }).join('');
    const pk = state.cols === 'all'
      ? `<tr><td><span class="col-name">id</span></td><td><span class="col-type">${ID_TYPE_LABEL}</span></td><td></td><td>${badge('Clé de la ligne')}</td></tr>`
      : '';
    const refs = incoming.get(t.name) || [];
    const foot = refs.length
      ? `<div class="card__foot"><span>Référencée par</span><ul class="chips">${refs.map((r) => `<li><button class="chip" type="button" data-goto-table="${esc(r.table)}">${esc(r.table)}.${esc(r.column)}</button></li>`).join('')}</ul></div>`
      : '';
    const rowsCount = state.profiles?.has(t.name) ? ` · ${plural(state.profiles.get(t.name).rows, 'ligne', 'lignes')}` : '';
    return `<article class="card tbl" id="${slug(t.name)}">
      <header class="card__head">
        <h3 class="card__title">${esc(t.name)}</h3>
        ${t.kind === 'summary' ? badge('Synthèse', 'choice') : ''}
        <span class="card__meta">${esc(plural(t.columns.length + 1, 'colonne', 'colonnes'))}${esc(rowsCount)}</span>
        <span class="card__actions"><button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-git-merge-line" type="button" data-goto-schema="${esc(t.name)}">Voir sur le schéma</button></span>
      </header>
      ${t.description ? `<p class="card__desc">${esc(t.description)}</p>` : ''}
      <div class="table-scroll"><table class="grid-table">
        <caption class="fr-sr-only">Colonnes de ${esc(t.name)}</caption>
        <thead><tr><th scope="col">Colonne</th><th scope="col">Type</th><th scope="col">Lien</th><th scope="col">Détails</th></tr></thead>
        <tbody>${pk}${rows}</tbody>
      </table></div>
      ${foot}
    </article>`;
  }).join('');
  const index = `<nav class="tables-index" aria-label="Index des tables">
      <p class="tables-index__head">${esc(plural(visible.length, 'table', 'tables'))}</p>
      <ul>${visible.map((t) => `<li><button type="button" data-index-table="${esc(t.name)}"${t.kind === 'summary' ? ' class="is-summary"' : ''}>${esc(t.name)}<span>${t.columns.length + 1}</span></button></li>`).join('')}</ul>
    </nav>`;
  els['tables-body'].innerHTML = `<div class="view">${header}<div class="tables-layout">${index}<div class="tables-list">${cards}</div></div></div>`;
  updateTablesIndex();
}

/** Index des tables : met en évidence la table en haut de la zone visible. */
function updateTablesIndex() {
  const body = els['tables-body'];
  const cards = [...body.querySelectorAll('.tbl')];
  if (!cards.length) return;
  const top = body.getBoundingClientRect().top + 24;
  let current = cards[0];
  for (const c of cards) { if (c.getBoundingClientRect().top <= top) current = c; else break; }
  const name = current.querySelector('.card__title')?.textContent;
  for (const b of body.querySelectorAll('[data-index-table]')) b.classList.toggle('is-current', b.dataset.indexTable === name);
}

/** Formules, choix, condition de liste et description d'une colonne. */
function columnDetailsHtml(c) {
  const lines = detailLines(c, { includeLabel: false });
  return `<details class="column-information"><summary>Informations de la colonne</summary><dl class="col-details"><dt>Identifiant</dt><dd><code>${esc(c.name)}</code></dd><dt>Type</dt><dd>${esc(columnTypeLabel(c))}</dd>${lines.map((l) => {
    let value = esc(l.text);
    if (l.mono) value = `<code>${value}</code>`;
    else if (l.label === 'Choix') value = `<ul class="chips">${c.details.choices.map((x) => `<li><span class="chip chip--plain">${esc(x)}</span></li>`).join('')}</ul>`;
    return `<dt>${esc(l.label)}</dt><dd>${value}</dd>`;
  }).join('')}</dl>${c.details?.description?'':'<p class="fr-hint-text">Aucune description renseignée.</p>'}</details>`;
}

function columnsCsv() {
  const cell = (v) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [['Table', 'Colonne', 'Libellé', 'Type de colonne', 'Formule', 'Relation vers', 'Texte de la formule', 'Choix', 'Description']];
  for (const t of state.out.tables) {
    rows.push([t.name, 'id', '', ID_TYPE_LABEL, 'non', '', '', '', '']);
    for (const c of t.columns) {
      const d = c.details || {};
      rows.push([t.name, c.name, c.label || '', columnTypeLabel(c), c.isFormula ? 'oui' : d.trigger ? 'initialisation' : 'non',
        c.ref ? c.ref.table : '', d.formula || '', (d.choices || []).join(', '), d.description || '']);
    }
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

const SEVERITY_ICON = { blocking: 'fr-icon-error-warning-line', improve: 'fr-icon-warning-line', choice: 'fr-icon-question-line', info: 'fr-icon-information-line', accepted: 'fr-icon-check-line' };

/** Lignes examinées, cellules analysées, tables illisibles : la phrase sous le verdict. */
function auditCoverageText(audit) {
  if (!audit) return '';
  const counts = audit.coverage.reduce((a, c) => ({ visible: a.visible + c.visibleRows, inspected: a.inspected + c.inspectedRows }), { visible: 0, inspected: 0 });
  const parts = [
    counts.inspected === counts.visible
      ? plural(counts.inspected, 'ligne examinée', 'lignes examinées')
      : `${plural(counts.inspected, 'ligne examinée', 'lignes examinées')} sur ${counts.visible.toLocaleString('fr-FR')} lisibles`,
    plural(audit.cells, 'cellule analysée', 'cellules analysées'),
  ];
  const failed = state.failedTables.length;
  if (failed) parts.push(failed > 1 ? `${failed} tables n'ont pas pu être lues` : 'une table n\'a pas pu être lue');
  return parts.join(' · ');
}

/** Panneau « Périmètre des contrôles », ouvert depuis la barre d'outils. */
function auditConfigurationPanel(audit) {
 if(!audit)return '';
 return `<section class="audit-panel" id="audit-panel" aria-labelledby="audit-panel-title"><div class="audit-panel__head"><h3 id="audit-panel-title">Périmètre des contrôles</h3><button type="button" class="fr-btn fr-btn--sm fr-btn--tertiary-no-outline fr-btn--icon-left fr-icon-close-line" data-action="audit-close">Fermer</button></div><p>Les contrôles métier retirés ne sont plus calculés. Les contrôles de données utilisent au plus 2 000 lignes par table et 100 000 cellules au total. Les espaces, listes textuelles, mélanges de types et formats numériques examinent au plus 200 cellules par colonne. Les tables sont encore récupérées intégralement avant échantillonnage.</p><ul>${audit.checks.map(c=>`<li>${esc(c.id)} — ${esc(({detected:'Constat observé',checked:'Examiné sans signal',unavailable:'Non vérifiable',limited:'Vérification limitée'})[c.state]||c.state)} : ${esc(c.reason)}</li>`).join('')}</ul></section>`;
}

const LEVEL_TILES = [
  { id: 'blocking', label: SEVERITIES.blocking.label },
  { id: 'improve', label: SEVERITIES.improve.label },
  { id: 'choice', label: SEVERITIES.choice.label },
  { id: 'accepted', label: 'Choix confirmés' },
  { id: 'info', label: SEVERITIES.info.label },
  { id: 'all', label: 'Tout' },
];

function renderAnalysis() {
  const count = els['analysis-count'];
  const ins = state.insights;
  if (!ins) {
    count.hidden = true;
    els['btn-audit-settings'].disabled = true;
    els['analysis-body'].innerHTML = unavailableMessage();
    return;
  }
  count.hidden = !ins.counts.blocking;
  count.textContent = String(ins.counts.blocking);
  count.setAttribute('aria-label', plural(ins.counts.blocking, 'point à corriger', 'points à corriger'));
  const toConfigure = ins.audit ? ins.audit.checks.filter((c) => c.state === 'configuration').length : 0;
  const auditBtn = els['btn-audit-settings'];
  auditBtn.disabled = !ins.audit;
  auditBtn.textContent = toConfigure ? `Périmètre des contrôles · ${toConfigure} à configurer` : 'Périmètre des contrôles';
  auditBtn.setAttribute('aria-expanded', String(state.auditOpen));

  const known = new Set(state.out.tables.map((t) => t.name));
  const aclTables = new Set((state.access?.tables || []).map((t) => t.tableId));
  const MAX_CHIPS = 14;
  const card = (it, { accepted = false } = {}) => {
    const chips = it.targets.slice(0, MAX_CHIPS).map((t) => {
      const text = `${esc(targetLabel(t))}${t.note ? ` · ${esc(t.note)}` : ''}`;
      if (it.area === 'access' && aclTables.has(t.table)) return `<li><button class="chip" type="button" data-goto-access="${esc(t.table)}" title="Voir ses règles d'accès">${text}</button></li>`;
      if (known.has(t.table)) return `<li><button class="chip" type="button" data-goto-schema="${esc(t.table)}" title="Voir sur le schéma">${text}</button></li>`;
      return `<li><span class="chip chip--plain">${text}</span></li>`;
    }).join('') + (it.targets.length > MAX_CHIPS ? `<li><span class="chip insight__more">et ${it.targets.length - MAX_CHIPS} autres</span></li>` : '');
    const intended = it.intended ? `<p class="insight__intended"><strong>Si c'est voulu :</strong> ${esc(it.intended)}</p>` : '';
    const steps = it.steps.length
      ? `<div class="insight__fix"><p class="insight__label">${it.intended ? 'Sinon, dans Grist' : 'Comment corriger dans Grist'}</p><ol>${stepsAfterIntended(it).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`
      : '';
    const actions = [];
    if (it.area === 'access') actions.push(`<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-lock-line" type="button" data-goto-access="${esc(aclTables.has(it.targets[0]?.table) ? it.targets[0].table : '*')}">Voir les droits d'accès</button>`);
    else if (it.area === 'pages') actions.push('<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-layout-grid-line" type="button" data-goto-widgets="1">Voir les widgets</button>');
    else if (it.targets[0] && known.has(it.targets[0].table)) actions.push(`<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-git-merge-line" type="button" data-goto-schema="${esc(it.targets[0].table)}">Voir sur le schéma</button>`);
    if (it.steps.length && !accepted) actions.push('<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-refresh-line" type="button" data-action="refresh">J\'ai corrigé, relire le document</button>');
    if (it.severity === 'choice') {
      actions.push(accepted
        ? `<button class="fr-btn fr-btn--sm fr-btn--tertiary-no-outline fr-btn--icon-left fr-icon-close-line" type="button" data-action="unaccept" data-key="${esc(insightKey(it))}">Ne plus considérer comme voulu</button>`
        : `<button class="fr-btn fr-btn--sm fr-btn--secondary fr-btn--icon-left fr-icon-check-line" type="button" data-action="accept" data-key="${esc(insightKey(it))}">C'est voulu</button>`);
    }
    const sev = accepted ? 'accepted' : it.severity;
    return `<article class="insight insight--${it.severity}${accepted ? ' insight--accepted' : ''}" data-finding="${esc(it.id)}">
      <div class="insight__head">
        <div class="insight__icon ${SEVERITY_ICON[sev]}" aria-hidden="true"></div>
        <div class="insight__heading">
          <p class="insight__meta">${badge(accepted ? 'Choix confirmé' : SEVERITIES[it.severity].label, accepted ? 'ok' : it.severity)}<span class="insight__area">${esc(AREAS[it.area] || '')}</span></p>
          <h3 class="insight__title">${esc(it.title)}</h3>
        </div>
      </div>
      <div class="insight__body">
        <p class="insight__text">${esc(it.summary)}</p>
        <p class="insight__why">${esc(it.why)}</p>
        ${chips ? `<div><p class="insight__label">Concerné</p><ul class="chips insight__targets">${chips}</ul></div>` : ''}
        ${accepted ? '' : intended + steps}
        ${it.method ? `<details class="insight__method"><summary>Comment ce constat est calculé</summary><p>${esc(it.method)}</p><p><strong>Observation :</strong> ${esc(it.calculation || '')}</p><p><strong>Limites :</strong> ${esc(it.limitations || '')}</p></details>` : ''}
        ${actions.length ? `<div class="insight__actions">${actions.join('')}</div>` : ''}
      </div>
    </article>`;
  };

  const q = state.analysisFilter.trim().toLowerCase();
  const textOf = (it) => [it.title, it.summary, it.why, ...it.targets.map((t) => `${targetLabel(t)} ${t.note || ''}`)].join(' ').toLowerCase();
  const pool = state.level === 'accepted' ? ins.accepted : ins.items.filter((it) => state.level === 'all' || it.severity === state.level);
  const shown = pool.filter((it) => (state.area === 'all' || it.area === state.area) && (!q || textOf(it).includes(q)));

  const tileCount = { all: ins.items.length, accepted: ins.accepted.length, ...ins.counts };
  const tiles = LEVEL_TILES.map((t) => `<button type="button" class="tile tile--${t.id}" id="level-${t.id}" data-level="${t.id}" aria-pressed="${state.level === t.id}">
      <span class="tile__n">${tileCount[t.id] || 0}</span><span class="tile__label">${esc(t.label)}</span></button>`).join('');
  const coverage = auditCoverageText(ins.audit);
  const verdict = `<header class="verdict-block">
      <div class="verdict verdict--${ins.verdict.level}">
        <div class="verdict__icon ${ins.verdict.level === 'blocking' ? 'fr-icon-error-warning-line' : 'fr-icon-checkbox-circle-line'}" aria-hidden="true"></div>
        <div class="verdict__text"><h2 class="verdict__title">${esc(ins.verdict.title)}</h2><p class="verdict__lead">${esc(ins.verdict.text)}</p>${coverage ? `<p class="verdict__meta">${esc(coverage)}</p>` : ''}</div>
      </div>
      <div class="tiles" role="group" aria-label="Filtrer les constats par niveau">${tiles}</div>
    </header>`;

  const levelLabel = LEVEL_TILES.find((t) => t.id === state.level)?.label || 'Tout';
  const filters = [state.area !== 'all' ? `domaine « ${AREAS[state.area]} »` : '', q ? `contenant « ${state.analysisFilter.trim()} »` : ''].filter(Boolean).join(', ');
  const listTitle = `${state.level === 'all' ? 'Tous les constats, du plus urgent au moins urgent' : `Constats « ${levelLabel} »`}${filters ? ` · ${filters}` : ''} (${shown.length})`;
  const list = shown.length
    ? shown.map((it) => card(it, { accepted: state.level === 'accepted' })).join('')
    : emptyState(`<p>${filters ? 'Aucun constat ne correspond à ces filtres.' : state.level === 'all' ? 'Rien à signaler.' : state.level === 'accepted' ? 'Aucun choix confirmé. Sur une carte « Choix à confirmer », le bouton « C\'est voulu » la range ici.' : `Aucun point « ${esc(levelLabel)} ».`}</p>`);
  const okCount = ins.checks.filter((c) => c.ok).length;
  const checks = ins.checks.map((c) => `<li><span>${esc(c.label)}</span>${c.ok
    ? '<span class="coverage__ok">✓ Rien à signaler</span>'
    : `<button type="button" class="coverage__go" data-goto-finding="${esc(c.id)}">Voir le constat</button>`}</li>`).join('');
  els['analysis-body'].innerHTML = `<div class="view">${verdict}${state.auditOpen ? auditConfigurationPanel(ins.audit) : ''}
    <div class="analysis">
      <div class="insights"><p class="insights__title">${esc(listTitle)}</p>${list}</div>
      <details class="coverage"${coverageOpen() ? ' open' : ''}><summary class="coverage__head"><span><span class="coverage__title">Couverture des contrôles</span>
        <span class="coverage__sub">${esc(plural(ins.checks.length, 'contrôle', 'contrôles'))} · ${esc(plural(okCount, 'sans constat', 'sans constat'))}</span></span></summary><ul>${checks}</ul></details>
    </div></div>`;
}

/** Couverture des contrôles : ouverte à côté des constats, repliée quand elle passe au-dessus (widget étroit). */
function coverageOpen() {
  const el = els['analysis-body'].querySelector('.coverage');
  if (el) return el.open;
  return !window.matchMedia || window.matchMedia('(min-width: 64em)').matches;
}

/** Ouvre la carte d'un constat (depuis la couverture des contrôles), en levant les filtres qui la cachent. */
function gotoFinding(id) {
  const visible = () => els['analysis-body'].querySelector(`[data-finding="${CSS.escape(id)}"]`);
  if (!visible()) {
    const accepted = state.insights?.accepted.some((it) => it.id === id);
    state.level = accepted ? 'accepted' : 'all';
    state.area = 'all';
    state.analysisFilter = '';
    els['analysis-filter'].value = '';
    els['area-all'].checked = true;
    renderAnalysis();
  }
  const el = visible();
  if (!el) return;
  scrollWithin(el);
  flash(el);
}

// ---------------------------------------------------------------------------
// Droits d'accès
// ---------------------------------------------------------------------------

const PERM_HTML = {
  allow: '<span class="perm perm--allow fr-icon-check-line">Autorisé</span>',
  deny: '<span class="perm perm--deny fr-icon-close-line">Refusé</span>',
  none: '<span class="perm perm--none" title="Ce droit d’accès ne décide pas cette action : la condition suivante s’applique">—</span>',
};

function rulesTableHtml(rules, bits, caption) {
  const head = `<tr><th scope="col">Qui</th>${bits.map((b) => `<th scope="col" class="rules__perm">${esc(PERMISSION_LABEL[b])}</th>`).join('')}<th scope="col">Message en cas de refus</th></tr>`;
  const body = rules.map((r) => `<tr>
      <td class="rules__who"><strong>${esc(r.who.text)}</strong>${r.formula && r.who.kind !== 'email' ? `<code>${esc(r.formula)}</code>` : ''}${r.problems.map((p) => `<span class="rules__problem">${esc(p.text)}</span>`).join('')}</td>
      ${bits.map((b) => `<td class="rules__perm">${PERM_HTML[r.perms[b] || 'none']}</td>`).join('')}
      <td class="rules__memo">${esc(r.memo)}</td></tr>`).join('');
  return `<div class="table-scroll"><table class="grid-table rules"><caption class="fr-sr-only">${esc(caption)}</caption><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function accessMatches(q, ...values) {
  return !q || values.some((v) => String(v || '').toLowerCase().includes(q));
}

const SETTING_KIND = { success: 'ok', warning: 'improve', info: 'info' };

function renderAccess() {
  const body = els['access-body'];
  if (!state.out) { body.innerHTML = unavailableMessage(); return; }
  const a = state.access;
  els['btn-access-csv'].disabled = !a || !a.hasRules;
  if (!a) {
    body.innerHTML = emptyState('<p>Les règles d\'accès du document n\'ont pas pu être lues. Seuls les propriétaires du document (ou les personnes autorisées à voir les droits d’accès) peuvent les consulter.</p>');
    return;
  }
  const accessIssues = (state.insights?.items || []).filter((i) => i.area === 'access' && i.severity !== 'info');
  if (!a.hasRules) {
    body.innerHTML = `<div class="view">${pageHeader({
      title: 'Aucune règle d\'accès avancée',
      lead: 'Chaque personne invitée voit et modifie tout le document selon son rôle de partage : propriétaire, éditeur ou lecteur.',
    })}<p class="sec__hint">Pour restreindre une table, une colonne ou certaines lignes, ouvrez « Règles d'accès » dans le menu de gauche de Grist.</p></div>`;
    return;
  }
  const q = state.accessFilter.trim().toLowerCase();
  const ruleMatches = (r) => accessMatches(q, r.formula, r.who.text, r.memo);

  const header = pageHeader({
    title: 'Règles d\'accès avancées',
    lead: 'Qui peut lire, modifier, créer et supprimer, table par table puis colonne par colonne.',
    kpis: [
      { value: a.ruleCount, label: a.ruleCount > 1 ? 'conditions de droits d’accès' : 'condition de droits d’accès' },
      { value: a.tables.length, label: a.tables.length > 1 ? 'tables protégées' : 'table protégée' },
      { value: a.attributes.length, label: a.attributes.length > 1 ? 'attributs' : 'attribut' },
      { value: a.rowRules, label: a.rowRules > 1 ? 'conditions par ligne' : 'condition par ligne' },
    ],
    side: attentionButton(accessIssues, 'access'),
  });

  // Réglages généraux : une liste à trois colonnes
  const settings = [];
  settings.push({
    name: 'Modifier la structure',
    badge: a.structureRestricted ? ['success', 'Restreinte'] : [a.restrictsRead ? 'warning' : 'info', 'Éditeurs autorisés'],
    text: a.structureRestricted ? 'Les droits d’accès par défaut refusent la permission Structure.' : 'Réglage par défaut : propriétaires et éditeurs modifient tables, colonnes et formules.',
  });
  for (const id of ['FullCopies', 'AccessRules']) {
    const sp = a.special.find((x) => x.id === id);
    const allowedTo = sp ? sp.rules.filter((r) => Object.values(r.perms).includes('allow')).map((r) => r.who.text) : [];
    settings.push({
      name: SPECIAL[id].label,
      badge: allowedTo.length ? [sp.allowedForAll && id === 'FullCopies' && a.restrictsRead ? 'warning' : 'info', sp.allowedForAll ? 'Tout le monde' : 'Personnalisé'] : ['success', 'Par défaut'],
      text: allowedTo.length ? `${SPECIAL[id].allowed} Visées : ${allowedTo.join(' ; ')}.` : SPECIAL[id].byDefault,
    });
  }
  for (const sp of a.special.filter((x) => !['FullCopies', 'AccessRules'].includes(x.id))) {
    settings.push({ name: sp.label, badge: ['info', 'Défini'], text: sp.allowed });
  }
  const settingsHtml = `<section>${sectionHead('Réglages généraux', { hint: 'Valables pour tout le document, quelles que soient les tables.' })}
    <div class="card">${settings.map((x) => `<div class="settings-row"><p class="settings-row__name">${esc(x.name)}</p>
      <p class="settings-row__state">${badge(x.badge[1], SETTING_KIND[x.badge[0]])}</p><p class="settings-row__text">${esc(x.text)}</p></div>`).join('')}</div></section>`;

  const attrs = a.attributes.length ? `<section>${sectionHead('Attributs utilisateur', {
    count: a.attributes.length,
    hintHtml: 'Un attribut retrouve la personne connectée dans une table ; les conditions l\'utilisent sous la forme <code>user.Nom.Colonne</code>.',
  })}
    <div class="card"><div class="table-scroll"><table class="grid-table rules"><caption class="fr-sr-only">Attributs utilisateur</caption>
      <thead><tr><th scope="col">Attribut</th><th scope="col">Cherché dans</th><th scope="col">En comparant à</th><th scope="col">État</th></tr></thead>
      <tbody>${a.attributes.map((x) => `<tr><td><code>user.${esc(x.name)}</code></td><td>${esc(x.tableId)}.${esc(x.lookupColId)}</td><td><code>user.${esc(x.charId)}</code></td>
        <td>${x.problems.length ? badge(x.problems.join(', '), 'blocking') : badge('Correct', 'ok')}</td></tr>`).join('')}</tbody></table></div></div></section>` : '';

  const defaults = a.defaults.filter(ruleMatches);
  const defaultsHtml = defaults.length ? `<section>${sectionHead('Droits d’accès par défaut', { count: defaults.length, hint: 'Elles s\'appliquent à toutes les tables, après les droits d’accès propres à chaque table.' })}
    <div class="card">${rulesTableHtml(defaults, BITS.defaults, 'Droits d’accès par défaut')}</div></section>` : '';

  const known = new Set(state.out.tables.map((t) => t.name));
  const cards = [];
  for (const t of a.tables) {
    const tableHit = accessMatches(q, t.tableId);
    const rules = tableHit ? t.rules : t.rules.filter(ruleMatches);
    const cols = t.columns.map((c) => ({ ...c, rules: tableHit || accessMatches(q, c.colIds.join(' ')) ? c.rules : c.rules.filter(ruleMatches) })).filter((c) => c.rules.length);
    if (!rules.length && !cols.length) continue;
    const n = t.rules.length + t.columns.reduce((s, c) => s + c.rules.length, 0);
    const rowRules = [...t.rules, ...t.columns.flatMap((c) => c.rules)].some((r) => r.who.row);
    cards.push(`<article class="card acl-table" id="${aclSlug(t.tableId)}">
      <header class="card__head"><h4 class="card__title">${esc(t.tableId)}</h4>
        ${badge(plural(n, 'condition de droits d’accès', 'conditions de droits d’accès'))}
        ${rowRules ? badge('Par ligne', 'info') : ''}
        ${t.missing ? badge('Invisible pour vous', 'improve') : ''}
        <span class="card__actions">${known.has(t.tableId) ? `<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-table-line" type="button" data-goto-table="${esc(t.tableId)}">Voir les colonnes</button>` : ''}</span>
      </header>
      ${rules.length ? rulesTableHtml(rules, BITS.table, `Droits d’accès de la table ${t.tableId}`) : ''}
      ${cols.map((c) => `<div class="acl-sub">${c.colIds.length > 1 ? 'Colonnes' : 'Colonne'} ${esc(c.colIds.join(', '))} ${badge(plural(c.rules.length, 'condition de droits d’accès', 'conditions de droits d’accès'))}${c.missing.length ? ` <span class="rules__problem">${c.missing.length > 1 ? `${esc(c.missing.join(', '))} : invisibles pour vous (masquées par ces droits d’accès, ou supprimées)` : `${esc(c.missing[0])} : invisible pour vous (masquée par ces droits d’accès, ou supprimée)`}</span>` : ''}</div>${rulesTableHtml(c.rules, BITS.column, `Droits d’accès des colonnes ${c.colIds.join(', ')}`)}`).join('')}
    </article>`);
  }
  for (const t of a.uncovered.filter((x) => accessMatches(q, x))) {
    cards.push(`<article class="card acl-table acl-table--plain" id="${aclSlug(t)}"><header class="card__head"><h4 class="card__title">${esc(t)}</h4>
      ${badge('Aucune règle d’accès avancée sur cette table', 'ok')}<span class="card__meta">Suit les droits d’accès par défaut${a.defaults.length ? '' : ' (aucune)'} et les rôles de partage.</span></header></article>`);
  }
  const tablesHtml = `<section>${sectionHead('Droits d’accès par table', {
    count: a.tables.length,
    hint: 'Les droits d’accès s\'appliquent de haut en bas : la première dont la condition est remplie décide, permission par permission. « — » : aucun droit n’est décidé ici pour cette action, la condition suivante s’applique.',
  })}<div class="cards">${cards.join('') || emptyState(q ? `<p>Aucun droit d’accès ne contient « ${esc(state.accessFilter)} ».</p>` : '<p>Aucune table n\'a de règle propre.</p>')}</div></section>`;

  body.innerHTML = `<div class="view">${header}${q ? '' : settingsHtml}${q ? '' : attrs}${defaultsHtml}${tablesHtml}</div>`;
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

const WIDGET_KIND = { external: ['Externe', 'improve'], document: ['Dans le document', ''], self: ['Ce widget', 'ok'] };

function renderWidgets() {
  const body = els['widgets-body'];
  if (!state.out) { body.innerHTML = unavailableMessage(); return; }
  const m = state.pages;
  if (!m) { body.innerHTML = emptyState('<p>Les pages du document n\'ont pas pu être lues.</p>'); return; }
  const known = new Set(state.out.tables.map((t) => t.name));
  const issues = (state.insights?.items || []).filter((i) => i.area === 'pages' && i.severity !== 'info');
  const q = state.widgetsFilter.trim().toLowerCase();
  const hit = (w) => !q || [w.title, w.page, w.table, w.typeLabel, w.custom?.name, w.custom?.host, w.custom?.author].some((v) => String(v || '').toLowerCase().includes(q));
  const show = (kind) => state.wkind === 'all' || state.wkind === kind;
  const unofficial = m.unofficial.filter(hit);
  const gallery = m.gallery.filter(hit);
  const views = m.views.filter(hit);

  const tableChip = (t) => (known.has(t) ? `<button class="chip" type="button" data-goto-table="${esc(t)}">${esc(t)}</button>` : `<span class="chip chip--plain">${esc(t)}</span>`);
  const where = (w) => `<p class="widget-where">Page <span class="chip chip--plain">${esc(w.page || '(sans nom)')}</span>${w.table ? ` · table ${tableChip(w.table)}${w.summary ? ' (synthèse)' : ''}` : ''}${w.linkedTo ? ` · suit « ${esc(w.linkedTo)} »` : ''}</p>`;
  const columnsList = (c) => {
    const lines = columnLines(c);
    return lines.length
      ? `<ul class="widget-cols">${lines.map((l) => `<li${l.missing ? ' class="widget-cols--missing"' : ''}><span class="widget-cols__field">${esc(l.field)}</span> <span aria-hidden="true">→</span> ${l.missing ? 'à associer' : `<strong>${esc(l.column)}</strong>`}</li>`).join('')}</ul>`
      : '<span class="widget-cols__none">Aucune colonne à associer</span>';
  };
  const accessText = (c) => (c.access === 'full' && c.origin === 'external' ? badge(ACCESS_LABELS.full, 'improve') : esc(ACCESS_LABELS[c.access] || c.access || '—'));
  const card = (w, badges, rows) => `<article class="card widget-card">
      <header class="card__head"><h4 class="card__title">${esc(w.title || w.custom?.name || 'Widget personnalisé')}</h4>${badges.join('')}</header>
      <div class="card__body">${where(w)}<dl class="widget-props">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div></article>`;

  const unofficialCards = unofficial.map((w) => {
    const c = w.custom;
    const [label, kind] = WIDGET_KIND[c.origin] || ['Non officiel', ''];
    return card(w, [badge(label, kind)], [
      ['Origine', esc(originText(c))],
      ['Accès', accessText(c)],
      columnLines(c).length ? ['Colonnes', columnsList(c)] : null,
      c.url && c.origin !== 'document' ? ['Adresse', `<span class="widget-url">${esc(c.url)}</span>`] : null,
      w.description ? ['Description', esc(w.description)] : null,
    ]);
  }).join('');
  const galleryCards = gallery.map((w) => {
    const c = w.custom;
    const badges = [];
    if (c.missingColumns?.length) badges.push(badge(plural(c.missingColumns.length, 'champ à associer', 'champs à associer'), 'blocking'));
    if (!c.maintained) badges.push(badge(`Communauté${c.author ? ` · ${c.author}` : ''}`, 'choice'));
    return card(w, badges, [['Accès', accessText(c)], ['Colonnes', columnsList(c)]]);
  }).join('');

  let lastPage = null;
  const viewRows = views.map((w) => {
    const first = w.page !== lastPage;
    lastPage = w.page;
    return `<tr><td>${first ? `<strong>${esc(w.page || '(sans nom)')}</strong>` : ''}</td><td>${esc(w.title || w.table || w.typeLabel)}${w.description ? `<span class="col-label">${esc(w.description)}</span>` : ''}</td>
      <td>${esc(w.typeLabel)}</td><td>${w.table ? tableChip(w.table) : ''}${w.summary ? ' <span class="col-label">synthèse</span>' : ''}</td><td>${w.linkedTo ? esc(w.linkedTo) : '<span class="perm--none">—</span>'}</td></tr>`;
  }).join('');

  const sections = [];
  if (show('unofficial')) {
    sections.push(`<section>${sectionHead('Widgets non officiels', { count: unofficial.length, hint: 'Ajoutés par leur adresse ou créés dans le document, hors de la galerie de Grist.' })}
      ${unofficialCards ? `<div class="cards-grid">${unofficialCards}</div>` : `<p class="empty empty--inline">${q ? 'Aucun widget non officiel ne correspond.' : 'Aucun widget non officiel dans ce document.'}</p>`}</section>`);
  }
  if (show('gallery')) {
    sections.push(`<section>${sectionHead('Widgets personnalisés', { count: gallery.length, hint: 'Choisis dans la galerie de Grist : l\'accès accordé et la colonne associée à chaque champ attendu.' })}
      ${galleryCards ? `<div class="cards-grid">${galleryCards}</div>` : `<p class="empty empty--inline">${q ? 'Aucun widget de la galerie ne correspond.' : 'Aucun widget de la galerie dans ce document.'}</p>`}</section>`);
  }
  if (show('views')) {
    sections.push(`<section>${sectionHead('Fiches, listes, graphiques et formulaires', { count: views.length, hint: 'Les vues classiques autres que les tableaux, avec le widget dont elles suivent la sélection.' })}
      ${viewRows ? `<div class="card"><div class="table-scroll"><table class="grid-table"><caption class="fr-sr-only">Fiches, listes, graphiques et formulaires</caption>
        <thead><tr><th scope="col">Page</th><th scope="col">Vue</th><th scope="col">Type</th><th scope="col">Table</th><th scope="col">Suit la sélection de</th></tr></thead><tbody>${viewRows}</tbody></table></div></div>`
        : `<p class="empty empty--inline">${q ? 'Aucune vue ne correspond.' : 'Aucune autre vue que des tableaux.'}</p>`}</section>`);
  }
  if (state.wkind === 'all' && !q && (m.tableOnlyPages.length || m.tablesWithoutPage.length)) {
    const rows = [];
    if (m.tableOnlyPages.length) {
      rows.push(`<details class="rest-row"><summary class="fr-icon-arrow-right-line"><strong>${esc(plural(m.tableOnlyPages.length, 'page', 'pages'))}</strong> ${m.tableOnlyPages.length > 1 ? 'ne contiennent' : 'ne contient'} que des tableaux<span class="rest-row__hint">Afficher la liste</span></summary>
        <ul class="chips">${m.tableOnlyPages.map((p) => `<li><span class="chip chip--plain">${esc(p)}</span></li>`).join('')}</ul></details>`);
    }
    if (m.tablesWithoutPage.length) {
      rows.push(`<details class="rest-row" open><summary class="fr-icon-arrow-right-line"><strong>${esc(plural(m.tablesWithoutPage.length, 'table', 'tables'))}</strong> ${m.tablesWithoutPage.length > 1 ? 'ne sont affichées' : 'n\'est affichée'} sur aucune page ${badge('Choix à confirmer', 'choice')}</summary>
        <ul class="chips">${m.tablesWithoutPage.map((t) => `<li>${tableChip(t)}</li>`).join('')}</ul></details>`);
    }
    sections.push(`<section>${sectionHead('Le reste', { hint: 'Pour ne rien oublier, sans encombrer la page.' })}<div class="card">${rows.join('')}</div></section>`);
  }

  const header = pageHeader({
    title: 'Widgets',
    lead: 'Tout ce qui n\'est pas un tableau : widgets personnalisés, fiches, listes, graphiques et formulaires.',
    kpis: [
      { value: m.unofficial.length, label: 'non officiels' },
      { value: m.gallery.length, label: 'de la galerie' },
      { value: m.views.length, label: m.views.length > 1 ? 'autres vues' : 'autre vue' },
      { value: m.tableWidgetCount, label: 'tableaux, non détaillés' },
    ],
    side: attentionButton(issues, 'pages'),
  });
  body.innerHTML = `<div class="view">${header}${sections.join('')}</div>`;
}

function accessCsv() {
  const a = state.access;
  const cell = (v) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const state2 = (r, b) => (r.perms[b] === 'allow' ? 'autorisé' : r.perms[b] === 'deny' ? 'refusé' : '');
  const rows = [['Table', 'Colonnes', 'Ordre', 'Qui', 'Condition', ...['R', 'U', 'C', 'D', 'S'].map((b) => PERMISSION_LABEL[b]), 'Permissions (Grist)', 'Message']];
  const add = (table, cols, list) => list.forEach((r, i) => rows.push([table, cols, i + 1, r.who.text, r.formula, ...['R', 'U', 'C', 'D', 'S'].map((b) => state2(r, b)), r.permText, r.memo]));
  add('(toutes les tables)', '*', a.defaults);
  for (const t of a.tables) {
    add(t.tableId, '*', t.rules);
    for (const c of t.columns) add(t.tableId, c.colIds.join(', '), c.rules);
  }
  for (const sp of a.special) add(`(réglage) ${sp.label}`, sp.id, sp.rules);
  for (const x of a.attributes) rows.push(['(attribut utilisateur)', '', '', `user.${x.name}`, `${x.tableId}.${x.lookupColId} = user.${x.charId}`, '', '', '', '', '', '', x.problems.join(', ')]);
  return '\ufeff' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

function gotoAccess(table) {
  if (state.accessFilter) { state.accessFilter = ''; els['access-filter'].value = ''; }
  renderAccess();
  renderWidgets();
  selectTab('access');
  const el = table && table !== '*' ? $(aclSlug(table)) : null;
  if (!el) { els['access-body'].scrollTop = 0; return; }
  scrollWithin(el);
  flash(el);
}

// ---------------------------------------------------------------------------
// Rapport Word
// ---------------------------------------------------------------------------

function renderReportSections() {
  els['report-sections'].innerHTML = REPORT_SECTIONS.map((r) => `<label class="report__opt"><input type="checkbox" data-section="${r.id}"${state.reportSections.has(r.id) ? ' checked' : ''}>
    <span><strong>${esc(r.title)}</strong><span>${esc(r.description)}</span></span></label>`).join('');
  els['report-count'].textContent = `${state.reportSections.size} section${state.reportSections.size > 1 ? 's' : ''} sur ${REPORT_SECTIONS.length}`;
  els['btn-docx'].disabled = !state.out || !state.reportSections.size;
}

/** Image du schéma pour le rapport, dessinée hors écran avec la disposition actuelle. */
async function schemaSnapshot() {
  const out = state.out;
  const positions = viewer ? viewer.exportPositions() : state.diagram.positions;
  const key = JSON.stringify([state.diagramKey || out.dbml, positions]);
  if (state.snapshot?.key === key) return state.snapshot;
  const host = document.createElement('div');
  host.className = 'snapshot-host';
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  const v = new ErdViewer(host);
  try {
    await v.setData(out.tables, { positions, detail: 'all' });
    const blob = await v.toPng(2);
    const b = v.bounds();
    const png = new Uint8Array(await blob.arrayBuffer());
    if (state.snapshot?.url) URL.revokeObjectURL(state.snapshot.url);
    state.snapshot = { key, png, width: Math.ceil(b.w + 64), height: Math.ceil(b.h + 64), url: URL.createObjectURL(blob) };
    return state.snapshot;
  } finally {
    v.destroy();
    host.remove();
  }
}

function reportContext(schema) {
  return {
    docName: state.docName,
    date: new Date(),
    stats: computeStats(state.out.tables),
    tables: state.out.tables,
    insights: state.insights,
    access: state.access,
    profiles: state.profiles,
    pages: state.pages,
    dbml: state.out.dbml,
    schema,
  };
}

let reportSeq = 0;
async function renderReport() {
  renderReportSections();
  if (!state.out) { els['report-body'].innerHTML = unavailableMessage(); return; }
  if (!state.reportSections.size) { els['report-body'].innerHTML = emptyState('<p>Choisissez au moins une section à inclure.</p>'); return; }
  const seq = ++reportSeq;
  const draw = (schema) => {
    const blocks = buildReport(reportContext(schema), [...state.reportSections]);
    els['report-body'].innerHTML = `<article class="doc" aria-label="Aperçu du rapport">${renderHtml(blocks, { imageUrl: () => schema?.url || '' })}</article>`;
  };
  const needsSchema = state.reportSections.has('schema');
  draw(needsSchema ? state.snapshot : null);
  if (needsSchema) {
    try {
      const snap = await schemaSnapshot();
      if (seq === reportSeq) draw(snap);
    } catch (err) {
      console.error(err);
    }
  }
}

async function downloadReport() {
  if (!state.out) return;
  const btn = els['btn-docx'];
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Préparation du rapport…';
  try {
    const [d, schema] = await Promise.all([
      loadDocx(),
      state.reportSections.has('schema') ? schemaSnapshot().catch(() => null) : Promise.resolve(null),
    ]);
    const blocks = buildReport(reportContext(schema), [...state.reportSections]);
    const blob = await d.Packer.toBlob(renderDocx(blocks, readTheme(), d));
    const base = (state.docName || 'document').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    downloadFile(`structure-${base || 'document'}.docx`, blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    toast('Rapport Word téléchargé.');
  } catch (err) {
    console.error(err);
    toast(`Le rapport n'a pas pu être généré : ${err.message || err}`, 'error');
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Schéma (visualiseur maison + disposition ELK, chargée à la demande)
// ---------------------------------------------------------------------------

let viewer = null;
let tablesIndexFrame = 0;
let diagramReady = Promise.resolve();
const DIAGRAM_CONTROLS = ['btn-zoom-in', 'btn-zoom-out', 'btn-zoom-fit', 'btn-relayout', 'btn-svg', 'find-table',
  'detail-all', 'detail-keys', 'detail-tables'];

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
  body.classList.add('no-minimap');
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
  if (name === 'report') renderReport();
}

/** Fait défiler le contenu de la page jusqu'à `el`, sans faire bouger les onglets ni la barre d'outils. */
function scrollWithin(el, block = 'start') {
  const box = el.closest('.page__body');
  if (!box) return;
  const c = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  box.scrollTop += block === 'center' ? (r.top - c.top) - (c.height - r.height) / 2 : r.top - c.top - 12;
}

function flash(el) {
  el.classList.add('is-target');
  setTimeout(() => el.classList.remove('is-target'), 1800);
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
  scrollWithin(el);
  flash(el);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function bindEvents() {
  els['btn-refresh'].addEventListener('click', () => loadSchema({ manual: true }));

  // Tables
  els['filter-input'].addEventListener('input', debounce(() => { state.filter = els['filter-input'].value; renderTables(); }, 120));
  for (const id of ['cols-all', 'cols-refs', 'cols-formulas']) {
    els[id].addEventListener('change', () => { if (els[id].checked) { state.cols = els[id].value; renderTables(); } });
  }
  els['btn-csv'].addEventListener('click', () => {
    if (state.out) downloadFile('colonnes-document.csv', columnsCsv(), 'text/csv;charset=utf-8');
  });

  // Droits d'accès
  els['access-filter'].addEventListener('input', debounce(() => { state.accessFilter = els['access-filter'].value; renderAccess(); }, 120));
  els['btn-access-csv'].addEventListener('click', () => {
    if (state.access?.hasRules) downloadFile('regles-acces-document.csv', accessCsv(), 'text/csv;charset=utf-8');
  });

  // Tables : index qui suit le défilement
  els['tables-body'].addEventListener('scroll', () => { if (!tablesIndexFrame) tablesIndexFrame = requestAnimationFrame(() => { tablesIndexFrame = 0; updateTablesIndex(); }); }, { passive: true });

  // Widgets
  els['widgets-filter'].addEventListener('input', debounce(() => { state.widgetsFilter = els['widgets-filter'].value; renderWidgets(); }, 120));
  for (const id of ['wkind-all', 'wkind-unofficial', 'wkind-gallery', 'wkind-views']) {
    els[id].addEventListener('change', () => { if (els[id].checked) { state.wkind = els[id].value; renderWidgets(); } });
  }

  // Analyse : niveau (tuiles), domaine, recherche, règles métier
  els['analysis-filter'].addEventListener('input', debounce(() => { state.analysisFilter = els['analysis-filter'].value; renderAnalysis(); }, 120));
  for (const id of ['area-all', 'area-structure', 'area-data', 'area-access', 'area-pages']) {
    els[id].addEventListener('change', () => { if (els[id].checked) { state.area = els[id].value; renderAnalysis(); } });
  }
  els['btn-audit-settings'].addEventListener('click', () => {
    state.auditOpen = !state.auditOpen;
    renderAnalysis();
    if (state.auditOpen) { const el = $('audit-panel'); if (el) scrollWithin(el); }
  });

  // Rapport
  els['report-sections'].addEventListener('change', (ev) => {
    const box = ev.target.closest('[data-section]');
    if (!box) return;
    if (box.checked) state.reportSections.add(box.dataset.section); else state.reportSections.delete(box.dataset.section);
    renderReport();
  });
  els['btn-docx'].addEventListener('click', downloadReport);

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
    const target = ev.target.closest('[data-goto-table],[data-goto-schema],[data-goto-access],[data-goto-analysis],[data-goto-widgets],[data-goto-finding],[data-index-table],[data-level],[data-action]');
    if (!target) return;
    ev.preventDefault();
    if (target.dataset.level) { state.level = target.dataset.level; renderAnalysis(); $(`level-${state.level}`)?.focus(); return; }
    if (target.dataset.indexTable) { const el = $(slug(target.dataset.indexTable)); if (el) { scrollWithin(el); flash(el); } return; }
    if (target.dataset.gotoFinding) { gotoFinding(target.dataset.gotoFinding); return; }
    if (target.dataset.gotoWidgets) { selectTab('widgets', { focus: true }); return; }
    if (target.dataset.action === 'audit-close') { state.auditOpen = false; renderAnalysis(); els['btn-audit-settings'].focus(); return; }
    if (target.dataset.action === 'refresh') loadSchema({ manual: true });
    else if (target.dataset.action === 'accept' || target.dataset.action === 'unaccept') {
      if (target.dataset.action === 'accept') state.accepted.add(target.dataset.key); else state.accepted.delete(target.dataset.key);
      saveOption('accepted', [...state.accepted]);
      recompute();
      toast(target.dataset.action === 'accept' ? 'Noté comme voulu : ce point ne sera plus compté.' : 'Ce point est de nouveau à confirmer.', 'info');
    }
    else if (target.dataset.gotoAccess) gotoAccess(target.dataset.gotoAccess);
    else if (target.dataset.gotoAnalysis) {
      // « N points d'attention » : l'analyse s'ouvre sur ce domaine.
      const area = AREAS[target.dataset.gotoAnalysis] ? target.dataset.gotoAnalysis : 'all';
      state.area = area; state.level = 'all';
      const radio = $(`area-${area}`); if (radio) radio.checked = true;
      renderAnalysis();
      selectTab('analysis', { focus: true });
    }
    else if (target.dataset.gotoSchema) showOnDiagram(target.dataset.gotoSchema);
    else if (target.dataset.gotoTable) gotoTable(target.dataset.gotoTable);
  });
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

/**
 * Titre du document. Selon l'instance, getDocName() renvoie le titre ou seulement
 * l'identifiant interne (« swd2QJ… ») : dans ce cas, le rapport dit « Document Grist ».
 * (L'API REST, qui connaît le titre, refuse les appels venant d'une autre origine.)
 */
async function readDocTitle(api) {
  let name = '';
  try { name = String((await api.docApi.getDocName?.()) || ''); } catch { /* sans nom */ }
  return /^[A-Za-z0-9]{16,}$/.test(name) ? '' : name;
}

function connectGrist() {
  gristApi.ready({ requiredAccess: 'full', allowSelectBy: false });
  gristApi.onOptions((options) => {
    applyOptions(options);
    if (state.schema) recompute();
    if (state.tab === 'schema' && state.out && !viewer) renderDiagram();
  });
  gristApi.onRecords(() => loadSchemaSoon());
  readDocTitle(gristApi).then((name) => {
    if (name) { state.docName = name; if (state.tab === 'report') renderReport(); }
  });
  loadSchema();
}

bindEvents();
syncTheme();
selectTab('schema');
if (inGrist) connectGrist();
recompute();


