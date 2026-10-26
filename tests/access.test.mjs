// Tests des droits d'accès (module access.js) : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaFromMetadata, convertAll } from '../assets/converter.js';
import { buildAccess, accessInsights, parsePermissions, describeCondition } from '../assets/access.js';
import { buildInsights } from '../assets/insights.js';
import { columnTypeLabel, detailLines } from '../assets/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
function complexe() {
  const m = JSON.parse(readFileSync(path.join(here, 'fixtures/document-complexe.metadata.json'), 'utf8'));
  const columns = m.columns.map((c) => ({ parentPos: c.id, label: c.colId, formula: '', reverseCol: 0, description: '', widgetOptions: '', recalcWhen: 0, recalcDeps: null, isFormula: 0, ...c }));
  const schema = schemaFromMetadata(m.tables, columns, { sections: m.sections });
  return { m, schema, access: buildAccess({ resources: m.aclResources, rules: m.aclRules, schema }) };
}

test('permissions Grist → permissions en clair', () => {
  assert.deepEqual(parsePermissions('+R-CD'), { R: 'allow', C: 'deny', D: 'deny' });
  assert.deepEqual(parsePermissions('all'), { R: 'allow', U: 'allow', C: 'allow', D: 'allow', S: 'allow' });
  assert.equal(parsePermissions('none').U, 'deny');
  assert.deepEqual(parsePermissions(''), {});
});

test('conditions traduites quand la forme est connue', () => {
  assert.equal(describeCondition('').text, 'Tout le monde');
  assert.equal(describeCondition('', { first: false }).text, 'Tous les autres');
  assert.equal(describeCondition('user.Access in [OWNER]').text, 'Propriétaires');
  assert.equal(describeCondition('user.Access in [EDITOR, OWNER]').text, 'Éditeurs et propriétaires');
  assert.equal(describeCondition('user.Access != OWNER').text, 'Tous sauf les propriétaires');
  assert.equal(describeCondition("user.Email == 'a@x.fr' or user.Email == 'b@x.fr'").text, 'a@x.fr ou b@x.fr');
  assert.match(describeCondition("user.Habilitation.Role == 'RH'").text, /Habilitation\.Role.*vaut.*RH/);
  const row = describeCondition('rec.Projet.Service_pilote == user.Habilitation.Service');
  assert.equal(row.row, true);
  assert.equal(describeCondition('newRec.Agent.Email == user.Email').kind, 'row');
});

test('document complexe : règles regroupées par table, colonnes, défaut et réglages', () => {
  const { access } = complexe();
  assert.equal(access.hasRules, true);
  assert.deepEqual(access.attributes.map((a) => a.name), ['Habilitation', 'Fiche']);
  assert.ok(access.attributes.every((a) => !a.problems.length));
  assert.deepEqual(access.tables.map((t) => t.tableId), ['Agents', 'Conges', 'Depenses', 'Formations', 'Journal', 'Parametres', 'Projets', 'Reunions']);
  const agents = access.tables.find((t) => t.tableId === 'Agents');
  assert.deepEqual(agents.rules.map((r) => r.who.text), ['Propriétaires', 'Personnes dont « Habilitation.Role » vaut « RH »', 'Sur les lignes où la personne est désignée par son adresse', 'Tous les autres']);
  assert.deepEqual(agents.columns[0].colIds, ['Quotite', 'Derniere_connexion']);
  assert.equal(access.defaults.length, 1);
  assert.deepEqual(access.special.map((s) => s.id).sort(), ['AccessRules', 'FullCopies']);
  assert.equal(access.restrictsRead, true);
  assert.equal(access.structureRestricted, false);
  assert.ok(access.uncovered.includes('Sites') && !access.uncovered.includes('Agents'));
  assert.ok(!access.uncovered.some((t) => t.includes('summary')), 'tables de synthèse exclues');
});

test('document complexe : constats sur les droits d\'accès', () => {
  const { access } = complexe();
  const ids = accessInsights(access).map((i) => i.id);
  for (const id of ['acl-unknown-attribute', 'acl-bypass', 'acl-full-copies', 'acl-emails', 'acl-no-memo', 'acl-uncovered']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('acl-attribute') && !ids.includes('acl-missing'));
  const unknown = accessInsights(access).find((i) => i.id === 'acl-unknown-attribute');
  assert.equal(unknown.severity, 'blocking');
  assert.match(unknown.targets[0].note, /user\.Profil/);
});

test('règles cassées après coup : table, colonne et attribut disparus', () => {
  const { m, schema } = complexe();
  schema.delete('Conges');
  schema.get('Agents').columns.delete('Quotite');
  schema.get('Habilitations').columns.delete('Email');
  const access = buildAccess({ resources: m.aclResources, rules: m.aclRules, schema });
  const items = accessInsights(access);
  const missing = items.find((i) => i.id === 'acl-missing');
  assert.ok(missing && missing.targets.some((t) => t.table === 'Conges') && missing.targets.some((t) => t.column === 'Quotite'));
  assert.ok(items.find((i) => i.id === 'acl-attribute').targets.some((t) => /Habilitation/.test(t.note)));
});

test('document sans règle : un seul constat informatif', () => {
  const access = buildAccess({ resources: [{ id: 1, tableId: '', colIds: '' }], rules: [{ id: 1, resource: 1, aclFormula: '', permissionsText: '', rulePos: null, memo: '', userAttributes: '' }] });
  assert.equal(access.hasRules, false);
  assert.deepEqual(accessInsights(access).map((i) => i.id), ['acl-none']);
});

test('document complexe : types en français, colonnes vides, formules d\'initialisation', () => {
  const { schema, access } = complexe();
  const out = convertAll({ schema }).corrected;
  const col = (t, c) => out.tables.find((x) => x.name === t).columns.find((x) => x.name === c);
  assert.equal(columnTypeLabel(col('Agents', 'Derniere_connexion')), 'Date et Heure');
  assert.equal(columnTypeLabel(col('Projets', 'Equipe')), 'Référence multiple');
  assert.equal(columnTypeLabel(col('Agents', 'Photo')), 'Pièce jointe');
  assert.equal(columnTypeLabel(col('Agents', 'Statut_calcule')), 'Non défini');
  assert.equal(col('Table1', 'A').empty, true);
  assert.equal(col('Table1', 'A').isFormula, false);
  const cree = detailLines(col('Agents', 'Cree_le'));
  assert.deepEqual(cree.map((l) => l.label), ['Libellé', 'Formule d\'initialisation', 'Appliquée']);
  assert.equal(cree[2].text, 'aux nouvelles lignes seulement');
  assert.equal(detailLines(col('Agents', 'Modifie_le'))[2].text, 'aux nouvelles lignes et à chaque modification de la ligne');
  assert.match(detailLines(col('Taches', 'Date_cloture')).find((l) => l.label === 'Appliquée').text, /Statut$/);
  assert.equal(detailLines(col('Taches', 'Assignee')).find((l) => l.label === 'Liste filtrée').text, 'choice.Service == $Projet.Service_pilote');
  assert.equal(out.tables.find((t) => t.name === 'Agents').description, 'Une ligne par agent, titulaire ou contractuel. Données RH sensibles.');
  const ins = buildInsights(out.tables, access);
  assert.equal(ins.verdict.level, 'blocking');
  assert.ok(ins.items.some((i) => i.id === 'empty' && i.targets.length === 3));
  assert.ok(ins.items.some((i) => i.id === 'untyped' && i.targets.some((t) => t.column === 'Statut_calcule')));
});
