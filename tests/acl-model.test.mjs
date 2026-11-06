import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionForRole, permissionBits, parsePermissions, readAcl } from '../assets/acl-model.js';
import { buildAccess, accessInsights, generalSettings } from '../assets/access.js';
import { buildMatrix } from '../assets/rights-matrix.js';

const resources = [{ id: 1, tableId: '*', colIds: '*' }, { id: 2, tableId: '*SPECIAL', colIds: 'SchemaEdit' }, { id: 3, tableId: 'T', colIds: '*' }];
const readDeny = { id: 9, resource: 3, aclFormula: 'user.Access == VIEWER', permissionsText: '-R', rulePos: 9 };
/** Les trois lectures des droits de structure des éditeurs : réglage général, constat, matrice. */
function structureViews(rules) {
  const acl = { resources, rules: [...rules, readDeny] };
  const a = buildAccess(acl);
  const setting = generalSettings(a).find((x) => x.id === 'schema').state;
  const bypass = accessInsights(a).some((i) => i.id === 'acl-bypass');
  const mx = buildMatrix(acl, ['T']);
  return { setting, bypass, matrix: mx.cell('*structure', 0, 'S').state };
}

test('droits de structure des éditeurs : la même réponse partout', () => {
  assert.deepEqual(structureViews([]), { setting: 'Oui', bypass: true, matrix: 'allow' }, 'aucune règle : les éditeurs modifient la structure');
  assert.deepEqual(structureViews([{ id: 1, resource: 1, aclFormula: 'user.Access != OWNER', permissionsText: '-S', rulePos: 1 }]),
    { setting: 'Non', bypass: false, matrix: 'deny' }, 'case décochée dans Grist');
  // Un refus qui vise les lecteurs ne retire rien aux éditeurs (le réglage disait « Non »).
  assert.deepEqual(structureViews([{ id: 1, resource: 1, aclFormula: 'user.Access == VIEWER', permissionsText: '-S', rulePos: 1 }]),
    { setting: 'Oui', bypass: true, matrix: 'allow' });
  // L'ancien réglage spécial « SchemaEdit » compte aussi pour le réglage et le constat (seule la matrice le lisait).
  assert.deepEqual(structureViews([{ id: 1, resource: 2, aclFormula: 'user.Access != OWNER', permissionsText: '-S', rulePos: 1 }]),
    { setting: 'Non', bypass: false, matrix: 'deny' });
});

test('conditions par rôle de partage : langage fermé', () => {
  assert.equal(conditionForRole('user.Access in [OWNER, EDITOR]', 'EDITOR'), true);
  assert.equal(conditionForRole('not user.Access == VIEWER', 'VIEWER'), false);
  assert.equal(conditionForRole('user.Access', 'EDITOR'), null, 'une valeur seule n’est pas une condition');
  assert.equal(conditionForRole('user.Access == EDITOR and user.Email == "a"', 'VIEWER'), null, 'dépend de la personne');
  assert.equal(conditionForRole('user.Access == "EDITOR"', 'EDITOR'), null, 'texte : hors du langage du rôle');
  assert.equal(conditionForRole('', 'VIEWER'), true);
});

test('permissions et lecture des lignes', () => {
  assert.deepEqual(permissionBits('all'), { C: true, R: true, U: true, D: true, S: true });
  assert.deepEqual(permissionBits('+RUZ'), { R: true, U: true }, 'lettres inconnues ignorées');
  assert.deepEqual(parsePermissions('+R-CD'), { R: 'allow', C: 'deny', D: 'deny' });
  const acl = readAcl({ resources, rules: [
    { id: 2, resource: 1, aclFormula: '', permissionsText: '', userAttributes: '{"name":"B","tableId":"T","lookupColId":"Email","charId":"Email"}', rulePos: 2 },
    { id: 1, resource: 1, aclFormula: '', permissionsText: '', userAttributes: '{"name":"A","tableId":"T","lookupColId":"Email","charId":"Email"}', rulePos: 1 },
    { id: 3, resource: 3, aclFormula: 'True', permissionsText: '-R', rulePos: 3 },
    { id: 4, resource: 1, aclFormula: '', permissionsText: '', userAttributes: 'pas du JSON', rulePos: 4 },
  ] });
  assert.deepEqual(acl.attributes.map((a) => a.def.name), ['A', 'B'], 'attributs dans l’ordre d’application, JSON illisible ignoré');
  assert.deepEqual(acl.rules.map((r) => r.id), [3]);
});
