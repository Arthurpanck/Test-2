// Matrice « Qui peut faire quoi ? » : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareMatrixModel, matrixGroups, matrixRows, rowCells, cellText, cellTone, cellSentence, cellSteps, parseCondition, evaluateCondition, permissionBits, detectRole } from '../assets/rights-matrix.js';
import * as doc from './fixtures/droits-complexe.mjs';

const model = prepareMatrixModel({ resources: doc.resources, rules: doc.rules });
const { role, groups } = matrixGroups(model, doc.habilitations);
const rows = matrixRows(model, doc.tables);
/** Textes d'une ligne pour chaque groupe : { RH: 'Oui/Non/…', … }. */
const line = (key) => {
  const row = rows.find((r) => r.key === key);
  return Object.fromEntries(groups.map((g) => [g.name, rowCells(model, row, g, role).map(cellText).join(' / ')]));
};
const all = (x) => ({ RH: x, Finances: x, 'Tous les autres': x });

test('paramètres déduits : rôle Habilitation.Role, groupes RH, Finances, Tous les autres', () => {
  assert.deepEqual([role.attr, role.col, role.table], ['Habilitation', 'Role', 'Habilitations']);
  assert.deepEqual(groups.map((g) => g.name), ['RH', 'Finances', 'Tous les autres']);
  assert.equal(groups[0].sub, 'Habilitation.Role = « RH » · 7 services');
  assert.equal(groups[1].sub, 'Habilitation.Role = « Finances »', 'un seul service : pas de compte');
  assert.equal(groups[2].sub, 'Autre rôle ou sans habilitation');
});

test('tableau attendu sur le document de test (rôle Éditeur)', () => {
  const O = 'Oui / Oui / Oui / Oui', N = 'Non / Non / Non / Non';
  assert.deepEqual(line('*structure'), all('Oui'));
  assert.deepEqual(line('Parametres'), all(N));
  assert.deepEqual(line('Journal'), all('Oui / Non / Non / Non'));
  assert.deepEqual(line('Agents'), { RH: O, Finances: 'Email / Non / Non / Non', 'Tous les autres': 'Email / Non / Non / Non' });
  assert.deepEqual(line('Agents.Quotite'), { RH: 'Oui / Oui / — / —', Finances: 'Non / Non / — / —', 'Tous les autres': 'Non / Non / — / —' });
  assert.deepEqual(line('Agents.Derniere_connexion'), line('Agents.Quotite'));
  assert.deepEqual(line('Depenses'), { RH: 'Service / Non / Non / Non', Finances: O, 'Tous les autres': 'Service / Non / Non / Non' });
  assert.deepEqual(line('Conges'), all('Oui / Non / Oui / Non'));
  assert.deepEqual(line('Formations'), all('Oui / ? / Oui / Oui'));
  assert.deepEqual(line('Reunions'), all('Oui / Oui / Oui / Non'));
  assert.deepEqual(line('Projets'), all(O));
  assert.deepEqual(line('Projets.Budget'), all('Oui / Oui / — / —'));
  assert.deepEqual(line('Projets.Depense'), all('Oui / Oui / — / —'));
  for (const t of ['Table1', 'Directions', 'Sites', 'Fournisseurs', 'Habilitations', 'Taches', 'Indicateurs', 'Taches_summary']) assert.deepEqual(line(t), all(O), t);
});

test('lignes : structure, toutes les tables dans l\'ordre du document, colonnes à règles sous leur table', () => {
  assert.equal(rows[0].label, 'Droits de structure');
  assert.deepEqual(rows.filter((r) => r.kind === 'table').map((r) => r.table), doc.tables);
  assert.deepEqual(rows.filter((r) => r.kind === 'column').map((r) => r.key), ['Agents.Quotite', 'Agents.Derniere_connexion', 'Projets.Budget', 'Projets.Depense']);
  assert.equal(rows[rows.findIndex((r) => r.key === 'Agents') + 1].key, 'Agents.Quotite');
});

test('cas Fournisseurs : SERVICE / SERVICE / SERVICE + MANAGER / SERVICE + MANAGER pour RH', () => {
  const extra = {
    resources: [...doc.resources, { id: 14, tableId: 'Fournisseurs', colIds: '*' }],
    rules: [...doc.rules,
      { id: 24, resource: 14, aclFormula: 'user.Habilitation.Manager and rec.Service == user.Habilitation.Service', permissionsText: '+CRUD', rulePos: 30, memo: '', userAttributes: '' },
      { id: 25, resource: 14, aclFormula: 'rec.Service == user.Habilitation.Service', permissionsText: '+RU', rulePos: 31, memo: '', userAttributes: '' },
      { id: 26, resource: 14, aclFormula: '', permissionsText: '-CRUD', rulePos: 32, memo: '', userAttributes: '' }],
  };
  const m = prepareMatrixModel(extra);
  const { role: r, groups: gs } = matrixGroups(m);
  const row = matrixRows(m, ['Fournisseurs'])[1];
  const rh = rowCells(m, row, gs[0], r);
  assert.deepEqual(rh.map(cellText), ['Service', 'Service', 'Service + Manager', 'Service + Manager']);
  assert.deepEqual(rh.map(cellTone), ['ok', 'ok', 'ok', 'ok']);
  assert.equal(cellSentence(rh[2], { attrTable: 'Habilitations' }), 'Oui, mais 2 colonnes décident : la ligne doit appartenir à son Service, et la case Manager doit être cochée ou renseignée dans Habilitations.');
  const steps = cellSteps(rh[2], 'C');
  assert.deepEqual(steps.slice(-3).map((s) => s.badge), ['Selon la ligne (Service + Manager)', 'Ne porte pas sur Créer', 'Décide']);
  assert.deepEqual(steps.slice(-3).map((s) => s.title), ['Règle 24 · autorise tout', 'Règle 25 · autorise lire et modifier', 'Règle 26 · refuse tout']);
});

test('libellés, couleurs et explications', () => {
  const agents = rows.find((r) => r.key === 'Agents');
  const f = rowCells(model, agents, groups[1], role);
  assert.equal(cellTone(f[0]), 'ok');
  assert.equal(cellSentence(f[0]), 'Oui, seulement sur les lignes de son Email.');
  assert.equal(cellTone(f[1]), 'ko');
  const form = rowCells(model, rows.find((r) => r.key === 'Formations'), groups[0], role);
  assert.equal(cellTone(form[1]), 'uk');
  assert.match(cellSentence(form[1]), /user\.Profil\.Niveau > 2/);
  assert.equal(cellText({ state: 'rows-allow', labels: ['Service', 'Manager', 'Site'] }), 'Service + Manager + …');
  const journal = rowCells(model, rows.find((r) => r.key === 'Directions'), groups[0], role);
  assert.equal(cellSentence(journal[0]), 'Oui : aucune règle ne restreint cette action, le droit par défaut d\'un éditeur s\'applique.');
  assert.equal(cellSteps(journal[0], 'R').at(-1).title, 'Droit par défaut d\'un éditeur');
});

test('langage fermé : rien n\'est exécuté, l\'inconnu reste indéterminé', () => {
  const ctx = { attributes: new Set(['Habilitation']), roleAttr: 'Habilitation', roleCol: 'Role', roleValue: 'RH' };
  for (const code of ['__import__("os")', 'user.Email.lower() == "x"', 'rec.A + 1 > 2', 'lambda: 1']) {
    let out;
    try { out = evaluateCondition(parseCondition(code), ctx); } catch { out = 'erreur'; }
    assert.ok(out === 'erreur' || out?.unknown, code);
  }
  assert.equal(evaluateCondition(parseCondition("user.Habilitation.Role in ['RH', 'Finances'] and not user.Access == VIEWER"), ctx), true);
  assert.deepEqual(permissionBits('+R-CD'), { R: true, C: false, D: false });
  assert.equal(detectRole(prepareMatrixModel({ resources: [{ id: 1, tableId: '*', colIds: '*' }], rules: [] })), null);
  assert.deepEqual(matrixGroups(prepareMatrixModel({ resources: [], rules: [] })).groups.map((g) => g.name), ['Éditeurs']);
});

test('droits de structure : chaque règle du document une seule fois, ancien réglage SchemaEdit en premier', () => {
  const structure = rowCells(model, rows[0], groups[2], role)[0];
  const ids = structure.steps.filter((x) => x.rule).map((x) => x.rule.id);
  assert.equal(new Set(ids).size, ids.length, `règles en double : ${ids.join(', ')}`);
  const m = prepareMatrixModel({
    resources: [...doc.resources, { id: 20, tableId: '*SPECIAL', colIds: 'SchemaEdit' }],
    rules: [...doc.rules, { id: 40, resource: 20, aclFormula: 'user.Access == EDITOR', permissionsText: '-S', rulePos: 50, memo: '', userAttributes: '' }],
  });
  const g = matrixGroups(m, doc.habilitations);
  const cell = rowCells(m, matrixRows(m, [])[0], g.groups[0], g.role)[0];
  assert.equal(cellText(cell), 'Non');
  assert.equal(cell.steps[0].rule.id, 40);
});

test('même colonne de la personne côté ligne et côté profil : un seul libellé (« SRH », pas « SRH + SRH »)', () => {
  const m = prepareMatrixModel({
    resources: [{ id: 1, tableId: 'Carto', colIds: 'v_Structure' }],
    rules: [
      { id: 9, resource: 0, aclFormula: '', permissionsText: '', rulePos: 0, memo: '', userAttributes: JSON.stringify({ name: 'Droits', tableId: 'Droits_equipe', charId: 'Email', lookupColId: 'Email' }) },
      { id: 19, resource: 1, aclFormula: 'user.Access in [OWNER]', permissionsText: '+RU', rulePos: 1, memo: '', userAttributes: '' },
      { id: 20, resource: 1, aclFormula: 'user.Droits.Profil == "GPEC"', permissionsText: '+RU', rulePos: 2, memo: '', userAttributes: '' },
      { id: 21, resource: 1, aclFormula: 'user.Droits.Profil == "SRH" and user.Droits.SRH and rec.v_Structure == user.Droits.SRH', permissionsText: '+R-U', rulePos: 3, memo: '', userAttributes: '' },
      { id: 22, resource: 1, aclFormula: 'user.Droits.Profil in ["ACEP", "MSE"]', permissionsText: '+R-U', rulePos: 4, memo: '', userAttributes: '' },
      { id: 23, resource: 1, aclFormula: '', permissionsText: '-RU', rulePos: 5, memo: '', userAttributes: '' },
    ],
  });
  const { role, groups } = matrixGroups(m);
  assert.deepEqual([role.attr, role.col], ['Droits', 'Profil']);
  const srh = groups.findIndex((g) => g.name === 'SRH');
  const row = matrixRows(m, ['Carto']).find((r) => r.kind === 'column');
  const [read] = rowCells(m, row, groups[srh], role);
  assert.equal(cellText(read), 'SRH');
  assert.equal(cellSentence(read, { attrTable: 'Droits_equipe' }), 'Oui, seulement sur les lignes de son SRH.');
  assert.equal(cellSteps(read, 'R')[0].title, 'Règle 19 · autorise lire et modifier');
  assert.equal(cellSteps(read, 'R')[2].badge, 'Selon la ligne (SRH)');
});
