/**
 * Liens des calculs : pour chaque colonne calculée (formule) ou initialisée (formule d'initialisation),
 * les colonnes que sa formule lit pour produire sa valeur.
 *  - dans la même table : `$Prenom`, `f"{$Prenom} {$Nom}"`, `$Montant * (1 + $Taux_TVA)` ;
 *  - par une référence : `$Service.Nom` → Services.Nom (chaînes suivies : `$Projet.Service_pilote.Direction`) ;
 *  - par une liste de lignes : `SUM($group.Montant)`, `[a for a in $group if a.Temps_partiel]` → table source.
 * Les lookups (`Table.lookupOne(...)`) ont leur propre lien sur le schéma ; leurs critères (`Exercice=$Annee`)
 * sont bien lus par la formule et comptent ici.
 * Lecture du texte des formules seulement, sans les exécuter. Module pur.
 */

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

// Suite d'attributs `.A.B` ; un attribut suivi de « ( » est une méthode (`.upper()`), pas une colonne.
const ATTRS = '((?:\\s*\\.\\s*[A-Za-z_]\\w*\\b(?!\\s*\\())*)';
const CHAIN = new RegExp(`(?:\\$|(?<![\\w.])rec\\s*\\.\\s*)([A-Za-z_]\\w*)${ATTRS}`, 'g');
const attrsOf = (text) => (text ? text.split('.').map((s) => s.trim()).filter(Boolean) : []);

/**
 * @param {Array} tables  tables de sortie du convertisseur (formules dans columns[].details.formula)
 * @returns {Array<{ source, column, target, targetColumn, via: 'same' | 'ref', trigger }>}
 */
export function findFormulaDeps(tables) {
  const byName = new Map(tables.map((t) => [t.name, new Map(t.columns.map((c) => [c.name, c]))]));
  const out = [];
  const seen = new Set();
  const add = (link) => {
    if (link.targetColumn === 'id' || (link.target === link.source && link.targetColumn === link.column)) return;
    const key = [link.source, link.column, link.target, link.targetColumn].join('\u0000');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(link);
  };
  /** Suit `col.a.b` depuis `table` tant que chaque attribut est une colonne de la table visée par la référence. */
  const follow = (table, col, attrs) => {
    let via = 'same';
    for (const a of attrs) {
      const ref = byName.get(table)?.get(col)?.ref?.table;
      if (!ref || !byName.get(ref)?.has(a)) break;
      table = ref; col = a; via = 'ref';
    }
    return { table, col, via };
  };
  for (const t of tables) {
    for (const c of t.columns) {
      const formula = c.isFormula || c.details?.trigger ? c.details?.formula : '';
      if (!formula || !String(formula).trim()) continue;
      const trigger = !c.isFormula;
      const code = codeOf(formula);
      for (const m of code.matchAll(CHAIN)) {
        if (!byName.get(t.name)?.has(m[1])) continue;
        const r = follow(t.name, m[1], attrsOf(m[2]));
        add({ source: t.name, column: c.name, target: r.table, targetColumn: r.col, via: r.via, trigger });
      }
      // Variable de boucle sur une liste de lignes : « for a in $group » puis « a.Temps_partiel ».
      for (const m of code.matchAll(new RegExp(`\\bfor\\s+([A-Za-z_]\\w*)\\s+in\\s+(?:\\$|rec\\s*\\.\\s*)([A-Za-z_]\\w*)${ATTRS}`, 'g'))) {
        if (!byName.get(t.name)?.has(m[2])) continue;
        const list = follow(t.name, m[2], attrsOf(m[3]));
        const target = byName.get(list.table)?.get(list.col)?.ref?.table;
        if (!target || !byName.has(target)) continue;
        for (const u of code.matchAll(new RegExp(`(?<![\\w.$])${m[1]}\\s*\\.\\s*([A-Za-z_]\\w*)${ATTRS}`, 'g'))) {
          if (!byName.get(target).has(u[1])) continue;
          const r = follow(target, u[1], attrsOf(u[2]));
          add({ source: t.name, column: c.name, target: r.table, targetColumn: r.col, via: 'ref', trigger });
        }
      }
    }
  }
  return out;
}
