# board-extract

A captured stacked-tile board (羊了个羊 style) in, a **level model** out: every tile's position,
whether it can be picked, which tile covers which, its icon — plus a playable page and a
side-by-side comparison with the original.

Node 18+, one runtime dependency (`pngjs`). `playwright-core` is optional and only used for the
screenshot/comparison step.

```bash
npm install                 # pngjs
npm install -D playwright-core   # optional: screenshots + comparison
```

## Quick start

```bash
# Capture the board (any screenshot tool), then:
node bin/board-extract.mjs run --shot board.png --out runs/sheep/2026-11-21 \
  --game "羊了个羊：星球" --level "每日关卡" --types types.json --piles piles.json
```

That writes a run folder and prints what it made:

```
tiles=38 clickable=19 auto=38/38
  detect/tiles.json  检测结果
  ...
  compare.png        原图对比
```

## Commands

| command | what it does |
|---|---|
| `run` | the whole pipeline: detect → name → model → playable → screenshot + comparison → report |
| `check` | detect only, prints tile count, clickable count, clusters, face sizes (fast sanity check) |
| `learn` | add the tiles of a checked run to the icon template library |
| `eval` | leave-one-out accuracy of the library on one run |
| `slots` | how many of the tray's slots hold a tile, from a full-screen capture |
| `capture` | take the screenshot off an Android phone over adb |
| `probe` | propose a config (face, covered shade, face size, backdrop) for a screen nobody described |
| `init` | write a `board-extract.config.json` with the defaults, to edit per game |

`--help` prints every flag; exit codes are 0 ok, 1 failure, 2 usage.

## From an Android phone

```bash
node bin/board-extract.mjs capture --out shots/phone.png     # adb screencap + pull
node bin/board-extract.mjs run --shot shots/phone.png --out runs/x/2026-11-21
```

`capture` finds adb on PATH, in a WinGet install or in the Android SDK (or takes `--adb <path>`),
picks the only attached device (or the one named by `--serial`), and prints the screen size next to
the file it saved. It writes the picture on the device and pulls it as a file: `adb exec-out
screencap` corrupts PNGs on Windows through line-ending translation.

The playable page is built for a phone as much as for a desktop window: the canvas keeps its
logical coordinates and scales to the viewport width, the tray is sized so it never crosses the
canvas edges, taps arrive as `pointerdown` with `touch-action: none` (no scroll, no double-tap
zoom), and an on-screen 撤回 button stands in for the `Z` key.

```bash
adb shell input tap 540 1200        # optional: drive the original while you inspect it
scrcpy                              # optional: the phone's screen on the desktop
```

### An emulator works the same way

Android Studio's AVDs show up in `adb devices` on their own. Most third-party emulators expose adb
over TCP, so one `adb connect` is enough — and the port is the only thing that changes:

```bash
adb connect 127.0.0.1:5555      # BlueStacks, LDPlayer, many others
adb connect 127.0.0.1:7555      # MuMu (newer builds use 16384)
adb connect 127.0.0.1:62001     # Nox
adb devices                     # the emulator now appears as <ip>:<port>
```

Those ports are the usual defaults, not a rule: whatever the emulator's settings panel shows wins.
Set the emulator to a portrait phone profile (1080×1920 or 720×1280) and run the game full-screen,
so the capture looks like the phone build rather than a resizable desktop window.

### A full-screen capture is more than the board

`detect` reads every face it can find, and a phone screenshot also holds the title bar, the tray,
the buttons and whatever the OS draws. Point at the board instead of trusting the whole picture:

```bash
board-extract check --shot shots/phone.png --crop 0,320,1080,1200   # x,y,w,h
board-extract run   --shot shots/phone.png --crop 0,320,1080,1200 --out runs/x/2026-11-21
```

The cropped region is what gets saved as `shot.png` and what every coordinate in `level.json`
refers to; `run.json` records the rectangle as `crop`. `--crop` refuses to run when the rectangle
does not fit the picture, rather than silently clamping.

`--crop` also sets the page scale: the playable page is built against the crop's width, so a phone
board fills it without a hand-written config. A `boardWidth` in a config file still wins.

### A smaller screen means smaller faces

Every size filter is a ratio of one face, so the same board at another resolution needs to be told
which face size it is looking at — one flag, and the filters follow:

```bash
board-extract check --shot shots/phone.png --tile 36x37
```

You do not have to guess. When the faces found do not match `tile` (or only a few pass at all), the
tool says what it saw instead of reporting a quiet half-result:

```
hint: the faces here look different: about 64x66 against tile 128x130 — pass --tile 64x66
```

Following that advice recovers the whole board: on the reference capture scaled to 1/2, 1/3 and 1/4,
detection goes from 28, 1 and 0 faces to 38 faces with 19 clickable in every case
(`test/scale.test.mjs` keeps it that way). A config file that names `minSide`/`minArea` itself keeps
them; otherwise they are derived from `tile` (`128x130` gives the tuned `40` / `1200`).

### A game nobody has described yet

`probe` reads the picture and proposes the numbers a config needs:

```bash
board-extract probe --shot shots/hero.png --crop 110,320,660,400 --out config.json
```

```
picture 660x400
best   face 40,40,40  dim 32,32,32  tile 186x156  slots 7
  face 40,40,40    tiles   7  size 186x156  share 0.67  score 3.96
  face 32,32,32    tiles   9  size 174x144  share 0.5   score 3.9
note   confirm on a second capture before trusting it
```

It only proposes a colour that sits *inside* the shapes it forms, only when those shapes are the
bright ones (a shadow would invert the z-order), and only when one face covers 0.3–12% of the
picture. `--out config.json` writes the proposal in the shape `--config` takes, so the next command
is `run`. Run it, then look at `overlay.png`: that is the step that catches a plausible-looking
wrong answer.

### A different game means different colours

`check` also reports what the picture is made of, and how much of it the configured face and dim
colours actually cover:

```json
"palette": { "top": [[240,248,200,160327], [144,152,120,110231], ...], "face_pixels": 160327, "dim_pixels": 110231 }
```

When under 2% of the pixels match, the tool says so and points at the palette instead of leaving you
with "0 tiles": copy a `palette.top` value into `face` (and its darkened form, `face × 0.6`, into
`dim`) in a `board-extract.config.json` next to the capture. `board-extract init` writes a starting
file.

Run it from anywhere: `node <path>/bin/board-extract.mjs …`, or `npm link` once and then just
`board-extract …`.

## The run folder

```
runs/<slug>/<date>/
  shot.png               the capture, copied in
  detect/tiles.json      every face: x, y, w, h, bright, cluster, signature
  detect/montage.png     one representative crop per icon cluster (name them here)
  types.auto.json        what the library named
  types.json             the final names (your --types win over the library)
  level.json             the model: tiles with z, piles, counts, confidence
  overlay.png            green = clickable, orange = covered: check the boxes before trusting it
  playable/index.html    self-contained page: tap, match three, 7 slots, undo (button or Z)
  playable/layout.json   the band the board occupies
  clone.png              screenshot of the page (when a browser is available)
  compare.png            original beside the rebuild, both trimmed to the board
  run.json               manifest: inputs, counts, timings, artifacts
  run.md                 the same for a person
```

## Naming tiles: the template library

`library/<type>.json` holds signatures (12×12 RGB from the inner face), so the second level of the
same game needs little or no hand naming.

```bash
node bin/board-extract.mjs learn --tiles runs/sheep/2026-11-21/detect/tiles.json \
                                 --types runs/sheep/2026-11-21/types.json --library library
node bin/board-extract.mjs eval  --tiles … --types …
```

Measured on 羊了个羊 (38 tiles, leave-one-out): **29 named (76%), 0 wrong**; among fully visible
tiles **27/28 (96%)**. Tiles that only peek out from under another are left unknown rather than
guessed — check them on the montage.

## Which tile covers which

A tile's 2 px outline is broken wherever another tile lies over it. For each overlapping pair the
border is sampled inside the neighbour's rectangle: outline present = on top. Pairs that stay
ambiguous fall back on the bright/dim flag. The result is checked against the capture: the set of
pickable tiles matches the bright tiles **38/38**.

`z` is 1 at the bottom; the page blocks a tile when anything with a higher `z` overlaps it by more
than 5% of a face (real stacks overlap by only 12–14 px).

## Per-game config

`node bin/board-extract.mjs init` writes `board-extract.config.json`:

| key | meaning |
|---|---|
| `face`, `dim` | the two face colours (covered = face × `dimFactor`, default 0.6) |
| `tile` | a full face size in pixels |
| `slots`, `tray` | slot count and the tray rectangle in the capture |
| `icons` | emoji stand-ins per type name, used by the playable page |
| `background` | the grass colour, used when trimming the comparison |
| `boardWidth` | capture width, mapped onto the 720 px page |

A game with a different palette or slot count is a config file, not a code change.

## Limits

- **Encrypted packages are out of scope**: this reads screenshots, never `.wxapkg` contents.
- **Side stacks** (tiles shown edge-on) have to be described once per level: `--piles` with
  `{x, y, including_top, top}`. Their hidden types are unknown.
- **Covered tiles are restored, not observed**: the whole rectangle is anchored under the tile it
  peeks from, which can be off by a few pixels.
- **Icons are emoji stand-ins**, never the original art.
- **One capture, one state**: capture before the first move; a started board changes the tray.

## CI

`npm run ci` runs the whole thing against a real capture and fails when a property breaks:

```
ok   npm test (4 passing)
ok   check: tiles (38)
ok   check: clickable (19)
ok   check: clusters (29)
ok   check: most faces near 128x130 (27/28)
ok   run: tiles (38)
ok   run: piles (2)
ok   run: every tile has a z
ok   run: every tile named
ok   run: layer evidence (25/28)
ok   run: pickable set matches the capture (0 too many, 0 too few)
ok   run: level.json / overlay.png / playable/index.html / run.json / run.md
all checks passed
```

The last model check is the important one: a change that breaks detection, restoration or layering
usually shows up as tiles that are pickable although the capture shows them covered.

Fixtures live in `test/fixtures/` (one capture, its names and its side stacks). `--no-browser`
keeps CI independent of Chrome. `.github/workflows/board-extract.yml` runs the same command when
the repository has a remote; until then `npm run ci` locally is the gate.

## Use it from another project

```bash
npm i ../../tools/board-extract          # from a sibling package
# or, once the repository has a remote:
npm i git+ssh://git@host/org/repo.git#path:tools/board-extract
```

```js
import { runPipeline } from "board-extract";
const { manifest } = await runPipeline({ shot, outDir, config, types, piles, noBrowser: true });
```

## Publishing to a private registry

The package is `"private": true` on purpose. To publish:

1. add a scope: `"name": "@yourorg/board-extract"`
2. drop `"private": true`
3. `npm publish --registry https://your.registry/`

`files` limits the tarball to `bin/`, `src/`, `assets/`, `README.md` and `CHANGELOG.md`; the
template library, fixtures and tests stay in the repository.

What changed between versions: [CHANGELOG.md](CHANGELOG.md).
