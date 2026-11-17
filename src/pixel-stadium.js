// ALL-22 PRO's pixel-art stadium, in 3D: the same field, stand, LED ribbon and sky art its Mode 7 renderer painted
// (mode7.js / render.js, ported here with the Pokémon pieces taken out: the home team's mark at midfield instead of the
// Poké Ball, game-day cheers on the ribbon, the score on the jumbotrons), laid on simple geometry with nearest-neighbour
// sampling so every texel stays a crisp pixel. Stadium coordinates (yards): X along the field, Y across, Z up.
import * as THREE from "three";
import { FIELD_W, MID_Y, HASH_L, HASH_R } from "./sim/config.js";
import { drawText, textWidth } from "./pixel-font.js";

export const TPY = 8; // field texels per yard
export const X0 = -16, X1 = 116, Y0 = -8, Y1 = FIELD_W + 8;
const TW = (X1 - X0) * TPY, TH = Math.round((Y1 - Y0) * TPY);
const WALL_H = 15;
const ST_W = 2048, ST_H = 128, ST_PY = ST_H / WALL_H, ST_PU = 8;
const PAD_TOP = 1.1, RIB_BOT = 1.1, RIB_TOP = 2.25;
const AD_W = 2048, AD_H = 11;
const TOWERS = [[-15, -7], [-15, FIELD_W + 7], [115, -7], [115, FIELD_W + 7], [50, -7.5], [50, FIELD_W + 7.5]];
const JUMBO_X = [123, -23];
// the ribbon's game-day cheers (no businesses or brands)
const CHEERS = [["MAKE SOME NOISE", "#e8413b", "#f4f4ee"], ["GAME DAY", "#3aa04a", "#f4f4ee"], ["DEFENSE!", "#8a3cb0", "#ffd23e"], ["FAN ZONE", "#1f6fd8", "#f4f4ee"]];
const SKY = { bands: ["#04051a", "#070922", "#0a0d2c", "#0e1236", "#131840", "#19204c", "#212a5a"], haze: "#2c3366", stars: 140 };

// ---------- colors (ABGR u32, as an ImageData's Uint32 view and a DataTexture's bytes read them) ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbHex = (r, g, b) => "#" + ((1 << 24) | (clamp(r | 0, 0, 255) << 16) | (clamp(g | 0, 0, 255) << 8) | clamp(b | 0, 0, 255)).toString(16).slice(1);
const u32 = (r, g, b, a = 255) => ((a << 24) | (clamp(b | 0, 0, 255) << 16) | (clamp(g | 0, 0, 255) << 8) | clamp(r | 0, 0, 255)) >>> 0;
const hexU32 = (h) => { const [r, g, b] = hexRgb(h); return u32(r, g, b); };
const shade = (h, k) => { const [r, g, b] = hexRgb(h); return rgbHex(r * k, g * k, b * k); };
const lum = (c) => (c & 0xff) * 0.3 + (c >>> 8 & 0xff) * 0.59 + (c >>> 16 & 0xff) * 0.11;
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
function contrastInk(bg, pref) {
  const lb = lum(hexU32(bg));
  if (pref && Math.abs(lum(hexU32(pref)) - lb) > 70) return pref;
  return lb > 140 ? "#14141c" : "#f4f4ee";
}
const GLYPHS = new Map();
function glyphBits(ch) {
  if (GLYPHS.has(ch)) return GLYPHS.get(ch);
  const c = document.createElement("canvas"); c.width = 6; c.height = 7;
  const g = c.getContext("2d"); drawText(g, ch, 0, 0, 1, "#fff");
  const d = g.getImageData(0, 0, 5, 7).data, bits = new Uint8Array(35);
  for (let i = 0; i < 35; i++) bits[i] = d[i * 4 + 3] > 128 ? 1 : 0;
  GLYPHS.set(ch, bits);
  return bits;
}
function plotGlyph(A, B, w, ch, x, y, col, hMax = 1e9) {
  const g = glyphBits(ch);
  for (let r = 0; r < 7; r++) {
    if (y + r >= hMax) break;
    for (let k = 0; k < 5; k++) if (g[r * 5 + k] && x + k >= 0 && x + k < w) { const i = (y + r) * w + x + k; A[i] = col; if (B) B[i] = col; }
  }
}
// a u32 pixel buffer → a crisp texture (row 0 = v 0)
function texture(px, w, h, wrap = false) {
  const t = new THREE.DataTexture(new Uint8Array(px.buffer, px.byteOffset, px.byteLength), w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  if (wrap) t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// ---------- the field (mode7.js build) ----------
function fieldPixels(home, away, kits) {
  const T = new Uint32Array(TW * TH);
  const rect = (xa, ya, xb, yb, c) => {
    const ta = Math.max(0, Math.floor((xa - X0) * TPY)), tb = Math.min(TW, Math.ceil((xb - X0) * TPY));
    const ua = Math.max(0, Math.floor((ya - Y0) * TPY)), ub = Math.min(TH, Math.ceil((yb - Y0) * TPY));
    for (let ty = ua; ty < ub; ty++) for (let tx = ta; tx < tb; tx++) T[ty * TW + tx] = c;
  };
  const homeColor = kits.home.jersey, awayColor = kits.away.jersey;
  const g1 = hexU32("#2d8a3c"), g2 = hexU32("#38994a"), gs1 = hexU32("#287f36"), gs2 = hexU32("#43a352");
  const apron = hexU32("#1f5e33"), apron2 = hexU32("#1b5530"), white = hexU32("#f1f1e6"), concrete = hexU32("#6c6f7c");
  for (let ty = 0; ty < TH; ty++) {
    const Y = Y0 + (ty + 0.5) / TPY, inY = Y >= 0 && Y <= FIELD_W;
    for (let tx = 0; tx < TW; tx++) { const X = X0 + (tx + 0.5) / TPY; T[ty * TW + tx] = inY && X >= -10 && X <= 110 ? (Math.floor((X + 10) / 5) & 1 ? g2 : g1) : apron; }
  }
  const ez = (xa, xb, col) => {
    const c1 = hexU32(col), c2 = hexU32(shade(col, 0.82));
    const ta = Math.floor((xa - X0) * TPY), tb = Math.floor((xb - X0) * TPY), ua = Math.floor((0 - Y0) * TPY), ub = Math.floor((FIELD_W - Y0) * TPY);
    for (let ty = ua; ty < ub; ty++) for (let tx = ta; tx < tb; tx++) T[ty * TW + tx] = ((tx + ty) >> 3) & 1 ? c1 : c2;
  };
  ez(-10, 0, homeColor); ez(100, 110, awayColor);
  rect(-11, -1, 111, 0, white); rect(-11, FIELD_W, 111, FIELD_W + 1, white);
  rect(-11, -1, -10, FIELD_W + 1, white); rect(110, -1, 111, FIELD_W + 1, white);
  rect(-11, -3.2, 111, -1, hexU32(shade(homeColor, 0.9))); rect(-11, FIELD_W + 1, 111, FIELD_W + 3.2, hexU32(shade(awayColor, 0.9)));
  rect(X0, Y0, X1, Y0 + 0.8, concrete); rect(X0, Y1 - 0.8, X1, Y1, concrete); rect(X0, Y0, X0 + 0.8, Y1, concrete); rect(X1 - 0.8, Y0, X1, Y1, concrete);
  const bench = hexU32("#9aa0b4"), benchD = hexU32("#5a6074"), hb = hexU32(shade(homeColor, 0.75)), ab = hexU32(shade(awayColor, 0.75));
  for (let X = 32; X < 68; X += 4.5) {
    rect(X, -6.2, X + 3.6, -5.4, bench); rect(X, -5.4, X + 3.6, -5.1, hb);
    rect(X, FIELD_W + 5.1, X + 3.6, FIELD_W + 5.4, ab); rect(X, FIELD_W + 5.4, X + 3.6, FIELD_W + 6.2, bench);
  }
  for (let X = 30; X < 70; X += 0.5) { if ((X * 2) & 1) continue; rect(X, -4.1, X + 0.25, -3.95, benchD); rect(X, FIELD_W + 3.95, X + 0.25, FIELD_W + 4.1, benchD); }
  const fyA = Math.floor((0 - Y0) * TPY), fyB = Math.floor((FIELD_W - Y0) * TPY);
  for (let yl = 0; yl <= 100; yl += 5) {
    const w = yl === 0 || yl === 100 ? 2 : 1, tx = Math.floor((yl - X0) * TPY) - (w === 2 ? 1 : 0);
    for (let ty = fyA; ty < fyB; ty++) for (let k = 0; k < w; k++) T[ty * TW + tx + k] = white;
  }
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue;
    const tx = Math.floor((yd - X0) * TPY);
    for (const hy of [HASH_L, HASH_R]) for (let k = -3; k <= 2; k++) T[(Math.floor((hy - Y0) * TPY) + k) * TW + tx] = white;
    for (let k = 0; k < 5; k++) { T[(Math.floor((0.3 - Y0) * TPY) + k) * TW + tx] = white; T[(Math.floor((FIELD_W - 0.9 - Y0) * TPY) + k) * TW + tx] = white; }
  }
  for (const X of [2, 98]) { const tx = Math.floor((X - X0) * TPY); for (let k = -4; k < 4; k++) T[(Math.floor((MID_Y - Y0) * TPY) + k) * TW + tx] = white; }
  const orange = hexU32("#ff8a1e");
  for (const X of [-10, 0, 100, 110]) for (const Y of [0, FIELD_W]) rect(X - 0.25, Y - 0.25, X + 0.25, Y + 0.25, orange);
  // text stamped through a canvas: (lx, ly) of the lettering → (X, Y) on the field
  const stamp = (text, scale, fill, outline, map) => {
    const cw = textWidth(text, scale) + 4, ch = 7 * scale + 4, c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const g = c.getContext("2d");
    if (outline) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) drawText(g, text, 2 + dx, 2 + dy, scale, outline);
    drawText(g, text, 2, 2, scale, fill);
    const d = g.getImageData(0, 0, cw, ch).data;
    for (let ly = 0; ly < ch; ly++) for (let lx = 0; lx < cw; lx++) {
      const o = (ly * cw + lx) * 4;
      if (d[o + 3] < 128) continue;
      const [X, Y] = map(lx, ly, cw, ch), tx = Math.floor((X - X0) * TPY), ty = Math.floor((Y - Y0) * TPY);
      if (tx >= 0 && ty >= 0 && tx < TW && ty < TH) T[ty * TW + tx] = u32(d[o], d[o + 1], d[o + 2]);
    }
  };
  // yard numbers, tops toward the nearest sideline, arrows toward the nearer goal
  for (let yl = 10; yl <= 90; yl += 10) {
    const n = String(yl <= 50 ? yl : 100 - yl);
    for (const [yc, side] of [[12, -1], [FIELD_W - 12, 1]]) {
      stamp(n, 2, "#f1f1e6", null, (lx, ly, w, h) => { const u = (lx - w / 2) / TPY, v = (ly - h / 2) / TPY; return side < 0 ? [yl - u, yc + v] : [yl + u, yc - v]; });
      if (yl === 50) continue;
      const dir = yl < 50 ? -1 : 1, tipX = yl + dir * 1.55;
      for (let k = 0; k < 4; k++) for (let j = -k; j <= k; j++) { const tx = Math.floor((tipX - (dir * k) / TPY - X0) * TPY), ty = Math.floor((yc + j / TPY - Y0) * TPY); T[ty * TW + tx] = white; }
    }
  }
  // midfield: the home team's mark (a ring in its colors with the abbreviation), read from the home sideline
  const ring = hexU32(kits.home.accent), fillC = hexU32(homeColor), ink = hexU32("#14141c");
  for (let ty = Math.floor((MID_Y - 5 - Y0) * TPY); ty < Math.ceil((MID_Y + 5 - Y0) * TPY); ty++) for (let tx = Math.floor((45 - X0) * TPY); tx < Math.ceil((55 - X0) * TPY); tx++) {
    const d = Math.hypot(X0 + (tx + 0.5) / TPY - 50, Y0 + (ty + 0.5) / TPY - MID_Y);
    if (d <= 4.6) T[ty * TW + tx] = d > 4.25 ? ink : d > 3.7 ? ring : fillC;
  }
  stamp(home.abbr.toUpperCase(), 2, contrastInk(homeColor, kits.home.accent), "#14141c", (lx, ly, w, h) => [50 + (lx - w / 2) / TPY, MID_Y - (ly - h / 2) / TPY]);
  // end-zone names, readable from the field looking at each end
  const ezName = (name, xc, facing) => {
    const scale = Math.max(2, Math.min(4, Math.floor(46 / textWidth(name, 1) * 0.9)));
    stamp(name, scale, "#f4f4ee", "#14141c", (lx, ly, w, h) => { const u = (lx - w / 2) / TPY, v = (ly - h / 2) / TPY; return facing < 0 ? [xc - v, MID_Y - u] : [xc + v, MID_Y + u]; });
  };
  ezName((away.short || away.abbr).toUpperCase(), 105, -1);
  ezName((home.short || home.abbr).toUpperCase(), -5, 1);
  // turf grain on bare grass only
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const i = ty * TW + tx, c = T[i];
    if (c === g1 || c === g2) { const k = hash(tx, ty) & 63; if (k === 0) T[i] = c === g2 ? gs2 : gs1; else if (k === 1) T[i] = c === g2 ? gs1 : gs2; }
    else if (c === apron && (hash(tx, ty) & 31) === 0) T[i] = apron2;
  }
  return T;
}

// ---------- the stands (mode7.js buildStands): v down from the rim, u along the wall ----------
function standPixels(home, kits) {
  const S = new Uint32Array(ST_W * ST_H), A = new Uint32Array(ST_W * ST_H);
  const homeColor = kits.home.jersey, awayColor = kits.away.jersey;
  const shirts = ["#f4f4ee", "#2a2a3a", "#e8413b", "#3b7dff", "#ffd23e", "#57e36a", "#ff9b2e", "#b05ae8", homeColor, homeColor, homeColor, homeColor, awayColor, awayColor, shade(homeColor, 1.25)].map(hexU32);
  const skins = ["#f0c8a0", "#d8a478", "#b07848", "#7a4a2a"].map(hexU32);
  const hair = ["#2a1a10", "#5a3a1a", "#e8c860", "#1a1a1a", "#a04020"].map(hexU32);
  const seat = hexU32("#23263a"), seat2 = hexU32("#1a1c2c"), stair = hexU32("#4a4e62"), stair2 = hexU32("#3c4054"), rail = hexU32("#8a90a8"), railD = hexU32("#4a4e62");
  const facade = hexU32("#14162a"), facade2 = hexU32("#1e2138"), lamp = hexU32("#fff2a8"), lampD = hexU32("#c8b060");
  const padC = hexU32(homeColor), padD = hexU32(shade(homeColor, 0.72)), padL = hexU32(shade(homeColor, 1.22)), padS = hexU32(shade(homeColor, 0.5));
  const textC = hexU32(contrastInk(homeColor, kits.home.accent));
  const abbr = home.abbr.toUpperCase(), name = (home.short || home.abbr).toUpperCase();
  const vOf = (z) => Math.round(ST_H - z * ST_PY);
  const padTop = vOf(PAD_TOP), railTop = vOf(RIB_TOP + 0.3), crowdTop = vOf(13.3), banTop = vOf(13.3), banBot = vOf(10.35);
  for (let v = 0; v < ST_H; v++) {
    const yd = (ST_H - 1 - v + 0.5) / ST_PY;
    for (let u = 0; u < ST_W; u++) {
      let c, alt;
      if (v >= padTop) { c = v === padTop ? padL : v >= ST_H - 1 ? padS : (u & 63) === 0 ? padD : padC; alt = c; }
      else if (v >= vOf(RIB_TOP)) { c = facade; alt = c; }
      else if (v >= railTop) { c = v === railTop ? rail : railD; alt = c; }
      else if (v < crowdTop) { c = yd > 14.6 ? facade2 : facade; if (yd > 13.8 && yd < 14.3 && (u % 18) < 4) c = (u % 18) === 0 ? lampD : lamp; alt = c; }
      else {
        const row = Math.floor((yd - (RIB_TOP + 0.3)) * ST_PY);
        if ((u % 192) < 8) { c = (row & 2) ? stair : stair2; alt = c; }
        else {
          const fan = u >> 2, tier = row >> 3, sub = row & 7, col = u & 3, h = hash(fan, tier);
          const empty = (h & 15) === 0, shirt = shirts[(h >> 4) % shirts.length], skin = skins[(h >> 9) & 3], hr = hair[(h >> 12) % hair.length];
          const gap = col === 3, base = (sub < 2 || sub === 7) ? ((tier & 1) ? seat : seat2) : seat2;
          if (empty || gap) c = base;
          else if (sub >= 2 && sub <= 4) c = shirt;
          else if (sub === 5) c = skin;
          else if (sub === 6) c = (h >> 15) & 1 ? hr : skin;
          else c = base;
          // the cheering frame: on their feet, arms up
          if (empty) alt = c;
          else if (gap) alt = (sub === 6 || sub === 7) && ((h >> 16) & 1) ? shirt : c;
          else if (sub >= 3 && sub <= 5) alt = shirt;
          else if (sub === 6) alt = skin;
          else if (sub === 7) alt = (h >> 15) & 1 ? hr : skin;
          else alt = c;
        }
      }
      S[v * ST_W + u] = c; A[v * ST_W + u] = alt;
    }
  }
  // home banners hanging from the rim every 24 yd
  const banC = padC, banD = hexU32(shade(homeColor, 0.6)), BW = 13;
  for (let b0 = 96; b0 < ST_W; b0 += 192) {
    for (let v = banTop; v <= banBot + 3; v++) for (let x = 0; x < BW; x++) {
      if (v > banBot && Math.abs(x - (BW >> 1)) < (v - banBot) * 2) continue;
      const u = b0 + x, edge = x === 0 || x === BW - 1 || v === banTop;
      S[v * ST_W + u] = A[v * ST_W + u] = edge ? banD : banC;
    }
    for (let i = 0; i < abbr.length && i < 3; i++) plotGlyph(S, A, ST_W, abbr[i], b0 + 4, banTop + 2 + i * 8, textC);
  }
  const padText = name.length * 6 - 1 <= 60 ? name : abbr, tw = padText.length * 6 - 1;
  for (let p0 = 0; p0 < ST_W; p0 += 128) for (let i = 0; i < padText.length; i++) plotGlyph(S, A, ST_W, padText[i], p0 + 32 - (tw >> 1) + i * 6, padTop + 1, textC);
  return { S, A };
}

// ---------- the LED ribbon (mode7.js buildAds) ----------
function ribbonPixels(home, kits) {
  const D = new Uint32Array(AD_W * AD_H);
  D.fill(hexU32("#141826"));
  const hc = kits.home.jersey, ink = contrastInk(hc, kits.home.accent), short = (home.short || home.abbr).toUpperCase();
  const ads = [["SNACK BAR", "#2a5ad8", "#f4f4ee"], [home.name.toUpperCase(), hc, ink], CHEERS[0], ["RAGDOLL FOOTBALL", "#ffd23e", "#0b0d1a"], CHEERS[1],
    [`GO ${short}!`, hc, ink], CHEERS[2], ["FOOTBALL NIGHT", "#1a1e33", "#5ef0ff"], ["FIRST AID", "#f4f4ee", "#e8413b"], CHEERS[3]];
  let x = 0, i = 0;
  while (x < AD_W - 40) {
    const [txt, bg, fg] = ads[i % ads.length], w = txt.length * 6 + 15;
    const bgc = hexU32(bg), fgc = hexU32(fg), ed = hexU32(shade(bg, 0.65));
    for (let v = 1; v < AD_H - 1; v++) for (let k = 0; k < w && x + k < AD_W; k++) D[v * AD_W + x + k] = k === 0 || k === w - 1 ? ed : bgc;
    for (let j = 0; j < txt.length; j++) plotGlyph(D, null, AD_W, txt[j], x + 8 + j * 6, 2, fgc, AD_H);
    x += w + 3; i++;
  }
  const frame = hexU32("#0b0d1a");
  for (let k = 0; k < AD_W; k++) { D[k] = frame; D[(AD_H - 1) * AD_W + k] = frame; }
  return D;
}

// a sprite from rows of palette letters ('.' = transparent)
function spriteFrom(rows, pal) {
  const h = rows.length, w = rows[0].length, px = new Uint32Array(w * h);
  // (row 0 is the top: the texture's v 0 is the bottom, so the rows go in upside down)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = rows[y][x]; px[(h - 1 - y) * w + x] = c === "." ? 0 : pal[c]; }
  return { px, w, h };
}
function moonSprite() {
  const R = 6, rows = [];
  for (let y = -R; y <= R; y++) {
    let s = "";
    for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, y);
      if (d > R + 0.3) s += ".";
      else if (Math.hypot(x + 2.2, y - 1.6) < 1.6 || Math.hypot(x - 2, y + 2.4) < 1.2 || Math.hypot(x - 1.5, y - 3) < 0.9) s += "c";
      else s += d > R - 0.8 ? (x + y > 2 ? "d" : "a") : x + y > 4 ? "b" : "a";
    }
    rows.push(s);
  }
  return spriteFrom(rows, { a: hexU32("#f6f2d8"), b: hexU32("#d8d2b0"), c: hexU32("#c4bc98"), d: hexU32("#a8a084") });
}

// ---------- the 3D stadium ----------
export class PixelStadium {
  constructor(home, away, kits) {
    const G = this.group = new THREE.Group();
    this.textures = [];
    const keep = (t) => { this.textures.push(t); return t; };
    // field and apron (lit: the players' shadows fall on it)
    const field = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Y1 - Y0), new THREE.MeshLambertMaterial({ map: keep(texture(fieldPixels(home, away, kits), TW, TH)) }));
    field.rotation.x = -Math.PI / 2; field.position.set((X0 + X1) / 2, 0, -(Y0 + Y1) / 2); field.receiveShadow = true;
    G.add(field);
    // the four stand walls, facing in, the art running left → right along the bowl
    const { S, A } = standPixels(home, kits);
    this.stand = keep(texture(S, ST_W, ST_H, true)); this.standAlt = keep(texture(A, ST_W, ST_H, true));
    this.ribbon = keep(texture(ribbonPixels(home, kits), AD_W, AD_H, true));
    this.walls = []; this.ribbons = [];
    const corners = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];
    let along = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4], len = Math.hypot(bx - ax, by - ay);
      const mat = new THREE.MeshBasicMaterial({ map: this.stand.clone(), toneMapped: false });
      mat.map.repeat.set((len * ST_PU) / ST_W, -1); mat.map.offset.set((along * ST_PU) / ST_W, 1); mat.map.needsUpdate = true;
      this.textures.push(mat.map);
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, WALL_H), mat);
      // the wall's front faces the field: going round the bowl (a → b) with the field on the left
      const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = (bx - ax) / len, dy = (by - ay) / len;
      wall.position.set(mx, WALL_H / 2, -my);
      wall.rotation.y = Math.atan2(-dy, -dx); // front face (+z) toward the field: the inward normal (−dy, dx) in three.js axes
      G.add(wall);
      this.walls.push({ mat, len, along });
      const rmat = new THREE.MeshBasicMaterial({ map: this.ribbon.clone(), toneMapped: false });
      rmat.map.repeat.set((len * ST_PU) / AD_W, -1); rmat.map.offset.set(0, 1); rmat.map.needsUpdate = true;
      this.textures.push(rmat.map);
      const rib = new THREE.Mesh(new THREE.PlaneGeometry(len, RIB_TOP - RIB_BOT), rmat);
      rib.position.copy(wall.position); rib.position.y = (RIB_BOT + RIB_TOP) / 2; rib.rotation.copy(wall.rotation);
      rib.translateZ(0.04);
      G.add(rib);
      this.ribbons.push(rmat.map);
      along += len;
    }
    // sky: stepped night bands with an ordered dither, a hazy horizon
    const bands = SKY.bands.map((h) => new THREE.Color(h));
    const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, toneMapped: false,
      uniforms: { bands: { value: bands }, haze: { value: new THREE.Color(SKY.haze) } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 bands[${bands.length}]; uniform vec3 haze; varying vec3 vP;
        float bayer(vec2 p){ int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)); int i = x + y * 4;
          int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(b[i]) + 0.5) / 16.0; }
        void main(){
          float e = clamp(vP.y, 0.0, 1.0);
          float k = clamp((1.0 - e / 0.75) * ${bands.length - 1}.0, 0.0, ${bands.length - 1}.0);
          float f = floor(k), t = fract(k);
          int a = int(f), b = int(min(f + 1.0, ${bands.length - 1}.0));
          vec3 c = t > bayer(floor(gl_FragCoord.xy / 3.0)) ? bands[b] : bands[a];
          if (vP.y < 0.02) c = haze;
          gl_FragColor = vec4(c, 1.0); }`,
    }));
    G.add(sky);
    // stars (fixed directions, a few twinkle) and the moon
    const n = SKY.stars, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const starC = ["#ffffff", "#d0e8ff", "#ffe0c8", "#ffb8a0"].map((h) => new THREE.Color(h));
    for (let i = 0; i < n; i++) {
      const h = hash(i * 7 + 3, 911), az = ((h & 0xffff) / 0x10000) * Math.PI * 2, el = 0.12 + (((h >>> 16) & 0x3ff) / 0x400) * 0.9;
      pos.set([50 + Math.cos(az) * Math.cos(el) * 600, Math.sin(el) * 600, -MID_Y - Math.sin(az) * Math.cos(el) * 600], i * 3);
      const c = starC[(h >>> 26) & 3]; col.set([c.r, c.g, c.b], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); sg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.5, sizeAttenuation: false, vertexColors: true, toneMapped: false, depthWrite: false }));
    G.add(this.stars);
    const moon = moonSprite(), mt = keep(texture(moon.px, moon.w, moon.h));
    mt.minFilter = THREE.NearestFilter; mt.generateMipmaps = false;
    const ms = new THREE.Sprite(new THREE.SpriteMaterial({ map: mt, toneMapped: false, depthWrite: false }));
    ms.position.set(50 + Math.cos(0.55) * 560, Math.sin(0.2) * 600, -MID_Y - Math.sin(0.55) * 560); ms.scale.setScalar(42);
    G.add(ms);
    // light towers on the rim: a lattice mast and a glowing lamp bank
    const mast = new THREE.MeshBasicMaterial({ color: "#2a2d3e" }), bank = new THREE.MeshBasicMaterial({ color: "#fff8d8", toneMapped: false }), frame = new THREE.MeshBasicMaterial({ color: "#14162a" });
    for (const [X, Y] of TOWERS) {
      const t = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), mast); m.position.y = WALL_H + 3.5; t.add(m);
      const f = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2, 0.4), frame); f.position.y = WALL_H + 7.9; t.add(f);
      const b = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 0.45), bank); b.position.y = WALL_H + 7.9; t.add(b);
      t.position.set(X, 0, -Y); t.lookAt(50, 0, -MID_Y); t.rotation.x = 0; t.rotation.z = 0;
      G.add(t);
    }
    // jumbotrons above each end: a frame in the home trim and an LED screen (drawn in the pixel font)
    this.jumboCanvas = document.createElement("canvas"); this.jumboCanvas.width = 120; this.jumboCanvas.height = 52;
    this.jumboTex = new THREE.CanvasTexture(this.jumboCanvas); this.jumboTex.magFilter = THREE.NearestFilter; this.jumboTex.minFilter = THREE.LinearFilter; this.jumboTex.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(this.jumboTex);
    const screen = new THREE.MeshBasicMaterial({ map: this.jumboTex, toneMapped: false }), box = new THREE.MeshBasicMaterial({ color: "#3a3e52" }), trim = new THREE.MeshBasicMaterial({ color: kits.home.jersey });
    for (const X of JUMBO_X) {
      const j = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(30, 13, 1), box); j.add(body);
      const top = new THREE.Mesh(new THREE.BoxGeometry(30.2, 0.6, 1.1), trim); top.position.y = 6.4; j.add(top);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(28, 11.2), screen); s.position.z = 0.51; s.position.y = -0.4; j.add(s);
      for (const lx of [-8, 8]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6, 0.9), box); leg.position.set(lx, -9.5, 0); j.add(leg); }
      j.position.set(X, WALL_H + 9.5, -MID_Y); j.lookAt(50, WALL_H + 9.5, -MID_Y);
      G.add(j);
    }
    this.kits = kits; this.home = home; this.away = away;
    this.cheer = 0; this.scroll = 0; this.jumboKey = "";
  }
  // per frame: the ribbon scrolls, the crowd jumps when it has something to cheer, the jumbotrons show the game
  update(dt, t, info) {
    this.scroll += dt * 6 * ST_PU; // 6 yd/s
    for (const r of this.ribbons) r.offset.x = this.scroll / AD_W;
    if (this.cheer > 0) this.cheer -= dt;
    const up = this.cheer > 0 && ((t * 5) | 0) & 1;
    for (const w of this.walls) {
      const want = up ? this.standAlt : this.stand;
      if (w.mat.map.source !== want.source) { w.mat.map.source = want.source; w.mat.map.needsUpdate = true; }
    }
    if (info) this.drawJumbo(info);
  }
  cheerFor(sec) { this.cheer = Math.max(this.cheer, sec); }
  drawJumbo(info) {
    const key = `${info.clock}|${info.hs}|${info.as}|${info.msg}`;
    if (key === this.jumboKey) return;
    this.jumboKey = key;
    const c = this.jumboCanvas, g = c.getContext("2d"), W = c.width;
    g.fillStyle = "#06070f"; g.fillRect(0, 0, W, c.height);
    g.fillStyle = "#0d1020"; for (let y = 1; y < c.height; y += 2) g.fillRect(0, y, W, 1);
    const center = (text, y, color) => { const s = text.length > 19 ? text.slice(0, 19) : text; drawText(g, s, Math.round((W - textWidth(s, 1)) / 2), y, 1, color); };
    center(info.clock, 5, "#ffd23e");
    // [HOME] 7 - 3 [AWAY] in team-color boxes
    const parts = [], box = (abbr, col) => parts.push({ w: textWidth(abbr, 1) + 2, draw: (x) => { g.fillStyle = col; g.fillRect(x, 19, textWidth(abbr, 1) + 2, 9); drawText(g, abbr, x + 1, 20, 1, contrastInk(col)); } });
    const num = (v) => { const s = String(v); parts.push({ w: textWidth(s, 1), draw: (x) => drawText(g, s, x, 20, 1, "#f4f4ee") }); };
    box(info.home, info.hc); num(info.hs); parts.push({ w: 5, draw: (x) => drawText(g, "-", x, 20, 1, "#9aa3c0") }); num(info.as); box(info.away, info.ac);
    let x = Math.round((W - parts.reduce((a, p) => a + p.w + 3, -3)) / 2);
    for (const p of parts) { p.draw(x); x += p.w + 3; }
    center(info.msg, 37, "#5ef0ff");
    this.jumboTex.needsUpdate = true;
  }
  dispose() {
    for (const t of this.textures) t.dispose();
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

// the jumbotron's lines for a game (render.js jumboLines / jumboMessage, without the league's name)
const ORD = ["", "1ST", "2ND", "3RD", "4TH"];
export function jumboInfo(w, kits) {
  const s = Math.max(0, Math.ceil(w.clock)), clock = w.phase === "over" ? "FINAL" : w.phase === "halftime" ? "HALFTIME" : `${w.ot ? "OT" : `Q${Math.min(4, w.quarter)}`} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const homeO = w.possession === "home", pt = w.playType, ph = w.phase;
  let msg = "RAGDOLL FOOTBALL";
  if (ph === "over") msg = w.score.home > w.score.away ? `${w.teams.home.abbr} WINS!` : w.score.home < w.score.away ? `${w.teams.away.abbr} WINS` : "A TIE";
  else if (pt === "kickoff") msg = "KICKOFF";
  else if (pt === "punt") msg = "PUNT";
  else if (pt === "fg") msg = "FIELD GOAL";
  else if (pt === "pat") msg = "EXTRA POINT";
  else if (pt === "two") msg = "2-PT TRY";
  else if (ph === "presnap" || ph === "playcall") {
    const goal = w.los + w.toGo >= 100;
    msg = `${ORD[w.down] || ""} & ${goal ? "GOAL" : Math.max(1, Math.round(w.toGo))}${w.down === 3 && !homeO ? " GET LOUD!" : ""}`;
  } else if (ph === "live") msg = homeO ? (w.los >= 80 ? "TOUCHDOWN ALERT" : `LET'S GO ${w.teams.home.abbr}!`) : w.down >= 3 ? "DE-FENSE!" : "MAKE SOME NOISE!";
  return { clock, hs: w.score.home, as: w.score.away, home: w.teams.home.abbr, away: w.teams.away.abbr, hc: kits.home.jersey, ac: kits.away.jersey, msg };
}
