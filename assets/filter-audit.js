/** Filtres enregistrés affichés dans les vues Tableau ; aucun accès aux lignes métier. */
import { columnarToRows } from './converter.js?v=3.3.0';

export const VISIBLE_FILTER_THRESHOLD = 5;
const technical = /^(id|manualSort|gristHelper_.*|#.*)$/;

export function inspectVisibleFilters(schema, meta = {}) {
  const required = ['filters', 'sections', 'tables', 'columns'];
  if (required.some(k => !meta[k] || typeof meta[k] !== 'object')) {
    return { available: false, partial: false, views: [] };
  }
  const tables = new Map(columnarToRows(meta.tables).filter(t => t.tableId && schema.has(t.tableId)).map(t => [t.id, t]));
  const columns = new Map(columnarToRows(meta.columns).filter(c => c.colId && !technical.test(c.colId)).map(c => [c.id, c]));
  const sections = new Map(columnarToRows(meta.sections).filter(s => s.parentKey === 'record' && s.parentId > 0 && tables.has(s.tableRef)).map(s => [s.id, s]));
  const pageNames = new Map(columnarToRows(meta.views || []).map(v => [v.id, typeof v.name === 'string' ? v.name : '']));
  const grouped = new Map();
  let partial = false;
  for (const f of columnarToRows(meta.filters)) {
    const section = sections.get(f.viewSectionRef);
    if (!section) continue;
    // Ne pas assimiler une propriété absente ou censurée à « filtre masqué ».
    if (![true, false, 0, 1].includes(f.pinned) || typeof f.filter !== 'string') { partial = true; continue; }
    // Grist n'affiche que les filtres actifs : "null" est l'ancien filtre vide.
    if (!(f.pinned === true || f.pinned === 1) || f.filter === '' || f.filter === 'null') continue;
    const table = tables.get(section.tableRef), column = columns.get(f.colRef);
    if (!column || column.parentId !== section.tableRef || !schema.get(table.tableId).columns.has(column.colId)) { partial = true; continue; }
    if (!grouped.has(section.id)) grouped.set(section.id, { section: section.id, table: table.tableId, title: typeof section.title === 'string' ? section.title : '', page: pageNames.get(section.parentId) || '', columns: new Map() });
    // Une même colonne est un champ de filtre, même si plusieurs valeurs sont sélectionnées.
    grouped.get(section.id).columns.set(column.id, column.label || column.colId);
  }
  return { available: true, partial, views: [...grouped.values()].filter(v => v.columns.size >= VISIBLE_FILTER_THRESHOLD).map(v => ({ ...v, count: v.columns.size, columns: [...v.columns.values()] })) };
}

