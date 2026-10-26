import { convertAll, computeStats, schemaFromMetadata } from './converter.js?v=2.3.0';
import { ErdViewer } from './erd.js?v=2.3.0';
import { buildInsights, SEVERITIES, LEVELS, AREAS, targetLabel, insightKey, stepsAfterIntended } from './insights.js?v=2.3.0';
import { profileTables } from './datacheck.js?v=2.3.0';
import { buildAccess, BITS, PERMISSION_LABEL, SPECIAL } from './access.js?v=2.3.0';
import { columnTypeLabel, detailLines, ID_TYPE_LABEL } from './types.js?v=2.3.0';
import {
  REPORT_SECTIONS, buildReport, renderHtml, renderDocx, readTheme, loadDocx, accessSummary,
} from './report.js?v=2.3.0';

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
  'level-all', 'level-blocking', 'level-improve', 'level-choice', 'level-info',
  'level-all-label', 'level-blocking-label', 'level-improve-label', 'level-choice-label', 'level-info-label', 'analysis-body',
  'report-sections', 'btn-docx', 'report-body', 'toast', 'live']) {
  els[id] = $(id);
}
const tabs = ['schema', 'tables', 'access', 'analysis', 'report'];

const state = {
  schema: null,
  schemaAt: null,
  schemaError: null,
  schemaLoading: false,
  out: null, // { tables, dbml }
  insights: null,
  acl: null, // { resources, rules } lus dans le document, ou null si illisibles
  access: null, // buildAccess()
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
  state.insights = state.out ? buildInsights(state.out.tables, state.access, { profiles: state.profiles, accepted: state.accepted }) : null;
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
    const [tables, columns, sections, resources, rules] = await Promise.all([
      gristApi.docApi.fetchTable('_grist_Tables'),
      gristApi.docApi.fetchTable('_grist_Tables_column'),
      optional('_grist_Views_section'),
      optional('_grist_ACLResources'),
      optional('_grist_ACLRules'),
    ]);
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
  const ids = [...state.schema.values()].filter((t) => !t.summarySourceTable && !t.tableId.startsWith('_grist_')).map((t) => t.tableId);
  const key = JSON.stringify(ids.map((id) => [id, [...state.schema.get(id).columns.keys()]]));
  if (!force && key === state.profileKey && state.profiles) return;
  const data = {};
  const queue = ids.slice();
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try { data[id] = await gristApi.docApi.fetchTable(id); } catch { /* table illisible pour cette personne */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  state.profiles = profileTables(data);
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
        <p class="insight__severity">${esc(SEVERITIES[it.severity].label)}<span class="insight__area">${esc(AREAS[it.area] || '')}</span></p>
        <h3 class="insight__title">${esc(it.title)}</h3>
        <p class="insight__text">${esc(it.summary)}</p>
        <p class="insight__why">${esc(it.why)}</p>
        ${chips ? `<p class="insight__label">Concerné</p><ul class="insight__targets">${chips}</ul>` : ''}
        ${accepted ? '' : intended + steps}
        ${actions.length ? `<div class="insight__actions">${actions.join('')}</div>` : ''}
      </div>
    </article>`;
  };
  const shown = ins.items.filter((it) => state.level === 'all' || it.severity === state.level);
  const verdict = `<section class="verdict verdict--${ins.verdict.level}">
      <div class="verdict__icon ${ins.verdict.level === 'blocking' ? 'fr-icon-error-warning-line' : 'fr-icon-checkbox-circle-line'}" aria-hidden="true"></div>
      <div><h2 class="verdict__title">${esc(ins.verdict.title)}</h2><p class="verdict__text">${esc(ins.verdict.text)}</p></div>
      <dl class="verdict__counts">
        ${LEVELS.map((l) => `<div class="verdict__count verdict__count--${l}"><dt>${esc(SEVERITIES[l].label)}</dt><dd>${ins.counts[l]}</dd></div>`).join('')}
      </dl>
    </section>`;
  const list = shown.length
    ? shown.map(card).join('')
    : emptyState(`<p>${state.level === 'all' ? 'Rien à signaler.' : `Aucun point « ${esc(SEVERITIES[state.level].label)} ».`}</p>`);
  const checks = ins.checks.map((c) => `<li class="${c.ok ? '' : 'is-ko'}">${esc(c.label)}</li>`).join('');
  const acceptedHtml = ins.accepted.length && (state.level === 'all' || state.level === 'choice')
    ? `<details class="insights__accepted"><summary>${esc(plural(ins.accepted.length, 'choix confirmé', 'choix confirmés'))} (« C'est voulu »)</summary>${ins.accepted.map((it) => card(it, { accepted: true })).join('')}</details>`
    : '';
  els['analysis-body'].innerHTML = `${verdict}
    <div class="analysis">
      <div class="insights">${list}${acceptedHtml}</div>
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
  const key = JSON.stringify([state.diagramKey || out.dbml, positions, state.diagram.detail]);
  if (state.snapshot?.key === key) return state.snapshot;
  const host = document.createElement('div');
  host.className = 'snapshot-host';
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  const v = new ErdViewer(host);
  try {
    await v.setData(out.tables, { positions, detail: state.diagram.detail });
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
  for (const id of ['level-all', ...LEVELS.map((l) => `level-${l}`)]) {
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
