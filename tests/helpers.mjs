// Outils partagés par les tests.
import { readFile, readdir } from 'node:fs/promises';
import { parseGristCodeCorrected } from '../assets/converter-code.js';

const FIXTURES = new URL('./fixtures/', import.meta.url);
/** Fixtures qui décrivent un document (Vue du code, export JSON des métadonnées, définition .mjs). */
export async function documentFixtures() {
  const names = (await readdir(FIXTURES)).filter((f) => /\.(code\.py|metadata\.json|mjs)$/.test(f)).sort();
  const out = [];
  // Une fixture .mjs décrit un document quand elle fournit `definition` et `metadataFromDefinition`.
  for (const f of names)
    if (!f.endsWith('.mjs') || typeof (await import(new URL(f, FIXTURES))).metadataFromDefinition === 'function') out.push(f);
  return out;
}

/** Métadonnées d'une fixture au format docApi.fetchTable, depuis une Vue du code, un export JSON ou une définition .mjs. */
export async function fixtureMetadata(name) {
  if (name.endsWith('.mjs')) {
    const mod = await import(new URL(name, FIXTURES));
    return mod.metadataFromDefinition(mod.definition);
  }
  const text = await readFile(new URL(name, FIXTURES), 'utf8');
  if (name.endsWith('.json')) {
    const m = JSON.parse(text);
    const cols = m.columns.id
      ? m.columns
      : m.columns.map((c) => ({
          parentPos: c.id,
          label: c.colId,
          formula: '',
          reverseCol: 0,
          description: '',
          widgetOptions: '',
          recalcWhen: 0,
          recalcDeps: null,
          isFormula: 0,
          ...c,
        }));
    return { tables: m.tables, cols, sections: m.sections || [], aclResources: m.aclResources || [], aclRules: m.aclRules || [] };
  }
  return metadataFromModel(parseGristCodeCorrected(text));
}

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
      cols.id.push(cref);
      cols.parentId.push(tref);
      cols.parentPos.push(i + 1);
      cols.colId.push(c.name);
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

export { parseGristCodeCorrected };
