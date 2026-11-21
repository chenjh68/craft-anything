// Per-game settings. Everything the capture depends on lives here, so the same package works on
// another game by pointing --config at another file instead of editing code.
import fs from "node:fs";
import path from "node:path";

export const DEFAULTS = {
  // A tile face and its covered form (face x dimFactor), measured on 羊了个羊 (PC client).
  face: [240, 248, 200],
  dim: [144, 152, 120],
  dimFactor: 0.6,
  faceTolerance: 12,
  dimTolerance: 10,
  // A full face; partial faces are the parts that peek out. A phone capture is smaller: pass
  // --tile 36x37 (or set it here) and the size filters below follow it.
  tile: [128, 130],
  // Slots at the bottom of the board.
  slots: 7,
  // The tray rectangle in the capture, used by `slots`.
  tray: { x: 1309, y: 1833, w: 1223, h: 184 },
  // Icon stand-ins for the playable page (emoji), keyed by the type names used in types.json.
  icons: {
    carrot: "🥕",
    rice: "🍚",
    red_bucket: "🪣",
    cabbage: "🥬",
    hay: "🌾",
    rake: "🧹",
    campfire: "🔥",
    leaves: "🍃",
    yarn: "🧶",
    corn: "🌽",
    brush: "🖌️",
    milk: "🥛",
    unknown: "❔",
  },
  // Background of both the capture and the page, used when trimming the comparison.
  background: [192, 248, 136],
};

// The size filters are ratios of one face, calibrated so a 128x130 face gives the 40 px / 1200 px
// that the desktop captures were tuned with. A smaller capture scales with it, not against it.
const MIN_SIDE_OF_FACE = 0.3125;
const MIN_AREA_OF_FACE = 0.0721;

/** Thresholds for a face size, unless the config file names them itself. */
export function thresholdsFor(tile, explicit = {}) {
  return {
    minSide: explicit.minSide ?? Math.max(8, Math.round(tile[0] * MIN_SIDE_OF_FACE)),
    minArea: explicit.minArea ?? Math.max(48, Math.round(tile[0] * tile[1] * MIN_AREA_OF_FACE)),
  };
}

/** "36x37" or "36,37" -> [36, 37]. */
export function parseTile(text) {
  const parts = String(text).split(/[x,]/i).map((n) => Number(n.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new Error(`--tile wants WxH (two positive numbers), got "${text}"`);
  }
  return [Math.round(parts[0]), Math.round(parts[1])];
}

/** The same config with another face size, re-deriving the size filters. */
export function withTile(config, tile) {
  const out = { ...config, tile };
  const explicit = {};
  if (config.explicitMinSide !== undefined) explicit.minSide = config.explicitMinSide;
  if (config.explicitMinArea !== undefined) explicit.minArea = config.explicitMinArea;
  Object.assign(out, thresholdsFor(tile, explicit));
  return out;
}

export function loadConfig(file) {
  if (!file) {
    const base = { ...DEFAULTS, path: null };
    return { ...base, ...thresholdsFor(base.tile) };
  }
  const full = path.resolve(file);
  const raw = JSON.parse(fs.readFileSync(full, "utf8"));
  const merged = { ...DEFAULTS, ...raw, path: full };
  // Remember what the file asked for, so --tile can re-derive the rest without overriding it.
  if (raw.minSide !== undefined) merged.explicitMinSide = raw.minSide;
  if (raw.minArea !== undefined) merged.explicitMinArea = raw.minArea;
  Object.assign(merged, thresholdsFor(merged.tile, { minSide: raw.minSide, minArea: raw.minArea }));
  for (const key of ["face", "dim", "background"]) {
    if (!Array.isArray(merged[key]) || merged[key].length !== 3) throw new Error(`${key} must be [r,g,b]`);
  }
  if (!Array.isArray(merged.tile) || merged.tile.length !== 2) throw new Error("tile must be [w,h]");
  if (!Number.isInteger(merged.slots) || merged.slots < 1) throw new Error("slots must be a positive integer");
  return merged;
}

/** Look for board-extract.config.json beside the screenshot, then in the working directory. */
export function findConfig(shotPath) {
  const candidates = [
    shotPath ? path.join(path.dirname(path.resolve(shotPath)), "board-extract.config.json") : null,
    path.resolve("board-extract.config.json"),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}
