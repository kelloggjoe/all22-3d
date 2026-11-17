// (ALL-22 PRO font.js, unchanged: the stadium's pixel lettering)
// Bitmap pixel fonts (5×7 for text, 3×5 for jersey numbers). Every glyph is drawn with whole-pixel
// fillRects or direct pixel writes, so in-world text sits on the same pixel grid as the sprites (§6.0).
const G = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31],
  3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 2, 12],
  "!": [4, 4, 4, 4, 4, 0, 4], "?": [14, 17, 1, 2, 4, 0, 4], ".": [0, 0, 0, 0, 0, 12, 12],
  "-": [0, 0, 0, 14, 0, 0, 0], ":": [0, 12, 12, 0, 12, 12, 0], "'": [4, 4, 8, 0, 0, 0, 0],
  "&": [12, 18, 20, 8, 21, 18, 13], "/": [1, 1, 2, 4, 8, 16, 16], "+": [0, 4, 4, 31, 4, 4, 0],
  "#": [10, 10, 31, 10, 31, 10, 10], "%": [24, 25, 2, 4, 8, 19, 3], "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8], ",": [0, 0, 0, 0, 12, 4, 8], " ": [0, 0, 0, 0, 0, 0, 0],
  "<": [2, 4, 8, 16, 8, 4, 2], ">": [8, 4, 2, 1, 2, 4, 8],
  // broadcast glyphs (replay timecode, REC dot, stars)
  "▶": [8, 12, 14, 15, 14, 12, 8], "◀": [2, 6, 14, 30, 14, 6, 2], "●": [0, 14, 31, 31, 31, 14, 0],
  "*": [0, 21, 14, 31, 14, 21, 0], "=": [0, 0, 31, 0, 31, 0, 0], "_": [0, 0, 0, 0, 0, 0, 31], "·": [0, 0, 0, 4, 0, 0, 0], "■": [0, 31, 31, 31, 31, 31, 0],
  // a PlayStation pad's face buttons (cross, circle, square, triangle: the pass icons over the receivers) and a few
  // more keys a receiver can be bound to
  "\u2715": [0, 17, 10, 4, 10, 17, 0], "\u25cb": [0, 14, 17, 17, 17, 14, 0], "\u25a1": [0, 31, 17, 17, 17, 31, 0], "\u25b3": [0, 4, 10, 10, 17, 31, 0],
  ";": [0, 12, 12, 0, 12, 4, 8], "[": [14, 8, 8, 8, 8, 8, 14], "]": [14, 2, 2, 2, 2, 2, 14], "\\": [16, 16, 8, 4, 2, 1, 1], "`": [8, 4, 0, 0, 0, 0, 0],
};
const D3 = [[7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 2, 2], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7]];

const norm = (ch) => {
  const c = ch.toUpperCase();
  if (G[c]) return G[c];
  if ("ÉÈÊ".includes(c)) return G.E;
  if (c === "♀" || c === "♂") return G["+"];
  return G[" "];
};

export const textWidth = (text, scale = 1) => (text.length ? text.length * 6 - 1 : 0) * scale;

// Draw onto a 2D context with whole-pixel rects.
export function drawText(ctx, text, x, y, scale, color) {
  ctx.fillStyle = color;
  x = Math.round(x); y = Math.round(y);
  for (let i = 0; i < text.length; i++) {
    const g = norm(text[i]);
    for (let r = 0; r < 7; r++) {
      const bits = g[r];
      if (!bits) continue;
      for (let c = 0; c < 5; c++) if (bits & (16 >> c)) ctx.fillRect(x + (i * 6 + c) * scale, y + r * scale, scale, scale);
    }
  }
}

// Plot into a Uint32 pixel array. rot: 0 = upright, 1 = rotated 90° clockwise, 3 = 90° counter-clockwise, 2 = 180°.
export function plotText(px, w, h, text, x, y, scale, color, rot = 0) {
  const tw = textWidth(text, 1);
  for (let i = 0; i < text.length; i++) {
    const g = norm(text[i]);
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (!(g[r] & (16 >> c))) continue;
        let gx = i * 6 + c, gy = r;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
          let lx = gx * scale + sx, ly = gy * scale + sy, X, Y;
          if (rot === 0) { X = x + lx; Y = y + ly; }
          else if (rot === 2) { X = x + (tw * scale - 1 - lx); Y = y + (7 * scale - 1 - ly); }
          else if (rot === 1) { X = x + (7 * scale - 1 - ly); Y = y + lx; }
          else { X = x + ly; Y = y + (tw * scale - 1 - lx); }
          if (X >= 0 && Y >= 0 && X < w && Y < h) px[Y * w + X] = color;
        }
      }
    }
  }
}

// Outlined text on its own canvas (banners, jumbotron, labels). Returns the canvas.
export function textCanvas(text, scale, fill, outline = "#0b0d1a", shadow = null) {
  const pad = scale * 2;
  const c = document.createElement("canvas");
  c.width = textWidth(text, scale) + pad * 2 + (shadow ? scale : 0);
  c.height = 7 * scale + pad * 2 + (shadow ? scale : 0);
  const g = c.getContext("2d");
  if (shadow) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) drawText(g, text, pad + dx * scale + scale, pad + dy * scale + scale, scale, shadow);
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) drawText(g, text, pad + dx * scale, pad + dy * scale, scale, outline);
  drawText(g, text, pad, pad, scale, fill);
  return c;
}

// ---------- styled 1× text (banners, pops, subtitles, replay labels) ----------
// Built once per (text, style) at 1 art pixel per unit and drawn at an INTEGER scale with drawImage (nearest
// neighbour), so every feature — the per-row color ramp, the outline, the extruded drop and the shine — scales by
// whole pixels and stays on the buffer grid (§6.0). bold: 6-px glyphs (each 5×7 column doubled to the right).
export const styledWidth = (text, bold = false) => (text.length ? text.length * (bold ? 7 : 6) - 1 : 0);
const hexToAbgr = (h) => {
  const v = parseInt(h.slice(1), 16);
  return (0xff000000 | ((v & 255) << 16) | (v & 0xff00) | ((v >> 16) & 255)) >>> 0;
};
// opts: { bold, ramp: [7 colors, glyph row 0..6] | color, outline: color|null, extrude: 0..3 rows, drop: color,
//         white: true → the letters solid white, outline/drop kept (slam flash frame / shine source) }
export function styledText(text, opts = {}) {
  const bold = Boolean(opts.bold), ext = opts.extrude == null ? 1 : opts.extrude;
  const ramp = Array.isArray(opts.ramp) ? opts.ramp : [opts.ramp || "#f4f4ec"];
  const outline = opts.outline === undefined ? "#0b0d1a" : opts.outline;
  const tw = styledWidth(text, bold), pad = outline ? 1 : 0;
  const w = tw + pad * 2, h = 7 + pad * 2 + ext;
  const m = new Uint8Array(w * h); // 1 glyph, 2 outline, 3 extrude
  const gw = bold ? 7 : 6;
  for (let i = 0; i < text.length; i++) {
    const gl = norm(text[i]);
    for (let r = 0; r < 7; r++) {
      let bits = gl[r];
      if (!bits) continue;
      if (bold) bits = (bits << 1) | bits; // 6 columns
      const cols = bold ? 6 : 5, top = bold ? 32 : 16;
      for (let c = 0; c < cols; c++) if (bits & (top >> c)) m[(pad + r) * w + pad + i * gw + c] = 1;
    }
  }
  if (outline) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (m[y * w + x] !== 1) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X >= 0 && Y >= 0 && X < w && Y < h && !m[Y * w + X]) m[Y * w + X] = 2;
      }
    }
  }
  // extrude: the glyph+outline shape pushed down `ext` rows (a chunky 16-bit title drop)
  for (let k = 1; k <= ext; k++) for (let y = h - 1; y >= k; y--) for (let x = 0; x < w; x++) {
    if (!m[y * w + x] && (m[(y - k) * w + x] === 1 || m[(y - k) * w + x] === 2)) m[y * w + x] = 3;
  }
  const c = document.createElement("canvas");
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const g = c.getContext("2d"), im = g.createImageData(c.width, c.height);
  const px = new Uint32Array(im.data.buffer);
  const white = hexToAbgr("#ffffff");
  const rampU = ramp.map(hexToAbgr), olU = outline ? hexToAbgr(outline) : 0, dropU = hexToAbgr(opts.drop || outline || "#0b0d1a");
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = m[y * w + x];
    if (!v) continue;
    if (v === 1 && opts.white) { px[y * w + x] = white; continue; }
    if (v === 1) { const row = y - pad; px[y * w + x] = rampU[Math.min(rampU.length - 1, Math.floor((row * rampU.length) / 7))]; }
    else px[y * w + x] = v === 2 ? olU : dropU;
  }
  g.putImageData(im, 0, 0);
  return c;
}

// 3×5 digits (jersey numbers) into a Uint8ClampedArray RGBA buffer.
export function plotDigits3x5(data, w, num, x, y, rgba) {
  const s = String(num);
  for (let i = 0; i < s.length; i++) {
    const g = D3[+s[i]] || D3[0];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (!(g[r] & (4 >> c))) continue;
      const o = ((y + r) * w + x + i * 4 + c) * 4;
      data[o] = rgba[0]; data[o + 1] = rgba[1]; data[o + 2] = rgba[2]; data[o + 3] = 255;
    }
  }
}
export const digitsWidth3 = (num) => String(num).length * 4 - 1;
