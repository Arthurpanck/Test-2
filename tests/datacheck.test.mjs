// Détection des défauts d'un document mal structuré : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaFromMetadata, convertAll } from '../assets/converter.js';
import { buildAccess } from '../assets/access.js';
import { buildInsights, insightKey } from '../assets/insights.js';
import { profileTables, profileValues } from '../assets/datacheck.js';
import { definition, metadataFromDefinition } from './fixtures/mal-structure.mjs';

function load() {
  const m = metadataFromDefinition(definition);
  const schema = schemaFromMetadata(m.tables, m.cols);
  const out = convertAll({ schema }).corrected;
  const access = buildAccess({ resources: m.aclResources, rules: m.aclRules, schema });
  const profiles = profileTables(m.records);
  return { m, schema, out, access, profiles, ins: buildInsights(out.tables, access, { profiles }) };
}
const item = (ins, id) => ins.items.find((i) => i.id === id);
const has = (it, table, column) => it && it.targets.some((t) => t.table === table && (column === undefined || t.column === column));

test('profil des valeurs : nombres, dates, oui/non, listes', () => {
  const p = profileValues(['12', '3,5', '1 200', 'deux', '', null]);
  assert.equal(p.filled, 4);
  assert.equal(p.numeric, 3);
  assert.equal(profileValues(['12/01/2023', '2024-03-01']).date, 2);
  assert.equal(profileValues(['oui', 'Non', 'oui']).bool, 3);
  const l = profileValues(['Martin, Laurent', 'Robert']);
  assert.equal(l.list, 1);
  assert.deepEqual([...l.items].sort(), ['Laurent', 'Martin']);
});

test('mal structuré : liens écrits à la main repérés par les données et par les noms', () => {
  const { ins } = load();
  const it = item(ins, 'text-ref');
  for (const [t, c, target] of [['Commandes', 'Client', 'Clients'], ['Commandes', 'Produit', 'Produits'], ['Clients', 'Commercial', 'Personnel'],
    ['Produits', 'Fournisseur', 'Fournisseurs'], ['Personnel', 'Manager', 'Personnel'], ['Taches', 'Assigne', 'Personnel'],
    ['Factures', 'Commande', 'Commandes'], ['Cotisations', 'Adherent', 'Adherents'], ['Personnel', 'Service', 'Services']]) {
    assert.ok(it.targets.some((x) => x.table === t && x.column === c && x.note.startsWith(`vers ${target}`)), `${t}.${c} → ${target}`);
  }
  assert.ok(it.targets.some((x) => x.table === 'Evenements' && x.column === 'Participants' && /plusieurs/.test(x.note)), 'liste de noms → référence multiple');
  assert.ok(!has(it, 'Inscriptions'), 'les vraies références ne sont pas signalées');
  assert.equal(it.severity, 'improve');
});

test('mal structuré : nombres, dates, oui/non en texte, choix répétés, valeurs hors liste', () => {
  const { ins } = load();
  const typed = item(ins, 'typed-as-text');
  for (const [t, c] of [['Commandes', 'Quantite'], ['Commandes', 'Prix_unitaire'], ['Commandes', 'Date_commande'], ['Clients', 'Date_inscription'],
    ['Clients', 'Actif'], ['Factures', 'Payee'], ['Evenements', 'Budget'], ['Taches', 'Fait'], ['Adherents', 'Montant_cotisation']]) {
    assert.ok(has(typed, t, c), `${t}.${c}`);
  }
  const choice = item(ins, 'text-choice');
  assert.ok(has(choice, 'Commandes', 'Statut') && has(choice, 'Clients', 'Categorie'));
  assert.match(choice.targets.find((x) => x.column === 'Statut').note, /variantes de casse/);
  assert.ok(has(item(ins, 'choice-outside'), 'Factures', 'Mode_paiement'));
});

test('mal structuré : noms par défaut, doublons, copie non protégée, tables vides, colonnes jamais remplies, table large', () => {
  const { ins } = load();
  const def = item(ins, 'default-name');
  assert.ok(has(def, 'Table2', 'A') && has(def, 'Feuille1', 'Colonne1'));
  assert.ok(def.targets.every(t=>t.column), 'seuls les noms de colonnes sont contrôlés');
  assert.ok(!has(def, 'Table1', 'A'), 'colonnes vides : signalées une seule fois (colonnes jamais utilisées)');
  const leak = item(ins, 'acl-copy-leak');
  assert.equal(leak,undefined,'le constat de copie et d’accès est retiré');
  const dup = item(ins, 'duplicate-table');
  assert.ok(has(dup, 'Commandes_copie') && has(dup, 'Produits_old'));
  assert.ok(has(item(ins, 'empty-table'), 'Export_2023') && has(item(ins, 'empty-table'), 'Test'));
  assert.ok(has(item(ins, 'never-filled'), 'Commandes', 'Remise'));
  assert.ok(has(item(ins, 'wide-table'), 'Personnel'));
  for(const id of ['empty-table','never-filled','acl-attr-unused'])assert.equal(item(ins,id).severity,'blocking');
  for (const id of ['duplicate-table', 'wide-table', 'untyped', 'isolated']) assert.equal(item(ins, id).severity, 'choice', id);
});

test('mal structuré : droits d\'accès en désordre', () => {
  const { ins } = load();
  assert.ok(has(item(ins, 'acl-unknown-attribute'), 'Clients'));
  assert.ok(item(ins, 'acl-bypass'));
  assert.equal(item(ins, 'acl-full-copies'),undefined);
  assert.equal(item(ins,'acl-attr-mismatch'),undefined);
  assert.ok(item(ins, 'acl-attr-unused').targets.some((t) => t.note === 'user.Role'));
  assert.equal(ins.verdict.level, 'blocking');
});

test('« C\'est voulu » : un choix confirmé sort des comptes et reste listé à part', () => {
  const { out, access, profiles, ins } = load();
  const wide = item(ins, 'wide-table');
  const again = buildInsights(out.tables, access, { profiles, accepted: new Set([insightKey(wide)]) });
  assert.ok(!item(again, 'wide-table'));
  assert.equal(again.accepted.length, 1);
  assert.equal(again.counts.choice, ins.counts.choice - 1);
});

test('aucun texte d\'analyse ne parle du DBML', () => {
  const { ins } = load();
  for (const it of [...ins.items, { title: ins.verdict.title, summary: ins.verdict.text, why: '', steps: [] }]) {
    assert.ok(!/DBML/i.test([it.title, it.summary, it.why, it.intended || '', ...it.steps].join(' ')), it.title);
  }
  for (const c of ins.checks) assert.ok(!/DBML/i.test(c.label), c.label);
});

test('vu par le propriétaire : tables entièrement masquées (nom effacé par Grist)', () => {
  // Grist efface tableId et colId des tables que la personne connectée ne peut pas lire.
  const m = metadataFromDefinition(definition);
  const hiddenIds = new Set(m.tables.filter((t) => ['Personnel', 'Factures'].includes(t.tableId)).map((t) => t.id));
  const tables = m.tables.map((t) => (hiddenIds.has(t.id) ? { ...t, tableId: '' } : t));
  const cols = m.cols.map((c) => (hiddenIds.has(c.parentId) ? { ...c, colId: '' } : c));
  const records = { ...m.records };
  delete records.Personnel; delete records.Factures;
  const schema = schemaFromMetadata(tables, cols);
  assert.ok(!schema.has(''), 'aucune table sans nom');
  const out = convertAll({ schema }).corrected;
  const access = buildAccess({ resources: m.aclResources, rules: m.aclRules, schema });
  const ins = buildInsights(out.tables, access, { profiles: profileTables(records) });
  assert.ok(!item(ins, 'bad-name'), 'pas de faux « identifiant invalide »');
  assert.ok(has(item(ins, 'acl-hidden'), 'Personnel') && has(item(ins, 'acl-hidden'), 'Factures'), 'tables invisibles signalées');
  assert.equal(item(ins,'acl-copy-leak'),undefined,'aucune alerte de copie même si la table source est masquée');
});
