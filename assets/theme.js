/**
 * Couleurs et polices des documents produits par le widget : aperçu et fichier Word du rapport,
 * export PNG/SVG du schéma, couleurs des tables et des liens du schéma. C'est la seule source de
 * ces valeurs : le widget les pose au démarrage en variables CSS --doc-* (applyDocTheme), que
 * styles.css utilise, et le Word les relit (readTheme). Changer une valeur ici change l'écran,
 * le Word et les exports.
 * Les variantes du thème sombre de l'écran (liens du schéma) sont dans styles.css.
 * Module pur (sans DOM, sauf applyDocTheme et la lecture des variables par readTheme).
 */

export const DOC_THEME = {
  font: 'Calibri, Carlito, "Marianne", Arial, sans-serif',
  mono: 'Consolas, "Courier New", monospace',
  primary: '#000091',
  onPrimary: '#ffffff',
  summary: '#6e445a',
  text: '#161616',
  muted: '#666666',
  border: '#dddddd',
  surface: '#f6f6f6',
  type: '#18753c',
  formula: '#a558a0',
  key: '#b34000',
  blocking: '#ce0500',
  improve: '#b34000',
  choice: '#a558a0',
  info: '#0063cb',
  ready: '#18753c',
  neutral: '#3a3a3a',
  fillOk: '#dffee6',
  fillKo: '#ffe9e9',
  fillUk: '#eeeeee',
  lookupOne: '#d64d00',
  lookupRecords: '#009081',
  acl: '#c9191e',
  calc: '#a558a0',
  background: '#ffffff',
  line: '#929292',
  subtle: '#eeeeee', // fond, traits et séparateurs discrets
};

/** Couleur pour Excel (« RRGGBB », sans #). */
export const xlsxColor = (key) => DOC_THEME[key].slice(1).toUpperCase();

const toKebab = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
/** Première police d'une pile CSS, sans guillemets : « "Spectral", serif » → « Spectral ». */
const firstFamily = (v) => String(v).split(',')[0].replace(/["']/g, '').trim();

/** Pose les variables --doc-* sur la racine du document (au démarrage du widget). */
export function applyDocTheme(root = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!root) return;
  for (const [key, value] of Object.entries(DOC_THEME)) root.style.setProperty(`--doc-${toKebab(key)}`, value);
}

/**
 * Couleurs et polices pour le Word et l'export du schéma : les variables --doc-* telles que la page
 * les donne (une page peut les redéfinir), sinon DOC_THEME. Polices : la première de la pile.
 */
export function readTheme(style = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null) {
  const theme = {};
  for (const [key, fallback] of Object.entries(DOC_THEME)) {
    const v = (style ? style.getPropertyValue(`--doc-${toKebab(key)}`).trim() : '') || fallback;
    theme[key] = key === 'font' || key === 'mono' ? firstFamily(v) : v;
  }
  return theme;
}
