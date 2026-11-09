// Copie dans assets/vendor/ les bibliothèques chargées par le widget, aux versions figées ci-dessous :
// le widget ne dépend plus d'un CDN. Les fichiers sont ceux publiés par leurs auteurs, sans retouche.
// Régénère aussi assets/dsfr-icons.css (sous-ensemble des icônes DSFR utilisées par le widget).
//
// Usage : npm run vendor   (télécharge les paquets avec `npm pack`, il faut l'accès au registre npm)
// Pour changer de version : modifier LIBS, relancer, vérifier le widget, puis noter la version dans le CHANGELOG.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'assets/vendor');

const LIBS = [
  {
    name: '@gouvfr/dsfr',
    version: '1.15.4',
    dir: 'dsfr',
    license: 'LICENSE.md',
    role: "Système de design de l'État : styles, polices Marianne et Spectral, icônes",
    files: ['dist/dsfr.main.min.css', 'dist/fonts'],
  },
  {
    name: 'elkjs',
    version: '0.12.0',
    dir: 'elkjs',
    license: 'LICENSE.md',
    role: 'Disposition automatique du schéma (moteur dans un Web Worker, repli sur le fil principal)',
    files: ['lib/elk-api.js', 'lib/elk-worker.min.js', 'lib/elk.bundled.js'],
  },
  {
    name: 'docx',
    version: '9.10.0',
    dir: 'docx',
    license: 'LICENSE',
    role: 'Export Word du rapport (chargé au premier export)',
    files: ['dist/index.iife.js'],
  },
];

// Icônes DSFR utilisées par le widget (classes fr-icon-*), en plus de celles de dsfr.main.min.css.
const ICONS = [
  'refresh-line',
  'clipboard-line',
  'download-line',
  'external-link-line',
  'database-line',
  'code-s-slash-line',
  'table-line',
  'git-merge-line',
  'search-line',
  'zoom-in-line',
  'zoom-out-line',
  'save-line',
  'information-line',
  'warning-line',
  'error-warning-line',
  'checkbox-circle-line',
  'delete-line',
  'file-text-line',
  'links-line',
  'check-line',
  'eye-line',
  'edit-line',
  'arrow-right-line',
  'settings-5-line',
  'lightbulb-line',
  'file-download-line',
  'fullscreen-line',
  'layout-grid-line',
  'focus-3-line',
  'road-map-line',
  'close-line',
  'lock-line',
  'user-line',
  'list-unordered',
  'subtract-line',
  'question-line',
  'line-chart-line',
];

const tmp = mkdtempSync(path.join(tmpdir(), 'vendor-'));
const unpack = (lib) => {
  const tgz = execFileSync('npm', ['pack', `${lib.name}@${lib.version}`, '--silent'], { cwd: tmp, encoding: 'utf8' })
    .trim()
    .split('\n')
    .pop();
  const out = path.join(tmp, lib.dir);
  mkdirSync(out, { recursive: true });
  execFileSync('tar', ['xzf', path.join(tmp, tgz), '-C', out]);
  return path.join(out, 'package');
};

rmSync(VENDOR, { recursive: true, force: true });
const lines = [];
for (const lib of LIBS) {
  const pkg = unpack(lib);
  const dest = path.join(VENDOR, lib.dir);
  mkdirSync(dest, { recursive: true });
  for (const f of lib.files) cpSync(path.join(pkg, f), path.join(dest, path.basename(f)), { recursive: true });
  cpSync(path.join(pkg, lib.license), path.join(dest, lib.license));

  if (lib.dir === 'dsfr') {
    // Les icônes appelées par la feuille de style principale, puis le sous-ensemble du widget.
    const icons = new Set();
    const main = readFileSync(path.join(pkg, 'dist/dsfr.main.min.css'), 'utf8');
    for (const m of main.matchAll(/url\((icons\/[^)]+\.svg)\)/g)) icons.add(m[1]);
    const utility = readFileSync(path.join(pkg, 'dist/utility/icons/icons.min.css'), 'utf8');
    const rules = [];
    for (const icon of ICONS) {
      const re = new RegExp(
        `\\.fr-icon-${icon}:after,\\.fr-icon-${icon}:before\\{-webkit-mask-image:url\\(([^)]+)\\);mask-image:url\\([^)]+\\)\\}`,
      );
      const m = re.exec(utility);
      if (!m) throw new Error(`Icône introuvable : ${icon}`);
      const rel = m[1].replace(/^(\.\.\/)+/, ''); // icons/<famille>/<nom>.svg
      icons.add(rel);
      const url = `vendor/dsfr/${rel}`; // relatif à assets/dsfr-icons.css
      rules.push(`.fr-icon-${icon}::before,.fr-icon-${icon}::after{-webkit-mask-image:url(${url});mask-image:url(${url})}`);
    }
    for (const rel of icons) {
      const src = path.join(pkg, 'dist', rel);
      if (!existsSync(src)) throw new Error(`Icône absente du paquet : ${rel}`);
      mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
      cpSync(src, path.join(dest, rel));
    }
    const header = `/* Sous-ensemble des icônes DSFR v${lib.version} (Etalab-2.0), copiées dans assets/vendor/dsfr — généré par scripts/vendor.mjs */\n`;
    writeFileSync(path.join(ROOT, 'assets/dsfr-icons.css'), header + rules.join('\n') + '\n');
    console.log(`${rules.length} icônes du widget, ${icons.size} fichiers d'icônes copiés`);
  }
  const count = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
  console.log(`${lib.name}@${lib.version} → assets/vendor/${lib.dir} (${count(dest)} fichiers)`);
  lines.push(
    `| \`${lib.dir}/\` | [${lib.name}](https://www.npmjs.com/package/${lib.name}/v/${lib.version}) | ${lib.version} | ${lib.role} | \`${lib.license}\` |`,
  );
}
rmSync(tmp, { recursive: true, force: true });

writeFileSync(
  path.join(VENDOR, 'README.md'),
  `# Bibliothèques copiées dans le widget

Ces fichiers sont ceux publiés sur npm par leurs auteurs, **sans retouche** (déjà minifiés quand ils le sont à la source).
Ils sont copiés ici pour que le widget fonctionne sans CDN : il ne dépend que de l'endroit où il est publié,
et de \`grist-plugin-api.js\`, servi par Grist lui-même (il doit suivre la version de Grist).

| Dossier | Paquet | Version | Rôle | Licence |
|---|---|---|---|---|
${lines.join('\n')}

Le DSFR n'est copié qu'en partie : la feuille de style principale, ses polices, les icônes qu'elle appelle et celles
utilisées par le widget (liste dans \`scripts/vendor.mjs\`, règles CSS générées dans \`assets/dsfr-icons.css\`).

**Ne pas modifier ces fichiers à la main.** Pour changer de version : modifier \`LIBS\` dans \`scripts/vendor.mjs\`,
lancer \`npm run vendor\`, vérifier le widget (\`npm run test:ui\`, \`npm run test:erd\`, un export Word), puis
noter le changement dans \`CHANGELOG.md\`.
`,
);
console.log('assets/vendor/README.md écrit');
