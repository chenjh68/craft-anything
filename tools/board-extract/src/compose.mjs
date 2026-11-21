// Side-by-side of the capture and the recreated board, both trimmed to their content and scaled
// into equal panels.
import fs from "node:fs";
import { PNG } from "pngjs";

const PANEL_W = 720;
const PANEL_H = 800;
const GAP = 12;

export function compose({ original, clone, outFile, background, layout }) {
  const orig = PNG.sync.read(fs.readFileSync(original));
  const repl = PNG.sync.read(fs.readFileSync(clone));
  const out = new PNG({ width: PANEL_W * 2 + GAP, height: PANEL_H });
  out.data.fill(255);

  const box = (img, band) => {
    let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
    for (let y = band ? band.top : 0; y < (band ? band.bottom : img.height); y += 2) {
      for (let x = 0; x < img.width; x += 2) {
        const i = (y * img.width + x) << 2;
        const bg = Math.abs(img.data[i] - background[0]) < 16
          && Math.abs(img.data[i + 1] - background[1]) < 12
          && Math.abs(img.data[i + 2] - background[2]) < 18;
        if (bg) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return { x: 0, y: band ? band.top : 0, w: img.width, h: (band ? band.bottom : img.height) - (band ? band.top : 0) };
    const pad = 8;
    const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad);
    const x1 = Math.min(img.width, maxX + pad), y1 = Math.min(img.height, maxY + pad);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  const blit = (img, b, dx) => {
    const scale = Math.min(PANEL_W / b.w, PANEL_H / b.h);
    const dw = Math.round(b.w * scale), dh = Math.round(b.h * scale);
    const ox = dx + Math.round((PANEL_W - dw) / 2), oy = Math.round((PANEL_H - dh) / 2);
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(img.width - 1, b.x + Math.round(x / scale));
        const sy = Math.min(img.height - 1, b.y + Math.round(y / scale));
        const s = (sy * img.width + sx) << 2;
        const d = ((oy + y) * out.width + ox + x) << 2;
        out.data[d] = img.data[s];
        out.data[d + 1] = img.data[s + 1];
        out.data[d + 2] = img.data[s + 2];
        out.data[d + 3] = 255;
      }
    }
  };

  blit(orig, box(orig, null), 0);
  let cloneBox = box(repl, layout);
  if (layout) {
    cloneBox = {
      x: cloneBox.x,
      y: Math.max(cloneBox.y, layout.top),
      w: cloneBox.w,
      h: Math.max(1, Math.min(cloneBox.y + cloneBox.h, layout.bottom) - Math.max(cloneBox.y, layout.top)),
    };
  }
  blit(repl, cloneBox, PANEL_W + GAP);
  fs.writeFileSync(outFile, PNG.sync.write(out));
  return outFile;
}
