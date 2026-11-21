// One level in, one run folder out: detect, name, build, render, compare, report.
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { detect } from "./detect.mjs";
import { buildModel } from "./build.mjs";
import { writePlayable } from "./playable.mjs";
import { compose } from "./compose.mjs";
import { shoot } from "./shot.mjs";
import { loadLibrary, nameTiles } from "./library.mjs";
import { writeReports } from "./report.mjs";
import { pickableMismatches } from "./invariants.mjs";
import { cropPng, parseCrop } from "./image.mjs";

// One source of truth for the version: the package manifest.
export const VERSION = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;


export async function runPipeline(options) {
  const {
    shot, outDir, config: configIn, game = "", level = "", captured, types = {}, piles = [],
    crop, libraryDir, noBrowser = false, log = () => {},
  } = options;
  let config = configIn;
  if (!shot || !fs.existsSync(shot)) throw new Error(`screenshot not found: ${shot}`);
  const out = path.resolve(outDir);
  fs.mkdirSync(out, { recursive: true });
  const durations = {};
  const artifacts = {};

  // A phone screenshot is the whole screen: keep only the part the person pointed at, and keep it
  // as the evidence too, so every later coordinate is relative to a real picture in the folder.
  const rect = crop ? parseCrop(crop) : null;
  const copy = path.join(out, "shot.png");
  if (rect) {
    fs.writeFileSync(copy, PNG.sync.write(cropPng(PNG.sync.read(fs.readFileSync(shot)), rect)));
  } else {
    fs.copyFileSync(shot, copy);
  }
  const png = PNG.sync.read(fs.readFileSync(copy));

  // Cropping changes the coordinate space: unless the config names a page scale of its own, the
  // crop's width is what the playable page should be built against.
  if (rect && config.boardWidth === undefined) config = { ...config, boardWidth: rect.w };

  // 1. Detect.
  let started = Date.now();
  const found = detect(png, config);
  if (found.hint) log(found.hint);
  const detectDir = path.join(out, "detect");
  fs.mkdirSync(detectDir, { recursive: true });
  fs.writeFileSync(path.join(detectDir, "tiles.json"), JSON.stringify({ size: [found.width, found.height], tiles: found.tiles, clusters: found.clusters }, null, 1));
  fs.writeFileSync(path.join(detectDir, "montage.png"), PNG.sync.write(found.montage));
  durations.detect = Date.now() - started;
  artifacts["检测结果"] = "detect/tiles.json";
  artifacts["图标聚类"] = "detect/montage.png";

  // 2. Name from the library, then let the caller's own names win.
  const lib = loadLibrary(libraryDir);
  const auto = nameTiles(found.tiles, lib);
  fs.writeFileSync(path.join(out, "types.auto.json"), JSON.stringify(
    Object.fromEntries(auto.named.filter((t) => t.auto_type).map((t) => [`${t.x},${t.y}`, t.auto_type])), null, 1));
  const merged = {};
  let overridden = 0;
  for (const t of auto.named) {
    const key = `${t.x},${t.y}`;
    if (types[key]) { merged[key] = types[key]; if (t.auto_type && t.auto_type !== types[key]) overridden++; }
    else if (t.auto_type) merged[key] = t.auto_type;
  }
  fs.writeFileSync(path.join(out, "types.json"), JSON.stringify(merged, null, 1));
  artifacts["自动命名"] = "types.auto.json";
  artifacts["最终类型"] = "types.json";

  // 3. Model and overlay.
  started = Date.now();
  const { model, overlay } = buildModel({
    detected: found, types: merged, config, png,
    meta: { game, level, captured: captured || new Date().toISOString(), source: path.basename(shot), piles },
  });
  fs.writeFileSync(path.join(out, "level.json"), JSON.stringify(model, null, 1));
  if (overlay) fs.writeFileSync(path.join(out, "overlay.png"), PNG.sync.write(overlay));
  durations.build = Date.now() - started;
  artifacts["关卡模型"] = "level.json";
  if (overlay) artifacts["检测叠加"] = "overlay.png";

  // 4. Playable page.
  started = Date.now();
  const page = writePlayable({ model, config, outFile: path.join(out, "playable", "index.html") });
  durations.playable = Date.now() - started;
  artifacts["可玩页"] = "playable/index.html";

  // 5. Picture of the result and a side-by-side, when a browser is reachable.
  if (!noBrowser) {
    started = Date.now();
    const clone = path.join(out, "clone.png");
    const shotResult = await shoot(path.join(out, "playable", "index.html"), clone);
    durations.screenshot = Date.now() - started;
    if (shotResult.ok) {
      artifacts["复刻截图"] = "clone.png";
      try {
        compose({
          original: copy, clone, outFile: path.join(out, "compare.png"),
          background: config.background, layout: page.layout,
        });
        artifacts["原图对比"] = "compare.png";
      } catch (e) {
        log(`compare skipped: ${e.message}`);
      }
    } else {
      log(`screenshot skipped: ${shotResult.reason}`);
    }
  }

  const checks = pickableMismatches(model);
  if (checks.wronglyPickable || checks.wronglyBlocked) {
    log(`warning: ${checks.wronglyPickable} tile(s) pickable that the capture shows covered, ${checks.wronglyBlocked} the other way round`);
  }
  const manifest = {
    tool: "board-extract",
    version: VERSION,
    ran_at: new Date().toISOString(),
    game, level,
    shot: path.relative(process.cwd(), copy),
    crop: rect,
    config: config.path ? path.relative(process.cwd(), config.path) : null,
    tiles: model.tiles.length,
    clickable: model.tiles.filter((t) => t.state === "clickable").length,
    piles: (model.piles || []).length,
    layers: model.layers || null,
    checks,
    types_overridden: overridden,
    auto: { matched: auto.matched, mean_confidence: auto.meanConfidence },
    library_templates: [...lib.values()].reduce((n, v) => n + v.length, 0),
    artifacts,
    durations_ms: durations,
  };
  writeReports(out, manifest, model);
  artifacts["运行清单"] = "run.json";
  artifacts["运行报告"] = "run.md";
  return { manifest, model, outDir: out };
}
