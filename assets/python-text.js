/**
 * Lecture du texte des formules Python de Grist, sans jamais les exécuter : le seul endroit où
 * l'on reconnaît commentaires, chaînes (simples, triples, f-strings), parenthèses et `$Colonne`.
 * Module pur.
 */

/**
 * Parcourt une formule une seule fois.
 * @param {string} code
 * @param {{ fstringCode?: boolean }} o  fstringCode : garder le code entre accolades des f-strings
 *   (`f"{$Prenom} {$Nom}"` lit $Prenom et $Nom) au lieu de l'effacer avec le reste de la chaîne.
 * @returns {{
 *   masked: string,       // même longueur que `code` : commentaires et contenu des chaînes remplacés par des espaces (sauts de ligne gardés)
 *   stripped: string,     // `code` sans ses commentaires (chaînes intactes)
 *   hasComment: boolean,  // un « # » hors chaîne
 *   hasTriple: boolean,   // une chaîne entre triples guillemets
 *   unterminated: boolean // une chaîne jamais refermée
 * }}
 */
export function scanPython(code, { fstringCode = false } = {}) {
  const src = String(code ?? '');
  let masked = '',
    stripped = '';
  let hasComment = false,
    hasTriple = false,
    unterminated = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '#') {
      hasComment = true;
      while (i < src.length && src[i] !== '\n') {
        masked += ' ';
        i++;
      }
      if (i < src.length) {
        masked += '\n';
        stripped += '\n';
      }
      continue;
    }
    if (ch !== '"' && ch !== "'") {
      masked += ch;
      stripped += ch;
      continue;
    }
    const triple = src.startsWith(ch.repeat(3), i);
    const quote = triple ? ch.repeat(3) : ch;
    if (triple) hasTriple = true;
    // Préfixe f (f"…", rf"…", fr"…") juste avant le guillemet, hors identifiant.
    const isF = fstringCode && /(?:^|[^\w$.])(?:[fF][rR]?|[rR][fF])$/.test(src.slice(Math.max(0, i - 3), i));
    let j = i + quote.length;
    let body = '';
    let depth = 0;
    let closed = false;
    while (j < src.length) {
      if (src.startsWith(quote, j)) {
        closed = true;
        break;
      }
      const c = src[j];
      if (c === '\\') {
        body += '  ';
        j += 2;
        continue;
      }
      if (!triple && c === '\n') break; // une chaîne simple s'arrête à la fin de la ligne
      if (isF && c === '{') {
        depth++;
        body += depth > 0 ? c : ' ';
        j++;
        continue;
      }
      if (isF && c === '}') {
        body += depth > 0 ? c : ' ';
        depth = Math.max(0, depth - 1);
        j++;
        continue;
      }
      body += c === '\n' ? '\n' : isF && depth > 0 ? c : ' ';
      j++;
    }
    if (!closed) unterminated = true;
    const end = closed ? j + quote.length : j;
    masked += ' '.repeat(quote.length) + body.slice(0, Math.max(0, j - i - quote.length)) + (closed ? ' '.repeat(quote.length) : '');
    stripped += src.slice(i, end);
    i = end - 1;
  }
  return { masked, stripped, hasComment, hasTriple, unterminated };
}

/** Commentaires et contenu des chaînes masqués, en conservant les positions. */
export const maskPython = (code) => scanPython(code).masked;

/** Position de la parenthèse (ou du crochet, de l'accolade) fermante qui répond à celle de `open` (texte masqué). */
export function matchingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if ('([{'.includes(text[i])) depth++;
    else if (')]}'.includes(text[i]) && --depth === 0) return i;
  }
  return -1;
}

/** Découpe aux virgules de premier niveau (texte masqué) : « a=1, b=f(2, 3) » → ['a=1', ' b=f(2, 3)']. */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (ch && '([{'.includes(ch)) depth++;
    else if (ch && ')]}'.includes(ch)) depth--;
    else if ((ch === ',' && depth === 0) || i === text.length) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return parts;
}

// Suite d'attributs `.A.B` ; un attribut suivi de « ( » est une méthode (`.upper()`), pas une colonne.
const ATTRS = '((?:\\s*\\.\\s*[A-Za-z_]\\w*\\b(?!\\s*\\())*)';
const CHAIN = new RegExp(`(?:\\$|(?<![\\w.])rec\\s*\\.\\s*)([A-Za-z_]\\w*)${ATTRS}`, 'g');
export const attributesOf = (text) =>
  text
    ? text
        .split('.')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

/**
 * Colonnes de la ligne lues par une formule (texte masqué) : `$Service.Direction.Nom` ou
 * `rec.Service.Nom` → { name: 'Service', attrs: ['Direction', 'Nom'], index }.
 */
export function dollarChains(masked) {
  return [...String(masked).matchAll(CHAIN)].map((m) => ({ name: m[1], attrs: attributesOf(m[2]), index: m.index }));
}

/** Suite d'attributs (pour bâtir d'autres expressions : `x.A.B`). */
export const ATTRIBUTE_CHAIN = ATTRS;

const LOOKUP = /(?<![\w.$])([A-Za-z_]\w*)\s*\.\s*(lookupOne|lookupRecords)\s*\(/g;
/**
 * Appels `Table.lookupOne(...)` / `Table.lookupRecords(...)` d'une formule (texte masqué) :
 * { table, method, start (début de « Table »), open, close (parenthèses), args (texte masqué) }.
 * Un appel dont la parenthèse ne se referme pas est ignoré.
 */
export function lookupCalls(masked) {
  const out = [];
  for (const m of String(masked).matchAll(LOOKUP)) {
    const open = m.index + m[0].length - 1;
    const close = matchingParen(masked, open);
    if (close < 0) continue;
    out.push({ table: m[1], method: m[2], start: m.index, open, close, args: masked.slice(open + 1, close) });
  }
  return out;
}
