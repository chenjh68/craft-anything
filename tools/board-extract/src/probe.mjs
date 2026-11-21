// One picture in, a starting config out: which two colours behave like a tile face and its covered
// form, how big one face is, and where that leaves the thresholds. Built for a screen nobody has
// described yet — the person still confirms it, but they start from a proposal instead of a guess.
import { detect } from "./detect.mjs";
import { palette } from "./image.mjs";
import { thresholdsFor } from "./config.mjs";

const LOOSE = { minSide: 8, minArea: 64, faceTolerance: 12, dimTolerance: 12 };

/** The size most of the roughly square faces share, as [w, h] or null. */
function modalSize(tiles) {
  const square = tiles.filter((t) => t.w >= t.h * 0.6 && t.h >= t.w * 0.6);
  if (square.length === 0) return { size: null, share: 0 };
  const counts = new Map();
  for (const t of square) {
    const key = `${Math.round(t.w / 2) * 2}x${Math.round(t.h / 2) * 2}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return { size: best.split("x").map(Number), share: n / square.length };
}

/**
 * What share of a face's own box is this colour (or its covered twin). A border or a drop shadow
 * forms same-sized shapes too, but inside its box sits somebody else's colour.
 */
function interiorShare(png, tiles, face, dim, tol) {
  const near = (i, p) =>
    Math.abs(png.data[i] - p[0]) <= tol &&
    Math.abs(png.data[i + 1] - p[1]) <= tol &&
    Math.abs(png.data[i + 2] - p[2]) <= tol;
  let hits = 0, total = 0;
  for (const t of tiles) {
    for (let y = t.y; y < t.y + t.h; y++) {
      if (y < 0 || y >= png.height) continue;
      for (let x = t.x; x < t.x + t.w; x++) {
        if (x < 0 || x >= png.width) continue;
        const i = (y * png.width + x) << 2;
        total++;
        if (near(i, face) || near(i, dim)) hits++;
      }
    }
  }
  return total ? hits / total : 0;
}

/**
 * Try the picture's own colours as a tile face, with `face x dimFactor` as its covered form, and
 * keep whichever explains the most card-like faces.
 */
export function probe(png, config, { candidates = 8 } = {}) {
  const look = palette(png, config, candidates);
  const tried = [];

  for (const [r, g, b, pixels] of look.colors) {
    if (pixels < png.width * png.height * 0.005) continue; // a colour that covers almost nothing
    const face = [r, g, b];
    // The covered form is usually in the picture too: take its real value when it is, so the
    // config carries measured colours rather than a multiplication that may be a few points off.
    const expected = face.map((v) => v * config.dimFactor);
    const measured = look.colors
      .map(([dr, dg, db]) => [dr, dg, db])
      .filter((c) => c.join(",") !== face.join(","))
      .map((c) => ({ c, d: Math.hypot(c[0] - expected[0], c[1] - expected[1], c[2] - expected[2]) }))
      .sort((a, b) => a.d - b.d)[0];
    const dim = measured && measured.d <= 24 ? measured.c : face.map((v) => Math.round(v * config.dimFactor));
    const trial = {
      ...config,
      face,
      dim,
      faceTolerance: LOOSE.faceTolerance,
      dimTolerance: LOOSE.dimTolerance,
      minSide: LOOSE.minSide,
      minArea: LOOSE.minArea,
    };
    let found;
    try {
      found = detect(png, trial);
    } catch {
      continue;
    }
    const { size, share } = modalSize(found.tiles);
    if (!size) continue;
    // Only faces of the size the board mostly uses: a board also yields slivers where two cards
    // meet, and their "inside" is somebody else's card.
    const sameSize = found.tiles.filter(
      (t) => Math.abs(t.w - size[0]) <= size[0] * 0.25 && Math.abs(t.h - size[1]) <= size[1] * 0.25,
    );
    const inside = interiorShare(png, sameSize, face, dim, LOOSE.faceTolerance);
    // The proposed colour has to be the *pickable* face. If the shapes only match the covered
    // shade, the proposal is the shadow of something else, and z-order would come out inverted.
    const brightShare = sameSize.length ? sameSize.filter((t) => t.bright).length / sameSize.length : 0;
    if (brightShare < 0.5) continue;
    if (inside < 0.35) continue; // that colour is a rim or a shadow, not a face
    if (found.tiles.length < 4) continue; // one or two blobs is a panel, not a board
    // A card is a small part of a board; a colour that spans a fifth of the picture is its backdrop.
    const area = size[0] * size[1];
    if (area < png.width * png.height * 0.003 || area > png.width * png.height * 0.12) continue;
    // Card-like: several faces, most of them one size, and a face that is a real part of the picture.
    const coverage = (size[0] * size[1] * found.tiles.length) / (png.width * png.height);
    const pairPixels = look.colors
      .filter(([pr, pg, pb]) => {
        const d1 = Math.hypot(pr - face[0], pg - face[1], pb - face[2]);
        const d2 = Math.hypot(pr - dim[0], pg - dim[1], pb - dim[2]);
        return d1 <= LOOSE.faceTolerance || d2 <= LOOSE.dimTolerance;
      })
      .reduce((n, [, , , p]) => n + p, 0);
    const pairShare = pairPixels / (png.width * png.height);
    tried.push({
      face,
      dim,
      tiles: found.tiles.length,
      clusters: found.clusters.length,
      size,
      share: Number(share.toFixed(2)),
      inside: Number(inside.toFixed(2)),
      bright: Number(brightShare.toFixed(2)),
      coverage: Number(coverage.toFixed(3)),
      pair: Number(pairShare.toFixed(3)),
      score: Number((found.tiles.length * share * inside * brightShare).toFixed(2)),
    });
  }

  tried.sort((a, b) => b.score - a.score);
  const best = tried[0] || null;
  const out = {
    size: [png.width, png.height],
    palette: look.colors,
    tried,
    best: null,
    notes: [],
  };
  if (!best) {
    out.notes.push("no colour explains a set of same-sized faces; this may not be a tile board, or it needs a crop");
    return out;
  }

  const tile = best.size;
  // The picture's own backdrop: the common colour that is neither the face nor its covered shade.
  const background = look.colors
    .map(([r, g, b]) => [r, g, b])
    .find((c) => Math.hypot(c[0] - best.face[0], c[1] - best.face[1], c[2] - best.face[2]) > 30
      && Math.hypot(c[0] - best.dim[0], c[1] - best.dim[1], c[2] - best.dim[2]) > 30) || config.background;
  out.best = {
    face: best.face,
    dim: best.dim,
    background,
    tile,
    slots: config.slots,
    boardWidth: png.width,
    ...thresholdsFor(tile),
  };
  if (best.share < 0.6) out.notes.push(`only ${Math.round(best.share * 100)}% of the faces share one size; the board may be partly cut off`);
  if (best.tiles < 4) out.notes.push(`only ${best.tiles} faces found; a crop that holds just the board usually helps`);
  if (best.coverage > 0.5) out.notes.push("the faces cover over half the picture; this colour may be the background, not a tile");
  out.notes.push("confirm on a second capture before trusting it: a colour that looks like a face may be a panel or a button");
  return out;
}
