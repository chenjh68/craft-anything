// The Android path without a phone: a fake adb answers the calls capture makes, and the picture it
// "pulls" is a real capture, so the whole chain (capture -> detect) is exercised here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import { capture, listDevices } from "../src/capture.mjs";
import { detect } from "../src/detect.mjs";
import { loadConfig } from "../src/config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "board.png");

// A fake adb: it answers `devices`, `shell wm size`, `shell screencap`, `pull` and `shell rm`, and
// records every call so a test can check the order. Any answer can be broken on purpose.
function fakeAdb({ devices = ["emulator-5554\tdevice"], png = FIXTURE, screen = "Physical size: 1330x1450", corrupt = false } = {}) {
  const calls = [];
  const run = (_adb, args) => {
    calls.push(args.join(" "));
    if (args[0] === "devices") return ["List of devices attached", ...devices, ""].join("\n");
    if (args.includes("wm")) return screen;
    if (args.includes("screencap")) return "";
    if (args.includes("pull")) {
      const target = args[args.length - 1];
      if (corrupt) fs.writeFileSync(target, "definitely not a png");
      else fs.copyFileSync(png, target);
      return "";
    }
    return "";
  };
  return { run, calls };
}

function workdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "board-extract-capture-test-"));
}

test("a device is captured and the picture is a board detection can read", () => {
  const dir = workdir();
  try {
    const out = path.join(dir, "shot.png");
    const { run, calls } = fakeAdb();
    const result = capture({ out, adb: "mock-adb", run });

    assert.equal(result.ok, true, result.reason);
    assert.equal(result.device, "emulator-5554");
    assert.equal(result.screen, "1330x1450");
    assert.ok(fs.existsSync(out));

    // The picture is written on the device and pulled as a file: exec-out would corrupt it on Windows.
    assert.ok(calls.some((c) => c.includes("shell screencap -p")), calls.join(" | "));
    assert.ok(calls.some((c) => c.includes("pull")), calls.join(" | "));
    assert.ok(calls.every((c) => !c.includes("exec-out")), "never uses exec-out");

    const found = detect(PNG.sync.read(fs.readFileSync(out)), loadConfig());
    assert.equal(found.tiles.length, 38, "the pulled capture detects the same 38 tiles as the fixture");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an emulator serial is picked when more than one device is attached", () => {
  const dir = workdir();
  try {
    const { run } = fakeAdb({ devices: ["R58M12345\tdevice", "emulator-5554\tdevice"] });
    assert.equal(listDevices("mock-adb", run).length, 2);
    const result = capture({ out: path.join(dir, "shot.png"), serial: "emulator-5554", adb: "mock-adb", run });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.device, "emulator-5554");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no device, an unauthorised device and an unknown serial each say what is wrong", () => {
  const dir = workdir();
  try {
    const out = path.join(dir, "shot.png");

    const none = capture({ out, adb: "mock-adb", run: fakeAdb({ devices: [] }).run });
    assert.equal(none.ok, false);
    assert.match(none.reason, /no device/);
    assert.match(none.reason, /adb connect/);

    const denied = capture({ out, adb: "mock-adb", run: fakeAdb({ devices: ["abc123\tunauthorized"] }).run });
    assert.equal(denied.ok, false);
    assert.match(denied.reason, /not ready/);
    assert.match(denied.reason, /abc123/);

    const wrongSerial = capture({ out, serial: "nope", adb: "mock-adb", run: fakeAdb().run });
    assert.equal(wrongSerial.ok, false);
    assert.match(wrongSerial.reason, /no ready device with serial nope/);
    assert.ok(!fs.existsSync(out), "nothing was written");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupted transfer is refused instead of decoded", () => {
  const dir = workdir();
  try {
    const out = path.join(dir, "shot.png");
    const result = capture({ out, adb: "mock-adb", run: fakeAdb({ corrupt: true }).run });
    assert.equal(result.ok, false);
    assert.match(result.reason, /not a PNG/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
