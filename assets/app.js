import { convertSchema, computeStats, schemaFromMetadata } from './converter.js';
import { esc, plural } from './util.js';
import { applyDocTheme } from './theme.js';

// Couleurs des documents (variables --doc-*) : posées avant tout affichage.
applyDocTheme();
import { ErdViewer } from './erd.js';
import { buildInsights, SEVERITIES, LEVELS, AREAS, targetLabel, insightKey, stepsAfterIntended } from './insights.js';
import { sampleAuditData, AUDIT_LIMITS, presampleTable } from './audit-engine.js';
import { profileTables } from './datacheck.js';
import { buildPages, originText, typeCounts, columnLines, ACCESS_LABELS } from './pages.js';
import { buildAccess, BITS, PERMISSION_LABEL, generalSettings } from './access.js';
import { columnTypeLabel, detailLines, ID_TYPE_LABEL } from './types.js';
import { TABLE_COLUMNS, tableRows, NO_FORMULA } from './table-format.js';
import { findLookups } from './lookups.js';
import { findFormulaDeps } from './formula-deps.js';
import { tablesXlsx } from './tables-export.js';
import { accessXlsx } from './rights-export.js';
import { viewsXlsx } from './views-export.js';
import {
  ACTIONS as MATRIX_ACTIONS,
  ACTION_LABEL,
  prepareMatrixModel,
  buildMatrix,
  cellText,
  cellTone,
  cellSentence,
  cellSteps,
  detectRole,
} from './rights-matrix.js';
import { REPORT_SECTIONS, buildReport, renderHtml, renderDocx, readTheme, loadDocx, accessSummary } from './report.js';

// Le widget lit toujours la structure du document où il est installé et produit
// la conversion corrigée (relations et types fidèles au document).

const gristApi = window.grist;
const inGrist = Boolean(gristApi) && window.self !== window.top;

const $ = (id) => document.getElementById(id);
const els = {};
for (const id of [
  'stats',
  'read-at',
  'btn-refresh',
  'doc-alert',
  'analysis-count',
  'btn-zoom-out',
  'zoom-value',
  'btn-zoom-in',
  'btn-zoom-fit',
  'btn-relayout',
  'detail-all',
  'detail-keys',
  'detail-tables',
  'find-table',
  'find-table-list',
  'btn-png',
  'btn-kinds',
  'kinds-menu',
  'kinds-count',
  'show-kind-table',
  'show-kind-summary',
  'show-kind-acl',
  'show-kind-table-sub',
  'show-kind-summary-sub',
  'show-kind-acl-sub',
  'btn-links',
  'links-menu',
  'links-count',
  'show-refs',
  'show-lookups',
  'show-calc',
  'show-refs-sub',
  'show-lookups-sub',
  'show-calc-sub',
  'schema-body',
  'filter-input',
  'cols-all',
  'cols-refs',
  'cols-formulas',
  'btn-csv',
  'tables-body',
  'access-filter',
  'btn-access-csv',
  'btn-widgets-xlsx',
  'access-body',
  'widgets-filter',
  'wkind-all',
  'wkind-unofficial',
  'wkind-gallery',
  'wkind-views',
  'widgets-body',
  'analysis-filter',
  'analysis-body',
  'report-sections',
  'report-count',
  'btn-docx',
  'report-body',
  'toast',
  'live',
]) {
  els[id] = $(id);
}
const tabs = ['schema', 'tables', 'access', 'widgets', 'analysis', 'report'];

const state = {
  schema: null,
  schemaAt: null,
  schemaError: null,
  schemaLoading: false,
  dataLoading: false, // structure affichée, données en cours de lecture (Analyse et Rapport attendent)
  reloadPending: false, // relecture demandée pendant une lecture : relancée à la fin
  out: null, // { tables, dbml }
  insights: null,
  acl: null, // { resources, rules } lus dans le document, ou null si illisibles
  access: null, // buildAccess()
  pages: null, // buildPages() : pages et widgets
  pagesMeta: null,
  data: {},
  failedTables: [],
  auditMeta: {},
  loadProgress: null, // { done, total } pendant la lecture des données
  profiles: null, // profileTables() : données lues, pour les constats sur les données
  profileKey: null,
  accepted: new Set(), // constats « C'est voulu », mémorisés dans les options de la vue
  details: false,
  accessFilter: '',
  matrixDetail: 'columns', // « Par table » ou « Par table et par colonne »
  matrixPick: null, // case choisie : { row, group, bit }
  matrixAttrData: null,
  accessView: 'all', // toutes les tables, toujours
  docName: '',
  tab: 'schema',
  filter: '',
  cols: 'all',
  level: 'blocking',
  analysisFilter: '',
  widgetsFilter: '',
  wkind: 'all',
  reportSections: new Set(REPORT_SECTIONS.map((r) => r.id).filter((id) => !['analysis', 'dbml'].includes(id))), // Analyse et code DBML : à cocher si besoin
  snapshot: null, // image du schéma pour le rapport : { key, png, width, height, url }
  diagramKey: null,
  diagram: { detail: 'keys', positions: null, lookups: true, refs: true, calc: false, kinds: { table: true, summary: true, acl: true } }, // mémorisé dans les options de la vue (detail seulement s'il a été choisi)
  lines: { table: new Map(), column: new Map() },
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

let toastTimer;
function toast(message, level = 'success') {
  clearTimeout(toastTimer);
  els.toast.innerHTML = `<div class="fr-alert fr-alert--${level} fr-alert--sm"><p>${esc(message)}</p></div>`;
  toastTimer = setTimeout(
    () => {
      els.toast.innerHTML = '';
    },
    level === 'error' ? 7000 : 3500,
  );
}

const announce = debounce((message) => {
  els.live.textContent = message;
}, 600);

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
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
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
  setTimeout(() => {
    btn.textContent = original;
  }, 2000);
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

function recompute({ quiet = false } = {}) {
  state.out = state.schema ? convertSchema(state.schema) : null;
  state.stats = state.out ? computeStats(state.out.tables) : null; // calculées une fois par lecture
  state.access = state.out && state.acl ? buildAccess({ ...state.acl, schema: state.schema }) : null;
  state.pages = state.out && state.pagesMeta ? buildPages(state.pagesMeta) : null;
  // L'analyse attend les données : pas de verdict partiel qui changerait une fois la lecture finie.
  state.insights =
    state.out && !state.dataLoading
      ? buildInsights(state.out.tables, state.access, {
          profiles: state.profiles,
          accepted: state.accepted,
          pages: state.pages,
          audit: {
            schema: state.schema,
            data: state.data,
            sampled: state.sampled,
            meta: state.auditMeta,
            failedTables: state.failedTables,
          },
        })
      : null;
  render();
  if (state.out && !quiet) {
    const s = state.stats;
    announce(`Structure mise à jour : ${plural(s.tables, 'table', 'tables')}, ${plural(s.relations, 'relation', 'relations')}.`);
  }
}

/**
 * Lecture en deux temps. 1. Les métadonnées (tables, colonnes, règles, pages) : quelques requêtes,
 * puis le schéma, les tables, les droits et les vues s'affichent aussitôt. 2. Les données de chaque
 * table, en arrière-plan : seules l'Analyse et le Rapport les attendent.
 */
async function loadSchema({ manual = false } = {}) {
  if (!inGrist) return;
  if (state.schemaLoading || state.dataLoading) {
    state.reloadPending = true; // le document a changé pendant la lecture : relu à la fin
    return;
  }
  state.reloadPending = false;
  state.schemaLoading = true;
  renderHeader();
  const optional = (name) => Promise.resolve(gristApi.docApi.fetchTable(name)).catch(() => null);
  try {
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
    state.auditMeta = { filters, sections, tables, columns, views };
    state.pagesMeta = pages && views && sections ? { pages, views, sections, tables, columns, selfUrl: location.href } : null;
    state.schema = schemaFromMetadata(tables, columns, { sections });
    state.acl = resources && rules ? { resources, rules } : null;
    state.schemaError = null;
    state.schemaAt = new Date();
  } catch (err) {
    state.schemaError = err;
  } finally {
    state.schemaLoading = false;
  }
  if (state.schemaError) {
    recompute();
    return finishLoad();
  }
  // 1. La structure s'affiche sans attendre les données.
  state.dataLoading = true;
  recompute();
  try {
    // Matrice « Qui peut faire quoi ? » : la table de l'attribut du rôle métier, seulement pour
    // compter les valeurs d'une colonne filtrante (« 7 services ») ; illisible ou absente : sans compte.
    let attrData = null;
    if (state.acl) {
      const m = prepareMatrixModel(state.acl);
      const role = detectRole(m);
      const attrTable = role && m.attributes.find((a) => a.name === role.attr)?.tableId;
      if (attrTable) attrData = await optional(attrTable);
    }
    if (attrData !== state.matrixAttrData) {
      state.matrixAttrData = attrData;
      renderAccess();
    }
    // 2. Les données, en arrière-plan.
    await loadData({ force: manual });
  } catch (err) {
    console.warn('Lecture des données interrompue', err);
  } finally {
    state.dataLoading = false;
    state.loadProgress = null;
  }
  recompute({ quiet: true });
  if (manual) toast('Structure du document relue.', 'info');
  finishLoad();
}
/** Une modification du document arrivée pendant la lecture est prise en compte à la fin. */
function finishLoad() {
  if (state.reloadPending) loadSchemaSoon();
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
  // Chaque table est réduite à son échantillon dès sa lecture : la table complète n'est jamais
  // gardée en mémoire (seuls ses ids le sont, pour l'intégrité des références et le nombre de lignes).
  const data = {};
  const failed = new Set();
  const queue = ids.slice();
  let done = 0;
  state.loadProgress = { done, total: ids.length };
  renderLoading();
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        data[id] = presampleTable(id, await gristApi.docApi.fetchTable(id));
      } catch {
        failed.add(id);
      }
      state.loadProgress = { done: ++done, total: ids.length };
      renderLoading();
      await yieldToBrowser(); // l'interface reste fluide entre deux tables
    }
  };
  await Promise.all([worker(), worker()]);
  state.loadProgress = null;
  // Ordre du document (et non d'arrivée) : la répartition du budget d'échantillonnage est stable.
  state.data = Object.fromEntries(ids.filter((id) => id in data).map((id) => [id, data[id]]));
  state.failedTables = ids.filter((id) => failed.has(id));
  const sampled = sampleAuditData(state.data);
  state.sampled = sampled; // repris tel quel par l'analyse (runAudit) : un seul tirage par lecture
  state.profiles = profileTables(sampled.data);
  for (const c of sampled.coverage) {
    const p = state.profiles.get(c.table);
    if (p) {
      p.rows = c.visibleRows;
      p.sampled = c.sampled;
    }
  }
  state.profileKey = key;
}

/** Avancement de la lecture : en-tête, et onglets qui attendent les données s'ils sont affichés. */
function renderLoading() {
  renderHeader();
  if (state.tab === 'analysis') renderAnalysis();
  if (state.tab === 'report') renderReport();
}

/** Rend la main au navigateur (affichage, clics) entre deux étapes longues. */
const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Options de la vue (enregistrées dans le document Grist)
// ---------------------------------------------------------------------------

function saveOption(key, value) {
  if (!inGrist) return;
  Promise.resolve(gristApi.setOption(key, value)).catch(() => {
    /* accès en lecture seule */
  });
}
const TABLE_KINDS = ['table', 'summary', 'acl'];
const saveDiagramSoon = debounce(() => saveOption('diagram', { ...state.diagram }), 800);

function applyOptions(options) {
  if (Array.isArray(options?.accepted)) state.accepted = new Set(options.accepted.map(String));
  const d = options?.diagram;
  if (d && typeof d === 'object') {
    // Le détail enregistré ne compte que s'il a été choisi (avant la 3.3, « Colonnes » était
    // enregistré d'office avec la disposition) : sinon « Relations », le réglage par défaut.
    const chosen = d.detailChosen && ['all', 'keys', 'tables'].includes(d.detail);
    state.diagram = {
      lookups: d.lookups !== false,
      refs: d.refs !== false,
      calc: d.calc === true,
      kinds: Object.fromEntries(TABLE_KINDS.map((k) => [k, d.kinds?.[k] !== false])),
      detail: chosen ? d.detail : 'keys',
      ...(chosen ? { detailChosen: true } : {}),
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
  if (!inGrist)
    return emptyState(
      "<p>Cette vue s'utilise dans Grist : ajoutez-le comme vue personnalisée avec l'accès « Accès complet au document ».</p>",
    );
  if (state.dataLoading || state.loadProgress) {
    const p = state.loadProgress;
    const progress = p ? `Lecture des données : ${p.done} sur ${p.total} tables…` : 'Lecture des données…';
    const hint = state.out
      ? '<p class="empty__hint">Cette partie attend les données. Le schéma, les tables, les droits d’accès et les vues sont déjà disponibles.</p>'
      : '';
    return emptyState(`<p>${progress}</p>${hint}`);
  }
  if (state.schemaLoading) return emptyState('<p>Lecture de la structure du document…</p>');
  return emptyState("<p>La structure du document n'est pas disponible.</p>");
}

function renderHeader() {
  if (state.out) {
    const s = state.stats;
    els.stats.textContent = [
      plural(s.tables, 'table', 'tables'),
      plural(s.columns, 'colonne', 'colonnes'),
      plural(s.relations, 'relation', 'relations'),
    ].join(' · ');
    els.stats.title = `${els.stats.textContent} · ${plural(s.formulas, 'formule', 'formules')}`;
  } else {
    els.stats.textContent = '';
  }
  if (state.loadProgress)
    els['read-at'].textContent = `Lecture des données : ${state.loadProgress.done}/${state.loadProgress.total} tables`;
  else if (state.schemaLoading || state.dataLoading) els['read-at'].textContent = 'Lecture en cours…';
  else if (state.schemaAt)
    els['read-at'].textContent = `Lue à ${state.schemaAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  else els['read-at'].textContent = '';
  els['btn-refresh'].disabled = !inGrist || state.schemaLoading || state.dataLoading;

  if (!inGrist) {
    els['doc-alert'].innerHTML =
      `<div class="fr-alert fr-alert--info fr-alert--sm"><p>Ouvrez cette vue dans un document Grist : il lit directement la structure du document où il est installé.</p></div>`;
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

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function renderTables() {
  const out = state.out;
  if (!out) {
    els['tables-body'].innerHTML = unavailableMessage();
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
  const keep = (c) => state.cols === 'all' || (state.cols === 'refs' ? Boolean(c.ref) : c.isFormula || Boolean(c.details?.trigger));
  const visible = out.tables
    .map((t) => ({ ...t, shownColumns: t.columns.filter(keep) }))
    .filter(
      (t) =>
        (!q || matches(t.name) || t.shownColumns.some((c) => matches(c.name) || matches(c.label))) &&
        (state.cols === 'all' || t.shownColumns.length),
    );

  const s = state.stats;
  const summaries = out.tables.filter((t) => t.kind === 'summary').length;
  const header = pageHeader({
    title: 'Tables et colonnes',
    lead: 'Chaque table avec ses colonnes, leur type, leurs liens, formules et listes de choix.',
    kpis: [
      {
        value: s.tables,
        label: summaries
          ? `${s.tables > 1 ? 'tables' : 'table'} dont ${plural(summaries, 'synthèse', 'synthèses')}`
          : s.tables > 1
            ? 'tables'
            : 'table',
      },
      { value: s.columns, label: s.columns > 1 ? 'colonnes' : 'colonne' },
      { value: s.relations, label: s.relations > 1 ? 'relations' : 'relation' },
      { value: s.formulas, label: s.formulas > 1 ? 'formules' : 'formule' },
    ],
  });
  if (!visible.length) {
    els['tables-body'].innerHTML =
      `<div class="view">${header}${emptyState(q ? `<p>Aucune table ni colonne ne contient « ${esc(state.filter)} ».</p>` : '<p>Aucune table ne correspond.</p>')}</div>`;
    return;
  }

  const cards = visible
    .map((t) => {
      // Format « Table pour exportation » : nom en base, nom affiché, type SQLite, type déclaré,
      // rôle, calculé, formule (table-format.js, partagé avec le rapport et l'export Excel).
      const shown = new Set(t.shownColumns);
      const lines = tableRows(t, (c) => shown.has(c)).filter((r) => !r.isKey || state.cols === 'all');
      const rows = lines
        .map((r) => {
          const c = r.column;
          const cls = [
            r.isKey ? 'is-key' : '',
            c?.isFormula ? 'is-formula' : '',
            c?.ref ? 'is-ref' : '',
            c?.empty ? 'is-empty' : '',
            c && (matches(c.name) || matches(c.label)) ? 'is-match' : '',
          ]
            .filter(Boolean)
            .join(' ');
          let declared = esc(r.declared.text);
          if (r.declared.target) {
            const target = c.ref?.table || r.declared.target;
            const chip = known.has(target)
              ? `<button class="chip" type="button" data-goto-table="${esc(target)}">${esc(r.declared.target)}</button>`
              : `<span class="chip chip--plain">${esc(r.declared.target)} · table absente</span>`;
            declared = `${esc(r.declared.label)} → ${chip}${r.declared.reverse ? `<span class="col-label">inverse de ${esc(r.declared.reverse)}</span>` : ''}`;
          }
          return `<tr${cls ? ` class="${cls}"` : ''}>
        <td><span class="col-name">${esc(r.name)}</span></td>
        <td>${r.label ? `<span class="col-display">${esc(r.label)}</span>` : ''}${columnDescriptionHtml(r.description)}</td>
        <td><code class="col-sql">${esc(r.sqlite)}</code></td>
        <td><span class="col-type">${declared}</span></td>
        <td>${r.isKey ? `<strong>${esc(r.role)}</strong>` : esc(r.role)}</td>
        <td>${r.computed === 'Non calculé' ? `<span class="col-muted">${esc(r.computed)}</span>` : `<span class="col-flag">${esc(r.computed)}</span>${r.when ? `<span class="col-desc">${esc(r.when)}</span>` : ''}`}</td>
        <td>${r.formula ? `<code class="col-formula">${esc(r.formula)}</code>` : ''}</td>
        <td>${r.documented === NO_FORMULA ? `<span class="col-muted" title="Sans formule">${esc(r.documented)}</span>` : r.documented === 'Documentée' ? `<span class="col-doc col-doc--ok">${esc(r.documented)}</span>` : `<span class="col-doc col-doc--ko">${esc(r.documented)}</span>`}</td></tr>`;
        })
        .join('');
      const pk = '';
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
      <div class="table-scroll"><table class="grid-table cols-table">
        <caption class="fr-sr-only">Colonnes de ${esc(t.name)}</caption>
        <thead><tr>${TABLE_COLUMNS.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${pk}${rows}</tbody>
      </table></div>
      ${foot}
    </article>`;
    })
    .join('');
  const index = `<nav class="tables-index" aria-label="Index des tables">
      <p class="tables-index__head">${esc(plural(visible.length, 'table', 'tables'))}</p>
      <ul>${visible.map((t) => `<li><button type="button" data-index-table="${esc(t.name)}"${t.kind === 'summary' ? ' class="is-summary"' : ''}><span class="tables-index__name">${esc(t.name).replace(/_/g, '_<wbr>')}</span><span>${t.columns.length + 1}</span></button></li>`).join('')}</ul>
    </nav>`;
  els['tables-body'].innerHTML =
    `<div class="view">${header}<div class="tables-layout">${index}<div class="tables-list">${cards}</div></div></div>`;
  updateTablesIndex();
}

/** Index des tables : met en évidence la table en haut de la zone visible. */
function updateTablesIndex() {
  const body = els['tables-body'];
  const cards = [...body.querySelectorAll('.tbl')];
  if (!cards.length) return;
  const top = body.getBoundingClientRect().top + 24;
  let current = cards[0];
  for (const c of cards) {
    if (c.getBoundingClientRect().top <= top) current = c;
    else break;
  }
  const name = current.querySelector('.card__title')?.textContent;
  for (const b of body.querySelectorAll('[data-index-table]')) b.classList.toggle('is-current', b.dataset.indexTable === name);
}

/** Formules, choix, condition de liste et description d'une colonne. */
/** Description de la colonne, quand elle est renseignée (sinon rien). */
function columnDescriptionHtml(description) {
  return description ? `<span class="col-desc">${esc(description)}</span>` : '';
}

const SEVERITY_ICON = {
  blocking: 'fr-icon-error-warning-line',
  improve: 'fr-icon-warning-line',
  choice: 'fr-icon-question-line',
  info: 'fr-icon-information-line',
  accepted: 'fr-icon-check-line',
};

/** Lignes examinées, cellules analysées, tables illisibles : la phrase sous le verdict. */
function auditCoverageText(audit) {
  if (!audit) return '';
  const counts = audit.coverage.reduce((a, c) => ({ visible: a.visible + c.visibleRows, inspected: a.inspected + c.inspectedRows }), {
    visible: 0,
    inspected: 0,
  });
  const parts = [
    counts.inspected === counts.visible
      ? plural(counts.inspected, 'ligne examinée', 'lignes examinées')
      : `${plural(counts.inspected, 'ligne examinée', 'lignes examinées')} sur ${counts.visible.toLocaleString('fr-FR')} lisibles`,
    plural(audit.cells, 'cellule analysée', 'cellules analysées'),
  ];
  const failed = state.failedTables.length;
  if (failed) parts.push(failed > 1 ? `${failed} tables n'ont pas pu être lues` : "une table n'a pas pu être lue");
  return parts.join(' · ');
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
    els['analysis-body'].innerHTML = unavailableMessage();
    return;
  }
  count.hidden = !ins.counts.blocking;
  count.textContent = String(ins.counts.blocking);
  count.setAttribute('aria-label', plural(ins.counts.blocking, 'point à corriger', 'points à corriger'));

  const known = new Set(state.out.tables.map((t) => t.name));
  const aclTables = new Set((state.access?.tables || []).map((t) => t.tableId));
  const MAX_CHIPS = 14;
  const card = (it, { accepted = false } = {}) => {
    const chips =
      it.targets
        .slice(0, MAX_CHIPS)
        .map((t) => {
          const text = `${esc(targetLabel(t))}${t.note ? ` · ${esc(t.note)}` : ''}`;
          if (it.area === 'access' && aclTables.has(t.table))
            return `<li><button class="chip" type="button" data-goto-access="${esc(t.table)}" title="Voir ses règles d'accès">${text}</button></li>`;
          if (known.has(t.table))
            return `<li><button class="chip" type="button" data-goto-schema="${esc(t.table)}" title="Voir sur le schéma">${text}</button></li>`;
          return `<li><span class="chip chip--plain">${text}</span></li>`;
        })
        .join('') +
      (it.targets.length > MAX_CHIPS ? `<li><span class="chip insight__more">et ${it.targets.length - MAX_CHIPS} autres</span></li>` : '');
    const intended = it.intended ? `<p class="insight__intended"><strong>Si c'est voulu :</strong> ${esc(it.intended)}</p>` : '';
    const steps = it.steps.length
      ? `<div class="insight__fix"><p class="insight__label">${it.intended ? 'Sinon, dans Grist' : 'Comment corriger dans Grist'}</p><ol>${stepsAfterIntended(
          it,
        )
          .map((x) => `<li>${esc(x)}</li>`)
          .join('')}</ol></div>`
      : '';
    const actions = [];
    if (it.area === 'access')
      actions.push(
        `<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-lock-line" type="button" data-goto-access="${esc(aclTables.has(it.targets[0]?.table) ? it.targets[0].table : '*')}">Voir les droits d'accès</button>`,
      );
    else if (it.area === 'pages')
      actions.push(
        '<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-layout-grid-line" type="button" data-goto-widgets="1">Voir les vues</button>',
      );
    else if (it.targets[0] && known.has(it.targets[0].table))
      actions.push(
        `<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-git-merge-line" type="button" data-goto-schema="${esc(it.targets[0].table)}">Voir sur le schéma</button>`,
      );
    if (it.steps.length && !accepted)
      actions.push(
        '<button class="fr-btn fr-btn--sm fr-btn--tertiary fr-btn--icon-left fr-icon-refresh-line" type="button" data-action="refresh">J\'ai corrigé, relire le document</button>',
      );
    if (it.severity === 'choice') {
      actions.push(
        accepted
          ? `<button class="fr-btn fr-btn--sm fr-btn--tertiary-no-outline fr-btn--icon-left fr-icon-close-line" type="button" data-action="unaccept" data-key="${esc(insightKey(it))}">Ne plus considérer comme voulu</button>`
          : `<button class="fr-btn fr-btn--sm fr-btn--secondary fr-btn--icon-left fr-icon-check-line" type="button" data-action="accept" data-key="${esc(insightKey(it))}">C'est voulu</button>`,
      );
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
  const textOf = (it) =>
    [it.title, it.summary, it.why, ...it.targets.map((t) => `${targetLabel(t)} ${t.note || ''}`)].join(' ').toLowerCase();
  const pool = state.level === 'accepted' ? ins.accepted : ins.items.filter((it) => state.level === 'all' || it.severity === state.level);
  const shown = pool.filter((it) => !q || textOf(it).includes(q));

  const tileCount = { all: ins.items.length, accepted: ins.accepted.length, ...ins.counts };
  const tiles = LEVEL_TILES.map(
    (t) => `<button type="button" class="tile tile--${t.id}" id="level-${t.id}" data-level="${t.id}" aria-pressed="${state.level === t.id}">
      <span class="tile__n">${tileCount[t.id] || 0}</span><span class="tile__label">${esc(t.label)}</span></button>`,
  ).join('');
  const coverage = auditCoverageText(ins.audit);
  const verdict = `<header class="verdict-block">
      <div class="verdict verdict--${ins.verdict.level}">
        <div class="verdict__icon ${ins.verdict.level === 'blocking' ? 'fr-icon-error-warning-line' : 'fr-icon-checkbox-circle-line'}" aria-hidden="true"></div>
        <div class="verdict__text"><h2 class="verdict__title">${esc(ins.verdict.title)}</h2><p class="verdict__lead">${esc(ins.verdict.text)}</p>${coverage ? `<p class="verdict__meta">${esc(coverage)}</p>` : ''}</div>
      </div>
      <div class="tiles" role="group" aria-label="Filtrer les constats par niveau">${tiles}</div>
    </header>`;

  const levelLabel = LEVEL_TILES.find((t) => t.id === state.level)?.label || 'Tout';
  const filters = [q ? `contenant « ${state.analysisFilter.trim()} »` : ''].filter(Boolean).join(', ');
  const listTitle = `${state.level === 'all' ? 'Tous les constats, du plus urgent au moins urgent' : `Constats « ${levelLabel} »`}${filters ? ` · ${filters}` : ''} (${shown.length})`;
  const list = shown.length
    ? shown.map((it) => card(it, { accepted: state.level === 'accepted' })).join('')
    : emptyState(
        `<p>${filters ? 'Aucun constat ne correspond à ces filtres.' : state.level === 'all' ? 'Rien à signaler.' : state.level === 'accepted' ? "Aucun choix confirmé. Sur une carte « Choix à confirmer », le bouton « C'est voulu » la range ici." : `Aucun point « ${esc(levelLabel)} ».`}</p>`,
      );
  els['analysis-body'].innerHTML = `<div class="view">${verdict}
    <div class="analysis">
      <div class="insights"><p class="insights__title">${esc(listTitle)}</p>${list}</div>
    </div></div>`;
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
  const body = rules
    .map(
      (r) => `<tr>
      <td class="rules__who"><strong>${esc(r.who.text)}</strong>${r.formula && r.who.kind !== 'email' ? `<code>${esc(r.formula)}</code>` : ''}${r.problems.map((p) => `<span class="rules__problem">${esc(p.text)}</span>`).join('')}</td>
      ${bits.map((b) => `<td class="rules__perm">${PERM_HTML[r.perms[b] || 'none']}</td>`).join('')}
      <td class="rules__memo">${esc(r.memo)}</td></tr>`,
    )
    .join('');
  return `<div class="table-scroll"><table class="grid-table rules"><caption class="fr-sr-only">${esc(caption)}</caption><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function accessMatches(q, ...values) {
  return (
    !q ||
    values.some((v) =>
      String(v || '')
        .toLowerCase()
        .includes(q),
    )
  );
}

const SETTING_KIND = { success: 'ok', warning: 'improve', info: 'info' };

/** Nom de fichier tiré du nom du document (sans accents ni ponctuation). */
const fileBase = () =>
  (state.docName || 'document')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'document';

/** Onglet Accès en classeur Excel : droits d'accès, toutes les règles, puis « Qui peut faire quoi ? ». */
function downloadAccessXlsx() {
  if (!state.access?.hasRules) return;
  try {
    const bytes = accessXlsx(state.access, generalSettings(state.access), matrixData(), { docName: state.docName, date: new Date() });
    downloadFile(`droits-acces-${fileBase()}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast("Classeur Excel des droits d'accès téléchargé.");
  } catch (err) {
    console.error(err);
    toast(`L'export Excel n'a pas pu être produit : ${err.message || err}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Qui peut faire quoi ? (matrice des droits par rôle métier, rôle Grist Éditeur)
// ---------------------------------------------------------------------------

let matrixCache = null; // { key, mx: buildMatrix() }
/** Matrice des droits du document (calculée une fois par lecture des règles), ou null. */
function matrixData() {
  const key = state.acl && state.schema ? [state.acl, state.schema, state.matrixAttrData] : null;
  if (!key) return null;
  if (matrixCache && matrixCache.key.every((x, i) => x === key[i])) return matrixCache.mx;
  const tables = [...state.schema.keys()].filter((t) => t && !t.startsWith('_grist'));
  matrixCache = { key, mx: buildMatrix(state.acl, tables, state.matrixAttrData) };
  return matrixCache.mx;
}

function rightsMatrixHtml() {
  const mx = matrixData();
  if (!mx || !mx.hasRules) return '';
  const { role, groups, rows, cells } = mx;
  const showCols = state.matrixDetail === 'columns';
  const shown = rows.filter((r) => r.kind !== 'column' || showCols);
  const tablesCount = rows.filter((r) => r.kind === 'table').length;
  const pick = state.matrixPick;
  const attrTable = role?.table || '';
  const cellButton = (row, gi, c, extraStyle = '') => {
    if (c.state === 'na')
      return `<div class="mx__cell${c.bit === 'R' ? ' mx__edge' : ''}"><span class="mx__na" aria-hidden="true">—</span></div>`;
    const action = ACTION_LABEL[c.bit];
    const sentence = cellSentence(c, { attrTable });
    const picked = pick && pick.row === row.key && pick.group === gi && pick.bit === c.bit;
    return `<div class="mx__cell${c.bit === 'R' || c.bit === 'S' ? ' mx__edge' : ''}"${extraStyle}><button type="button" class="mx__v mx__v--${cellTone(c)}${picked ? ' is-picked' : ''}"
      data-matrix-cell="${esc(row.key)}|${gi}|${c.bit}" title="${esc(sentence)}" aria-label="${esc(`${row.label}, ${groups[gi].name}, ${action} : ${sentence}`)}"
      aria-pressed="${picked ? 'true' : 'false'}">${esc(cellText(c))}</button></div>`;
  };
  const nCols = MATRIX_ACTIONS.length * groups.length;
  const gridVars = `--mx-cols: 14.5rem repeat(${nCols}, minmax(4rem, 1fr)); --mx-min: calc(14.5rem + ${nCols} * 4rem)`;
  const head = `<div class="mx__head">
      <div class="mx__corner">Table</div>
      ${groups.map((g) => `<div class="mx__group mx__edge"><strong>${esc(g.name)}</strong><span>${esc(g.sub)}</span></div>`).join('')}
      ${groups.map(() => MATRIX_ACTIONS.map(([bit, label]) => `<div class="mx__act${bit === 'R' ? ' mx__edge' : ''}">${esc(label)}</div>`).join('')).join('')}
    </div>`;
  const body = shown
    .map((row) => {
      const cls = row.kind === 'structure' ? ' mx__row--structure' : row.kind === 'column' ? ' mx__row--column' : '';
      // Coupure possible après chaque « _ » des noms longs (tables de résumé).
      const label = `<div class="mx__label">${esc(row.label).replace(/_/g, '_<wbr>')}${row.sub ? `<span>${esc(row.sub)}</span>` : ''}</div>`;
      const cellsHtml = groups
        .map((g, gi) =>
          row.kind === 'structure'
            ? cellButton(row, gi, cells.get(`${row.key}|${gi}|S`), ' style="grid-column: span 4"')
            : MATRIX_ACTIONS.map(([bit]) => cellButton(row, gi, cells.get(`${row.key}|${gi}|${bit}`))).join(''),
        )
        .join('');
      return `<div class="mx__row${cls}">${label}${cellsHtml}</div>`;
    })
    .join('');

  let detail = '';
  const c = pick && cells.get(`${pick.row}|${pick.group}|${pick.bit}`);
  if (c) {
    const row = rows.find((r) => r.key === pick.row);
    const g = groups[pick.group];
    const steps = cellSteps(c, pick.bit);
    detail = `<div class="mx__detail-text">
        <p class="mx__meta">${esc(g.name)} · ${esc(pick.bit === 'S' ? 'Modifier la structure' : ACTION_LABEL[pick.bit])} · rôle Grist Éditeur</p>
        <div class="mx__detail-title"><h4>${esc(row.kind === 'column' ? `${row.table}.${row.label}` : row.label)}</h4><span class="mx__v mx__v--${cellTone(c)} mx__v--static">${esc(cellText(c))}</span></div>
        <p class="mx__sentence">${strongWords(cellSentence(c, { attrTable }), c.labels || [])}</p>
        <p class="sec__hint">Ordre appliqué : règles de la colonne, puis de la table, puis du document ; la première qui s'applique décide, action par action.</p>
        <div class="mx__actions">${row.table ? `<button type="button" class="fr-btn fr-btn--sm fr-btn--tertiary" data-goto-access="${esc(row.table)}">Voir les règles de ${esc(row.table)}</button>` : ''}
          <button type="button" class="fr-btn fr-btn--sm fr-btn--tertiary" data-matrix-close="1">Fermer</button></div>
      </div>
      <ol class="mx__steps">${steps
        .map(
          (st, i) => `<li class="mx__step${st.off ? ' mx__step--off' : ''}"><span class="mx__step-n">${i + 1}</span>
        <div><strong>${esc(st.title)}</strong><code>${esc(st.condition)}</code></div>${badge(st.badge, st.tone)}</li>`,
        )
        .join('')}</ol>`;
  }
  return `${sectionHead('Qui peut faire quoi ?', {
    count: tablesCount,
    hint: 'Pour chaque rôle métier, ce que permettent les règles. Une case verte qui nomme une colonne : oui, mais seulement sur les lignes où cette colonne correspond à la personne.',
  })}
    <div class="card mx">
      <div class="mx__bar"><span class="mx__bar-label" id="mx-detail-label">Niveau de détail</span>
        <div class="seg-toggle" role="group" aria-labelledby="mx-detail-label">
          <button type="button" data-matrix-detail="tables" aria-pressed="${!showCols}">Par table</button>
          <button type="button" data-matrix-detail="columns" aria-pressed="${showCols}">Par table et par colonne</button>
        </div>
</div>
      <div class="mx__scroll" role="region" aria-label="Droits par rôle métier et par action" tabindex="0" style="${gridVars}">${head}${body}</div>
      <div class="mx__detail" aria-live="polite"${detail ? '' : ' hidden'}>${detail}</div>
    </div>
    <p class="sec__hint mx__foot">Lecture des règles, sans connexion réelle : pour un cas sensible, vérifiez avec « Voir en tant que » dans Grist.</p>`;
}

/** Texte échappé, les noms de colonnes qui décident mis en gras. */
function strongWords(text, words) {
  let html = esc(text);
  for (const w of [...new Set(words)].sort((a, b) => b.length - a.length)) {
    const e = esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(^|[^\\wÀ-ÿ])(${e})(?![\\wÀ-ÿ])`, 'g'), '$1<strong>$2</strong>');
  }
  return html;
}

/** Redessine la matrice seule (sans toucher au reste de l'onglet ni au défilement). */
function refreshMatrix(focusSelector) {
  const el = $('rights-matrix');
  if (!el) return;
  const scroll = el.querySelector('.mx__scroll');
  const pos = scroll ? [scroll.scrollLeft, scroll.scrollTop] : null;
  el.innerHTML = rightsMatrixHtml();
  const next = el.querySelector('.mx__scroll');
  if (pos && next) [next.scrollLeft, next.scrollTop] = pos;
  if (focusSelector) el.querySelector(focusSelector)?.focus();
}

/**
 * Réglages généraux : permissions avancées activées ou non, puis les trois cases de la page
 * « Règles d'accès » de Grist (version open source), comme elles y sont libellées.
 */
function settingsSectionHtml(a) {
  const all = generalSettings(a);
  const seed = all.find((x) => x.id === 'seed');
  // Règle pour les propriétaires non cochée : une invitation à l'activer, au-dessus des réglages.
  const invite =
    a.hasRules && !seed.on
      ? `<div class="fr-alert fr-alert--warning fr-alert--sm owner-invite" data-setting="seed">
      <h3 class="fr-alert__title">Activez « ${esc(seed.name)} »</h3>
      <p>Les nouvelles règles de table ne donnent pas d’office tous les droits aux propriétaires. C’est une bonne pratique de cocher cette case dans les règles spéciales de Grist : les propriétaires gardent toujours la main sur tout le document.</p>
      <p class="owner-invite__why">Cette vue en a aussi besoin : elle lit le document avec les droits de la personne qui l’ouvre. Là où un propriétaire n’a pas tous les droits, l’audit ne voit pas toutes les données (voir le constat dans « Analyse »).</p></div>`
      : '';
  return `${invite}<section>${sectionHead('Réglages généraux', { hint: 'Valables pour tout le document, quelles que soient les tables.' })}
    <div class="card">${all
      .filter((x) => !(invite && x.id === 'seed'))
      .map(
        (x) => `<div class="settings-row" data-setting="${x.id}"><p class="settings-row__name">${esc(x.name)}</p>
      <p class="settings-row__state">${badge(x.state, SETTING_KIND[x.level])}</p><p class="settings-row__text">${esc(x.text)}</p></div>`,
      )
      .join('')}</div></section>`;
}

function renderAccess() {
  const body = els['access-body'];
  if (!state.out) {
    body.innerHTML = unavailableMessage();
    return;
  }
  const a = state.access;
  els['btn-access-csv'].disabled = !a || !a.hasRules;
  if (!a) {
    body.innerHTML = emptyState(
      "<p>Les règles d'accès du document n'ont pas pu être lues. Seuls les propriétaires du document (ou les personnes autorisées à voir les droits d’accès) peuvent les consulter.</p>",
    );
    return;
  }
  if (!a.hasRules) {
    body.innerHTML = `<div class="view">${pageHeader({
      title: "Aucune règle d'accès avancée",
      lead: 'Chaque personne invitée voit et modifie tout le document selon son rôle de partage : propriétaire, éditeur ou lecteur.',
    })}<p class="sec__hint">Pour restreindre une table, une colonne ou certaines lignes, ouvrez « Règles d'accès » dans le menu de gauche de Grist.</p>${settingsSectionHtml(a)}</div>`;
    return;
  }
  const q = state.accessFilter.trim().toLowerCase();
  const ruleMatches = (r) => accessMatches(q, r.formula, r.who.text, r.memo);

  const header = pageHeader({
    title: "Règles d'accès avancées",
    lead: 'Qui peut lire, modifier, créer et supprimer, table par table puis colonne par colonne.',
    kpis: [
      { value: a.ruleCount, label: a.ruleCount > 1 ? 'conditions de droits d’accès' : 'condition de droits d’accès' },
      { value: a.tables.length, label: a.tables.length > 1 ? 'tables protégées' : 'table protégée' },
      { value: a.attributes.length, label: a.attributes.length > 1 ? 'attributs' : 'attribut' },
      { value: a.rowRules, label: a.rowRules > 1 ? 'conditions par ligne' : 'condition par ligne' },
    ],
  });

  const settingsHtml = settingsSectionHtml(a);

  const attrs = a.attributes.length
    ? `<section>${sectionHead('Attributs utilisateur', {
        count: a.attributes.length,
        hintHtml:
          "Un attribut retrouve la personne connectée dans une table ; les conditions l'utilisent sous la forme <code>user.Nom.Colonne</code>.",
      })}
    <div class="card"><div class="table-scroll"><table class="grid-table rules"><caption class="fr-sr-only">Attributs utilisateur</caption>
      <thead><tr><th scope="col">Attribut</th><th scope="col">Cherché dans</th><th scope="col">En comparant à</th><th scope="col">État</th></tr></thead>
      <tbody>${a.attributes
        .map(
          (
            x,
          ) => `<tr><td><code>user.${esc(x.name)}</code></td><td>${esc(x.tableId)}.${esc(x.lookupColId)}</td><td><code>user.${esc(x.charId)}</code></td>
        <td>${x.problems.length ? badge(x.problems.join(', '), 'blocking') : badge('Correct', 'ok')}</td></tr>`,
        )
        .join('')}</tbody></table></div></div></section>`
    : '';

  const defaults = a.defaults.filter(ruleMatches);
  const defaultsHtml = defaults.length
    ? `<section>${sectionHead('Droits d’accès par défaut', { count: defaults.length, hint: "Elles s'appliquent à toutes les tables, après les droits d’accès propres à chaque table." })}
    <div class="card">${rulesTableHtml(defaults, BITS.defaults, 'Droits d’accès par défaut')}</div></section>`
    : '';

  const known = new Set(state.out.tables.map((t) => t.name));
  const cards = [];
  for (const t of a.tables) {
    const tableHit = accessMatches(q, t.tableId);
    const rules = tableHit ? t.rules : t.rules.filter(ruleMatches);
    const cols = t.columns
      .map((c) => ({ ...c, rules: tableHit || accessMatches(q, c.colIds.join(' ')) ? c.rules : c.rules.filter(ruleMatches) }))
      .filter((c) => c.rules.length);
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
    hint: "Les droits d’accès s'appliquent de haut en bas : la première dont la condition est remplie décide, permission par permission. « — » : aucun droit n’est décidé ici pour cette action, la condition suivante s’applique.",
  })}<div class="cards">${cards.join('') || emptyState(q ? `<p>Aucun droit d’accès ne contient « ${esc(state.accessFilter)} ».</p>` : "<p>Aucune table n'a de règle propre.</p>")}</div></section>`;

  body.innerHTML = `<div class="view">${header}${q ? '' : `<section id="rights-matrix">${rightsMatrixHtml()}</section>`}${q ? '' : settingsHtml}${q ? '' : attrs}${defaultsHtml}${tablesHtml}</div>`;
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

const WIDGET_KIND = { external: ['Externe', 'improve'], document: ['Dans le document', ''], self: ['Cette vue', 'ok'] };

function renderWidgets() {
  const body = els['widgets-body'];
  els['btn-widgets-xlsx'].disabled = !state.out || !state.pages;
  if (!state.out) {
    body.innerHTML = unavailableMessage();
    return;
  }
  const m = state.pages;
  if (!m) {
    body.innerHTML = emptyState("<p>Les pages du document n'ont pas pu être lues.</p>");
    return;
  }
  const known = new Set(state.out.tables.map((t) => t.name));
  const q = state.widgetsFilter.trim().toLowerCase();
  const hit = (w) =>
    !q ||
    [w.title, w.page, w.table, w.typeLabel, w.custom?.name, w.custom?.host, w.custom?.author].some((v) =>
      String(v || '')
        .toLowerCase()
        .includes(q),
    );
  const show = (kind) => state.wkind === 'all' || state.wkind === kind;
  const unofficial = m.unofficial.filter(hit);
  const gallery = m.gallery.filter(hit);
  const views = m.views.filter(hit);

  const tableChip = (t) =>
    known.has(t)
      ? `<button class="chip" type="button" data-goto-table="${esc(t)}">${esc(t)}</button>`
      : `<span class="chip chip--plain">${esc(t)}</span>`;
  const where = (w) =>
    `<p class="widget-where">Page <span class="chip chip--plain">${esc(w.page || '(sans nom)')}</span>${w.table ? ` · table ${tableChip(w.table)}${w.summary ? ' (synthèse)' : ''}` : ''}${w.linkedTo ? ` · suit « ${esc(w.linkedTo)} »` : ''}</p>`;
  const columnsList = (c) => {
    const lines = columnLines(c);
    return lines.length
      ? `<ul class="widget-cols">${lines.map((l) => `<li${l.missing ? ' class="widget-cols--missing"' : ''}><span class="widget-cols__field">${esc(l.field)}</span> <span aria-hidden="true">→</span> ${l.missing ? 'à associer' : `<strong>${esc(l.column)}</strong>`}</li>`).join('')}</ul>`
      : '<span class="widget-cols__none">Aucune colonne à associer</span>';
  };
  const accessText = (c) =>
    c.access === 'full' && c.origin === 'external' ? badge(ACCESS_LABELS.full, 'improve') : esc(ACCESS_LABELS[c.access] || c.access || '—');
  const card = (w, badges, rows) => `<article class="card widget-card">
      <header class="card__head"><h4 class="card__title">${esc(w.title || w.custom?.name || 'Vue personnalisée')}</h4>${badges.join('')}</header>
      <div class="card__body">${where(w)}<dl class="widget-props">${rows
        .filter(Boolean)
        .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
        .join('')}</dl></div></article>`;

  const unofficialCards = unofficial
    .map((w) => {
      const c = w.custom;
      const [label, kind] = WIDGET_KIND[c.origin] || ['Non officiel', ''];
      return card(
        w,
        [badge(label, kind)],
        [
          ['Origine', esc(originText(c))],
          ['Accès', accessText(c)],
          columnLines(c).length ? ['Colonnes', columnsList(c)] : null,
          c.url && c.origin !== 'document' ? ['Adresse', `<span class="widget-url">${esc(c.url)}</span>`] : null,
          w.description ? ['Description', esc(w.description)] : null,
        ],
      );
    })
    .join('');
  const galleryCards = gallery
    .map((w) => {
      const c = w.custom;
      const badges = [];
      if (c.missingColumns?.length)
        badges.push(badge(plural(c.missingColumns.length, 'champ à associer', 'champs à associer'), 'blocking'));
      if (!c.maintained) badges.push(badge(`Communauté${c.author ? ` · ${c.author}` : ''}`, 'choice'));
      return card(w, badges, [
        ['Accès', accessText(c)],
        ['Colonnes', columnsList(c)],
      ]);
    })
    .join('');

  let lastPage = null;
  const viewRows = views
    .map((w) => {
      const first = w.page !== lastPage;
      lastPage = w.page;
      return `<tr><td>${first ? `<strong>${esc(w.page || '(sans nom)')}</strong>` : ''}</td><td>${esc(w.title || w.table || w.typeLabel)}${w.description ? `<span class="col-label">${esc(w.description)}</span>` : ''}</td>
      <td>${esc(w.typeLabel)}</td><td>${w.table ? tableChip(w.table) : ''}${w.summary ? ' <span class="col-label">synthèse</span>' : ''}</td><td>${w.linkedTo ? esc(w.linkedTo) : '<span class="perm--none">—</span>'}</td></tr>`;
    })
    .join('');

  const sections = [];
  if (show('unofficial')) {
    sections.push(`<section>${sectionHead('Vues non officielles', { count: unofficial.length, hint: 'Ajoutés par leur adresse ou créés dans le document, hors de la galerie de Grist.' })}
      ${unofficialCards ? `<div class="cards-grid">${unofficialCards}</div>` : `<p class="empty empty--inline">${q ? 'Aucune vue non officielle ne correspond.' : 'Aucune vue non officielle dans ce document.'}</p>`}</section>`);
  }
  if (show('gallery')) {
    sections.push(`<section>${sectionHead('Vues personnalisées', { count: gallery.length, hint: "Choisis dans la galerie de Grist : l'accès accordé et la colonne associée à chaque champ attendu." })}
      ${galleryCards ? `<div class="cards-grid">${galleryCards}</div>` : `<p class="empty empty--inline">${q ? 'Aucune vue de la galerie ne correspond.' : 'Aucune vue de la galerie dans ce document.'}</p>`}</section>`);
  }
  if (show('views')) {
    sections.push(`<section>${sectionHead('Fiches, listes, graphiques et formulaires', { count: views.length, hint: 'Les vues classiques autres que les tableaux, avec la vue dont elles suivent la sélection.' })}
      ${
        viewRows
          ? `<div class="card"><div class="table-scroll"><table class="grid-table"><caption class="fr-sr-only">Fiches, listes, graphiques et formulaires</caption>
        <thead><tr><th scope="col">Page</th><th scope="col">Vue</th><th scope="col">Type</th><th scope="col">Table</th><th scope="col">Suit la sélection de</th></tr></thead><tbody>${viewRows}</tbody></table></div></div>`
          : `<p class="empty empty--inline">${q ? 'Aucune vue ne correspond.' : 'Aucune autre vue que des tableaux.'}</p>`
      }</section>`);
  }
  if (state.wkind === 'all' && !q && (m.tableOnlyPages.length || m.tablesWithoutPage.length)) {
    const rows = [];
    if (m.tableOnlyPages.length) {
      rows.push(`<details class="rest-row"><summary class="fr-icon-arrow-right-line"><strong>${esc(plural(m.tableOnlyPages.length, 'page', 'pages'))}</strong> ${m.tableOnlyPages.length > 1 ? 'ne contiennent' : 'ne contient'} que des tableaux<span class="rest-row__hint">Afficher la liste</span></summary>
        <ul class="chips">${m.tableOnlyPages.map((p) => `<li><span class="chip chip--plain">${esc(p)}</span></li>`).join('')}</ul></details>`);
    }
    if (m.tablesWithoutPage.length) {
      rows.push(`<details class="rest-row" open><summary class="fr-icon-arrow-right-line"><strong>${esc(plural(m.tablesWithoutPage.length, 'table', 'tables'))}</strong> ${m.tablesWithoutPage.length > 1 ? 'ne sont affichées' : "n'est affichée"} sur aucune page ${badge('Choix à confirmer', 'choice')}</summary>
        <ul class="chips">${m.tablesWithoutPage.map((t) => `<li>${tableChip(t)}</li>`).join('')}</ul></details>`);
    }
    sections.push(
      `<section>${sectionHead('Le reste', { hint: 'Pour ne rien oublier, sans encombrer la page.' })}<div class="card">${rows.join('')}</div></section>`,
    );
  }

  const header = pageHeader({
    title: 'Vues',
    lead: "Tout ce qui n'est pas un tableau : vues personnalisées, fiches, listes, graphiques et formulaires.",
    kpis: [
      { value: m.unofficial.length, label: 'non officiels' },
      { value: m.gallery.length, label: 'de la galerie' },
      { value: m.views.length, label: m.views.length > 1 ? 'autres vues' : 'autre vue' },
      { value: m.tableWidgetCount, label: 'tableaux, non détaillés' },
    ],
  });
  body.innerHTML = `<div class="view">${header}${sections.join('')}</div>`;
}

function gotoAccess(table) {
  if (state.accessFilter) {
    state.accessFilter = '';
    els['access-filter'].value = '';
  }
  renderAccess();
  renderWidgets();
  selectTab('access');
  const el = table && table !== '*' ? $(aclSlug(table)) : null;
  if (!el) {
    els['access-body'].scrollTop = 0;
    return;
  }
  scrollWithin(el);
  flash(el);
}

// ---------------------------------------------------------------------------
// Rapport Word
// ---------------------------------------------------------------------------

/**
 * « Contenu du rapport », sur le modèle de la liste des tables : une case pour inclure la section,
 * son nom pour y aller dans l'aperçu, son numéro dans le rapport. La section lue est mise en avant.
 */
let reportSectionsHtml = ''; // dernière liste rendue
function renderReportSections() {
  let n = 0;
  const html = REPORT_SECTIONS.map((r) => {
    const on = state.reportSections.has(r.id);
    const num = on ? `${++n}.` : '—';
    return `<li class="report-index__item${on ? '' : ' is-off'}" data-report-item="${r.id}">
      <input type="checkbox" id="report-sec-${r.id}" data-section="${r.id}"${on ? ' checked' : ''} aria-label="Inclure « ${esc(r.title)} » dans le rapport">
      <button type="button" data-report-goto="${r.id}" title="${esc(r.description)}"><span class="tables-index__name">${esc(r.title)}</span><span>${num}</span></button>
    </li>`;
  }).join('');
  // La liste n'est reconstruite que si elle change, et l'élément actif garde le focus (clavier).
  const list = els['report-sections'];
  if (reportSectionsHtml !== html) {
    const active = list.contains(document.activeElement) ? document.activeElement : null;
    const again = active?.id
      ? `#${CSS.escape(active.id)}`
      : active?.dataset.reportGoto
        ? `[data-report-goto="${active.dataset.reportGoto}"]`
        : null;
    list.innerHTML = html;
    reportSectionsHtml = html;
    if (again) list.querySelector(again)?.focus();
  }
  els['report-count'].textContent = `${state.reportSections.size}/${REPORT_SECTIONS.length}`;
  els['report-count'].setAttribute('aria-label', `${state.reportSections.size} sections sur ${REPORT_SECTIONS.length}`);
  els['btn-docx'].disabled = !state.out || state.dataLoading || !state.reportSections.size;
}

/**
 * Image du schéma pour le rapport, dessinée hors écran : vue « Relations », références seules,
 * sans les tables de synthèse, disposition recalculée aux proportions d'une page A4 en portrait.
 * Elle ne dépend pas des réglages de l'écran (liens, types de tables, positions).
 */
async function schemaSnapshot() {
  const out = state.out;
  const key = JSON.stringify([
    aclTableNames(),
    out.tables.map((t) => [t.name, t.kind, t.columns.map((c) => [c.name, c.base, c.isFormula, c.ref])]),
  ]);
  if (state.snapshot?.key === key) return state.snapshot;
  const host = document.createElement('div');
  host.className = 'snapshot-host';
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  const v = new ErdViewer(host);
  try {
    await v.setData(
      out.tables.filter((t) => t.kind !== 'summary'),
      { detail: 'keys', aclTables: aclTableNames(), ghosts: false, aspectRatio: 0.8 },
    );
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
    stats: state.stats,
    tables: state.out.tables,
    insights: state.insights,
    access: state.access,
    matrix: matrixData(),
    schemaSummaries: state.out.tables.some((t) => t.kind === 'summary'),
    profiles: state.profiles,
    pages: state.pages,
    dbml: state.out.dbml,
    schema,
  };
}

let reportIndexFrame = 0;
/** Met en avant, dans « Contenu du rapport », la section en haut de l'aperçu. */
function updateReportIndex() {
  const box = els['report-body'].closest('.page__body');
  const heads = [...els['report-body'].querySelectorAll('[data-report-section]')];
  let current = heads[0]?.dataset.reportSection;
  const top = box.getBoundingClientRect().top + 24;
  for (const h of heads) {
    if (h.getBoundingClientRect().top <= top) current = h.dataset.reportSection;
    else break;
  }
  for (const li of els['report-sections'].querySelectorAll('[data-report-item]'))
    li.classList.toggle('is-current', li.dataset.reportItem === current);
}

let reportSeq = 0;
// L'aperçu n'est remplacé que s'il change : un second rendu identique (onglet rouvert, schéma déjà
// en cache) garde la position de lecture et les éléments de la page.
let reportBodyHtml = '';
function setReportBody(html) {
  if (html === reportBodyHtml && els['report-body'].firstElementChild) return false;
  reportBodyHtml = html;
  els['report-body'].innerHTML = html;
  return true;
}

async function renderReport() {
  renderReportSections();
  if (!state.out || state.dataLoading) {
    setReportBody(unavailableMessage());
    return;
  }
  if (!state.reportSections.size) {
    setReportBody(emptyState('<p>Choisissez au moins une section à inclure.</p>'));
    return;
  }
  const seq = ++reportSeq;
  const draw = (schema) => {
    // L'image du schéma est posée après coup : son arrivée ne reconstruit pas tout l'aperçu.
    const blocks = buildReport(reportContext(schema), [...state.reportSections]);
    setReportBody(`<article class="doc" aria-label="Aperçu du rapport">${renderHtml(blocks, { imageUrl: () => '' })}</article>`);
    const url = schema?.url || '';
    for (const img of els['report-body'].querySelectorAll('.doc__figure img'))
      if (img.getAttribute('src') !== url) img.setAttribute('src', url);
    updateReportIndex();
  };
  const needsSchema = state.reportSections.has('schema');
  // En attendant le dessin du schéma : la place de l'image (le dernier dessin s'il y en a un).
  draw(needsSchema ? state.snapshot || { url: '' } : null);
  if (needsSchema) {
    try {
      const snap = await schemaSnapshot();
      if (seq === reportSeq) draw(snap);
    } catch (err) {
      console.error(err);
      if (seq === reportSeq) draw(null);
    }
  }
}

async function downloadReport() {
  if (!state.out || !state.insights) return;
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
    downloadFile(`structure-${fileBase()}.docx`, blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
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
const DIAGRAM_CONTROLS = [
  'btn-zoom-in',
  'btn-zoom-out',
  'btn-zoom-fit',
  'btn-relayout',
  'btn-png',
  'btn-kinds',
  'show-kind-table',
  'show-kind-summary',
  'show-kind-acl',
  'btn-links',
  'show-refs',
  'show-lookups',
  'show-calc',
  'find-table',
  'detail-all',
  'detail-keys',
  'detail-tables',
];

function ensureViewer() {
  if (viewer) return viewer;
  els['schema-body'].innerHTML = '';
  viewer = new ErdViewer(els['schema-body'], {
    onViewChange: (view) => {
      els['zoom-value'].textContent = `${Math.round(view.k * 100)} %`;
    },
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
  for (const t of LINK_TOGGLES) els[`show-${t.key}`].checked = linkShown(t);
  for (const k of TABLE_KINDS) els[`show-kind-${k}`].checked = shownKinds().includes(k);
  updateLinksMenu();
  updateKindsMenu();
  body.classList.add('no-minimap');
  if (!out || !out.tables.length) {
    viewer?.destroy();
    viewer = null;
    state.diagramKey = null;
    body.innerHTML = out ? emptyState('<p>Ce document ne contient aucune table.</p>') : unavailableMessage();
    updateDiagramControls(false);
    return Promise.resolve();
  }
  const lookups = documentLookups();
  const calc = documentFormulaDeps();
  const key = JSON.stringify([
    aclTableNames(),
    out.tables.map((t) => [t.name, t.kind, t.columns.map((c) => [c.name, c.base, c.isFormula, c.ref])]),
    lookups,
    calc,
  ]);
  if (key === state.diagramKey && viewer) return diagramReady;
  state.diagramKey = key;
  const v = ensureViewer();
  updateDiagramControls(true);
  els['find-table-list'].innerHTML = out.tables.map((t) => `<option value="${esc(t.name)}"></option>`).join('');
  diagramReady = v
    .setData(out.tables, { positions: state.diagram.positions, detail: state.diagram.detail, aclTables: aclTableNames() })
    .then(() => {
      v.setRefs(state.diagram.refs !== false);
      return v.setLookups(lookups, state.diagram.lookups !== false);
    })
    .then(() => v.setCalc(calc, state.diagram.calc === true))
    .then(() => v.setKinds(shownKinds()))
    .catch((err) => {
      console.error(err);
      toast(`Le schéma n'a pas pu être dessiné : ${err.message || err}`, 'error');
    });
  return diagramReady;
}

/** Tables de droits : celles où les règles d'accès cherchent la personne (attributs utilisateur). */
function aclTableNames() {
  return [...new Set((state.access?.attributes || []).map((a) => a.tableId).filter(Boolean))];
}

/** Menu « Liens » : compte des liens affichés et précisions sous chaque bascule. */
/**
 * Bascules du menu « Liens » : clé dans state.diagram (et dans les options), réglage par défaut,
 * application au schéma, nombre affiché sous le libellé.
 */
const LINK_TOGGLES = [
  {
    key: 'refs',
    byDefault: true,
    apply: (v, on) => v.setRefs(on),
    sub: 'Colonnes de type Référence',
    count: () => (state.stats ? state.stats.relations : 0),
  },
  {
    key: 'lookups',
    byDefault: true,
    apply: (v, on) => v.setLookups(documentLookups(), on),
    sub: 'lookupOne (orange) et lookupRecords (vert)',
    count: () => new Set(documentLookups().map((l) => [l.source, l.column, l.target, l.kind].join('\u0000'))).size,
  },
  {
    key: 'calc',
    byDefault: false,
    apply: (v, on) => v.setCalc(documentFormulaDeps(), on),
    sub: 'Colonnes lues par les formules',
    count: () => new Set(documentFormulaDeps().map((l) => `${l.source}\u0000${l.column}`)).size,
  },
];
/** La bascule est-elle active ? (option absente : réglage par défaut) */
const linkShown = (t) => (t.byDefault ? state.diagram[t.key] !== false : state.diagram[t.key] === true);

function updateLinksMenu() {
  els['links-count'].textContent = `${LINK_TOGGLES.filter(linkShown).length}/${LINK_TOGGLES.length}`;
  for (const t of LINK_TOGGLES) els[`show-${t.key}-sub`].textContent = `${t.sub} · ${state.out ? t.count() : 0}`;
}

/** Types de tables cochés dans le menu « Tables ». */
function shownKinds() {
  const k = state.diagram.kinds || {};
  return TABLE_KINDS.filter((x) => k[x] !== false);
}

/** Type d'une table sur le schéma : synthèse, table de droits ou table. */
function tableKind(t, acl = new Set(aclTableNames())) {
  return t.kind === 'summary' ? 'summary' : acl.has(t.name) ? 'acl' : 'table';
}

/** Menu « Tables » : nombre de tables de chaque type et types affichés. */
function updateKindsMenu() {
  const acl = new Set(aclTableNames());
  const counts = { table: 0, summary: 0, acl: 0 };
  for (const t of state.out?.tables || []) counts[tableKind(t, acl)] += 1;
  els['kinds-count'].textContent = `${shownKinds().length}/3`;
  els['show-kind-table-sub'].textContent = `Tables de données · ${counts.table}`;
  els['show-kind-summary-sub'].textContent = `Regroupements calculés par Grist · ${counts.summary}`;
  els['show-kind-acl-sub'].textContent = `Utilisées par les règles d'accès · ${counts.acl}`;
}

const MENUS = { links: ['btn-links', 'links-menu'], kinds: ['btn-kinds', 'kinds-menu'] };
/** Ouvre un menu de la barre du schéma (et ferme l'autre), ou les ferme tous. */
function setMenu(name, open) {
  for (const [key, [btn, menu]] of Object.entries(MENUS)) {
    const on = open && key === name;
    els[menu].hidden = !on;
    els[btn].setAttribute('aria-expanded', String(on));
  }
}

let lookupsCache = null;
/** Lookups des formules du document (calculés une fois par lecture de la structure). */
function documentLookups() {
  if (!state.out) return [];
  if (lookupsCache?.out !== state.out) lookupsCache = { out: state.out, list: findLookups(state.out.tables, state.schema) };
  return lookupsCache.list;
}

let formulaDepsCache = null;
/** Liens des calculs : de chaque colonne calculée vers les colonnes que sa formule lit. */
function documentFormulaDeps() {
  if (!state.out) return [];
  if (formulaDepsCache?.out !== state.out) formulaDepsCache = { out: state.out, list: findFormulaDeps(state.out.tables) };
  return formulaDepsCache.list;
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
  box.scrollTop += block === 'center' ? r.top - c.top - (c.height - r.height) / 2 : r.top - c.top - 12;
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

/** Branche les contrôles de la page, onglet par onglet (l'ordre d'enregistrement compte pour les écouteurs du document). */
function bindEvents() {
  els['btn-refresh'].addEventListener('click', () => loadSchema({ manual: true }));

  bindTablesEvents();
  bindAccessEvents();
  bindTablesIndexEvents();
  bindWidgetsEvents();
  bindAnalysisEvents();
  bindReportEvents();
  bindSchemaEvents();
  bindTabsEvents();
  bindMatrixKeys();
  bindDynamicActions();
}

/** Onglet Tables : filtre, colonnes affichées, export Excel. */
function bindTablesEvents() {
  // Tables
  els['filter-input'].addEventListener(
    'input',
    debounce(() => {
      state.filter = els['filter-input'].value;
      renderTables();
    }, 120),
  );
  for (const id of ['cols-all', 'cols-refs', 'cols-formulas']) {
    els[id].addEventListener('change', () => {
      if (els[id].checked) {
        state.cols = els[id].value;
        renderTables();
      }
    });
  }
  els['btn-csv'].addEventListener('click', () => {
    if (!state.out) return;
    downloadFile(
      `tables-${fileBase()}.xlsx`,
      tablesXlsx(state.out.tables, { docName: state.docName, date: new Date() }),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    toast('Classeur Excel des tables téléchargé.');
  });
}

/** Onglet Accès : filtre et export Excel des règles. */
function bindAccessEvents() {
  // Droits d'accès
  els['access-filter'].addEventListener(
    'input',
    debounce(() => {
      state.accessFilter = els['access-filter'].value;
      renderAccess();
    }, 120),
  );
  els['btn-access-csv'].addEventListener('click', downloadAccessXlsx);
  els['btn-widgets-xlsx'].addEventListener('click', () => {
    if (!state.pages) return;
    try {
      downloadFile(
        `vues-${fileBase()}.xlsx`,
        viewsXlsx(state.pages, { docName: state.docName, date: new Date() }),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      toast('Classeur Excel des vues téléchargé.');
    } catch (err) {
      console.error(err);
      toast(`L'export Excel n'a pas pu être produit : ${err.message || err}`, 'error');
    }
  });
}

/** Onglet Tables : l'index suit le défilement. */
function bindTablesIndexEvents() {
  // Tables : index qui suit le défilement
  els['tables-body'].addEventListener(
    'scroll',
    () => {
      if (!tablesIndexFrame)
        tablesIndexFrame = requestAnimationFrame(() => {
          tablesIndexFrame = 0;
          updateTablesIndex();
        });
    },
    { passive: true },
  );
}

/** Onglet Vues : filtre et types de vues. */
function bindWidgetsEvents() {
  // Widgets
  els['widgets-filter'].addEventListener(
    'input',
    debounce(() => {
      state.widgetsFilter = els['widgets-filter'].value;
      renderWidgets();
    }, 120),
  );
  for (const id of ['wkind-all', 'wkind-unofficial', 'wkind-gallery', 'wkind-views']) {
    els[id].addEventListener('change', () => {
      if (els[id].checked) {
        state.wkind = els[id].value;
        renderWidgets();
      }
    });
  }
}

/** Onglet Analyse : recherche. */
function bindAnalysisEvents() {
  // Analyse : niveau (tuiles), recherche, règles métier
  els['analysis-filter'].addEventListener(
    'input',
    debounce(() => {
      state.analysisFilter = els['analysis-filter'].value;
      renderAnalysis();
    }, 120),
  );
}

/** Onglet Rapport : sections, index, téléchargement. */
function bindReportEvents() {
  // Rapport
  els['report-sections'].addEventListener('change', (ev) => {
    const box = ev.target.closest('[data-section]');
    if (!box) return;
    if (box.checked) state.reportSections.add(box.dataset.section);
    else state.reportSections.delete(box.dataset.section);
    renderReport();
  });
  els['report-sections'].addEventListener('click', async (ev) => {
    const go = ev.target.closest('[data-report-goto]');
    if (!go) return;
    const id = go.dataset.reportGoto;
    // Section non incluse : un clic sur son nom l'ajoute, puis l'aperçu s'y place.
    if (!state.reportSections.has(id)) {
      state.reportSections.add(id);
      await renderReport();
    }
    const el = els['report-body'].querySelector(`[data-report-section="${id}"]`);
    if (el) {
      scrollWithin(el);
      flash(el);
    }
  });
  els['report-body'].closest('.page__body').addEventListener(
    'scroll',
    () => {
      if (!reportIndexFrame)
        reportIndexFrame = requestAnimationFrame(() => {
          reportIndexFrame = 0;
          updateReportIndex();
        });
    },
    { passive: true },
  );
  els['btn-docx'].addEventListener('click', downloadReport);
}

/** Onglet Schéma : zoom, disposition, vues, recherche, export, menus Tables et Liens. */
function bindSchemaEvents() {
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
      state.diagram = { ...state.diagram, detail: els[id].value, detailChosen: true };
      viewer?.setDetail(els[id].value);
      saveDiagramSoon();
    });
  }
  const findTable = () => {
    const name = els['find-table'].value.trim();
    if (!viewer || !name) return;
    const match = [...viewer.nodes.keys()].find((id) => id.toLowerCase() === name.toLowerCase());
    if (match) {
      viewer.focusTable(match);
      els['find-table'].value = '';
    }
  };
  els['find-table'].addEventListener('change', findTable);
  els['find-table'].addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      findTable();
    }
  });
  els['btn-png'].addEventListener('click', async () => {
    if (!viewer) return;
    try {
      downloadFile(`schema-${fileBase()}.png`, await viewer.toPng(2), 'image/png');
    } catch (err) {
      console.error(err);
      toast(`L'image n'a pas pu être produite : ${err.message || err}`, 'error');
    }
  });
  for (const [name, [btn, menu]] of Object.entries(MENUS)) {
    els[btn].addEventListener('click', () => setMenu(name, els[menu].hidden));
    els[menu].addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        setMenu(name, false);
        els[btn].focus();
      }
    });
  }
  document.addEventListener('click', (ev) => {
    const inside = ev.target.closest('.links');
    for (const [name, [, menu]] of Object.entries(MENUS))
      if (!els[menu].hidden && !els[menu].parentElement.contains(inside)) setMenu(name, false);
  });
  for (const k of TABLE_KINDS) {
    els[`show-kind-${k}`].addEventListener('change', () => {
      state.diagram = { ...state.diagram, kinds: { ...(state.diagram.kinds || {}), [k]: els[`show-kind-${k}`].checked } };
      viewer?.setKinds(shownKinds());
      updateKindsMenu();
      saveDiagramSoon();
    });
  }
  for (const t of LINK_TOGGLES) {
    els[`show-${t.key}`].addEventListener('change', () => {
      state.diagram = { ...state.diagram, [t.key]: els[`show-${t.key}`].checked };
      if (viewer) t.apply(viewer, state.diagram[t.key]);
      updateLinksMenu();
      saveDiagramSoon();
    });
  }
}

/** Onglets : clic et clavier. */
function bindTabsEvents() {
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
      if (next) {
        ev.preventDefault();
        selectTab(next, { focus: true });
      }
    });
  }
}

/** Matrice des droits : clavier. */
function bindMatrixKeys() {
  // Matrice des droits : flèches d'une case à l'autre, Échap referme le détail
  document.addEventListener('keydown', (ev) => {
    const cellBtn = ev.target.closest?.('#rights-matrix [data-matrix-cell]');
    if (ev.key === 'Escape' && state.matrixPick && ev.target.closest?.('#rights-matrix')) {
      ev.preventDefault();
      $('rights-matrix').querySelector('[data-matrix-close]')?.click();
      return;
    }
    const move = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[ev.key];
    if (!cellBtn || !move) return;
    // Grille des boutons : une ligne par ligne affichée, 4 positions par groupe (la case de structure les occupe toutes).
    const bits = MATRIX_ACTIONS.map(([b]) => b);
    const grid = [...$('rights-matrix').querySelectorAll('.mx__row')].map((row) => {
      const cells = [];
      for (const b of row.querySelectorAll('[data-matrix-cell]')) {
        const [, g, bit] = b.dataset.matrixCell.split('|');
        if (bit === 'S') for (let i = 0; i < 4; i++) cells[Number(g) * 4 + i] = b;
        else cells[Number(g) * 4 + bits.indexOf(bit)] = b;
      }
      return cells;
    });
    let r = grid.findIndex((cells) => cells.includes(cellBtn));
    let c = grid[r].indexOf(cellBtn);
    if (move[1] && cellBtn.dataset.matrixCell.endsWith('|S') && move[1] > 0) c += 3; // sortir de la case large
    for (;;) {
      r += move[0];
      c += move[1];
      if (r < 0 || r >= grid.length || c < 0 || c >= grid[0].length) return;
      const next = grid[r][c];
      if (next && next !== cellBtn) {
        ev.preventDefault();
        next.focus();
        next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }
    }
  });
}

/**
 * Éléments rendus dynamiquement (liens, boutons, cases de la matrice) : un seul écouteur sur le
 * document. Chaque attribut data-* déclenche son action ; en cas de plusieurs, le premier de la liste.
 */
const CLICK_ACTIONS = [
  [
    'matrixDetail',
    (detail) => {
      state.matrixDetail = detail;
      if (state.matrixDetail === 'tables' && state.matrixPick?.row.includes('.')) state.matrixPick = null;
      refreshMatrix(`[data-matrix-detail="${state.matrixDetail}"]`);
    },
  ],
  [
    'matrixCell',
    (cell) => {
      const [row, group, bit] = cell.split('|');
      state.matrixPick = { row, group: Number(group), bit };
      refreshMatrix(`[data-matrix-cell="${CSS.escape(cell)}"]`);
    },
  ],
  [
    'matrixClose',
    () => {
      const back = state.matrixPick && `${state.matrixPick.row}|${state.matrixPick.group}|${state.matrixPick.bit}`;
      state.matrixPick = null;
      refreshMatrix(back ? `[data-matrix-cell="${CSS.escape(back)}"]` : null);
    },
  ],
  [
    'level',
    (level) => {
      state.level = level;
      renderAnalysis();
      $(`level-${state.level}`)?.focus();
    },
  ],
  [
    'indexTable',
    (table) => {
      const el = $(slug(table));
      if (el) {
        scrollWithin(el);
        flash(el);
      }
    },
  ],
  ['gotoWidgets', () => selectTab('widgets', { focus: true })],
  [
    'action',
    (action, target) => {
      if (action === 'refresh') loadSchema({ manual: true });
      else if (action === 'accept' || action === 'unaccept') {
        if (action === 'accept') state.accepted.add(target.dataset.key);
        else state.accepted.delete(target.dataset.key);
        saveOption('accepted', [...state.accepted]);
        recompute();
        toast(action === 'accept' ? 'Noté comme voulu : ce point ne sera plus compté.' : 'Ce point est de nouveau à confirmer.', 'info');
      }
    },
  ],
  ['gotoAccess', (table) => gotoAccess(table)],
  [
    'gotoAnalysis',
    () => {
      // « N points d'attention » : l'analyse s'ouvre sur les constats à corriger.
      state.level = 'blocking';
      renderAnalysis();
      selectTab('analysis', { focus: true });
    },
  ],
  ['gotoSchema', (table) => showOnDiagram(table)],
  ['gotoTable', (table) => gotoTable(table)],
];
const CLICK_SELECTOR = CLICK_ACTIONS.map(([key]) => `[data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}]`).join(',');

function bindDynamicActions() {
  document.addEventListener('click', (ev) => {
    const target = ev.target.closest(CLICK_SELECTOR);
    if (!target) return;
    ev.preventDefault();
    const found = CLICK_ACTIONS.find(([key]) => target.dataset[key]);
    if (found) found[1](target.dataset[found[0]], target);
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
  try {
    name = String((await api.docApi.getDocName?.()) || '');
  } catch {
    /* sans nom */
  }
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
    if (name) {
      state.docName = name;
      if (state.tab === 'report') renderReport();
    }
  });
  loadSchema();
}

bindEvents();
syncTheme();
selectTab('schema');
if (inGrist) connectGrist();
recompute();
