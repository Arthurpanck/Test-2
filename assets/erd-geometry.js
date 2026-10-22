/**
 * Géométrie du visualiseur de schéma : choix des côtés de connexion, tracé des relations
 * (orthogonal à angles arrondis), symboles de cardinalité (patte d'oie), graphe ELK.
 * Module pur, sans DOM : testé sous Node.
 */

export const EDGE_OFFSET = 24; // sortie horizontale minimale avant le premier coude
export const EDGE_RADIUS = 8; // rayon des coudes
export const MARKER_LENGTH = 14; // longueur des symboles de cardinalité

/**
 * Côtés de sortie/entrée d'une relation entre deux rectangles {x, y, w, h}.
 * Côtés opposés quand les tables sont séparées horizontalement, sinon même côté (boucle).
 */
export function chooseSides(src, tgt, gap = EDGE_OFFSET * 2) {
  if (src === tgt) return { source: 'right', target: 'right' };
  const srcRight = src.x + src.w;
  const tgtRight = tgt.x + tgt.w;
  if (tgt.x >= srcRight + gap) return { source: 'right', target: 'left' };
  if (tgtRight <= src.x - gap) return { source: 'left', target: 'right' };
  // Recouvrement horizontal : on contourne par le côté le plus proche des deux centres.
  const srcCenter = src.x + src.w / 2;
  const tgtCenter = tgt.x + tgt.w / 2;
  return tgtCenter >= srcCenter ? { source: 'right', target: 'right' } : { source: 'left', target: 'left' };
}

const dirOf = (side) => (side === 'right' ? 1 : -1);

/** Points d'un tracé orthogonal entre deux ancres latérales. */
export function orthogonalPoints(sx, sy, sourceSide, tx, ty, targetSide, { offset = EDGE_OFFSET, shift = 0 } = {}) {
  const ds = dirOf(sourceSide);
  const dt = dirOf(targetSide);
  if (sourceSide !== targetSide) {
    // Côtés opposés : un segment vertical au milieu (décalé pour séparer les relations parallèles).
    let mx = (sx + tx) / 2 + shift;
    const minX = Math.min(sx + ds * offset, tx + dt * offset);
    const maxX = Math.max(sx + ds * offset, tx + dt * offset);
    if (ds > 0 && tx > sx) mx = Math.min(Math.max(mx, minX), maxX);
    if (ds < 0 && tx < sx) mx = Math.min(Math.max(mx, minX), maxX);
    if (Math.abs(sy - ty) < 0.5) return [[sx, sy], [tx, ty]];
    return [[sx, sy], [mx, sy], [mx, ty], [tx, ty]];
  }
  // Même côté : on sort au-delà de la table la plus avancée, puis on revient.
  const mx = ds > 0 ? Math.max(sx, tx) + offset + shift : Math.min(sx, tx) - offset - shift;
  return [[sx, sy], [mx, sy], [mx, ty], [tx, ty]];
}

const round = (n) => Math.round(n * 10) / 10;

/** Chemin SVG passant par des points, coudes arrondis (comme le « smoothstep » de React Flow). */
export function roundedPath(points, radius = EDGE_RADIUS) {
  if (points.length < 2) return '';
  let d = `M${round(points[0][0])},${round(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) { d += ` L${round(cx)},${round(cy)}`; continue; }
    const ax = cx - ((cx - px) / inLen) * r;
    const ay = cy - ((cy - py) / inLen) * r;
    const bx = cx + ((nx - cx) / outLen) * r;
    const by = cy + ((ny - cy) / outLen) * r;
    d += ` L${round(ax)},${round(ay)} Q${round(cx)},${round(cy)} ${round(bx)},${round(by)}`;
  }
  const [lx, ly] = points[points.length - 1];
  return `${d} L${round(lx)},${round(ly)}`;
}

/**
 * Symbole de cardinalité à l'extrémité d'une relation, posé contre le bord de la table.
 * kind = 'many' (patte d'oie) ou 'one' (double barre).
 */
export function cardinalityMarker(x, y, side, kind, length = MARKER_LENGTH) {
  const d = dirOf(side); // vers l'extérieur de la table
  const tip = x + d * length;
  if (kind === 'many') {
    const spread = 6;
    return `M${round(tip)},${round(y)} L${round(x)},${round(y - spread)} M${round(tip)},${round(y)} L${round(x)},${round(y)} `
      + `M${round(tip)},${round(y)} L${round(x)},${round(y + spread)}`;
  }
  const bar = x + d * 8;
  return `M${round(bar)},${round(y - 6)} L${round(bar)},${round(y + 6)}`;
}

/** Tracé complet d'une relation, symboles compris. */
export function edgeGeometry(srcRect, srcY, tgtRect, tgtY, kind, { shift = 0 } = {}) {
  const sides = chooseSides(srcRect, tgtRect);
  const sx = sides.source === 'right' ? srcRect.x + srcRect.w : srcRect.x;
  const tx = sides.target === 'right' ? tgtRect.x + tgtRect.w : tgtRect.x;
  const points = orthogonalPoints(sx, srcY, sides.source, tx, tgtY, sides.target, { shift });
  return {
    sides,
    points,
    path: roundedPath(points),
    sourceMarker: cardinalityMarker(sx, srcY, sides.source, 'many'),
    targetMarker: cardinalityMarker(tx, tgtY, sides.target, kind === '<>' ? 'many' : 'one'),
  };
}

/** Rectangle englobant d'un ensemble de rectangles. */
export function boundsOf(rects) {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Transformation (translation + échelle) qui fait tenir `bounds` dans la vue. */
export function fitTransform(bounds, viewW, viewH, { padding = 32, minScale = 0.15, maxScale = 1 } = {}) {
  if (!bounds.w || !bounds.h || viewW <= 0 || viewH <= 0) return { x: padding, y: padding, k: 1 };
  const k = Math.max(minScale, Math.min(maxScale, (viewW - 2 * padding) / bounds.w, (viewH - 2 * padding) / bounds.h));
  return {
    k,
    x: (viewW - bounds.w * k) / 2 - bounds.x * k,
    y: Math.max(padding, (viewH - bounds.h * k) / 2) - bounds.y * k,
  };
}

/** Deux rectangles se chevauchent-ils (marge comprise) ? */
export function overlaps(a, b, margin = 0) {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
}

/**
 * Graphe ELK : une table = un nœud, une relation = une arête entre le port de la colonne
 * source (à droite) et le port de la clé de la table cible (à gauche). ELK place ainsi les
 * tables en tenant compte de la ligne exacte d'où part chaque relation.
 */
export function buildElkGraph(nodes, edges, { aspectRatio = 1.6 } = {}) {
  const ids = new Set(nodes.map((n) => n.id));
  const children = nodes.map((n) => {
    const ports = [];
    const seen = new Set();
    for (const e of edges) {
      if (e.source === n.id && e.target !== n.id && ids.has(e.target)) {
        const pid = `${n.id}::${e.column}::out`;
        if (!seen.has(pid)) {
          seen.add(pid);
          ports.push({ id: pid, x: n.w, y: n.ports?.[e.column] ?? n.h / 2, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'EAST' } });
        }
      }
      if (e.target === n.id && e.source !== n.id && ids.has(e.source)) {
        const pid = `${n.id}::id::in`;
        if (!seen.has(pid)) {
          seen.add(pid);
          ports.push({ id: pid, x: 0, y: n.ports?.id ?? n.h / 2, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'WEST' } });
        }
      }
    }
    return { id: n.id, width: n.w, height: n.h, ports, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } };
  });
  const elkEdges = edges
    .filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target))
    .map((e, i) => ({ id: `e${i}`, sources: [`${e.source}::${e.column}::out`], targets: [`${e.target}::id::in`] }));
  return {
    id: 'schema',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.spacing.nodeNode': '40',
      'elk.spacing.edgeNode': '24',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': '64',
      'elk.aspectRatio': String(aspectRatio),
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    },
    children,
    edges: elkEdges,
  };
}
