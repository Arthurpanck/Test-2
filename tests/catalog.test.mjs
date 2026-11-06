import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AUDIT_CATALOG, RETAINED_IDS } from '../assets/audit-catalog.js';
import * as registry from './audit-decisions.mjs';

test('le widget charge exactement les contrôles retenus du registre des décisions', () => {
  assert.deepEqual(AUDIT_CATALOG, registry.AUDIT_CATALOG.filter((x) => x.decision === 'Retenu'));
  assert.deepEqual(RETAINED_IDS, registry.RETAINED_IDS);
});

test('aucun module du widget ne cite un constat retiré', () => {
  const dir = new URL('../assets/', import.meta.url);
  const source = readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'audit-catalog.js').map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  // Un constat est un objet « id: '…', severity » (ou un emit('N…') du moteur de contrôles).
  for (const id of registry.REMOVED_FINDING_IDS) assert.ok(!new RegExp(`id:\\s*['"]${id}['"],\\s*severity|emit\\(\\s*['"]${id}['"]`).test(source), id);
  assert.ok(/id:\s*'acl-no-memo',\s*severity/.test(source), 'le motif reconnaît bien un constat');
});
