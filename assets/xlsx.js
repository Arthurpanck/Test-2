/**
 * Petit écrivain de classeurs Excel (.xlsx, SpreadsheetML), sans dépendance ni réseau :
 * feuilles, styles nommés, cellules fusionnées, volets figés, filtres automatiques,
 * tableaux Excel (filtres et bandes), mise en page. Le zip est écrit sans compression.
 *
 * Module pur : testé sous Node, utilisé tel quel dans le navigateur.
 *
 * Classeur : { title, creator, sheets: [Feuille], styles: { nom: Style } }
 * Feuille : { name, cols: [largeurs], rows: [{ cells: [Cellule], height }], merges: ['A1:C1'],
 *             freeze: { rows, cols }, autoFilter: 'A7:O40', table: { name, ref, style },
 *             printTitles: '$5:$7', landscape, showGrid, tabColor }
 * Cellule : null, une valeur, ou { v: texte | nombre, s: nom de style }
 * Style : { font: { bold, italic, size, color, name }, fill, border: true, align: { h, v, wrap, indent } }
 */

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

// Caractères interdits en XML 1.0 retirés ; le reste échappé.
const xml = (s) => String(s ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, '')
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const argb = (hex) => `FF${String(hex).replace('#', '').toUpperCase()}`;

/** Lettres de colonne : 0 → A, 26 → AA. */
export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export const cellRef = (row, col) => `${colName(col)}${row + 1}`;

/** Nom de feuille accepté par Excel (31 caractères, sans []:*?/\). */
export const sheetName = (name) => String(name || 'Feuille').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function buildStyles(named) {
  const fonts = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const index = new Map();
  const add = (list, item) => { let i = list.indexOf(item); if (i < 0) { list.push(item); i = list.length - 1; } return i; };
  for (const [name, st] of Object.entries(named)) {
    const f = st.font || {};
    const font = `<font>${f.bold ? '<b/>' : ''}${f.italic ? '<i/>' : ''}<sz val="${f.size || 11}"/>${f.color ? `<color rgb="${argb(f.color)}"/>` : '<color theme="1"/>'}<name val="${xml(f.name || 'Calibri')}"/><family val="2"/>${f.name ? '' : '<scheme val="minor"/>'}</font>`;
    const fill = st.fill ? `<fill><patternFill patternType="solid"><fgColor rgb="${argb(st.fill)}"/><bgColor indexed="64"/></patternFill></fill>` : null;
    const b = st.border ? (typeof st.border === 'string' ? st.border : 'DDDDDD') : null;
    const side = (tag) => `<${tag} style="thin"><color rgb="${argb(b)}"/></${tag}>`;
    const border = b ? `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>` : null;
    const a = st.align || {};
    const align = (a.h || a.v || a.wrap || a.indent) ? `<alignment${a.h ? ` horizontal="${a.h}"` : ''}${a.v ? ` vertical="${a.v}"` : ''}${a.wrap ? ' wrapText="1"' : ''}${a.indent ? ` indent="${a.indent}"` : ''}/>` : '';
    const fontId = add(fonts, font), fillId = fill ? add(fills, fill) : 0, borderId = border ? add(borders, border) : 0;
    xfs.push(`<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1"${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`);
    index.set(name, xfs.length - 1);
  }
  const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
  return { body, index };
}

// ---------------------------------------------------------------------------
// Feuilles
// ---------------------------------------------------------------------------

function sheetXml(sheet, styleIndex, strings, tableRelId) {
  const sst = (s) => { if (!strings.map.has(s)) { strings.map.set(s, strings.list.length); strings.list.push(s); } return strings.map.get(s); };
  let maxCol = 0;
  const rows = sheet.rows.map((row, r) => {
    const cells = (row?.cells || []).map((raw, c) => {
      if (raw === null || raw === undefined) return '';
      const cell = typeof raw === 'object' ? raw : { v: raw };
      const s = cell.s ? styleIndex.get(cell.s) : undefined;
      if (cell.s && s === undefined) throw new Error(`Style inconnu : ${cell.s}`);
      const attrs = `r="${cellRef(r, c)}"${s ? ` s="${s}"` : ''}`;
      maxCol = Math.max(maxCol, c);
      if (cell.v === null || cell.v === undefined || cell.v === '') return `<c ${attrs}/>`;
      if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return `<c ${attrs}><v>${cell.v}</v></c>`;
      return `<c ${attrs} t="s"><v>${sst(String(cell.v))}</v></c>`;
    }).join('');
    const ht = row?.height ? ` ht="${row.height}" customHeight="1"` : '';
    return `<row r="${r + 1}"${ht}>${cells}</row>`;
  }).join('');
  const last = cellRef(Math.max(0, sheet.rows.length - 1), Math.max(maxCol, (sheet.cols?.length || 1) - 1));
  const f = sheet.freeze;
  const pane = f && (f.rows || f.cols)
    ? `<pane${f.cols ? ` xSplit="${f.cols}"` : ''}${f.rows ? ` ySplit="${f.rows}"` : ''} topLeftCell="${cellRef(f.rows || 0, f.cols || 0)}" activePane="${f.rows && f.cols ? 'bottomRight' : f.rows ? 'bottomLeft' : 'topRight'}" state="frozen"/><selection pane="${f.rows && f.cols ? 'bottomRight' : f.rows ? 'bottomLeft' : 'topRight'}" activeCell="${cellRef(f.rows || 0, f.cols || 0)}" sqref="${cellRef(f.rows || 0, f.cols || 0)}"/>`
    : '';
  const cols = sheet.cols?.length ? `<cols>${sheet.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="${NS_R}"><sheetPr>${sheet.tabColor ? `<tabColor rgb="${argb(sheet.tabColor)}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"${sheet.showGrid === false ? ' showGridLines="0"' : ''}${sheet.index === 0 ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${
    sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : ''}${
    sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''
  }<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sheet.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>${
    tableRelId ? `<tableParts count="1"><tablePart r:id="${tableRelId}"/></tableParts>` : ''}</worksheet>`;
}

function tableXml(t, id, headers) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="${NS}" id="${id}" name="${xml(t.name)}" displayName="${xml(t.name)}" ref="${t.ref}" totalsRowShown="0"><autoFilter ref="${t.ref}"/><tableColumns count="${headers.length}">${
    headers.map((h, i) => `<tableColumn id="${i + 1}" name="${xml(h)}"/>`).join('')}</tableColumns><tableStyleInfo name="${xml(t.style || 'TableStyleLight1')}" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
}

// ---------------------------------------------------------------------------
// Classeur
// ---------------------------------------------------------------------------

/** @returns {Uint8Array} le fichier .xlsx */
export function writeXlsx(book) {
  const { body: stylesXml, index } = buildStyles(book.styles || {});
  const strings = { list: [], map: new Map() };
  const files = [];
  const sheets = book.sheets.map((s, i) => ({ ...s, index: i, name: sheetName(s.name) }));
  let tableId = 0;
  const defined = [];
  for (const s of sheets) {
    const n = s.index + 1;
    let relId = null;
    if (s.table) {
      tableId += 1;
      relId = 'rId1';
      // En-têtes du tableau : la première ligne de sa plage, telle qu'écrite dans la feuille.
      const [a, b] = s.table.ref.split(':');
      const first = Number(a.replace(/^[A-Z]+/, '')) - 1;
      const c0 = colIndex(a), c1 = colIndex(b);
      const headers = [];
      for (let c = c0; c <= c1; c++) { const raw = s.rows[first]?.cells?.[c]; headers.push(String(typeof raw === 'object' && raw ? raw.v : raw ?? `Colonne ${c + 1}`)); }
      files.push([`xl/tables/table${tableId}.xml`, tableXml(s.table, tableId, headers)]);
      files.push([`xl/worksheets/_rels/sheet${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${REL}/table" Target="../tables/table${tableId}.xml"/></Relationships>`]);
    }
    files.push([`xl/worksheets/sheet${n}.xml`, sheetXml(s, index, strings, relId)]);
    const quoted = `'${s.name.replace(/'/g, "''")}'`;
    const abs = (ref) => ref.split(':').map((x) => x.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2')).join(':');
    if (s.autoFilter) defined.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${s.index}" hidden="1">${xml(`${quoted}!${abs(s.autoFilter)}`)}</definedName>`);
    if (s.printTitles) defined.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${s.index}">${xml(`${quoted}!${s.printTitles}`)}</definedName>`);
  }
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${NS}" count="${strings.list.length}" uniqueCount="${strings.list.length}">${strings.list.map((s) => `<si><t xml:space="preserve">${xml(s)}</t></si>`).join('')}</sst>`;
  const now = (book.date || new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  files.push(
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>${
      sheets.map((s) => `<Override PartName="/xl/worksheets/sheet${s.index + 1}.xml" ContentType="${CT}.worksheet+xml"/>`).join('')}${
      Array.from({ length: tableId }, (_, i) => `<Override PartName="/xl/tables/table${i + 1}.xml" ContentType="${CT}.table+xml"/>`).join('')
    }<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="${CT}.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(book.title || '')}</dc:title><dc:creator>${xml(book.creator || '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`],
    ['docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${NS_R}"><workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets>${
      sheets.map((s) => `<sheet name="${xml(s.name)}" sheetId="${s.index + 1}" r:id="rId${s.index + 1}"/>`).join('')}</sheets>${defined.length ? `<definedNames>${defined.join('')}</definedNames>` : ''}</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG}">${sheets.map((s) => `<Relationship Id="rId${s.index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${s.index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/styles.xml', stylesXml],
    ['xl/sharedStrings.xml', sst],
  );
  const enc = new TextEncoder();
  return zipStore(files.map(([name, text]) => ({ name, data: enc.encode(text) })), book.date || new Date());
}

const colIndex = (ref) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// ---------------------------------------------------------------------------
// Zip (méthode « stockée », sans compression)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** @param {Array<{name, data: Uint8Array}>} files */
export function zipStore(files, date = new Date()) {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, time, true); local.setUint16(12, day, true); local.setUint32(14, crc, true);
    local.setUint32(18, size, true); local.setUint32(22, size, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true); central.setUint16(12, time, true); central.setUint16(14, day, true); central.setUint32(16, crc, true);
    central.setUint32(20, size, true); central.setUint32(24, size, true); central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), name, f.data);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = centrals.reduce((n, a) => n + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
