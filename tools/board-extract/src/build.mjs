// Turn detected tiles plus names into a level model: restore the whole rectangle of a covered
// tile, work out which tile covers which, and count what is visible.
import { PNG } from "pngjs";

const OVERLAP_FOR_PAIR = 900; // px² of shared area before a pair is examined

export function buildModel({ detected, types, config, png, meta }) {
  const tileSize = config.tile;
  const tiles = detected.tiles
    .map((t) => ({
      x: t.x, y: t.y, w: t.w, h: t.h,
      state: t.bright ? "clickable" : "covered",
      type: types[`${t.x},${t.y}`] || "unknown",
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((t, i) => ({ id: i + 1, ...t }));

  const counts = {};
  for (const t of tiles) counts[t.type] = (counts[t.type] || 0) + 1;

  restoreAll(tiles, tileSize);
  const layers = layering(tiles, png);
  if (layers) tiles.sort((a, b) => a.z - b.z).forEach((t, i) => { t.id = i + 1; });

  return {
    model: {
      game: meta.game || "unknown",
      level: meta.level || "unknown",
      captured: meta.captured || new Date().toISOString(),
      source: meta.source || "",
      board: {
        tile: tileSize,
        slots: config.slots,
        slot_state: "unrecorded",
        tools: ["移出", "撤回", "洗牌"],
      },
      tiles,
      piles: meta.piles || [],
      layers: layers || null,
      counts_visible: counts,
      confidence: {
        tile_boxes: "colour segmentation (face and face x dimFactor)",
        state: "bright = clickable, dimmed = covered",
        layering: layers
          ? `${layers.decided}/${layers.pairs} overlapping pairs ordered from broken outlines; the rest from bright-vs-dim`
          : "no picture to measure: z follows bright-vs-dim only",
        types: `${Object.keys(types).length} corners named; the rest are unknown`,
        hidden: "tiles fully covered by others are not in this list",
      },
      notes: [
        "A real level has every type in threes; the remainder sits in side-view piles and under other tiles.",
        "Positions are pixels inside the captured board, not grid cells: tiles sit at arbitrary offsets.",
        "z starts at 1 at the bottom; a tile can be picked when no tile with a higher z overlaps it.",
      ],
    },
    overlay: png ? drawOverlay(png, tiles) : null,
  };
}

/**
 * A covered tile only shows the part that peeks out. Try the ways a full-size tile can contain
 * that sliver and keep the one that sits under a neighbour the most; a covered tile is covered by
 * a pickable one, so that overlap counts double. Only the clipped axis may move.
 */
function restoreAll(tiles, tileSize) {
  for (const t of tiles) {
    if (t.state !== "covered" || (t.w >= tileSize[0] - 2 && t.h >= tileSize[1] - 2)) continue;
    const xs = t.w >= tileSize[0] - 2 ? [t.x] : [t.x, t.x + t.w - tileSize[0]];
    const ys = t.h >= tileSize[1] - 2 ? [t.y] : [t.y, t.y + t.h - tileSize[1]];
    let best = null, bestScore = -1;
    for (const x of xs) {
      for (const y of ys) {
        let score = 0;
        for (const o of tiles) {
          if (o === t) continue;
          const ow = Math.min(x + tileSize[0], o.x + o.w) - Math.max(x, o.x);
          const oh = Math.min(y + tileSize[1], o.y + o.h) - Math.max(y, o.y);
          if (ow > 0 && oh > 0) score += ow * oh * (o.state === "clickable" ? 2 : 1);
        }
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
    }
    if (best && bestScore > 0) {
      t.visible = { x: t.x, y: t.y, w: t.w, h: t.h };
      t.x = best.x; t.y = best.y; t.w = tileSize[0]; t.h = tileSize[1];
    }
  }
}

/**
 * Which tile covers which: a tile's dark outline is broken wherever another tile lies over it, so
 * sampling a tile's border inside its neighbour's rectangle tells the order. The capture also
 * proves that dim tiles are covered, so every dim tile is kept under the bright group.
 */
function layering(tiles, png) {
  if (!png) return null;
  const isBorder = (r, g, b) => r < 95 && g < 115 && b < 75;
  const inside = (x, y, a) => x > a.x + 2 && x < a.x + a.w - 2 && y > a.y + 2 && y < a.y + a.h - 2;
  const visible = (b, a) => {
    let total = 0, seen = 0;
    const check = (x, y) => {
      if (!inside(x, y, a)) return;
      total++;
      const i = (y * png.width + x) << 2;
      if (isBorder(png.data[i], png.data[i + 1], png.data[i + 2])) seen++;
    };
    for (let x = Math.max(0, b.x); x < Math.min(png.width, b.x + b.w); x += 2) {
      check(x, b.y + 1);
      check(x, b.y + b.h - 2);
    }
    for (let y = Math.max(0, b.y); y < Math.min(png.height, b.y + b.h); y += 2) {
      check(b.x + 1, y);
      check(b.x + b.w - 2, y);
    }
    return total ? seen / total : 0;
  };
  const overlapArea = (a, b) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  };

  const above = new Map(tiles.map((t) => [t, new Set()]));
  let pairs = 0, decided = 0, agreed = 0;
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], b = tiles[j];
      if (overlapArea(a, b) < OVERLAP_FOR_PAIR) continue;
      pairs++;
      const vb = visible(b, a), va = visible(a, b);
      let bOverA = null;
      if (vb > 0.6 && va < 0.4) bOverA = true;
      else if (va > 0.6 && vb < 0.4) bOverA = false;
      if (bOverA === null) {
        if (a.state === "clickable" && b.state === "covered") bOverA = false;
        else if (b.state === "clickable" && a.state === "covered") bOverA = true;
      }
      if (bOverA === null) continue;
      decided++;
      if ((bOverA && b.state === "clickable" && a.state === "covered") || (!bOverA && a.state === "clickable" && b.state === "covered")) agreed++;
      if (bOverA) above.get(b).add(a);
      else above.get(a).add(b);
    }
  }
  const depth = (t) => above.get(t).size;
  tiles.forEach((t, i) => {
    t.z = (t.state === "clickable" ? 1000 : 0) + depth(t) * 10 + i * 0.01;
  });
  return { pairs, decided, agreed };
}

function drawOverlay(png, tiles) {
  const out = PNG.sync.read(PNG.sync.write(png));
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
    const i = (y * out.width + x) << 2;
    out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255;
  };
  for (const t of tiles) {
    const [r, g, b] = t.state === "clickable" ? [0, 200, 0] : [255, 120, 0];
    for (let x = t.x; x < t.x + t.w; x++) { put(x, t.y, r, g, b); put(x, t.y + t.h - 1, r, g, b); }
    for (let y = t.y; y < t.y + t.h; y++) { put(t.x, y, r, g, b); put(t.x + t.w - 1, y, r, g, b); }
  }
  return out;
}
