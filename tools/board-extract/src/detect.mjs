// Find tile faces on a captured board: colour mask, connected components, colour signature,
// icon clustering. Pure: it takes a PNG and returns tiles plus a montage, and writes nothing.
import { PNG } from "pngjs";

const SIG = 12; // 12x12 RGB per tile
const CLUSTER_DISTANCE = 22; // mean absolute RGB distance that still counts as the same icon

const near = (r, g, b, c, tol) => Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol;

export function detect(png, config) {
  const found = detectOnce(png, config);
  const seen = modalFace(found.tiles);

  if (seen) {
    // Detection can half-succeed at the wrong scale (28 of 38 faces, say), which is worse than
    // failing outright: the face size found is the tell.
    const off = Math.abs(seen[0] - config.tile[0]) / config.tile[0];
    return off > 0.2 ? { ...found, hint: tileHint(config, seen, "the faces here look different") } : found;
  }

  // Too few faces to read a size from. Look again with loose filters: if that finds far more, the
  // thresholds are too big for this picture, and the loose pass says what size is actually there.
  if (config.minSide <= 14) return found;
  const loose = detectOnce(png, { ...config, minSide: 12, minArea: 160 });
  const guess = modalFace(loose.tiles);
  const foundMore = loose.tiles.length >= found.tiles.length * 2 + 2;
  if (!guess || !foundMore) return found;
  const why = found.tiles.length ? `only ${found.tiles.length} face(s) passed` : "nothing passed";
  return { ...found, hint: tileHint(config, guess, why) };
}

function tileHint(config, seen, why) {
  return `${why}: about ${seen[0]}x${seen[1]} against tile ${config.tile.join("x")} — pass --tile ${seen[0]}x${seen[1]}`;
}

/** The most common size among the roughly square faces, or null when there are too few to tell. */
function modalFace(tiles) {
  const square = tiles.filter((t) => t.w >= t.h * 0.6 && t.h >= t.w * 0.6);
  if (square.length < 4) return null;
  const counts = new Map();
  for (const t of square) {
    const key = `${Math.round(t.w / 2) * 2}x${Math.round(t.h / 2) * 2}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (n < square.length * 0.5) return null; // no single size dominates
  return best.split("x").map(Number);
}

function detectOnce(png, config) {
  const { width: W, height: H, data } = png;
  const px = (x, y) => { const i = (y * W + x) << 2; return [data[i], data[i + 1], data[i + 2]]; };

  // 1. Face pixels: 1 = bright (pickable), 2 = dim (covered).
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = px(x, y);
      if (near(r, g, b, config.face, config.faceTolerance)) mask[y * W + x] = 1;
      else if (near(r, g, b, config.dim, config.dimTolerance)) mask[y * W + x] = 2;
    }
  }

  // 2. Connected components.
  const seen = new Uint8Array(W * H);
  const comps = [];
  const stack = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const at = y * W + x;
      if (!mask[at] || seen[at]) continue;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0, bright = 0;
      stack.length = 0;
      stack.push(at);
      seen[at] = 1;
      while (stack.length) {
        const p = stack.pop();
        const cy = (p / W) | 0, cx = p % W;
        area++;
        if (mask[p] === 1) bright++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (mask[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
      const w = maxX - minX + 1, h = maxY - minY + 1;
      if (area < config.minArea || w < config.minSide || h < config.minSide) continue;
      comps.push({ x: minX, y: minY, w, h, area, bright: bright / area > 0.5 });
    }
  }

  // 3. Signature: the inner part of the face, 12x12 RGB, dim tiles brightened back.
  const signature = (c) => {
    const v = new Float64Array(SIG * SIG * 3);
    const insetX = c.w * 0.16, insetY = c.h * 0.16;
    const stepX = (c.w - 2 * insetX) / SIG, stepY = (c.h - 2 * insetY) / SIG;
    const gain = c.bright ? 1 : 1 / config.dimFactor;
    for (let gy = 0; gy < SIG; gy++) {
      for (let gx = 0; gx < SIG; gx++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let sy = 0; sy < 3; sy++) {
          for (let sx = 0; sx < 3; sx++) {
            const x = Math.min(W - 1, Math.round(c.x + insetX + (gx + (sx + 0.5) / 3) * stepX));
            const y = Math.min(H - 1, Math.round(c.y + insetY + (gy + (sy + 0.5) / 3) * stepY));
            const [pr, pg, pb] = px(x, y);
            r += pr * gain; g += pg * gain; b += pb * gain;
            n++;
          }
        }
        const at = (gy * SIG + gx) * 3;
        v[at] = Math.min(255, r / n);
        v[at + 1] = Math.min(255, g / n);
        v[at + 2] = Math.min(255, b / n);
      }
    }
    return v;
  };

  // 4. Cluster by icon.
  const clusters = [];
  for (const c of comps) {
    c.sig = signature(c);
    let best = null, bestD = Infinity;
    for (const cl of clusters) {
      let s = 0;
      for (let i = 0; i < c.sig.length; i++) s += Math.abs(c.sig[i] - cl.sig[i]);
      const d = s / c.sig.length;
      if (d < bestD) { bestD = d; best = cl; }
    }
    if (best && bestD < CLUSTER_DISTANCE) { best.members.push(c); c.cluster = best.id; }
    else { const cl = { id: clusters.length, sig: c.sig, members: [c] }; clusters.push(cl); c.cluster = cl.id; }
  }

  return {
    width: W,
    height: H,
    tiles: comps.map((c) => ({
      x: c.x, y: c.y, w: c.w, h: c.h, area: c.area, bright: c.bright, cluster: c.cluster,
      sig: Array.from(c.sig, (v) => Math.round(v)),
    })),
    clusters: clusters.map((c) => ({ id: c.id, n: c.members.length })),
    montage: montage(clusters, px, W, H),
  };
}

// One representative crop per cluster, so a person can name them.
function montage(clusters, px, W, H) {
  const cell = 132, cols = 8;
  const rows = Math.max(1, Math.ceil(clusters.length / cols));
  const m = new PNG({ width: cols * cell, height: rows * cell });
  m.data.fill(255);
  clusters.forEach((cl, i) => {
    const rep = cl.members.slice().sort((a, b) => b.area - a.area)[0];
    const ox = (i % cols) * cell, oy = ((i / cols) | 0) * cell;
    for (let y = 0; y < cell - 4; y++) {
      for (let x = 0; x < cell - 4; x++) {
        const sx = Math.min(W - 1, rep.x + Math.round((x / (cell - 4)) * rep.w));
        const sy = Math.min(H - 1, rep.y + Math.round((y / (cell - 4)) * rep.h));
        const [r, g, b] = px(sx, sy);
        const d = ((oy + y) * m.width + ox + x) << 2;
        m.data[d] = r; m.data[d + 1] = g; m.data[d + 2] = b; m.data[d + 3] = 255;
      }
    }
  });
  return m;
}
