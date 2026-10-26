/**
 * Pages et widgets du document : lecture de `_grist_Pages`, `_grist_Views` et
 * `_grist_Views_section`, mise en forme lisible et quelques constats.
 * Module pur : testé sous Node.
 */
import { columnarToRows } from './converter.js?v=2.4.0';

/** Types de widgets, avec les libellés de Grist. */
export const WIDGET_TYPES = {
  record: 'Tableau',
  single: 'Fiche',
  detail: 'Liste de fiches',
  chart: 'Graphique',
  custom: 'Widget personnalisé',
  form: 'Formulaire',
};

const CHART_TYPES = { bar: 'barres', line: 'courbes', pie: 'secteurs', area: 'aires', scatter: 'nuage de points', kaplan_meier: 'Kaplan-Meier', donut: 'anneau' };

function parseJson(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try { return JSON.parse(value) || {}; } catch { return {}; }
}

/** Widget personnalisé : URL ou widget de la galerie, et accès accordé. */
function customInfo(options) {
  const o = parseJson(options);
  const cv = parseJson(o.customView);
  if (!cv || (!cv.url && !cv.widgetId)) return null;
  let host = '';
  try { host = cv.url ? new URL(cv.url).host : ''; } catch { host = ''; }
  return {
    url: cv.url || '',
    widgetId: cv.widgetId || '',
    host,
    access: cv.access || 'none',
    builtIn: Boolean(cv.widgetId) || /(^|\.)getgrist\.com$/.test(host),
  };
}

/**
 * @param {object} p  { pages, views, sections, tables } (lignes ou format colonnaire de docApi.fetchTable)
 * @returns {{ pages: Array, widgetCount: number, tablesWithoutPage: string[] }}
 */
export function buildPages({ pages = [], views = [], sections = [], tables = [] } = {}) {
  const tableById = new Map(columnarToRows(tables).map((t) => [t.id, t]));
  const viewById = new Map(columnarToRows(views).map((v) => [v.id, v]));
  const secRows = columnarToRows(sections);
  const secById = new Map(secRows.map((s) => [s.id, s]));
  const tableName = (ref) => tableById.get(ref)?.tableId || '';
  const sectionLabel = (s) => (s ? s.title || tableName(s.tableRef) || `widget ${s.id}` : '');

  const result = [];
  const shown = new Set();
  for (const p of columnarToRows(pages).slice().sort((a, b) => (a.pagePos ?? 0) - (b.pagePos ?? 0))) {
    const v = viewById.get(p.viewRef);
    if (!v) continue;
    const widgets = secRows.filter((s) => s.parentId === v.id).map((s) => {
      const table = tableName(s.tableRef);
      if (table) shown.add(table);
      const src = secById.get(s.linkSrcSectionRef);
      return {
        id: s.id,
        type: s.parentKey || 'record',
        typeLabel: (WIDGET_TYPES[s.parentKey] || s.parentKey || 'Widget') + (s.parentKey === 'chart' && CHART_TYPES[s.chartType] ? ` (${CHART_TYPES[s.chartType]})` : ''),
        title: s.title || '',
        table,
        summary: Boolean(tableById.get(s.tableRef)?.summarySourceTable),
        linkedTo: src ? sectionLabel(src) : '',
        custom: s.parentKey === 'custom' ? customInfo(s.options) : null,
        description: s.description || '',
      };
    });
    result.push({ id: v.id, name: v.name || '', indentation: Number(p.indentation) || 0, widgets });
  }
  const userTables = [...tableById.values()].filter((t) => t.tableId && !t.tableId.startsWith('_grist_') && !t.summarySourceTable).map((t) => t.tableId);
  return {
    pages: result,
    widgetCount: result.reduce((n, p) => n + p.widgets.length, 0),
    tablesWithoutPage: userTables.filter((t) => !shown.has(t)).sort((a, b) => a.localeCompare(b, 'fr')),
  };
}

const DEFAULT_PAGE = /^(New page|Nouvelle page|Page sans titre|Untitled page|Page \d+)$/i;
const REFRESH_STEP = 'Revenez dans ce widget et cliquez sur « Relire le document ».';

/** Constats sur les pages et widgets, au format de insights.js. */
export function pageInsights(model) {
  if (!model) return [];
  const items = [];
  const push = (it) => items.push({ area: 'pages', ...it });
  const defaults = model.pages.filter((p) => DEFAULT_PAGE.test(p.name.trim()) || !p.name.trim()).map((p) => ({ table: p.name || '(sans nom)', note: p.widgets.map((w) => w.title || w.table).filter(Boolean).join(', ') }));
  if (defaults.length) {
    push({
      id: 'page-default-name', severity: 'improve',
      title: defaults.length > 1 ? `${defaults.length} pages au nom par défaut` : 'Une page au nom par défaut',
      summary: 'Ces pages s\'appellent encore « New page » ou n\'ont pas de nom.',
      why: 'Dans le menu de gauche, on ne sait pas ce qu\'elles contiennent sans les ouvrir.',
      steps: ['Dans le menu de gauche, survolez la page, ouvrez son menu « ⋯ » et choisissez « Renommer ».', REFRESH_STEP],
      targets: defaults,
    });
  }
  const external = [];
  for (const p of model.pages) for (const w of p.widgets) {
    if (w.custom && w.custom.access === 'full' && !w.custom.builtIn) external.push({ table: p.name, note: `${w.title || w.typeLabel} — ${w.custom.host || 'URL'}` });
  }
  if (external.length) {
    push({
      id: 'widget-full-access', severity: 'choice',
      title: external.length > 1 ? `${external.length} widgets externes avec accès complet` : 'Un widget externe avec accès complet',
      summary: 'Ces widgets personnalisés viennent d\'un site extérieur à Grist et peuvent lire et modifier tout le document.',
      why: 'Le site qui héberge le widget peut changer son code : il faut lui faire confiance.',
      intended: 'Widget que vous connaissez et qui a besoin de tout le document (comme ce widget d\'audit) : rien à faire.',
      steps: ['Sinon : sélectionnez le widget, panneau de droite ▸ « Widget » ▸ « Accès », et choisissez « Lire la table sélectionnée » ou « Aucun accès ».', REFRESH_STEP],
      targets: external,
    });
  }
  if (model.tablesWithoutPage.length) {
    push({
      id: 'table-without-page', severity: 'choice',
      title: model.tablesWithoutPage.length > 1 ? `${model.tablesWithoutPage.length} tables affichées sur aucune page` : 'Une table affichée sur aucune page',
      summary: 'Ces tables n\'apparaissent dans aucun widget : on ne les voit que dans « Données brutes ».',
      why: 'Les personnes qui utilisent le document risquent de ne jamais les trouver.',
      intended: 'Table technique ou de paramètres, volontairement à l\'écart : rien à faire.',
      steps: ['Sinon : « Ajouter » ▸ « Ajouter une page » (ou « Ajouter un widget à la page ») et choisissez la table.', REFRESH_STEP],
      targets: model.tablesWithoutPage.map((t) => ({ table: t })),
    });
  }
  return items;
}
