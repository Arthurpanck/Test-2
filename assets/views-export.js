/**
 * Export Excel de l'onglet Vues, présenté comme les exports des tables et des droits d'accès
 * (titre, blocs à filet bleu, en-têtes gris, pastilles de couleur) :
 *  - « Vues » : chaque page l'une sous l'autre, son nom et ses chiffres, puis ses vues ; à la fin,
 *    les pages qui ne contiennent que des tableaux et les tables affichées sur aucune page ;
 *  - « Toutes les vues » : les mêmes lignes en tableau Excel filtrable, précédées du nom de la page ;
 *  - « Paramètres » : document, date de lecture et légende des colonnes.
 * Contrairement à l'onglet, les tableaux sont listés aussi : le classeur est un inventaire complet.
 * Module pur.
 */
import { ACCESS_LABELS, columnLines, originText, typeCounts } from './pages.js';
import { frenchDateTime as fmtDate, plural } from './util.js';
import { xlsxColor as X } from './theme.js';
import { writeXlsx, cellRef, colName } from './xlsx.js';

const GREY = X('surface'),
  LINE = X('subtle'),
  EDGE = X('border'),
  WHITE = X('onPrimary');
const COLUMNS = [
  'Vue',
  'Type',
  'Table',
  'Suit la sélection de',
  'Origine',
  'Accès',
  'Colonnes associées',
  'Adresse',
  'À vérifier',
  'Description',
];
const WIDTHS = [28, 22, 22, 22, 32, 24, 34, 40, 22, 40];
const cell = (font, extra = {}) => ({ font: { size: 10, ...font }, border: { bottom: LINE }, align: { v: 'top', wrap: true }, ...extra });
const pill = (color, fill) => ({
  font: { bold: true, size: 9, color },
  fill,
  border: { all: WHITE, style: 'medium' },
  align: { h: 'center', v: 'top', wrap: true },
});
const STYLES = {
  title: { font: { bold: true, size: 16, color: X('text') } },
  subtitle: { font: { size: 10, color: X('muted') } },
  note: { font: { size: 10, color: X('muted') }, align: { wrap: true, v: 'top' } },
  page: { font: { bold: true, size: 12, color: X('primary') }, border: { bottom: X('primary') }, align: { v: 'bottom' } },
  pageRule: { border: { bottom: X('primary') } },
  pageMeta: { font: { size: 9, color: X('muted') }, border: { bottom: X('primary') }, align: { v: 'bottom' } },
  head: {
    font: { bold: true, size: 9, color: X('neutral') },
    fill: GREY,
    border: { bottom: EDGE, top: EDGE },
    align: { v: 'center', wrap: true },
  },
  name: cell({ color: X('text') }),
  nameStrong: cell({ bold: true, color: X('text') }),
  muted: cell({ color: X('line') }),
  type: cell({ color: X('neutral') }),
  typeCustom: cell({ bold: true, color: X('choice') }),
  table: cell({ color: X('type') }),
  text: cell({ color: X('neutral') }),
  mono: cell({ size: 9, name: 'Consolas', color: X('neutral') }),
  dash: cell({ color: X('line') }, { align: { h: 'center', v: 'top' } }),
  description: cell({ size: 9, color: X('muted') }),
  ok: pill(X('ready'), X('fillOk')),
  warn: pill(X('choice'), X('fillUk')),
  ko: pill(X('improve'), X('fillKo')),
  item: cell({ color: X('text') }),
  // Feuille « Paramètres »
  pHead: { font: { bold: true, size: 10, color: X('text') }, fill: GREY, border: { bottom: EDGE }, align: { v: 'center' } },
  pKey: { font: { bold: true, size: 10 }, fill: GREY, border: { bottom: LINE }, align: { v: 'top', wrap: true } },
  pText: { font: { size: 10 }, border: { bottom: LINE }, align: { v: 'top', wrap: true } },
};

/**
 * Ce qu'il faut regarder pour une vue personnalisée, avec le ton de sa pastille
 * (les badges de l'onglet Vues) : [texte, style] ; null pour une vue classique.
 */
export function viewAttention(w) {
  const c = w.custom;
  if (!c) return null;
  const notes = [];
  if (c.missingColumns?.length) notes.push([plural(c.missingColumns.length, 'champ à associer', 'champs à associer'), 'ko']);
  if (c.origin === 'external')
    notes.push([c.access === 'full' ? 'Site externe, accès complet' : 'Site externe', c.access === 'full' ? 'ko' : 'warn']);
  if (c.origin === 'gallery' && !c.maintained) notes.push(['Communauté (hors Grist Labs)', 'warn']);
  if (c.origin === 'document') notes.push(['Code dans le document', 'warn']);
  if (!notes.length) return [c.origin === 'self' ? "Cette vue d'audit" : 'Galerie Grist', 'ok'];
  const tone = notes.some(([, t]) => t === 'ko') ? 'ko' : 'warn';
  return [notes.map(([t]) => t).join('\n'), tone];
}

/** Cellules d'une vue : les dix colonnes. */
function cells(w) {
  const c = w.custom;
  const lines = columnLines(c);
  const attention = viewAttention(w);
  const isTable = w.type === 'record';
  return [
    { v: w.title || w.table || w.typeLabel, s: c ? 'nameStrong' : isTable ? 'muted' : 'name' },
    { v: w.typeLabel, s: c ? 'typeCustom' : isTable ? 'muted' : 'type' },
    w.table ? { v: w.summary ? `${w.table} (synthèse)` : w.table, s: 'table' } : { v: '—', s: 'dash' },
    w.linkedTo ? { v: w.linkedTo, s: 'text' } : { v: '—', s: 'dash' },
    c ? { v: originText(c), s: 'text' } : { v: '—', s: 'dash' },
    c
      ? { v: ACCESS_LABELS[c.access] || c.access || '—', s: c.access === 'full' && c.origin === 'external' ? 'ko' : 'text' }
      : { v: '—', s: 'dash' },
    lines.length
      ? { v: lines.map((l) => `${l.field} → ${l.missing ? 'à associer' : l.column}`).join('\n'), s: 'text' }
      : { v: '—', s: 'dash' },
    c?.url && c.origin !== 'document' ? { v: c.url, s: 'mono' } : { v: '—', s: 'dash' },
    attention ? { v: attention[0], s: attention[1] } : { v: '—', s: 'dash' },
    { v: w.description || '', s: 'description' },
  ];
}

/** « 5 vues · 2 tableaux · 1 vue personnalisée » */
function pageMeta(p) {
  if (!p.widgets.length) return 'aucune vue';
  const tables = p.widgets.filter((w) => w.type === 'record').length;
  const others = typeCounts({
    views: p.widgets.filter((w) => w.type !== 'record' && !w.custom),
    custom: p.widgets.filter((w) => w.custom),
  });
  return [
    plural(p.widgets.length, 'vue', 'vues'),
    tables ? plural(tables, 'tableau', 'tableaux') : '',
    others,
    p.indentation ? 'sous-page' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export const VIEWS_HELP =
  'Une page par bloc, dans l’ordre du document (les sous-pages marquées ↳), avec toutes ses vues (tableaux compris). Pour les vues personnalisées : origine, accès accordé, ' +
  'colonne associée à chaque champ attendu et points à vérifier. La feuille « Toutes les vues » permet de trier et filtrer.';

/** @param {object} model  buildPages() */
export function viewsWorkbook(model, { docName = '', date = new Date() } = {}) {
  const doc = docName || 'Document Grist';
  const last = COLUMNS.length - 1;
  const pages = model.pages || [];
  const merges = [`A3:${colName(last)}3`];
  const rows = [
    {
      height: 26,
      cells: [
        { v: `Vues du document · ${plural(pages.length, 'page', 'pages')}, ${plural(model.widgetCount, 'vue', 'vues')}`, s: 'title' },
      ],
    },
    { height: 16, cells: [{ v: `${doc} · lu le ${fmtDate(date)}`, s: 'subtitle' }] },
    { height: 30, cells: [{ v: VIEWS_HELP, s: 'note' }] },
    // Les colonnes sont les mêmes pour toutes les pages : un seul en-tête, figé en haut de la feuille.
    { height: 22, cells: COLUMNS.map((v) => ({ v, s: 'head' })) },
  ];
  const flat = [{ height: 22, cells: ['Page', ...COLUMNS].map((v) => ({ v, s: 'head' })) }];

  /** Bloc : titre sur les deux premières colonnes, chiffres à la suite, filet bleu sur toute la largeur. */
  const block = (title, meta) => {
    rows.push({ height: 8, cells: [] });
    merges.push(`A${rows.length + 1}:B${rows.length + 1}`);
    rows.push({
      height: 22,
      cells: [
        { v: title, s: 'page' },
        { v: '', s: 'pageRule' },
        { v: meta, s: 'pageMeta' },
        ...Array(last - 2).fill({ v: '', s: 'pageRule' }),
      ],
    });
  };
  for (const p of pages) {
    const name = p.name || '(sans nom)';
    block(p.indentation ? `↳ ${name}` : name, pageMeta(p));
    for (const w of p.widgets) {
      rows.push({ cells: cells(w) });
      flat.push({ cells: [{ v: name, s: 'name' }, ...cells(w)] });
    }
  }
  // Le reste, comme en bas de l'onglet Vues
  const list = (title, meta, items) => {
    if (!items.length) return;
    block(title, meta);
    for (const it of items) rows.push({ cells: [{ v: it, s: 'item' }] });
  };
  list('Pages qui ne contiennent que des tableaux', plural(model.tableOnlyPages.length, 'page', 'pages'), model.tableOnlyPages);
  list(
    'Tables affichées sur aucune page',
    `${plural(model.tablesWithoutPage.length, 'table', 'tables')} · choix à confirmer`,
    model.tablesWithoutPage,
  );

  // ---- Paramètres et légende ----
  const p = [
    { height: 24, cells: [{ v: 'Paramètres et lecture', s: 'title' }] },
    { height: 6, cells: [] },
  ];
  const kv = (k, v) =>
    p.push({
      cells: [
        { v: k, s: 'pKey' },
        { v, s: 'pText' },
      ],
    });
  kv('Document', doc);
  kv('Structure lue le', fmtDate(date));
  kv(
    'Contenu',
    `${plural(pages.length, 'page', 'pages')}, ${plural(model.widgetCount, 'vue', 'vues')} : ${plural(model.tableWidgetCount, 'tableau', 'tableaux')}, ` +
      `${plural(model.views.length, 'autre vue classique', 'autres vues classiques')}, ${plural(model.gallery.length, 'vue de la galerie', 'vues de la galerie')}, ` +
      `${plural(model.unofficial.length, 'vue non officielle', 'vues non officielles')}.`,
  );
  p.push({ height: 6, cells: [] });
  p.push({
    cells: [
      { v: 'Colonne', s: 'pHead' },
      { v: 'Ce qu’elle indique', s: 'pHead' },
    ],
  });
  for (const [k, v] of [
    ['Vue', 'Titre de la vue dans Grist ; à défaut, le nom de sa table.'],
    [
      'Type',
      'Tableau, fiche, liste de fiches, graphique, formulaire, vue personnalisée (galerie de Grist) ou vue non officielle (ajoutée par son adresse ou créée dans le document).',
    ],
    ['Table', 'Table affichée par la vue ; « (synthèse) » pour une table de synthèse.'],
    ['Suit la sélection de', 'Vue dont la sélection filtre celle-ci (« Sélectionner par » dans Grist).'],
    [
      'Origine',
      'Pour une vue personnalisée : galerie de Grist (avec son auteur), site externe, code dans le document, ou cette vue d’audit.',
    ],
    ['Accès', 'Accès accordé à la vue personnalisée : aucun, lecture de la table sélectionnée, ou accès complet au document.'],
    [
      'Colonnes associées',
      'Pour chaque champ attendu par la vue personnalisée, la colonne choisie ; « à associer » : aucune colonne choisie.',
    ],
    ['Adresse', 'Adresse de la vue personnalisée, quand elle est chargée depuis un site.'],
    [
      'À vérifier',
      'Rouge : champs à associer, ou site externe avec accès complet au document. Violet : site externe, vue de la communauté (hors Grist Labs) ou code dans le document. Vert : vue de la galerie maintenue par Grist Labs.',
    ],
    ['Description', 'Description saisie dans Grist pour la vue.'],
  ])
    kv(k, v);

  return {
    title: `Vues · ${doc}`,
    creator: 'Widget Grist « Audit de structure »',
    date,
    styles: STYLES,
    sheets: [
      {
        name: 'Vues',
        tabColor: X('primary'),
        showGrid: false,
        landscape: true,
        cols: WIDTHS,
        rows,
        merges,
        freeze: { rows: 4, cols: 0 },
        printTitles: '$4:$4',
      },
      {
        name: 'Toutes les vues',
        tabColor: X('choice'),
        landscape: true,
        cols: [24, ...WIDTHS],
        rows: flat,
        freeze: { rows: 1, cols: 2 },
        ...(flat.length > 1
          ? { table: { name: 'ToutesLesVues', ref: `A1:${cellRef(flat.length - 1, COLUMNS.length)}`, style: 'TableStyleLight1' } }
          : {}),
        printTitles: '$1:$1',
      },
      { name: 'Paramètres', tabColor: X('muted'), showGrid: false, cols: [26, 100], rows: p },
    ],
  };
}

export const viewsXlsx = (model, opts) => writeXlsx(viewsWorkbook(model, opts));
