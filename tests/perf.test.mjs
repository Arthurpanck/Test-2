// Gros documents : l'échantillon préparé table par table donne exactement les mêmes constats
// que l'échantillonnage sur les tables complètes, sans garder celles-ci en mémoire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presampleTable, sampleAuditData, runAudit, AUDIT_LIMITS } from '../assets/audit-engine.js';
import { schemaFromMetadata } from '../assets/converter.js';
import { definition, metadataFromDefinition } from './fixtures/mal-structure.mjs';

const words = ['Lyon', 'Paris', 'Nantes', 'Lille', 'Brest', 'Pau', 'Metz', 'Nice'];
function table(n, cols, seed = 1) {
  const t = { id: [], manualSort: [] };
  for (let i = 0; i < n; i++) { t.id.push(i * 3 + seed); t.manualSort.push(i); }
  for (let j = 0; j < cols; j++) t[`C${j}`] = t.id.map((id) => (j % 2 ? `${words[(id * (j + 7)) % 8]} ${id % 97}` : (id * 31 + j) % 1000));
  return t;
}
const presampleAll = (data, limits) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, presampleTable(k, v, limits)]));

test('même échantillon, que la table soit complète ou préparée à la lecture', () => {
  const cases = [
    { limits: AUDIT_LIMITS, data: { A: table(10, 3), B: table(5000, 8, 2), C: table(120000, 20, 3), D: table(0, 4) } },
    { limits: { ...AUDIT_LIMITS, rows: 50, cells: 900 }, data: { A: table(49, 2), B: table(51, 3, 5), C: table(400, 30, 7) } },
    { limits: { ...AUDIT_LIMITS, rows: 2000, cells: 500 }, data: { Seule: table(3000, 10) } },
  ];
  for (const { limits, data } of cases) {
    assert.deepEqual(sampleAuditData(presampleAll(data, limits), limits), sampleAuditData(data, limits));
  }
});

test('la table préparée ne garde que ses ids et l\'échantillon', () => {
  const big = table(50000, 10);
  const p = presampleTable('Grande', big);
  assert.deepEqual(Object.keys(p), ['id']);
  assert.equal(p.id.length, 50000);
  assert.equal(presampleTable('Grande', p), p, 'préparer deux fois ne change rien');
});

test('mêmes constats et mêmes contrôles sur le document mal structuré', () => {
  const m = metadataFromDefinition(definition);
  const schema = schemaFromMetadata(m.tables, m.cols, { sections: m.sections });
  const now = new Date('2026-10-29T10:00:00Z');
  const a = runAudit({ schema, data: m.records, now });
  const b = runAudit({ schema, data: presampleAll(m.records, AUDIT_LIMITS), now });
  assert.deepEqual(b.items, a.items);
  assert.deepEqual(b.checks, a.checks);
  assert.ok(a.items.length > 0);
});
