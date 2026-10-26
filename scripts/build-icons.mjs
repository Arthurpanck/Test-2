// Extrait du DSFR les seules icônes utilisées par le widget (au lieu de charger les 350 Ko
// de utility/icons). Usage : node scripts/build-icons.mjs <chemin du paquet @gouvfr/dsfr>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DSFR_VERSION = '1.15.4';
const ICONS = [
  'refresh-line', 'clipboard-line', 'download-line', 'external-link-line', 'database-line',
  'code-s-slash-line', 'table-line', 'git-merge-line', 'search-line', 'zoom-in-line', 'zoom-out-line',
  'save-line', 'information-line', 'warning-line', 'error-warning-line', 'checkbox-circle-line',
  'delete-line', 'file-text-line', 'links-line', 'check-line', 'eye-line', 'edit-line',
  'arrow-right-line', 'settings-5-line', 'lightbulb-line', 'file-download-line', 'fullscreen-line',
  'layout-grid-line', 'focus-3-line', 'road-map-line', 'close-line', 'lock-line', 'user-line',
  'list-unordered', 'subtract-line', 'question-line',
];

const pkg = process.argv[2];
if (!pkg) throw new Error('Chemin du paquet @gouvfr/dsfr requis');
const css = readFileSync(path.join(pkg, 'dist/utility/icons/icons.min.css'), 'utf8');
const base = `https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@${DSFR_VERSION}/dist/`;

const rules = [];
for (const icon of ICONS) {
  const re = new RegExp(`\\.fr-icon-${icon}:after,\\.fr-icon-${icon}:before\\{-webkit-mask-image:url\\(([^)]+)\\);mask-image:url\\([^)]+\\)\\}`);
  const m = re.exec(css);
  if (!m) throw new Error(`Icône introuvable : ${icon}`);
  const url = base + m[1].replace(/^(\.\.\/)+/, '');
  rules.push(`.fr-icon-${icon}::before,.fr-icon-${icon}::after{-webkit-mask-image:url(${url});mask-image:url(${url})}`);
}
const header = `/* Sous-ensemble des icônes DSFR v${DSFR_VERSION} (Etalab-2.0) — généré par scripts/build-icons.mjs */\n`;
writeFileSync(new URL('../assets/dsfr-icons.css', import.meta.url), header + rules.join('\n') + '\n');
console.log(`${rules.length} icônes écrites dans assets/dsfr-icons.css`);
