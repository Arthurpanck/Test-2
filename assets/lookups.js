/**
 * Lookups écrits dans les formules : `Table.lookupOne(...)` et `Table.lookupRecords(...)`.
 * Lecture du texte des formules seulement (chaînes et commentaires masqués), sans les exécuter.
 *
 * Chaque lookup relie la colonne de formule (celle qui récupère) aux colonnes de la table cherchée
 * qui donnent la donnée :
 *  - la colonne lue sur le résultat : `Clients.lookupOne(...).Ville`, `SUM(d.Montant for d in X.lookupRecords(...))`,
 *    `c = X.lookupOne(...)` puis `c.Nom` ;
 *  - sinon, les colonnes de critère : `Projets.lookupRecords(Chef_de_projet=$id)` → Chef_de_projet ;
 *  - sinon (aucun critère, aucune lecture), la table elle-même.
 * Module pur.
 */
import { maskPython, lookupCalls, splitTopLevel } from './python-text.js?v=3.18.0';
import { decodeSummaryTableName } from './converter.js?v=3.18.0';

const NOT_COLUMNS = new Set(['order_by', 'sort_by']);

/** Noms des arguments nommés de premier niveau : « a=1, b=$x » → [a, b]. */
function argumentNames(args) {
  const names = [];
  for (const p of splitTopLevel(args)) {
    const m = /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(p);
    if (m && !NOT_COLUMNS.has(m[1])) names.push(m[1]);
  }
  return names;
}

/** Colonnes lues sur le résultat du lookup qui commence en `start` et finit en `end`. */
function readColumns(masked, start, end) {
  const out = [];
  const direct = /^\s*\.\s*([A-Za-z_]\w*)/.exec(masked.slice(end + 1));
  if (direct) out.push(direct[1]);
  // Variable liée au résultat : « for d in X.lookupRecords(...) » ou « d = X.lookupOne(...) »
  const before = masked.slice(0, start);
  const bound = /\bfor\s+([A-Za-z_]\w*)\s+in\s*$/.exec(before) || /(?:^|[\n;])\s*([A-Za-z_]\w*)\s*=\s*$/.exec(before);
  if (bound) for (const m of masked.matchAll(new RegExp(`(?<![\\w.$])${bound[1]}\\s*\\.\\s*([A-Za-z_]\\w*)`, 'g'))) out.push(m[1]);
  return out;
}

/**
 * @param {Array} tables  tables de sortie du convertisseur (formules dans columns[].details.formula)
 * @param {Map} schema    schéma du document, pour reconnaître les tables de synthèse (« X_summary_Y » → « X_Summary »)
 * @returns {Array<{ source, column, target, targetColumn, via: 'read' | 'key' | null, kind: 'one' | 'records', trigger }>}
 */
export function findLookups(tables, schema = null) {
  const byName = new Map(tables.map((t) => [t.name, new Set(['id', ...t.columns.map((c) => c.name)])]));
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
      const masked = maskPython(formula);
      for (const call of lookupCalls(masked)) {
        const target = byName.has(call.table) ? call.table : alias.get(call.table);
        if (!target) continue; // pas une table du document (variable, objet)
        const cols = byName.get(target);
        const read = [...new Set(readColumns(masked, call.start, call.close))].filter((x) => cols.has(x));
        const keys = [...new Set(argumentNames(call.args))].filter((x) => cols.has(x));
        const via = read.length ? 'read' : keys.length ? 'key' : null;
        const kind = call.method === 'lookupOne' ? 'one' : 'records';
        for (const targetColumn of read.length ? read : keys.length ? keys : [null]) {
          const key = [t.name, c.name, target, targetColumn, kind].join('\u0000');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ source: t.name, column: c.name, target, targetColumn, via, kind, trigger: !c.isFormula });
        }
      }
    }
  }
  return out;
}
