// The property a model must keep: the tiles it calls pickable are the tiles the capture shows as
// bright. If a change to detection, restoration or layering breaks that, this catches it.
const BLOCK_OVERLAP = 0.05; // real stacks overlap by ~12-14 px, about a tenth of a face

const overlapRatio = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
};

/** Every tile nothing above overlaps, by the page's own rule. */
export function pickableTiles(model) {
  const tiles = model.tiles || [];
  return tiles.filter((t) => !tiles.some((o) => o !== t && (o.z ?? 0) > (t.z ?? 0) && overlapRatio(t, o) > BLOCK_OVERLAP));
}

/**
 * How many tiles the model would let you pick although the capture shows them covered, and the
 * other way round. Both should be zero.
 */
export function pickableMismatches(model) {
  const tiles = model.tiles || [];
  const pickable = new Set(pickableTiles(model));
  let wronglyPickable = 0, wronglyBlocked = 0;
  for (const t of tiles) {
    const bright = t.state === "clickable";
    if (pickable.has(t) && !bright) wronglyPickable++;
    if (!pickable.has(t) && bright) wronglyBlocked++;
  }
  return { total: tiles.length, pickable: pickable.size, bright: tiles.filter((t) => t.state === "clickable").length, wronglyPickable, wronglyBlocked };
}
