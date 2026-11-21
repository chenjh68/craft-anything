// End-to-end without a browser: a synthetic board in, a run folder out.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";

import { detect } from "../src/detect.mjs";
import { runPipeline } from "../src/pipeline.mjs";
import { loadConfig } from "../src/config.mjs";
import { learnTiles, nameTiles, evaluate } from "../src/library.mjs";

const CONFIG = loadConfig();

function blank(width, height) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = CONFIG.background[0];
    png.data[i + 1] = CONFIG.background[1];
    png.data[i + 2] = CONFIG.background[2];
    png.data[i + 3] = 255;
  }
  return png;
}

function tile(png, { x, y, w = 128, h = 130, dim = false, icon = [220, 80, 60] }) {
  const face = dim ? CONFIG.dim : CONFIG.face;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const edge = xx < x + 2 || xx >= x + w - 2 || yy < y + 2 || yy >= y + h - 2;
      const i = (yy * png.width + xx) << 2;
      const c = edge ? [40, 56, 10] : face;
      png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255;
    }
  }
  // A blob in the middle so the signature differs per icon.
  const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) * 0.22;
  for (let yy = Math.floor(cy - r); yy < cy + r; yy++) {
    for (let xx = Math.floor(cx - r); xx < cx + r; xx++) {
      if ((xx - cx) ** 2 + (yy - cy) ** 2 > r * r) continue;
      const i = (yy * png.width + xx) << 2;
      const gain = dim ? CONFIG.dimFactor : 1;
      png.data[i] = icon[0] * gain;
      png.data[i + 1] = icon[1] * gain;
      png.data[i + 2] = icon[2] * gain;
      png.data[i + 3] = 255;
    }
  }
}

// What the board is drawn with, so a test can name detected tiles by position.
const DRAWN = [
  { x: 20, y: 20, name: "hay", icon: [220, 80, 60] },
  { x: 160, y: 20, name: "rice", icon: [80, 160, 60] },
  // A half-covered tile peeking out to the right of a bright one.
  // Same icon as the bright carrot below-right of it, so the type has two instances.
  { x: 240, y: 120, name: "carrot", icon: [230, 200, 60], w: 64, dim: true },
  { x: 240, y: 20, name: "carrot", icon: [230, 200, 60] },
];

function board() {
  const png = blank(420, 400);
  for (const d of DRAWN) tile(png, { x: d.x, y: d.y, w: d.w, dim: d.dim, icon: d.icon });
  return png;
}

/** Names keyed by the coordinates detection actually reports (the border shifts them). */
function typesFor(found) {
  // A covered tile is only visible below its coverer, so match on the nearest drawn centre
  // rather than the top-left corner.
  const out = {};
  for (const t of found.tiles) {
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    let best = null, bestD = Infinity;
    for (const d of DRAWN) {
      const dx = d.x + (d.w || 128) / 2 - cx;
      const dy = d.y + 65 - cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestD) { bestD = dist; best = d; }
    }
    if (best) out[`${t.x},${t.y}`] = best.name;
  }
  return out;
}

test("detect finds every face and separates bright from covered", () => {
  const png = board();
  const found = detect(png, CONFIG);
  assert.equal(found.tiles.length, 4);
  assert.equal(found.tiles.filter((t) => t.bright).length, 3);
  assert.equal(found.tiles.filter((t) => !t.bright).length, 1);
  assert.ok(found.tiles.every((t) => Array.isArray(t.sig) && t.sig.length === 12 * 12 * 3));
  assert.equal(found.montage.width % 132, 0);
});

test("a run writes the model, the page and the reports", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-extract-"));
  const shot = path.join(dir, "board.png");
  fs.writeFileSync(shot, PNG.sync.write(board()));

  const types = typesFor(detect(board(), CONFIG));
  const result = await runPipeline({
    shot,
    outDir: path.join(dir, "run"),
    config: CONFIG,
    game: "test game",
    level: "test level",
    types,
    noBrowser: true,
  });

  const out = result.outDir;
  for (const file of ["shot.png", "detect/tiles.json", "detect/montage.png", "level.json", "overlay.png", "playable/index.html", "run.json", "run.md"]) {
    assert.ok(fs.existsSync(path.join(out, file)), `missing ${file}`);
  }
  const model = JSON.parse(fs.readFileSync(path.join(out, "level.json"), "utf8"));
  assert.equal(model.tiles.length, 4);
  assert.ok(model.tiles.every((t) => Number.isFinite(t.z)), "every tile has a z");
  assert.equal(model.game, "test game");

  const html = fs.readFileSync(path.join(out, "playable", "index.html"), "utf8");
  assert.match(html, /window\.LEVEL = /);
  assert.match(html, /"tiles"/);
  assert.ok(fs.existsSync(path.join(out, "playable", "layout.json")));

  const report = fs.readFileSync(path.join(out, "run.md"), "utf8");
  assert.match(report, /检出牌数 \| 4/);
});

test("the library names a tile it learned from another instance", () => {
  const png = board();
  const found = detect(png, CONFIG);
  const types = typesFor(found);
  const lib = new Map();
  learnTiles(found.tiles, types, lib);
  assert.ok(lib.get("carrot")?.length >= 1);

  // Every named type is in the library; naming only ever returns a type that was learned.
  for (const name of new Set(DRAWN.map((d) => d.name))) assert.ok(lib.has(name), `${name} was learned`);
  const { named, matched } = nameTiles(found.tiles, lib);
  assert.ok(matched >= 2, "it names the tiles it has templates for");
  const known = new Set(DRAWN.map((d) => d.name));
  for (const t of named) {
    if (t.auto_type) assert.ok(known.has(t.auto_type), `${t.auto_type} is a type that was learned`);
  }
  // Leave-one-out runs and reports every tile; a half-hidden tile is expected to be unsure.
  const score = evaluate(found.tiles, types);
  assert.equal(score.total, found.tiles.length);
  assert.ok(score.right >= 1, "a full tile is named from its twin");
});

test("a config with a broken colour is refused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-extract-cfg-"));
  const file = path.join(dir, "bad.json");
  fs.writeFileSync(file, JSON.stringify({ face: [1, 2] }));
  assert.throws(() => loadConfig(file), /face must be \[r,g,b\]/);
});

test("a cropped run builds the page against the crop width", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-extract-crop-"));
  const shot = path.join(dir, "board.png");
  fs.writeFileSync(shot, PNG.sync.write(board()));
  try {
    const result = await runPipeline({
      shot,
      outDir: path.join(dir, "run"),
      config: CONFIG,
      crop: { x: 10, y: 10, w: 300, h: 300 },
      noBrowser: true,
    });
    assert.equal(result.manifest.crop.w, 300);
    // The page scales to what was analysed, not to the default 1330-wide desktop capture.
    const page = fs.readFileSync(path.join(dir, "run", "playable", "index.html"), "utf8");
    assert.match(page, /"boardWidth":300/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
