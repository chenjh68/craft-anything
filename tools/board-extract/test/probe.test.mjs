// The onboarding helper: a picture nobody described in, a starting config out.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import { probe } from "../src/probe.mjs";
import { loadConfig } from "../src/config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const png = PNG.sync.read(fs.readFileSync(path.join(HERE, "fixtures", "board.png")));

test("on a known board it finds the face, its covered shade, the face size and the backdrop", () => {
  const result = probe(png, loadConfig());
  assert.ok(result.best, result.notes.join("; "));
  assert.deepEqual(result.best.face, [240, 248, 200]);
  assert.deepEqual(result.best.dim, [144, 152, 120], "the covered shade is measured, not multiplied");
  assert.deepEqual(result.best.tile, [128, 130]);
  assert.deepEqual(result.best.background, [192, 248, 136]);
  assert.equal(result.best.boardWidth, png.width);
  assert.equal(result.best.minSide, 40, "the size filters follow the face it found");
  assert.equal(result.best.minArea, 1200);
});

test("a picture with no tiles says so instead of inventing a config", () => {
  const blank = new PNG({ width: 400, height: 300 });
  for (let i = 0; i < blank.data.length; i += 4) {
    blank.data[i] = 10; blank.data[i + 1] = 20; blank.data[i + 2] = 30; blank.data[i + 3] = 255;
  }
  const result = probe(blank, loadConfig());
  assert.equal(result.best, null);
  assert.ok(result.notes.length > 0, "it explains why");
});

test("every proposal it reports came from a colour that really is inside the faces", () => {
  const result = probe(png, loadConfig());
  assert.ok(result.tried.length > 0);
  for (const trial of result.tried) {
    assert.ok(trial.inside >= 0.35, `${trial.face.join(",")} inside ${trial.inside}`);
    assert.ok(trial.bright >= 0.5, `${trial.face.join(",")} bright ${trial.bright}`);
    assert.ok(trial.tiles >= 4);
  }
});
