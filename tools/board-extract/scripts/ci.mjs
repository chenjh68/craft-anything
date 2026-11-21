// Local CI: the tests, then a real capture through the pipeline, then the properties that must
// hold. Any failure exits 1. Run it with `npm run ci`; the same steps fit a GitHub Actions job.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickableMismatches } from "../src/invariants.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");
const CLI = path.join(PKG, "bin", "board-extract.mjs");
const FIXTURES = path.join(PKG, "test", "fixtures");
const board = path.join(FIXTURES, "board.png");

const GOLDEN = { tiles: 38, clickable: 19, clusters: 29, piles: 2 };

// The capture is not shipped with the package: some are other people's screenshots. When it is
// absent only the tests run, and the checks that need a picture say they were skipped.
const hasCapture = fs.existsSync(board);

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`ok   ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}

function run(args, options = {}) {
  return execFileSync(process.execPath, args, { encoding: "utf8", cwd: PKG, ...options });
}

// 1. Unit and smoke tests.
try {
  const out = run(["--test"], { stdio: "pipe" });
  const pass = /# pass (\d+)/.exec(out)?.[1];
  check("npm test", true, `${pass ?? "?"} passing`);
} catch (e) {
  check("npm test", false, (e.stdout || e.message || "").split("\n").slice(-3).join(" / ").trim());
}

if (!hasCapture) {
  console.log(`skip the rest: no ${path.relative(PKG, board)} (a capture is not shipped with the package)`);
} else {
  detectOnCapture();
  runPipelineAndCheck();
}

function detectOnCapture() {
  // 2. Detection on the real capture.
  try {
    const found = JSON.parse(run([CLI, "check", "--shot", board]));
    check("check: tiles", found.tiles === GOLDEN.tiles, `${found.tiles}`);
    check("check: clickable", found.clickable === GOLDEN.clickable, `${found.clickable}`);
    check("check: clusters", found.clusters === GOLDEN.clusters, `${found.clusters}`);
    // Antialiasing makes full faces 127-131 px; most of them must still be the real size.
    const hist = found.faceSizes || {};
    const total = Object.values(hist).reduce((a, b) => a + b, 0);
    const near = Object.entries(hist)
      .filter(([k]) => {
        const [w, h] = k.split("x").map(Number);
        return Math.abs(w - 128) <= 4 && Math.abs(h - 130) <= 4;
      })
      .reduce((a, [, n]) => a + n, 0);
    check("check: most faces near 128x130", total > 0 && near / total >= 0.5, `${near}/${total}`);
  } catch (e) {
    check("check", false, e.message);
  }
}

function runPipelineAndCheck() {
  // 3. A full run without a browser, then the model's invariants.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "board-extract-ci-"));
  try {
    run([CLI, "run", "--shot", board, "--out", outDir, "--no-browser",
      "--game", "fixture", "--level", "fixture",
      "--types", path.join(FIXTURES, "types.json"),
      "--piles", path.join(FIXTURES, "piles.json"),
      "--library", path.join(PKG, "library")]);

    const model = JSON.parse(fs.readFileSync(path.join(outDir, "level.json"), "utf8"));
    check("run: tiles", model.tiles.length === GOLDEN.tiles, `${model.tiles.length}`);
    check("run: piles", model.piles.length === GOLDEN.piles, `${model.piles.length}`);
    check("run: every tile has a z", model.tiles.every((t) => Number.isFinite(t.z)));
    check("run: every tile named", model.tiles.every((t) => t.type && t.type !== "unknown"));
    check("run: layer evidence", Boolean(model.layers && model.layers.decided > 0), model.layers ? `${model.layers.decided}/${model.layers.pairs}` : "none");

    const m = pickableMismatches(model);
    check("run: pickable set matches the capture", m.wronglyPickable === 0 && m.wronglyBlocked === 0,
      `${m.wronglyPickable} too many, ${m.wronglyBlocked} too few`);

    for (const file of ["level.json", "overlay.png", "playable/index.html", "run.json", "run.md"]) {
      check(`run: ${file}`, fs.existsSync(path.join(outDir, file)));
    }
  } catch (e) {
    check("run", false, (e.stderr || e.message || "").split("\n").slice(-3).join(" / ").trim());
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
