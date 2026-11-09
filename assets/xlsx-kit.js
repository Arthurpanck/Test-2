/**
 * Présentation commune des classeurs Excel du widget (tables, droits d'accès, vues, export complet) :
 * styles partagés, en-tête de feuille, blocs à filet bleu, feuille « Paramètres », et assemblage de
 * plusieurs classeurs en un seul. xlsx.js écrit le fichier ; chaque module d'export décrit son contenu.
 * Module pur.
 */
import { xlsxColor as X } from './theme.js';
import { frenchDateTime as fmtDate } from './util.js';
import { colName } from './xlsx.js';

export const CREATOR = 'Widget Grist « Audit de structure »';
export const COLOR = {
  blue: X('primary'),
  grey: X('surface'),
  line: X('subtle'),
  edge: X('border'),
  white: X('onPrimary'),
};

/** Cellule de tableau : texte 10 pt, filet gris dessous, alignée en haut, renvoyée à la ligne. */
export const cell = (font, extra = {}) => ({
  font: { size: 10, ...font },
  border: { bottom: COLOR.line },
  align: { v: 'top', wrap: true },
  ...extra,
});
/** Pastille : texte gras sur fond coloré, séparée de ses voisines par un liseré blanc. */
export const pill = (color, fill) => ({
  font: { bold: true, size: 9, color },
  fill,
  border: { all: COLOR.white, style: 'medium' },
  align: { h: 'center', v: 'top', wrap: true },
});
/** Titre de bloc (nom d'une table, d'une page…) : bleu, filet bleu sur toute la largeur. */
const blockStyles = (color) => ({
  title: { font: { bold: true, size: 13, color }, border: { bottom: color }, align: { v: 'bottom' } },
  meta: { font: { size: 9, color: X('muted') }, border: { bottom: color }, align: { v: 'bottom' } },
  rule: { border: { bottom: color } },
});
const BLUE = blockStyles(COLOR.blue);

export const BASE_STYLES = {
  // En-tête de feuille
  title: { font: { bold: true, size: 16, color: X('text') } },
  subtitle: { font: { size: 10, color: X('muted') } },
  note: { font: { size: 10, color: X('muted') }, align: { wrap: true, v: 'top' } },
  // Blocs
  block: BLUE.title,
  blockMeta: BLUE.meta,
  blockRule: BLUE.rule,
  blockSub: { font: { bold: true, size: 10, color: COLOR.blue }, align: { v: 'bottom' } },
  desc: { font: { italic: true, size: 10, color: X('muted') }, align: { wrap: true, v: 'top' } },
  head: {
    font: { bold: true, size: 9, color: X('neutral') },
    fill: COLOR.grey,
    border: { bottom: COLOR.edge, top: COLOR.edge },
    align: { v: 'center', wrap: true },
  },
  // Cellules
  text: cell({ color: X('text') }),
  strong: cell({ bold: true, color: X('text') }),
  neutral: cell({ color: X('neutral') }),
  muted: cell({ color: X('line') }),
  dash: cell({ color: X('line') }, { align: { h: 'center', v: 'top' } }),
  mono: cell({ size: 9, name: 'Consolas', color: X('neutral') }),
  small: cell({ size: 9, color: X('muted') }),
  // Pastilles
  pillOk: pill(X('ready'), X('fillOk')),
  pillKo: pill(X('blocking'), X('fillKo')),
  pillWarn: pill(X('improve'), X('fillKo')),
  pillChoice: pill(X('choice'), X('fillUk')),
  pillInfo: pill(X('neutral'), X('subtle')),
  // Feuille « Paramètres »
  pHead: { font: { bold: true, size: 10, color: X('text') }, fill: COLOR.grey, border: { bottom: COLOR.edge }, align: { v: 'center' } },
  pKey: { font: { bold: true, size: 10 }, fill: COLOR.grey, border: { bottom: COLOR.line }, align: { v: 'top', wrap: true } },
  pText: { font: { size: 10 }, border: { bottom: COLOR.line }, align: { v: 'top', wrap: true } },
};
/** Blocs d'une autre couleur (tables de synthèse) : styles `${name}`, `${name}Meta`, `${name}Rule`. */
export function blockColor(name, color) {
  const b = blockStyles(color);
  return { [name]: b.title, [`${name}Meta`]: b.meta, [`${name}Rule`]: b.rule };
}

/**
 * Feuille construite ligne à ligne : titre, sous-titre et note d'aide en haut, puis des blocs.
 * @param {number} width  nombre de colonnes (la note et les filets s'étendent sur toute la largeur)
 */
export function sheetBuilder(width, { title, subtitle, help, helpHeight = 30 }) {
  const last = width - 1;
  const rows = [
    { height: 26, cells: [{ v: title, s: 'title' }] },
    { height: 16, cells: [{ v: subtitle, s: 'subtitle' }] },
    { height: helpHeight, cells: [{ v: help, s: 'note' }] },
  ];
  const merges = [`A3:${colName(last)}3`];
  const b = {
    rows,
    merges,
    push: (row) => rows.push(row),
    /** Ligne pleine largeur fusionnée (description d'une table…). */
    wide(v, s, height = 18) {
      merges.push(`A${rows.length + 1}:${colName(last)}${rows.length + 1}`);
      rows.push({ height, cells: [{ v, s }] });
    },
    /** Titre de bloc sur les deux premières colonnes, ses chiffres à la suite, filet sur toute la largeur. */
    block(name, meta = '', { style = 'block', gap = 14 } = {}) {
      rows.push({ height: gap, cells: [] });
      if (width <= 2) {
        // Feuille étroite : le titre dans la première colonne, ses chiffres dans la seconde
        rows.push({
          height: gap > 10 ? 24 : 22,
          cells: [
            { v: name, s: style },
            { v: meta, s: `${style}Meta` },
          ],
        });
        return;
      }
      merges.push(`A${rows.length + 1}:B${rows.length + 1}`);
      rows.push({
        height: gap > 10 ? 24 : 22,
        cells: [
          { v: name, s: style },
          { v: '', s: `${style}Rule` },
          { v: meta, s: `${style}Meta` },
          ...Array(Math.max(0, last - 2)).fill({ v: '', s: `${style}Rule` }),
        ],
      });
    },
    /** Ligne d'en-têtes grise. */
    head(labels, height = 22) {
      rows.push({ height, cells: labels.map((v) => ({ v, s: 'head' })) });
    },
  };
  return b;
}

/**
 * Feuille « Paramètres » : quelques faits (document, date…), puis la légende des colonnes.
 * @param {Array<[string, string, string?]>} facts  [clé, valeur, style de la valeur]
 * @param {Array<[string, string]>} legend  [colonne, ce qu'elle indique]
 */
export function paramsSheet({
  doc,
  date,
  dateLabel = 'Structure lue le',
  facts = [],
  legend = [],
  legendHead = ['Colonne', 'Ce qu’elle indique'],
  extra = [],
}) {
  const rows = [
    { height: 24, cells: [{ v: 'Paramètres et lecture', s: 'title' }] },
    { height: 6, cells: [] },
  ];
  const kv = ([k, v, s = 'pText']) =>
    rows.push({
      cells: [
        { v: k, s: 'pKey' },
        { v, s },
      ],
    });
  [['Document', doc], [dateLabel, fmtDate(date)], ...facts].forEach(kv);
  if (legend.length) {
    rows.push({ height: 6, cells: [] });
    rows.push({ cells: legendHead.map((v) => ({ v, s: 'pHead' })) });
    legend.forEach(kv);
  }
  rows.push(...extra);
  return { name: 'Paramètres', tabColor: X('muted'), showGrid: false, cols: [26, 100], rows };
}

/**
 * Assemble plusieurs classeurs en un seul. Les styles de chacun sont préfixés (deux classeurs
 * peuvent donner le même nom à des styles différents) ; une feuille dont le nom est déjà pris
 * reçoit le libellé de son classeur (« Paramètres · vues ») ; idem pour les tableaux Excel.
 * @param {Array<{ book: object, label?: string }>} parts
 */
export function combineWorkbooks(parts, { title, date } = {}) {
  const styles = {};
  const sheets = [];
  const sheetNames = new Set();
  const tableNames = new Set();
  const unique = (used, name, label, sep) => {
    let n = used.has(name) && label ? `${name}${sep}${label}` : name;
    for (let i = 2; used.has(n); i++) n = `${name}${sep}${i}`;
    used.add(n);
    return n;
  };
  parts.forEach(({ book, label = '' }, i) => {
    const prefix = `b${i}.`;
    for (const [k, v] of Object.entries(book.styles || {})) styles[prefix + k] = v;
    for (const sheet of book.sheets) {
      const rows = sheet.rows.map((r) => ({
        ...r,
        cells: (r.cells || []).map((c) => (c && typeof c === 'object' && !Array.isArray(c) && c.s ? { ...c, s: prefix + c.s } : c)),
      }));
      const out = { ...sheet, name: unique(sheetNames, sheet.name, label, ' · '), rows };
      if (sheet.table) out.table = { ...sheet.table, name: unique(tableNames, sheet.table.name, label.replace(/\W/g, ''), '_') };
      sheets.push(out);
    }
  });
  return { title: title ?? parts[0]?.book.title, creator: CREATOR, date: date ?? parts[0]?.book.date, styles, sheets };
}
