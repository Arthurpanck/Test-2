// Sous-rôles et rôles confondus dans « Qui peut faire quoi ? », et leur lecture en clair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatrix, cellText } from '../assets/rights-matrix.js';
import { describeCondition } from '../assets/access.js';

const res = (id, tableId, colIds) => ({ id, tableId, colIds });
const rule = (id, resource, rulePos, aclFormula, permissionsText, userAttributes = '') => ({
  id,
  resource,
  rulePos,
  aclFormula,
  permissionsText,
  memo: '',
  userAttributes,
});
const ATTR = '{"name":"Habilitation","tableId":"Habilitations","lookupColId":"Email","charId":"Email"}';

// Manager RH et manager Finances : même fonction, pôles différents.
const acl = {
  resources: [res(1, '*', '*'), res(2, 'Agents', 'Salaire'), res(3, 'Projets', 'Budget')],
  rules: [
    rule(1, 1, 1, '', '', ATTR),
    rule(2, 2, 2, "user.Habilitation.Fonction == 'RH'", '+RU'),
    rule(3, 2, 3, "user.Habilitation.Fonction == 'Manager' and user.Habilitation.Pole == 'RH'", '+R-U'),
    rule(4, 2, 4, '', '-RU'),
    rule(5, 3, 5, "user.Habilitation.Fonction == 'Finances'", '+RU'),
    rule(6, 3, 6, "user.Habilitation.Fonction == 'Manager' and user.Habilitation.Pole == 'Finances'", '+RU'),
    rule(7, 3, 7, '', '+R-U'),
  ],
};
const habilitations = {
  id: [1, 2, 3, 4, 5],
  Fonction: ['RH', 'Finances', 'Manager', 'Manager', 'Manager'],
  Pole: ['RH', 'Finances', 'RH', 'Finances', 'Technique'],
  Service: [1, 2, 1, 2, 3],
};

test('un rôle précisé par une deuxième colonne se divise en sous-rôles, plus les autres valeurs lues', () => {
  const mx = buildMatrix(acl, ['Agents', 'Projets'], habilitations);
  // Ordre des rôles : celui de leur première apparition dans les règles.
  assert.deepEqual(
    mx.groups.map((g) => g.name),
    ['RH', 'Manager · Pole RH', 'Manager · Pole Finances', 'Manager · Pole Technique', 'Finances', 'Tous les autres'],
  );
  const line = (key) => mx.groups.map((g, gi) => `${cellText(mx.cell(key, gi, 'R'))}/${cellText(mx.cell(key, gi, 'U'))}`);
  // Salaire : le manager RH lit sans modifier ; les autres managers ne voient rien.
  assert.deepEqual(line('Agents.Salaire'), ['Oui/Oui', 'Oui/Non', 'Non/Non', 'Non/Non', 'Non/Non', 'Non/Non']);
  // Budget : le manager Finances modifie comme les Finances ; les autres lisent seulement.
  assert.deepEqual(line('Projets.Budget'), ['Oui/Non', 'Oui/Non', 'Oui/Oui', 'Oui/Non', 'Oui/Oui', 'Oui/Non']);
  assert.match(mx.groups[1].sub, /Fonction = « Manager » et Pole = « RH »/);
});

test('des valeurs que les règles ne distinguent jamais forment une seule colonne', () => {
  const mx = buildMatrix(
    {
      resources: [res(1, '*', '*'), res(2, 'Commandes', '*')],
      rules: [
        rule(1, 1, 1, '', '', '{"name":"Profil","tableId":"Personnel","lookupColId":"Email","charId":"Email"}'),
        rule(2, 2, 2, "user.Profil.Poste == 'Commercial' or user.Profil.Poste == 'Commerciale'", '+CRUD'),
        rule(3, 2, 3, "user.Profil.Poste == 'Comptable'", '+R-CUD'),
        rule(4, 2, 4, '', '-CRUD'),
      ],
    },
    ['Commandes'],
  );
  assert.deepEqual(
    mx.groups.map((g) => g.name),
    ['Commercial ou Commerciale', 'Comptable', 'Tous les autres'],
  );
  assert.match(mx.groups[0].sub, /« Commercial » ou « Commerciale » · mêmes droits/);
  assert.equal(cellText(mx.cell('Commandes', 0, 'D')), 'Oui');
  assert.equal(cellText(mx.cell('Commandes', 1, 'D')), 'Non');
});

test('conditions composées lues en clair', () => {
  assert.equal(
    describeCondition("user.Habilitation.Fonction == 'Manager' and user.Habilitation.Pole == 'RH'").text,
    'Personnes dont « Habilitation.Fonction » vaut « Manager » et « Habilitation.Pole » vaut « RH »',
  );
  assert.equal(
    describeCondition("user.Habilitation.Fonction == 'Manager' and rec.Service == user.Habilitation.Service").text,
    'Personnes dont « Habilitation.Fonction » vaut « Manager », sur les lignes où « Service » correspond à son « Habilitation.Service »',
  );
  assert.equal(
    describeCondition("user.A.B == 'x' and (rec.C == 1 or rec.D == 2)").text,
    'Selon le contenu de la ligne',
    'forme non reconnue',
  );
});

test('sous-rôles sans habilitations lues : une colonne « autre » ; fonction et grade', () => {
  const g = (f, x) => `user.Habilitation.Fonction == '${f}' and user.Habilitation.Grade == '${x}'`;
  const mx = buildMatrix(
    {
      resources: [res(1, '*', '*'), res(2, 'Agents', 'Salaire')],
      rules: [
        rule(1, 1, 1, '', '', ATTR),
        rule(2, 2, 2, g('RH', 'Manager'), '+RU'),
        rule(3, 2, 3, g('RH', 'Gestionnaire'), '+R-U'),
        rule(4, 2, 4, '', '-RU'),
      ],
    },
    ['Agents'],
  );
  assert.deepEqual(
    mx.groups.map((x) => x.name),
    ['RH · Grade Manager', 'RH · Grade Gestionnaire', 'RH · autre Grade', 'Tous les autres'],
  );
  assert.deepEqual(
    [0, 1, 2].map((gi) => `${cellText(mx.cell('Agents.Salaire', gi, 'R'))}/${cellText(mx.cell('Agents.Salaire', gi, 'U'))}`),
    ['Oui/Oui', 'Oui/Non', 'Non/Non'],
  );
});
