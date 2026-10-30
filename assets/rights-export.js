/**
 * Export Excel de « Qui peut faire quoi ? » : la matrice de l'onglet Accès, une feuille de
 * détail filtrable (une ligne par case) et les paramètres de lecture.
 * Module pur : le classeur est décrit ici, écrit par xlsx.js.
 */
import { ACTIONS, ACTION_LABEL, cellSentence, cellSteps, cellCategory, decisiveRule, unknownCases } from './rights-matrix.js?v=3.5.0';
import { writeXlsx, colName, cellRef } from './xlsx.js?v=3.5.0';

const BLUE = '000091', GREY = 'F6F6F6', LINE = 'EEEEEE', EDGE = 'DDDDDD', WHITE = 'FFFFFF';
const TONE = { ok: ['DFFEE6', '18753C'], ko: ['FFE9E9', 'CE0500'], uk: ['EEEEEE', '3A3A3A'] };

// Feuille « Qui peut faire quoi » : le rendu de la vue « Par table et par colonne » de l'onglet Accès
// (en-têtes gris, colonnes en retrait, cases en badges séparés par un liseré blanc).
const STYLES = {
  title: { font: { bold: true, size: 16, color: '161616' } },
  subtitle: { font: { size: 10, color: '666666' } },
  note: { font: { size: 10, color: '666666' }, align: { wrap: true, v: 'top' } },
  hGroup: { font: { bold: true, size: 11, color: '161616' }, fill: GREY, border: { top: EDGE } },
  hGroupEdge: { font: { bold: true, size: 11, color: '161616' }, fill: GREY, border: { top: EDGE, left: EDGE } },
  hSub: { font: { size: 9, color: '666666' }, fill: GREY },
  hSubEdge: { font: { size: 9, color: '666666' }, fill: GREY, border: { left: EDGE } },
  hLabel: { font: { bold: true, size: 9, color: '3A3A3A' }, fill: GREY, border: { bottom: EDGE }, align: { v: 'bottom' } },
  hAction: { font: { bold: true, size: 9, color: '3A3A3A' }, fill: GREY, border: { bottom: EDGE }, align: { h: 'center', v: 'center' } },
  hActionEdge: { font: { bold: true, size: 9, color: '3A3A3A' }, fill: GREY, border: { bottom: EDGE, left: EDGE }, align: { h: 'center', v: 'center' } },
  sLabel: { font: { bold: true, size: 11, color: '161616' }, fill: GREY, border: { bottom: EDGE }, align: { v: 'center' } },
  sSub: { font: { size: 9, color: '666666' }, fill: GREY, border: { bottom: EDGE }, align: { v: 'center' } },
  table: { font: { bold: true, size: 11, color: '161616' }, border: { bottom: LINE }, align: { v: 'center' } },
  tableFaint: { font: { size: 9, color: '929292' }, border: { bottom: LINE }, align: { v: 'center' } },
  column: { font: { size: 10, color: '3A3A3A' }, border: { bottom: LINE }, align: { v: 'center', indent: 2 } },
  blank: { border: { bottom: LINE } },
  na: { font: { size: 10, color: '929292' }, border: { bottom: LINE }, align: { h: 'center', v: 'center' } },
  naEdge: { font: { size: 10, color: '929292' }, border: { bottom: LINE, left: EDGE }, align: { h: 'center', v: 'center' } },
  // Feuilles « Détail par case » et « Paramètres »
  head: { font: { bold: true, size: 10, color: '161616' }, fill: GREY, border: { bottom: EDGE }, align: { v: 'center', wrap: true } },
  text: { font: { size: 10 }, border: { bottom: LINE }, align: { v: 'top', wrap: true } },
  textMuted: { font: { size: 10, color: '3A3A3A' }, border: { bottom: LINE }, align: { v: 'top', wrap: true } },
  mono: { font: { size: 9, name: 'Consolas', color: '3A3A3A' }, border: { bottom: LINE }, align: { v: 'top', wrap: true } },
  key: { font: { bold: true, size: 10 }, border: { bottom: LINE }, fill: GREY, align: { v: 'top', wrap: true } },
  ...Object.fromEntries(Object.entries(TONE).flatMap(([k, [fill, color]]) => {
    const font = { bold: true, size: 9, color };
    return [
      [k, { font, fill, border: { all: WHITE, style: 'medium' }, align: { h: 'center', v: 'center', wrap: true } }],
      [`${k}Wide`, { font, fill, border: { top: WHITE, bottom: WHITE, style: 'medium' }, align: { h: 'centerContinuous', v: 'center' } }],
      [`${k}Left`, { font: { bold: true, size: 10, color }, fill, border: { bottom: LINE }, align: { v: 'top', wrap: true } }],
    ];
  })),
};

/** Texte complet de la case (sans « … » : toutes les colonnes qui décident). */
const fullText = (c) => ({ allow: 'Oui', deny: 'Non', unknown: '?', na: '—' }[c.state] ?? c.labels.join(' + '));
const tone = (c) => (c.state === 'allow' || c.state === 'rows-allow' ? 'ok' : c.state === 'deny' || c.state === 'rows-deny' ? 'ko' : c.state === 'na' ? 'na' : 'uk');
/** Case de la matrice, en badge (MAJUSCULES comme dans le widget). */
const badgeCell = (c, edge) => (c.state === 'na' ? { v: '—', s: edge ? 'naEdge' : 'na' } : { v: fullText(c).toUpperCase(), s: tone(c) });
const fmtDate = (d) => `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

export const MATRIX_HELP = 'Pour chaque rôle métier, ce que permettent les règles. Une case verte qui nomme une colonne : oui, mais seulement sur les lignes où cette colonne correspond à la personne. En rouge : oui, sauf sur ces lignes. « ? » : condition que le widget ne sait pas lire, à vérifier dans Grist. « — » : sans objet pour une colonne.';
export const MATRIX_WARNING = 'Lecture des règles, sans connexion réelle : pour un cas sensible, vérifiez avec « Voir en tant que » dans Grist.';

/**
 * Description du classeur (testable) ; matrixXlsx() l'écrit.
 * @param {object} mx  buildMatrix()
 */
export function matrixWorkbook(mx, { docName = '', date = new Date() } = {}) {
  const n = mx.groups.length * ACTIONS.length;
  const lastCol = 2 + n - 1;
  const attrTable = mx.role?.table || '';
  const sub = `${docName || 'Document Grist'} · lu le ${fmtDate(date)} · rôle Grist supposé : Éditeur`;

  // ---- Feuille 1 : la matrice, comme la vue « Par table et par colonne » ----
  const rows = [];
  const merges = [`A3:${colName(lastCol)}3`];
  rows.push({ height: 26, cells: [{ v: `Qui peut faire quoi ? · ${mx.tableCount} tables`, s: 'title' }] });
  rows.push({ height: 16, cells: [{ v: sub, s: 'subtitle' }] });
  rows.push({ height: 30, cells: [{ v: `${MATRIX_HELP} ${MATRIX_WARNING}`, s: 'note' }] });
  rows.push({ height: 8, cells: [] });
  // En-tête sur trois lignes : rôle métier, sa définition, puis les actions (ligne des filtres)
  const groupCells = [], subCells = [], actionCells = [];
  mx.groups.forEach((g) => ACTIONS.forEach(([, label], k) => {
    groupCells.push({ v: k ? '' : g.name, s: k ? 'hGroup' : 'hGroupEdge' });
    subCells.push({ v: k ? '' : g.sub, s: k ? 'hSub' : 'hSubEdge' });
    actionCells.push({ v: label, s: k ? 'hAction' : 'hActionEdge' });
  }));
  rows.push({ height: 20, cells: [{ v: '', s: 'hGroup' }, { v: '', s: 'hGroup' }, ...groupCells] });
  rows.push({ height: 15, cells: [{ v: '', s: 'hSub' }, { v: '', s: 'hSub' }, ...subCells] });
  rows.push({ height: 20, cells: [{ v: 'Table', s: 'hLabel' }, { v: 'Colonne', s: 'hLabel' }, ...actionCells] });
  for (const row of mx.rows) {
    if (row.kind === 'structure') {
      // Une seule case par rôle, centrée sur ses quatre colonnes (sans fusion : tri et filtres restent possibles)
      rows.push({ height: 26, cells: [{ v: row.label, s: 'sLabel' }, { v: 'Tables, colonnes et formules', s: 'sSub' },
        ...mx.groups.flatMap((g, gi) => { const c = mx.cell(row.key, gi, 'S'); return ACTIONS.map((_, k) => ({ v: k ? '' : fullText(c).toUpperCase(), s: `${tone(c)}Wide` })); })] });
      continue;
    }
    const isCol = row.kind === 'column';
    rows.push({ height: isCol ? 20 : 22, cells: [
      { v: row.table, s: isCol ? 'tableFaint' : 'table' },
      { v: isCol ? row.column : '', s: isCol ? 'column' : 'blank' },
      ...mx.groups.flatMap((g, gi) => ACTIONS.map(([bit], k) => badgeCell(mx.cell(row.key, gi, bit), k === 0))),
    ] });
  }
  const matrix = {
    name: 'Qui peut faire quoi', tabColor: BLUE, showGrid: false, landscape: true,
    cols: [30, 24, ...Array(n).fill(11.5)],
    rows, merges,
    freeze: { rows: 7, cols: 2 },
    autoFilter: `A7:${cellRef(rows.length - 1, lastCol)}`,
    printTitles: '$5:$7',
  };

  // ---- Feuille 2 : une ligne par case, en tableau Excel ----
  const headers = ['Rôle métier', 'Niveau', 'Table', 'Colonne', 'Action', 'Résultat', 'Ce qui décide', 'Explication', 'Règle qui tranche', 'Règles examinées, dans l\'ordre'];
  const detail = [{ height: 20, cells: headers.map((h) => ({ v: h, s: 'head' })) }];
  for (const row of mx.rows) {
    const bits = row.kind === 'structure' ? ['S'] : row.kind === 'column' ? ['R', 'U'] : ACTIONS.map(([b]) => b);
    mx.groups.forEach((g, gi) => {
      for (const bit of bits) {
        const c = mx.cell(row.key, gi, bit);
        const steps = cellSteps(c, bit).map((s, i) => `${i + 1}. ${s.title} — ${s.badge}${s.condition ? ` — ${s.condition}` : ''}`);
        detail.push({ cells: [
          { v: g.name, s: 'text' },
          { v: { structure: 'Structure', table: 'Table', column: 'Colonne' }[row.kind], s: 'textMuted' },
          { v: row.kind === 'structure' ? 'Toutes les tables' : row.table, s: 'text' },
          { v: row.column || '', s: 'text' },
          { v: bit === 'S' ? 'Modifier la structure' : ACTION_LABEL[bit], s: 'text' },
          { v: cellCategory(c), s: `${tone(c)}Left` },
          { v: c.labels?.length ? c.labels.join(' + ') : '', s: 'text' },
          { v: cellSentence(c, { attrTable }), s: 'text' },
          { v: decisiveRule(c), s: 'text' },
          { v: steps.join('\n'), s: 'mono' },
        ] });
      }
    });
  }
  const detailSheet = {
    name: 'Détail par case', tabColor: '18753C', landscape: true,
    cols: [16, 11, 26, 20, 20, 16, 22, 60, 30, 80],
    rows: detail,
    freeze: { rows: 1, cols: 0 },
    table: { name: 'Droits', ref: `A1:${cellRef(detail.length - 1, headers.length - 1)}`, style: 'TableStyleLight1' },
    printTitles: '$1:$1',
  };

  // ---- Feuille 3 : paramètres et lecture ----
  const p = [{ height: 24, cells: [{ v: 'Paramètres et lecture', s: 'title' }] }, { height: 6, cells: [] }];
  const kv = (k, v, s = 'text') => p.push({ cells: [{ v: k, s: 'key' }, { v, s }] });
  kv('Document', docName || 'Document Grist');
  kv('Règles lues le', fmtDate(date));
  kv('Rôle Grist supposé', 'Éditeur. Les propriétaires et les lecteurs ne sont pas représentés ; les conditions sur user.Access sont lues pour un éditeur.');
  kv('Rôle métier', mx.role ? `${mx.role.attr}.${mx.role.col}${attrTable ? `, lu dans la table ${attrTable}` : ''} : la colonne comparée au plus grand nombre de valeurs dans les règles.` : 'Aucun rôle métier reconnu dans les règles : un seul groupe « Éditeurs ».');
  for (const g of mx.groups) kv(`Groupe « ${g.name} »`, g.sub);
  kv('Ordre appliqué', 'Règles de la colonne, puis de la table, puis du document ; la première qui s\'applique décide, action par action. Sans règle qui décide, le droit par défaut d\'un éditeur s\'applique (tout est permis).');
  kv('Personnes nommées', 'Les exceptions pour une personne précise (user.Email == …) ne sont pas représentées.');
  p.push({ height: 6, cells: [] });
  p.push({ cells: [{ v: 'Légende', s: 'head' }, { v: '', s: 'head' }] });
  for (const [v, s, text] of [['Oui', 'okLeft', 'Permis sur toutes les lignes.'], ['Non', 'koLeft', 'Refusé sur toutes les lignes.'],
    ['Nom de colonne', 'okLeft', 'Oui, mais seulement sur les lignes où cette colonne correspond à la personne (ou si cette case de son habilitation est renseignée).'],
    ['Nom de colonne', 'koLeft', 'Oui, sauf sur les lignes où cette colonne correspond à la personne.'],
    ['?', 'ukLeft', 'Condition que le widget ne sait pas lire (attribut inexistant, fonction, forme non prise en charge) : à vérifier dans Grist.'],
    ['—', 'na', 'Sans objet : on ne crée ni ne supprime une colonne seule.']]) p.push({ cells: [{ v, s }, { v: text, s: 'text' }] });
  const unknown = unknownCases(mx);
  if (unknown.length) {
    p.push({ height: 6, cells: [] });
    p.push({ cells: [{ v: 'À vérifier dans Grist', s: 'head' }, { v: '', s: 'head' }] });
    for (const u of unknown) {
      const where = u.row.kind === 'structure' ? 'Droits de structure' : u.row.kind === 'column' ? `${u.row.table}.${u.row.label}` : u.row.label;
      kv(`${where} · ${u.actions.join(', ')}`, `${u.note || `La condition « ${u.formula} » utilise un attribut inexistant ou une forme non comprise.`}${u.groups.length < mx.groups.length ? ` (${u.groups.join(', ')})` : ''}`);
    }
  }
  p.push({ height: 6, cells: [] });
  kv('Avertissement', MATRIX_WARNING, 'note');
  const params = { name: 'Paramètres', tabColor: '666666', showGrid: false, cols: [34, 100], rows: p };

  return { title: `Qui peut faire quoi ? · ${docName || 'Document Grist'}`, creator: 'Widget Grist « Audit de structure »', date, styles: STYLES, sheets: [matrix, detailSheet, params] };
}

/** @returns {Uint8Array} le fichier .xlsx */
export function matrixXlsx(mx, opts) {
  return writeXlsx(matrixWorkbook(mx, opts));
}

