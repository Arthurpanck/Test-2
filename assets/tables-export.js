/**
 * Export Excel des tables, au format du modèle « Table pour exportation », présenté comme l'export
 * « Qui peut faire quoi ? » (titre, en-têtes gris, pastilles de couleur, mise en page) :
 *  - « Tables » : chaque table l'une sous l'autre, son nom et ses chiffres, puis ses colonnes ;
 *  - « Toutes les colonnes » : les mêmes lignes en tableau Excel filtrable, précédées du nom de la table ;
 *  - « Paramètres » : document, date de lecture et légende des colonnes.
 * Les descriptions des tables et des colonnes sont reprises (colonne « Description »).
 * Module pur.
 */
import { TABLE_COLUMNS, tableRows, rowValues, NO_FORMULA } from './table-format.js';
import { frenchDateTime as fmtDate, plural } from './util.js';
import { xlsxColor as X } from './theme.js';
import { writeXlsx, cellRef, colName } from './xlsx.js';

const GREY = X('surface'),
  LINE = X('subtle'),
  EDGE = X('border'),
  WHITE = X('onPrimary');
const COLUMNS = [...TABLE_COLUMNS, 'Description'];
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
  table: { font: { bold: true, size: 13, color: X('primary') }, border: { bottom: X('primary') }, align: { v: 'bottom' } },
  summary: { font: { bold: true, size: 13, color: X('summary') }, border: { bottom: X('summary') }, align: { v: 'bottom' } },
  tableRule: { border: { bottom: X('primary') } },
  summaryRule: { border: { bottom: X('summary') } },
  tableMeta: { font: { size: 9, color: X('muted') }, border: { bottom: X('primary') }, align: { v: 'bottom' } },
  summaryMeta: { font: { size: 9, color: X('muted') }, border: { bottom: X('summary') }, align: { v: 'bottom' } },
  desc: { font: { italic: true, size: 10, color: X('muted') }, align: { wrap: true, v: 'top' } },
  head: {
    font: { bold: true, size: 9, color: X('neutral') },
    fill: GREY,
    border: { bottom: EDGE, top: EDGE },
    align: { v: 'center', wrap: true },
  },
  name: cell({ color: X('text') }),
  key: cell({ bold: true, color: X('text') }),
  label: cell({ color: X('text') }),
  sql: cell({ size: 9, name: 'Consolas', color: X('neutral') }),
  type: cell({ color: X('type') }),
  role: cell({ color: X('neutral') }),
  roleKey: cell({ bold: true, color: X('key') }),
  roleComputed: cell({ bold: true, color: X('formula') }),
  computed: cell({ bold: true, color: X('formula') }),
  initial: cell({ bold: true, color: X('info') }),
  muted: cell({ color: X('line') }),
  dash: cell({ color: X('line') }, { align: { h: 'center', v: 'top' } }),
  formula: cell({ size: 9, name: 'Consolas', color: X('neutral') }),
  description: cell({ size: 9, color: X('muted') }),
  doc: pill(X('ready'), X('fillOk')),
  noDoc: pill(X('improve'), X('fillKo')),
  // Feuille « Paramètres »
  pHead: { font: { bold: true, size: 10, color: X('text') }, fill: GREY, border: { bottom: EDGE }, align: { v: 'center' } },
  pKey: { font: { bold: true, size: 10 }, fill: GREY, border: { bottom: LINE }, align: { v: 'top', wrap: true } },
  pText: { font: { size: 10 }, border: { bottom: LINE }, align: { v: 'top', wrap: true } },
};

const ROLE_STYLE = { 'Clé primaire': 'roleKey', Calculée: 'roleComputed' };
const COMPUTED_STYLE = { Calculé: 'computed', Initialisé: 'initial', 'Non calculé': 'muted' };
const DOC_STYLE = { Documentée: 'doc', 'Pas de documentation': 'noDoc', [NO_FORMULA]: 'dash' };

/** Cellules d'une ligne de colonne : les huit colonnes du modèle, puis la description. */
function cells(r) {
  const [name, label, sqlite, declared, role, computed, formula, documented] = rowValues(r);
  return [
    { v: name, s: r.isKey ? 'key' : 'name' },
    { v: label, s: 'label' },
    { v: sqlite, s: 'sql' },
    { v: declared, s: 'type' },
    { v: role, s: ROLE_STYLE[role] || 'role' },
    { v: r.when ? `${computed} (${r.when})` : computed, s: COMPUTED_STYLE[computed] || 'computed' },
    { v: formula, s: 'formula' },
    { v: documented, s: DOC_STYLE[documented] || 'dash' },
    { v: r.description || '', s: 'description' },
  ];
}

/** « 12 colonnes · 3 calculées · 1 formule sans documentation » */
function tableMeta(rows) {
  const cols = rows.filter((r) => !r.isKey);
  const computed = cols.filter((r) => r.computed === 'Calculé').length;
  const undocumented = cols.filter((r) => r.documented === 'Pas de documentation').length;
  return [
    plural(cols.length, 'colonne', 'colonnes'),
    computed ? plural(computed, 'calculée', 'calculées') : '',
    undocumented ? plural(undocumented, 'formule sans documentation', 'formules sans documentation') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export const TABLES_HELP =
  'Une table par bloc, au format « Table pour exportation ». Rôle : clé primaire, donnée (saisie) ou calculée (formule). ' +
  'Documentée ? : la formule contient-elle un commentaire (#) ? « — » : colonne sans formule. La feuille « Toutes les colonnes » permet de trier et filtrer.';

/** @param {Array} tables  tables de sortie du convertisseur */
export function tablesWorkbook(tables, { docName = '', date = new Date() } = {}) {
  const doc = docName || 'Document Grist';
  const last = COLUMNS.length - 1;
  const all = tables.map((t) => ({ t, rows: tableRows(t) }));
  const colCount = all.reduce((n, x) => n + x.rows.length - 1, 0);
  const merges = [`A3:${colName(last)}3`];
  const rows = [
    { height: 26, cells: [{ v: `Tables et colonnes · ${plural(tables.length, 'table', 'tables')}`, s: 'title' }] },
    { height: 16, cells: [{ v: `${doc} · lu le ${fmtDate(date)} · ${plural(colCount, 'colonne', 'colonnes')}`, s: 'subtitle' }] },
    { height: 30, cells: [{ v: TABLES_HELP, s: 'note' }] },
  ];
  const flat = [{ height: 22, cells: ['Table', ...COLUMNS].map((v) => ({ v, s: 'head' })) }];
  for (const { t, rows: tr } of all) {
    const kind = t.kind === 'summary' ? 'summary' : 'table';
    rows.push({ height: 14, cells: [] });
    // Nom de la table sur les deux premières colonnes, ses chiffres à la suite, filet sur toute la largeur
    merges.push(`A${rows.length + 1}:B${rows.length + 1}`);
    rows.push({
      height: 24,
      cells: [
        { v: t.kind === 'summary' ? `${t.name} (synthèse)` : t.name, s: kind },
        { v: '', s: `${kind}Rule` },
        { v: tableMeta(tr), s: `${kind}Meta` },
        ...Array(last - 2).fill({ v: '', s: `${kind}Rule` }),
      ],
    });
    if (t.description) {
      merges.push(`A${rows.length + 1}:${colName(last)}${rows.length + 1}`);
      rows.push({ height: 18, cells: [{ v: t.description, s: 'desc' }] });
    }
    rows.push({ height: 22, cells: COLUMNS.map((v) => ({ v, s: 'head' })) });
    for (const r of tr) {
      rows.push({ cells: cells(r) });
      flat.push({ cells: [{ v: t.name, s: 'name' }, ...cells(r)] });
    }
  }
  const widths = [26, 26, 11, 28, 13, 19, 60, 16, 44];

  // ---- Paramètres et légende ----
  const p = [
    { height: 24, cells: [{ v: 'Paramètres et lecture', s: 'title' }] },
    { height: 6, cells: [] },
  ];
  const kv = (k, v, s = 'pText') =>
    p.push({
      cells: [
        { v: k, s: 'pKey' },
        { v, s },
      ],
    });
  kv('Document', doc);
  kv('Structure lue le', fmtDate(date));
  kv('Contenu', `${plural(tables.length, 'table', 'tables')}, ${plural(colCount, 'colonne', 'colonnes')} (clé « id » comprise).`);
  p.push({ height: 6, cells: [] });
  p.push({
    cells: [
      { v: 'Colonne', s: 'pHead' },
      { v: 'Ce qu’elle indique', s: 'pHead' },
    ],
  });
  for (const [k, v] of [
    ['Colonne (nom en base)', 'Identifiant de la colonne dans Grist, utilisé dans les formules ($Nom) et les règles d’accès.'],
    ['Nom affiché', 'Libellé visible dans Grist, quand il diffère de l’identifiant.'],
    ['Type SQLite', 'Type de stockage dans le fichier .grist (base SQLite).'],
    ['Type déclaré (Grist)', 'Type choisi dans Grist : texte, nombre, date, référence vers une autre table…'],
    ['Rôle', 'Clé primaire (id), Donnée (saisie, import) ou Calculée (formule).'],
    ['Calculé ?', 'Calculé : formule ; Initialisé : formule qui propose une première valeur, modifiable ensuite.'],
    ['Formule', 'Code Python de la formule, tel qu’écrit dans Grist.'],
    ['Documentée ?', 'Documentée : la formule contient un commentaire (#) ; Pas de documentation : aucun ; « — » : colonne sans formule.'],
    ['Description', 'Description saisie dans Grist pour la table ou la colonne.'],
  ])
    kv(k, v);

  return {
    title: `Tables et colonnes · ${doc}`,
    creator: 'Widget Grist « Audit de structure »',
    date,
    styles: STYLES,
    sheets: [
      {
        name: 'Tables',
        tabColor: X('primary'),
        showGrid: false,
        landscape: true,
        cols: widths,
        rows,
        merges,
        freeze: { rows: 3, cols: 0 },
      },
      {
        name: 'Toutes les colonnes',
        tabColor: X('type'),
        landscape: true,
        cols: [22, ...widths],
        rows: flat,
        freeze: { rows: 1, cols: 2 },
        table: { name: 'Colonnes', ref: `A1:${cellRef(flat.length - 1, COLUMNS.length)}`, style: 'TableStyleLight1' },
        printTitles: '$1:$1',
      },
      { name: 'Paramètres', tabColor: X('muted'), showGrid: false, cols: [26, 100], rows: p },
    ],
  };
}

export const tablesXlsx = (tables, opts) => writeXlsx(tablesWorkbook(tables, opts));
