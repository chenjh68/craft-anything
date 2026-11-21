// A capture from a smaller screen: the same board at half, third and quarter size. Detection has to
// say which face size it saw, and following that advice has to find the whole board.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import { detect } from "../src/detect.mjs";
import { loadConfig, withTile, parseTile } from "../src/config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "board.png");

// Nearest neighbour: pixel colours are kept exactly, which is what the colour mask needs.
function scaledDown(png, k) {
  const width = Math.floor(png.width / k), height = Math.floor(png.height / k);
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * k * png.width + x * k) << 2;
      const d = (y * width + x) << 2;
      out.data[d] = png.data[s];
      out.data[d + 1] = png.data[s + 1];
      out.data[d + 2] = png.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
  return out;
}

const source = PNG.sync.read(fs.readFileSync(FIXTURE));

test("the desktop thresholds are unchanged by the derivation", () => {
  const config = loadConfig();
  assert.deepEqual(config.tile, [128, 130]);
  assert.equal(config.minSide, 40);
  assert.equal(config.minArea, 1200);
});

test("a smaller capture says which face size it saw instead of quietly half-finding the board", () => {
  for (const k of [2, 4]) {
    const found = detect(scaledDown(source, k), loadConfig());
    assert.ok(found.tiles.length < 38, `1/${k}: default thresholds should not find the whole board`);
    assert.ok(found.hint, `1/${k}: it explains itself`);
    assert.match(found.hint, /--tile \d+x\d+/, `1/${k}: ${found.hint}`);
  }
});

test("following the hint finds the whole board at every scale", () => {
  for (const k of [2, 3, 4]) {
    const png = scaledDown(source, k);
    const first = detect(png, loadConfig());
    const suggested = /--tile (\d+x\d+)/.exec(first.hint || "")?.[1];
    assert.ok(suggested, `1/${k}: no suggestion to follow (${first.hint})`);

    const tuned = detect(png, withTile(loadConfig(), parseTile(suggested)));
    assert.equal(tuned.tiles.length, 38, `1/${k} at tile ${suggested}`);
    assert.equal(tuned.tiles.filter((t) => t.bright).length, 19, `1/${k} at tile ${suggested}`);
    assert.equal(tuned.hint, undefined, `1/${k}: no complaint once the size matches`);
  }
});

test("--tile accepts 64x65 and 64,65", () => {
  assert.deepEqual(parseTile("64x65"), [64, 65]);
  assert.deepEqual(parseTile("64,65"), [64, 65]);
  assert.throws(() => parseTile("big"), /--tile wants WxH/);
  assert.throws(() => parseTile("64"), /--tile wants WxH/);
});

test("a config file that names its own thresholds keeps them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-extract-config-"));
  try {
    const file = path.join(dir, "board-extract.config.json");
    fs.writeFileSync(file, JSON.stringify({ tile: [64, 65], minSide: 30, minArea: 900 }));
    const config = loadConfig(file);
    assert.equal(config.minSide, 30, "the file wins over the ratio");
    assert.equal(config.minArea, 900);
    const scaled = withTile(config, [36, 37]);
    assert.equal(scaled.minSide, 30, "and it survives --tile as well");
    assert.equal(scaled.minArea, 900);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
