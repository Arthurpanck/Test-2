import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schemaFromMetadata } from '../assets/converter.js';
import { convertAll } from '../assets/converter-code.js';
import { profileTables, structureSmells } from '../assets/datacheck.js';
import { buildAccess, accessInsights } from '../assets/access.js';
import { buildInsights } from '../assets/insights.js';
import { runAudit } from '../assets/audit-engine.js';
import { pageInsights } from '../assets/pages.js';
import { REMOVED_FINDING_IDS } from './audit-decisions.mjs';
import { RETAINED_IDS } from './audit-decisions.mjs';
import { buildReport, renderHtml } from '../assets/report.js';

function doc(columns, rows) {
  const cs = columns.map(([colId, type, choices], i) => ({
    id: i + 1,
    parentId: 1,
    parentPos: i + 1,
    colId,
    label: colId,
    type,
    isFormula: false,
    formula: '',
    widgetOptions: JSON.stringify({ choices: choices || [] }),
  }));
  const schema = schemaFromMetadata([{ id: 1, tableId: 'T' }], cs),
    tables = convertAll({ schema }).corrected.tables;
  const data = { T: { id: rows.map((_, i) => i + 1) } };
  for (const [col] of columns) data.T[col] = rows.map((r) => r[col] ?? null);
  return { schema, tables, data, profiles: profileTables(data) };
}
const findings = (x) => structureSmells(x.tables, x.profiles);

test('nombres, booléens et dates en texte produisent trois cartes aux cibles distinctes', () => {
  const x = doc(
    [
      ['Montant', 'Text'],
      ['Valide', 'Text'],
      ['Jour', 'Text'],
    ],
    [
      { Montant: '10', Valide: 'oui', Jour: '01/11/2026' },
      { Montant: '20', Valide: 'non', Jour: '02/11/2026' },
      { Montant: '12,5', Valide: 'oui', Jour: '03/11/2026' },
    ],
  );
  const out = findings(x);
  for (const [id, col, type] of [
    ['typed-as-text', 'Montant', 'numérique'],
    ['boolean-as-text', 'Valide', 'booléen'],
    ['date-as-text', 'Jour', 'date'],
  ]) {
    const item = out.find((i) => i.id === id);
    assert.ok(item, id);
    assert.deepEqual(
      item.targets.map((t) => t.column),
      [col],
    );
    assert.match(item.title, new RegExp(type));
    assert.equal(item.severity, 'improve');
  }
  const html = renderHtml(
    buildReport(
      {
        tables: x.tables,
        insights: buildInsights(x.tables, null, { profiles: x.profiles }),
        stats: { tables: 1, relations: 0 },
        docName: 'Essai',
        date: new Date(),
      },
      ['analysis'],
    ),
  );
  for (const name of ['numérique', 'booléen', 'date']) assert.ok(html.includes(name));
  assert.doesNotMatch(html, /nombres, dates ou oui\/non saisies en texte/);
});

test('les types proposés ne transforment ni codes numériques, ni textes mixtes, ni deux valeurs en preuve', () => {
  const short = doc([['Montant', 'Text']], [{ Montant: '10' }, { Montant: '20' }]);
  assert.ok(!findings(short).some((i) => i.id === 'typed-as-text'));
  const x = doc(
    [
      ['Code_postal', 'Text'],
      ['Libelle', 'Text'],
      ['Valide', 'Text'],
    ],
    [
      { Code_postal: '01234', Libelle: '10', Valide: 'oui' },
      { Code_postal: '02345', Libelle: 'texte', Valide: 'non' },
      { Code_postal: '03456', Libelle: 'autre', Valide: 'inconnu' },
    ],
  );
  assert.ok(!findings(x).some((i) => ['typed-as-text', 'boolean-as-text', 'date-as-text'].includes(i.id)));
});

test('seuil numérique et liste de choix : un indice reste une recommandation avec aperçu à vérifier', () => {
  const x = doc(
    [
      ['Montant', 'Text'],
      ['Statut', 'Text'],
    ],
    Array.from({ length: 10 }, (_, i) => ({ Montant: i < 8 ? String(i) : 'à préciser', Statut: i % 2 ? 'Ouvert' : 'Fermé' })),
  );
  const out = findings(x),
    numeric = out.find((i) => i.id === 'typed-as-text'),
    choice = out.find((i) => i.id === 'text-choice');
  assert.ok(numeric);
  assert.match(numeric.steps.join(' '), /rouge/);
  assert.match(choice.title, /type choix/);
  assert.ok(
    !findings(
      doc(
        [['Montant', 'Text']],
        Array.from({ length: 10 }, (_, i) => ({ Montant: i < 7 ? String(i) : 'à préciser' })),
      ),
    ).some((i) => i.id === 'typed-as-text'),
  );
});

test('choix unique et multiple : une faute dans un élément déclenche le bon contrôle, sans doublon', () => {
  const x = doc(
    [
      ['Statut', 'Choice', ['Ouvert', 'Fermé']],
      ['Competences', 'ChoiceList', ['Accueil', 'Cuisine']],
    ],
    [
      { Statut: 'Ouvret', Competences: ['L', 'Accueil', 'Acceuil'] },
      { Statut: 'Ouvert', Competences: ['L', 'Accueil', 'Cuisine'] },
    ],
  );
  const result = buildInsights(x.tables, null, { profiles: x.profiles, audit: { schema: x.schema, data: x.data } });
  assert.deepEqual(
    result.items.find((i) => i.id === 'choice-outside').targets.map((t) => t.column),
    ['Statut', 'Competences'],
  );
  assert.ok(!result.items.some((i) => i.id === 'N64'));
  assert.equal(result.items.find((i) => i.id === 'choice-outside').severity, 'blocking');
  const good = doc(
    [
      ['Statut', 'Choice', ['Ouvert']],
      ['Competences', 'ChoiceList', ['Accueil', 'Cuisine']],
    ],
    [
      { Statut: 'Ouvert', Competences: ['L', 'Cuisine', 'Accueil'] },
      { Statut: '', Competences: ['L'] },
      { Statut: 'Ouvert', Competences: ['C'] },
    ],
  );
  const items = buildInsights(good.tables, null, { profiles: good.profiles, audit: { schema: good.schema, data: good.data } }).items;
  assert.ok(
    !items.some((i) => ['choice-outside', 'N64'].includes(i.id)),
    'ordre différent, liste vide et censure ne sont pas des valeurs hors choix',
  );
  const open = doc([['Competences', 'ChoiceList', []]], [{ Competences: ['L', 'Libre'] }]);
  assert.ok(!runAudit(open).items.some((i) => i.id === 'N64'));
});

test('une page au nom de sa table est signalée ; une page nommée pour une action ne l’est pas', () => {
  const pages = [
    { name: 'Demandes', widgets: [{ table: 'Demandes' }] },
    { name: ' demandES ', widgets: [{ table: 'Demandes' }] },
    { name: 'Traiter les demandes', widgets: [{ table: 'Demandes' }] },
    { name: 'Suivre les paiements', widgets: [{ table: 'Factures' }] },
    { name: 'New page', widgets: [] },
    { name: 'Accueil', widgets: [{ table: '' }] },
  ];
  const model = { pages, custom: [], tablesWithoutPage: [] };
  const item = pageInsights(model).find((i) => i.id === 'page-default-name');
  assert.deepEqual(
    item.targets.map((t) => t.table),
    ['Demandes', 'demandES', 'New page'],
  );
  assert.match(item.targets[0].note, /Même nom/);
  assert.match(item.steps.join(' '), /sans copier/);
});

test('les suppressions sortent des analyses, des validations positives et des calculs dédiés', () => {
  const removed = ['acl-hidden', 'duplicate-table', 'text-ref', 'summary', 'N17', 'N28', 'N57'];
  const x = doc(
    [
      ['Date_import', 'Numeric'],
      ['Parent', 'Ref:T'],
    ],
    Array.from({ length: 6 }, (_, i) => ({ Date_import: 45000 + i, Parent: i + 1 })),
  );
  const ins = buildInsights(x.tables, null, { profiles: x.profiles, audit: { schema: x.schema, data: x.data } });
  for (const id of removed) {
    assert.ok(REMOVED_FINDING_IDS.has(id), id);
    assert.ok(!ins.items.some((i) => i.id === id));
  }
  const engine = readFileSync(new URL('../assets/audit-engine.js', import.meta.url), 'utf8');
  for (const id of ['N17', 'N28', 'N57']) {
    assert.ok(!engine.includes("'" + id + "'"));
    assert.ok(!RETAINED_IDS.includes(id));
  }
  const data = readFileSync(new URL('../assets/datacheck.js', import.meta.url), 'utf8');
  assert.doesNotMatch(data, /countByKey|keyIndex|sameBase|baseName|const dups/);
});

test('les diagnostics d’attribut restent dans le modèle sans cartes dédiées', () => {
  const schema = new Map([['T', { tableId: 'T', columns: new Map() }]]);
  const access = buildAccess({
    schema,
    resources: [{ id: 1, tableId: '*', colIds: '*' }],
    rules: [
      {
        id: 1,
        resource: 1,
        userAttributes: JSON.stringify({ name: 'Habilitation', tableId: 'Absente', lookupColId: 'Email', charId: 'Email' }),
      },
      { id: 2, resource: 1, aclFormula: "user.Profil.Role == 'RH'", permissionsText: '-R' },
    ],
  });
  const items = accessInsights(access);
  assert.ok(!items.some((i) => i.id === 'acl-attribute'));
  assert.ok(!items.some((i) => i.id === 'acl-unknown-attribute'));
  assert.ok(!items.some((i) => i.id === 'acl-hidden'));
  const known = access.attributes[0];
  assert.equal(known.name, 'Habilitation');
  assert.ok(known.problems.length);
});

test('les étapes des droits d’accès indiquent la bulle de mémo, l’activation et la permission Structure', () => {
  const no = accessInsights(buildAccess({ resources: [], rules: [] }))[0];
  assert.match(no.steps.join(' '), /Activer les règles d’accès/);
  const access = {
    hasRules: true,
    attributes: [],
    uncovered: [],
    special: [],
    restrictsRead: true,
    defaults: [{ id: 1, formula: '', perms: { R: 'deny' }, who: { text: 'Tous' }, problems: [], memo: '' }],
    tables: [],
  };
  const items = accessInsights(access),
    memo = items.find((i) => i.id === 'acl-no-memo'),
    bypass = items.find((i) => i.id === 'acl-bypass');
  assert.match(memo.steps.join(' '), /icône de discussion/);
  assert.match(memo.steps.join(' '), /enregistrez/);
  assert.equal(bypass.title, 'Accès des éditeurs aux droits de structure et donc aux données malgré les droits d’accès');
  assert.match(bypass.steps.join(' '), /décochez/);
  assert.doesNotMatch(bypass.steps.join(' '), /droits d’accès par défaut/);
});
