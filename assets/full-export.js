/**
 * Export Excel complet (onglet Rapport) : un sommaire, puis les classeurs des onglets Tables, Accès et
 * Vues tels quels, chacun avec sa feuille de paramètres. Module pur.
 */
import { tablesWorkbook } from './tables-export.js';
import { accessWorkbook } from './rights-export.js';
import { viewsWorkbook } from './views-export.js';
import { frenchDateTime as fmtDate, plural } from './util.js';
import { xlsxColor as X } from './theme.js';
import { writeXlsx } from './xlsx.js';
import { BASE_STYLES, CREATOR, combineWorkbooks, sheetBuilder } from './xlsx-kit.js';

/** Ce que contient chaque feuille, par nom d'origine. */
const ABOUT = {
  Tables: 'Chaque table et ses colonnes : type, rôle, formule, documentation, description.',
  'Toutes les colonnes': 'Les colonnes de toutes les tables, en tableau Excel à trier et filtrer.',
  "Droits d'accès": 'Réglages généraux, attributs utilisateur, règles par défaut, puis les règles de chaque table et de ses colonnes.',
  'Qui peut faire quoi': 'Matrice des droits par rôle métier (rôle Grist : éditeur), table par table et colonne par colonne.',
  Vues: 'Chaque page et ses vues : type, table, vue suivie ; pour les vues personnalisées, origine, accès et colonnes associées.',
  'Toutes les vues': 'Les vues de toutes les pages, en tableau Excel à trier et filtrer.',
};
const LEGEND = {
  tables: 'Paramètres et légende de l’export des tables.',
  accès: 'Paramètres et légende de la matrice des droits.',
  vues: 'Paramètres et légende de l’export des vues.',
};

/**
 * @param {object} p
 * @param {Array} p.tables  tables du convertisseur
 * @param {object|null} p.access  buildAccess(), p.settings generalSettings(), p.mx buildMatrix()
 * @param {object|null} p.pages  buildPages()
 * @param {object|null} p.stats  computeStats()
 */
export function fullWorkbook(
  { tables, access = null, settings = [], mx = null, pages = null, stats = null },
  { docName = '', date = new Date() } = {},
) {
  const doc = docName || 'Document Grist';
  const opts = { docName, date };
  const parts = [{ book: tablesWorkbook(tables, opts), label: 'tables' }];
  const missing = [];
  if (access?.hasRules) parts.push({ book: accessWorkbook(access, settings, mx, opts), label: 'accès' });
  else missing.push('Droits d’accès : le document n’a pas de règles d’accès.');
  if (pages) parts.push({ book: viewsWorkbook(pages, opts), label: 'vues' });
  else missing.push('Vues : les pages du document n’ont pas pu être lues.');
  // Les trois feuilles « Paramètres » nommées d'après leur partie
  for (const p of parts)
    p.book.sheets = p.book.sheets.map((s) => (s.name === 'Paramètres' ? { ...s, name: `Paramètres · ${p.label}` } : s));
  const body = combineWorkbooks(parts, { date });

  // Sommaire : chiffres clés, puis une ligne par feuille, dans l'ordre du classeur
  const origin = parts.flatMap(({ book, label }) => book.sheets.map((s) => ({ name: s.name, label })));
  const sheet = sheetBuilder(2, {
    title: `Audit de structure · ${doc}`,
    subtitle: `Lu le ${fmtDate(date)}`,
    help: 'Ce classeur réunit les exports Excel des onglets Tables, Accès et Vues. Chaque partie garde sa feuille de paramètres et sa légende.',
  });
  if (stats) {
    sheet.block('Chiffres clés', '');
    for (const [k, v] of [
      ['Tables', plural(stats.tables, 'table', 'tables')],
      ['Colonnes', plural(stats.columns, 'colonne', 'colonnes')],
      ['Relations', plural(stats.relations, 'relation', 'relations')],
      ['Formules', plural(stats.formulas, 'formule', 'formules')],
      ...(access?.hasRules ? [['Droits d’accès', plural(access.ruleCount ?? 0, 'condition', 'conditions')]] : []),
      ...(pages ? [['Vues', `${plural(pages.pages.length, 'page', 'pages')}, ${plural(pages.widgetCount, 'vue', 'vues')}`]] : []),
    ])
      sheet.push({
        cells: [
          { v: k, s: 'strong' },
          { v, s: 'text' },
        ],
      });
  }
  sheet.block('Feuilles du classeur', plural(body.sheets.length, 'feuille', 'feuilles'));
  sheet.head(['Feuille', 'Contenu']);
  body.sheets.forEach((s, i) =>
    sheet.push({
      cells: [
        { v: s.name, s: 'strong' },
        { v: ABOUT[origin[i].name] || LEGEND[origin[i].label] || '', s: 'text' },
      ],
    }),
  );
  if (missing.length) {
    sheet.block('Parties absentes', '');
    for (const m of missing) sheet.wide(m, 'muted');
  }
  const cover = {
    styles: BASE_STYLES,
    sheets: [{ name: 'Sommaire', tabColor: X('text'), showGrid: false, cols: [30, 110], rows: sheet.rows, merges: sheet.merges }],
  };
  return { ...combineWorkbooks([{ book: cover }, { book: body }], { date }), title: `Audit de structure · ${doc}`, creator: CREATOR };
}

export const fullXlsx = (data, opts) => writeXlsx(fullWorkbook(data, opts));
