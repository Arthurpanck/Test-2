/**
 * Liens des colonnes dérivées : d'où vient la valeur d'une colonne dont le rôle est « Dérivée »
 * (même règle que la colonne « Rôle » de l'onglet Tables, voir columnNature()).
 *
 * Chaque lien relie la colonne dérivée à une colonne qu'elle reprend :
 *  - dans la même table : `$Prenom`, `f"{$Prenom} {$Nom}"`, `UPPER($Nom)` ;
 *  - par une référence : `$Service.Nom` → Services.Nom (chaînes suivies : `$Projet.Chef.Nom`) ;
 *  - par un lookup dont on lit une colonne : `Clients.lookupOne(Code=$Code).Ville` → Clients.Ville
 *    (les critères du lookup, ici `$Code`, ne sont pas la valeur reprise).
 * Lecture du texte des formules seulement, sans les exécuter. Module pur.
 */
import { columnNature } from './table-format.js?v=3.10.0';
import { findLookups } from './lookups.js?v=3.10.0';

/**
 * Code sans commentaires ; le contenu des chaînes est effacé, sauf celui des f-strings
 * (leurs accolades contiennent du code : `f"{$Prenom} {$Nom}"`).
 */
function codeOf(formula) {
  const src = String(formula || '');
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '#') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (ch !== '"' && ch !== "'") { out += ch; continue; }
    const quote = src.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
    const isF = /(?:^|[^\w$.])(?:[fF][rR]?|[rR][fF])$/.test(out);
    let j = i + quote.length;
    let body = '';
    while (j < src.length && !src.startsWith(quote, j)) {
      if (src[j] === '\\') { body += '  '; j += 2; continue; }
      body += src[j];
      j++;
    }
    out += ' ' + (isF ? body.replace(/[^{}]+(?=\{|$)/g, (s) => ' '.repeat(s.length)) : ' '.repeat(body.length)) + ' ';
    i = j + quote.length - 1;
  }
  return out;
}

/** Arguments des lookups effacés : `$Code` dans `Sites.lookupOne(Code=$Code)` est un critère de recherche, pas la valeur reprise. */
function withoutLookupArgs(code) {
  let out = code;
  for (const m of code.matchAll(/\.\s*lookup(?:One|Records)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')' && --depth === 0) { out = out.slice(0, open + 1) + ' '.repeat(i - open - 1) + out.slice(i); break; }
    }
  }
  return out;
}

// `$A.B.C` ou `rec.A.B.C` ; un attribut suivi de « ( » est une méthode (`.upper()`), pas une colonne.
const CHAIN = /(?:\$|(?<![\w.])rec\s*\.\s*)([A-Za-z_]\w*)((?:\s*\.\s*[A-Za-z_]\w*\b(?!\s*\())*)/g;

/**
 * @param {Array} tables  tables de sortie du convertisseur
 * @param {Map} schema    schéma du document (tables de synthèse, pour les lookups)
 * @param {Array} lookups résultat de findLookups (recalculé s'il manque)
 * @returns {Array<{ source, column, target, targetColumn, via: 'same' | 'ref' | 'lookup', trigger }>}
 */
export function findDerivations(tables, schema = null, lookups = null) {
  const byName = new Map(tables.map((t) => [t.name, new Map(t.columns.map((c) => [c.name, c]))]));
  const allLookups = lookups || findLookups(tables, schema);
  const out = [];
  const seen = new Set();
  const add = (link) => {
    if (link.target === link.source && link.targetColumn === link.column) return;
    const key = [link.source, link.column, link.target, link.targetColumn].join('\u0000');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(link);
  };
  for (const t of tables) {
    for (const c of t.columns) {
      if (columnNature(c) !== 'Dérivée') continue;
      const trigger = !c.isFormula;
      const code = withoutLookupArgs(codeOf(c.details?.formula));
      for (const m of code.matchAll(CHAIN)) {
        // Suivre la chaîne de références tant que l'attribut suivant est une colonne de la table visée.
        let table = t.name;
        let col = m[1];
        const attrs = m[2] ? m[2].split('.').map((s) => s.trim()).filter(Boolean) : [];
        if (!byName.get(table)?.has(col)) continue;
        let via = 'same';
        for (const a of attrs) {
          const ref = byName.get(table).get(col)?.ref?.table;
          if (!ref || !byName.get(ref)?.has(a)) break;
          table = ref; col = a; via = 'ref';
        }
        if (col === 'id') continue;
        add({ source: t.name, column: c.name, target: table, targetColumn: col, via, trigger });
      }
      for (const l of allLookups) {
        if (l.source !== t.name || l.column !== c.name || l.via !== 'read' || !l.targetColumn || l.targetColumn === 'id') continue;
        add({ source: t.name, column: c.name, target: l.target, targetColumn: l.targetColumn, via: 'lookup', trigger });
      }
    }
  }
  return out;
}
