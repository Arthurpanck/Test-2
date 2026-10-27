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
  check(tabs.map((t) => t.replace(/\d+$/, '').trim()).join(',') === 'Schéma,Tables,Accès,Widgets,Analyse,Rapport', `ordre des onglets (${tabs.join(', ')})`);
  check(await frame.locator('#tab-schema').getAttribute('aria-selected') === 'true', 'Schéma ouvert par défaut');
  for (const gone of ['#source-code', '#code-input', '#strict-toggle', '#btn-edit-code', '#btn-open', '#btn-save', '#btn-wrap', '#btn-png', '#btn-goto-report', '[data-goto-line]']) {
    check(await frame.locator(gone).count() === 0, `option retirée : ${gone}`);
  }
  check(await frame.locator('a[href*="dbdiagram"], button:has-text("dbdiagram")').count() === 0, 'pas de bouton dbdiagram.io');
  check((await frame.locator('#stats').textContent()).startsWith('8 tables'), `en-tête : ${await frame.locator('#stats').textContent()}`);
  check((await frame.locator('#read-at').textContent()).startsWith('Lue à'), 'heure de lecture affichée');
  // En-tête sur la ligne des onglets
  const tabBox = await frame.locator('#tab-schema').boundingBox();
  const refreshBox = await frame.locator('#btn-refresh').boundingBox();
  check(Math.abs((refreshBox.y + refreshBox.height / 2) - (tabBox.y + tabBox.height / 2)) < 8, 'bouton « Relire » sur la ligne des onglets');
  check(await frame.locator('.app__header').count() === 0, 'plus de bandeau d\'en-tête séparé');

  // Barre d'outils juste sous les onglets
  const tabsBox = await frame.locator('.pages').boundingBox();
  const barBox = await frame.locator('#tabpanel-schema .toolbar').boundingBox();
  check(Math.abs(barBox.y - (tabsBox.y + tabsBox.height)) < 2, 'barre d\'outils collée sous les onglets');
  check(barBox.height < 56, `barre d'outils du schéma sur une seule ligne (${Math.round(barBox.height)} px)`);
  const ctrl = await frame.evaluate(() => [...document.querySelectorAll('#tabpanel-schema .toolbar :is(button, output, input:not([type=radio]), .fr-segmented__elements)')]
    .filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { id: e.id || e.className, top: Math.round(r.top), h: Math.round(r.height), shadow: cs.boxShadow }; }));
  const tops = new Set(ctrl.map((c) => c.top));
  const heights = new Set(ctrl.map((c) => c.h));
  check(tops.size === 1 && heights.size === 1, `contrôles alignés et de même hauteur (${[...heights].join('/')} px, ${tops.size} ligne)`);
  check(ctrl.every((c) => c.shadow && c.shadow !== 'none'), 'tous les contrôles sont encadrés');
  const types = await frame.locator('.erd-node[data-id="Agents"] .erd-row__type').allTextContents();
  check(types.includes('Booléen') && types.includes('Date et Heure') && types.includes('Choix multiple') && !types.some((t) => /varchar|integer/.test(t)), `types en français sur le schéma (${types.join(', ')})`);
  check(await frame.locator('.erd-node').count() === 8, 'schéma : 8 tables');
  await shot(page, '01-schema.png');

  // Conversion corrigée : relations et types fidèles
  check(await frame.locator('#tab-dbml').count() === 0, 'plus d\'onglet DBML');

  // Tables
  await frame.locator('#tab-tables').click();
  check(await frame.locator('.tbl').count() === 8, 'tables : 8 cartes');
  await frame.locator('label[for="cols-refs"]').click();
  const refRows = await frame.locator('.tbl__cols tbody tr:not(.tbl__detail)').count();
  check(refRows === 5 && await frame.locator('.tbl').count() === 4, `filtre Relations : ${refRows} colonnes dans ${await frame.locator('.tbl').count()} tables`);
  await frame.locator('label[for="cols-all"]').click();
  await frame.locator('#filter-input').fill('service');
  await page.waitForTimeout(250);
  check(await frame.locator('.tbl').count() >= 2, 'recherche « service »');
  await frame.locator('#filter-input').fill('');
  await page.waitForTimeout(200);
  const [csv] = await Promise.all([page.waitForEvent('download'), frame.locator('#btn-csv').click()]);
  const csvText = await readFile(await csv.path(), 'utf8');
  check(csvText.includes('Interventions;Echeance;;Référence;non;Dates_cles'), `export CSV des colonnes`);
  await shot(page, '03-tables.png');
  await frame.locator('.tbl').first().locator('[data-goto-schema]').click();
  check(await frame.locator('#tab-schema').getAttribute('aria-selected') === 'true', 'bouton Schéma d\'une carte');

  // Analyse
  await frame.locator('#tab-analysis').click();
  const analysis = await frame.locator('#analysis-body').textContent();
  check(analysis.includes('Aucun point bloquant'), 'analyse : verdict « Aucun point bloquant »');
  check(await frame.locator('.insight').count() === 6, `analyse : 6 constats (${await frame.locator('.insight').count()})`);
  check(analysis.includes('Aucune règle d\'accès avancée') && analysis.includes('jamais utilisée'), 'analyse : droits d\'accès et colonnes vides');
  check(!/DBML/.test(analysis), 'analyse : ne parle pas du DBML');
  const gap = await frame.locator('.insight__targets').first().evaluate((el) => getComputedStyle(el).columnGap);
  check(parseFloat(gap) >= 6, `analyse : étiquettes « Concerné » séparées (${gap})`);
  check(analysis.includes('Comment corriger dans Grist') && analysis.includes('Type de colonne'), 'analyse : étapes de correction');
  check(!/formula\[default\]|formule d'origine/.test(analysis), 'analyse : sans jargon ni référence à l\'ancienne formule');
  await frame.locator('label[for="level-choice"]').click();
  check(await frame.locator('.insight').count() === 2, `filtre « Choix à confirmer » (${await frame.locator('.insight').count()})`);
  await frame.locator('label[for="level-all"]').click();
  await shot(page, '04-analyse.png');
  await frame.locator('.insight .fr-tag', { hasText: 'Table1' }).first().click();
  check(await frame.locator('#tab-schema').getAttribute('aria-selected') === 'true', 'clic sur un élément concerné → schéma');

  // Rapport
  await frame.locator('#tab-report').click();
  await frame.waitForSelector('.doc__figure img[src^="blob:"]', { timeout: 30000 });
  const preview = await frame.locator('.doc').textContent();
  check(!preview.includes('swd2QJ') && preview.includes('Document Grist'), 'rapport : identifiant interne masqué');
  check(['Résumé', 'Schéma', 'Tables et colonnes', 'Widgets', 'Analyse', 'Droits d\'accès', 'Code DBML'].every((t) => preview.includes(t)) && preview.lastIndexOf('Code DBML') > preview.lastIndexOf('Droits d\'accès'), 'rapport : sections, code DBML à la fin');
  await shot(page, '05-rapport.png');
  await frame.locator('[data-section="access"]').click();
  check(!(await frame.locator('.doc').textContent()).includes('aucune règle d\'accès avancée : chaque'), 'rapport : section retirée de l\'aperçu');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), frame.locator('#btn-docx').click()]);
  await dl.saveAs(path.join(outDir, 'rapport.docx'));
  const zip = await JSZip.loadAsync(await readFile(path.join(outDir, 'rapport.docx')));
  const xml = await zip.file('word/document.xml').async('string');
  check(dl.suggestedFilename() === 'structure-document.docx' && xml.includes('>Tables et colonnes<') && !xml.includes('aucune règle d\'accès avancée : chaque'), `rapport Word téléchargé (${dl.suggestedFilename()})`);
  const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/') && !zip.files[f].dir);
  const img = media.length ? await zip.file(media[0]).async('uint8array') : new Uint8Array();
  check(img.length > 20000, `rapport Word : image du schéma intégrée (${img.length} octets)`);
  await frame.locator('[data-section="access"]').click();

  await frame.locator('#tab-report').focus();
  await frame.locator('#tab-report').press('ArrowLeft');
  check(await frame.locator('#tab-analysis').getAttribute('aria-selected') === 'true', 'clavier : flèche gauche');
  check(await frame.locator('.doc__toc a').count() >= 5 && xml.includes('w:bookmarkStart'), 'rapport : sommaire cliquable (aperçu et Word)');
  check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

// 1 bis. Document complexe : 22 tables, tous les types, règles d'accès
{
  const meta = await metadata('document-complexe.metadata.json');
  const { context, page, frame, errors } = await h.openWidget({ meta, viewport: { width: 1280, height: 860 } });
  const t0 = Date.now();
  await h.waitDiagram(frame);
  check(await frame.locator('.erd-node').count() === 22, `complexe : 22 tables sur le schéma (${await frame.locator('.erd-node').count()}, ${Date.now() - t0} ms)`);
  const overlap = await frame.evaluate(() => {
    const r = [...document.querySelectorAll('.erd-node')].map((n) => n.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (r[i].left < r[j].right && r[j].left < r[i].right && r[i].top < r[j].bottom && r[j].top < r[i].bottom) n++;
    return n;
  });
  check(overlap === 0, `complexe : aucune table superposée (${overlap})`);
  await frame.locator('#btn-zoom-fit').click();
  await page.waitForTimeout(300);
  await shot(page, '10-complexe-schema.png');

  // Tables : détails
  await frame.locator('#tab-tables').click();
  check(await frame.locator('#btn-details').count() === 0 && await frame.locator('#btn-minimap').count() === 0, 'plus de boutons Détails ni Mini-carte');
  const agents = await frame.locator('#tbl-Agents').textContent();
  check(agents.includes('Formule d\'initialisation') && agents.includes('NOW()') && agents.includes('aux nouvelles lignes seulement'), 'complexe : formule d\'initialisation et déclenchement');
  check(agents.includes('Catégorie A') && agents.includes('Une ligne par agent'), 'complexe : choix et description de table');
  check((await frame.locator('#tbl-Taches').textContent()).includes('choice.Service == $Projet.Service_pilote'), 'complexe : liste filtrée');
  await frame.locator('#tables-body').evaluate((el) => { const a = document.getElementById('tbl-Agents'); el.scrollTop = a.offsetTop - el.offsetTop - 12; });
  await shot(page, '11-complexe-details.png');

  // Analyse
  await frame.locator('#tab-analysis').click();
  const analysis = await frame.locator('#analysis-body').textContent();
  check(analysis.includes('à corriger') && analysis.includes('attribut inexistant') && analysis.includes('contourner les restrictions de lecture'), 'complexe : constats sur les droits d\'accès');
  check(await frame.locator('.insight .insight__area', { hasText: 'Droits d\'accès' }).count() >= 5, 'complexe : constats étiquetés « Droits d\'accès »');
  await shot(page, '12-complexe-analyse.png');
  await frame.locator('.insight--blocking [data-goto-access]').first().click();
  check(await frame.locator('#tab-access').getAttribute('aria-selected') === 'true', 'complexe : « Voir les droits d\'accès » ouvre la page Accès');

  // Accès
  const access = await frame.locator('#access-body').textContent();
  check(access.includes('Réglages généraux') && access.includes('Attributs utilisateur') && access.includes('Règles par défaut'), 'accès : sections principales');
  check(await frame.locator('.acl-table').count() === 8 + 11, `accès : toutes les tables affichées (${await frame.locator('.acl-table').count()})`);
  check(access.includes('Personnes dont « Habilitation.Role » vaut « RH »') && access.includes('Fiches réservées au service RH.'), 'accès : conditions en clair et messages');
  check(await frame.locator('#acl-Agents .perm--deny').count() >= 4 && await frame.locator('#acl-Agents .perm--allow').count() >= 4, 'accès : permissions Autorisé / Refusé');
  check(access.includes('« user.Profil » n\'est défini nulle part'), 'accès : attribut inexistant signalé sur la règle');
  await frame.locator('#access-body').evaluate((el) => { el.scrollTop = 0; });
  await shot(page, '13-acces.png');
  await frame.locator('#access-body').evaluate((el) => { const a = document.getElementById('acl-Agents'); el.scrollTop = a.offsetTop - el.offsetTop - 12; });
  await shot(page, '14-acces-agents.png');
  const pagesTop = await frame.locator('.pages').boundingBox();
  check(pagesTop.y >= 0, 'les onglets restent visibles après un saut');
  await frame.locator('#access-filter').fill('Email');
  await page.waitForTimeout(250);
  check(await frame.locator('.acl-table').count() === 2, `accès : filtre « Email » (${await frame.locator('.acl-table').count()} tables)`);
  await frame.locator('#access-filter').fill('');
  await page.waitForTimeout(250);
  check(await frame.locator('#access-all').count() === 0, 'accès : plus de choix « Tables avec règles / Toutes »');
  const [csv] = await Promise.all([page.waitForEvent('download'), frame.locator('#btn-access-csv').click()]);
  const csvText = await readFile(await csv.path(), 'utf8');
  check(csvText.includes('Agents;*;4;Tous les autres;;refusé;refusé;refusé;refusé;;-CRUD;Fiches réservées au service RH.'), 'accès : export CSV des règles');

  // Rapport
  await frame.locator('#tab-report').click();
  await frame.waitForSelector('.doc__figure img[src^="blob:"]', { timeout: 60000 });
  check((await frame.locator('.doc').textContent()).includes('Structure et droits d\'accès'), 'rapport : titre adapté');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), frame.locator('#btn-docx').click()]);
  await dl.saveAs(path.join(outDir, 'rapport-complexe.docx'));
  const zip = await JSZip.loadAsync(await readFile(path.join(outDir, 'rapport-complexe.docx')));
  const xml = await zip.file('word/document.xml').async('string');
  check(xml.includes('user.Habilitation') && xml.includes('Formule d'), 'rapport complexe : droits d\'accès et formules');
  check(errors.length === 0, `complexe : aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

// 1 quater. Document mal structuré : données lues, défauts repérés, « C'est voulu »
{
  const meta = await metadata('mal-structure.mjs');
  const { context, page, frame, errors } = await h.openWidget({ meta, viewport: { width: 1280, height: 860 } });
  await h.waitDiagram(frame);
  await frame.locator('#tab-tables').click();
  check((await frame.locator('#tbl-Commandes .tbl__meta').textContent()).includes('24 lignes'), 'mal structuré : nombre de lignes affiché');
  await frame.locator('#tab-analysis').click();
  const text = await frame.locator('#analysis-body').textContent();
  for (const t of ['liens écrits à la main', 'saisies en texte', 'listes de choix', 'copie de table protégée', 'noms laissés par défaut', 'tables sans aucune ligne']) {
    check(text.includes(t), `mal structuré : « ${t} »`);
  }
  check(!/DBML/.test(text), 'mal structuré : analyse sans DBML');
  check(text.includes('au nom par défaut') && text.includes('avec accès complet') && text.includes('sans ses colonnes') && text.includes('affichées sur aucune page'), 'mal structuré : constats sur les pages et widgets');
  await frame.locator('#tab-widgets').click();
  const w = await frame.locator('#widgets-body').textContent();
  check(await frame.locator('.widget-card').count() === 5 && w.includes('Code dans le document') && w.includes('widgets.exemple.fr') && w.indexOf('Widgets non officiels') < w.indexOf('Widgets personnalisés'), 'onglet Widgets : non officiels en premier, avec origine et adresse');
  check(await frame.locator('.widget-cols li').count() >= 3 && !(await frame.locator('#widgets-body').textContent()).includes('gristlabs.github.io'), 'onglet Widgets : galerie réduite à l\'accès et aux colonnes en liste');
  check(w.includes('Fiche client') && w.includes('Graphique (barres)') && !/\bTableau · table\b/.test(w) && w.includes('que des tableaux') && w.includes('Brouillon'), 'onglet Widgets : tableaux exclus, autres vues par page');
  check(await frame.locator('.widget-cols--missing').count() === 3, 'onglet Widgets : colonnes à associer signalées');
  await shot(page, '17-widgets.png');
  await frame.locator('#tab-report').click();
  await frame.waitForSelector('.doc__toc', { timeout: 30000 });
  const doc = await frame.locator('.doc').textContent();
  check(doc.includes('Widgets personnalisés') && doc.includes('Widgets non officiels') && doc.includes('Tableau croisé dynamique') && doc.includes('Table des matières'), 'rapport : section Widgets');
  await frame.locator('#tab-analysis').click();
  await page.waitForTimeout(600);
  await shot(page, '16-mal-structure-analyse.png');
  await frame.locator('label[for="level-choice"]').click();
  const before = Number((await frame.locator('#level-choice-label').textContent()).match(/\((\d+)\)/)[1]);
  check(await frame.locator('.insight--choice .insight__intended').count() === before, 'choix : « Si c\'est voulu » sur chaque carte');
  await frame.locator('.insight--choice [data-action="accept"]').first().click();
  await page.waitForTimeout(200);
  const after = Number((await frame.locator('#level-choice-label').textContent()).match(/\((\d+)\)/)[1]);
  check(after === before - 1, `« C'est voulu » : ${before} → ${after} choix à confirmer`);
  check(Array.isArray((await frame.evaluate(() => window.__options.accepted))) && (await frame.evaluate(() => window.__options.accepted.length)) === 1, '« C\'est voulu » mémorisé dans les options du widget');
  await frame.locator('label[for="level-accepted"]').click();
  check(await frame.locator('.insight--accepted').count() === 1 && (await frame.locator('#level-accepted-label').textContent()).includes('(1)'), 'section « Choix confirmés »');
  const order = await frame.locator('#tabpanel-analysis .fr-segmented__element label').allTextContents();
  check(order[order.length - 1].startsWith('Tout') && order.map((t) => t.replace(/ \(\d+\)/, '')).join('|') === 'À corriger|À améliorer|Choix à confirmer|Choix confirmés|Bon à savoir|Tout', `filtres : ${order.join(' | ')}`);
  await shot(page, '17-choix.png');
  check(errors.length === 0, `mal structuré : aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

// 1 ter. Widget peu haut (cas courant dans Grist) : le contenu défile, onglets et barre d'outils restent visibles
{
  const meta = await metadata('document-complexe.metadata.json');
  const { context, page, frame } = await h.openWidget({ meta, viewport: { width: 1000, height: 420 } });
  await h.waitDiagram(frame);
  await frame.locator('#tab-analysis').click();
  const box = await frame.locator('#analysis-body').boundingBox();
  await page.mouse.move(box.x + 200, box.y + 150);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(400);
  const scrolled = await frame.locator('#analysis-body').evaluate((el) => el.scrollTop);
  check(scrolled > 100, `widget peu haut : la page défile à la molette (${scrolled} px)`);
  check((await frame.locator('.pages').boundingBox()).y >= 0, 'widget peu haut : onglets toujours visibles');
  await shot(page, '15-widget-bas.png');
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
