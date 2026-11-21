// The icon template library: naming tiles from signatures, and growing the library from a run
// whose names a person checked.
import fs from "node:fs";
import path from "node:path";

export const MATCH_LIMIT = 36; // mean absolute RGB distance; above this it says unknown
export const SAME_LIMIT = 7; // two signatures this close are the same picture
const PER_TYPE_CAP = 12;

export const distance = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

/** Read every <type>.json (an array of signatures) in a folder. */
export function loadLibrary(dir) {
  const lib = new Map();
  if (!dir || !fs.existsSync(dir)) return lib;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const type = file.slice(0, -5);
    const sigs = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    if (Array.isArray(sigs) && sigs.length) lib.set(type, sigs);
  }
  return lib;
}

export function saveLibrary(lib, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [type, sigs] of lib) fs.writeFileSync(path.join(dir, `${type}.json`), JSON.stringify(sigs));
}

export function bestMatch(sig, lib) {
  let best = { type: null, distance: Infinity };
  for (const [type, sigs] of lib) {
    for (const s of sigs) {
      const d = distance(sig, s);
      if (d < best.distance) best = { type, distance: d };
    }
  }
  return best;
}

/** Name every tile that has a signature; tiles it cannot name stay null, never guessed. */
export function nameTiles(tiles, lib) {
  const named = [];
  let matched = 0, confidence = 0;
  for (const t of tiles) {
    if (!Array.isArray(t.sig)) { named.push({ ...t, auto_type: null, auto_confidence: 0 }); continue; }
    const m = bestMatch(t.sig, lib);
    const ok = m.type && m.distance <= MATCH_LIMIT;
    const conf = ok ? Math.max(0, 1 - m.distance / MATCH_LIMIT) : 0;
    if (ok) { matched++; confidence += conf; }
    named.push({ ...t, auto_type: ok ? m.type : null, auto_confidence: Number(conf.toFixed(3)) });
  }
  return { named, matched, meanConfidence: matched ? confidence / matched : 0 };
}

export function learnTiles(tiles, types, lib) {
  let added = 0, skipped = 0;
  for (const t of tiles) {
    const type = types[`${t.x},${t.y}`];
    if (!type || !Array.isArray(t.sig)) continue;
    const sigs = lib.get(type) || [];
    if (sigs.some((s) => distance(s, t.sig) < SAME_LIMIT) || sigs.length >= PER_TYPE_CAP) { skipped++; continue; }
    sigs.push(t.sig);
    lib.set(type, sigs);
    added++;
  }
  return { added, skipped };
}

/** Leave-one-out accuracy: how well the library would name unseen tiles of these types. */
export function evaluate(tiles, types) {
  let right = 0, wrong = 0, unknown = 0;
  const split = { full: { right: 0, wrong: 0, unknown: 0 }, partial: { right: 0, wrong: 0, unknown: 0 } };
  for (const t of tiles) {
    const truth = types[`${t.x},${t.y}`];
    if (!truth) continue;
    const lib = new Map();
    for (const o of tiles) {
      const type = types[`${o.x},${o.y}`];
      if (!type || o === t) continue;
      const sigs = lib.get(type) || [];
      sigs.push(o.sig);
      lib.set(type, sigs);
    }
    const m = bestMatch(t.sig, lib);
    const bucket = t.w >= 120 && t.h >= 120 ? split.full : split.partial;
    if (!m.type || m.distance > MATCH_LIMIT) { unknown++; bucket.unknown++; }
    else if (m.type === truth) { right++; bucket.right++; }
    else { wrong++; bucket.wrong++; }
  }
  return { right, wrong, unknown, total: right + wrong + unknown, split };
}
