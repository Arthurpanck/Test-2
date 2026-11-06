import test from 'node:test';
import assert from 'node:assert/strict';
import { scanPython, maskPython, matchingParen, splitTopLevel, dollarChains, lookupCalls } from '../assets/python-text.js';

test('masquage : commentaires et chaînes effacés, positions gardées', () => {
  const code = '$A + "x#y" # note\n$B';
  const m = maskPython(code);
  assert.equal(m.length, code.length);
  assert.equal(m, `$A +${' '.repeat(13)}\n$B`);
  assert.equal(maskPython("'''doc\n$X'''\n$Y"), `${' '.repeat(6)}\n${' '.repeat(5)}\n$Y`, 'chaîne triple sur deux lignes');
  assert.equal(maskPython('"a\\"b" + $C'), '       + $C', 'guillemet échappé');
  assert.equal(maskPython("x = 'a\n$B"), 'x =   \n$B', 'une chaîne simple s’arrête en fin de ligne');
});

test('f-strings : le code entre accolades est lu sur demande', () => {
  const code = 'f"{$Prenom} {$Nom.upper()}"';
  assert.equal(maskPython(code).trim(), 'f');
  assert.equal(scanPython(code, { fstringCode: true }).masked, 'f {$Prenom} {$Nom.upper()} ');
  assert.equal(scanPython("rf'{$A}'", { fstringCode: true }).masked.trim(), 'rf {$A}');
  assert.equal(scanPython('elf"{$A}"', { fstringCode: true }).masked.includes('$A'), false, 'pas un préfixe f');
});

test('indicateurs : commentaire, chaîne triple, chaîne non refermée, texte sans commentaires', () => {
  assert.deepEqual(scanPython('$A # c').hasComment, true);
  assert.deepEqual(scanPython('"#" + $A').hasComment, false);
  assert.equal(scanPython('"""x"""').hasTriple, true);
  assert.equal(scanPython('"abc').unterminated, true);
  assert.equal(scanPython('# c\nreturn $A # d').stripped, '\nreturn $A ');
});

test('parenthèses, arguments, $Colonne et lookups', () => {
  const m = maskPython('SUM(Depenses.lookupRecords(Projet=$id, Exercice=$Annee).Montant) + f(1, (2, 3))');
  assert.equal(matchingParen(m, 3), m.indexOf(').Montant') + 9);
  assert.deepEqual(splitTopLevel('a=1, b=f(2, 3), c=[4, 5]').map((s) => s.trim()), ['a=1', 'b=f(2, 3)', 'c=[4, 5]']);
  assert.deepEqual(dollarChains('$Service.Direction.Nom + rec.Prenom + $Nom.upper()').map((r) => [r.name, r.attrs]),
    [['Service', ['Direction', 'Nom']], ['Prenom', []], ['Nom', []]]);
  const calls = lookupCalls(m);
  assert.deepEqual(calls.map((c) => [c.table, c.method, c.args]), [['Depenses', 'lookupRecords', 'Projet=$id, Exercice=$Annee']]);
  assert.deepEqual(lookupCalls(maskPython('X.lookupOne(a=1')), [], 'appel non refermé ignoré');
});
