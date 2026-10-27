import { convertAll, computeStats, schemaFromMetadata } from './converter.js?v=2.8.1';
import { ErdViewer } from './erd.js?v=2.8.1';
import { buildInsights, SEVERITIES, LEVELS, AREAS, targetLabel, insightKey, stepsAfterIntended } from './insights.js?v=2.8.1';
import { validateAuditConfig } from './audit-config.js?v=2.8.1';
import { sampleAuditData, AUDIT_LIMITS } from './audit-engine.js?v=2.8.1';
import { profileTables } from './datacheck.js?v=2.8.1';
import { buildPages, originText, typeCounts, columnLines, ACCESS_LABELS } from './pages.js?v=2.8.1';
import { buildAccess, BITS, PERMISSION_LABEL, SPECIAL } from './access.js?v=2.8.1';
import { columnTypeLabel, detailLines, ID_TYPE_LABEL } from './types.js?v=2.8.1';
import {
  REPORT_SECTIONS, buildReport, renderHtml, renderDocx, readTheme, loadDocx, accessSummary,
} from './report.js?v=2.8.1';

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
  'access-filter', 'btn-access-csv', 'access-body', 'widgets-body',
  'level-all', 'level-blocking', 'level-improve', 'level-choice', 'level-accepted', 'level-info',
  'level-all-label', 'level-blocking-label', 'level-improve-label', 'level-choice-label', 'level-accepted-label', 'level-info-label', 'analysis-body',
  'report-sections', 'btn-docx', 'report-body', 'toast', 'live']) {
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
  data: {}, failedTables: [], auditMeta: {}, auditConfig: {}, auditConfigError: '',
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
  state.insights = state.out ? buildInsights(state.out.tables, state.access, { profiles: state.profiles, accepted: state.accepted, pages: state.pages, audit: {schema: state.schema, data: state.data, meta: state.auditMeta, failedTables: state.failedTables, config: state.auditConfig} }) : null;
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
    const [tables, columns, sections, resources, rules, pages, views, filters, attachments] = await Promise.all([
      gristApi.docApi.fetchTable('_grist_Tables'),
      gristApi.docApi.fetchTable('_grist_Tables_column'),
      optional('_grist_Views_section'),
      optional('_grist_ACLResources'),
      optional('_grist_ACLRules'),
      optional('_grist_Pages'),
      optional('_grist_Views'),
      optional('_grist_Filters'),
      optional('_grist_Attachments'),
    ]);
    state.auditMeta = {filters, attachments, sections, tables, columns, views};
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
  if (options?.auditConfig && typeof options.auditConfig === 'object' && !Array.isArray(options.auditConfig)) { try { state.auditConfig = validateAuditConfig(options.auditConfig); } catch(err) { state.auditConfigError=err.message; } }
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
      const cls = [c.isFormula ? 'is-formula' : '', c.empty ? 'is-empty' : '', matches(c.name) || matches(c.label) ? 'is-match' : ''].filter(Boolean).join(' ');
      const flag = c.isFormula ? ' <span class="col-flag">formule</span>' : c.details?.trigger ? ' <span class="col-flag">initialisée</span>' : '';
      const label = c.label && c.label !== c.name ? `<span class="tbl__label">${esc(c.label)}</span>` : '';
      const detail = columnDetailsHtml(c);
      return `<tr${cls ? ` class="${cls}"` : ''}>
        <th scope="row">${esc(c.name)}${label}</th>
        <td class="tbl__type">${esc(columnTypeLabel(c))}${flag}</td>
        <td class="tbl__rel">${rel}</td></tr>${detail ? `<tr class="tbl__detail${cls ? ` ${cls}` : ''}"><td colspan="3">${detail}</td></tr>` : ''}`;
    }).join('');
    const refs = incoming.get(t.name) || [];
    const inc = refs.length
      ? `<p class="tbl__incoming">Référencée par ${refs.map((r) => `<a href="#${slug(r.table)}" data-goto-table="${esc(r.table)}">${esc(r.table)}.${esc(r.column)}</a>`).join(', ')}</p>`
      : '';
    const pk = state.cols === 'all'
      ? `<tr><th scope="row">id</th><td class="tbl__type">${ID_TYPE_LABEL} <span class="col-pk">clé</span></td><td class="tbl__rel"></td></tr>`
      : '';
    return `<article class="tbl" id="${slug(t.name)}">
      <header class="tbl__head">
        <h3 class="tbl__name">${esc(t.name)}</h3>
        ${t.kind === 'summary' ? '<p class="fr-tag fr-tag--sm">Synthèse</p>' : ''}
        <span class="tbl__meta">${esc(plural(t.columns.length + 1, 'colonne', 'colonnes'))}${state.profiles?.has(t.name) ? ` · ${esc(plural(state.profiles.get(t.name).rows, 'ligne', 'lignes'))}` : ''}</span>
        <span class="tbl__actions">
          <button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-git-merge-line" type="button" data-goto-schema="${esc(t.name)}">Schéma</button>
        </span>
      </header>
      ${t.description ? `<p class="tbl__desc">${esc(t.description)}</p>` : ''}
      <table class="tbl__cols">
        <caption class="fr-sr-only">Colonnes de ${esc(t.name)}</caption>
        <thead class="fr-sr-only"><tr><th scope="col">Colonne</th><th scope="col">Type de colonne</th><th scope="col">Relation</th></tr></thead>
        <tbody>${pk}${rows}</tbody>
      </table>
      ${inc}
    </article>`;
  }).join('');
  els['tables-body'].innerHTML = `<div class="tables__list tables__list--details">${cards}</div>`;
}

/** Formules, choix, condition de liste et description d'une colonne (mode « Détails »). */
function columnDetailsHtml(c) {
  const lines = detailLines(c, { includeLabel: false });
  if (!lines.length) return '';
  return `<dl class="col-details">${lines.map((l) => {
    let value = esc(l.text);
    if (l.mono) value = `<code>${value}</code>`;
    else if (l.label === 'Choix') value = `<span class="col-chips">${c.details.choices.map((x) => `<span>${esc(x)}</span>`).join('')}</span>`;
    return `<dt>${esc(l.label)}</dt><dd>${value}</dd>`;
  }).join('')}</dl>`;
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

const SEVERITY_ICON = { blocking: 'fr-icon-error-warning-line', improve: 'fr-icon-warning-line', choice: 'fr-icon-question-line', info: 'fr-icon-information-line' };

function auditConfigurationPanel(audit) {
  if (!audit) return '';
  const missing = audit.checks.filter(c=>c.state==='configuration');
  const counts = audit.coverage.reduce((a,c)=>({visible:a.visible+c.visibleRows,inspected:a.inspected+c.inspectedRows}),{visible:0,inspected:0});
  return `<p class="fr-text--sm">${counts.inspected} lignes examinées sur ${counts.visible} lignes lisibles chargées. ${audit.cells} cellules analysées. ${state.failedTables.length ? `${state.failedTables.length} tables n’ont pas pu être lues.` : ''}</p>
  <details class="audit-settings"><summary>Règles métier et couverture des contrôles (${missing.length} à configurer)</summary>
  <p>Déclarez uniquement les règles réellement attendues. Sans configuration, un contrôle métier n’affiche pas d’anomalie.</p>
  <div class="fr-grid-row fr-grid-row--gutters"><div class="fr-col-12 fr-col-md-5"><label for="audit-key-table">Table dont les fiches doivent avoir un code unique</label><select id="audit-key-table" class="fr-select"><option value="">Choisir une table</option>${[...state.schema.keys()].filter(t=>!t.startsWith('_grist_')).map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div><div class="fr-col-12 fr-col-md-5"><label for="audit-key-columns">Colonnes qui distinguent une fiche (séparées par une virgule)</label><input id="audit-key-columns" class="fr-input" placeholder="Code ou Code, Annee"></div><div class="fr-col-12"><button type="button" class="fr-btn fr-btn--sm fr-btn--secondary" data-action="audit-key-add">Déclarer cette clé</button></div></div>
  <p>Exemple : dans Cotisations, Adherent et Annee ensemble peuvent désigner une cotisation unique. Un même adhérent sur deux années différentes n’est alors pas un doublon.</p>
  <label for="audit-config">Configuration avancée des clés, bornes de dates, totaux et copies courantes</label>
  <p class="fr-text--sm">Exemple à adapter avec vos identifiants de tables et colonnes. Une clé peut combiner plusieurs colonnes.</p>
  <pre>{"keys":[{"table":"Clients","columns":["Code"]}],"dateBounds":[{"table":"Cotisations","column":"Date","min":"2024-01-01","max":"2030-12-31"}],"totals":[{"table":"Commandes","total":"Total_saisi","quantity":"Quantite","price":"Prix"}],"copies":[{"table":"Commandes","column":"Ville_actuelle","reference":"Client","source":"Ville"}]}</pre>
  <textarea id="audit-config" class="fr-input" rows="7">${esc(JSON.stringify(state.auditConfig,null,2))}</textarea><button type="button" class="fr-btn fr-btn--sm" data-action="audit-config-save">Enregistrer les règles métier</button><p role="status">${esc(state.auditConfigError)}</p>
  <ul>${audit.checks.map(c=>`<li>${esc(c.id)} — ${esc(({detected:'Constat observé',checked:'Examiné sans signal',configuration:'À configurer',unavailable:'Non vérifiable',limited:'Vérification limitée'})[c.state])} : ${esc(c.reason)}</li>`).join('')}</ul></details>`;
}

function renderAnalysis() {
  const count = els['analysis-count'];
  const ins = state.insights;
  if (!ins) {
    count.hidden = true;
    els['analysis-body'].innerHTML = unavailableMessage();
    return;
  }
  count.hidden = !ins.counts.blocking;
  count.textContent = String(ins.counts.blocking);
  count.setAttribute('aria-label', plural(ins.counts.blocking, 'point à corriger', 'points à corriger'));
  els['level-all-label'].textContent = `Tout (${ins.items.length})`;
  for (const lvl of LEVELS) els[`level-${lvl}-label`].textContent = `${SEVERITIES[lvl].label} (${ins.counts[lvl]})`;
  els['level-accepted-label'].textContent = `Choix confirmés (${ins.accepted.length})`;

  const known = new Set(state.out.tables.map((t) => t.name));
  const aclTables = new Set((state.access?.tables || []).map((t) => t.tableId));
  const MAX_CHIPS = 14;
  const card = (it, { accepted = false } = {}) => {
    const chips = it.targets.slice(0, MAX_CHIPS).map((t) => {
      const text = `${esc(targetLabel(t))}${t.note ? ` · ${esc(t.note)}` : ''}`;
      if (it.area === 'access' && aclTables.has(t.table)) return `<li><button class="fr-tag fr-tag--sm" type="button" data-goto-access="${esc(t.table)}" title="Voir ses règles d'accès">${text}</button></li>`;
      if (known.has(t.table)) return `<li><button class="fr-tag fr-tag--sm" type="button" data-goto-schema="${esc(t.table)}" title="Voir sur le schéma">${text}</button></li>`;
      return `<li><p class="fr-tag fr-tag--sm">${text}</p></li>`;
    }).join('') + (it.targets.length > MAX_CHIPS ? `<li><p class="fr-tag fr-tag--sm insight__more">et ${it.targets.length - MAX_CHIPS} autres</p></li>` : '');
    const intended = it.intended ? `<div class="insight__intended"><p class="insight__label">Si c'est voulu</p><p>${esc(it.intended)}</p></div>` : '';
    const steps = it.steps.length
      ? `<div class="insight__fix"><p class="insight__label">${it.intended ? 'Sinon, dans Grist' : 'Comment corriger dans Grist'}</p><ol>${stepsAfterIntended(it).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`
      : '';
    const actions = [];
    if (it.area === 'access') actions.push(`<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-lock-line" type="button" data-goto-access="${esc(aclTables.has(it.targets[0]?.table) ? it.targets[0].table : '*')}">Voir les droits d'accès</button>`);
    else if (it.targets[0] && known.has(it.targets[0].table)) actions.push(`<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-git-merge-line" type="button" data-goto-schema="${esc(it.targets[0].table)}">Voir sur le schéma</button>`);
    if (it.severity === 'choice') {
      actions.unshift(accepted
        ? `<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-close-line" type="button" data-action="unaccept" data-key="${esc(insightKey(it))}">Ne plus considérer comme voulu</button>`
        : `<button class="fr-btn fr-btn--sm fr-btn--secondary fr-btn--icon-left fr-icon-check-line" type="button" data-action="accept" data-key="${esc(insightKey(it))}">C'est voulu</button>`);
    }
    if (it.steps.length && !accepted) actions.push('<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-refresh-line" type="button" data-action="refresh">J\'ai corrigé, relire le document</button>');
    return `<article class="insight insight--${it.severity}${accepted ? ' insight--accepted' : ''}">
      <div class="insight__icon ${SEVERITY_ICON[it.severity]}" aria-hidden="true"></div>
      <div class="insight__main">
        <p class="insight__severity">${esc(accepted ? 'Choix confirmé' : SEVERITIES[it.severity].label)}<span class="insight__area">${esc(AREAS[it.area] || '')}</span></p>
        <h3 class="insight__title">${esc(it.title)}</h3>
        <p class="insight__text">${esc(it.summary)}</p>
        <p class="insight__why">${esc(it.why)}</p>
        ${chips ? `<p class="insight__label">Concerné</p><ul class="insight__targets">${chips}</ul>` : ''}
        ${accepted ? '' : intended + steps}
        ${it.method ? `<details class="insight__method"><summary>Comment ce constat est calculé</summary><p>${esc(it.method)}</p><p><strong>Observation :</strong> ${esc(it.calculation || '')}</p><p><strong>Limites :</strong> ${esc(it.limitations || '')}</p></details>` : ''}
        ${actions.length ? `<div class="insight__actions">${actions.join('')}</div>` : ''}
      </div>
    </article>`;
  };
  const shown = state.level === 'accepted' ? ins.accepted : ins.items.filter((it) => state.level === 'all' || it.severity === state.level);
  const verdict = `<section class="verdict verdict--${ins.verdict.level}">
      <div class="verdict__icon ${ins.verdict.level === 'blocking' ? 'fr-icon-error-warning-line' : 'fr-icon-checkbox-circle-line'}" aria-hidden="true"></div>
      <div><h2 class="verdict__title">${esc(ins.verdict.title)}</h2><p class="verdict__text">${esc(ins.verdict.text)}</p></div>
      <dl class="verdict__counts">
        ${LEVELS.map((l) => `<div class="verdict__count verdict__count--${l}"><dt>${esc(SEVERITIES[l].label)}</dt><dd>${ins.counts[l]}</dd></div>`).join('')}
      </dl>
    </section>`;
  const list = shown.length
    ? shown.map((it) => card(it, { accepted: state.level === 'accepted' })).join('')
    : emptyState(`<p>${state.level === 'all' ? 'Rien à signaler.' : state.level === 'accepted' ? 'Aucun choix confirmé. Sur une carte « Choix à confirmer », le bouton « C\'est voulu » la range ici.' : `Aucun point « ${esc(SEVERITIES[state.level].label)} ».`}</p>`);
  const checks = ins.checks.map((c) => `<li class="${c.ok ? '' : 'is-ko'}">${esc(c.label)}</li>`).join('');
  els['analysis-body'].innerHTML = `${verdict}${auditConfigurationPanel(ins.audit)}
    <div class="analysis">
      <div class="insights">${list}</div>
      <aside class="checks" aria-label="Ce qui a été vérifié"><h3>Ce qui a été vérifié</h3><ul>${checks}</ul></aside>
    </div>`;
}

// ---------------------------------------------------------------------------
// Droits d'accès
// ---------------------------------------------------------------------------

const PERM_HTML = {
  allow: '<span class="perm perm--allow fr-icon-check-line">Autorisé</span>',
  deny: '<span class="perm perm--deny fr-icon-close-line">Refusé</span>',
  none: '<span class="perm perm--none" title="Cette règle ne dit rien : la règle suivante décide">—</span>',
};

function rulesTableHtml(rules, bits, caption) {
  const head = `<tr><th scope="col">Qui</th>${bits.map((b) => `<th scope="col" class="rules__perm">${esc(PERMISSION_LABEL[b])}</th>`).join('')}<th scope="col">Message en cas de refus</th></tr>`;
  const body = rules.map((r) => `<tr>
      <td class="rules__who"><strong>${esc(r.who.text)}</strong>${r.formula && r.who.kind !== 'email' ? `<code>${esc(r.formula)}</code>` : ''}${r.problems.map((p) => `<span class="rules__problem">${esc(p.text)}</span>`).join('')}</td>
      ${bits.map((b) => `<td class="rules__perm">${PERM_HTML[r.perms[b] || 'none']}</td>`).join('')}
      <td class="rules__memo">${esc(r.memo)}</td></tr>`).join('');
  return `<table class="rules"><caption class="fr-sr-only">${esc(caption)}</caption><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function accessMatches(q, ...values) {
  return !q || values.some((v) => String(v || '').toLowerCase().includes(q));
}

function renderAccess() {
  const body = els['access-body'];
  if (!state.out) { body.innerHTML = unavailableMessage(); return; }
  const a = state.access;
  els['btn-access-csv'].disabled = !a || !a.hasRules;
  if (!a) {
    body.innerHTML = emptyState('<p>Les règles d\'accès du document n\'ont pas pu être lues. Seuls les propriétaires du document (ou les personnes autorisées à voir les règles) peuvent les consulter.</p>');
    return;
  }
  const accessIssues = (state.insights?.items || []).filter((i) => i.area === 'access' && i.severity !== 'info');
  const issuesBtn = accessIssues.length
    ? `<button class="fr-btn fr-btn--sm fr-btn--secondary fr-btn--icon-left fr-icon-lightbulb-line" type="button" data-goto-analysis="access">${esc(plural(accessIssues.length, 'point d\'attention', 'points d\'attention'))}</button>`
    : '';
  if (!a.hasRules) {
    body.innerHTML = `<div class="access">
      <section class="access__summary"><div><h2>Aucune règle d'accès avancée</h2>
      <p>Chaque personne invitée voit et modifie tout le document selon son rôle de partage : propriétaire, éditeur ou lecteur.</p></div></section>
      <p class="fr-hint-text">Pour restreindre une table, une colonne ou certaines lignes, ouvrez « Règles d'accès » dans le menu de gauche de Grist.</p></div>`;
    return;
  }
  const q = state.accessFilter.trim().toLowerCase();
  const ruleMatches = (r) => accessMatches(q, r.formula, r.who.text, r.memo);

  // Réglages généraux
  const settings = [];
  settings.push({
    name: 'Modifier la structure',
    badge: a.structureRestricted ? ['success', 'Restreinte'] : [a.restrictsRead ? 'warning' : 'info', 'Éditeurs autorisés'],
    text: a.structureRestricted ? 'Une règle par défaut refuse la permission Structure.' : 'Réglage par défaut : propriétaires et éditeurs modifient tables, colonnes et formules.',
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
  const settingsHtml = `<section class="access__section"><h3>Réglages généraux</h3><div class="access__grid">${settings.map((x) => `
    <div class="setting"><p class="setting__name">${esc(x.name)}</p>
      <p class="setting__state"><span class="fr-badge fr-badge--sm fr-badge--no-icon fr-badge--${x.badge[0]}">${esc(x.badge[1])}</span></p>
      <p class="setting__text">${esc(x.text)}</p></div>`).join('')}</div></section>`;

  const attrs = a.attributes.length ? `<section class="access__section"><h3>Attributs utilisateur</h3>
    <p>Un attribut retrouve la personne connectée dans une table ; les conditions l'utilisent sous la forme <code>user.Nom.Colonne</code>.</p>
    <table class="rules"><caption class="fr-sr-only">Attributs utilisateur</caption>
      <thead><tr><th scope="col">Attribut</th><th scope="col">Cherché dans</th><th scope="col">En comparant à</th><th scope="col">État</th></tr></thead>
      <tbody>${a.attributes.map((x) => `<tr><td><code>user.${esc(x.name)}</code></td><td>${esc(x.tableId)}.${esc(x.lookupColId)}</td><td><code>user.${esc(x.charId)}</code></td>
        <td>${x.problems.length ? `<span class="perm perm--deny fr-icon-close-line">${esc(x.problems.join(', '))}</span>` : '<span class="perm perm--allow fr-icon-check-line">Correct</span>'}</td></tr>`).join('')}</tbody></table></section>` : '';

  const defaults = a.defaults.filter(ruleMatches);
  const defaultsHtml = defaults.length ? `<section class="access__section"><h3>Règles par défaut</h3>
    <p>Elles s'appliquent à toutes les tables, après les règles propres à chaque table.</p>${rulesTableHtml(defaults, BITS.defaults, 'Règles par défaut')}</section>` : '';

  const known = new Set(state.out.tables.map((t) => t.name));
  const cards = [];
  for (const t of a.tables) {
    const tableHit = accessMatches(q, t.tableId);
    const rules = tableHit ? t.rules : t.rules.filter(ruleMatches);
    const cols = t.columns.map((c) => ({ ...c, rules: tableHit || accessMatches(q, c.colIds.join(' ')) ? c.rules : c.rules.filter(ruleMatches) })).filter((c) => c.rules.length);
    if (!rules.length && !cols.length) continue;
    const n = t.rules.length + t.columns.reduce((s, c) => s + c.rules.length, 0);
    const rowRules = [...t.rules, ...t.columns.flatMap((c) => c.rules)].some((r) => r.who.row);
    cards.push(`<article class="acl-table" id="${aclSlug(t.tableId)}">
      <header class="acl-table__head"><h3>${esc(t.tableId)}</h3>
        <p class="fr-badge fr-badge--sm fr-badge--no-icon">${esc(plural(n, 'règle', 'règles'))}</p>
        ${rowRules ? '<p class="fr-badge fr-badge--sm fr-badge--no-icon fr-badge--info">par ligne</p>' : ''}
        ${t.missing ? '<p class="fr-badge fr-badge--sm fr-badge--warning">invisible pour vous</p>' : ''}
        <span class="tbl__actions">${known.has(t.tableId) ? `<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-table-line" type="button" data-goto-table="${esc(t.tableId)}">Colonnes</button>` : ''}</span>
      </header>
      <div class="acl-table__body">
        ${rules.length ? rulesTableHtml(rules, BITS.table, `Règles de la table ${t.tableId}`) : ''}
        ${cols.map((c) => `<p class="acl-table__cols">${c.colIds.length > 1 ? 'Colonnes' : 'Colonne'} ${esc(c.colIds.join(', '))}${c.missing.length ? ` <span class="rules__problem">${c.missing.length > 1 ? `${esc(c.missing.join(', '))} : invisibles pour vous (masquées par ces règles, ou supprimées)` : `${esc(c.missing[0])} : invisible pour vous (masquée par ces règles, ou supprimée)`}</span>` : ''}</p>${rulesTableHtml(c.rules, BITS.column, `Règles des colonnes ${c.colIds.join(', ')}`)}`).join('')}
      </div></article>`);
  }
  const uncovered = a.uncovered.filter((t) => accessMatches(q, t));
  let open = '';
  if (state.accessView === 'all') {
    for (const t of uncovered) {
      cards.push(`<article class="acl-table" id="${aclSlug(t)}"><header class="acl-table__head"><h3>${esc(t)}</h3>
        <p class="fr-badge fr-badge--sm fr-badge--no-icon fr-badge--success">aucune règle propre</p></header>
        <div class="acl-table__body"><p>Suit les règles par défaut${a.defaults.length ? '' : ' (aucune)'} et les rôles de partage.</p></div></article>`);
    }
  } else if (uncovered.length) {
    open = `<div class="acl-open">Sans règle propre (règles par défaut et rôles de partage) :
      <ul>${uncovered.map((t) => `<li><button class="fr-tag fr-tag--sm" type="button" data-goto-table="${esc(t)}">${esc(t)}</button></li>`).join('')}</ul></div>`;
  }
  const tablesHtml = `<section class="access__section"><h3>Règles par table</h3>
    <p>Dans chaque tableau, les règles s'appliquent de haut en bas : la première dont la condition est remplie décide, permission par permission. « — » : la règle ne dit rien, la suivante décide.</p>
    <div class="access">${cards.join('') || emptyState(q ? `<p>Aucune règle ne contient « ${esc(state.accessFilter)} ».</p>` : '<p>Aucune table n\'a de règle propre.</p>')}</div>${open}</section>`;

  body.innerHTML = `<div class="access">
    <section class="access__summary"><div><h2>Règles d'accès avancées</h2><p>${esc(accessSummary(a))}</p></div>${issuesBtn}</section>
    ${q ? '' : settingsHtml}${q ? '' : attrs}${defaultsHtml}${tablesHtml}</div>`;
}

const WIDGET_ICONS = { record: 'fr-icon-table-line', single: 'fr-icon-file-text-line', detail: 'fr-icon-list-unordered', chart: 'fr-icon-line-chart-line', custom: 'fr-icon-code-s-slash-line', creator: 'fr-icon-code-s-slash-line', form: 'fr-icon-edit-line' };
const ORIGIN_BADGE = { gallery: 'fr-badge--info', external: 'fr-badge--warning', document: 'fr-badge--new', self: 'fr-badge--success' };

function renderWidgets() {
  const body = els['widgets-body'];
  if (!state.out) { body.innerHTML = unavailableMessage(); return; }
  const m = state.pages;
  if (!m) { body.innerHTML = emptyState('<p>Les pages du document n\'ont pas pu être lues.</p>'); return; }
  const known = new Set(state.out.tables.map((t) => t.name));
  const issues = (state.insights?.items || []).filter((i) => i.area === 'pages' && i.severity !== 'info');
  const tableLink = (t) => (known.has(t) ? `<button class="fr-link widget-item__link" type="button" data-goto-table="${esc(t)}">${esc(t)}</button>` : esc(t));
  const where = (w) => `page « ${esc(w.page || '(sans nom)')} »${w.table ? ` · table ${tableLink(w.table)}${w.summary ? ' (synthèse)' : ''}` : ''}${w.linkedTo ? ` · suit la sélection de « ${esc(w.linkedTo)} »` : ''}`;
  const n = m.custom.length + m.views.length;
  const summary = n
    ? `${plural(n, 'widget', 'widgets')} hors tableaux${typeCounts(m) ? ` : ${typeCounts(m)}` : ''} · ${plural(m.tableWidgetCount, 'tableau', 'tableaux')} non détaillés`
    : `Aucun widget hors tableaux · ${plural(m.tableWidgetCount, 'tableau', 'tableaux')}`;

  const columnsList = (c) => {
    const lines = columnLines(c);
    return lines.length ? `<ul class="widget-cols">${lines.map((l) => `<li${l.missing ? ' class="widget-cols--missing"' : ''}><span class="widget-cols__field">${esc(l.field)}</span> <span aria-hidden="true">→</span> ${l.missing ? 'à associer' : `<strong>${esc(l.column)}</strong>`}</li>`).join('')}</ul>` : '';
  };
  const card = (w, rows, badge) => `<article class="acl-table widget-card">
      <header class="acl-table__head"><h3>${esc(w.title || w.custom?.name || 'Widget personnalisé')}</h3>${badge || ''}</header>
      <p class="widget-card__where">${where(w)}</p>
      <dl class="widget-card__props">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></article>`;
  const accessText = (c) => `<span class="${c.access === 'full' && c.origin === 'external' ? 'perm--deny' : ''}">${esc(ACCESS_LABELS[c.access] || c.access || '—')}</span>`;
  const badgeOf = (label, cls) => `<p class="fr-badge fr-badge--sm fr-badge--no-icon ${cls}">${esc(label)}</p>`;

  const unofficialCards = m.unofficial.map((w) => {
    const c = w.custom;
    return card(w, [
      ['Origine', esc(originText(c))],
      ['Accès', accessText(c)],
      columnLines(c).length ? ['Colonnes', columnsList(c)] : null,
      c.url && c.origin !== 'document' ? ['Adresse', `<span class="widget-url">${esc(c.url)}</span>`] : null,
      w.description ? ['Description', esc(w.description)] : null,
    ], badgeOf({ external: 'Externe', document: 'Dans le document', self: 'Ce widget' }[c.origin], ORIGIN_BADGE[c.origin]));
  }).join('');
  const galleryCards = m.gallery.map((w) => {
    const c = w.custom;
    return card(w, [
      ['Accès', accessText(c)],
      ['Colonnes', columnsList(c) || '<span class="widget-cols__none">Aucune colonne à associer</span>'],
    ], c.maintained ? '' : badgeOf(`Communauté${c.author ? ` · ${c.author}` : ''}`, 'fr-badge--purple-glycine'));
  }).join('');

  const byPage = new Map();
  for (const w of m.views) { if (!byPage.has(w.page)) byPage.set(w.page, []); byPage.get(w.page).push(w); }
  const viewCards = [...byPage.entries()].map(([page, list]) => `<article class="acl-table page-card">
      <header class="acl-table__head"><h3>${esc(page || '(sans nom)')}</h3><p class="fr-badge fr-badge--sm fr-badge--no-icon">${esc(plural(list.length, 'vue', 'vues'))}</p></header>
      <ul class="widget-list">${list.map((w) => `<li class="widget-item">
        <span class="widget-item__icon ${WIDGET_ICONS[w.type] || 'fr-icon-layout-grid-line'}" aria-hidden="true"></span>
        <span class="widget-item__main"><strong>${esc(w.title || w.table || w.typeLabel)}</strong>
          <span class="widget-item__meta">${esc(w.typeLabel)}${w.table ? ` · table ${tableLink(w.table)}${w.summary ? ' (synthèse)' : ''}` : ''}${w.linkedTo ? ` · suit la sélection de « ${esc(w.linkedTo)} »` : ''}</span>
          ${w.description ? `<span class="widget-item__meta">${esc(w.description)}</span>` : ''}
        </span></li>`).join('')}</ul></article>`).join('');

  const tagList = (items, goto) => `<ul>${items.map((t) => `<li>${goto ? `<button class="fr-tag fr-tag--sm" type="button" data-goto-table="${esc(t)}">${esc(t)}</button>` : `<span class="fr-tag fr-tag--sm">${esc(t)}</span>`}</li>`).join('')}</ul>`;
  body.innerHTML = `<div class="access">
    <section class="access__summary"><div><h2>Widgets</h2><p>${esc(summary)}</p></div>${issues.length ? `<button class="fr-btn fr-btn--sm fr-btn--secondary fr-btn--icon-left fr-icon-lightbulb-line" type="button" data-goto-analysis="pages">${esc(plural(issues.length, 'point d\'attention', 'points d\'attention'))}</button>` : ''}</section>
    <section class="access__section"><h3>Widgets non officiels</h3><p class="fr-hint-text widget-section__hint">Ajoutés par leur adresse ou créés dans le document, hors de la galerie de Grist.</p>${unofficialCards ? `<div class="pages-grid">${unofficialCards}</div>` : '<p class="fr-hint-text">Aucun widget non officiel dans ce document.</p>'}</section>
    <section class="access__section"><h3>Widgets personnalisés</h3><p class="fr-hint-text widget-section__hint">Choisis dans la galerie de Grist.</p>${galleryCards ? `<div class="pages-grid">${galleryCards}</div>` : '<p class="fr-hint-text">Aucun widget de la galerie dans ce document.</p>'}</section>
    <section class="access__section"><h3>Fiches, listes, graphiques et formulaires</h3>${viewCards ? `<div class="pages-grid">${viewCards}</div>` : '<p class="fr-hint-text">Aucune autre vue que des tableaux.</p>'}</section>
    ${m.tableOnlyPages.length || m.tablesWithoutPage.length ? `<section class="access__section"><h3>Le reste</h3>
      ${m.tableOnlyPages.length ? `<div class="acl-open">${esc(plural(m.tableOnlyPages.length, 'page ne contient', 'pages ne contiennent'))} que des tableaux :${tagList(m.tableOnlyPages)}</div>` : ''}
      ${m.tablesWithoutPage.length ? `<div class="acl-open">Tables affichées sur aucune page :${tagList(m.tablesWithoutPage, true)}</div>` : ''}</section>` : ''}
  </div>`;
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
  els['report-sections'].innerHTML = REPORT_SECTIONS.map((r) => `<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left ${state.reportSections.has(r.id) ? 'fr-icon-check-line' : 'fr-icon-close-line'} toolbar__toggle report__toggle"
    type="button" aria-pressed="${state.reportSections.has(r.id)}" data-section="${r.id}" title="${esc(r.description)}">${esc(r.title)}</button>`).join('');
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

  // Analyse
  for (const id of ['level-all', 'level-accepted', ...LEVELS.map((l) => `level-${l}`)]) {
    els[id].addEventListener('change', () => { if (els[id].checked) { state.level = els[id].value; renderAnalysis(); } });
  }

  // Rapport
  els['report-sections'].addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-section]');
    if (!btn) return;
    const id = btn.dataset.section;
    if (state.reportSections.has(id)) state.reportSections.delete(id); else state.reportSections.add(id);
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
    const target = ev.target.closest('[data-goto-table],[data-goto-schema],[data-goto-access],[data-goto-analysis],[data-action]');
    if (!target) return;
    ev.preventDefault();
    if (target.dataset.action === 'audit-key-add') {
      try { const table=document.getElementById('audit-key-table').value; const columns=document.getElementById('audit-key-columns').value.split(',').map(c=>c.trim()).filter(Boolean); if(!state.schema.has(table)||columns.some(c=>!state.schema.get(table).columns.has(c))) throw new Error('Choisissez une table et ses identifiants de colonnes existants.'); const value=validateAuditConfig({...state.auditConfig,keys:[...(state.auditConfig.keys||[]).filter(k=>k.table!==table),{table,columns}]}); state.auditConfig=value; state.auditConfigError=''; saveOption('auditConfig',value);recompute(); } catch(err) {state.auditConfigError=err.message;renderAnalysis();} return;
    }
    if (target.dataset.action === 'audit-config-save') {
      try { const value=validateAuditConfig(JSON.parse(document.getElementById('audit-config').value)); state.auditConfig=value; state.auditConfigError=''; saveOption('auditConfig',value); recompute(); } catch(err) { state.auditConfigError='Configuration non enregistrée : '+err.message; renderAnalysis(); }
      return;
    }
    if (target.dataset.action === 'refresh') loadSchema({ manual: true });
    else if (target.dataset.action === 'accept' || target.dataset.action === 'unaccept') {
      if (target.dataset.action === 'accept') state.accepted.add(target.dataset.key); else state.accepted.delete(target.dataset.key);
      saveOption('accepted', [...state.accepted]);
      recompute();
      toast(target.dataset.action === 'accept' ? 'Noté comme voulu : ce point ne sera plus compté.' : 'Ce point est de nouveau à confirmer.', 'info');
    }
    else if (target.dataset.gotoAccess) gotoAccess(target.dataset.gotoAccess);
    else if (target.dataset.gotoAnalysis) selectTab('analysis', { focus: true });
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

