/**
 * Présentation d'une table colonne par colonne, au format du modèle « Table pour exportation » :
 * Colonne (nom en base) · Nom affiché · Type SQLite · Type déclaré (Grist) · Rôle · Calculé ? · Formule.
 * Utilisée par l'onglet Tables, le rapport Word et l'export Excel des tables.
 * Module pur.
 */
import { GRIST_TYPE_LABELS } from './types.js?v=3.11.0';

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

/**
 * Nature de la valeur d'une colonne :
 *  - Donnée : enregistrée sans formule propre (saisie, import, automatisation) ; une formule
 *    d'initialisation ne fait que proposer une première valeur, que l'on peut ensuite modifier ;
 *  - Calculée : produite par l'exécution d'une formule.
 */
export function columnNature(c) {
  if (!c) return 'Donnée';
  return c.isFormula && String(c.details?.formula || '').trim() ? 'Calculée' : 'Donnée';
}

/** Rôle de la colonne : clé primaire, ou nature de sa valeur (Donnée, Calculée). */
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

