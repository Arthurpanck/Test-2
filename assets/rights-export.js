/**
 * Export Excel de l'onglet Accès : droits d'accès (réglages, attributs, règles par table), puis
 * « Qui peut faire quoi ? » (matrice et paramètres de lecture).
 * Module pur : le classeur est décrit ici, écrit par xlsx.js.
 */
import { ACTIONS, ACTION_LABEL, unknownCases } from './rights-matrix.js';
import { frenchDateTime as fmtDate, plural } from './util.js';
import { xlsxColor as X } from './theme.js';
import { writeXlsx, colName, cellRef } from './xlsx.js';
import { BASE_STYLES, COLOR, CREATOR, combineWorkbooks, paramsSheet, sheetBuilder } from './xlsx-kit.js';

const BLUE = COLOR.blue,
  GREY = COLOR.grey,
  LINE = COLOR.line,
  EDGE = COLOR.edge,
  WHITE = COLOR.white;
const TONE = { ok: [X('fillOk'), X('ready')], ko: [X('fillKo'), X('blocking')], uk: [X('subtle'), X('neutral')] };

// Feuille « Qui peut faire quoi » : le rendu de la vue « Par table et par colonne » de l'onglet Accès
// (en-têtes gris, colonnes en retrait, cases en badges séparés par un liseré blanc).
const STYLES = {
  title: BASE_STYLES.title,
  subtitle: BASE_STYLES.subtitle,
  note: BASE_STYLES.note,
  pHead: BASE_STYLES.pHead,
  pKey: BASE_STYLES.pKey,
  pText: BASE_STYLES.pText,
  hGroup: { font: { bold: true, size: 11, color: X('text') }, fill: GREY, border: { top: EDGE } },
  hGroupEdge: { font: { bold: true, size: 11, color: X('text') }, fill: GREY, border: { top: EDGE, left: EDGE } },
  hSub: { font: { size: 9, color: X('muted') }, fill: GREY },
  hSubEdge: { font: { size: 9, color: X('muted') }, fill: GREY, border: { left: EDGE } },
  hLabel: { font: { bold: true, size: 9, color: X('neutral') }, fill: GREY, border: { bottom: EDGE }, align: { v: 'bottom' } },
  hAction: {
    font: { bold: true, size: 9, color: X('neutral') },
    fill: GREY,
    border: { bottom: EDGE },
    align: { h: 'center', v: 'center' },
  },
  hActionEdge: {
    font: { bold: true, size: 9, color: X('neutral') },
    fill: GREY,
    border: { bottom: EDGE, left: EDGE },
    align: { h: 'center', v: 'center' },
  },
  sLabel: { font: { bold: true, size: 11, color: X('text') }, fill: GREY, border: { bottom: EDGE }, align: { v: 'center' } },
  sSub: { font: { size: 9, color: X('muted') }, fill: GREY, border: { bottom: EDGE }, align: { v: 'center' } },
  table: { font: { bold: true, size: 11, color: X('text') }, border: { bottom: LINE }, align: { v: 'center' } },
  tableFaint: { font: { size: 9, color: X('line') }, border: { bottom: LINE }, align: { v: 'center' } },
  column: { font: { size: 10, color: X('neutral') }, border: { bottom: LINE }, align: { v: 'center', indent: 2 } },
  blank: { border: { bottom: LINE } },
  na: { font: { size: 10, color: X('line') }, border: { bottom: LINE }, align: { h: 'center', v: 'center' } },
  naEdge: { font: { size: 10, color: X('line') }, border: { bottom: LINE, left: EDGE }, align: { h: 'center', v: 'center' } },
  ...Object.fromEntries(
    Object.entries(TONE).flatMap(([k, [fill, color]]) => {
      const font = { bold: true, size: 9, color };
      return [
        [k, { font, fill, border: { all: WHITE, style: 'medium' }, align: { h: 'center', v: 'center', wrap: true } }],
        [`${k}Wide`, { font, fill, border: { top: WHITE, bottom: WHITE, style: 'medium' }, align: { h: 'centerContinuous', v: 'center' } }],
        [`${k}Left`, { font: { bold: true, size: 10, color }, fill, border: { bottom: LINE }, align: { v: 'top', wrap: true } }],
      ];
    }),
  ),
};

/** Texte complet de la case (sans « … » : toutes les colonnes qui décident). */
const fullText = (c) => ({ allow: 'Oui', deny: 'Non', unknown: '?', na: '—' })[c.state] ?? c.labels.join(' + ');
const tone = (c) =>
  c.state === 'allow' || c.state === 'rows-allow'
    ? 'ok'
    : c.state === 'deny' || c.state === 'rows-deny'
      ? 'ko'
      : c.state === 'na'
        ? 'na'
        : 'uk';
/** Case de la matrice, en badge (MAJUSCULES comme dans la vue). */
const badgeCell = (c, edge) => (c.state === 'na' ? { v: '—', s: edge ? 'naEdge' : 'na' } : { v: fullText(c).toUpperCase(), s: tone(c) });

export const MATRIX_HELP =
  'Pour chaque rôle métier, ce que permettent les règles. Une case verte qui nomme une colonne : oui, mais seulement sur les lignes où cette colonne correspond à la personne. En rouge : oui, sauf sur ces lignes. « ? » : condition que la vue ne sait pas lire, à vérifier dans Grist. « — » : sans objet pour une colonne.';
export const MATRIX_WARNING =
  'Lecture des règles, sans connexion réelle : pour un cas sensible, vérifiez avec « Voir en tant que » dans Grist.';

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
  const groupCells = [],
    subCells = [],
    actionCells = [];
  mx.groups.forEach((g) =>
    ACTIONS.forEach(([, label], k) => {
      groupCells.push({ v: k ? '' : g.name, s: k ? 'hGroup' : 'hGroupEdge' });
      subCells.push({ v: k ? '' : g.sub, s: k ? 'hSub' : 'hSubEdge' });
      actionCells.push({ v: label, s: k ? 'hAction' : 'hActionEdge' });
    }),
  );
  rows.push({ height: 20, cells: [{ v: '', s: 'hGroup' }, { v: '', s: 'hGroup' }, ...groupCells] });
  rows.push({ height: 15, cells: [{ v: '', s: 'hSub' }, { v: '', s: 'hSub' }, ...subCells] });
  rows.push({ height: 20, cells: [{ v: 'Table', s: 'hLabel' }, { v: 'Colonne', s: 'hLabel' }, ...actionCells] });
  for (const row of mx.rows) {
    if (row.kind === 'structure') {
      // Une seule case par rôle, centrée sur ses quatre colonnes (sans fusion : tri et filtres restent possibles)
      rows.push({
        height: 26,
        cells: [
          { v: row.label, s: 'sLabel' },
          { v: 'Tables, colonnes et formules', s: 'sSub' },
          ...mx.groups.flatMap((g, gi) => {
            const c = mx.cell(row.key, gi, 'S');
            return ACTIONS.map((_, k) => ({ v: k ? '' : fullText(c).toUpperCase(), s: `${tone(c)}Wide` }));
          }),
        ],
      });
      continue;
    }
    const isCol = row.kind === 'column';
    rows.push({
      height: isCol ? 20 : 22,
      cells: [
        { v: row.table, s: isCol ? 'tableFaint' : 'table' },
        { v: isCol ? row.column : '', s: isCol ? 'column' : 'blank' },
        ...mx.groups.flatMap((g, gi) => ACTIONS.map(([bit], k) => badgeCell(mx.cell(row.key, gi, bit), k === 0))),
      ],
    });
  }
  const matrix = {
    name: 'Qui peut faire quoi',
    tabColor: BLUE,
    showGrid: false,
    landscape: true,
    cols: [30, 24, ...Array(n).fill(11.5)],
    rows,
    merges,
    freeze: { rows: 7, cols: 2 },
    autoFilter: `A7:${cellRef(rows.length - 1, lastCol)}`,
    printTitles: '$5:$7',
  };

  // ---- Feuille 2 : paramètres et lecture ----
  const kv = (k, v, s = 'pText') => ({
    cells: [
      { v: k, s: 'pKey' },
      { v, s },
    ],
  });
  const headRow = (v) => ({
    cells: [
      { v, s: 'pHead' },
      { v: '', s: 'pHead' },
    ],
  });
  const extra = [{ height: 6, cells: [] }, headRow('Légende')];
  for (const [v, s, text] of [
    ['Oui', 'okLeft', 'Permis sur toutes les lignes.'],
    ['Non', 'koLeft', 'Refusé sur toutes les lignes.'],
    [
      'Nom de colonne',
      'okLeft',
      'Oui, mais seulement sur les lignes où cette colonne correspond à la personne (ou si cette case de son habilitation est renseignée).',
    ],
    ['Nom de colonne', 'koLeft', 'Oui, sauf sur les lignes où cette colonne correspond à la personne.'],
    [
      '?',
      'ukLeft',
      'Condition que la vue ne sait pas lire (attribut inexistant, fonction, forme non prise en charge) : à vérifier dans Grist.',
    ],
    ['—', 'na', 'Sans objet : on ne crée ni ne supprime une colonne seule.'],
  ])
    extra.push({
      cells: [
        { v, s },
        { v: text, s: 'pText' },
      ],
    });
  const unknown = unknownCases(mx);
  if (unknown.length) {
    extra.push({ height: 6, cells: [] }, headRow('À vérifier dans Grist'));
    for (const u of unknown) {
      const where =
        u.row.kind === 'structure' ? 'Droits de structure' : u.row.kind === 'column' ? `${u.row.table}.${u.row.label}` : u.row.label;
      extra.push(
        kv(
          `${where} · ${u.actions.join(', ')}`,
          `${u.note || `La condition « ${u.formula} » utilise un attribut inexistant ou une forme non comprise.`}${u.groups.length < mx.groups.length ? ` (${u.groups.join(', ')})` : ''}`,
        ),
      );
    }
  }
  extra.push({ height: 6, cells: [] }, kv('Avertissement', MATRIX_WARNING, 'note'));
  const params = {
    ...paramsSheet({
      doc: docName || 'Document Grist',
      date,
      dateLabel: 'Règles lues le',
      facts: [
        [
          'Rôle Grist supposé',
          'Éditeur. Les propriétaires et les lecteurs ne sont pas représentés ; les conditions sur user.Access sont lues pour un éditeur.',
        ],
        [
          'Rôle métier',
          mx.role
            ? `${mx.role.attr}.${mx.role.col}${attrTable ? `, lu dans la table ${attrTable}` : ''} : la colonne comparée au plus grand nombre de valeurs dans les règles.`
            : 'Aucun rôle métier reconnu dans les règles : un seul groupe « Éditeurs ».',
        ],
        ...mx.groups.map((g) => [`Groupe « ${g.name} »`, g.sub]),
        [
          'Ordre appliqué',
          "Règles de la colonne, puis de la table, puis du document ; la première qui s'applique décide, action par action. Sans règle qui décide, le droit par défaut d'un éditeur s'applique (tout est permis).",
        ],
        ['Personnes nommées', 'Les exceptions pour une personne précise (user.Email == …) ne sont pas représentées.'],
      ],
      extra,
    }),
    cols: [34, 100],
  };

  return {
    title: `Qui peut faire quoi ? · ${docName || 'Document Grist'}`,
    creator: CREATOR,
    date,
    styles: STYLES,
    sheets: [matrix, params],
  };
}

// ---------------------------------------------------------------------------
// Export Excel des droits d'accès (bouton « Exporter en Excel » de l'onglet Accès) : présenté comme
// l'export des tables (titre, un bloc par table, en-têtes gris, pastilles), avec la matrice en onglets.
// ---------------------------------------------------------------------------

const PERM = { allow: ['Autorisé', 'pillOk'], deny: ['Refusé', 'pillKo'] };
const ACCESS_HELP =
  "Réglages généraux, attributs utilisateur, puis les règles du document et de chaque table, colonnes comprises. Les conditions s'appliquent dans l'ordre : la première qui correspond à la personne décide, action par action ; « — » : rien n'est décidé ici. Les règles d'une colonne passent avant celles de sa table, puis celles du document. Onglets suivants : « Qui peut faire quoi ? » et ses paramètres de lecture.";

/**
 * Classeur des droits d'accès. Module pur.
 * @param {object} access  buildAccess()
 * @param {Array} settings  generalSettings(access)
 * @param {object|null} mx  buildMatrix() : ses feuilles sont ajoutées en onglets
 */
export function accessWorkbook(access, settings = [], mx = null, { docName = '', date = new Date() } = {}) {
  const doc = docName || 'Document Grist';
  const BITS = ['R', 'U', 'C', 'D', 'S'];
  const W = 8; // colonnes : Qui, Condition, 5 permissions, Message
  const conditionCount = access.ruleCount ?? 0;
  const sheet = sheetBuilder(W, {
    title: `Droits d'accès · ${plural(conditionCount, 'condition', 'conditions')}`,
    subtitle: `${doc} · lu le ${fmtDate(date)} · ${plural(access.tables.length, 'table protégée', 'tables protégées')} · ${plural(access.attributes.length, 'attribut', 'attributs')}`,
    help: ACCESS_HELP,
    helpHeight: 42,
  });
  const { rows } = sheet;
  const block = (title, meta) => sheet.block(title, meta);
  const head = (labels) => sheet.head(labels, 20);
  /** Règles d'un ensemble (document, table, colonnes) : une ligne par condition. */
  const ruleRows = (list, bits) => {
    head(['Qui', 'Condition', ...BITS.map((b) => (bits.includes(b) ? ACTION_LABEL[b] || b : '')), 'Message en cas de refus']);
    for (const r of list)
      rows.push({
        cells: [
          { v: r.who.text, s: 'strong' },
          { v: r.formula || '(toutes les autres personnes)', s: r.formula ? 'mono' : 'muted' },
          ...BITS.map((b) => {
            if (!bits.includes(b)) return { v: '', s: 'text' };
            const [v, st] = PERM[r.perms[b]] || ['—', 'dash'];
            return { v, s: st };
          }),
          { v: r.memo || '', s: 'small' },
        ],
      });
  };

  // Réglages généraux
  block('Réglages généraux', 'Valables pour tout le document');
  head(['Réglage', 'Explication', 'État', '', '', '', '', '']);
  for (const g of settings)
    rows.push({
      cells: [
        { v: g.name, s: 'strong' },
        { v: g.text, s: 'small' },
        { v: g.state, s: g.level === 'warning' ? 'pillWarn' : g.level === 'success' || g.on ? 'pillOk' : 'pillInfo' },
      ],
    });
  // Attributs utilisateur
  block('Attributs utilisateur', plural(access.attributes.length, 'attribut', 'attributs'));
  head(['Attribut', 'Cherché dans', 'État', '', '', '', '', '']);
  if (!access.attributes.length) rows.push({ cells: [{ v: 'Aucun attribut utilisateur.', s: 'muted' }] });
  for (const x of access.attributes)
    rows.push({
      cells: [
        { v: `user.${x.name}`, s: 'mono' },
        { v: `${x.tableId}.${x.lookupColId}, en comparant à user.${x.charId}`, s: 'text' },
        { v: x.problems.length ? x.problems.join(', ') : 'Correct', s: x.problems.length ? 'pillKo' : 'pillOk' },
      ],
    });
  // Règles par défaut, puis chaque table et ses colonnes
  block('Droits d’accès par défaut', `Toutes les tables · ${plural(access.defaults.length, 'condition', 'conditions')}`);
  if (access.defaults.length) ruleRows(access.defaults, BITS);
  else rows.push({ cells: [{ v: 'Aucune règle par défaut.', s: 'muted' }] });
  for (const t of access.tables) {
    const n = t.rules.length + t.columns.reduce((k, c) => k + c.rules.length, 0);
    const cols = t.columns.map((c) => c.colIds.join(', '));
    block(
      t.tableId,
      [plural(n, 'condition', 'conditions'), cols.length ? `colonnes protégées : ${cols.join(' ; ')}` : ''].filter(Boolean).join(' · '),
    );
    if (t.rules.length) ruleRows(t.rules, ['R', 'U', 'C', 'D']);
    for (const c of t.columns) {
      rows.push({ height: 10, cells: [] });
      rows.push({ height: 18, cells: [{ v: `${c.colIds.length > 1 ? 'Colonnes' : 'Colonne'} ${c.colIds.join(', ')}`, s: 'blockSub' }] });
      ruleRows(c.rules, ['R', 'U']);
    }
  }
  const specials = access.special.filter((sp) => sp.rules.length);
  if (specials.length) {
    block('Réglages spéciaux', 'Cases de la page « Règles d’accès » de Grist');
    for (const sp of specials) {
      rows.push({ height: 18, cells: [{ v: sp.label, s: 'blockSub' }] });
      ruleRows(sp.rules, BITS);
    }
  }
  const main = {
    name: "Droits d'accès",
    tabColor: BLUE,
    showGrid: false,
    landscape: true,
    cols: [34, 44, 11, 11, 11, 11, 11, 44],
    rows,
    merges: sheet.merges,
    freeze: { rows: 3, cols: 0 },
  };
  const book = { title: `Droits d'accès · ${doc}`, creator: CREATOR, date, styles: BASE_STYLES, sheets: [main] };
  if (!mx?.hasRules) return book;
  return combineWorkbooks([{ book }, { book: matrixWorkbook(mx, { docName, date }), label: 'matrice' }], { title: book.title, date });
}

/** @returns {Uint8Array} le fichier .xlsx */
export function accessXlsx(access, settings, mx, opts) {
  return writeXlsx(accessWorkbook(access, settings, mx, opts));
}
