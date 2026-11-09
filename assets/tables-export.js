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
import { writeXlsx, cellRef } from './xlsx.js';
import { BASE_STYLES, CREATOR, blockColor, cell, paramsSheet, sheetBuilder } from './xlsx-kit.js';

const COLUMNS = [...TABLE_COLUMNS, 'Description'];
const WIDTHS = [26, 26, 11, 28, 13, 19, 60, 16, 44];
const STYLES = {
  ...BASE_STYLES,
  ...blockColor('summary', X('summary')), // tables de synthèse : filet violet
  type: cell({ color: X('type') }),
  roleKey: cell({ bold: true, color: X('key') }),
  computed: cell({ bold: true, color: X('formula') }),
  initial: cell({ bold: true, color: X('info') }),
};

const ROLE_STYLE = { 'Clé primaire': 'roleKey', Calculée: 'computed' };
const COMPUTED_STYLE = { Calculé: 'computed', Initialisé: 'initial', 'Non calculé': 'muted' };
const DOC_STYLE = { Documentée: 'pillOk', 'Pas de documentation': 'pillWarn', [NO_FORMULA]: 'dash' };

/** Cellules d'une ligne de colonne : les huit colonnes du modèle, puis la description. */
function cells(r) {
  const [name, label, sqlite, declared, role, computed, formula, documented] = rowValues(r);
  return [
    { v: name, s: r.isKey ? 'strong' : 'text' },
    { v: label, s: 'text' },
    { v: sqlite, s: 'mono' },
    { v: declared, s: 'type' },
    { v: role, s: ROLE_STYLE[role] || 'neutral' },
    { v: r.when ? `${computed} (${r.when})` : computed, s: COMPUTED_STYLE[computed] || 'computed' },
    { v: formula, s: 'mono' },
    { v: documented, s: DOC_STYLE[documented] || 'dash' },
    { v: r.description || '', s: 'small' },
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
  const all = tables.map((t) => ({ t, rows: tableRows(t) }));
  const colCount = all.reduce((n, x) => n + x.rows.length - 1, 0);
  const sheet = sheetBuilder(COLUMNS.length, {
    title: `Tables et colonnes · ${plural(tables.length, 'table', 'tables')}`,
    subtitle: `${doc} · lu le ${fmtDate(date)} · ${plural(colCount, 'colonne', 'colonnes')}`,
    help: TABLES_HELP,
  });
  const flat = [{ height: 22, cells: ['Table', ...COLUMNS].map((v) => ({ v, s: 'head' })) }];
  for (const { t, rows: tr } of all) {
    const summary = t.kind === 'summary';
    sheet.block(summary ? `${t.name} (synthèse)` : t.name, tableMeta(tr), { style: summary ? 'summary' : 'block' });
    if (t.description) sheet.wide(t.description, 'desc');
    sheet.head(COLUMNS);
    for (const r of tr) {
      sheet.push({ cells: cells(r) });
      flat.push({ cells: [{ v: t.name, s: 'text' }, ...cells(r)] });
    }
  }

  const params = paramsSheet({
    doc,
    date,
    facts: [['Contenu', `${plural(tables.length, 'table', 'tables')}, ${plural(colCount, 'colonne', 'colonnes')} (clé « id » comprise).`]],
    legend: [
      ['Colonne (nom en base)', 'Identifiant de la colonne dans Grist, utilisé dans les formules ($Nom) et les règles d’accès.'],
      ['Nom affiché', 'Libellé visible dans Grist, quand il diffère de l’identifiant.'],
      ['Type SQLite', 'Type de stockage dans le fichier .grist (base SQLite).'],
      ['Type déclaré (Grist)', 'Type choisi dans Grist : texte, nombre, date, référence vers une autre table…'],
      ['Rôle', 'Clé primaire (id), Donnée (saisie, import) ou Calculée (formule).'],
      ['Calculé ?', 'Calculé : formule ; Initialisé : formule qui propose une première valeur, modifiable ensuite.'],
      ['Formule', 'Code Python de la formule, tel qu’écrit dans Grist.'],
      [
        'Documentée ?',
        'Documentée : la formule contient un commentaire (#) ; Pas de documentation : aucun ; « — » : colonne sans formule.',
      ],
      ['Description', 'Description saisie dans Grist pour la table ou la colonne.'],
    ],
  });

  return {
    title: `Tables et colonnes · ${doc}`,
    creator: CREATOR,
    date,
    styles: STYLES,
    sheets: [
      {
        name: 'Tables',
        tabColor: X('primary'),
        showGrid: false,
        landscape: true,
        cols: WIDTHS,
        rows: sheet.rows,
        merges: sheet.merges,
        freeze: { rows: 3, cols: 0 },
      },
      {
        name: 'Toutes les colonnes',
        tabColor: X('type'),
        landscape: true,
        cols: [22, ...WIDTHS],
        rows: flat,
        freeze: { rows: 1, cols: 2 },
        table: { name: 'Colonnes', ref: `A1:${cellRef(flat.length - 1, COLUMNS.length)}`, style: 'TableStyleLight1' },
        printTitles: '$1:$1',
      },
      params,
    ],
  };
}

export const tablesXlsx = (tables, opts) => writeXlsx(tablesWorkbook(tables, opts));
