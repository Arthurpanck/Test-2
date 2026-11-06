/**
 * Petits utilitaires partagés par les modules du widget. Module pur.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Échappe un texte pour le HTML (contenu et attributs). */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** « 1 table », « 1 234 tables » (nombre au format français). */
export const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

/** Texte sans accents, en minuscules : pour comparer des noms (« Données » = « donnees »). */
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** « 6 novembre 2026 à 10:30 ». */
export const frenchDateTime = (d) => `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

/**
 * Colonnes techniques de Grist, jamais montrées : id, manualSort, gristHelper_…, #… (portage de
 * `column.is_visible_column()`).
 */
export const TECHNICAL_COLUMN = /^(id|manualSort|gristHelper_.*|#.*)$/;
export const isVisibleColumn = (colId) => !TECHNICAL_COLUMN.test(String(colId));

/** Objet JSON d'une option Grist (`widgetOptions`, `options`…) : chaîne JSON ou objet ; {} sinon. */
export function parseJsonObject(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const v = JSON.parse(value);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Données colonnaires renvoyées par `grist.docApi.fetchTable()` → tableau de lignes. */
export function columnarToRows(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const keys = Object.keys(data);
  const n = Array.isArray(data.id) ? data.id.length : keys.length && Array.isArray(data[keys[0]]) ? data[keys[0]].length : 0;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = {};
    for (const k of keys) row[k] = data[k]?.[i];
    rows.push(row);
  }
  return rows;
}

/** Type de colonne Grist : « Ref:Clients » → { base: 'Ref', arg: 'Clients' } ; « DateTime:Europe/Paris » → arg « Europe/Paris ». */
export function splitColType(type) {
  const s = String(type || '');
  const i = s.indexOf(':');
  return i < 0 ? { base: s, arg: '' } : { base: s.slice(0, i), arg: s.slice(i + 1) };
}
