// Tests des droits d'accès (module access.js) : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaFromMetadata } from '../assets/converter.js';
import { convertAll } from '../assets/converter-code.js';
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
  for (const id of ['acl-bypass', 'acl-no-memo', 'acl-uncovered']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('acl-attribute') && !ids.includes('acl-hidden'));
  const unknown = accessInsights(access).find((i) => i.id === 'acl-unknown-attribute');
  assert.equal(unknown,undefined);
  assert.ok(access.tables.flatMap(t=>[...t.rules,...t.columns.flatMap(c=>c.rules)]).some(r=>r.problems.some(p=>p.kind==='unknown-attribute')),'le modèle des droits conserve le diagnostic technique');
});

test('table, colonne ou table d\'attribut absentes des métadonnées (supprimées ou masquées pour soi)', () => {
  const { m, schema } = complexe();
  schema.delete('Conges');
  schema.get('Agents').columns.delete('Quotite');
  schema.get('Habilitations').columns.delete('Email');
  const access = buildAccess({ resources: m.aclResources, rules: m.aclRules, schema });
  const items = accessInsights(access);
  const hidden = items.find((i) => i.id === 'acl-hidden');
  assert.equal(hidden,undefined,'le constat de visibilité est retiré ; les limites restent dans le modèle');
  assert.ok(access.tables.some(t=>t.missing));
  const attr = items.find((i) => i.id === 'acl-attribute');
  assert.equal(attr,undefined);
  assert.ok(access.attributes.some(a=>a.name==='Habilitation'&&a.problems.length),'les attributs restent disponibles pour la matrice des droits');
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
  assert.ok(ins.items.some((i) => i.id === 'empty' && i.targets.length >= 3));
  assert.ok(ins.items.some((i) => i.id === 'empty' && i.targets.some((t) => t.column === 'Statut_calcule')));
  assert.ok(!ins.items.some(i=>i.id==='untyped'));
});

test('vu par un propriétaire sans le rôle RH : colonnes masquées signalées, sans faux « bloquant »', () => {
  // Grist retire des métadonnées les colonnes que la personne connectée ne peut pas lire.
  const { m, schema } = complexe();
  schema.get('Agents').columns.delete('Quotite');
  schema.get('Agents').columns.delete('Derniere_connexion');
  const access = buildAccess({ resources: m.aclResources, rules: m.aclRules, schema });
  const items = accessInsights(access);
  assert.ok(!items.some(i=>i.id==='acl-unknown-attribute'));
  assert.equal(items.find((i) => i.id === 'acl-hidden'),undefined);
});

test('réglages généraux : permissions avancées puis les trois cases de Grist (open source)', async () => {
  const { generalSettings } = await import('../assets/access.js');
  const { access } = complexe();
  const g = generalSettings(access);
  assert.deepEqual(g.map((x) => `${x.id}:${x.state}`), ['acl:Activées', 'seed:Non', 'schema:Oui', 'access-rules:Oui']);
  assert.match(g[2].text, /aucune règle ne retire la permission Structure/);
  assert.ok(!g.some((x) => /copier/i.test(x.name)), 'pas de « Copier le document entier » (réservé à la version hébergée)');
  const none = generalSettings({ ...access, hasRules: false, ruleCount: 0, attributes: [], special: [], defaults: [], structureRestricted: false, restrictsRead: false });
  assert.deepEqual(none.map((x) => x.state), ['Non activées', 'Non', 'Oui', 'Non']);
  const locked = generalSettings({ ...access, structureRestricted: true, defaults: [{ perms: { S: 'deny' }, who: { text: 'Tous sauf les propriétaires' } }] });
  assert.equal(locked[2].state, 'Non');
});

