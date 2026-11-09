// Droits des propriétaires : réglage « Ajouter automatiquement une règle pour les propriétaires » et
// tables ou colonnes où un propriétaire peut perdre un droit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerAccess } from '../assets/acl-model.js';
import { buildAccess, accessInsights, generalSettings } from '../assets/access.js';

const res = (id, tableId, colIds) => ({ id, tableId, colIds });
const rule = (id, resource, rulePos, aclFormula, permissionsText) => ({ id, resource, rulePos, aclFormula, permissionsText, memo: 'm' });
const SEED = [res(9, '*SPECIAL', 'SeedRule')];
const seedRule = rule(90, 9, 90, 'user.Access in [OWNER]', '+CRUD');

test('propriétaires : refus certain, refus sauf habilitation, peut-être refusé', () => {
  const access = buildAccess({
    resources: [res(1, '*', '*'), res(2, 'T', '*'), res(3, 'T', 'Salaire'), res(4, 'T', 'Note'), res(5, 'U', '*')],
    rules: [
      rule(1, 2, 1, 'user.Access == OWNER', 'all'),
      rule(2, 2, 2, '', '+R-CUD'),
      rule(3, 3, 3, "user.H.Fonction == 'RH'", '+RU'),
      rule(4, 3, 4, '', '-RU'),
      rule(5, 4, 5, "user.H.Fonction == 'Agent'", '-R'),
      rule(6, 5, 6, '', '-CUD'),
    ],
  });
  const { gaps, ownerRule } = ownerAccess(access);
  const show = (t, c) => gaps.find((g) => g.table === t && String(g.cols) === String(c))?.bits.map((b) => `${b.bit}:${b.state}`);
  assert.equal(show('T', null), undefined, 'la table commence par « propriétaires : tout »');
  assert.deepEqual(show('T', ['Salaire']), ['R:unless', 'U:unless'], 'les règles de colonne passent avant celle des propriétaires');
  assert.deepEqual(show('T', ['Note']), ['R:maybe']);
  assert.deepEqual(show('U', null), ['U:deny', 'C:deny', 'D:deny']);
  assert.deepEqual(ownerRule, { defaults: false, tables: ['T'] });
});

test('constat « propriétaires » : réglage non coché, ou propriétaires privés d’un droit', () => {
  const base = {
    resources: [res(1, '*', '*'), res(2, 'T', '*')],
    rules: [rule(1, 2, 1, 'user.Access == OWNER', 'all'), rule(2, 2, 2, '', '-CUD')],
  };
  const off = accessInsights(buildAccess(base)).find((i) => i.id === 'acl-owner');
  assert.equal(off.severity, 'blocking');
  assert.match(off.summary, /^Bonne pratique/);
  assert.match(off.summary, /n’est pas cochée/);
  assert.match(off.why, /lit le document avec les droits de la personne/);
  assert.equal(off.targets.length, 0);
  // Réglage coché et propriétaires servis partout : pas de constat
  const on = buildAccess({ resources: [...base.resources, ...SEED], rules: [...base.rules, seedRule] });
  assert.equal(generalSettings(on)[0].id, 'seed');
  assert.equal(generalSettings(on)[0].state, 'Oui');
  assert.ok(!accessInsights(on).some((i) => i.id === 'acl-owner'));
  // Réglage coché, mais aucune règle « propriétaires » et une table qui leur refuse la lecture
  const bad = buildAccess({
    resources: [res(1, '*', '*'), res(2, 'T', '*'), ...SEED],
    rules: [rule(1, 2, 1, '', '-R'), seedRule],
  });
  const it = accessInsights(bad).find((i) => i.id === 'acl-owner');
  assert.match(it.summary, /Ni les droits d’accès par défaut ni aucune table/);
  assert.deepEqual(it.targets, [{ table: 'T', column: undefined, note: 'Lire : refusé' }]);
});
