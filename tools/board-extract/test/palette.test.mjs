// The colour diagnosis `check` prints: mostly what the picture is made of, plus how much of it the
// configured face/dim colours actually cover. A different game shows up here before anything else.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import { palette } from "../src/image.mjs";
import { loadConfig } from "../src/config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const png = PNG.sync.read(fs.readFileSync(path.join(HERE, "fixtures", "board.png")));

test("the configured colours cover most of a board they were measured on", () => {
  const look = palette(png, loadConfig());
  assert.ok(look.face > 100000, `face pixels ${look.face}`);
  assert.ok(look.dim > 50000, `dim pixels ${look.dim}`);
  const top = look.colors.map(([r, g, b]) => `${r},${g},${b}`);
  assert.ok(top.includes("240,248,200"), `face colour is in the palette: ${top.join(" | ")}`);
});

test("colours from another game match nothing and the palette says what is there", () => {
  const config = { ...loadConfig(), face: [1, 2, 3], dim: [4, 5, 6] };
  const look = palette(png, config);
  // Not exactly zero: a few dark pixels fall inside any small tolerance. The point is that almost
  // nothing matches, which is what the tool reports as a colour mismatch.
  assert.ok((look.face + look.dim) / look.total < 0.02, `matched ${(100 * (look.face + look.dim) / look.total).toFixed(1)}%`);
  assert.ok(look.colors.length >= 3, "but the palette still describes the picture");
  assert.ok(look.colors[0][3] > 10000, "and its top colour is a real one, not noise");
});
