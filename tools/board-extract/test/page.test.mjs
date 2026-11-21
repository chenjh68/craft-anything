// The playable page in a real browser: it has to fit a phone screen, keep its tray inside the
// canvas, and take a finger tap. Skipped when there is no browser, so a headless CI still passes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPipeline } from "../src/pipeline.mjs";
import { loadConfig } from "../src/config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean).find((p) => fs.existsSync(p));

let chromium = null;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  // optional dependency
}

const skip = !CHROME
  ? "no Chrome or Edge found (set CHROME_PATH)"
  : !chromium
    ? "playwright-core is not installed (npm i -D playwright-core)"
    : false;

test("the page fits a phone screen and takes a tap", { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-extract-page-"));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    await runPipeline({
      shot: path.join(FIXTURES, "board.png"),
      outDir: dir,
      config: loadConfig(),
      types: JSON.parse(fs.readFileSync(path.join(FIXTURES, "types.json"), "utf8")),
      piles: JSON.parse(fs.readFileSync(path.join(FIXTURES, "piles.json"), "utf8")),
      noBrowser: true,
    });

    const page = path.join(dir, "playable", "index.html");
    const tab = await browser.newPage({
      viewport: { width: 390, height: 844 }, // a portrait phone, not a desktop window
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });
    const errors = [];
    tab.on("pageerror", (e) => errors.push(String(e)));
    await tab.goto("file://" + page.replace(/\\/g, "/"));
    await tab.waitForTimeout(250);

    // 1. It fits the screen instead of overflowing it.
    const box = await tab.locator("canvas").boundingBox();
    assert.ok(box.width <= 390.5, `canvas is ${box.width}px wide inside a 390px viewport`);

    // 2. The tray is inside the canvas, which is what a desktop-width tray gets wrong.
    const size = await tab.evaluate(() => window.__board.size);
    const tray = await tab.evaluate(() => window.__board.tray());
    assert.ok(tray.left >= 0, `tray starts at ${tray.left}, outside the canvas`);
    assert.ok(tray.right <= size.w, `tray ends at ${tray.right}, past the ${size.w}px canvas`);

    // 3. A finger tap puts a tile in the tray, and the on-screen undo takes it back.
    const before = await tab.evaluate(() => window.__board.state());
    const spot = (await tab.evaluate(() => window.__board.clickable()))[0];
    assert.ok(spot, "the fixture board has a clickable tile");
    await tab.touchscreen.tap(
      box.x + (spot.x * box.width) / size.w,
      box.y + (spot.y * box.height) / size.h,
    );
    const after = await tab.evaluate(() => window.__board.state());
    assert.equal(after.slots, before.slots + 1, "a tap fills one slot");

    await tab.locator("#undo").click();
    const undone = await tab.evaluate(() => window.__board.state());
    assert.equal(undone.slots, before.slots, "the undo button takes it back");

    assert.deepEqual(errors, [], "the page runs without errors");
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
