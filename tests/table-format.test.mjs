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

test('type déclaré en français, rôle, sept colonnes dans l\'ordre du modèle', () => {
  assert.deepEqual(TABLE_COLUMNS, ['Colonne (nom en base)', 'Nom affiché', 'Type SQLite', 'Type déclaré (Grist)', 'Rôle', 'Calculé ?', 'Formule']);
  assert.equal(declaredType({ gristType: T('Ref:Projets_deliberations') }).text, 'Référence → Projets_deliberations');
  assert.equal(declaredType({ gristType: T('RefList:Thematiques', 'elu_rattache') }).text, 'Référence multiple → Thematiques (inverse de elu_rattache)');
  assert.equal(declaredType({ gristType: T('DateTime:Europe/Paris') }).text, 'Date et Heure (Europe/Paris)');
  assert.equal(declaredType({ gristType: T('Text') }).text, 'Texte');
  assert.equal(declaredType({ gristType: T('Any'), isFormula: true }).text, '', 'formule sans type : vide, comme le modèle');
  assert.deepEqual(['id', 'v_nb_conflits', 'nom'].map(columnRole), ['Clé primaire', 'Dérivé (v_*)', 'Donnée']);
  const t = { name: 'Elus', columns: [
    { name: 'nom', label: '✏️ Nom', gristType: T('Text'), isFormula: false, details: { formula: '' } },
    { name: 'nom_complet', label: '💻 Nom complet', gristType: T('Text'), isFormula: true, details: { formula: "CONCATENATE(nom,' ',prenom)" } },
    { name: 'date_creation', label: '', gristType: T('DateTime:Europe/Paris'), isFormula: false, details: { formula: 'NOW()', trigger: { when: 'new' } } },
  ] };
  assert.deepEqual(tableRows(t).map(rowValues), [
    ['id', '', 'INTEGER', '', 'Clé primaire', '', ''],
    ['nom', '✏️ Nom', 'TEXT', 'Texte', 'Donnée', '', ''],
    ['nom_complet', '💻 Nom complet', 'TEXT', 'Texte', 'Donnée', 'Calculé', "CONCATENATE(nom,' ',prenom)"],
    ['date_creation', '', 'BLOB', 'Date et Heure (Europe/Paris)', 'Donnée', 'Initialisé', 'NOW()'],
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

test('lookups sur les métadonnées réelles du document complexe, avec deux colonnes d\'essai (synthèse, formule d\'initialisation)', () => {
  const meta = loadMeta('essai-reel.metadata.json');
  const schema = schemaFromMetadata(meta.tables, meta.columns, { sections: meta.sections });
  const keys = findLookups(convertAll({ schema }).corrected.tables, schema).map((l) => `${l.source}.${l.column} → ${l.target} (${l.kind}${l.trigger ? ', initialisation' : ''})`);
  assert.equal(keys.length, 9);
  assert.ok(keys.includes('Directions.Essai_lookup_synthese → Agents_Summary (records)'), 'table de synthèse « Agents_summary_Service » rattachée à « Agents_Summary »');
  assert.ok(keys.includes('Sites.Essai_lookup_init → Directions (one, initialisation)'), 'formule d\'initialisation');
  assert.ok(!keys.some((k) => /Sites.*→ (Projets|Taches)/.test(k)), 'commentaire et chaîne ignorés');
});
