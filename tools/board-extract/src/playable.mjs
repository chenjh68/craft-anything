// Write the playable page and the band the board occupies (so a comparison can ignore the
// title line and the tray).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, "..", "assets", "playable-template.html");
const PAGE_WIDTH = 720;
const TOP = 56;
// Space under the board for the slot tray: 108 px slots, their frame, and a little air.
const TRAY = 170;

export function writePlayable({ model, config, outFile }) {
  const template = fs.readFileSync(TEMPLATE, "utf8");
  const boardWidth = config.boardWidth || 1330;
  const scale = PAGE_WIDTH / boardWidth;

  let bottom = TOP;
  for (const t of model.tiles) bottom = Math.max(bottom, t.y * scale + TOP + t.h * scale);
  for (const p of model.piles || []) bottom = Math.max(bottom, p.y * scale + TOP + (config.tile[1] * scale));

  // The page is as tall as this board needs, so a phone-sized board doesn't get a desktop page.
  const height = Math.max(640, Math.round(bottom + TRAY));
  const view = { scale, top: TOP, boardWidth, width: PAGE_WIDTH, height, background: config.background, face: config.face, dim: config.dim };

  const injected = `<script>window.LEVEL = ${JSON.stringify(model)};window.ICONS = ${JSON.stringify(config.icons)};window.VIEW = ${JSON.stringify(view)};</script>`;
  const html = template.replace("<!--LEVEL-->", injected);

  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, html);

  const layout = { top: TOP, bottom: Math.round(bottom) };
  fs.writeFileSync(path.join(path.dirname(path.resolve(outFile)), "layout.json"), JSON.stringify(layout));
  return { bytes: html.length, layout };
}
