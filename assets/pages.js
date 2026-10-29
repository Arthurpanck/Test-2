/**
 * Widgets du document : lecture de `_grist_Pages`, `_grist_Views` et `_grist_Views_section`.
 * Les tableaux (widget « Tableau ») sont comptés mais pas détaillés : on décrit les fiches,
 * listes de fiches, graphiques, formulaires et surtout les widgets personnalisés
 * (origine, accès, colonnes associées).
 * Module pur : testé sous Node.
 */
import { columnarToRows } from './converter.js?v=3.2.0';

/** Types de widgets, avec les libellés de Grist. */
export const WIDGET_TYPES = {
  record: 'Tableau',
  single: 'Fiche',
  detail: 'Liste de fiches',
  chart: 'Graphique',
  custom: 'Widget personnalisé',
  creator: 'Widget personnalisé',
  form: 'Formulaire',
};

const CHART_TYPES = { bar: 'barres', line: 'courbes', pie: 'secteurs', area: 'aires', scatter: 'nuage de points', kaplan_meier: 'Kaplan-Meier', donut: 'anneau' };

/** Noms français des widgets de la galerie Grist (repli : nom anglais de la galerie). */
const GALLERY_NAMES = {
  'Action button': 'Bouton d\'action', Calendar: 'Calendrier', 'Copy to clipboard': 'Copier dans le presse-papiers',
  'Custom widget builder': 'Constructeur de widget', 'Drop-down Widget': 'Liste déroulante', 'Dropbox embedder': 'Fichiers Dropbox',
  Flashcards: 'Cartes mémoire', 'Inspect record': 'Inspecter la fiche', 'Inspect table': 'Inspecter la table',
  'Inspect options': 'Inspecter les options', 'Inspect API': 'Découvrir l\'API', Invoices: 'Factures', Map: 'Carte',
  Markdown: 'Markdown', Notepad: 'Bloc-notes', 'Pivot table': 'Tableau croisé dynamique', 'Print labels': 'Étiquettes à imprimer',
  'Purchase orders': 'Bons de commande', 'QR code': 'Code QR', 'HTML viewer': 'Affichage HTML', 'Grist video player': 'Lecteur vidéo',
  'Image viewer': 'Visionneuse d\'images', 'JupyterLite notebook': 'Notebook JupyterLite', 'Advanced charts': 'Graphiques avancés',
  'Simple table filter': 'Filtre simple', 'Vibe View': 'Vibe View',
};

export const ACCESS_LABELS = { full: 'Accès complet au document', 'read table': 'Lecture de la table sélectionnée', none: 'Aucun accès' };
/** Colonnes d'un widget de la galerie : « Champ attendu → colonne », puis les champs encore à associer. */
export function columnLines(c) {
  return [
    ...(c?.mapping || []).map((m) => ({ field: m.title || m.name, column: m.column })),
    ...(c?.missingColumns || []).map((f) => ({ field: f, column: '', missing: true })),
  ];
}

export const ORIGIN_LABELS = { gallery: 'Galerie Grist', external: 'Site externe', document: 'Code dans le document', self: 'Ce widget d\'audit' };

function parseJson(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try { return JSON.parse(value) || {}; } catch { return {}; }
}

const hostOf = (url) => { try { return url ? new URL(url).host : ''; } catch { return ''; } };
const bareUrl = (url) => String(url || '').split(/[?#]/)[0].replace(/\/index\.html$/, '/').replace(/\/+$/, '');

/** Widget personnalisé : origine, nom, auteur, accès, colonnes associées. */
function customInfo(section, colName, selfUrl) {
  const o = parseJson(section.options);
  const cv = parseJson(o.customView);
  const def = cv.widgetDef && typeof cv.widgetDef === 'object' ? cv.widgetDef : null;
  const access = cv.access || 'none';
  const mapping = Object.entries(cv.columnsMapping && typeof cv.columnsMapping === 'object' ? cv.columnsMapping : {})
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length))
    .map(([name, v]) => ({ name, column: (Array.isArray(v) ? v : [v]).map((x) => colName(x) || String(x)).join(', ') }));
  const mapped = new Set(mapping.map((m) => m.name));
  const declared = Array.isArray(def?.columns) ? def.columns.map((c) => (typeof c === 'string' ? { name: c } : c)).filter((c) => c && c.name) : [];
  const titles = new Map(declared.map((c) => [c.name, c.title || c.name]));
  for (const m of mapping) m.title = titles.get(m.name) || m.name;
  const missingColumns = declared.filter((c) => !c.optional && !mapped.has(c.name)).map((c) => c.title || c.name);

  if (section.parentKey === 'creator') {
    const html = typeof o.html === 'string' ? o.html : '';
    return { origin: 'document', name: 'Widget créé dans Grist', author: '', maintained: null, url: '', host: '', access, mapping, missingColumns,
      codeLines: html ? html.split('\n').length : 0 };
  }
  const url = cv.url || def?.url || '';
  if (!url && !cv.widgetId) return null;
  const isSelf = Boolean(selfUrl && cv.url && bareUrl(cv.url) === bareUrl(selfUrl));
  const fromGallery = Boolean(cv.widgetId);
  return {
    origin: isSelf ? 'self' : fromGallery ? 'gallery' : 'external',
    name: fromGallery ? (GALLERY_NAMES[def?.name] || def?.name || cv.widgetId) : isSelf ? 'Audit de structure' : '',
    author: def?.authors?.[0]?.name || '',
    maintained: fromGallery ? Boolean(def?.isGristLabsMaintained) : null,
    widgetId: cv.widgetId || '',
    url,
    host: hostOf(url),
    access,
    mapping,
    missingColumns,
  };
}

/**
 * @param {object} p  { pages, views, sections, tables, columns?, selfUrl? } (lignes ou format colonnaire)
 */
export function buildPages({ pages = [], views = [], sections = [], tables = [], columns = [], selfUrl = '' } = {}) {
  const tableById = new Map(columnarToRows(tables).map((t) => [t.id, t]));
  const colById = new Map(columnarToRows(columns || []).map((c) => [c.id, c]));
  const colName = (id) => colById.get(id)?.colId || '';
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
    const pageName = v.name || '';
    const widgets = secRows.filter((s) => s.parentId === v.id).map((s) => {
      const table = tableName(s.tableRef);
      if (table) shown.add(table);
      const src = secById.get(s.linkSrcSectionRef);
      const type = s.parentKey || 'record';
      const custom = type === 'custom' || type === 'creator' ? customInfo(s, colName, selfUrl) : null;
      return {
        id: s.id,
        type,
        page: pageName,
        typeLabel: custom && custom.origin !== 'gallery' ? 'Widget non officiel' : (WIDGET_TYPES[type] || type || 'Widget') + (type === 'chart' && CHART_TYPES[s.chartType] ? ` (${CHART_TYPES[s.chartType]})` : ''),
        title: s.title || '',
        table,
        summary: Boolean(tableById.get(s.tableRef)?.summarySourceTable),
        linkedTo: src ? sectionLabel(src) : '',
        custom,
        description: s.description || '',
      };
    });
    result.push({ id: v.id, name: pageName, indentation: Number(p.indentation) || 0, widgets });
  }
  const all = result.flatMap((p) => p.widgets);
  const notable = all.filter((w) => w.type !== 'record');
  const userTables = [...tableById.values()].filter((t) => t.tableId && !t.tableId.startsWith('_grist_') && !t.summarySourceTable).map((t) => t.tableId);
  return {
    pages: result,
    widgetCount: all.length,
    tableWidgetCount: all.length - notable.length,
    custom: notable.filter((w) => w.custom),
    unofficial: notable.filter((w) => w.custom && w.custom.origin !== 'gallery'),
    gallery: notable.filter((w) => w.custom && w.custom.origin === 'gallery'),
    views: notable.filter((w) => !w.custom),
    tableOnlyPages: result.filter((p) => p.widgets.length && p.widgets.every((w) => w.type === 'record')).map((p) => p.name || '(sans nom)'),
    tablesWithoutPage: userTables.filter((t) => !shown.has(t)).sort((a, b) => a.localeCompare(b, 'fr')),
  };
}

/** Phrase courte décrivant l'origine d'un widget personnalisé. */
export function originText(c) {
  if (!c) return '';
  if (c.origin === 'gallery') return `${ORIGIN_LABELS.gallery} — ${c.name}${c.author ? ` (${c.author}${c.maintained ? '' : ', hors Grist Labs'})` : ''}`;
  if (c.origin === 'external') return `${ORIGIN_LABELS.external} — ${c.host || c.url}`;
  if (c.origin === 'document') return `${ORIGIN_LABELS.document}${c.codeLines ? ` (${c.codeLines} lignes)` : ''}`;
  return `${ORIGIN_LABELS.self} — ${c.host}`;
}

/** Nombre de widgets par type, hors tableaux : « 2 fiches, 3 widgets personnalisés ». */
export function typeCounts(model) {
  const counts = new Map();
  for (const w of [...model.views, ...model.custom]) counts.set(w.typeLabel, (counts.get(w.typeLabel) || 0) + 1);
  return [...counts.entries()].map(([label, n]) => `${n} ${n > 1 ? pluralLabel(label) : label.toLowerCase()}`).join(', ');
}
function pluralLabel(label) {
  return { Fiche: 'fiches', 'Liste de fiches': 'listes de fiches', 'Widget personnalisé': 'widgets personnalisés', 'Widget non officiel': 'widgets non officiels', Formulaire: 'formulaires' }[label]
    || (label.startsWith('Graphique') ? label.replace('Graphique', 'graphiques') : label.toLowerCase());
}

const DEFAULT_PAGE = /^(New page|Nouvelle page|Page sans titre|Untitled page|Page \d+)$/i;
const REFRESH_STEP = 'Revenez dans ce widget et cliquez sur « Relire le document ».';
const widgetName = (w) => w.title || w.custom?.name || w.typeLabel;

/** Constats sur les pages et widgets, au format de insights.js. */
export function pageInsights(model) {
  if (!model) return [];
  const items = [];
  const push = (it) => items.push({ area: 'pages', ...it });
  const unmapped = model.custom.filter((w) => w.custom?.missingColumns.length);
  if (unmapped.length) {
    push({
      id: 'widget-unmapped', severity: 'blocking',
      title: unmapped.length > 1 ? `${unmapped.length} widgets personnalisés sans leurs colonnes` : 'Un widget personnalisé sans ses colonnes',
      summary: 'Ces widgets attendent qu\'on leur indique quelles colonnes utiliser : tant que ce n\'est pas fait, ils n\'affichent rien.',
      why: 'Les personnes qui ouvrent la page voient un widget vide ou un message d\'erreur.',
      steps: ['Sélectionnez le widget, panneau de droite ▸ « Widget », et choisissez une colonne pour chaque champ demandé.', REFRESH_STEP],
      targets: unmapped.map((w) => ({ table: w.page, note: `${widgetName(w)} — à associer : ${w.custom.missingColumns.join(', ')}` })),
    });
  }
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
  const inDoc = model.custom.filter((w) => w.custom?.origin === 'document');
  if (inDoc.length) {
    push({
      id: 'widget-in-document', severity: 'info',
      title: inDoc.length > 1 ? `${inDoc.length} widgets dont le code est dans le document` : 'Un widget dont le code est dans le document',
      summary: 'Ces widgets ont été créés dans Grist (« Créer le vôtre ») : leur code est enregistré dans le document et le suit quand on le copie.',
      why: 'Toute personne qui peut modifier la structure peut modifier ce code.',
      steps: [],
      targets: inDoc.map((w) => ({ table: w.page, note: widgetName(w) })),
    });
  }
  return items;
}


