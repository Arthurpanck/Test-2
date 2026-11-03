/**
 * Présentation d'une table colonne par colonne, au format du modèle « Table pour exportation » :
 * Colonne (nom en base) · Nom affiché · Type SQLite · Type déclaré (Grist) · Rôle · Calculé ? · Formule.
 * Utilisée par l'onglet Tables, le rapport Word et l'export Excel des tables.
 * Module pur.
 */
import { GRIST_TYPE_LABELS } from './types.js?v=3.8.0';

export const TABLE_COLUMNS = ['Colonne (nom en base)', 'Nom affiché', 'Type SQLite', 'Type déclaré (Grist)', 'Rôle', 'Calculé ?', 'Formule', 'Documentée ?'];

/**
 * Une formule est documentée si elle contient un commentaire Python (« # … », hors chaînes de
 * caractères) ou commence par une chaîne de documentation (triples guillemets).
 */
export function hasDocumentation(code) {
  const src = String(code || '');
  if (/^\s*("""|''')/.test(src)) return true;
  let quote = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (src.startsWith(quote, i)) { i += quote.length - 1; quote = ''; }
      continue;
    }
    if (ch === '#') return true;
    if (ch === '"' || ch === "'") {
      quote = src.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      i += quote.length - 1;
    }
  }
  return false;
}

/** « Documentée ? » : Non concerné (pas de formule), Documentée ou Pas de documentation. */
export const documentationLabel = (formula) => (!formula ? 'Non concerné' : hasDocumentation(formula) ? 'Documentée' : 'Pas de documentation');

/**
 * Type de stockage SQLite, comme DocStorage._getSqlType() de grist-core : il dépend de la chaîne
 * exacte du type Grist. « DateTime:Europe/Paris » n'est pas « DateTime » : stocké en BLOB.
 */
export function sqliteType(gristType) {
  const name = gristType?.name || 'Any';
  const arg = gristType?.arg;
  switch (name) {
    case 'Bool': return 'BOOLEAN';
    case 'Choice': case 'Text': return 'TEXT';
    case 'ChoiceList': case 'Attachments': return 'TEXT';
    case 'ReferenceList': return 'TEXT';
    case 'Reference': return 'INTEGER';
    case 'Date': return arg ? 'BLOB' : 'DATE';
    case 'DateTime': return arg ? 'BLOB' : 'DATETIME';
    case 'Int': case 'Id': return 'INTEGER';
    case 'Numeric': case 'ManualSortPos': case 'PositionNumber': return 'NUMERIC';
    default: return 'BLOB';
  }
}

/** Type déclaré dans Grist, en français : « Référence → Projets », « Date et Heure (Europe/Paris) »… */
export function declaredType(c) {
  const t = c.gristType;
  if (!t || (t.name === 'Any' && c.isFormula)) return { text: '' };
  const label = GRIST_TYPE_LABELS[t.name] || t.name;
  if (t.name === 'Reference' || t.name === 'ReferenceList') {
    return { text: `${label} → ${t.arg || '?'}${t.reverse ? ` (inverse de ${t.reverse})` : ''}`, label, target: t.arg, reverse: t.reverse };
  }
  return { text: t.arg ? `${label} (${t.arg})` : label, label };
}

/** Quand s'applique une formule d'initialisation. */
export function triggerWhen(trigger) {
  if (trigger.when === 'deps') return `aux nouvelles lignes et quand ${trigger.deps.length > 1 ? 'ces colonnes changent' : 'cette colonne change'} : ${trigger.deps.join(', ')}`;
  return { new: 'aux nouvelles lignes seulement', any: 'aux nouvelles lignes et à chaque modification', never: 'jamais automatiquement' }[trigger.when] || '';
}

/** Code sans commentaires ni contenu de chaînes (remplacés par des espaces), et présence de chaînes. */
function scanPython(code) {
  const src = String(code || '');
  let out = '', quote = '', hasString = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { out += '  '; i++; continue; }
      if (src.startsWith(quote, i)) { out += ' '.repeat(quote.length); i += quote.length - 1; quote = ''; continue; }
      out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (ch === '#') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } if (i < src.length) out += '\n'; continue; }
    if (ch === '"' || ch === "'") {
      hasString = true;
      quote = src.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      out += ' '.repeat(quote.length); i += quote.length - 1;
      continue;
    }
    out += ch;
  }
  return { code: out, hasString };
}

// Ce qui produit une valeur nouvelle : agrégats, comptes, dates, arithmétique, conditions, comparaisons.
const COMPUTE_FN = /\b(SUM|AVERAGE|AVERAGEA|COUNT|COUNTA|COUNTIF|MAX|MIN|MEDIAN|ROUND|ROUNDUP|ROUNDDOWN|INT|ABS|MOD|POWER|SQRT|DATEDIF|DATEADD|EDATE|EOMONTH|NOW|TODAY|DATE|DAYS|YEAR|MONTH|DAY|WEEKDAY|WEEKNUM|NETWORKDAYS|IF|IFERROR|AND|OR|NOT|len|sum|max|min|abs|round|sorted|any|all|getSummarySourceGroup)\s*\(/;
const COMPUTE_KW = /\b(if|else|elif|for|while|and|or|not|in|lambda)\b/;
const COMPUTE_OP = /==|!=|<=|>=|(?<![-=])[<>](?!=)|[-*/%](?![>=])|\*\*/;
// Ce qui reprend une information existante : référence, colonne, lookup, texte combiné ou transformé.
const DERIVE = /\$[A-Za-z_]|\brec\.|[A-Za-z_]\w*\s*\.\s*[A-Za-z_]|\b(CONCATENATE|CONCAT|UPPER|LOWER|PROPER|TRIM|CLEAN|LEFT|RIGHT|MID|SUBSTITUTE|REPLACE|TEXT|VALUE|str|join|format)\s*\(|^[A-Za-z_]\w*$/m;

/**
 * Nature de la valeur d'une colonne :
 *  - Donnée : enregistrée sans formule propre (saisie, import, automatisation ; une formule d'initialisation
 *    qui ne reprend aucune information du document, comme NOW() ou user.Email, reste une donnée) ;
 *  - Calculée : produite par une formule qui calcule (agrégat, compte, date, arithmétique, condition) ;
 *  - Dérivée : obtenue d'informations existantes par recopie, extraction, combinaison ou transformation
 *    ($Service.Nom, Clients.lookupOne(...).Ville, f"{$Prenom} {$Nom}", UPPER($Nom)).
 */
export function columnNature(c) {
  if (!c) return 'Donnée';
  const d = c.details || {};
  const formula = c.isFormula || d.trigger ? String(d.formula || '') : '';
  if (!formula.trim()) return 'Donnée';
  const { code, hasString } = scanPython(formula);
  // user.Email, user.Name… : la session, pas une information du document.
  const body = code.replace(/^\s*return\b/gm, ' ').replace(/\buser\.[A-Za-z_]\w*/g, ' 0 ').trim();
  const reads = /\$[A-Za-z_]|\brec\.|\.\s*lookup(One|Records)\s*\(/.test(body) || /^[A-Za-z_]\w*(\s*\.\s*[A-Za-z_]\w*)+$/m.test(body);
  if (!c.isFormula) return reads && !COMPUTE_FN.test(body) ? 'Dérivée' : 'Donnée'; // formule d'initialisation
  const plusIsText = hasString || /\bCONCATENATE\b|\bf\s*$/.test(body) || /\bf[ ]*$/.test(code);
  const ops = body.replace(/\+/g, plusIsText ? ' ' : '-'); // « + » entre textes : une combinaison, pas un calcul
  if (COMPUTE_FN.test(ops) || COMPUTE_KW.test(ops) || COMPUTE_OP.test(ops.replace(/\.\s*[A-Za-z_]\w*/g, ' ').replace(/->|(?<![=!<>])=(?!=)/g, ' '))) return 'Calculée';
  if (DERIVE.test(body)) return 'Dérivée';
  return 'Calculée';
}

/** Rôle de la colonne : clé primaire, ou nature de sa valeur (Donnée, Calculée, Dérivée). */
export const columnRole = (c) => (!c || c.name === 'id' ? 'Clé primaire' : columnNature(c));

/** Lignes d'une table (clé « id » comprise), dans l'ordre des colonnes. */
export function tableRows(t, keep = () => true) {
  const rows = [{ name: 'id', label: '', sqlite: 'INTEGER', declared: { text: '' }, role: 'Clé primaire', computed: 'Non calculé', formula: '', documented: 'Non concerné', description: '', isKey: true }];
  for (const c of t.columns) {
    if (!keep(c)) continue;
    const d = c.details || {};
    rows.push({
      name: c.name,
      label: c.label && c.label !== c.name ? c.label : '',
      sqlite: sqliteType(c.gristType),
      declared: declaredType(c),
      role: columnRole(c),
      computed: c.isFormula ? 'Calculé' : d.trigger ? 'Initialisé' : 'Non calculé',
      formula: c.isFormula || d.trigger ? d.formula || '' : '',
      documented: documentationLabel(c.isFormula || d.trigger ? d.formula : ''),
      description: d.description || '',
      when: d.trigger ? triggerWhen(d.trigger) : '',
      column: c,
    });
  }
  return rows;
}

/** Valeurs des sept colonnes, en texte (export, rapport). */
export const rowValues = (r) => [r.name, r.label, r.sqlite, r.declared.text, r.role, r.computed, r.formula, r.documented];
