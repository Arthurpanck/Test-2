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
  check(barBox.height < 72, `barre d'outils du schéma sur une seule ligne (${Math.round(barBox.height)} px)`);
  const ctrl = await frame.evaluate(() => [...document.querySelectorAll('#tabpanel-schema .toolbar :is(button, input:not([type=radio]), .fr-segmented__elements)')]
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
  const refRows = await frame.locator('.tbl tbody tr').count();
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
  check(analysis.includes('Aucun problème bloquant'), 'analyse : verdict « Aucun problème bloquant »');
  const total = Number(await frame.locator('#level-all .tile__n').textContent());
  check(await frame.locator('.insight').count() === total && total > 0, `analyse : autant de cartes que la tuile « Tout » (${await frame.locator('.insight').count()} / ${total})`);
  check(analysis.includes('Aucune règle d\'accès avancée') && analysis.includes('non typée'), 'analyse : droits d\'accès et colonnes vides');
  check(!/DBML/.test(analysis), 'analyse : ne parle pas du DBML');
  const gap = await frame.locator('.insight__targets').first().evaluate((el) => getComputedStyle(el).columnGap);
  check(parseFloat(gap) >= 6, `analyse : étiquettes « Concerné » séparées (${gap})`);
  check(analysis.includes('Comment corriger dans Grist') && analysis.includes('Type de colonne'), 'analyse : étapes de correction');
  check(!/formula\[default\]|formule d'origine/.test(analysis), 'analyse : sans jargon ni référence à l\'ancienne formule');
  await frame.locator('#level-choice').click();
  const nChoice = Number(await frame.locator('#level-choice .tile__n').textContent());
  check(await frame.locator('.insight').count() === nChoice && await frame.locator('#level-choice').getAttribute('aria-pressed') === 'true', `tuile « Choix à confirmer » = filtre (${await frame.locator('.insight').count()} / ${nChoice})`);
  await frame.locator('label[for="area-structure"]').click();
  check(await frame.locator('.insight').count() > 0 && await frame.locator('.insight .insight__area:not(:text-is("Structure"))').count() === 0, 'filtre par domaine');
  await frame.locator('label[for="area-all"]').click();
  await frame.locator('#level-all').click();
  await shot(page, '04-analyse.png');
  check(await frame.locator('.coverage li').count() >= 2 && await frame.locator('.coverage__go').count() === 0, 'couverture : tous les contrôles sans constat');
  await frame.locator('.insight .chip', { hasText: 'Table1' }).first().click();
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
  await frame.locator('[data-index-table="Taches"]').click();
  await page.waitForTimeout(300);
  check(await frame.locator('[data-index-table="Taches"]').evaluate((b) => b.classList.contains('is-current')), 'index des tables : saut et mise en évidence');
  await frame.locator('#tables-body').evaluate((el) => { const a = document.getElementById('tbl-Agents'); el.scrollTop = a.offsetTop - el.offsetTop - 12; });
  await shot(page, '11-complexe-details.png');

  // Analyse
  await frame.locator('#tab-analysis').click();
  const analysis = await frame.locator('#analysis-body').textContent();
  check(analysis.includes('à corriger') && analysis.includes('attribut inconnu') && analysis.includes('Accès des éditeurs aux données malgré les droits d’accès'), 'complexe : constats sur les droits d\'accès');
  check(await frame.locator('.insight .insight__area', { hasText: 'Droits d\'accès' }).count() >= 5, 'complexe : constats étiquetés « Droits d\'accès »');
  await shot(page, '12-complexe-analyse.png');
  await frame.locator('.coverage__go').first().click();
  check(await frame.locator('.insight.is-target').count() === 1, 'couverture : « Voir le constat » mène à la carte');
  await frame.locator('.insight--blocking [data-goto-access]').first().click();
  check(await frame.locator('#tab-access').getAttribute('aria-selected') === 'true', 'complexe : « Voir les droits d\'accès » ouvre la page Accès');

  // Accès
  const access = await frame.locator('#access-body').textContent();
  const tilesBlocking = Number(await frame.locator('#level-blocking .tile__n').textContent());
  check(Number(await frame.locator('#analysis-count').textContent()) === tilesBlocking && (await frame.locator('.verdict__title').textContent()).startsWith(`${tilesBlocking} point`), `un seul chiffre « à corriger » : onglet, verdict et tuile (${tilesBlocking})`);
  check(access.includes('Réglages généraux') && access.includes('Attributs utilisateur') && access.includes('Droits d’accès par défaut'), 'accès : sections principales');
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

// 1 ter bis. Accès · « Qui peut faire quoi ? » : matrice par rôle métier (rôle Grist Éditeur)
for (const [label, viewport, dark] of [['clair', { width: 1280, height: 860 }, false], ['sombre', { width: 960, height: 760 }, true]]) {
  const meta = await metadata('document-complexe.metadata.json');
  const { habilitations } = await import('../fixtures/droits-complexe.mjs');
  meta.records = { Habilitations: habilitations };
  const { context, page, frame, errors } = await h.openWidget({ meta, viewport, dark });
  await h.waitDiagram(frame);
  await frame.locator('#tab-access').click();
  const mx = frame.locator('#rights-matrix');
  const cell = (key, g, bit) => mx.locator(`[data-matrix-cell="${key}|${g}|${bit}"]`);
  const line = async (key, g) => (await Promise.all(['R', 'U', 'C', 'D'].map(async (b) => (await cell(key, g, b).count() ? (await cell(key, g, b).textContent()).trim() : '—')))).join(' / ');
  if (!dark) {
    const titles = await frame.locator('#access-body .sec__title').allTextContents();
    check(titles[0] === 'Qui peut faire quoi ?' && titles[1] === 'Réglages généraux', `matrice : avant les réglages généraux (${titles.slice(0, 3).join(', ')})`);
    check((await mx.locator('.sec__head .count').textContent()) === '22', 'matrice : compte des tables (22)');
    const groups = await mx.locator('.mx__group strong').allTextContents();
    check(groups.join('|') === 'RH|Finances|Tous les autres', `matrice : groupes (${groups.join(', ')})`);
    check((await mx.locator('.mx__group span').first().textContent()) === 'Habilitation.Role = « RH » · 7 services', 'matrice : 7 services comptés dans la table de l\'attribut');
    check(await mx.locator('[data-matrix-detail="columns"]').getAttribute('aria-pressed') === 'true', 'matrice : « Par table et par colonne » par défaut');
    check(await line('Agents', 1) === 'Email / Non / Non / Non' && await line('Agents', 0) === 'Oui / Oui / Oui / Oui', `matrice : Agents (${await line('Agents', 1)})`);
    check(await line('Agents.Quotite', 0) === 'Oui / Oui / — / —' && await line('Agents.Quotite', 2) === 'Non / Non / — / —', 'matrice : colonne Quotite, Créer et Supprimer sans objet');
    check(await line('Depenses', 0) === 'Service / Non / Non / Non' && await line('Formations', 2) === 'Oui / ? / Oui / Oui', 'matrice : Depenses et Formations');
    check(await mx.locator('.mx__row--structure [data-matrix-cell]').count() === 3, 'matrice : une case de structure par groupe');
    check(await cell('Agents', 1, 'R').getAttribute('title') === 'Oui, seulement sur les lignes de son Email.', 'matrice : phrase complète en infobulle');
    const labels = await mx.locator('.mx__row > .mx__label').allTextContents();
    check(labels[1] === 'Table1' && labels.includes('Taches_summary'), `matrice : tables dans l'ordre du document, résumés compris (${labels.slice(0, 3).join(', ')})`);
    // Mode « Par table »
    await mx.locator('[data-matrix-detail="tables"]').click();
    check(await mx.locator('.mx__row--column').count() === 0 && await mx.locator('[data-matrix-detail="tables"]').getAttribute('aria-pressed') === 'true', 'matrice : « Par table » masque les colonnes');
    check(await frame.evaluate(() => document.activeElement?.dataset.matrixDetail) === 'tables', 'matrice : le focus reste sur le bouton');
    await mx.locator('[data-matrix-detail="columns"]').click();
    check(await mx.locator('.mx__row--column').count() === 4, 'matrice : 4 colonnes à règles');
    // Détail d'une case, au clavier
    await cell('Agents', 1, 'R').focus();
    await page.keyboard.press('Enter');
    const detail = mx.locator('.mx__detail');
    check(await detail.isVisible() && (await detail.locator('.mx__meta').textContent()) === 'Finances · Lire · rôle Grist Éditeur', 'matrice : détail ouvert au clavier');
    check(await cell('Agents', 1, 'R').evaluate((b) => b.classList.contains('is-picked') && document.activeElement === b), 'matrice : case choisie entourée, focus conservé');
    const steps = await detail.locator('.mx__step').allTextContents();
    check(steps.length >= 2 && steps.some((x) => x.includes('Décide')) && steps.some((x) => x.includes('Selon la ligne (Email)')), `matrice : étapes du raisonnement (${steps.length})`);
    check((await detail.locator('.mx__sentence strong').allTextContents()).includes('Email'), 'matrice : colonne décisive en gras');
    await shot(page, '18-matrice.png');
    await detail.locator('[data-matrix-close]').click();
    check(await detail.isHidden(), 'matrice : « Fermer » referme le détail');
    check(await frame.evaluate(() => document.activeElement?.dataset.matrixCell) === 'Agents|1|R', 'matrice : focus rendu à la case');
    const focused = () => frame.evaluate(() => document.activeElement?.dataset.matrixCell);
    await page.keyboard.press('ArrowRight');
    const right = await focused();
    await page.keyboard.press('ArrowDown');
    const down = await focused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    const skip = await focused();
    check(right === 'Agents|1|U' && down === 'Agents.Quotite|1|U' && skip && !skip.startsWith('Agents') && skip.endsWith('|1|C'), `matrice : flèches d'une case à l'autre, cases « — » sautées (${right}, ${down}, ${skip})`);
    await page.keyboard.press('Enter');
    check(await detail.isVisible(), 'matrice : Entrée ouvre le détail');
    await page.keyboard.press('Escape');
    check(await detail.isHidden() && (await focused()) === skip, 'matrice : Échap referme le détail');
    await cell('Depenses', 0, 'R').click();
    await detail.locator('[data-goto-access="Depenses"]').click();
    await page.waitForTimeout(400);
    const card = await frame.locator('#acl-Depenses').boundingBox();
    const bodyBox = await frame.locator('#access-body').boundingBox();
    check(card && card.y >= bodyBox.y - 2 && card.y < bodyBox.y + 200, 'matrice : « Voir les règles de Depenses » mène à la carte');
    check(await frame.locator('#access-body .sec__title').allTextContents().then((t) => t.includes('Droits d’accès par table')), 'matrice : le reste de l\'onglet est inchangé');
    // Export Excel : matrice, détail filtrable, paramètres
    const [xl] = await Promise.all([page.waitForEvent('download'), mx.locator('[data-matrix-xlsx]').click()]);
    check(xl.suggestedFilename().startsWith('qui-peut-faire-quoi-') && xl.suggestedFilename().endsWith('.xlsx'), `matrice : nom du fichier Excel (${xl.suggestedFilename()})`);
    const xz = await JSZip.loadAsync(await readFile(await xl.path()));
    const wbx = await xz.file('xl/workbook.xml').async('string');
    const sst = await xz.file('xl/sharedStrings.xml').async('string');
    check(['Qui peut faire quoi', 'Détail par case', 'Paramètres'].every((n) => wbx.includes(`name="${n}"`)) && wbx.includes('_xlnm._FilterDatabase') && Boolean(xz.file('xl/tables/table1.xml')), 'matrice : classeur à trois feuilles, filtres et tableau Excel');
    check(sst.includes('Habilitation.Role = « RH » · 7 services') && sst.includes('Oui, seulement sur les lignes de son Email.'), 'matrice : groupes et explications dans le classeur');
    // Rapport : la matrice au début des droits d'accès
    await frame.locator('#tab-report').click();
    await frame.waitForSelector('.doc', { timeout: 30000 });
    const docText = await frame.locator('.doc').textContent();
    check(docText.includes('Qui peut faire quoi ?') && await frame.locator('.doc .doc__fill--ok').count() > 50 && await frame.locator('.doc td[colspan="4"]').count() === 3, 'rapport : matrice dans l\'aperçu');
    await frame.locator('#access-body').evaluate(() => {});
    await frame.locator('.doc .doc__h2', { hasText: 'Qui peut faire quoi' }).scrollIntoViewIfNeeded();
    await shot(page, '20-rapport-matrice.png');
    const [wd] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), frame.locator('#btn-docx').click()]);
    const wz = await JSZip.loadAsync(await readFile(await wd.path()));
    const wxml = await wz.file('word/document.xml').async('string');
    check(wxml.includes('>Qui peut faire quoi ?<') && wxml.includes('w:orient="landscape"') && wxml.includes('w:fill="DFFEE6"'), 'rapport Word : matrice en paysage');
    await frame.locator('#tab-access').click();
    // Le filtre des règles masque la matrice (comme les réglages)
    await frame.locator('#access-filter').fill('Email');
    await page.waitForTimeout(250);
    check(await mx.count() === 0, 'matrice : masquée pendant une recherche');
    await frame.locator('#access-filter').fill('');
    await page.waitForTimeout(250);
    const overflow = await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, `matrice : seule la grille défile horizontalement (${overflow}px)`);
  } else {
    await cell('Agents', 0, 'R').click();
    await frame.locator('#access-body').evaluate((el) => { el.scrollTop = 0; });
    await shot(page, '19-matrice-sombre-960.png');
    const grid = await mx.locator('.mx__scroll').evaluate((el) => el.scrollWidth > el.clientWidth);
    check(grid, 'matrice 960 px : défilement horizontal de la grille');
  }
  check(errors.length === 0, `matrice (${label}) : aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

// 1 quater. Document mal structuré : données lues, défauts repérés, « C'est voulu »
{
  const meta = await metadata('mal-structure.mjs');
  const { context, page, frame, errors } = await h.openWidget({ meta, viewport: { width: 1280, height: 860 } });
  await h.waitDiagram(frame);
  await frame.locator('#tab-tables').click();
  check((await frame.locator('#tbl-Commandes .card__meta').textContent()).includes('24 lignes'), 'mal structuré : nombre de lignes affiché');
  await frame.locator('#tab-analysis').click();
  const text = await frame.locator('#analysis-body').textContent();
  for (const t of ['liens écrits à la main', 'saisies en texte', 'listes de choix', 'tables sans aucune ligne']) {
    check(text.includes(t), `mal structuré : « ${t} »`);
  }
  check(!/DBML/.test(text), 'mal structuré : analyse sans DBML');
  check(text.includes('au nom par défaut') && !text.includes('Un widget externe avec accès complet') && text.includes('sans ses colonnes') && text.includes('ne figure dans aucune page'), 'mal structuré : constats sur les pages et widgets');
  await frame.locator('#tab-widgets').click();
  const w = await frame.locator('#widgets-body').textContent();
  check(await frame.locator('.widget-card').count() === 5 && w.includes('Code dans le document') && w.includes('widgets.exemple.fr') && w.indexOf('Widgets non officiels') < w.indexOf('Widgets personnalisés'), 'onglet Widgets : non officiels en premier, avec origine et adresse');
  check(await frame.locator('.widget-cols li').count() >= 3 && !(await frame.locator('#widgets-body').textContent()).includes('gristlabs.github.io'), 'onglet Widgets : galerie réduite à l\'accès et aux colonnes en liste');
  check(w.includes('Fiche client') && w.includes('Graphique (barres)') && !/\bTableau · table\b/.test(w) && w.includes('que des tableaux') && w.includes('Brouillon'), 'onglet Widgets : tableaux exclus, autres vues par page');
  check(await frame.locator('.widget-cols--missing').count() === 3, 'onglet Widgets : colonnes à associer signalées');
  await frame.locator('label[for="wkind-gallery"]').click();
  check(await frame.locator('.widget-card').count() === 2 && !(await frame.locator('#widgets-body').textContent()).includes('Widgets non officiels'), 'widgets : filtre « Galerie »');
  await frame.locator('label[for="wkind-all"]').click();
  await frame.locator('#widgets-filter').fill('carte');
  await page.waitForTimeout(250);
  check(await frame.locator('.widget-card').count() === 1, `widgets : recherche « carte » (${await frame.locator('.widget-card').count()})`);
  await frame.locator('#widgets-filter').fill('');
  await page.waitForTimeout(250);
  await shot(page, '17-widgets.png');
  await frame.locator('#tab-report').click();
  await frame.waitForSelector('.doc__toc', { timeout: 30000 });
  const doc = await frame.locator('.doc').textContent();
  check(doc.includes('Widgets personnalisés') && doc.includes('Widgets non officiels') && doc.includes('Tableau croisé dynamique') && doc.includes('Table des matières'), 'rapport : section Widgets');
  await frame.locator('#tab-analysis').click();
  await page.waitForTimeout(600);
  await shot(page, '16-mal-structure-analyse.png');
  await frame.locator('#level-choice').click();
  const before = Number(await frame.locator('#level-choice .tile__n').textContent());
  check(await frame.locator('.insight--choice .insight__intended').count() === before, 'choix : « Si c\'est voulu » sur chaque carte');
  await frame.locator('.insight--choice [data-action="accept"]').first().click();
  await page.waitForTimeout(200);
  const after = Number(await frame.locator('#level-choice .tile__n').textContent());
  check(after === before - 1, `« C'est voulu » : ${before} → ${after} choix à confirmer`);
  check(Array.isArray((await frame.evaluate(() => window.__options.accepted))) && (await frame.evaluate(() => window.__options.accepted.length)) === 1, '« C\'est voulu » mémorisé dans les options du widget');
  await frame.locator('#level-accepted').click();
  check(await frame.locator('.insight--accepted').count() === 1 && (await frame.locator('#level-accepted .tile__n').textContent()) === '1', 'section « Choix confirmés »');
  const order = await frame.locator('#tabpanel-analysis .tile .tile__label').allTextContents();
  check(order.join('|') === 'À corriger|À améliorer|Choix à confirmer|Choix confirmés|Bon à savoir|Tout', `tuiles : ${order.join(' | ')}`);
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


