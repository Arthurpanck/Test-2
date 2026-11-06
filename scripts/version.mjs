// Change le numéro de version du widget : package.json et index.html (paramètre ?v= des feuilles de
// style et du script d'entrée, pour que le navigateur ne garde pas l'ancienne version en cache).
// Les modules importés par app.js n'en portent pas : publier par l'URL du commit (raw.githack.com/…/<commit>/index.html),
// qui change à chaque version.
// Usage : npm run version -- 3.19.0
import { readFile, writeFile } from 'node:fs/promises';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage : npm run version -- <majeur.mineur.correctif>');
  process.exit(1);
}
const root = new URL('../', import.meta.url);
const pkgUrl = new URL('package.json', root);
const pkg = JSON.parse(await readFile(pkgUrl, 'utf8'));
const before = pkg.version;
pkg.version = version;
await writeFile(pkgUrl, `${JSON.stringify(pkg, null, 2)}\n`);
const htmlUrl = new URL('index.html', root);
const html = await readFile(htmlUrl, 'utf8');
await writeFile(htmlUrl, html.replace(/\?v=\d+\.\d+\.\d+/g, `?v=${version}`));
console.log(`Version ${before} → ${version}`);
