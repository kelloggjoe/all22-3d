// Play art: the user's called routes / run path painted on the turf before the snap (pixel lines drawn by
// render.js drawPlayArt). Segments are [x0, y0, x1, y1, u32color, arrowhead?, f0, f1] in ABSOLUTE stadium yards, where
// f0..f1 is the segment's share of its route's length: routes draw themselves on over ~0.6 s (render.js reads
// segs.reveal), the last segment of each route ends in an arrowhead, and the art blinks out before it disappears.
// API: attach(bus, w, app) (built on "presnap" when the user is on offense, cleared on "snap"), build(w) (hot routes /
// audibles rebuild it), tick(dt), current(w) → segments to draw this frame (with .reveal 0..1) or null.
import { FIELD_W } from "./config.js";

const SHOW = 3.2, GROW = 0.6, BLINK = 0.8;
export class PlayArt {
  constructor() { this.segs = null; this.t = 0; }
  attach(bus, w) {
    bus.on("snap", () => { this.segs = null; });
    bus.on("presnap", () => { if (w.userSide() === "O" && !w.autopilot) this.build(w); });
  }
  build(w) {
    const play = w.call.off;
    if (!play) return;
    const segs = [];
    const toAbs = (x, y) => [w.possession === "home" ? x : 100 - x, w.possession === "home" ? y : FIELD_W - y];
    const route = (pts, col) => {
      // pts: [[x, y], ...] in offense coords → segments with cumulative length fractions
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (len < 0.01) return;
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const a = toAbs(pts[i - 1][0], pts[i - 1][1]), b = toAbs(pts[i][0], pts[i][1]);
        segs.push([a[0], a[1], b[0], b[1], col, i === pts.length - 1 ? 1 : 0, acc / len, (acc + l) / len]);
        acc += l;
      }
    };
    for (const p of w.off) {
      if (!p.as || p.as.kind !== "route") continue;
      const outSign = Math.abs(p.sy - w.ballY) > 0.6 ? (p.sy < w.ballY ? 1 : -1) : (p.as.side || 1);
      const pts = [[p.sx, p.sy]];
      for (const [dn, o] of p.as.pts) pts.push([Math.min(108, p.sx + dn), Math.max(1, Math.min(FIELD_W - 1, p.sy - o * outSign))]);
      const hot = w.hot && w.hot[p.slot];
      route(pts, hot ? 0xffffe05e : play.prog && play.prog[0] === p.slot ? 0xff3ef0ff : 0xfff4f4f4); // hot route cyan, first read gold
    }
    if (play.type === "run" && play.run) {
      const c = w.bySlot(w.off, play.carrier || "HB");
      if (c) {
        const pts = [[c.sx, c.sy]];
        for (const [dx, dy] of play.run) pts.push([w.los + dx, w.ballY - dy]);
        route(pts, 0xff4a9aff); // run path orange
      }
    }
    segs.reveal = 0;
    this.segs = segs; this.t = SHOW;
  }
  tick(dt) {
    if (this.t > 0) this.t -= dt;
    if (this.segs) this.segs.reveal = Math.min(1, (SHOW - this.t) / GROW);
  }
  current(w) {
    if (!(this.t > 0) || w.phase !== "presnap" || !this.segs) return null;
    if (this.t < BLINK && ((this.t * 10) | 0) & 1) return null; // stepped blink-out
    return this.segs;
  }
  clear() { this.segs = null; this.t = 0; }
}
