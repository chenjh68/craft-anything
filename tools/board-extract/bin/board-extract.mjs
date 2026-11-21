#!/usr/bin/env node
// board-extract: a captured stacked-tile board -> level model -> playable page -> comparison.
//
//   board-extract run   --shot board.png --out runs/yang/2026-11-21 [--game ...] [--level ...]
//                       [--types types.json] [--piles piles.json] [--config game.json]
//                       [--library dir] [--no-browser] [--json]
//   board-extract learn --tiles <run>/detect/tiles.json --types <run>/types.json [--library dir]
//   board-extract eval  --tiles <run>/detect/tiles.json --types <run>/types.json
//   board-extract init  [--out board-extract.config.json]
//   board-extract check --shot board.png [--config ...]     (detect only, prints what it finds)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { detect } from "../src/detect.mjs";
import { runPipeline, VERSION } from "../src/pipeline.mjs";
import { loadLibrary, learnTiles, evaluate } from "../src/library.mjs";
import { loadConfig, findConfig, withTile, parseTile, DEFAULTS } from "../src/config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const HELP = `board-extract ${VERSION}

Usage:
  board-extract run   --shot <png> --out <dir> [options]
  board-extract check --shot <png> [--config <json>] [--crop x,y,w,h] [--tile WxH]
  board-extract learn --tiles <tiles.json> --types <types.json> [--library <dir>]
  board-extract eval  --tiles <tiles.json> --types <types.json>
  board-extract slots --shot <screen.png> [--config <json>] [--out <montage.png>]
  board-extract capture --out <shot.png> [--serial <id>] [--adb <path>]
  board-extract probe --shot <png> [--crop x,y,w,h] [--out config.json]
  board-extract init  [--out <json>]

Options for probe:
  --out <json>         write the proposed config here (feed it back with --config)
  --json               print everything, including every colour it tried

Options for capture:
  --out <png>          where to save the screenshot (required)
  --serial <id>        which device, when more than one is attached
  --adb <path>         adb to use (default: found on PATH, WinGet or the Android SDK)

Options for run:
  --game <name>        game name written into the model
  --level <name>       level name written into the model
  --date <YYYY-MM-DD>  used in the report (default: today)
  --slug <name>        default output folder name
  --types <json>       names you checked; they win over the library
  --piles <json>       side-view stacks: [{x,y,including_top,top}]
  --config <json>      per-game settings (colours, tile size, slots, tray, icons)
  --crop <x,y,w,h>     keep only this part of the picture (a phone screenshot holds more than the board)
  --tile <w>x<h>       a face's size here; the size filters follow it (e.g. 36x37 on a phone capture)
  --library <dir>      icon templates (default: ./library)
  --no-browser         skip the screenshot + comparison
  --json               print the run manifest

Exit codes: 0 ok, 1 failure, 2 usage.
`;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

const args = parse(process.argv.slice(2));
const cmd = args._[0];

// Version first: `--version` alone has no command and would otherwise fall into the help branch.
if (args.version || cmd === "version") {
  console.log(VERSION);
  process.exit(0);
}
if (!cmd || args.help || cmd === "help") {
  console.log(HELP);
  process.exit(cmd ? 0 : 2);
}

const readJson = (file) => {
  if (!file || file === true) fail("missing a JSON path");
  if (!fs.existsSync(file)) fail(`not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

try {
  if (cmd === "run") {
    if (!args.shot || args.shot === true) fail("--shot <screenshot.png> is required");
    if (!fs.existsSync(args.shot)) fail(`screenshot not found: ${args.shot}`);
    const configFile = args.config && args.config !== true ? args.config : findConfig(args.shot);
    let config = loadConfig(configFile);
    if (args.tile && args.tile !== true) config = withTile(config, parseTile(args.tile));
    const slug = args.slug || "game";
    const date = args.date || new Date().toISOString().slice(0, 10);
    const outDir = args.out || path.join("runs", slug, date);
    const result = await runPipeline({
      shot: args.shot,
      outDir,
      config,
      game: args.game || "",
      level: args.level || "",
      types: args.types && args.types !== true ? readJson(args.types) : {},
      piles: args.piles && args.piles !== true ? readJson(args.piles) : [],
      crop: args.crop && args.crop !== true ? args.crop : undefined,
      libraryDir: args.library || path.resolve("library"),
      noBrowser: Boolean(args["no-browser"]),
      log: (m) => console.error(m),
    });
    if (args.json) console.log(JSON.stringify(result.manifest, null, 1));
    else {
      console.log(`run -> ${path.relative(process.cwd(), result.outDir)}`);
      console.log(`  tiles=${result.manifest.tiles} clickable=${result.manifest.clickable} auto=${result.manifest.auto.matched}/${result.manifest.tiles}`);
      for (const [what, file] of Object.entries(result.manifest.artifacts)) console.log(`  ${file}  ${what}`);
    }
    process.exit(0);
  }

  if (cmd === "check") {
    if (!args.shot || args.shot === true) fail("--shot <screenshot.png> is required");
    let config = loadConfig(args.config && args.config !== true ? args.config : findConfig(args.shot));
    if (args.tile && args.tile !== true) config = withTile(config, parseTile(args.tile));
    let png = PNG.sync.read(fs.readFileSync(args.shot));
    if (args.crop && args.crop !== true) {
      const { cropPng, parseCrop } = await import("../src/image.mjs");
      png = cropPng(png, parseCrop(args.crop));
    }
    const found = detect(png, config);
    const { palette } = await import("../src/image.mjs");
    const look = palette(png, config);
    const full = found.tiles.filter((t) => t.w > 100 && t.h > 100);
    const sizes = new Map();
    for (const t of full) sizes.set(`${t.w}x${t.h}`, (sizes.get(`${t.w}x${t.h}`) || 0) + 1);
    console.log(JSON.stringify({
      size: [found.width, found.height],
      tiles: found.tiles.length,
      clickable: found.tiles.filter((t) => t.bright).length,
      clusters: found.clusters.length,
      faceSizes: Object.fromEntries([...sizes].sort((a, b) => b[1] - a[1])),
      palette: { top: look.colors, face_pixels: look.face, dim_pixels: look.dim },
      ...(found.hint ? { hint: found.hint } : {}),
      ...((look.face + look.dim) / look.total < 0.02
        ? { colours: `only ${(100 * (look.face + look.dim) / look.total).toFixed(1)}% of pixels match face ${config.face.join(",")} / dim ${config.dim.join(",")}; pick a value from palette.top and put it in the config` }
        : {}),
    }, null, 1));
    process.exit(0);
  }

  if (cmd === "learn") {
    const tiles = readJson(args.tiles).tiles;
    const types = readJson(args.types);
    if (!Array.isArray(tiles)) fail("tiles.json has no tiles");
    const dir = args.library || path.resolve("library");
    const lib = loadLibrary(dir);
    const { added, skipped } = learnTiles(tiles, types, lib);
    const { saveLibrary } = await import("../src/library.mjs");
    saveLibrary(lib, dir);
    console.log(`learned ${added}, skipped ${skipped} (already there or the type is full)`);
    for (const [type, sigs] of [...lib].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${type}: ${sigs.length}`);
    process.exit(0);
  }

  if (cmd === "eval") {
    const tiles = readJson(args.tiles).tiles;
    const types = readJson(args.types);
    const r = evaluate(tiles, types);
    console.log(`leave-one-out: ${r.right}/${r.total} right, ${r.wrong} wrong, ${r.unknown} unknown (${((100 * r.right) / Math.max(1, r.total)).toFixed(1)}%)`);
    for (const [name, b] of Object.entries(r.split)) {
      const n = b.right + b.wrong + b.unknown;
      if (n) console.log(`  ${name}: ${b.right}/${n} right, ${b.wrong} wrong, ${b.unknown} unknown`);
    }
    process.exit(0);
  }

  if (cmd === "slots") {
    if (!args.shot || args.shot === true) fail("--shot <screenshot.png> is required");
    const config = loadConfig(args.config && args.config !== true ? args.config : findConfig(args.shot));
    const png = PNG.sync.read(fs.readFileSync(args.shot));
    const { readSlots, slotsMontage } = await import("../src/slots.mjs");
    const result = readSlots(png, config);
    if (args.out && args.out !== true) fs.writeFileSync(args.out, PNG.sync.write(slotsMontage(png, config)));
    console.log(`filled ${result.filled}/${config.slots}`);
    for (const r of result.rows) console.log(`slot ${r.slot}: ${r.filled ? "TILE" : "empty"} mean=${r.mean.join(",")} lum=${r.lum} sd=${r.sd} colors=${r.colors}`);
    process.exit(0);
  }

  if (cmd === "capture") {
    if (!args.out || args.out === true) fail("--out <shot.png> is required");
    const { capture } = await import("../src/capture.mjs");
    const r = capture({
      out: args.out,
      serial: args.serial && args.serial !== true ? args.serial : undefined,
      adb: args.adb && args.adb !== true ? args.adb : undefined,
    });
    if (!r.ok) fail(r.reason, 1);
    const pic = r.picture ? `${r.picture.width}x${r.picture.height}` : "?";
    const note = r.screen && r.picture && r.screen !== pic ? ` (device ${r.screen})` : "";
    console.log(args.json ? JSON.stringify(r, null, 1)
      : `captured ${r.out}  ${(r.bytes / 1024).toFixed(0)} KB  ${pic}${note}  ${r.device}`);
    process.exit(0);
  }

  if (cmd === "probe") {
    if (!args.shot || args.shot === true) fail("--shot <screenshot.png> is required");
    const config = loadConfig(args.config && args.config !== true ? args.config : findConfig(args.shot));
    let png = PNG.sync.read(fs.readFileSync(args.shot));
    if (args.crop && args.crop !== true) {
      const { cropPng, parseCrop } = await import("../src/image.mjs");
      png = cropPng(png, parseCrop(args.crop));
    }
    const { probe } = await import("../src/probe.mjs");
    const result = probe(png, config);
    if (args.out && args.out !== true) {
      if (!result.best) fail(result.notes.join("; "), 1);
      fs.writeFileSync(args.out, JSON.stringify(result.best, null, 1));
    }
    if (args.json) {
      console.log(JSON.stringify(result, null, 1));
      process.exit(0);
    }
    console.log(`picture ${result.size[0]}x${result.size[1]}`);
    if (result.best) {
      const b = result.best;
      console.log(`best   face ${b.face.join(",")}  dim ${b.dim.join(",")}  tile ${b.tile.join("x")}  slots ${b.slots}`);
    }
    for (const t of result.tried.slice(0, 4)) {
      console.log(`  face ${t.face.join(",").padEnd(11)} tiles ${String(t.tiles).padStart(3)}  size ${t.size.join("x").padEnd(9)} share ${t.share}  score ${t.score}`);
    }
    for (const n of result.notes) console.log(`note   ${n}`);
    if (args.out && args.out !== true) console.log(`wrote  ${args.out}`);
    process.exit(result.best ? 0 : 1);
  }

  if (cmd === "init") {
    const target = args.out || "board-extract.config.json";
    if (fs.existsSync(target)) fail(`${target} already exists`);
    fs.writeFileSync(target, JSON.stringify(DEFAULTS, null, 1));
    console.log(`wrote ${target}`);
    process.exit(0);
  }

  fail(`unknown command: ${cmd}\n\n${HELP}`);
} catch (e) {
  // A plain failure (bad crop, missing file) is a message; a stack only helps when debugging.
  console.error(e?.message || String(e));
  if (process.env.DEBUG) console.error(e?.stack);
  process.exit(1);
}
