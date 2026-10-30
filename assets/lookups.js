/**
 * Lookups écrits dans les formules : `Table.lookupOne(...)` et `Table.lookupRecords(...)`.
 * Lecture du texte des formules seulement (chaînes et commentaires masqués), sans les exécuter.
 * Module pur.
 */
import { maskPython } from './audit-engine.js?v=3.5.0';
import { decodeSummaryTableName } from './converter.js?v=3.5.0';

const LOOKUP = /(?<![\w.$])([A-Za-z_]\w*)\s*\.\s*(lookupOne|lookupRecords)\s*\(/g;

/**
 * @param {Array} tables  tables de sortie du convertisseur (formules dans columns[].details.formula)
 * @param {Map} schema    schéma du document, pour reconnaître les tables de synthèse (« X_summary_Y » → « X_Summary »)
 * @returns {Array<{ source, column, target, kind: 'one' | 'records', trigger }>}
 */
export function findLookups(tables, schema = null) {
  const names = new Set(tables.map((t) => t.name));
  const alias = new Map();
  for (const t of schema ? schema.values() : []) {
    const src = decodeSummaryTableName(t);
    if (src) alias.set(t.tableId, `${src}_Summary`);
  }
  const out = [];
  const seen = new Set();
  for (const t of tables) {
    for (const c of t.columns) {
      const formula = c.details?.formula;
      if (!formula) continue;
      for (const m of maskPython(formula).matchAll(LOOKUP)) {
        const target = names.has(m[1]) ? m[1] : alias.get(m[1]);
        if (!target) continue; // pas une table du document (variable, objet)
        const kind = m[2] === 'lookupOne' ? 'one' : 'records';
        const key = [t.name, c.name, target, kind].join('\u0000');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ source: t.name, column: c.name, target, kind, trigger: !c.isFormula });
      }
    }
  }
  return out;
}
