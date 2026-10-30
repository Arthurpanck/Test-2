/**
 * Présentation d'une table colonne par colonne, au format du modèle « Table pour exportation » :
 * Colonne (nom en base) · Nom affiché · Type SQLite · Type déclaré (Grist) · Rôle · Calculé ? · Formule.
 * Utilisée par l'onglet Tables, le rapport Word et l'export Excel des tables.
 * Module pur.
 */
import { GRIST_TYPE_LABELS } from './types.js?v=3.5.0';

export const TABLE_COLUMNS = ['Colonne (nom en base)', 'Nom affiché', 'Type SQLite', 'Type déclaré (Grist)', 'Rôle', 'Calculé ?', 'Formule'];

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

/** Rôle de la colonne : clé primaire, dérivée (convention de nommage v_*), ou donnée. */
export const columnRole = (name) => (name === 'id' ? 'Clé primaire' : /^v_/.test(name) ? 'Dérivé (v_*)' : 'Donnée');

/** Lignes d'une table (clé « id » comprise), dans l'ordre des colonnes. */
export function tableRows(t, keep = () => true) {
  const rows = [{ name: 'id', label: '', sqlite: 'INTEGER', declared: { text: '' }, role: 'Clé primaire', computed: '', formula: '', isKey: true }];
  for (const c of t.columns) {
    if (!keep(c)) continue;
    const d = c.details || {};
    rows.push({
      name: c.name,
      label: c.label && c.label !== c.name ? c.label : '',
      sqlite: sqliteType(c.gristType),
      declared: declaredType(c),
      role: columnRole(c.name),
      computed: c.isFormula ? 'Calculé' : d.trigger ? 'Initialisé' : '',
      formula: c.isFormula || d.trigger ? d.formula || '' : '',
      column: c,
    });
  }
  return rows;
}

/** Valeurs des sept colonnes, en texte (export, rapport). */
export const rowValues = (r) => [r.name, r.label, r.sqlite, r.declared.text, r.role, r.computed, r.formula];
