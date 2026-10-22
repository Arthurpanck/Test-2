// Tests de la géométrie du visualiseur de schéma : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseSides, orthogonalPoints, roundedPath, cardinalityMarker, edgeGeometry, boundsOf, fitTransform, buildElkGraph,
} from '../assets/erd-geometry.js';

const A = { x: 0, y: 0, w: 200, h: 300 };

test('côtés : tables séparées, superposées, identiques', () => {
  assert.deepEqual(chooseSides(A, { x: 400, y: 0, w: 200, h: 100 }), { source: 'right', target: 'left' });
  assert.deepEqual(chooseSides(A, { x: -500, y: 0, w: 200, h: 100 }), { source: 'left', target: 'right' });
  assert.deepEqual(chooseSides(A, { x: 50, y: 400, w: 200, h: 100 }), { source: 'right', target: 'right' });
  assert.deepEqual(chooseSides(A, { x: -80, y: 400, w: 200, h: 100 }), { source: 'left', target: 'left' });
  assert.deepEqual(chooseSides(A, A), { source: 'right', target: 'right' });
});

test('tracé orthogonal : segments horizontaux et verticaux seulement', () => {
  for (const [s, t] of [[[200, 50, 'right'], [400, 250, 'left']], [[0, 50, 'left'], [-300, 10, 'right']], [[200, 50, 'right'], [250, 450, 'right']]]) {
    const pts = orthogonalPoints(s[0], s[1], s[2], t[0], t[1], t[2]);
    assert.deepEqual(pts[0], [s[0], s[1]]);
    assert.deepEqual(pts.at(-1), [t[0], t[1]]);
    for (let i = 1; i < pts.length; i++) {
      assert.ok(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1], `segment ${i} oblique`);
    }
  }
  // Même côté : on contourne au-delà de la table la plus avancée
  const loop = orthogonalPoints(200, 50, 'right', 250, 450, 'right');
  assert.ok(loop[1][0] >= 250 + 24);
  // Même hauteur : ligne droite
  assert.equal(orthogonalPoints(200, 50, 'right', 400, 50, 'left').length, 2);
});

test('tracé : le segment vertical reste entre les tables malgré le décalage', () => {
  const pts = orthogonalPoints(200, 50, 'right', 260, 250, 'left', { shift: 100 });
  assert.ok(pts[1][0] >= 224 && pts[1][0] <= 236);
});

test('chemin SVG à coudes arrondis', () => {
  const d = roundedPath([[0, 0], [100, 0], [100, 100], [200, 100]]);
  assert.match(d, /^M0,0 L92,0 Q100,0 100,8 L100,92 Q100,100 108,100 L200,100$/);
  // Coude trop court : rayon réduit
  assert.match(roundedPath([[0, 0], [10, 0], [10, 4], [20, 4]]), /Q10,0 10,2/);
});

test('symboles de cardinalité orientés vers l\'extérieur de la table', () => {
  const many = cardinalityMarker(200, 50, 'right', 'many');
  assert.equal((many.match(/M214,50/g) || []).length, 3);
  assert.match(cardinalityMarker(0, 50, 'left', 'one'), /^M-8,44 L-8,56$/);
});

test('relation complète : plusieurs vers un, plusieurs vers plusieurs', () => {
  const g = edgeGeometry(A, 120, { x: 400, y: 0, w: 200, h: 100 }, 40, '>');
  assert.equal(g.points[0][0], 200);
  assert.equal(g.points.at(-1)[0], 400);
  assert.match(g.targetMarker, /^M392,34 L392,46$/);
  const gm = edgeGeometry(A, 120, { x: 400, y: 0, w: 200, h: 100 }, 40, '<>');
  assert.equal((gm.targetMarker.match(/M386,40/g) || []).length, 3);
});

test('cadrage : le schéma tient dans la vue', () => {
  const b = boundsOf([{ x: 10, y: 20, w: 100, h: 50 }, { x: 300, y: 400, w: 100, h: 100 }]);
  assert.deepEqual(b, { x: 10, y: 20, w: 390, h: 480 });
  const t = fitTransform(b, 800, 600, { padding: 20 });
  assert.ok(b.w * t.k <= 760 && b.h * t.k <= 560);
  assert.ok(Math.abs(t.x + b.x * t.k + b.w * t.k / 2 - 400) < 1, 'centré horizontalement');
  assert.equal(fitTransform({ x: 0, y: 0, w: 10, h: 10 }, 800, 600).k, 1, 'pas d\'agrandissement au-delà de 100 %');
});

test('graphe ELK : un port par colonne de relation, un port d\'entrée sur la clé', () => {
  const nodes = [
    { id: 'Agents', w: 200, h: 120, ports: { id: 40, Service: 70, Equipe: 95 } },
    { id: 'Services', w: 180, h: 80, ports: { id: 40 } },
  ];
  const edges = [
    { source: 'Agents', column: 'Service', target: 'Services' },
    { source: 'Agents', column: 'Equipe', target: 'Services' },
    { source: 'Agents', column: 'Chef', target: 'Agents' }, // auto-référence : exclue de la disposition
    { source: 'Agents', column: 'X', target: 'Absente' }, // table inconnue : exclue
  ];
  const g = buildElkGraph(nodes, edges);
  const agents = g.children.find((c) => c.id === 'Agents');
  const services = g.children.find((c) => c.id === 'Services');
  assert.deepEqual(agents.ports.map((p) => [p.id, p.x, p.y, p.layoutOptions['elk.port.side']]), [
    ['Agents::Service::out', 200, 70, 'EAST'], ['Agents::Equipe::out', 200, 95, 'EAST'],
  ]);
  assert.deepEqual(services.ports.map((p) => [p.id, p.x, p.y]), [['Services::id::in', 0, 40]]);
  assert.equal(g.edges.length, 2);
  assert.equal(agents.layoutOptions['elk.portConstraints'], 'FIXED_POS');
});
