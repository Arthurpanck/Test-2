// Format des tables (« Table pour exportation ») et lookups du schéma : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqliteType, declaredType, columnRole, tableRows, rowValues, TABLE_COLUMNS } from '../assets/table-format.js';
import { findLookups } from '../assets/lookups.js';
import { gristTypeFromColType, schemaFromMetadata, convertAll } from '../assets/converter.js';
import { lookupGeometry } from '../assets/erd-geometry.js';
import { readFileSync } from 'node:fs';

/** Métadonnées compactes d'une fixture, valeurs par défaut rétablies. */
function loadMeta(name) {
  const m = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
  const columns = m.columns.map((c) => ({ parentPos: c.id, label: c.colId, formula: '', reverseCol: 0, description: '', widgetOptions: '', recalcWhen: 0, recalcDeps: null, isFormula: 0, ...c }));
  return { tables: m.tables, columns, sections: m.sections || [] };
}

const T = (type, reverse) => gristTypeFromColType(type, reverse);

test('type SQLite : comme DocStorage._getSqlType() de grist-core', () => {
  const cases = { Text: 'TEXT', Choice: 'TEXT', ChoiceList: 'TEXT', Bool: 'BOOLEAN', Int: 'INTEGER', Numeric: 'NUMERIC', Date: 'DATE', DateTime: 'DATETIME',
    'DateTime:Europe/Paris': 'BLOB', 'Ref:Projets': 'INTEGER', 'RefList:Thematiques': 'TEXT', Attachments: 'TEXT', Any: 'BLOB', ManualSortPos: 'NUMERIC' };
  for (const [type, sql] of Object.entries(cases)) assert.equal(sqliteType(T(type)), sql, type);
});

test('type déclaré en français, rôle, calcul et documentation, colonnes dans l\'ordre du modèle', () => {
  assert.deepEqual(TABLE_COLUMNS, ['Colonne (nom en base)', 'Nom affiché', 'Type SQLite', 'Type déclaré (Grist)', 'Rôle', 'Calculé ?', 'Formule', 'Documentée ?']);
  assert.equal(declaredType({ gristType: T('Ref:Projets_deliberations') }).text, 'Référence → Projets_deliberations');
  assert.equal(declaredType({ gristType: T('RefList:Thematiques', 'elu_rattache') }).text, 'Référence multiple → Thematiques (inverse de elu_rattache)');
  assert.equal(declaredType({ gristType: T('DateTime:Europe/Paris') }).text, 'Date et Heure (Europe/Paris)');
  assert.equal(declaredType({ gristType: T('Text') }).text, 'Texte');
  assert.equal(declaredType({ gristType: T('Any'), isFormula: true }).text, '', 'formule sans type : vide, comme le modèle');
  const col = (formula, isFormula = true, trigger = null) => ({ name: 'x', isFormula, details: { formula, trigger } });
  assert.deepEqual([{ name: 'id' }, col('', false), col('$Service.Nom'), col('len(Conges.lookupRecords(Agent=$id))'), col('NOW()', false, { when: 'new' }), col('$Service.Nom', false, { when: 'new' })].map(columnRole),
    ['Clé primaire', 'Donnée', 'Dérivée', 'Calculée', 'Donnée', 'Dérivée']);
  // Définitions : donnée (sans formule propre), calculée (formule qui calcule), dérivée (recopie, extraction, combinaison, transformation)
  const nature = (f) => columnRole(col(f));
  assert.deepEqual(['Clients.lookupOne(Nom=$Client).Ville', 'f"{$Prenom} {$Nom.upper()}"', 'CONCATENATE($nom," ",$prenom)', 'UPPER($Nom)', 'return elu_organisme_lien.organe'].map(nature), Array(5).fill('Dérivée'));
  assert.deepEqual(['$Budget - $Depense', 'SUM(Depenses.lookupRecords(Projet=$id).Montant)', '"Absent" if $Conge else "Présent"', 'DATEDIF($Debut, TODAY(), "Y")', 'len($group)', '"Paris"'].map(nature), Array(6).fill('Calculée'));
  const t = { name: 'Elus', columns: [
    { name: 'nom', label: '✏️ Nom', gristType: T('Text'), isFormula: false, details: { formula: '' } },
    { name: 'nom_complet', label: '💻 Nom complet', gristType: T('Text'), isFormula: true, details: { formula: "CONCATENATE(nom,' ',prenom)" } },
    { name: 'v_nb', label: '', gristType: T('Int'), isFormula: true, details: { formula: '# Nombre de conflits\nlen(X.lookupRecords(a=$id))' } },
    { name: 'date_creation', label: '', gristType: T('DateTime:Europe/Paris'), isFormula: false, details: { formula: 'NOW()', trigger: { when: 'new' } } },
  ] };
  assert.deepEqual(tableRows(t).map(rowValues), [
    ['id', '', 'INTEGER', '', 'Clé primaire', 'Non calculé', '', 'Non concerné'],
    ['nom', '✏️ Nom', 'TEXT', 'Texte', 'Donnée', 'Non calculé', '', 'Non concerné'],
    ['nom_complet', '💻 Nom complet', 'TEXT', 'Texte', 'Dérivée', 'Calculé', "CONCATENATE(nom,' ',prenom)", 'Pas de documentation'],
    ['v_nb', '', 'INTEGER', 'Entier', 'Calculée', 'Calculé', '# Nombre de conflits\nlen(X.lookupRecords(a=$id))', 'Documentée'],
    ['date_creation', '', 'BLOB', 'Date et Heure (Europe/Paris)', 'Donnée', 'Initialisé', 'NOW()', 'Pas de documentation'],
  ]);
});

test('lookups : lookupOne et lookupRecords lus dans les formules, chaînes et commentaires ignorés', () => {
  const meta = loadMeta('document-complexe.metadata.json');
  const schema = schemaFromMetadata(meta.tables, meta.columns, { sections: meta.sections });
  const out = convertAll({ schema }).corrected;
  const list = findLookups(out.tables, schema);
  const key = (l) => `${l.source}.${l.column} → ${l.target} (${l.kind})`;
  const keys = list.map(key);
  assert.ok(keys.includes('Agents.Conge_en_cours → Conges (one)') || keys.some((k) => /→ Conges \(one\)/.test(k)), keys.join('\n'));
  assert.ok(keys.some((k) => /→ Projets \(records\)/.test(k)) && keys.some((k) => /→ Depenses \(records\)/.test(k)) && keys.some((k) => /→ Taches \(records\)/.test(k)), keys.join('\n'));
  const fake = [
    { name: 'A', columns: [{ name: 'x', isFormula: true, details: { formula: '"B.lookupOne(id=1)"  # C.lookupRecords()\nreturn B.lookupRecords(k=$k)' } }] },
    { name: 'B', columns: [] }, { name: 'C', columns: [] },
  ];
  assert.deepEqual(findLookups(fake).map(key), ['A.x → B (records)'], 'pas de lookup dans une chaîne ni un commentaire');
  assert.deepEqual(findLookups([{ name: 'A', columns: [{ name: 'y', isFormula: true, details: { formula: 'rec.lookupOne(a=1) or Inconnue.lookupOne(a=1)' } }] }]), [], 'cibles inconnues ignorées');
});

test('géométrie d\'un lookup : tracé orthogonal terminé par une flèche contre la table cherchée', () => {
  const g = lookupGeometry({ x: 0, y: 0, w: 100, h: 80 }, 40, { x: 300, y: 100, w: 100, h: 80 }, 116);
  assert.deepEqual(g.sides, { source: 'right', target: 'left' });
  assert.match(g.arrow, /^M292,112 L300,116 L292,120 Z$/);
});

test('lookups de colonne à colonne sur les métadonnées réelles du document complexe (deux colonnes d\'essai : synthèse, initialisation)', () => {
  const meta = loadMeta('essai-reel.metadata.json');
  const schema = schemaFromMetadata(meta.tables, meta.columns, { sections: meta.sections });
  const keys = findLookups(convertAll({ schema }).corrected.tables, schema).map((l) => `${l.source}.${l.column} ← ${l.target}.${l.targetColumn ?? '(table)'} (${l.kind}, ${l.via}${l.trigger ? ', initialisation' : ''})`);
  assert.deepEqual(keys, [
    'Agents.Nb_projets ← Projets.Chef_de_projet (records, key)',
    'Agents.Statut_calcule ← Conges.Agent (one, key)',
    'Agents.Statut_calcule ← Conges.Valide (one, key)',
    'Budgets.Montant_engage ← Depenses.Montant (records, read)',
    'Budgets.Montant_engage ← Depenses.Projet (records, read)',
    'Directions.Essai_lookup_synthese ← Agents_Summary.(table) (records, null)',
    'Directions.Essai_lookup_synthese ← Agents.Service (records, key)',
    'Indicateurs.Resultat ← Taches.En_retard (records, key)',
    'Projets.Depense ← Depenses.Montant (records, read)',
    'Services.Effectif ← Agents.Service (records, key)',
    'Sites.Essai_lookup_init ← Directions.id (one, key, initialisation)',
  ]);
});

test('lookups : colonne lue directement, par une variable de boucle ou une affectation', () => {
  const t = (name, cols, formula) => ({ name, columns: cols.map((c) => ({ name: c, isFormula: !!formula && c === cols[0], details: { formula: c === cols[0] ? formula : '' } })) });
  const run = (formula) => findLookups([t('A', ['f'], formula), t('Clients', ['Nom', 'Ville', 'Actif'])]).map((l) => `${l.targetColumn}:${l.via}`);
  assert.deepEqual(run('Clients.lookupOne(Nom=$Client).Ville'), ['Ville:read']);
  assert.deepEqual(run('[c.Ville for c in Clients.lookupRecords(Actif=True)]'), ['Ville:read']);
  assert.deepEqual(run('c = Clients.lookupOne(Nom=$x)\nreturn c.Ville if c else None'), ['Ville:read']);
  assert.deepEqual(run('len(Clients.lookupRecords(Actif=True, order_by="Nom"))'), ['Actif:key']);
  assert.deepEqual(run('len(Clients.lookupRecords())'), ['null:null']);
});
