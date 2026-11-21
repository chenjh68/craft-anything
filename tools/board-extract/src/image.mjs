// Small picture helpers: a phone screenshot is the whole screen, the board is one part of it.
import { PNG } from "pngjs";

/** "x,y,w,h" (or an already parsed object) -> { x, y, w, h }. Throws a readable message. */
export function parseCrop(text) {
  if (text && typeof text === "object") return text;
  const parts = String(text).split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`--crop wants x,y,w,h (four numbers), got "${text}"`);
  }
  const [x, y, w, h] = parts;
  return { x, y, w, h };
}

/** The rectangle out of a PNG. Refuses to invent pixels outside the picture rather than clamping. */
export function cropPng(png, rect) {
  const x = Math.round(rect.x), y = Math.round(rect.y);
  const w = Math.round(rect.w), h = Math.round(rect.h);
  if (w <= 0 || h <= 0) throw new Error(`crop is ${w}x${h}; width and height have to be positive`);
  if (x < 0 || y < 0 || x + w > png.width || y + h > png.height) {
    throw new Error(`crop ${w}x${h} at ${x},${y} does not fit inside ${png.width}x${png.height}`);
  }
  const out = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * png.width + x) << 2;
    png.data.copy(out.data, row * w << 2, from, from + (w << 2));
  }
  return out;
}

/**
 * What a picture is mostly made of, and how many pixels match the configured face and dim colours.
 * A different game (or a different phone's colour handling) shows up here first: when almost
 * nothing matches, the palette is where the right values come from.
 */
export function palette(png, config, top = 5) {
  const counts = new Map();
  const tolF = config.faceTolerance, tolD = config.dimTolerance;
  const near = (r, g, b, c, tol) => Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol;
  let face = 0, dim = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (near(r, g, b, config.face, tolF)) face++;
    else if (near(r, g, b, config.dim, tolD)) dim++;
  }
  const colors = [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([k, n]) => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3, n]);
  return { colors, face, dim, total: png.width * png.height };
}
