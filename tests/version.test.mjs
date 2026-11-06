import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('le numéro de version est le même dans package.json et index.html', () => {
  const { version } = JSON.parse(read('package.json'));
  const inHtml = [...read('index.html').matchAll(/\?v=(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  assert.ok(inHtml.length >= 2, 'feuilles de style et script d’entrée versionnés');
  assert.deepEqual([...new Set(inHtml)], [version]);
});

test('les modules s’importent sans numéro de version (un seul endroit à changer)', () => {
  for (const f of readdirSync(new URL('../assets/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    assert.doesNotMatch(read(`assets/${f}`), /from '\.\/[\w-]+\.js\?v=|import\('\.\/[\w-]+\.js\?v=/, f);
  }
});
