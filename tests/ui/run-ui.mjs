// Test d'interface du widget (Chromium, Grist simulé).
// Usage : node tests/ui/run-ui.mjs <dossier des captures>
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { start, metadata } from './harness.mjs';

const JSZip = createRequire(import.meta.url)('jszip');

const outDir = path.resolve(process.argv[2] || 'captures');
const h = await start(outDir);
const { check } = h;
const shot = (page, name) => page.screenshot({ path: path.join(outDir, name) });

// 1. Ouverture : page Schéma par défaut, structure lue, plus aucune option de source
{
  const meta = await metadata('document-test-grist.metadata.json');
  const { context, page, frame, errors } = await h.openWidget({ meta });
  await h.waitDiagram(frame);
  check(await frame.evaluate(() => window.__ready?.requiredAccess) === 'full', 'accès complet demandé');
  const cols = await frame.evaluate(() => window.__ready?.columns);
  check(!cols, 'aucune colonne à lier');
  const tabs = await frame.locator('[role=tab]').allTextContents();
  check(tabs.map((t) => t.replace(/\d+$/, '').trim()).join(',') === 'Schéma,Tables,Analyse,DBML,Rapport', `ordre des onglets (${tabs.join(', ')})`);
  check(await frame.locator('#tab-schema').getAttribute('aria-selected') === 'true', 'Schéma ouvert par défaut');
  for (const gone of ['#source-code', '#code-input', '#strict-toggle', '#btn-edit-code', '#btn-open', '#btn-save', '#btn-wrap', '#btn-png']) {
    check(await frame.locator(gone).count() === 0, `option retirée : ${gone}`);
  }
  check(await frame.locator('a[href*="dbdiagram"], button:has-text("dbdiagram")').count() === 0, 'pas de bouton dbdiagram.io');
  check((await frame.locator('#stats').textContent()).startsWith('8 tables'), `en-tête : ${await frame.locator('#stats').textContent()}`);
  check((await frame.locator('#read-at').textContent()).startsWith('Structure lue à'), 'heure de lecture affichée');

  // Barre d'outils juste sous les onglets
  const tabsBox = await frame.locator('.pages').boundingBox();
  const barBox = await frame.locator('#tabpanel-schema .toolbar').boundingBox();
  check(Math.abs(barBox.y - (tabsBox.y + tabsBox.height)) < 2, 'barre d\'outils collée sous les onglets');
  check(barBox.height < 56, `barre d'outils du schéma sur une seule ligne (${Math.round(barBox.height)} px)`);
  check(await frame.locator('.erd-node').count() === 8, 'schéma : 8 tables');
  await shot(page, '01-schema.png');

  // Conversion corrigée : relations et types fidèles
  await frame.locator('#tab-dbml').click();
  const dbml = await frame.locator('.code').textContent();
  check(dbml.includes('Echeance integer [ref: > Dates_cles.id]'), 'DBML : relation Echeance → Dates_cles conservée');
  check(dbml.includes('Interventions_couvertes integer_list [ref: <> Interventions.id]'), 'DBML : relation multiple conservée');
  check(dbml.includes('En_poste boolean') && dbml.includes('Arrivee timestamp'), 'DBML : booléen et date-heure');
  check(!dbml.includes('court '), 'DBML : pas de colonne fantôme');
  await frame.locator('#btn-copy').click();
  check((await frame.evaluate(() => navigator.clipboard.readText())).startsWith('Table Agents {'), 'copie du DBML');
  await shot(page, '02-dbml.png');

  // Tables
  await frame.locator('#tab-tables').click();
  check(await frame.locator('.tbl').count() === 8, 'tables : 8 cartes');
  await frame.locator('label[for="cols-refs"]').click();
  const refRows = await frame.locator('.tbl__cols tbody tr').count();
  check(refRows === 5 && await frame.locator('.tbl').count() === 4, `filtre Relations : ${refRows} colonnes dans ${await frame.locator('.tbl').count()} tables`);
  await frame.locator('label[for="cols-all"]').click();
  await frame.locator('#filter-input').fill('service');
  await page.waitForTimeout(250);
  check(await frame.locator('.tbl').count() >= 2, 'recherche « service »');
  await frame.locator('#filter-input').fill('');
  await page.waitForTimeout(200);
  const [csv] = await Promise.all([page.waitForEvent('download'), frame.locator('#btn-csv').click()]);
  const csvText = await readFile(await csv.path(), 'utf8');
  check(csvText.includes('Interventions;Echeance;integer;non;Dates_cles'), 'export CSV des colonnes');
  await shot(page, '03-tables.png');
  await frame.locator('.tbl').first().locator('[data-goto-schema]').click();
  check(await frame.locator('#tab-schema').getAttribute('aria-selected') === 'true', 'bouton Schéma d\'une carte');

  // Analyse
  await frame.locator('#tab-analysis').click();
  const analysis = await frame.locator('#analysis-body').textContent();
  check(analysis.includes('Prêt pour l\'import'), 'analyse : verdict « Prêt pour l\'import »');
  check(await frame.locator('.insight').count() === 3, `analyse : 3 constats (${await frame.locator('.insight').count()})`);
  check(analysis.includes('Comment corriger dans Grist') && analysis.includes('Type de colonne'), 'analyse : étapes de correction');
  check(!/formula\[default\]|formule d'origine/.test(analysis), 'analyse : sans jargon ni référence à l\'ancienne formule');
  await frame.locator('label[for="level-check"]').click();
  check(await frame.locator('.insight').count() === 2, 'filtre « À vérifier »');
  await frame.locator('label[for="level-all"]').click();
  await shot(page, '04-analyse.png');
  await frame.locator('.insight .fr-tag', { hasText: 'Table1' }).first().click();
  check(await frame.locator('#tab-schema').getAttribute('aria-selected') === 'true', 'clic sur un élément concerné → schéma');

  // Rapport
  await frame.locator('#tab-report').click();
  await frame.waitForSelector('.doc__figure img[src^="blob:"]', { timeout: 30000 });
  const preview = await frame.locator('.doc').textContent();
  check(['Résumé', 'Schéma', 'Tables et colonnes', 'Analyse', 'Code DBML'].every((t) => preview.includes(t)), 'rapport : aperçu des 5 sections');
  await shot(page, '05-rapport.png');
  await frame.locator('[data-section="dbml"]').click();
  check(!(await frame.locator('.doc').textContent()).includes('Code DBML'), 'rapport : section retirée de l\'aperçu');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), frame.locator('#btn-docx').click()]);
  await dl.saveAs(path.join(outDir, 'rapport.docx'));
  const zip = await JSZip.loadAsync(await readFile(path.join(outDir, 'rapport.docx')));
  const xml = await zip.file('word/document.xml').async('string');
  check(dl.suggestedFilename().endsWith('.docx') && xml.includes('>Tables et colonnes<') && !xml.includes('>Code DBML<'), `rapport Word téléchargé (${dl.suggestedFilename()})`);
  const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/') && !zip.files[f].dir);
  const img = media.length ? await zip.file(media[0]).async('uint8array') : new Uint8Array();
  check(img.length > 20000, `rapport Word : image du schéma intégrée (${img.length} octets)`);
  await frame.locator('[data-section="dbml"]').click();

  await frame.locator('#tab-report').focus();
  await frame.locator('#tab-report').press('ArrowLeft');
  check(await frame.locator('#tab-dbml').getAttribute('aria-selected') === 'true', 'clavier : flèche gauche');
  check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

// 2. Accès refusé : message clair
{
  const { context, page, frame, errors } = await h.openWidget({ meta: { tables: {}, cols: {} }, fail: true });
  await frame.waitForSelector('#doc-alert .fr-alert');
  check((await frame.locator('#doc-alert').textContent()).includes('Accès complet requis'), 'accès refusé : explication');
  await shot(page, '06-acces.png');
  check(errors.length === 0, `accès refusé : aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

// 3. Hors de Grist
{
  const p = await h.page('/index.html');
  await p.waitForTimeout(300);
  check((await p.locator('#doc-alert').textContent()).includes('Ouvrez ce widget dans un document Grist'), 'hors de Grist : message');
  await p.close();
}

// 4. Petit format, thème sombre
for (const [name, viewport, dark] of [['07-etroit', { width: 420, height: 860 }, false], ['08-sombre', { width: 1200, height: 760 }, true]]) {
  const meta = await metadata('document-exemple.code.py');
  const { context, page, frame, errors } = await h.openWidget({ meta, viewport, dark });
  await h.waitDiagram(frame);
  await shot(page, `${name}.png`);
  const overflow = await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `${name} : pas de défilement horizontal (${overflow}px)`);
  if (dark) check(await frame.evaluate(() => document.documentElement.dataset.frTheme) === 'dark', 'sombre : thème DSFR sombre');
  check(errors.length === 0, `${name} : aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

await h.finish();
console.log('\nTous les contrôles d\'interface passent.');
