// How many of the tray's slots hold a tile, from a full-screen capture.
import { PNG } from "pngjs";

export function readSlots(png, config) {
  const tray = config.tray;
  const px = (x, y) => { const i = (y * png.width + x) << 2; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
  const stats = (x0, y0, w, h) => {
    let n = 0, sum = [0, 0, 0], sum2 = 0;
    const colors = new Set();
    for (let y = y0; y < y0 + h; y += 2) {
      for (let x = x0; x < x0 + w; x += 2) {
        const [r, g, b] = px(x, y);
        n++;
        sum[0] += r; sum[1] += g; sum[2] += b;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        sum2 += lum * lum;
        colors.add((r >> 4) << 8 | (g >> 4) << 4 | (b >> 4));
      }
    }
    const mean = sum.map((v) => Math.round(v / n));
    const lum = 0.299 * mean[0] + 0.587 * mean[1] + 0.114 * mean[2];
    return { mean, lum: Math.round(lum), sd: Math.round(Math.sqrt(Math.max(0, sum2 / n - lum * lum))), colors: colors.size };
  };

  const cellW = tray.w / config.slots;
  const rows = [];
  for (let i = 0; i < config.slots; i++) {
    const s = stats(Math.round(tray.x + i * cellW), tray.y, Math.round(cellW), tray.h);
    // An empty tray is flat brown: sd 11-14 and a handful of colours.
    rows.push({ slot: i + 1, filled: s.sd > 26 || s.colors > 40 || s.lum > 120, ...s });
  }
  return { filled: rows.filter((r) => r.filled).length, rows };
}

export function slotsMontage(png, config, cell = 200) {
  const tray = config.tray;
  const cellW = tray.w / config.slots;
  const m = new PNG({ width: cell * config.slots, height: cell });
  m.data.fill(255);
  for (let i = 0; i < config.slots; i++) {
    const x0 = Math.round(tray.x + i * cellW);
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const sx = Math.min(png.width - 1, x0 + Math.round((x / cell) * cellW));
        const sy = Math.min(png.height - 1, tray.y + Math.round((y / cell) * tray.h));
        const s = (sy * png.width + sx) << 2;
        const d = (y * m.width + i * cell + x) << 2;
        m.data[d] = png.data[s]; m.data[d + 1] = png.data[s + 1]; m.data[d + 2] = png.data[s + 2]; m.data[d + 3] = 255;
      }
    }
  }
  return m;
}
