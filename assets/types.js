/**
 * Libellés des types de colonnes, tels que Grist les affiche en français
 * (panneau de droite ▸ Colonne ▸ Type de colonne). Le DBML garde ses propres types.
 */

export const GRIST_TYPE_LABELS = {
  Any: 'Non défini',
  Text: 'Texte',
  Numeric: 'Numérique',
  Int: 'Entier',
  Bool: 'Booléen',
  Date: 'Date',
  DateTime: 'Date et Heure',
  Choice: 'Choix unique',
  ChoiceList: 'Choix multiple',
  Reference: 'Référence',
  ReferenceList: 'Référence multiple',
  Attachments: 'Pièce jointe',
  Id: 'Identifiant',
  PositionNumber: 'Position',
  ManualSortPos: 'Position',
};

/** Libellé français du type d'une colonne de sortie du convertisseur. */
export function columnTypeLabel(col) {
  if (!col) return '';
  const name = col.gristType ? col.gristType.name : (col.base === 'default' ? 'Any' : null);
  if (name && GRIST_TYPE_LABELS[name]) return GRIST_TYPE_LABELS[name];
  return name || col.base || '';
}

/** Libellé du type de la clé « id ». */
export const ID_TYPE_LABEL = 'Entier';

const TRIGGER_WHEN = {
  new: 'aux nouvelles lignes seulement',
  any: 'aux nouvelles lignes et à chaque modification de la ligne',
  never: 'jamais automatiquement',
};

/**
 * Détails d'une colonne, comme dans le panneau « Colonne » de Grist :
 * [{ label, text, mono? }] — formule, formule d'initialisation et son déclenchement,
 * choix, condition de liste déroulante, description, libellé.
 */
export function detailLines(col, { includeLabel = true } = {}) {
  const d = col.details;
  const out = [];
  if (col.empty) out.push({ label: 'Colonne vide', text: 'ni type ni formule pour l\'instant' });
  if (!d) return out;
  if (includeLabel && d.label && d.label !== col.name) out.push({ label: 'Libellé', text: d.label });
  if (d.trigger) {
    out.push({ label: 'Formule d\'initialisation', text: d.formula, mono: true });
    out.push({ label: 'Appliquée', text: d.trigger.when === 'deps' ? `aux nouvelles lignes et quand ${d.trigger.deps.length > 1 ? 'ces colonnes changent' : 'cette colonne change'} : ${d.trigger.deps.join(', ')}` : TRIGGER_WHEN[d.trigger.when] });
  } else if (d.formula) {
    out.push({ label: 'Formule', text: d.formula, mono: true });
  }
  if (d.choices.length) out.push({ label: 'Choix', text: d.choices.join(' · ') });
  if (d.dropdown) out.push({ label: 'Liste filtrée', text: d.dropdown, mono: true });
  if (d.description) out.push({ label: 'Description', text: d.description });
  return out;
}
