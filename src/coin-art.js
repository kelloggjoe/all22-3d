// The coin toss coin, in pixel art (drawn the way the Pokémon game draws its coin): a strip of 8 frames turning from
// heads (gold, a donut) through the edge to tails (silver, "SL") and back. styles.css steps through it while it spins.
const F = 24, N = 8, WIDTHS = [22, 16, 8, 3, 22, 3, 8, 16];
const INK = "#0b0d1a", GOLD = "#ffd23e", GOLD_D = "#c79a12", GOLD_L = "#fff3a0", SILVER = "#dfe3f0", SILVER_D = "#8a90a8";
export function coinStrip() {
  const c = document.createElement("canvas"); c.width = F * N; c.height = F;
  const g = c.getContext("2d");
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  WIDTHS.forEach((w, f) => {
    const ox = f * F, tails = f >= 3 && f <= 5, face = tails ? SILVER : GOLD, rim = tails ? SILVER_D : GOLD_D;
    for (let y = 0; y < 22; y++) {
      const dy = y + 0.5 - 11, hw = Math.sqrt(Math.max(0, 121 - dy * dy)) * (w / 22);
      const a = Math.round(12 - hw), b = Math.round(12 + hw);
      if (b <= a) continue;
      px(ox + a, y + 1, b - a, 1, INK);
      if (b - a > 2) px(ox + a + 1, y + 1, b - a - 2, 1, w < 6 ? rim : face);
    }
    if (w >= 16) {
      const k = w / 22, cx = ox + 12;
      if (!tails) { // heads: a donut
        for (let y = 6; y < 18; y++) for (let x = -6; x < 6; x++) {
          const d = Math.hypot((x + 0.5) / k, y + 0.5 - 12);
          if (d < 5.5 && d > 2.2) px(cx + Math.round(x * k), y, 1, 1, d > 4.6 || d < 3 ? INK : "#ff6fa8");
        }
      } else { // tails: SL
        const S = ["111", "100", "111", "001", "111"], L = ["100", "100", "100", "100", "111"];
        [[S, -4], [L, 1]].forEach(([gl, dx]) => gl.forEach((row, r) => [...row].forEach((bit, i) => { if (bit === "1") px(cx + dx + i, 9 + r, 1, 1, "#5a6288"); })));
      }
      px(ox + Math.round(12 - 8 * k), 3, 4, 1, tails ? "#ffffff" : GOLD_L); // the glint
    }
  });
  return c.toDataURL();
}
