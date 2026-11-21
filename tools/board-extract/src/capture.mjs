// Take the board picture straight off an Android phone, or off an emulator: adb screencap writes the
// picture on the device, adb pull brings it back.
//
// `adb exec-out screencap -p` looks simpler but Windows line-ending translation corrupts the PNG,
// so the picture is written on the device first and pulled as a file.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WIN = process.platform === "win32";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The default way to run a command: capture stdout, never open a window. Swap it out in tests. */
export function defaultRun(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Where adb tends to be, in the order worth trying. platform-tools comes before scrcpy's bundled
// copy on purpose: two adb versions share one server port and then answer `devices` inconsistently.
function candidates() {
  const out = [process.env.ADB_PATH];
  const local = process.env.LOCALAPPDATA;

  if (local) {
    out.push(path.join(local, "Android", "Sdk", "platform-tools", WIN ? "adb.exe" : "adb"));
    const pkg = path.join(local, "Microsoft", "WinGet", "Packages");
    if (fs.existsSync(pkg)) {
      const entries = fs.readdirSync(pkg);
      // 1. platform-tools, wherever WinGet put it.
      for (const entry of entries.filter((e) => /^Google\.PlatformTools/i.test(e))) {
        out.push(path.join(pkg, entry, "platform-tools", WIN ? "adb.exe" : "adb"));
      }
      // 2. scrcpy's own copy, only as a fallback.
      for (const entry of entries.filter((e) => /^Genymobile\.scrcpy/i.test(e))) {
        const root = path.join(pkg, entry);
        for (const sub of fs.existsSync(root) ? fs.readdirSync(root) : []) {
          out.push(path.join(root, sub, WIN ? "adb.exe" : "adb"));
        }
      }
    }
  }
  out.push(WIN ? "adb.exe" : "adb");
  return [...new Set(out.filter(Boolean))];
}

export function findAdb(run = defaultRun) {
  for (const candidate of candidates()) {
    try {
      run(candidate, ["version"]);
      return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

/** Connected devices as [{ serial, state }]. */
export function listDevices(adb = findAdb(), run = defaultRun) {
  if (!adb) return [];
  return run(adb, ["devices"])
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    });
}

// A blocking pause without pulling in a dependency: capture() stays synchronous.
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function serialArgs(serial) {
  return serial ? ["-s", serial] : [];
}

/** The PNG's own size, read from its IHDR chunk: a game that rotates the screen differs from `wm size`. */
function pngSize(file) {
  try {
    const head = fs.readFileSync(file).subarray(0, 24);
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/** "1080x2400" from `wm size` (an override wins: that's the resolution the game renders at). */
function screenSize(adb, serial, run) {
  try {
    const out = run(adb, [...serialArgs(serial), "shell", "wm", "size"]);
    const over = /Override size:\s*(\d+x\d+)/.exec(out);
    const physical = /Physical size:\s*(\d+x\d+)/.exec(out);
    return (over || physical)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Pull a screenshot into `out`.
 * @param {object} options
 * @param {string} options.out              where to save the PNG
 * @param {string} [options.serial]         which device, when more than one is attached
 * @param {string|null} [options.adb]       adb to use (default: found on PATH, WinGet or the SDK)
 * @param {(cmd: string, args: string[]) => string} [options.run]  how to run it (tests inject a fake)
 * @returns {{ ok: true, out: string, bytes: number, device: string, screen: string|null }
 *          | { ok: false, reason: string }}
 */
export function capture({ out, serial, adb = findAdb(), run = defaultRun } = {}) {
  if (!out) return { ok: false, reason: "no output path given" };
  if (!adb) {
    return {
      ok: false,
      reason: WIN
        ? "adb not found; install it with: winget install Google.PlatformTools (or set ADB_PATH)"
        : "adb not found; install platform-tools (or set ADB_PATH)",
    };
  }

  // Make sure the server is up before asking: a daemon that has just been restarted (another adb
  // version having held the port) answers `devices` with nothing on the first call.
  try { run(adb, ["start-server"]); } catch { /* an old adb may complain; devices still works */ }
  let all = listDevices(adb, run);
  if (all.length === 0) {
    pause(400);
    all = listDevices(adb, run);
  }
  const ready = all.filter((d) => d.state === "device");
  if (ready.length === 0) {
    const why = all.length
      ? `device not ready: ${all.map((d) => `${d.serial} (${d.state})`).join(", ")} (authorise the USB debugging prompt)`
      : "no device: plug the phone in with USB debugging on, start an emulator, or run adb connect <ip:5555>";
    return { ok: false, reason: why };
  }
  if (serial && !ready.some((d) => d.serial === serial)) {
    return { ok: false, reason: `no ready device with serial ${serial}; have ${ready.map((d) => d.serial).join(", ")}` };
  }
  const picked = serial || ready[0].serial;

  const remote = "/sdcard/board-extract-shot.png";
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "board-extract-pull-"));
  const pulled = path.join(tmpdir, "shot.png");
  try {
    run(adb, [...serialArgs(picked), "shell", "screencap", "-p", remote]);
    run(adb, [...serialArgs(picked), "pull", remote, pulled]);
    try { run(adb, [...serialArgs(picked), "shell", "rm", "-f", remote]); } catch { /* leaving it is harmless */ }

    if (!fs.existsSync(pulled)) return { ok: false, reason: `adb pull did not produce ${pulled}` };
    // A pulled PNG starts with its signature; anything else means the transfer mangled it.
    if (!fs.readFileSync(pulled).subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      return { ok: false, reason: "the pulled file is not a PNG (the transfer was corrupted)" };
    }
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.copyFileSync(pulled, out);
    return {
      ok: true,
      out,
      bytes: fs.statSync(out).size,
      device: picked,
      screen: screenSize(adb, picked, run),
      // A landscape game on a portrait device: the picture is not the screen the device reports.
      picture: pngSize(out),
    };
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}
