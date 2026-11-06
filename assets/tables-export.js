/**
 * Export Excel des tables, au format du modèle « Table pour exportation » :
 *  - « Tables » : chaque table l'une sous l'autre, son nom puis les sept colonnes du modèle ;
 *  - « Toutes les colonnes » : les mêmes lignes en tableau Excel filtrable, précédées du nom de la table.
 * Module pur.
 */
import { TABLE_COLUMNS, tableRows, rowValues } from './table-format.js?v=3.18.0';
import { frenchDateTime as fmtDate } from './util.js?v=3.18.0';
import { xlsxColor as X } from './theme.js?v=3.18.0';
import { writeXlsx, cellRef } from './xlsx.js?v=3.18.0';

const GREY = X('surface'), LINE = X('subtle'), EDGE = X('border');
const STYLES = {
  title: { font: { bold: true, size: 16, color: X('text') } },
  subtitle: { font: { size: 10, color: X('muted') } },
  table: { font: { bold: true, size: 13, color: X('primary') } },
  summary: { font: { bold: true, size: 13, color: X('summary') } },
  desc: { font: { size: 10, color: X('muted') }, align: { wrap: false } },
  head: { font: { bold: true, size: 10, color: X('text') }, fill: GREY, border: { bottom: EDGE, top: EDGE }, align: { v: 'center', wrap: true } },
  name: { font: { size: 10, color: X('text') }, border: { bottom: LINE }, align: { v: 'top', wrap: true } },
  key: { font: { bold: true, size: 10, color: X('text') }, border: { bottom: LINE }, align: { v: 'top' } },
  text: { font: { size: 10, color: X('neutral') }, border: { bottom: LINE }, align: { v: 'top', wrap: true } },
  sql: { font: { size: 9, name: 'Consolas', color: X('neutral') }, border: { bottom: LINE }, align: { v: 'top' } },
  type: { font: { size: 10, color: X('type') }, border: { bottom: LINE }, align: { v: 'top', wrap: true } },
  computed: { font: { bold: true, size: 10, color: X('formula') }, border: { bottom: LINE }, align: { v: 'top' } },
  formula: { font: { size: 9, name: 'Consolas', color: X('neutral') }, border: { bottom: LINE }, align: { v: 'top', wrap: true } },
  muted: { font: { size: 10, color: X('line') }, border: { bottom: LINE }, align: { v: 'top' } },
  doc: { font: { bold: true, size: 10, color: X('type') }, border: { bottom: LINE }, align: { v: 'top' } },
  noDoc: { font: { bold: true, size: 10, color: X('improve') }, border: { bottom: LINE }, align: { v: 'top' } },
};
const STYLE_OF = ['name', 'text', 'sql', 'type', 'text', 'computed', 'formula', 'doc'];
const styleOf = (r, v, i) => (r.isKey && i === 0 ? 'key' : v === 'Non calculé' || v === 'Non concerné' ? 'muted' : v === 'Pas de documentation' ? 'noDoc' : STYLE_OF[i]);
const cells = (r) => rowValues(r).map((v, i) => ({ v, s: styleOf(r, v, i) }));

/** @param {Array} tables  tables de sortie du convertisseur */
export function tablesWorkbook(tables, { docName = '', date = new Date() } = {}) {
  const rows = [
    { height: 26, cells: [{ v: 'Tables et colonnes', s: 'title' }] },
    { cells: [{ v: `${docName || 'Document Grist'} · lu le ${fmtDate(date)} · ${tables.length} tables`, s: 'subtitle' }] },
  ];
  const flat = [{ height: 20, cells: ['Table', ...TABLE_COLUMNS].map((v) => ({ v, s: 'head' })) }];
  for (const t of tables) {
    rows.push({ height: 10, cells: [] });
    rows.push({ height: 22, cells: [{ v: t.kind === 'summary' ? `${t.name} (synthèse)` : t.name, s: t.kind === 'summary' ? 'summary' : 'table' }] });
    if (t.description) rows.push({ cells: [{ v: t.description, s: 'desc' }] });
    rows.push({ height: 20, cells: TABLE_COLUMNS.map((v) => ({ v, s: 'head' })) });
    for (const r of tableRows(t)) {
      rows.push({ cells: cells(r) });
      flat.push({ cells: [{ v: t.name, s: 'name' }, ...cells(r)] });
    }
  }
  const widths = [30, 30, 12, 32, 14, 13, 70, 20];
  return {
    title: `Tables et colonnes · ${docName || 'Document Grist'}`, creator: 'Widget Grist « Audit de structure »', date, styles: STYLES,
    sheets: [
      { name: 'Tables', tabColor: X('primary'), showGrid: false, landscape: true, cols: widths, rows },
      { name: 'Toutes les colonnes', tabColor: X('type'), landscape: true, cols: [26, ...widths], rows: flat, freeze: { rows: 1, cols: 0 },
        table: { name: 'Colonnes', ref: `A1:${cellRef(flat.length - 1, TABLE_COLUMNS.length)}`, style: 'TableStyleLight1' } },
    ],
  };
}

export const tablesXlsx = (tables, opts) => writeXlsx(tablesWorkbook(tables, opts));


