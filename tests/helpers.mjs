// Outils partagés par les tests.

/** Reconstruit des métadonnées à partir du modèle corrigé d'un code (aller-retour). */
export function metadataFromModel(model) {
  const tables = { id: [], tableId: [], summarySourceTable: [] };
  const cols = { id: [], parentId: [], parentPos: [], colId: [], type: [], isFormula: [], formula: [], reverseCol: [] };
  const toColType = (gt) => {
    const name = gt.name === 'Reference' ? 'Ref' : gt.name === 'ReferenceList' ? 'RefList' : gt.name;
    return gt.arg ? `${name}:${gt.arg}` : name;
  };
  let tref = 0;
  let cref = 0;
  const refs = [];
  const tableRef = new Map();
  for (const t of model.tables) {
    tref++;
    const isSummary = t.kind === 'summary';
    tables.id.push(tref);
    tables.tableId.push(isSummary ? `${t.source}_summary_X` : t.name);
    tables.summarySourceTable.push(isSummary ? tableRef.get(t.source) : 0);
    tableRef.set(t.name, tref);
    t.columns.forEach((c, i) => {
      cref++;
      cols.id.push(cref); cols.parentId.push(tref); cols.parentPos.push(i + 1); cols.colId.push(c.name);
      cols.type.push(c.gristType.name === 'Any' && c.isFormula ? 'Any' : toColType(c.gristType));
      cols.isFormula.push(c.isFormula);
      cols.formula.push(isSummary && c.name === 'group' ? 'table.getSummarySourceGroup(rec)' : '');
      cols.reverseCol.push(0);
      if (c.gristType.reverse) refs.push([cref, c.gristType.arg, c.gristType.reverse]);
    });
  }
  for (const [ref, targetTable, revColId] of refs) {
    const target = tableRef.get(targetTable);
    const idx = cols.colId.findIndex((id, k) => id === revColId && cols.parentId[k] === target);
    cols.reverseCol[ref - 1] = idx >= 0 ? cols.id[idx] : 0;
  }
  return { tables, cols };
}

/** Exporte les métadonnées d'un code (via le modèle corrigé) au format docApi.fetchTable. */
export { parseGristCodeCorrected } from '../assets/converter.js';
