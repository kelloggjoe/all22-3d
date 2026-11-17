// Play diagrams as SVG, read from the same playbook data the World runs (offPos / defPos / assignments / routes).
import { offPos, defPos, defAssignments, ZONES, ELIGIBLE } from "./sim/playbook.js";

const W = 200, H = 130;
const fmt = (n) => Math.round(n * 10) / 10;
function frame(losY, inner) {
  let stripes = "";
  for (let i = -2; i < 6; i++) { const y = losY - i * 5 * (W / 40); stripes += `<line x1="0" x2="${W}" y1="${fmt(y)}" y2="${fmt(y)}" class="yl"/>`; }
  return `<svg viewBox="0 0 ${W} ${H}" class="dg" aria-hidden="true">${stripes}<line x1="0" x2="${W}" y1="${losY}" y2="${losY}" class="los"/>${inner}</svg>`;
}
const arrow = (x0, y0, x1, y1, cls) => {
  const a = Math.atan2(y1 - y0, x1 - x0), s = 5;
  const p1 = [x1 - s * Math.cos(a - 0.45), y1 - s * Math.sin(a - 0.45)], p2 = [x1 - s * Math.cos(a + 0.45), y1 - s * Math.sin(a + 0.45)];
  return `<path d="M${fmt(p1[0])},${fmt(p1[1])} L${fmt(x1)},${fmt(y1)} L${fmt(p2[0])},${fmt(p2[1])}" class="${cls}"/>`;
};

export function offSVG(play) {
  const sc = W / 40, losY = Math.round(H * 0.72);
  const P = (dx, dy) => [W / 2 + dy * sc, Math.max(3, losY - dx * sc)];
  const pos = offPos(play), first = play.prog && play.prog[0];
  let lines = "", dots = "";
  for (const slot in pos) {
    const [dx, dy] = pos[slot];
    const as = play.a[slot] || {};
    const [px, py] = P(dx, dy);
    if (as.kind === "route" && as.pts) {
      const out = dy > 0.5 ? 1 : dy < -0.5 ? -1 : (as.side || 1);
      const pts = [[px, py], ...as.pts.map((q) => P(dx + q[0], dy + q[1] * out))];
      const cls = slot === first ? "rt hi" : "rt";
      lines += `<polyline points="${pts.map((q) => `${fmt(q[0])},${fmt(q[1])}`).join(" ")}" class="${cls}"/>`;
      const n = pts.length; lines += arrow(pts[n - 2][0], pts[n - 2][1], pts[n - 1][0], pts[n - 1][1], cls);
    } else if (as.kind === "block") {
      lines += `<path d="M${fmt(px)},${fmt(py)} V${fmt(py - 5)} M${fmt(px - 3)},${fmt(py - 5)} H${fmt(px + 3)}" class="bk"/>`;
    }
  }
  if (play.type === "run" && play.run) {
    const c = play.carrier || "HB", s = pos[c] || [0, 0];
    const pts = [P(s[0], s[1]), ...play.run.map((q) => P(q[0], q[1]))];
    lines += `<polyline points="${pts.map((q) => `${fmt(q[0])},${fmt(q[1])}`).join(" ")}" class="run"/>`;
    const n = pts.length; lines += arrow(pts[n - 2][0], pts[n - 2][1], pts[n - 1][0], pts[n - 1][1], "run");
  }
  for (const slot in pos) {
    const [px, py] = P(...pos[slot]);
    const cls = slot === "QB" ? "qb" : ELIGIBLE.includes(slot) ? "el" : "ol";
    dots += `<circle cx="${fmt(px)}" cy="${fmt(py)}" r="3.2" class="pl ${cls}"/>`;
  }
  return frame(losY, lines + dots);
}

export function defSVG(play, scheme) {
  const sc = W / 40, losY = Math.round(H * 0.82);
  const P = (dx, dy) => [W / 2 + dy * sc, Math.max(4, losY - dx * sc)];
  const pos = defPos(play, scheme), a = defAssignments(play, scheme);
  let lines = "", dots = "";
  for (const slot in pos) {
    const [dx, dy] = pos[slot];
    const as = a[slot] || {};
    const [px, py] = P(dx, dy);
    if (as.kind === "zone" && ZONES[as.zone]) {
      const [zx, zy] = ZONES[as.zone], [qx, qy] = P(zx, zy);
      const cls = zx >= 14 ? "zd" : zx >= 7 ? "zh" : "zf";
      lines += `<line x1="${fmt(px)}" y1="${fmt(py)}" x2="${fmt(qx)}" y2="${fmt(qy)}" class="zl"/><ellipse cx="${fmt(qx)}" cy="${fmt(qy)}" rx="12" ry="6" class="zn ${cls}"/>`;
    } else if (as.kind === "rush") {
      lines += `<line x1="${fmt(px)}" y1="${fmt(py)}" x2="${fmt(px)}" y2="${fmt(py + 9)}" class="ru"/>` + arrow(px, py, px, py + 9, "ru");
    } else if (as.kind === "man") {
      lines += `<line x1="${fmt(px)}" y1="${fmt(py)}" x2="${fmt(px)}" y2="${fmt(py - 6)}" class="mn"/>`;
    } else if (as.kind === "spy") {
      lines += `<circle cx="${fmt(px)}" cy="${fmt(py)}" r="6" class="sp"/>`;
    }
  }
  for (const slot in pos) {
    const [px, py] = P(...pos[slot]);
    dots += `<path d="M${fmt(px - 3)},${fmt(py - 3)} L${fmt(px + 3)},${fmt(py + 3)} M${fmt(px + 3)},${fmt(py - 3)} L${fmt(px - 3)},${fmt(py + 3)}" class="dx"/>`;
  }
  return frame(losY, lines + dots);
}

// a single route for the hot-route cards (receiver at the bottom, outside = right)
export function routeSVG(lib, name) {
  const w = 90, h = 70, x0 = 34, y0 = h - 10;
  if (name === "block") return `<svg viewBox="0 0 ${w} ${h}" class="dg sm"><line x1="0" x2="${w}" y1="${y0}" y2="${y0}" class="los"/><path d="M${x0},${y0} V${y0 - 12} M${x0 - 5},${y0 - 12} H${x0 + 5}" class="bk"/><circle cx="${x0}" cy="${y0}" r="3.4" class="pl el"/></svg>`;
  const r = lib[name];
  const pts = [[x0, y0], ...r.pts.map((q) => [Math.max(3, Math.min(w - 3, x0 + q[1] * 2.2)), Math.max(4, y0 - Math.min(26, q[0]) * 2)])];
  const n = pts.length;
  return `<svg viewBox="0 0 ${w} ${h}" class="dg sm"><line x1="0" x2="${w}" y1="${y0}" y2="${y0}" class="los"/><polyline points="${pts.map((q) => `${fmt(q[0])},${fmt(q[1])}`).join(" ")}" class="rt hi"/>${arrow(pts[n - 2][0], pts[n - 2][1], pts[n - 1][0], pts[n - 1][1], "rt hi")}<circle cx="${x0}" cy="${y0}" r="3.4" class="pl el"/></svg>`;
}
