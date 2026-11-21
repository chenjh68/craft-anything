// Screenshot the playable page with the Chrome or Edge already on this machine. Optional: when no
// browser or no playwright-core is available the run carries on without a picture.
import fs from "node:fs";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

export async function shoot(pageFile, outFile) {
  const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
  if (!executablePath) return { ok: false, reason: "no Chrome or Edge found (set CHROME_PATH)" };
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    return { ok: false, reason: "playwright-core is not installed (npm i -D playwright-core)" };
  }
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const tab = await browser.newPage({ viewport: { width: 760, height: 1040 }, deviceScaleFactor: 1 });
    const errors = [];
    tab.on("pageerror", (e) => errors.push(String(e)));
    await tab.goto("file://" + pageFile.replace(/\\/g, "/"));
    await tab.waitForTimeout(400);
    await tab.locator("canvas").screenshot({ path: outFile });
    return { ok: true, errors };
  } finally {
    await browser.close();
  }
}
