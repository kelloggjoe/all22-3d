// Assignments, coverage, pursuit, QB reads, returns, CPU play calling, the 4th-down coach and the autopilot.
// Run game: at the snap assignRunBlocks() hands every run blocker a defender (a gap count from the playside), so the
//   unblocked man is the backside edge or a deep safety — not whoever happened to be nearest — and backside rushers
//   squeeze/contain for a beat instead of beelining at the mesh (that's what makes the cutback, read option and
//   bootleg real). Defensive linemen take a gap step before they diagnose run or pass.
// Pass game: one QB brain per concept (dropback, play action — the second level bites on the fake —, bootleg, screen,
//   max-protect deep shot, flea flicker), a progression read, one swat attempt per ball.
// Kicks: punt and field-goal rushes, kickoff/punt return walls that honor the called lane (middle/left/right).
// Calls: situational CPU play calling, a 4th-down expected-points coach (coachFourth), kickoff type / return lane.
// The clock: the CPU's plan with the ball (clockPlan: a two-minute drill, a lead to protect, a last-snap field goal to
//   milk), its tempo, spikes, kneels and timeouts (world.js "the clock between plays"), and its ball carriers' sidelines
//   late in a half — competent at every difficulty (config.js CLOCK).
// FLIP: the CPU offense flips its calls (cpuFlip). A flipped play is the exact mirror image of the original: whatever
//   has no side of its own — a tie, a random spray — goes the mirrored way on a flipped play (playbook.js parOf).
import { FIELD_W, MID_Y, PHYS, KICKING, HOME_FIELD, RULES, TIMING } from "./config.js";
import { OFF_PLAYS, DEF_PLAYS, ZONES, ELIGIBLE, playsIn, offPlay, CLOCK_PLAYS, mirrorPlay, parOf } from "./playbook.js";
import { throwTo, startMove, tryEngage, release, launch, arm01, fgPowerFor, fgMakeProb, kickQuality, scrambleIQ } from "./physics.js";
import { HARD, FLIP, CLOCK, QB_RUN, PASS_RUSH, RUN_BLOCK, QB_READ, RISK, FAKE } from "./config.js";
import { hurried } from "./playerstats.js";
import { defFormation } from "./playbook.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const OL_SLOTS = ["LT", "LG", "C", "RG", "RT"];
const LINE_SLOTS = ["LT", "LG", "C", "RG", "RT", "TE"];
const DL_SLOTS = ["DE1", "NT", "DE2"];

export function steer(p, tx, ty, want = 1) {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  if (d < 0.08) { p.mx = 0; p.my = 0; p.want = 0; return d; }
  p.mx = dx / d; p.my = dy / d;
  p.want = d < 1.4 ? Math.max(0.12, d / 1.4) * want : want;
  return d;
}
// dy: aim this far off his lead spot across the field (an edge keeping outside leverage on a scrambler); effort: speed
// over his normal top (1.15: all-out pursuit of a runner)
function pursue(p, t, lead = 0.85, dy = 0, effort = 1.15) {
  let px = t.x, py = t.y;
  const sp = p.r.speed;
  for (let k = 0; k < 3; k++) {
    const T = Math.min(2.2, Math.hypot(px - p.x, py - p.y) / sp);
    px = t.x + t.vx * T * lead; py = t.y + t.vy * T * lead;
  }
  steer(p, px, clamp(py + dy, -1, FIELD_W + 1), effort);
  p.sprint = true;
}
const opp = (w, p) => (p.side === "O" ? w.def : w.off);
const mates = (w, p) => (p.side === "O" ? w.off : w.def);
const isPassPlay = (w) => w.call && w.call.off && w.call.off.type === "pass";
const scrimmage = (w) => w.playType === "normal" || w.playType === "two";

// How open a receiver is (yards of cushion at the predicted catch point). userRange (PRO to LEGEND, the CPU's QB):
// how much more ground the human's own defender is given credit for (he breaks on the ball like a person does)
export function openness(w, rec, qb, userRange = 0) {
  qb = qb || w.qb;
  if (!qb || rec.down > 0) return -9;
  // a deep ball / fade goes up as a lob: more hang time for the defense to close
  const deep = rec.x - qb.x > 17 || (rec.as && rec.as.name === "fade");
  const sp = deep ? 15 : 22;
  const T = Math.hypot(rec.x - qb.x, rec.y - qb.y) / sp;
  const lead = rec.ai.settle ? 0.2 : 0.9;
  const px = rec.x + rec.vx * T * lead, py = rec.y + rec.vy * T * lead;
  let best = 99;
  for (const d of w.def) {
    if (d.down > 0) continue;
    let dd = Math.hypot(d.x - px, d.y - py) - d.r.speed * T * (userRange && d === w.control ? userRange : 0.45);
    if (d.engaged) dd += 2;
    if (d.x > px) dd -= deep ? 1.1 : 0.4; // over the top
    if (dd < best) best = dd;
  }
  if (py < 1 || py > FIELD_W - 1) best -= 2;
  return best;
}

// Man coverage by alignment (world.setupPlay): a man defender whose receiver lines up on the other side of the ball
// trades receivers with the man defender who saves the most ground. The play's fixed order (man(2) = the widest inside
// receiver, whatever his side) sent the linebacker aligned on the right after a slot on the left (Cover 1, Cover 0,
// the 3-4's Cover 2 man): he never got there. Pairs already on the same side keep their receivers. Two trades that
// save the same ground (a linebacker over the back he'd trade, as against the BUNCH: they tie whatever the spots) go to
// the first in the defense's order, not to the last bit of the sums (FLIP: the mirrored down trades the same pair)
export function pairMan(w, def) {
  const by = w.ballY;
  const D = def.filter((d) => d.as && d.as.kind === "man" && d.as.n >= 2 && d.as.target);
  const lat = (d, r) => Math.abs(d.y - r.y);
  const crossed = (d) => { const a = d.y - by, b = d.as.target.y - by; return a * b < 0 && Math.abs(a) >= 1 && Math.abs(b) >= 2; };
  for (let k = 0; k < D.length; k++) {
    let best = null, gain = 0.5;
    for (const d of D) {
      if (!crossed(d)) continue;
      for (const e of D) {
        const g = e === d ? 0 : lat(d, d.as.target) + lat(e, e.as.target) - lat(d, e.as.target) - lat(e, d.as.target);
        if (g > gain + 1e-6) { gain = g; best = [d, e]; }
      }
    }
    if (!best) break;
    const [d, e] = best, t = d.as.target;
    d.as.target = e.as.target; e.as.target = t;
  }
}

// ---------- Snap-time setup (called by world.snap) ----------
// Per-play defender traits: how hard each one bites on play action, how long the backside edge stays home.
export function snapSetup(w) {
  const play = w.call.off;
  for (const d of w.def) {
    d.ai.bite = 0.4 + w.rng.next() * 1.6; // yards a second-level defender steps up on a run fake
    d.ai.contain = 0.55 + w.rng.next() * 0.45; // seconds a backside edge squeezes before he chases
  }
  w.swatTry = -1;
  w.flickT = null;
  w.readDef = null;
  // F1: a bad read — the CPU's QB misjudges how open each receiver is (config.js PHYS.READ_ERR × (1 − his team's skill))
  w.misread = null;
  if (PHYS.READ_ERR && play && play.type === "pass" && !play.clock && !(w.qb && w.qb === w.control && !w.autopilot)) {
    const qt = w.qb && w.qb.team && w.qb.team.ai, sk = qt && Number.isFinite(qt.skill) ? qt.skill : 0.5, sd = PHYS.READ_ERR * (1 - clamp(sk, 0, 1));
    w.misread = {};
    for (const s of ELIGIBLE) w.misread[s] = w.rng.gauss() * sd;
  }
  // MAN PRESS (a defensive audible, world.js defAudible): a pressed corner on his man's nose jams him at the snap
  if (w.defAud && w.defAud.press) for (const d of w.def) { const r = d.as && d.as.press ? d.as.target : null; if (r && d.distTo(r.x, r.y) < PHYS.JAM[0]) r.slow = Math.max(r.slow || 0, PHYS.JAM[1]); }
  if (play && play.type === "run") assignRunBlocks(w);
  if (play && play.screen) for (const p of w.off) if (p.as && p.as.block === "screen") p.ai.release = (play.release != null ? play.release : 0.85) + w.rng.next() * 0.2;
  assignPassPro(w);
  if (play && play.screen) assignConvoy(w);
  if (w.hard && !w.autopilot) hardSnap(w); // PRO to LEGEND
}

// Pass protection: the line (and any back or tight end who stays in) slides to the rushers. A non-crossing
// rusher↔blocker matching by lateral order (DP) that leaves the least dangerous rusher — the widest — free when
// they're outnumbered; interior rushers left free cost the most. Backs pick up what's left after their checks.
// w.hotRead: rushers the protection can't hold for long — left free, or picked up by a back who releases on a delayed
// route — so the QB knows to get the ball out early (qbThink); w.rushN: how many come
export function assignPassPro(w) {
  const by = w.ballY;
  const R = [], B = [];
  for (const d of w.def) if (d.as && d.as.kind === "rush") R.push(d);
  for (const p of w.off) {
    if (p === w.qb || p === w.carrierDesignate || !p.as) continue;
    const a = p.as;
    if ((a.kind === "block" && (a.block === "pass" || a.block === "screen")) || a.kind === "fake" || (a.kind === "route" && a.delay)) B.push(p);
  }
  w.hotRead = w.rushN = R.length;
  if (!R.length || !B.length) return;
  // (lateral order — from the other side on a FLIPped play: the same men in the same order, so the protection is the
  // mirror image)
  const par = parOf(w);
  R.sort((a, b) => (a.y - b.y) * par);
  B.sort((a, b) => (a.sy - b.sy) * par);
  const n = R.length, m = B.length;
  const unb = (r) => PASS_RUSH.FREE - Math.min(4.5, Math.abs(r.y - by) * 0.45); // (a man left free: the wider, the less it costs)
  const cost = (r, b) => Math.abs(r.y - b.sy) + (OL_SLOTS.includes(b.slot) ? 0 : b.slot === "TE" ? 0.3 : 0.9);
  // dp[i][j]: best cost with the first i rushers and the first j blockers; choice: 0 skip rusher, 1 skip blocker, 2 match
  const dp = [], ch = [];
  for (let i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); ch.push(new Array(m + 1).fill(0)); }
  for (let i = 1; i <= n; i++) { dp[i][0] = dp[i - 1][0] + unb(R[i - 1]); ch[i][0] = 0; }
  for (let j = 1; j <= m; j++) { dp[0][j] = 0; ch[0][j] = 1; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    let best = dp[i - 1][j] + unb(R[i - 1]), c = 0;
    if (dp[i][j - 1] < best) { best = dp[i][j - 1]; c = 1; }
    const mt = dp[i - 1][j - 1] + cost(R[i - 1], B[j - 1]);
    if (mt < best) { best = mt; c = 2; }
    dp[i][j] = best; ch[i][j] = c;
  }
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const c = ch[i][j];
    if (c === 2) { B[j - 1].ai.assigned = R[i - 1]; if (B[j - 1].as.kind !== "route") w.hotRead--; i--; j--; }
    else if (c === 1) j--;
    else i--;
  }
  // a lineman left over helps inside (PASS_RUSH.HELP): he doubles the interior rusher nearest him — the nose, a tackle —
  // so a man who beats his own blocker there still has him to get through (passBlock; physics.js separate). Pass plays
  // only: on a draw the line's pass set is a look, and a helper sitting in front of the back was in his lane.
  if (PASS_RUSH.HELP && w.call.off && w.call.off.type === "pass" && (PASS_RUSH.HELP === true || w.rng.chance(PASS_RUSH.HELP))) for (const b of B) {
    if (b.ai.assigned || !OL_SLOTS.includes(b.slot)) continue;
    let best = null, bd = 2.6;
    for (const r of R) { if (Math.abs(r.y - by) > 2.6) continue; const d = Math.abs(r.y - b.sy); if (d < bd) { bd = d; best = r; } }
    b.ai.help = best;
  }
}

// Run blocking: zone/gap count from the playside. Each line blocker takes the box defender in his playside gap
// (cost = lateral miss from his aiming point + depth); lead/pull blockers take the most dangerous unblocked man at
// the hole; receivers stalk the nearest defensive back. On the read option the read defender is left alone on purpose.
export function assignRunBlocks(w) {
  const play = w.call.off;
  const los = w.los, by = w.ballY;
  const holeY = w.runHoleY != null ? w.runHoleY : by;
  const s = w.runSide || 0;
  const car = w.carrierDesignate;
  const taken = new Set();
  if (play.option) {
    // the backside edge defender nearest the mesh is the read: nobody blocks him
    let rd = null, bd = -1e9;
    for (const d of w.def) {
      if (!DL_SLOTS.includes(d.slot) && !d.slot.startsWith("OLB")) continue;
      if (d.x > los + 4 || Math.abs(d.y - by) > 8) continue;
      const back = s ? -(d.y - by) * s : Math.abs(d.y - by);
      if (back > bd) { bd = back; rd = d; }
    }
    if (rd) { taken.add(rd); w.readDef = rd; }
  }
  if (play.rpo) {
    // the RPO: the man over its receiver (the overhang: no lineman, no corner) is left alone on purpose — the QB reads
    // him (rpoRead): if he plays the run, the throw is there
    const rec = w.bySlot(w.off, play.rpo), dl = w.teams[w.defTeam].scheme.def === "43" ? ["DE1", "NT", "DE2", "ILB2"] : DL_SLOTS;
    let key = null, kd = 1e9;
    if (rec) for (const d of w.def) { if (dl.includes(d.slot) || d.slot.startsWith("CB")) continue; const dd = d.distTo(rec.x, rec.y); if (dd < kd) { kd = dd; key = d; } }
    if (key) { taken.add(key); w.rpoKey = key; }
  }
  if (RUN_BLOCK.SCHEME) { assignRunScheme(w, play, taken); return; }
  const box = [];
  for (const d of w.def) if (d.x < los + 7.5 && Math.abs(d.y - by) < 13) box.push(d);
  // pullers kick out the end man on the line of scrimmage on the playside (the line then climbs past him); a trapping
  // guard the first man on the line past the center on the play side (the line lets him come, then blocks down past
  // him); a wrapping puller goes through the hole for a linebacker (below, as a lead block)
  if (s !== 0) for (const b of w.off) {
    if (b === car || !b.as || b.as.kind !== "block" || b.as.wrap || (b.as.block !== "pull" && b.as.block !== "trap")) continue;
    const trap = b.as.block === "trap";
    let best = null, bv = -1e9;
    for (const d of box) {
      if (taken.has(d) || d.x > los + 2.6 || Math.abs(d.y - by) > 6.2) continue; // the end man ON the line, not a wide OLB
      const v = (d.y - by) * s;
      if (trap ? v > 0.5 && -v > bv : v > bv) { bv = trap ? -v : v; best = d; }
    }
    b.ai.assigned = best;
    if (best) taken.add(best);
  }
  const line = [];
  for (const p of w.off) if (p !== car && p !== w.qb && p.as && p.as.kind === "block" && p.as.block === "run" && LINE_SLOTS.includes(p.slot)) line.push(p);
  // playside first (inside-out on inside runs)
  line.sort((a, b) => (s !== 0 ? (b.sy - a.sy) * s : Math.abs(a.sy - by) - Math.abs(b.sy - by)));
  // gap scheme on pull plays (power, counter): with the puller gone, aiming every man at his playside gap left the
  // defender over the puller and the backside end free (counter 0.6 yd/carry). Instead the puller's playside
  // neighbour fills for him (takes the man aligned over his spot), the rest of the playside blocks DOWN (inside
  // gap, outside-in), the backside cuts off toward the play, and the puller kicks out the end man (above).
  const puller = s !== 0 ? w.off.find((b) => b !== car && b.as && b.as.kind === "block" && b.as.block === "pull" && !b.as.wrap && LINE_SLOTS.includes(b.slot)) : null;
  const playside = (b) => puller && (b.sy - puller.sy) * s > 0;
  if (puller) {
    let fill = null;
    for (const b of line) if (playside(b) && (!fill || Math.abs(b.sy - puller.sy) < Math.abs(fill.sy - puller.sy))) fill = b;
    if (fill) {
      let best = null, bd = 1.5;
      for (const d of box) {
        if (taken.has(d) || d.x > los + 2.6) continue;
        const dd = Math.abs(d.y - puller.sy);
        if (dd < bd) { bd = dd; best = d; }
      }
      if (best) { fill.ai.assigned = best; taken.add(best); line.splice(line.indexOf(fill), 1); }
    }
    line.sort((a, b) => {
      const pa = playside(a), pb = playside(b);
      if (pa !== pb) return pa ? -1 : 1;
      return pa ? (a.sy - b.sy) * s : (b.sy - a.sy) * s;
    });
  }
  for (const b of line) {
    let best = null, bc = 4.4;
    const aimY = b.sy + (playside(b) ? -s : s) * 1.15;
    for (const d of box) {
      if (taken.has(d)) continue;
      const c = Math.abs(d.y - aimY) + Math.max(0, d.x - los - 1.6) * 0.55;
      if (c < bc) { bc = c; best = d; }
    }
    b.ai.assigned = best;
    if (best) taken.add(best);
  }
  for (const b of w.off) {
    if (b === car || !b.as || b.as.kind !== "block") continue;
    if ((b.as.block === "pull" || b.as.block === "trap") && s !== 0 && !b.as.wrap) continue; // already has his kick-out
    if (b.as.block === "lead" || b.as.block === "pull" || b.as.block === "trap") {
      let best = null, bc = 11;
      for (const d of box) {
        if (taken.has(d)) continue;
        const c = Math.abs(d.y - holeY) + Math.abs(d.x - (los + 1.5)) * 0.6 + (s !== 0 && (d.y - by) * s < -1 ? 4 : 0); // stay playside
        if (c < bc) { bc = c; best = d; }
      }
      b.ai.assigned = best;
      if (best) taken.add(best);
    } else if (b.as.block === "run" && !LINE_SLOTS.includes(b.slot)) {
      // receivers / backs: stalk the nearest defensive back (or the nearest free man)
      let best = null, bd = 12;
      for (const d of w.def) {
        if (taken.has(d) || !(d.slot.startsWith("CB") || d.slot.startsWith("S") || !box.includes(d))) continue;
        const dd = d.distTo(b.x, b.y);
        if (dd < bd) { bd = dd; best = d; }
      }
      b.ai.assigned = best;
      if (best) taken.add(best);
    }
  }
}

// The run blocking's count (config.js RUN_BLOCK), at the snap. The box: the front (within 2.8 yd of the line) and the
// second level (7.5 yd), 8.5 yd either side of the ball. The line — the five, and a tight end or wing on it — from the
// play side to the back side: a man with a front defender in his window blocks him (the zone's: head-up to his playside
// gap; the outside zone's, a gap further; a gap scheme's play side blocks down, its back side cuts off); an uncovered
// man doubles his neighbour's man (on his play side; down blocks, inside) and climbs to a linebacker (p.ai.combo:
// runBlock). A gap scheme's kick-out (the lead back, else its first puller) takes the end man past the hole, its wrap
// (the puller behind a lead back, a pulling tackle) the linebacker nearest the hole; a trap's guard the first lineman
// past the center on the play side, the lead back the linebacker; a lead back on a zone run (iso, the dive, the sneak)
// the linebacker nearest the hole. A front defender still free between the tackles gets a climber back. Whoever's left
// is the back side's edge (the cutback, the read) or a backside linebacker. Mirror-true: everything is measured toward
// the play side, ties go by slot order (the mirrored down has the same slots).
function assignRunScheme(w, play, taken) {
  const los = w.los, by = w.ballY, car = w.carrierDesignate;
  const holeY = w.runHoleY != null ? w.runHoleY : by;
  const L = (Math.abs(holeY - by) >= 0.3 ? Math.sign(holeY - by) : 0) || parOf(w);
  const rel = (y) => (y - by) * L; // + = toward the play side
  const relH = rel(holeY);
  const blockers = w.off.filter((b) => b !== car && b !== w.qb && b.as && b.as.kind === "block");
  const pullers = blockers.filter((b) => (b.as.block === "pull" || b.as.block === "trap") && LINE_SLOTS.includes(b.slot));
  const leads = blockers.filter((b) => b.as.block === "lead");
  const trapper = pullers.find((b) => b.as.block === "trap") || null;
  const gap = pullers.length > 0, outside = !gap && Math.abs(holeY - by) > 4;
  const front = [], second = [];
  for (const d of w.def) {
    if (taken.has(d) || Math.abs(d.y - by) > 8.5) continue;
    if (d.x - los < 2.8) front.push(d); else if (d.x - los < 7.5) second.push(d);
  }
  const line = blockers.filter((b) => b.as.block === "run" && Math.abs(b.sy - by) < 6.2 && b.sx > los - 2.4);
  line.sort((a, b) => rel(b.sy) - rel(a.sy));
  const give = (b, d) => { b.ai.assigned = d; taken.add(d); };
  const free = (d) => !taken.has(d);
  // the linebacker nearest a spot across the field (within maxLat), the shallower first
  const lbNear = (aimY, maxLat) => {
    let best = null, bc = maxLat;
    for (const d of second) { if (!free(d)) continue; const c = Math.abs(d.y - aimY) + (d.x - los) * 0.12; if (c < bc - 1e-6) { bc = c; best = d; } }
    return best;
  };
  // a gap scheme: the trap, or the kick-out on the end man and the wrap
  let wraps = [];
  if (trapper) {
    // the trap: the first lineman past the center on the play side, if he's at the hole (an odd front's end out wide
    // isn't: the man over the tackle blocks him, and the guard leads through for a linebacker)
    let best = null, bv = 1e9;
    for (const d of front) { const r = rel(d.y); if (free(d) && r > 0.5 && r < relH + 1 && r < bv - 1e-6) { bv = r; best = d; } }
    wraps = leads.slice();
    if (best) give(trapper, best); else wraps.unshift(trapper);
  } else if (gap) {
    // the kick-out: a pulling lineman (the first, not a wrapping tackle) on the end man — the widest front defender on
    // the play side past the hole within reach of it (one wider still is out of the play); the lead back and any other
    // puller wrap for the linebackers. The blocker on the line nearest the end man (a tackle or a tight end over him)
    // holds him at the snap until the kick-out gets there, then hands him over and climbs (the overtake: runBlock)
    const kicker = pullers.find((b) => !b.as.wrap) || pullers[0];
    wraps = pullers.filter((b) => b !== kicker).concat(leads);
    let best = null, bv = -1e9;
    for (const d of front) { const r = rel(d.y); if (free(d) && r > relH - 0.3 && r < relH + 3.6 && r > bv + 1e-6) { bv = r; best = d; } }
    let edge = null, ec = 1.8;
    if (best) for (const b of line) { const r = Math.abs(rel(best.y) - rel(b.sy)); if (r < ec - 1e-6) { ec = r; edge = b; } }
    if (best) {
      give(kicker, best);
      if (edge) { edge.ai.assigned = best; edge.ai.overtake = kicker; }
    } else wraps.unshift(kicker);
  }
  // the line's men with a front defender in their window
  const climbers = [];
  for (const b of line) {
    if (b.ai.assigned) continue;
    const rb = rel(b.sy), down = gap && rb > relH - 1.6;
    const [lo, hi, pref] = outside ? [-0.5, 2.8, 1.2] : down ? [-2.1, 0.6, -0.6] : [-0.7, 1.9, 0.8];
    let best = null, bc = 1e9;
    for (const d of front) {
      if (!free(d)) continue;
      const r = rel(d.y) - rb;
      if (r < lo || r > hi) continue;
      const c = Math.abs(r - pref);
      if (c < bc - 1e-6) { bc = c; best = d; }
    }
    if (best) give(b, best); else climbers.push(b);
  }
  // a gap scheme's wrap: the linebacker nearest the hole (the climbers then take the back side's); the overtaking
  // edge blocker's, the next one
  for (const b of wraps) { const lb = lbNear(holeY, 6.5); if (lb) give(b, lb); }
  for (const b of line) if (b.ai.overtake) { const lb = lbNear(holeY, 7); if (lb) { b.ai.climb = lb; taken.add(lb); } }
  // the climbers: a linebacker (his play side's on a zone run, the back side's on a down block) with the double first —
  // his neighbour's man, on his play side (inside on a down block), one nobody doubles yet. No linebacker for him: a
  // front defender still free within 3 yd (the back side's edge), else the double, and it stays on
  const doubled = new Set();
  for (const b of climbers) {
    const rb = rel(b.sy), down = gap && rb > relH - 1.6;
    const lb = lbNear(b.sy + L * (down ? -1.2 : 1), 4.5);
    if (lb) give(b, lb);
    else {
      let fd = null, fdd = 3;
      for (const d of front) { if (!free(d)) continue; const dy = Math.abs(d.y - b.sy); if (dy < fdd - 1e-6) { fdd = dy; fd = d; } }
      if (fd) { give(b, fd); continue; }
    }
    let dl = null, dd = 2.3;
    for (const o of line) {
      const d = o.ai.assigned;
      if (o === b || !d || o.ai.combo || !front.includes(d) || doubled.has(d)) continue;
      const r = rel(d.y) - rb;
      if (lb && (down ? r > 0.3 : r < -0.3)) continue;
      if (Math.abs(r) < dd - 1e-6) { dd = Math.abs(r); dl = d; }
    }
    if (!dl) continue;
    doubled.add(dl);
    b.ai.combo = { dl, at: lb ? RUN_BLOCK.CLIMB[0] + w.rng.next() * RUN_BLOCK.CLIMB[1] : 99 };
    if (!lb) b.ai.assigned = dl; // (nobody left to climb to: the double stays on)
  }
  // a lead back on a zone run (iso, the dive, the sneak, the toss): whoever's still free nearest the hole (the
  // linebacker the line couldn't reach, the end man on a toss)
  if (!gap && !trapper) for (const b of leads) {
    let best = null, bc = 7.5;
    for (const d of front.concat(second)) {
      if (!free(d)) continue;
      const c = Math.abs(d.y - holeY) + Math.max(0, d.x - los - 1) * 0.3 + (rel(d.y) < relH - 2.5 ? 3 : 0);
      if (c < bc - 1e-6) { bc = c; best = d; }
    }
    if (best) give(b, best);
  }
  // a front defender still free between the tackles: a climber (the nearest) comes back for him; then anyone left with
  // nothing takes the nearest front defender still free within 3 yd (a backside wing on the edge)
  for (const d of front) {
    if (!free(d) || Math.abs(d.y - by) > 3.4) continue;
    let best = null, bd = 3.5;
    for (const b of climbers) { const dy = Math.abs(b.sy - d.y); if (dy < bd - 1e-6) { bd = dy; best = b; } }
    if (best) { const old = best.ai.assigned; if (old && old !== d) taken.delete(old); best.ai.combo = null; give(best, d); }
  }
  for (const b of line) {
    if (b.ai.assigned) continue;
    let best = null, bd = 3;
    for (const d of front) { if (!free(d)) continue; const dy = Math.abs(d.y - b.sy); if (dy < bd - 1e-6) { bd = dy; best = d; } }
    if (best) give(b, best);
  }
  // the receivers and backs on the perimeter: stalk the nearest defensive back (or the nearest man nobody has)
  for (const b of blockers) {
    if (b.ai.assigned || b.as.block !== "run" || line.includes(b)) continue;
    let best = null, bd = 12;
    for (const d of w.def) {
      if (!free(d) || !(d.slot.startsWith("CB") || d.slot.startsWith("S") || !(front.includes(d) || second.includes(d)))) continue;
      const dd = d.distTo(b.x, b.y);
      if (dd < bd - 1e-6) { bd = dd; best = d; }
    }
    if (best) give(b, best);
  }
}

// ---------- QB scramble (read once a tick, for both teams' defenders and the blocks) ----------
// A quarterback who leaves the pocket with the ball is a runner as well as a passer. Level 1: he's out of the pocket
// (outside the tackle box, or drifting hard toward a sideline): the edge keeps contain, the spy closes, the underneath
// zones slide with him and blocks set for the pocket stop holding (physics.blocking). Level 2: he's running (upfield
// at speed, or at the line): the defense rallies to him, except whoever is on top of a deep receiver, who stays there
// until he crosses the line. The pocket moves with a designed bootleg.
function readScramble(w, dt) {
  let s = w.scr;
  if (!s || s.play !== w.playNo) s = w.scr = { play: w.playNo, level: 0, out: 0, run: 0, t1: 0, t2: 0, side: 0 };
  const qb = w.qb, play = w.call.off;
  if (s.level >= 2 || !qb || !play || play.type !== "pass" || w.passThrown || w.ball.carrier !== qb || (play.flea && w.flickT == null)) return s;
  // dy: how far outside the pocket he is (a bootleg's pocket is its whole rollout lane, the ball to the boot spot)
  let dy = qb.y - w.ballY;
  if (play.boot) {
    const far = clamp(w.ballY - play.boot * 8.5, 4, FIELD_W - 4), lo = Math.min(w.ballY, far), hi = Math.max(w.ballY, far);
    dy = qb.y < lo ? qb.y - lo : qb.y > hi ? qb.y - hi : 0;
  }
  const out = Math.abs(dy) > PHYS.SCRAMBLE_BOX || (Math.abs(dy) > 3 && qb.vy * dy > 0 && Math.abs(qb.vy) > 4.2);
  s.out = out ? s.out + dt : Math.max(0, s.out - dt);
  const run = qb.ai.scramble || w.losCrossed || qb.x > w.los - 1 || (qb.vx > 3 && qb.x > w.los - 4.25);
  s.run = run ? s.run + dt : 0;
  if (s.level < 1 && s.out > 0.1) { s.level = 1; s.t1 = w.t; s.side = Math.sign(dy) || parOf(w); }
  if (s.run > 0.1 || qb.ai.scramble || w.losCrossed) {
    if (s.level < 1) { s.t1 = w.t; s.side = Math.sign(dy) || parOf(w); }
    s.level = 2; s.t2 = w.t;
  }
  return s;
}
// the scramble state of this down while the QB still has it behind the line (null otherwise)
function scrambling(w, lvl) {
  const s = w.scr;
  return s && s.play === w.playNo && s.level >= lvl && w.qb && w.ball.carrier === w.qb && !w.passThrown && !w.losCrossed ? s : null;
}

// ---------- Change of possession on a scrimmage down ----------
// An interception turns the down around: every block lets go at once (the protection was set against the other
// team), the old defense blocks for the man with the ball and the old offense becomes the pursuit (returnPlay) — each
// man once he's seen it (PHYS.TURN_REACT: the farther from the catch, the later; until then he finishes what he was
// doing). A fumble: both teams go for the loose ball (the play ends when someone falls on it).
// → the turnover state ({kind: "return" | "loose", t, react: Map player → seconds}), or null
function readTurnover(w) {
  const b = w.ball;
  const kind = b.state === "loose" && b.kind === "fumble" ? "loose" : b.state === "held" && b.carrier && b.carrier.side === "D" ? "return" : null;
  if (!kind) return null;
  let s = w.turn;
  if (!s || s.play !== w.playNo || s.kind !== kind) {
    s = w.turn = { play: w.playNo, kind, t: w.t, react: new Map() };
    for (const p of w.players) if (p.engaged && p.blocking) release(p, p.engaged);
    if (kind === "return") { const [r0, r1] = PHYS.TURN_REACT; for (const p of w.off) s.react.set(p, r0 + r1 * p.distTo(b.x, b.y)); }
  }
  return s;
}

// ---------- Per-tick brains ----------
export function think(w, dt) {
  const ps = w.players;
  const b = w.ball;
  const k = w.playType;
  if (scrimmage(w)) readScramble(w, dt);
  const turn = scrimmage(w) ? readTurnover(w) : null;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    p.sprint = false;
    if (p.ai.freeUntil && w.t >= p.ai.freeUntil) { p.ai.free = false; p.ai.freeUntil = 0; } // (a rusher through the line: physics.js blocking)
    // screen: the linemen let their rushers go and release to lead the back
    if (p.engaged && p.blocking && p.as && p.as.block === "screen" && w.t >= (p.ai.release || 0.9)) release(p, p.engaged);
    if (p === w.control && !w.autopilot && w.userDrives(p)) continue;
    if (w.seats && w.seatDrives(p)) continue; // two humans (online, seats.js): the other seat's player too
    if (p.engaged && p.blocking && p.ai.overtake && !p.ai.handed) overtake(w, p); // (a block he hands over: runBlock)
    if (!p.canAct || p.engaged) { if (p.engaged && !p.blocking) rusherPress(w, p); else p.want = 0; continue; }
    if (k !== "normal" && k !== "two" && w.kicked) {
      if (b.state === "held" && b.carrier) {
        if (p.hasBall) { carrierThink(w, p, dt); continue; }
        if (k === "kickoff" || k === "punt") { kickThink(w, p, dt); continue; }
        returnPlay(w, p, b.carrier); continue; // blocked field goal / PAT scooped up
      }
      if (b.state === "loose" && (b.kind === "blocked" || b.kind === "muff")) { chaseLoose(w, p); continue; }
    }
    if (k === "kickoff" || k === "punt") { kickThink(w, p, dt); continue; }
    if (k === "fg" || k === "pat") { fgThink(w, p); continue; }
    if (turn && !p.hasBall) {
      if (turn.kind === "loose") chaseLoose(w, p);
      else if (p.side === "D" || w.t - turn.t >= turn.react.get(p)) returnPlay(w, p, b.carrier);
      // (one who hasn't seen it yet carries on the way he was going: no new block, no new route step)
      continue;
    }
    if (p === w.qb && p.hasBall && !w.handedOff && w.call.off && (w.call.off.type === "run" || (w.call.off.flea && w.flickT == null)) && w.call.off.carrier !== "QB") continue; // scripted handoff steering
    if (p === w.carrierDesignate && p.ai.path && (!w.handedOff || (b.state === "air" && b.kind === "pitch" && b.target === p))) { followPath(w, p); continue; }
    if (p.hasBall) { carrierThink(w, p, dt); continue; }
    if (p.side === "O") offThink(w, p, dt); else defThink(w, p, dt);
  }
}

function followPath(w, p) {
  const ai = p.ai;
  if (ai.wp >= ai.path.length) { p.want = 0.4; return; }
  const [tx, ty] = ai.path[ai.wp];
  const play = w.call.off;
  // before a mesh handoff the back doesn't outrun his QB: on a draw he sits at the mesh point until the QB comes
  // off his fake drop; on any handoff, past the mesh point he throttles down until the QB is within reach
  // (a QB's draw: he sets up as if to pass, a step back, until it's time: world.js hands it to him then)
  if (p === w.qb && play && play.carrier === "QB" && play.delay && !w.handedOff) { steer(p, p.sx - 1.4, p.sy, 0.5); return; }
  const mesh = !w.handedOff && play && play.type === "run" && !play.toss && w.qb && w.qb !== p && w.ball.carrier === w.qb;
  if (mesh && play.delay && w.t < play.delay && ai.wp >= 1) { p.want = 0; return; }
  const d = steer(p, tx, ty, mesh && ai.wp >= 1 && w.qb.distTo(p.x, p.y) > (play.delay ? 2.2 : 3.2) ? 0.35 : 1);
  p.sprint = play && play.toss;
  if (d < 1.1) ai.wp++;
}
// the back's way to the next spot on his path, the ball his and the line near (3.2 yd): shut by a block (two bodies) or
// a defender standing in it, 0.2–2.4 yd ahead
function runShut(w, p, tx, ty, dir) {
  if (!w.handedOff || w.ball.carrier !== p || (w.los - p.x) * dir > 3.2) return false;
  const dx = tx - p.x, dy = ty - p.y, m = Math.hypot(dx, dy) || 1, ux = dx / m, uy = dy / m;
  for (const q of w.players) {
    if (q === p || q.down > 0 || (q.side === p.side && !q.engaged)) continue;
    const rx = q.x - p.x, ry = q.y - p.y, along = rx * ux + ry * uy;
    if (along > 0.2 && along < 2.4 && Math.abs(rx * uy - ry * ux) < 0.95) return true;
  }
  return false;
}
function rusherPress(w, p) {
  // an engaged player keeps fighting toward the ball: the carrier if he's an opponent, else the passer / the kick
  const b = w.ball;
  let tx, ty;
  const c = b.carrier;
  if (c && c.side !== p.side) { tx = c.x; ty = c.y; }
  else if (p.side === "D" && w.qb && scrimmage(w)) { tx = w.qb.x; ty = w.qb.y; }
  else if (b.state === "air") { tx = b.tx; ty = b.ty; }
  else if (b.state === "loose") { tx = b.x; ty = b.y; }
  else { p.mx = p.side === "O" ? 1 : -1; p.my = 0; p.want = 1; return; }
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
  p.mx = dx / d; p.my = dy / d; p.want = 1;
}
function chaseLoose(w, p) {
  const b = w.ball;
  const d = p.distTo(b.x, b.y);
  if (d < 16) { steer(p, b.x, b.y, 1.1); p.sprint = true; } else p.want = 0;
}
// a ball carrier on a return of a blocked kick: his team escorts, the other team pursues
function returnPlay(w, p, c) {
  if (p.side === c.side) escort(w, p, c);
  else pursue(p, c, 0.85);
}

// ---------- Ball carrier ----------
export function carrierThink(w, p, dt) {
  const dir = p.side === "O" ? 1 : -1;
  const ai = p.ai;
  const play = w.call.off;
  if (ai.gotBallT == null || ai.ballOwner !== w.playNo) { ai.gotBallT = w.t; ai.ballOwner = w.playNo; }
  if (p === w.qb && p.side === "O" && play && play.type === "pass" && !w.passThrown && !w.losCrossed && !ai.scramble && scrimmage(w) && (!play.flea || w.flickT != null)) {
    qbThink(w, p, dt);
    return;
  }
  // flea flicker: the back runs at the line to sell it, then pitches it back (world.scriptedActions)
  if (play && play.flea && p.side === "O" && !w.flickT && p.as && p.as.kind === "flea") { steer(p, w.los - 1.2, p.y, 0.8); return; }
  if (p.slot === "QB" && play && play.carrier === "QB" && !ai.path) { ai.path = play.run.map(([dx, dy]) => [w.los + dx, clamp(w.ballY - dy, 1, FIELD_W - 1)]); ai.wp = 0; }
  // kneel in the end zone on deep kicks
  if (w.returnKneel && p === w.returner) { p.want = 0; p.mx = 0; p.my = 0; return; }
  // scripted run path while behind the line — until (config.js RUN_BLOCK.VISION), the ball in his hands near the line,
  // his way to the hole is shut (a block or a man standing in it): then he picks his own lane, pulled toward the hole
  if (ai.path && ai.wp < ai.path.length && (p.x - w.los) * dir < 1.5 && scrimmage(w) && !ai.vision) {
    const [tx, ty] = ai.path[ai.wp];
    if (!(RUN_BLOCK.VISION && runShut(w, p, tx, ty, dir))) {
      const d = steer(p, tx, ty, 1);
      if (d < 1.1) ai.wp++;
      p.sprint = w.t > 0.8 || (play && play.toss);
      return;
    }
    ai.vision = true;
  }
  // open-field running: score directions
  const others = opp(w, p);
  const mine = mates(w, p);
  let best = -1e9, bx = dir, by = 0;
  const prev = ai.lane || 0;
  // kick returners commit north-south the longer they run (no endless sideline dancing) and follow the called lane
  const isRet = w.playType === "kickoff" || w.playType === "punt";
  const sinceBall = w.t - (ai.gotBallT || 0);
  const commit = isRet ? Math.max(0, Math.min(1, (sinceBall - 1.5) / 3)) : 0;
  const laneY = isRet && p === w.returner && w.returnLaneY != null && sinceBall < 2.6 ? w.returnLaneY : null;
  const plan = sidelinePlan(w, p);
  const par = parOf(w), mir = par < 0; // (two lanes equally good: the mirrored one on a FLIPped play)
  for (let k = -6; k <= 6; k++) {
    const ang = k * 0.26;
    const ux = Math.cos(ang) * dir, uy = Math.sin(ang);
    let s = Math.cos(ang) * (1.6 + commit * 1.0);
    for (const d of others) {
      if (d.down > 0) continue;
      const rx = d.x - p.x, ry = d.y - p.y;
      const along = rx * ux + ry * uy;
      if (along < -1.5 || along > 14) continue;
      const perp = Math.abs(rx * uy - ry * ux);
      const width = 1.6 + Math.max(0, along) * 0.32;
      if (perp > width) continue;
      let th = (1 - perp / width) * (1 - Math.max(0, along) / 15) * 2.2;
      if (d.engaged) th = along < 3.2 && perp < 1.2 ? 1.6 : th * 0.25; // a block in my lane is a wall
      if (d.stun > 0) th *= 0.4;
      s -= th;
    }
    // my own blockers are obstacles too (find the hole between them)
    for (const m of mine) {
      if (m === p) continue;
      const rx = m.x - p.x, ry = m.y - p.y;
      const along = rx * ux + ry * uy;
      if (along < 0 || along > 3.4) continue;
      const perp = Math.abs(rx * uy - ry * ux);
      if (perp < 1.15) s -= (1.15 - perp) * 1.4 * (m.engaged ? 1.3 : 0.7);
    }
    const ny = p.y + uy * 6;
    if (ny < 2) s -= (2 - ny) * 0.7;
    if (ny > FIELD_W - 2) s -= (ny - FIELD_W + 2) * 0.7;
    if (laneY != null) s -= Math.abs(ny - laneY) * 0.06; // the called return lane
    // (a back who left his path at the line: still drawn to the hole while he's behind it)
    if (ai.vision && w.runHoleY != null && (p.x - w.los) * dir < 2) { const hx = w.los + dir * 1.5 - p.x, hy = w.runHoleY - p.y, hm = Math.hypot(hx, hy) || 1; s += RUN_BLOCK.VISION * (ux * hx + uy * hy) / hm; }
    // the clock: a hurry-up heads for the near sideline (the penalty above is lifted), a team running it out stays in
    if (plan > 0) s += outBound(ny) * 1.05 + (Math.min(p.y, FIELD_W - p.y) < CLOCK.SIDELINE ? (p.y < MID_Y || (p.y === MID_Y && mir) ? -uy : uy) * 0.7 : 0);
    else if (plan < 0 && (ny < 4 || ny > FIELD_W - 4)) s -= 0.6;
    if (k === prev) s += 0.25;
    if (s > best || (mir && s === best)) { best = s; bx = ux; by = uy; ai.lane = k; }
  }
  p.mx = bx; p.my = by; p.want = 1;
  // sprint in space
  let nearest = 99, nd = null;
  for (const d of others) {
    if (d.down > 0 || d.engaged) continue;
    const dd = d.distTo(p.x, p.y);
    if (dd < nearest) { nearest = dd; nd = d; }
  }
  p.sprint = nearest > 3.5 || w.t > 1.5;
  // special moves when a tackler closes in
  if (nd && nearest < 2.3 && p.moveCool <= 0 && !p.move && w.rng.chance(dt * (0.45 + p.r.agility / 220) * (w.cpuMoves || 1))) {
    const ahead = (nd.x - p.x) * dir > 0;
    const side = Math.sign(p.y - nd.y) || par;
    const r = w.rng.next();
    if (ahead && p.r.power > nd.r.power * 1.05 && r < 0.45) startMove(w, p, r < 0.22 ? "truck" : "stiff", dir, 0);
    else if (r < 0.75) startMove(w, p, "juke", 0, side);
    else startMove(w, p, "spin", dir, 0);
  }
  // dive for the line to gain / goal line when about to be wrapped up
  if (nd && nearest < 1.2 && p.side === "O" && !p.move && scrimmage(w)) {
    const toLine = w.los + w.toGo - p.x;
    if ((toLine > 0 && toLine < 1.6) || (100 - p.x > 0 && 100 - p.x < 1.8)) startMove(w, p, "dive", 1, 0);
  }
}

// The clock and the sidelines (a CPU carrier on offense, late in a half): +1 get out of bounds (its hurry-up), −1 stay
// in bounds (running out the clock), 0 no preference
function sidelinePlan(w, p) {
  if (p.side !== "O" || w.playType !== "normal" || w.ot || w.isUserTeam(w.possession)) return 0;
  if (w.noHuddle[w.possession]) return 1;
  return w.tempo && (w.tempo.kind === "chew" || w.tempo.kind === "milk") ? -1 : 0;
}
// how far past a sideline a heading 6 yd ahead takes him (yd), the same measure the sideline penalty uses
const outBound = (ny) => Math.max(0, 2 - ny, ny - FIELD_W + 2);

// ---------- QB (CPU / autopilot) ----------
function qbThink(w, qb, dt) {
  const play = w.call.off;
  const ai = qb.ai;
  const t = w.t;
  const los = w.los;
  const under = Math.abs(qb.sx - los) < 2;
  // pressure: nearest free rusher he can see — one coming from behind him (the blind side) he only feels when it's
  // too late; the throw still gets rushed by anyone close. soon: seconds until the first one he sees gets to him
  let pr = 99, prD = null, near = 99, soon = 9;
  for (const d of w.def) {
    if (d.down > 0 || d.engaged) continue;
    const dd = d.distTo(qb.x, qb.y);
    if (dd < near) near = dd;
    if (d.x < qb.x - 0.4 && dd > 1.0) continue;
    if (dd < pr) { pr = dd; prD = d; }
    const cl = ((qb.x - d.x) * (d.vx - qb.vx) + (qb.y - d.y) * (d.vy - qb.vy)) / (dd || 1);
    soon = Math.min(soon, Math.max(0, dd - 1.2) / Math.max(2.5, cl));
  }
  w.pressure = clamp((4 - near) / 3, 0, 1);
  // play action: ride the back to the mesh first
  const fakeT = 0.62;
  if (play.pa && t < fakeT) { steer(qb, los - 3.2, w.ballY + (play.boot ? play.boot * 0.8 : -0.6 * parOf(w)), 0.95); return; }
  // set point
  let sx = qb.sx, sy = qb.sy;
  if (play.flea) { sx = los - 7.2; sy = w.ballY; }
  else if (play.boot) { sx = los - 6; sy = clamp(w.ballY - play.boot * (t > 1.0 ? 8.5 : 4), 4, FIELD_W - 4); }
  else if (play.pa) sx = los - (play.deep ? 7.8 : 7);
  else if (play.quick) sx = under ? los - 4 : qb.sx - 0.8;
  else if (play.screen) sx = under ? los - 7.5 : qb.sx - 3;
  else sx = under ? los - 6.6 : qb.sx - 1.6 - (play.drop || 0) * 0.3;
  if (prD && pr < 3.2 && t > 0.6) {
    // slide away from pressure (climb the pocket / roll away)
    const ax = qb.x - prD.x, ay = qb.y - prD.y, m = Math.hypot(ax, ay) || 1;
    sx = qb.x + (ax / m) * 1.6 + 0.6; sy = qb.y + (ay / m) * 2;
  }
  steer(qb, sx, clamp(sy, 3, FIELD_W - 3), play.boot ? 1 : 0.85);
  if (play.boot && t > 0.9) qb.sprint = pr < 4;
  let readStart = play.read || (play.quick ? 0.9 : play.deep ? 2.25 : play.boot ? 1.75 : play.pa ? 1.9 : play.screen ? 1.4 : 1.75);
  if (!play.screen) readStart = readStart * QB_READ.K + QB_READ.ADD;
  if (play.flea) readStart = (w.flickT || 99) + 0.3;
  if (qb.teamKey !== w.user) readStart += w.qbReadDelay || 0; // difficulty / the league ladder: the CPU's QB only
  if (w.crowd) readStart += HOME_FIELD.READ * w.crowd; // a visiting QB in a loud building on a big down (world.js homeField)
  const prog = play.prog || ELIGIBLE;
  // the CPU's QB (the user's throws are the user's): the pocket is about to cave in, or the protection can't block
  // everyone (assignPassPro: w.hotRead) — he can't wait for his reads
  if (qb !== w.control || w.autopilot) {
    const sk = qb.team && qb.team.ai && Number.isFinite(qb.team.ai.skill) ? qb.team.ai.skill : 0.5;
    // a rusher about to get home and nobody open (the pressure throw's bar, below): throw it away — a sharp QB more
    // often, a raw one hangs in there and takes what comes (decided once a down)
    if (soon < PHYS.SACK_SOON && t > (play.pa ? fakeT : 0.35) && pr > 1.0 && w.qbHold !== w.playNo && !play.fake) {
      const [, o] = bestRec(w, qb, play, prog, t, readStart);
      if (o <= 1.7) {
        w.qbHold = w.playNo;
        const [a0, a1] = PHYS.THROW_AWAY;
        if (w.rng.chance(a0 + (a1 - a0) * sk)) { throwAway(w, qb); return; }
      }
    }
    // hot read: a rusher's coming free and he saw it (decided once a down; an all-out look — two free, or seven
    // coming — is hard to miss) — the ball comes out early, to the first man open enough (a quick QB sees it sooner)
    if (w.hotRead > 0 && !play.screen && t < readStart) {
      if (w.hotSeen == null || w.hotSeen.play !== w.playNo) { const [h0, h1] = PHYS.HOT_SEE[w.hotRead > 1 || w.rushN >= 7 ? 1 : 0]; w.hotSeen = { play: w.playNo, yes: w.rng.chance(h0 + (h1 - h0) * sk) }; }
      const hotT = (play.pa ? fakeT + 0.15 : under ? 0.7 : 0.5) + (1 - sk) * 0.2 + (qb.teamKey !== w.user ? Math.max(0, w.qbReadDelay || 0) * 0.5 : 0);
      if (w.hotSeen.yes && t >= hotT) {
        const [r, o] = bestRec(w, qb, play, prog, t, readStart);
        if (r && o > PHYS.HOT_OPEN) { doThrow(w, qb, r, o); return; }
      }
    }
  }
  if (t < readStart) return;
  // the user's QB: auto drop + pocket feel, but the throw is the user's unless they leave it alone (assist after 3.4 s)
  if (qb === w.control && !w.autopilot && t < 3.4) return;
  // (PRO to LEGEND: quicker reads down the progression, and a lower bar sooner)
  const H = hardOf(w, qb);
  const idx = Math.min(prog.length - 1, Math.floor((t - readStart) / (H ? HARD.READ_STEP[H - 1] : 0.45)));
  const thr = H ? Math.max(HARD.THR[H - 1][1], HARD.THR[H - 1][0] - (t - readStart) * HARD.THR_FALL[H - 1]) : Math.max(0.9, 2.8 - (t - readStart) * 0.7);
  let bestR = null, bestO = -99;
  for (let i = 0; i < prog.length; i++) {
    const r = w.bySlot(w.off, prog[i]);
    const o = rateRec(w, qb, play, r, t, readStart);
    if (o == null) continue;
    // (hard: high to low — a dump-off short of the sticks waits until the downfield reads have had their look)
    if (i <= idx && o > thr && !(H && checkDown(w, play, r) && t - readStart < HARD.CHECKDOWN[H - 1] && pr > 2.4)) { doThrow(w, qb, r, o); return; }
    if (o > bestO) { bestO = o; bestR = r; }
  }
  // a fake (world.fakeGo): 4th down, nobody open soon enough → he runs it himself (a throw away gives the ball up)
  if (play.fake && (t > readStart + FAKE.HOLD || pr < 1.6) && !(bestR && bestO > 1.2)) { ai.scramble = true; return; }
  if (pr < 1.9 || t > 4.4) {
    if (bestR && bestO > (t > 4.4 ? 0.5 : 1.7)) { doThrow(w, qb, bestR, bestO); return; }
    if (t > 4.4 || (pr < 1.8 && w.rng.chance(dt * 5))) {
      // nobody open and the rush is there: take off if there's room, else live to fight another down
      if (qb.r.speed > 6.6 && pr > 1.2 && w.rng.chance(0.45)) { ai.scramble = true; return; }
      if (pr > 0.8 && w.rng.chance(0.55)) throwAway(w, qb);
    }
  }
}
// a receiver as the QB values him now (null: not an option yet): how open he is; on late downs, past the sticks is
// worth more and a dump-off short of a long first down less; deep shots look deep first; a screen once it's set up
function rateRec(w, qb, play, r, t, readStart) {
  if (!r || !r.as || r.as.kind !== "route" || r.down > 0) return null;
  if (r.as.delay && t < r.as.delay + 0.4) return null;
  const H = hardOf(w, qb); // (PRO to LEGEND: respect for the human's own defender, his stars get the ball, and a
  //                          catch that moves the chains is worth more than a dump-off)
  const depth = r.x - w.los;
  let o = H ? openness(w, r, qb, HARD.USER_RANGE[H - 1]) + starBonus(w, r, H) + clamp((depth - 0.6 * w.toGo) * HARD.DEPTH[H - 1], -0.5, 0.6) : openness(w, r, qb);
  if (w.misread && w.misread[r.slot]) o += w.misread[r.slot]; // (F1: a bad read, snapSetup)
  if (w.down >= 3 && depth > w.toGo - 0.5) o += 0.6;
  if (depth < 1 && w.toGo > 4 && !play.screen) o -= 0.6;
  if (play.deep && depth > 14) o += 0.7;
  if (play.screen && (r.as.name === "screen" || r.as.scr)) { if (r.ai.settle || t > readStart + 0.35) o += 1.6; else o -= 3; }
  return o;
}
// the best-valued receiver anywhere in the progression → [receiver, value] (the hot throw, the check-down)
function bestRec(w, qb, play, prog, t, readStart) {
  let best = null, bo = -99;
  for (const slot of prog) {
    const r = w.bySlot(w.off, slot);
    const o = rateRec(w, qb, play, r, t, readStart);
    if (o != null && o > bo) { bo = o; best = r; }
  }
  return [best, bo];
}
function doThrow(w, qb, r, o) {
  const depth = r.x - qb.x;
  let under = false;
  for (const d of w.def) if (d.distTo(r.x, r.y) < 3 && d.x < r.x) under = true;
  const fade = r.as && r.as.name === "fade";
  const lob = fade || (depth > 17 && (under || w.rng.chance(0.4)));
  throwTo(w, qb, r, lob, lob ? (fade ? 0.4 : 0.6) : 0); // the fade goes up quick, to the back shoulder
}
export function throwAway(w, qb) {
  const b = w.ball;
  const side = qb.y < MID_Y || (qb.y === MID_Y && parOf(w) < 0) ? -1 : 1;
  qb.hasBall = false;
  b.state = "air"; b.kind = "pass"; b.carrier = null; b.thrower = qb; b.target = null; b.tipped = false;
  const ty = side < 0 ? -4 : FIELD_W + 4;
  launch(b, qb.x, qb.y, 2.1, Math.max(qb.x + 8, w.los + 2), ty, 0.5, Math.max(0.6, Math.abs(ty - qb.y) / 20));
  w.passThrown = true;
  w.thrownAway = true;
  w.passId = (w.passId || 0) + 1;
  qb.anim = "throw"; qb.animT = 0;
  hurried(w, qb); // (who forced it: a pressure)
  w.bus.emit("throw", { qb, target: null, ball: b, away: true });
}

// ---------- Offense ----------
function offThink(w, p, dt) {
  const as = p.as || {};
  const b = w.ball;
  const carrier = b.carrier;
  const play = w.call.off;
  // pass in the air: the target tracks the ball and times his arrival at the catch point (no early arrival + stop)
  if (b.state === "air" && (b.kind === "pass" || b.kind === "lob")) {
    if (b.target === p) {
      // he runs to where the throw was meant to go and adjusts only part of the way to a bad ball
      // (and stays on the field: a ball over his head at the back of the end zone sails out, he doesn't follow it)
      const k = PHYS.THROW_ADJUST;
      const gx = clamp(b.ix != null ? b.ix + (b.tx - b.ix) * k : b.tx, -9.4, 109.4), gy = clamp(b.iy != null ? b.iy + (b.ty - b.iy) * k : b.ty, 0.5, FIELD_W - 0.5);
      const left = Math.max(0.04, b.T - b.t), dx = gx - p.x, dy = gy - p.y, d = Math.hypot(dx, dy);
      const need = d / left;
      if (d > 0.05) { p.mx = dx / d; p.my = dy / d; }
      p.want = clamp(need / p.r.speed, d < 0.3 ? 0 : 0.25, 1.15);
      p.sprint = need > p.r.speed * 0.95;
      return;
    }
  }
  // someone else carrying past the line (or a screen caught): block for them
  if (carrier && carrier !== p && carrier.side === "O" && (w.losCrossed || w.handedOff || (as.block === "screen" && w.passThrown)) && p.slot !== "QB" && !(play && play.flea && !w.flickT)) {
    if (as.kind !== "block" || w.losCrossed || as.block === "screen") { escort(w, p, carrier); return; }
  }
  if (as.kind === "route") {
    if (w.handedOff && play.type === "run") { escort(w, p, carrier || p); return; }
    if (as.delay && w.t < as.delay) { passBlock(w, p); return; }
    runRoute(w, p);
    return;
  }
  if (as.kind === "block") {
    if (as.block === "pass") passBlock(w, p);
    else if (as.block === "screen") screenBlock(w, p);
    else if (as.block === "lead") leadBlock(w, p);
    else if (as.block === "pull" || as.block === "trap") pullBlock(w, p);
    else runBlock(w, p);
    return;
  }
  if (as.kind === "fake") {
    if (w.t < 0.9) { steer(p, w.los + 1, w.ballY + (p.y < w.ballY || (p.y === w.ballY && parOf(w) < 0) ? 1 : -1), 0.9); return; }
    passBlock(w, p);
    return;
  }
  if (as.kind === "flea") { passBlock(w, p); return; } // after the pitch back
  if (as.kind === "qb") {
    if (play && play.flea) { steer(p, w.los - 7.2, w.ballY, 0.9); return; } // drop for the pitch back
    // after the handoff: carry out the fake / boot
    if (w.handedOff) steer(p, p.sx - 4, p.sy + (p.sy < MID_Y || (p.sy === MID_Y && parOf(w) < 0) ? 5 : -5), 0.5);
    else steer(p, p.x, p.y, 0);
    return;
  }
  p.want = 0;
}
function runRoute(w, p) {
  const ai = p.ai;
  const wps = ai.wps;
  if (!wps) { p.want = 0; return; }
  if (ai.wp < wps.length) {
    const [tx, ty] = wps[ai.wp];
    const d = steer(p, tx, ty, 1);
    p.sprint = true;
    if (d < 0.7) ai.wp++;
    return;
  }
  if (p.as.settle) {
    ai.settle = true;
    // settle in the hole: drift away from the nearest defender a little
    let nd = null, nn = 99;
    for (const d of w.def) { const dd = d.distTo(p.x, p.y); if (dd < nn) { nn = dd; nd = d; } }
    if (nd && nn < 3) steer(p, p.x - (nd.x - p.x) * 0.3, p.y - (nd.y - p.y) * 0.5, 0.35);
    else p.want = 0;
    return;
  }
  const last = wps[wps.length - 1], prev = wps.length > 1 ? wps[wps.length - 2] : [p.sx, p.sy];
  let ux = last[0] - prev[0], uy = last[1] - prev[1];
  const m = Math.hypot(ux, uy) || 1;
  ux /= m; uy /= m;
  let ty = p.y + uy * 5;
  if (ty < 1.5 || ty > FIELD_W - 1.5) { uy = 0; ux = 1; ty = p.y; }
  steer(p, Math.min(108, p.x + ux * 5), ty, p.x > 106 ? 0.3 : 1);
  p.sprint = true;
}
function nearestThreat(w, p, cx, cy, radius, onlyFree = true) {
  let best = null, bd = radius;
  for (const d of w.def) {
    if (d.down > 0 || (onlyFree && d.engaged)) continue;
    const dd = Math.hypot(d.x - cx, d.y - cy);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}
function passBlock(w, p) {
  const qb = w.ball.carrier && w.ball.carrier.side === "O" ? w.ball.carrier : w.qb || p;
  // my man from the protection call; once he's handled (or gone), the nearest free rusher in my zone
  let tgt = p.ai.assigned;
  if (tgt && (tgt.down > 0 || (tgt.engaged && tgt.engaged !== p) || tgt.distTo(p.x, p.y) > 8 || (tgt.as && tgt.as.kind !== "rush" && w.t > 0.6))) { tgt = null; p.ai.assigned = null; }
  if (!tgt) tgt = p.ai.target;
  if (!tgt || tgt.engaged || tgt.down > 0 || tgt.distTo(p.x, p.y) > 5) {
    tgt = nearestThreat(w, p, p.x + 1, p.y, 4.5);
    p.ai.target = tgt;
  }
  if (tgt) {
    // get between the rusher and the QB
    const ax = qb.x - tgt.x, ay = qb.y - tgt.y, m = Math.hypot(ax, ay) || 1;
    const k = Math.min(1.0, m * 0.5);
    steer(p, tgt.x + (ax / m) * k, tgt.y + (ay / m) * k, 1);
    // once the QB has left the pocket, only a rusher he's still in front of (between him and the QB) can be picked up
    const bx = p.x - tgt.x, by = p.y - tgt.y;
    if (!scrambling(w, 1) || (ax * bx + ay * by) / (m * (Math.hypot(bx, by) || 1)) > 0.3) tryEngage(w, p, tgt);
  } else if (p.ai.help && p.ai.help.down <= 0) {
    // the double team: sit just behind the man he's helping on, between him and the QB
    const r = p.ai.help, ax = qb.x - r.x, ay = qb.y - r.y, m = Math.hypot(ax, ay) || 1;
    steer(p, r.x + (ax / m) * 1.5, r.y + (ay / m) * 1.5, 0.8);
  } else {
    steer(p, p.sx - 1.2, p.sy, 0.5);
  }
}
// screen: sell the pass set, then release toward the screen side and lead the receiver
const CONVOY = { LT: -2, LG: -1, C: 0, RG: 1, RT: 2, TE: 0, FB: 1, HB: 1, WR1: 1, WR2: 1 };
// The screen's convoy, set at the snap: the defenders who'd meet the receiver where he catches it (nearest that spot
// first; not the rushers on the line, whom the screen lets go), each to the nearest blocker still free (p.ai.scrTgt)
function assignConvoy(w) {
  const rec = screenRec(w), B = w.off.filter((p) => p.as && p.as.block === "screen");
  if (!rec || !B.length) return;
  const spot = rec.ai.wps && rec.ai.wps.length ? rec.ai.wps[rec.ai.wps.length - 1] : [rec.sx, rec.sy];
  const deep = (d) => d.as && d.as.kind === "zone" && (ZONES[d.as.zone] || ZONES.robber)[0] >= 14;
  const D = w.def.filter((d) => !(d.as && d.as.kind === "rush" && d.sx - w.los < 2.6) && !deep(d)).map((d) => [d, Math.hypot(d.sx - spot[0], d.sy - spot[1])]).sort((a, b) => a[1] - b[1]);
  const free = new Set(B);
  for (const [d] of D) {
    if (!free.size) break;
    let best = null, bd = 1e9;
    for (const b of free) { const dd = Math.hypot(b.sx - d.sx, b.sy - d.sy); if (dd < bd) { bd = dd; best = b; } }
    best.ai.scrTgt = d; free.delete(best);
  }
}
// the screen's receiver: whoever runs its screen route (the back's, the tight end's), else the back
const screenRec = (w) => { for (const r of w.off) if (r.as && r.as.kind === "route" && (r.as.name === "screen" || r.as.scr)) return r; return w.bySlot(w.off, "HB"); };
function screenBlock(w, p) {
  if (w.t < (p.ai.release || 0.9)) { passBlock(w, p); return; }
  const rec = screenRec(w);
  if (!rec) { passBlock(w, p); return; }
  const c = w.ball.carrier && w.ball.carrier.side === "O" ? w.ball.carrier : rec;
  // the convoy: landmarks just past the line in front of the catch point, spread across the receiver's lane
  const spot = rec.ai.wps && rec.ai.wps.length ? rec.ai.wps[rec.ai.wps.length - 1] : [rec.x, rec.y];
  const idx = CONVOY[p.slot] != null ? CONVOY[p.slot] : 1;
  const out = Math.sign(spot[1] - w.ballY) || parOf(w);
  const lx = Math.max(w.los + 0.8 + (idx + 1) * 0.9, c.x + 2), ly = spot[1] - out * (1.6 - idx * 2.2);
  // his man from the convoy (assignConvoy) while he's still there to be blocked; else whoever threatens the receiver
  // (in front of him, near his lane) — not the rushers chasing the QB
  const mt = p.ai.scrTgt;
  if (mt && mt.down <= 0 && !(mt.engaged && mt.engaged !== p) && mt.distTo(c.x, c.y) < 12) { steer(p, mt.x + mt.vx * 0.3 - 0.4, mt.y + mt.vy * 0.3 + (c.y - mt.y) * 0.2, 1); tryEngage(w, p, mt); p.sprint = true; return; }
  let best = null, bd = 6.5;
  for (const d of w.def) {
    if (d.down > 0 || d.engaged || d.x < c.x - 1.2) continue;
    const dd = Math.hypot(d.x - c.x, (d.y - c.y) * 1.2);
    if (dd < bd && d.distTo(p.x, p.y) < 7) { bd = dd; best = d; }
  }
  if (best && (w.ball.carrier === c || best.distTo(lx, ly) < 4.5)) { steer(p, best.x - 0.4, best.y + (c.y - best.y) * 0.2, 1); tryEngage(w, p, best); }
  else steer(p, lx, clamp(ly, 1.5, FIELD_W - 1.5), 1);
  p.sprint = true;
}
function runBlock(w, p) {
  // the combo (assignRunScheme): a shoulder on his neighbour's man first, then up to his linebacker — when it's time,
  // when the linebacker comes downhill at the double, or once the man doubled is gone
  const cb = p.ai.combo;
  if (cb && !p.ai.climbed) {
    const dl = cb.dl, lb = p.ai.assigned !== dl ? p.ai.assigned : null;
    // (nobody on the man yet: a stay-on double takes him itself, soon — a combo's climber waits a little longer)
    const late = !dl.engaged && w.t > (lb ? RUN_BLOCK.LATE[1] : RUN_BLOCK.LATE[0]);
    const go = w.t >= cb.at || dl.down > 0 || late || (lb && (lb.down > 0 || lb.distTo(p.x, p.y) < 2.4 || lb.x < w.los + 1.4));
    if (!go) {
      // (his shoulder on the far side from the man blocking him — never in that man's way)
      let prim = null;
      for (const o of w.off) if (o !== p && o.ai.assigned === dl) { prim = o; break; }
      const side = (prim ? Math.sign(dl.y - prim.sy) : lb ? Math.sign(lb.y - dl.y) : Math.sign(p.sy - dl.y)) || parOf(w);
      steer(p, dl.x - 0.45, dl.y + side * 0.6, 1);
      p.ai.helping = dl; dl.ai.helper = p;
      return;
    }
    p.ai.climbed = true; p.ai.helping = null;
    if (dl.ai.helper === p) dl.ai.helper = null;
  }
  if (p.ai.overtake && !p.ai.handed) overtake(w, p);
  let tgt = p.ai.assigned;
  if (tgt && (tgt.down > 0 || (tgt.engaged && tgt.engaged !== p) || tgt.distTo(p.x, p.y) > 9 || dropped(w, tgt))) { tgt = null; p.ai.assigned = null; }
  if (!tgt) {
    tgt = p.ai.target;
    if (!tgt || tgt.engaged || tgt.down > 0 || tgt.distTo(p.x, p.y) > 6) {
      let best = null, bd = 6;
      const hy = w.runHoleY != null ? w.runHoleY : w.ballY;
      for (const d of w.def) {
        if (d.down > 0 || d.engaged) continue;
        if (d.x < p.x - 1.5) continue;
        const dd = Math.hypot(d.x - p.x, (d.y - p.y) * 1.3) + Math.abs(d.y - hy) * 0.08;
        if (dd < bd) { bd = dd; best = d; }
      }
      tgt = best; p.ai.target = tgt;
    }
  }
  if (tgt) {
    // fit between the defender and the hole: seal him away from the run (a linebacker on the move: where he's going)
    const hy = w.runHoleY != null ? w.runHoleY : w.ballY;
    const side = Math.abs(hy - tgt.y) > 0.6 ? Math.sign(hy - tgt.y) : 0;
    const lead = RUN_BLOCK.SCHEME && !tgt.engaged && tgt.x - w.los > 1.5 ? 0.3 : 0;
    steer(p, tgt.x + tgt.vx * lead - 0.35, tgt.y + tgt.vy * lead + side * 0.45, 1);
    tryEngage(w, p, tgt);
  } else steer(p, p.x + 2, p.y, 0.6);
}
// the overtake (a gap scheme's edge blocker over the end man, assignRunScheme): once the kick-out is there, he lets
// him go to it — straight into its block — and climbs to his linebacker (the kick-out late, or down: he climbs anyway)
function overtake(w, p) {
  const ot = p.ai.overtake, d = p.ai.assigned;
  if (!d || w.t < 0.3 || !(ot.distTo(d.x, d.y) < 1.5 || w.t > 1.3 || ot.down > 0 || d.down > 0)) return;
  p.ai.handed = true;
  if (p.engaged === d) { release(p, d); d.engageCool = 0; p.engageCool = 0; tryEngage(w, ot, d); }
  p.ai.assigned = p.ai.climb || null;
}
// (RUN_BLOCK.SCHEME) a linebacker gone to his coverage, deep and still going: not worth chasing — block whoever comes
const dropped = (w, d) => RUN_BLOCK.SCHEME && !d.engaged && d.x - w.los > 6.5 && d.vx > 0.5;
function leadBlock(w, p) {
  const aim = p.as.aim || [1, 0];
  const ax = w.los + aim[0], ay = w.ballY - aim[1];
  const asg = p.ai.assigned;
  // (his man still held by the tight end who hands him over: the overtake)
  const held = asg && asg.engaged && asg.engaged !== p && asg.engaged.ai.overtake === p && !asg.engaged.ai.handed;
  if (asg && asg.down <= 0 && (held || !(asg.engaged && asg.engaged !== p)) && asg.distTo(p.x, p.y) < 10 && !dropped(w, asg)) {
    // kick out / lead through on the assigned man
    if (!p.ai.reached) { const d = steer(p, (ax + asg.x) * 0.5, (ay + asg.y) * 0.5, 1); if (d < 1.4 || w.t > 1.1) p.ai.reached = true; }
    else steer(p, asg.x - 0.3, asg.y, 1);
    p.sprint = true;
    tryEngage(w, p, asg);
    const t = nearestThreat(w, p, p.x, p.y, 1.3);
    if (t && t !== asg) tryEngage(w, p, t);
    return;
  }
  if (!p.ai.reached) {
    const d = steer(p, ax, ay, 1);
    if (d < 1.2 || w.t > 1.4) p.ai.reached = true;
    const t = nearestThreat(w, p, p.x, p.y, 1.6);
    if (t) tryEngage(w, p, t);
    return;
  }
  const c = w.ball.carrier || p;
  const t = nearestThreat(w, p, c.x + 2, c.y, 5);
  if (t) { steer(p, t.x, t.y, 1); tryEngage(w, p, t); } else steer(p, p.x + 2, p.y, 0.6);
}
function pullBlock(w, p) {
  const play = w.call.off;
  const hy = w.runHoleY != null ? w.runHoleY : w.ballY;
  if (w.t < 0.55) { steer(p, w.los - 1.6, p.sy + Math.sign(hy - p.sy || parOf(w)) * 3.5, 1); p.sprint = true; return; }
  // (RUN_BLOCK.SCHEME) off the pull, straight at his man: the end man kicked out from the inside, the linebacker wrapped
  // up on — the one a tight end is still holding for him too (the overtake)
  const asg = p.ai.assigned;
  if (RUN_BLOCK.SCHEME && asg && asg.down <= 0 && asg.distTo(p.x, p.y) < 10 && !dropped(w, asg)) {
    const held = asg.engaged && asg.engaged !== p && asg.engaged.ai.overtake === p && !asg.engaged.ai.handed;
    if (held || !(asg.engaged && asg.engaged !== p)) {
      const inside = Math.sign(hy - asg.y) || parOf(w);
      steer(p, asg.x - 0.3 + asg.vx * 0.2, asg.y + inside * 0.4 + asg.vy * 0.2, 1);
      p.sprint = true;
      tryEngage(w, p, asg);
      const t = nearestThreat(w, p, p.x, p.y, 1.2);
      if (t && t !== asg) tryEngage(w, p, t);
      return;
    }
  }
  leadBlock(w, p);
}
function escort(w, p, c) {
  // downfield blocking for the carrier
  let best = null, bd = 7;
  for (const d of opp(w, p)) {
    if (d.down > 0 || d.engaged) continue;
    const dd = d.distTo(c.x, c.y);
    if (dd < bd && d.distTo(p.x, p.y) < 9) { bd = dd; best = d; }
  }
  const dir = p.side === "O" ? 1 : -1;
  if (best) { steer(p, best.x - (best.x - c.x) * 0.25, best.y - (best.y - c.y) * 0.25, 1); tryEngage(w, p, best); p.sprint = true; }
  else steer(p, c.x + 3 * dir, c.y + (p.y - c.y) * 0.5, 0.8);
}

// ---------- Defense ----------
function defThink(w, p, dt) {
  // a fake punt or field goal (fakeDefense): until he reads it he plays the kick
  if (p.ai.fooled != null && w.t < p.ai.fooled) { fooledThink(w, p); return; }
  const as = p.as || { kind: "rush" };
  const b = w.ball;
  const c = b.carrier;
  const play = w.call.off;
  const t = w.t;
  // ball in the air: break on it
  if (b.state === "air" && (b.kind === "pass" || b.kind === "lob")) {
    const d = Math.hypot(b.tx - p.x, b.ty - p.y);
    // (PRO to LEGEND: he sees the throw sooner, and anyone who can get there before it comes down plays the ball)
    const H = hardOf(w, p);
    const react = (0.22 + (1 - Math.min(1, p.r.agility / 120)) * 0.25) * (H ? HARD.BALL_REACT[H - 1] : 1);
    if ((H ? ballReach(p, b, d) : d < 13) && b.t > react && b.target) {
      steer(p, b.tx + (p.x > b.tx ? 0.4 : -0.4), b.ty, 1.1); p.sprint = true;
      // one swat attempt per ball: the defender closest to the catch point times his jump
      const left = b.T - b.t;
      if (!p.move && d < 2.0 + (H ? HARD.SWAT_REACH[H - 1] : 0) && left < 0.3 && left > 0.12 && p.moveCool <= 0 && w.swatTry !== w.passId && closestToBall(w, p, d)) {
        w.swatTry = w.passId;
        if (w.rng.chance(0.45 + p.r.agility / 400 + (H ? HARD.SWAT[H - 1] : 0))) startMove(w, p, "swat", 0, 0);
      }
      return;
    }
    if (b.target) { pursue(p, b.target, 0.6); return; }
  }
  if (b.state === "loose") { steer(p, b.x, b.y, 1.1); p.sprint = true; return; }
  const pre = !w.handedOff && !w.passThrown && c === w.qb;
  // play action: the second level bites on the fake, except that a defender who already carries a receiver (his man,
  // or a route runner inside his underneath zone) only takes a read step: the slot slipping out into the flat isn't
  // left alone for the whole fake
  // (PRO to LEGEND: shorter bites, none from a deep zone, and shorter still once the human lives on play action)
  if (play && play.pa && t < (carries(w, as) ? 0.3 : 0.75) * paBite(w, p, as) && pre && as.kind !== "rush" && (p.slot.startsWith("ILB") || p.slot.startsWith("OLB") || p.slot.startsWith("S"))) {
    steer(p, Math.max(w.los + 1.3, p.sx - (p.ai.bite || 1)), p.sy, 0.9);
    return;
  }
  if (c && c.side === "O") {
    // run keys: the line's run blocking gives a designed run away right after the snap (not on draws), and the
    // defense keys the back who's getting the ball; otherwise it's a run once someone other than the QB has it, or
    // once the QB has taken off (readScramble level 2: read from then, his eyes already on the QB, as quick as the
    // defense is good)
    // (PRO to LEGEND: a draw the human keeps running is read like any other run)
    const designed = play && play.type === "run" && (!play.delay || drawRead(w, p));
    // (a deep zone doesn't come up on the line's run blocking alone: it waits for the handoff — the RPO's ride, the
    // read option's mesh)
    const deepZ = as.kind === "zone" && (ZONES[as.zone] || ZONES.robber)[0] >= 14;
    const runKey = designed && t > 0.3 && !(deepZ && !w.handedOff);
    const scr = pre ? scrambling(w, 2) : null;
    const isRun = runKey || (w.handedOff && !(play && play.flea && w.flickT)) || c.slot !== "QB" || w.losCrossed || c.ai.scramble || Boolean(scr);
    const H = hardOf(w, p); // (PRO to LEGEND: a quicker read, and pursuit with leverage)
    // (a linebacker in a zone keys the line: its run blocking gives him the run sooner than a defensive back reading
    // his receiver — RUN_BLOCK.LB_READ)
    const lbZone = as.kind === "zone" && runKey && (p.slot.startsWith("ILB") || p.slot.startsWith("OLB")) && !deepZ;
    const readT = (as.kind === "rush" ? 0 : as.kind === "man" ? (scr ? 0.35 : 0.7) : scr ? 0.3 : lbZone ? RUN_BLOCK.LB_READ : 0.55) * (H ? HARD.RUN_READ[H - 1] : 1);
    const since = runKey ? t - 0.3 : scr ? t - scr.t2 : t - (w.handoffT || 0);
    if (isRun && since > readT * (1.4 - p.r.agility / 200) * (scr ? 1.2 - 0.4 * scrambleIQ(w, p) : 1)) {
      // (the back the run is designed for while the QB still has it; whoever has it once it's out of his hands: the
      // RPO's receiver)
      const ballMan = designed && !w.handedOff && w.carrierDesignate && c === w.qb ? w.carrierDesignate : c;
      if (as.kind === "man" && as.target && !w.losCrossed && ballMan !== as.target && since < 0.9 && !scr) { coverMan(w, p, as.target); return; }
      // a scramble doesn't pull the deep coverage: a man on top of a receiver running deep, and the deep zones, stay
      // there until the QB is about to cross the line (a sharp defense comes off it a step sooner)
      if (scr && deepCover(w, as) && c.x < w.los - 1 - 3 * scrambleIQ(w, p)) { if (as.kind === "man") coverMan(w, p, as.target); else coverZone(w, p, as.zone); return; }
      if (scr && hardOf(w, p) && plaster(w, p, as, c)) return; // (PRO to LEGEND: the coverage stays on the receivers)
      // backside edge: squeeze and stay home for the cutback / keeper / reverse before chasing
      const s = w.runSide || 0;
      if (as.kind === "rush" && s !== 0 && (p.sy - w.ballY) * s < -2.6 && ballMan.x < w.los + 0.5 && t < (p.ai.contain || 0.7) + (w.handoffT || 0)) {
        steer(p, Math.max(w.los - 1.2, p.x - 0.4), p.y + (w.ballY - p.y) * 0.22, 0.6);
        return;
      }
      if (H) pursueHard(w, p, ballMan);
      else pursue(p, ballMan, p.slot.startsWith("S") || p.slot.startsWith("CB") ? 0.7 : 0.9);
      // user-defense-style moves for the AI: dive at the carrier when close
      const dd = p.distTo(c.x, c.y);
      if (c.hasBall && dd < 2.0 && dd > 1.1 && !p.move && p.moveCool <= 0 && w.rng.chance(dt * 2.4)) startMove(w, p, w.rng.chance(0.12) ? "hitstick" : "dive", c.x - p.x, c.y - p.y);
      else if (c.hasBall) chaseDive(w, p, c, dd, dt);
      return;
    }
  }
  const scr1 = pre ? scrambling(w, 1) : null;
  if (as.kind === "rush") {
    const tgt = c || w.qb;
    if (tgt) {
      // gap step off the snap, then rush lane: come around the edge a bit before closing
      if (t < 0.3) { steer(p, w.los - 1.2, p.sy + (w.ballY - p.sy) * 0.12, 1); return; }
      // the QB is out of the pocket: the edge rusher on his side has contain (aims between him and the sideline, to
      // keep him inside), the rest chase him down; all-out pursuit once he runs (the rally above)
      if (scr1 && tgt === w.qb) { pursue(p, tgt, 0, (p.sy - w.ballY) * scr1.side > 2.6 ? scr1.side * 1.3 : 0, 1); return; }
      const st = p.ai.stunt; // (PRO to LEGEND: hardSnap's twist)
      if (st && t < st.until && tgt === w.qb) { steer(p, st.x, st.y, 1); p.sprint = true; return; }
      const lane = (p.sy - w.ballY) * 0.35;
      const tx = tgt.x - 0.4, ty = tgt.y + (Math.abs(tgt.x - p.x) > 2.5 ? lane : 0);
      steer(p, tx, ty, 1); p.sprint = true;
      const dd = p.distTo(tgt.x, tgt.y);
      if (tgt.hasBall && dd < 2.0 && dd > 1.0 && !p.move && p.moveCool <= 0 && w.rng.chance(dt * 2)) startMove(w, p, "dive", tgt.x - p.x, tgt.y - p.y);
    }
    return;
  }
  if (as.kind === "man") { coverMan(w, p, as.target); return; }
  if (as.kind === "spy") { spyQB(w, p, scr1); return; }
  if (as.kind === "zone") { coverZone(w, p, as.zone, scr1 ? w.qb : null); return; }
  p.want = 0;
}
// QB spy: mirror him from 4 yd off the line (sprinting to stay square with him); once he's out of the pocket, close
// to 2.5 yd so he can't turn the corner on him (the rally takes over when he runs)
function spyQB(w, p, scr) {
  const q = w.qb;
  if (!q) { p.want = 0; return; }
  const depth = scr ? 2.5 : 4;
  steer(p, Math.max(w.los + depth, q.x + depth + 1), clamp(q.y + q.vy * 0.25, 1, FIELD_W - 1), 1.05);
  p.sprint = Boolean(scr) || Math.abs(q.y - p.y) > 1.5;
}
// a scramble doesn't pull him off: a man on top of a receiver still running deep, a deep zone
function deepCover(w, as) {
  if (as.kind === "zone") return (ZONES[as.zone] || ZONES.robber)[0] >= 14;
  const r = as.kind === "man" ? as.target : null;
  return Boolean(r && r.as && r.as.kind === "route" && !r.ai.settle && r.x - w.los > 9);
}
// a pursuer who can't close on the carrier lays out for the shoestring tackle
function chaseDive(w, p, c, dd, dt) {
  if (dd > 2.7 || dd < 1.4 || p.move || p.moveCool > 0) return;
  const rx = c.x - p.x, ry = c.y - p.y;
  const closing = ((p.vx - c.vx) * rx + (p.vy - c.vy) * ry) / (dd || 1);
  if (closing < 0.6 && w.rng.chance(dt * 1.6)) startMove(w, p, "dive", rx + c.vx * 0.25, ry + c.vy * 0.25);
}
function closestToBall(w, p, d) {
  const b = w.ball;
  for (const q of w.def) if (q !== p && q.canAct && Math.hypot(b.tx - q.x, b.ty - q.y) < d) return false;
  return true;
}
// a defender carries a receiver: his man, or a route runner inside his underneath zone (coverZone's area)
function carries(w, as) {
  if (as.kind === "man") return Boolean(as.target);
  if (as.kind !== "zone") return false;
  const Z = ZONES[as.zone] || ZONES.robber;
  if (Z[0] >= 14) return false;
  const lx = Math.min(w.los + Z[0], 109), ly = clamp(w.ballY - Z[1], 3, FIELD_W - 3);
  for (const r of w.off) if (r.as && r.as.kind === "route" && Math.hypot(r.x - lx, r.y - ly) <= 7.5) return true;
  return false;
}
function coverMan(w, p, r) {
  if (!r) { coverZone(w, p, "robber"); return; }
  const H = hardOf(w, p);
  if (H) { coverTight(w, p, r, H); return; }
  const cushion = w.t < 1.2 && !(p.as && p.as.press) ? 1.6 : 0.6; // (a pressed corner: on him from the snap)
  const lag = 0.28;
  let tx = r.x + r.vx * lag + cushion, ty = r.y + r.vy * lag;
  // inside leverage
  ty += r.y < MID_Y || (r.y === MID_Y && parOf(w) < 0) ? 0.4 : -0.4;
  steer(p, tx, ty, 1.05);
  p.sprint = r.speedNow > 5;
}
// q: a QB out of the pocket (readScramble level 1) — an underneath zone slides with him and stops sinking
function coverZone(w, p, zone, q = null) {
  const Z = ZONES[zone] || ZONES.robber;
  const deep = Z[0] >= 14;
  const lx = Math.min(w.los + Z[0], 109), ly = clamp(w.ballY - Z[1], 3, FIELD_W - 3);
  // threats in my area
  const radius = deep ? 11 : 7.5;
  let tgt = null, score = -99;
  for (const r of w.off) {
    if (!r.as || r.as.kind !== "route") continue;
    const dd = Math.hypot(r.x - lx, r.y - ly);
    if (dd > radius) continue;
    const s = deep ? r.x - w.los - dd * 0.3 : -dd;
    if (s > score) { score = s; tgt = r; }
  }
  // (PRO to LEGEND: a deep defender with the over-the-top help on the human's favorite receiver takes him)
  const H = hardOf(w, p), br = H && deep ? p.ai.bracket : null;
  if (br && br.as && br.as.kind === "route" && Math.abs(br.y - ly) < 18 && br.x - w.los > 2) tgt = br;
  let tx = lx, ty = ly, want = 0.9;
  if (tgt && w.t > (H ? 0.35 : 0.5)) {
    tx = tgt.x + (deep ? 2.6 : -0.3) + tgt.vx * 0.3; ty = tgt.y + tgt.vy * 0.3; want = 1;
    // deep defenders carry a vertical all the way (stay on top); underneath zones stay near their landmark
    // (hard: they match the receiver in their area more closely)
    if (deep) { tx = Math.max(tx, w.los + 8); ty = ly + (ty - ly) * (H ? HARD.ZONE_MATCH[H - 1][0] : 0.85); }
    else {
      // (hard: an underneath defender with one receiver in his area carries him when he goes vertical — the cloud
      // corner sinks under the outside release, the hook carries the seam — to about 9 yd past his landmark)
      const k = H ? (tgt.vx > 3 && tgt.x > lx && aloneIn(w, tgt, lx, ly, radius) ? HARD.SINK : HARD.ZONE_MATCH[H - 1][1]) : 0.8;
      tx = lx + (tx - lx) * k; ty = ly + (ty - ly) * (H ? k : 0.85);
      if (H) tx = Math.min(tx, lx + 9);
    }
    p.sprint = deep && tgt.speedNow > 6;
  }
  if (q && !deep) { ty += (q.y - ty) * 0.35; tx = Math.min(tx, Math.max(w.los + 5, p.x)); want = 1; }
  steer(p, Math.min(tx, 109.5), ty, want);
}

// ---------- Kicks ----------
function kickThink(w, p, dt) {
  const b = w.ball;
  const kicked = w.kicked;
  if (p.side === "O") {
    // kicking team
    if (!kicked) {
      if (w.playType === "punt") {
        if (p === w.kicker) { if (w.t > 1.2 && w.ball.carrier === p) steer(p, p.sx + 1.5, p.sy, 0.35); else steer(p, p.sx, p.sy, 0); return; } // two steps, then the kick
        if (p.slot === "WR1" || p.slot === "WR2") { steer(p, p.x + 6, p.y, 1); p.sprint = true; return; }
        passBlock(w, p);
        return;
      }
      if (p === w.kicker) { steer(p, w.los - 0.4, w.ballY, w.t > 0 ? 0.75 : 0); return; }
      steer(p, Math.min(p.x + 3, w.los - 0.6), p.sy, w.t > 0 ? 0.55 : 0);
      return;
    }
    // onside kick: everyone goes for the ball (it's theirs to recover once it has gone 10 yards)
    if (w.onside && (b.kind === "onside" || b.kind === "onsideRoll")) { chaseOnside(w, p, 0); return; }
    if (p === w.kicker && w.playType === "kickoff") {
      // the last line: shadow the return from 12 yd, then take him on once he's coming through
      const r = w.returner;
      if (r && b.carrier === r && r.distTo(p.x, p.y) < 11) { pursue(p, r, 0.9); chaseDive(w, p, r, r.distTo(p.x, p.y), dt); }
      else if (r) steer(p, Math.max(p.x, r.x - 12), r.y * 0.5 + p.sy * 0.5, 0.7);
      return;
    }
    const r = b.carrier && b.carrier.side === "D" ? b.carrier : null;
    if (r) {
      pursue(p, r, 0.8);
      const dd = p.distTo(r.x, r.y);
      if (dd < 1.9 && dd > 1.0 && !p.move && p.moveCool <= 0 && w.rng.chance(dt * 0.6)) startMove(w, p, "dive", r.x - p.x, r.y - p.y);
      else chaseDive(w, p, r, dd, dt);
      return;
    }
    // a punt the returner lets go (physics.js launchKick): the cover team goes to down it, to where it comes down and
    // then after the ball (the punter stays back in his lane)
    if (w.letGo && p !== w.kicker) {
      const air = b.state === "air";
      steer(p, air ? b.tx : b.x + b.vx * 0.25, clamp(air ? b.ty : b.y + b.vy * 0.25, 0.5, FIELD_W - 0.5), 1); p.sprint = true;
      return;
    }
    // the two safeties hang back as the last line; everyone else runs down in lanes toward the landing spot
    if (w.playType === "kickoff" && (p.slot === "S1" || p.slot === "S2")) {
      steer(p, Math.min((b.tx || p.x + 20) - 26, p.x + 6), p.sy * 0.6 + (b.ty || MID_Y) * 0.4, 0.8);
      return;
    }
    const lx = b.tx || p.x + 20;
    const laneY = p.sy + ((b.ty || MID_Y) - p.sy) * clamp(1 - Math.abs(lx - p.x) / 30, 0.15, 1);
    steer(p, Math.min(lx - 4, p.x + 10), laneY, 1); p.sprint = true;
    return;
  }
  // receiving team
  const ret = w.returner;
  if (p === ret && !p.hasBall) {
    if (kicked && w.letGo) letItGo(w, p);
    else if (kicked && b.state === "air") { steer(p, b.tx, b.ty, 1.1); p.sprint = true; }
    else if (b.state === "loose") { steer(p, b.x, b.y, 1.1); p.sprint = true; }
    else p.want = 0;
    return;
  }
  if (w.playType === "punt" && !kicked) {
    // punt rush (the front) — everyone else holds up the gunners and peels back to set the wall
    if (p.ai.puntRush) {
      // rush the block point a step in front of the punter, leap / lay out when you get there
      const k = w.kicker, bx = k.x + 1.6, d = steer(p, bx, k.y, 1); p.sprint = true;
      if (d < 1.7 && w.t > 1.2 && !p.move && p.moveCool <= 0) startMove(w, p, "swat", bx - p.x, k.y - p.y); // hands up, stay on your feet
      return;
    }
    if (p.slot === "CB1" || p.slot === "CB2") { const g = w.bySlot(w.off, p.slot === "CB1" ? "WR1" : "WR2"); if (g) { steer(p, g.x + 1.2, g.y, 1); tryEngage(w, p, g); return; } }
    steer(p, p.sx + 2, p.sy, 0.5);
    return;
  }
  if (!kicked) { p.want = 0; return; }
  if (w.onside && (b.kind === "onside" || b.kind === "onsideRoll")) { onsideReturn(w, p); return; }
  const carrier = b.carrier;
  const laneY = w.returnLaneY != null ? w.returnLaneY : MID_Y;
  if (carrier && carrier.side === "D") {
    // return blocking: meet the cover man I'm best placed to block (near me, still in front of the returner) and
    // turn him away from the called lane; with nobody to block, lead the returner up the lane
    let best = null, bs = 1e9;
    for (const d of w.off) {
      if (d.down > 0 || d.engaged) continue;
      const dd = d.distTo(p.x, p.y);
      if (dd > 9 || d.x > carrier.x + 2) continue; // already past the returner
      const sc = dd + d.distTo(carrier.x, carrier.y) * 0.35;
      if (sc < bs) { bs = sc; best = d; }
    }
    if (best) {
      const away = Math.sign(best.y - laneY) || (best.y < carrier.y ? -1 : 1);
      steer(p, best.x + 0.5, best.y - away * 0.6, 1);
      tryEngage(w, p, best); p.sprint = true;
    } else steer(p, carrier.x - 5, carrier.y + (laneY - carrier.y) * 0.3 + (p.y - carrier.y) * 0.4, 0.9);
    return;
  }
  // ball in the air: set the wall ~10 yd in front of the landing spot (shaded to the called lane), then step up
  // and take on the first cover man who arrives (a punt let go: nobody gets near it)
  if (b.state === "air" || b.state === "loose") {
    if (w.letGo && clearOf(w, p)) return;
    const near = nearestCover(w, p, 4.5);
    if (near) { steer(p, near.x + 0.5, near.y, 1); tryEngage(w, p, near); p.sprint = true; return; }
    const tx = b.tx ? b.tx - 10 - Math.abs(p.sy - MID_Y) * 0.12 : p.x;
    const lane = w.returnLane || "middle";
    let ty;
    if (lane === "middle") ty = p.sy * 0.55 + (b.ty || MID_Y) * 0.45;
    else {
      // sideline return: a wall on the inside of the lane, staggered from deep to shallow
      const side = lane === "left" ? -1 : 1;
      const k = clamp(Math.abs(p.sy - MID_Y) / 20, 0, 1);
      ty = clamp(laneY - side * (4 + k * 6), 3, FIELD_W - 3);
    }
    steer(p, Math.max(p.x, tx), ty, 0.9);
    return;
  }
  p.want = 0;
}
// A punt the returner lets go (physics.js launchKick, config.js KICKING.LET_GO): he sets up out of its path, a few
// yards in front of where it comes down and to the field side of it, turned to watch it bounce (waving his teammates
// off it), and keeps that spot on it once it's down. His teammates keep clear of it (clearOf); the cover team goes to
// down it (kickThink).
const LET_GO_SPOT = [4.5, 2.5]; // yd in front of the ball, yd to the side of it
function letItGo(w, p) {
  const b = w.ball, air = b.state === "air", bx = air ? b.tx : b.x, by = air ? b.ty : b.y;
  const side = by < MID_Y ? 1 : -1;
  const d = steer(p, Math.min(bx - LET_GO_SPOT[0], 98), clamp(by + side * LET_GO_SPOT[1], 1.5, FIELD_W - 1.5), 1);
  p.sprint = d > 6;
  if (d < 1) { const fx = b.x - p.x, fy = b.y - p.y, m = Math.hypot(fx, fy) || 1; p.faceX = fx / m; p.faceY = fy / m; }
}
// Can the returner still get under a punt in the air (a human's FAIR CATCH after he's let it go: world.action)? His time
// to within the catch's reach of where it comes down, at a sprint from a standstill, against the ball's time left.
export function underInTime(w, r) {
  const b = w.ball;
  if (!r || b.state !== "air" || b.kind !== "punt") return false;
  const d = Math.max(0, Math.hypot(b.tx - r.x, b.ty - r.y) - 1.2), top = r.r.speed * PHYS.SPRINT_MULT;
  return d / top + top / (2 * r.r.accel) < b.T - b.t - 0.15;
}
// a receiving player near a punt let go steps away from it (it must not touch him): within 3 yd of where it comes down,
// or of the ball once it's down → true when he does
function clearOf(w, p) {
  const b = w.ball, air = b.state === "air", bx = air ? b.tx : b.x, by = air ? b.ty : b.y;
  const dx = p.x - bx, dy = p.y - by, d = Math.hypot(dx, dy);
  if (d >= 3) return false;
  const ux = d > 0.05 ? dx / d : -1, uy = d > 0.05 ? dy / d : 0;
  steer(p, bx + ux * 4, by + uy * 4, 1);
  return true;
}
// run at the ball (in the air: where it comes down) to fall on it
function chaseOnside(w, p, lead) {
  const b = w.ball, air = b.state === "air";
  steer(p, air ? b.tx : b.x + b.vx * lead, clamp(air ? b.ty : b.y + b.vy * lead, -1, FIELD_W + 1), 1.15); p.sprint = true;
}
// the receiving team on an onside kick. One set for a deep kick (a surprise) starts to turn and set its wall, but reads
// the short, low kick from its flight: it breaks on the ball w.onsideRead s after the boot (a top team sooner; a team
// that's set for one — its hands team, or a front line that stays home since the kicker tried one — at once:
// world.setupKickoff). Then the nearest man on each side of the ball attacks it, meeting the hop in front of him, and
// the rest take on the cover men closest to the ball.
function onsideReturn(w, p) {
  const b = w.ball;
  if (b.state === "air" && b.t < w.onsideRead) { steer(p, p.x + 6, p.y, KICKING.ONSIDE_DROP); return; }
  const ch = onsideChasers(w);
  if (p === ch.a || p === ch.b) { const m = onsideMeet(w, p); steer(p, m[0], clamp(m[1], -1, FIELD_W + 1), 1.15); p.sprint = true; return; }
  const near = onsideBlockOn(w, p, ch.x, ch.y);
  if (near) { steer(p, near.x + 0.5, near.y, 1); tryEngage(w, p, near); p.sprint = true; return; }
  steer(p, ch.x + 3, ch.y, 0.8);
}
// Where an onside kick will be t s from now: it flies on to its landing spot, then hops on with 60% of its speed
// downfield and 45% across (physics.js ballGrounded), dying out in ≈0.4 s (ONSIDE_ROLL: that decay, per s).
function onsideBallAt(b, t) {
  const R = KICKING.ONSIDE_ROLL;
  if (b.state === "air") {
    const left = Math.max(0, b.T - b.t);
    if (t <= left) return [b.x + b.vx * t, b.y + b.vy * t];
    const k = (1 - Math.exp(-R * (t - left))) / R;
    return [b.tx + b.vx * 0.6 * k, b.ty + b.vy * 0.45 * k];
  }
  const k = (1 - Math.exp(-R * t)) / R;
  return [b.x + b.vx * k, b.y + b.vy * k];
}
// how soon the ball can be fielded (0.3 s after it comes down or squirts loose: physics.js looseBall)
const onsideFieldable = (b) => (b.state === "air" ? Math.max(0, b.T - b.t) + 0.3 : Math.max(0, 0.3 - b.t));
// a receiver's way to the ball: where it will be when he can get there (not before it can be fielded), so he meets the
// hop in front of him instead of running to where it came down and chasing it from there
function onsideMeet(w, p) {
  const b = w.ball, sp = p.r.speed * PHYS.SPRINT_MULT, ready = onsideFieldable(b);
  let t = ready, m = onsideBallAt(b, t);
  for (let i = 0; i < 3; i++) { t = Math.max(ready, Math.hypot(m[0] - p.x, m[1] - p.y) / sp); m = onsideBallAt(b, t); }
  return m;
}
// the receiving team's two men for the ball (worked out once per tick): the nearest to where it can first be fielded,
// and the nearest on the far side of it from him — or the next nearest when nobody on the far side is within
// ONSIDE_FAR yd more. (x, y): that spot.
function onsideChasers(w) {
  const c = w.onsideCh || (w.onsideCh = { n: -1, t: -1, a: null, b: null, x: 0, y: 0 });
  if (c.n === w.playNo && c.t === w.t) return c;
  const [bx, by] = onsideBallAt(w.ball, onsideFieldable(w.ball));
  let a = null, ad = 1e9;
  for (const q of w.def) { if (!q.canAct || q.engaged) continue; const d = q.distTo(bx, by); if (d < ad) { ad = d; a = q; } }
  let s = null, sd = 1e9, o = null, od = 1e9;
  const side = a ? Math.sign(a.y - by) || 1 : 1;
  for (const q of w.def) {
    if (q === a || !q.canAct || q.engaged) continue;
    const d = q.distTo(bx, by);
    if (d < sd) { sd = d; s = q; }
    if (Math.sign(q.y - by) !== side && d < od) { od = d; o = q; }
  }
  c.n = w.playNo; c.t = w.t; c.x = bx; c.y = by;
  c.a = a; c.b = o && od < ad + KICKING.ONSIDE_FAR ? o : s;
  return c;
}
// the cover man a receiver who isn't going for the ball takes on: of those within ONSIDE_BLOCK yd of him, the one
// closest to getting to the ball
function onsideBlockOn(w, p, bx, by) {
  let best = null, bs = 1e9;
  for (const d of w.off) {
    if (d.down > 0 || d.engaged || d === w.kicker) continue;
    const dm = d.distTo(p.x, p.y);
    if (dm > KICKING.ONSIDE_BLOCK) continue;
    const s = d.distTo(bx, by) + 0.6 * dm;
    if (s < bs) { bs = s; best = d; }
  }
  return best;
}
// How set a CPU receiving team is for an onside kick from this kicking team (the human's: a CPU kicker only kicks
// onside when it has to, and then everybody knows): 0 a surprise; 1 its front line stays home (it reads the kick at
// once and fields it better); 2 its hands team is out. It adapts once the kicker has tried one this game: a top coach
// (skill ≥ ONSIDE_ADAPT) brings his hands team at once, the rest keep the front line home until a second try.
export function onsideWary(w, recvTeam, kickTeam) {
  const n = w.onsideTries ? w.onsideTries[kickTeam] : 0;
  if (!n) return 0;
  return n >= 2 || teamSkill(w, recvTeam) >= KICKING.ONSIDE_ADAPT ? 2 : 1;
}
// seconds after the boot that the receiving team breaks on an onside kick (onsideReturn): at once when it's set for
// one, else ONSIDE_READ (the weakest coach … the best)
export function onsideRead(w, recvTeam, set) {
  if (set) return KICKING.ONSIDE_READ_SET;
  const [slow, fast] = KICKING.ONSIDE_READ;
  return slow + (fast - slow) * teamSkill(w, recvTeam);
}
// a team's coach (data.js aiFor: ≈0.15 the first gym … ≈0.96 the Champion; 0.49 the human's teams)
function teamSkill(w, k) {
  const ai = w.teams[k] && w.teams[k].ai;
  return ai && Number.isFinite(ai.skill) ? clamp(ai.skill, 0, 1) : 0.5;
}
function nearestCover(w, p, radius) {
  let best = null, bd = radius;
  for (const d of w.off) { if (d.down > 0 || d.engaged || d === w.kicker) continue; const dd = d.distTo(p.x, p.y); if (dd < bd) { bd = dd; best = d; } }
  return best;
}
// field goals / PATs: the unit protects; the rush comes off both edges and up the middle
function fgThink(w, p) {
  if (p.side === "O") {
    if (p === w.kicker) { steer(p, w.holderSpot[0] - 0.5, w.holderSpot[1] - 0.6, w.t > 0.55 ? 0.6 : 0); return; }
    if (p === w.holder) { p.want = 0; return; }
    passBlock(w, p);
    return;
  }
  if (p.ai.fgRush) {
    // the block point: the ball's first yards of flight, just in front of the hold
    const hx = w.holderSpot[0] + 2.6, hy = w.holderSpot[1];
    const d = steer(p, hx, hy + (p.sy - hy) * 0.15, 1); p.sprint = true;
    // leap / lay out to get a hand on it
    if (!w.kicked && d < 2.6 && w.t > 0.75 && !p.move && p.moveCool <= 0) startMove(w, p, d < 1.6 ? "swat" : "dive", hx - p.x, hy - p.y);
    return;
  }
  p.want = 0;
}

// ---------- Play calling ----------
// The RPO's read at the end of the ride (world.js: the mesh lasts RPO_RIDE s, the CPU's QB): he pulls it and throws the
// quick route when the man the run leaves for him (w.rpoKey: assignRunBlocks) isn't there to play it — blitzing, or
// more than RPO_KEY yd from the receiver (lined up inside, bailing deep) — and the throw is open (openness above
// RPO_OPEN), most of the time (a sharper QB more often); else he hands it off
export const RPO_RIDE = 0.45, RPO_KEY = 8, RPO_OPEN = 2;
export function rpoRead(w, qb, rec) {
  const key = w.rpoKey, gone = !key || key.down > 0 || (key.as && key.as.kind === "rush") || key.distTo(rec.x, rec.y) > RPO_KEY;
  if (!gone || openness(w, rec, qb) <= RPO_OPEN) return false;
  const sk = qb.team && qb.team.ai && Number.isFinite(qb.team.ai.skill) ? qb.team.ai.skill : 0.5;
  return w.rng.chance(0.6 + 0.35 * sk);
}
// ---------- Who runs it: the QB or his back ----------
// A ball carrier as a runner (config.js QB_RUN): his speed, then shiftiness and power, weighted by what gained yards on
// QB POWER (tools/qa/pro-feedback/season.mjs)
export const runAbility = (r) => r.speed + r.agility / QB_RUN.AG_PER + r.power / QB_RUN.PW_PER;
// a QB who can really run (team k's, as he stands now: substitutions and tired legs included): fast and shifty enough on
// his own, and no worse a runner than his back by more than QB_RUN.MARGIN
export function qbRunner(w, k = w.possession) {
  const R = w.roster[k], qb = R && R.QB, hb = R && R.HB;
  if (!qb) return false;
  const q = qb.r;
  return q.speed >= QB_RUN.SPEED && q.agility >= QB_RUN.AGILITY && (!hb || runAbility(q) >= runAbility(hb.r) - QB_RUN.MARGIN);
}
// The red zone and the goal line: who carries on the designed runs there — the back, unless the QB is the better runner
// (by QB_RUN.BETTER). The one place it's decided: a Franchise team's own red-zone / goal-line carrier (its usage,
// franchise/league.js setUsage) comes first — "QB" its QB's designed runs, a back of its HB (squad.js backfield puts
// him in at HB inside the 20). → "QB" or "HB"
const usageRz = (w, k) => { const u = w.teams[k] && w.teams[k].usage; return u && u.rz ? u.rz : null; };
export function redZoneCarrier(w, k = w.possession) {
  const rz = usageRz(w, k);
  if (rz) return rz === "QB" ? "QB" : "HB";
  const R = w.roster[k], qb = R && R.QB, hb = R && R.HB;
  if (!qb || !hb) return qb ? "QB" : "HB";
  return qbRunner(w, k) && runAbility(qb.r) >= runAbility(hb.r) + QB_RUN.BETTER ? "QB" : "HB";
}
// May team k call a designed QB run (QB POWER, a READ OPTION he keeps) from x (yd from its own goal line)? A runner,
// and inside the 20 only the better runner. (The QB SNEAK at a yard or less is anyone's: cpuOffCall.)
export function qbRunOk(w, x = w.los, k = w.possession) {
  return x >= 80 ? redZoneCarrier(w, k) === "QB" : qbRunner(w, k);
}
// the CPU's two-point calls (world.js setupTwo): QB POWER only for a QB who'd get the red zone's carries
const TWO_PLAYS = ["paflat", "dive", "fade", "slants", "qbpower", "mesh"];
export const twoPlays = (w) => (qbRunOk(w, RULES.TWO_PT_SPOT) ? TWO_PLAYS : TWO_PLAYS.map((id) => (id === "qbpower" ? "dive" : id)));
// ---------- The play caller (2026-10-25: the whole playbook, by situation) ----------
// Each offensive play's family, and with it where it gets called: in (between the tackles), out (the perimeter), draw
// (the delayed handoffs), qb (a QB's designed runs) and qbdraw, rpo, quick (the 3-step game), screen, mid (the
// intermediate concepts), pa (play action), shot (the deep shots), side (the two-minute sideline concept), gl (the
// goal-line formation's own). A play missing here is a mid pass or an inside run.
const FAMILY = {
  izone: "in", iso: "in", power: "in", trap: "in", counter: "in", gtcounter: "in", tripszone: "in",
  stretch: "out", toss: "out", widezone: "out", jetsweep: "out", readopt: "out",
  draw: "draw", delay: "draw", qbpower: "qb", qbcounter: "qb", qbdraw: "qbdraw", rposlant: "rpo", rpoglance: "rpo",
  slants: "quick", stick: "quick", snag: "quick", hbscreen: "screen", wrscreen: "screen", tescreen: "screen",
  pacross: "pa", paboot: "pa", nakedboot: "pa", pashot: "shot", papost: "shot", fourverts: "shot", flea: "shot", dagger: "shot",
  outs: "side", sneak: "gl", dive: "gl", paflat: "gl", fade: "gl",
};
export const familyOf = (p) => FAMILY[p.id] || (p.type === "run" ? "in" : "mid");
// a down as the play caller sees it (cpuOffCall / cpuDefCall): the down and distance, the field, the clock's plan
function callSit(w) {
  const toGo = w.toGo, down = w.down, x = w.los, plan = clockPlan(w);
  return {
    down, toGo, x, plan, drill: plan === "drill", easy: plan === "drill" && drillTime(w) > CLOCK.DRILL_EASY, protect: plan === "protect" || plan === "milk",
    goal: x > 96 || (toGo <= 1 && down >= 3), red: x >= 80, backed: x < 10, short: toGo <= 2, long: toGo >= 11 || (down >= 2 && toGo >= 7), third: down >= 3,
  };
}
// the situations a team's playbook can name favorites for (team.playbook.sit)
const sitKeys = (s) => [s.red && "redZone", s.short && "shortYardage", s.drill && "twoMinute", s.backed && "backedUp"].filter(Boolean);
// How well a family fits the down (0: never here) — the run game's staples on early downs and short ones, the draw and
// the screen against long yardage, the quick game when the ball has to come out, the deep shot on a fresh set of
// downs (never in the red zone, never protecting a lead), the sideline concept in the two-minute drill, the
// goal-line formation only at the goal line and on a yard or less
function famFit(f, s) {
  let k;
  switch (f) {
    case "in": k = s.short ? 1.1 : s.long ? 0.35 : 0.9; if (s.red) k *= s.goal ? 0.5 : 1.2; if (s.protect) k *= 1.8; if (s.drill) k *= s.easy ? 0.5 : 0.1; return k;
    case "out": k = s.short ? 0.9 : s.long ? 0.35 : 1.25; if (s.backed) k *= 0.25; if (s.protect) k *= 0.1; if (s.drill) k *= s.easy ? 0.5 : 0.1; if (s.goal) k *= 0.4; return k;
    case "draw": k = s.short ? 0.35 : s.long ? 1.8 : 0.8; if (s.drill) k *= 2; return s.goal ? 0 : k;
    case "qb": k = s.short ? 1.6 : s.long ? 0.3 : 1; if (s.drill) k *= 0.2; return k;
    case "qbdraw": k = s.short ? 0.3 : s.long ? 1.6 : 0.8; if (s.drill) k *= 1.5; return s.goal ? 0 : k;
    case "rpo": k = s.short ? 0.8 : s.long ? 0.4 : 1.1; if (s.protect || s.drill) k *= 0.3; return s.goal ? 0 : k;
    case "quick": k = s.short ? 1.5 : s.long ? 0.6 : 1; if (s.drill) k *= 1.3; if (s.red) k *= 1.2; return k;
    case "screen": k = s.short ? 0.3 : s.long ? 1.3 : 0.7; if (s.red) k *= 0.5; if (s.protect) k *= 0.4; return s.goal ? 0 : k;
    case "mid": k = s.short ? 0.6 : s.long ? 1.4 : 1; if (s.drill) k *= 1.2; return s.goal ? k * 0.4 : k;
    case "pa": k = s.short ? 1.3 : s.long ? 0.4 : 1.5; if (s.drill) k *= 0.3; if (s.protect) k *= 0.5; return s.goal ? k * 0.6 : k;
    case "shot": if (s.red || s.protect || (s.third && s.toGo < 5)) return 0; k = s.down === 1 && s.x > 35 && s.x < 70 ? 0.6 : 0.25; return s.drill ? k * 0.6 : k;
    case "side": k = s.drill ? 3 : s.long ? 0.6 : 0.25; return s.red ? k * 0.3 : k;
    case "gl": return s.goal ? 4 : s.toGo <= 1 ? 2.5 : 0; // (and its passes in the red zone: cpuOffCall)
    default: return 1;
  }
}
// a designed QB run or an RPO: a runner's call only (qbRunOk); the sneak is anyone's at a yard or less
const qbRunPlay = (p) => (p.carrier === "QB" && !p.clock && p.id !== "sneak") || Boolean(p.rpo);
// the plays where the FB slot catches the ball, and where he leads the way (a slot team's slot, a fullback team's back)
const fbCatches = (p) => Boolean(p.a.FB && p.a.FB.kind === "route" && ((p.prog && p.prog.includes("FB")) || p.rpo === "FB"));
const fbLeads = (p) => Boolean(p.a.FB && p.a.FB.kind === "block" && p.a.FB.block === "lead");
// what this team called this game (noteCall: every scrimmage snap) — its own calls and what it has seen
export function noteCall(w) {
  const C = w.calls || (w.calls = { home: { off: [], def: [] }, away: { off: [], def: [] } });
  if (w.call.off && !w.call.off.clock) C[w.possession].off.push(w.call.off.id);
  if (w.defSet) C[w.defTeam].def.push(w.defSet.id);
}
const callsOf = (w, k, side) => (w.calls && w.calls[k] ? w.calls[k][side] : []);
// against repeats: the last call far less, each time in the last six less, every use this game a little less
function repeatK(hist, id) {
  if (!hist.length) return 1;
  let k = hist[hist.length - 1] === id ? 0.25 : 1, uses = 0;
  for (let i = Math.max(0, hist.length - 6); i < hist.length - 1; i++) if (hist[i] === id) k *= 0.7;
  for (const h of hist) if (h === id) uses++;
  return k / (1 + 0.08 * uses);
}
// a team's playbook (team.playbook: the Franchise's PLAYBOOK screen) → for a side: { on(id), k(id): its favor }
//   team.playbook = { off: { [playId]: { on: false | true, fav: 0 | 1 | 2 } }, def: { [callId]: { … } },
//     sit: { redZone, shortYardage, twoMinute, backedUp: { off: [playIds], def: [callIds] } } }
// A play turned off is never called; a favorite comes up 1.8× (fav 1) or 3× (fav 2) as often, a situation's own
// favorite 3× more in that situation — all within what fits the down (famFit). No playbook: every play on, none favored.
function bookOf(team, side, s) {
  const pb = team && team.playbook, m = pb && pb[side];
  const sf = new Set();
  if (pb && pb.sit) for (const key of sitKeys(s)) for (const id of (pb.sit[key] && pb.sit[key][side]) || []) sf.add(id);
  return {
    on: (id) => !(m && m[id] && m[id].on === false),
    k: (id) => (m && m[id] && m[id].fav === 2 ? 3 : m && m[id] && m[id].fav === 1 ? 1.8 : 1) * (sf.has(id) ? 3 : 1),
  };
}
// one weighted pick (one draw from the game's generator)
function pickW(w, list, wt) {
  let tot = 0;
  for (const v of wt) tot += v;
  let r = w.rng.next() * tot;
  for (let i = 0; i < list.length; i++) { r -= wt[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}
// The CPU offense's call. The clock comes first (clockPlan): a two-minute drill throws (a draw now and then, no gadget
// plays); a team running the clock out (protecting a lead, milking it for the last-snap field goal) runs between the
// tackles and throws only to move the chains. Otherwise the down and distance, the team's identity (data.js aiFor:
// AIR RAID throws more, GROUND & POUND runs more) and, at PRO to LEGEND, what has worked against this human. Near the
// goal line every team still throws some (REDZONE_PASS): play action, the fade, quick slants. Then the play, from the
// whole playbook: each one's weight (play.w) × how its family fits the down (famFit) × the team's style (trick plays,
// shots, the ground game) × its personnel (a slot team's slot catches, a fullback team's back leads) × what the
// defense has shown this game (blitzes: the quick game, screens and draws; man: rubs and crossers; zone: the
// flood, levels, smash) × the team's playbook (bookOf) × against repeats (repeatK); at PRO to LEGEND against a
// person × what has worked this game (playValue). Too few plays left for the down (a playbook with them off) and it
// widens: the down's fit, then the other kind (run or pass), then the playbook's switches.
const SPREAD_O = new Set(["SHOTGUN", "TRIPS", "EMPTY", "BUNCH"]), HEAVY_O = new Set(["IFORM", "ACE", "GOALLINE"]);
const REDZONE_PASS = { goal: [0.38, 0.32], red: 0.33, max: 0.85 }; // inside the 10 [early downs, 3rd / 4th and short], inside the 20
export function cpuOffCall(w) {
  const k = w.possession, team = w.teams[k], s = callSit(w);
  const toGo = s.toGo, down = s.down, x = s.x, drill = s.drill, slow = s.protect;
  let passP = 0.5;
  if (down === 1) passP = 0.47;
  if (down === 2) passP = toGo > 7 ? 0.62 : toGo < 4 ? 0.36 : 0.5;
  if (down >= 3) passP = toGo > 5 ? 0.86 : toGo > 2 ? 0.62 : 0.3;
  if (drill) passP = down >= 3 ? (toGo <= 2 ? 0.55 : 0.9) : down === 2 && toGo > 6 ? 0.88 : s.easy ? 0.66 : 0.82;
  else if (slow) passP = s.plan === "milk" ? 0.08 : down >= 3 ? (toGo > 6 ? 0.5 : toGo > 3 ? 0.35 : 0.12) : 0.15;
  if (team.scheme.off === "slot") passP += 0.06;
  const tend = team.ai || null;
  if (tend && tend.passBias && !drill && !slow) passP = clamp(passP + tend.passBias, 0.12, 0.92);
  // (PRO to LEGEND: more of whatever has been working against this human: runs or passes)
  const hard = w.hard && !w.autopilot && !w.isUserTeam(k);
  if (hard && !drill && !slow) passP = clamp(passP + mixShift(w), 0.12, 0.92);
  if (!drill && !slow && x >= 80) passP = clamp(passP, x >= 90 ? REDZONE_PASS.goal[down >= 3 && toGo <= 2 ? 1 : 0] : REDZONE_PASS.red, REDZONE_PASS.max);
  const isPass = w.rng.chance(passP);
  const qbOk = qbRunOk(w, x), lead = w.score[k] - w.score[k === "home" ? "away" : "home"];
  // what the defense has shown: its blitzes and its man coverage this game (after six calls)
  const seen = callsOf(w, k === "home" ? "away" : "home", "def").map((id) => DEF_PLAYS.find((p) => p.id === id)).filter(Boolean);
  const blitzy = seen.length >= 6 && seen.filter((p) => p.blitz).length / seen.length > 0.35;
  const manRate = seen.length >= 6 ? seen.filter((p) => p.cov === "man").length / seen.length : 0.5;
  const book = bookOf(team, "off", s), hist = callsOf(w, k, "off");
  // the hard rules, whatever the down: a QB run or an RPO for a runner, the sneak at a yard or less, the drill's (no
  // flea flicker, no deep play action, no screen into a running clock)
  const allowed = (p) => (qbOk || !qbRunPlay(p)) && (p.id !== "sneak" || toGo <= QB_RUN.SNEAK) && !(drill && (p.flea || (p.pa && p.deep) || (p.screen && w.clockRunning())));
  const weight = (p) => {
    const f = familyOf(p);
    let v = (p.w || 1) * (f === "gl" && p.type === "pass" ? (s.goal ? 2 : s.red ? 0.8 : 0) : famFit(f, s)); // (the goal line's passes, the fade and play action to the flat: red-zone staples too)
    if (!v) return 0;
    if (tend) {
      if (tend.trick > 0.2 && (p.pa || p.flea || p.jet || p.id === "nakedboot")) v *= 1 + 2 * tend.trick;
      if (tend.passBias > 0.1 && f === "shot") v *= 1.3;
      if (tend.passBias < -0.1 && f === "in") v *= 1.2;
    }
    if (f === "shot" && lead < 0) v *= 1.5;
    if (drill) v *= HEAVY_O.has(p.formation) ? 0.3 : SPREAD_O.has(p.formation) ? 1.2 : 1; // (the hurry-up stays in its spread personnel)
    if (fbCatches(p)) v *= team.scheme.off === "slot" ? 1.25 : 0.7;
    if (fbLeads(p)) v *= team.scheme.off === "slot" ? 0.85 : 1.2;
    if (blitzy && (f === "quick" || f === "screen" || f === "draw" || f === "qbdraw")) v *= 1.35;
    if (manRate > 0.55 && (p.id === "mesh" || p.id === "drive" || p.id === "ycross" || p.id === "pacross" || p.id === "snag" || p.id === "wheel" || p.id === "bunchcorner")) v *= 1.25;
    if (manRate < 0.35 && (p.id === "flood" || p.id === "levels" || p.id === "smash" || p.id === "curlflat" || p.id === "stick" || p.id === "dagger")) v *= 1.25;
    v *= book.k(p.id) * repeatK(hist, p.id);
    if (hard) v *= Math.exp(HARD.PICK_BETA[w.hard - 1] * (playValue(w, p.id) - 0.25));
    return v;
  };
  // the call: the kind chosen, the plays that fit; too few and it widens (the down's fit, the other kind, the playbook)
  const want = isPass ? "pass" : "run";
  // (a Franchise team that gives its QB the red zone's carries, usage rz "QB": its run calls inside the 20 are his own
  // designed runs the playbook has on — QB POWER and the like, at a yard or less the sneak — one is enough)
  const qbZone = want === "run" && s.red && usageRz(w, k) === "QB";
  const tiers = [
    ...(qbZone ? [(p) => p.type === "run" && p.carrier === "QB" && !p.clock && allowed(p) && book.on(p.id)] : []),
    (p) => p.type === want && allowed(p) && book.on(p.id) && weight(p) > 0,
    (p) => p.type === want && allowed(p) && book.on(p.id) && (familyOf(p) !== "gl" || s.goal || toGo <= 1),
    (p) => allowed(p) && book.on(p.id) && (familyOf(p) !== "gl" || s.goal || toGo <= 1),
    (p) => p.type === want && allowed(p) && weight(p) > 0,
    (p) => allowed(p),
  ];
  let list = [];
  for (const t of tiers) { list = OFF_PLAYS.filter(t); if (list.length >= 2 || (list.length && (t === tiers[tiers.length - 1] || (qbZone && t === tiers[0])))) break; }
  if (!list.length) list = OFF_PLAYS.filter((p) => p.type === want);
  const wt = list.map((p) => Math.max(weight(p), 0.02 * (p.w || 1)));
  const pick = pickW(w, list, wt);
  w.lastOffCall = pick.id;
  return pick;
}
// FLIP (config.js FLIP.CPU): the CPU offense flips its calls as a player can, so a play's name doesn't give its side away.
// With the ball off a hash, a play that goes outside (WIDE: the side it attacks as drawn, + = the offense's right)
// takes the wide side of the field FLIP.WIDE_P of the time; anything else is a coin flip. Spikes and kneels never flip.
// The CPU defense never flips its own call: it sets to the formation's strength (world.js setupPlay), so it meets a
// flipped offense mirrored. FLIP.CPU off: the play as called, and no random number drawn. → the play as it will run
const WIDE = { toss: -1, stretch: 1, hbscreen: 1, paboot: -1, widezone: -1, jetsweep: 1, wrscreen: 1, tescreen: 1, nakedboot: 1, gtcounter: -1, qbcounter: -1 };
export function cpuFlip(w, play) {
  if (!FLIP.CPU || !play || play.clock || play.flip) return play;
  const lean = w.ballY - MID_Y, wide = WIDE[play.id]; // (lean > 0: the ball sits toward the +y sideline: the wide side is the offense's right)
  let flip;
  if (wide && Math.abs(lean) >= FLIP.HASH_OFF) flip = (wide === (lean > 0 ? 1 : -1)) !== w.rng.chance(FLIP.WIDE_P);
  else flip = w.rng.chance(0.5);
  return flip ? mirrorPlay(play) : play;
}
// How well a defensive call fits the down (0: never here), by its front: the goal line's own at the goal line (the
// bear behind them on short yardage), the base on early downs, the nickel against long yardage, the dime on 3rd and
// long; the prevent only when a late lead says so (cpuDefCall)
// (the offense's formation, as it lines up — spread: the nickel and the dime more; heavy: the base and the bear more)
function defFit(p, s, form) {
  const f = p.formation;
  if (p.id === "prevent") return 0;
  if (s.goal) return f === "GOALLINE" ? 2 : f === "BEAR" ? 0.4 : 0;
  if (f === "GOALLINE") return 0;
  const long3 = s.third && s.toGo > 9, mid3 = s.third && s.toGo > 3 && !long3, short = s.toGo <= 2;
  let k;
  if (f === "BEAR") k = short ? 0.5 : s.toGo <= 4 && !s.third ? 0.1 : 0;
  else if (f === "BASE") k = long3 ? 0.15 : mid3 ? 0.7 : short ? 1.3 : s.long ? 0.8 : 1.4;
  else if (f === "NICKEL") k = long3 ? 0.8 : mid3 ? 1.5 : short ? 0.5 : s.long ? 1.4 : 0.55;
  else k = long3 ? 2 : mid3 ? 0.5 : short ? 0 : s.long ? 0.35 : 0.08; // DIME
  if (k && s.red) k *= p.cov === "man" || p.blitz ? 1.3 : p.formation === "DIME" ? 0.5 : 1;
  // the pressure calls (blitzes, sim pressures) on the money downs: 3rd down most, a fresh set of downs least
  if (k && (p.blitz || p.sim) && f !== "BEAR") k *= mid3 || (s.third && short) ? PASS_RUSH.CALLS[0] : long3 ? PASS_RUSH.CALLS[1] : short ? 1 : s.long ? PASS_RUSH.CALLS[2] : PASS_RUSH.CALLS[3];
  if (k && p.sim) k *= long3 || mid3 ? 1 : 0.75;
  if (k && form && SPREAD_O.has(form)) k *= f === "NICKEL" ? 1.4 : f === "DIME" ? 1.3 : f === "BEAR" ? 0.5 : 0.7;
  else if (k && form && HEAVY_O.has(form)) k *= f === "BASE" || f === "BEAR" ? 1.3 : f === "NICKEL" ? 0.7 : 0.3;
  return k;
}
// The CPU defense's call: the prevent when a late lead calls for it (a one-score lead in the game's last 50 s, or the
// end of a half with the ball far away; never in overtime); else from all its calls, each one's fit to the down and to
// the offense's formation when it's lined up (defFit) × the defense's identity (data.js aiFor blitz: BLITZ HEAVY teams come more, conservative ones less) × what
// the offense has done this game (a team running on its early downs sees the base and the bear more, one throwing the
// nickel and the dime) × the team's playbook (bookOf) × against repeats; at PRO to LEGEND against a person, most
// downs the call that has held up best against what he's been running (counterCall)
export function cpuDefCall(w) {
  const s = callSit(w), x = s.x;
  const dk = w.possession === "home" ? "away" : "home", team = w.teams[dk];
  const lead = w.score[dk] - w.score[w.possession]; // the defense's lead
  const lateLead = !w.ot && ((w.quarter >= 4 && w.clock < 50 && lead > 0 && lead <= 8) || ((w.quarter === 2 || w.quarter >= 4) && w.clock < 18 && x < 60));
  const book = bookOf(team, "def", s), hist = callsOf(w, dk, "def");
  if (!s.goal && lateLead && book.on("prevent") && w.rng.chance(0.65)) return DEF_PLAYS.find((p) => p.id === "prevent");
  const tend = team && team.ai;
  const extra = tend && Number.isFinite(tend.blitz) ? tend.blitz - 0.31 : 0;
  // what the offense has done: how much it runs on its early downs (after eight of them)
  const seen = callsOf(w, w.possession, "off").map((id) => OFF_PLAYS.find((p) => p.id === id)).filter(Boolean);
  const runRate = seen.length >= 8 ? seen.filter((p) => p.type === "run").length / seen.length : 0.45;
  // (the offense's formation when the defense can see it lined up — the CPU's own call, made first: world.js beginPlayCall)
  const form = w.call.off && !w.isUserTeam(w.possession) ? w.call.off.formation : null;
  const weight = (p) => {
    let v = defFit(p, s, form) * (p.w || 1);
    if (!v) return 0;
    if (p.blitz) v *= extra > 0 ? 1 + 3 * extra : Math.max(0.2, 1 + 4 * extra);
    if (runRate > 0.6 && (p.formation === "BASE" || p.formation === "BEAR" || p.blitz)) v *= 1.3;
    if (runRate < 0.3 && (p.formation === "NICKEL" || p.formation === "DIME") && !p.blitz) v *= 1.3;
    return v * book.k(p.id) * repeatK(hist, p.id);
  };
  const tiers = [(p) => book.on(p.id) && weight(p) > 0, (p) => book.on(p.id) && p.id !== "prevent" && (p.formation !== "GOALLINE" || s.goal), (p) => weight(p) > 0, () => true];
  let list = [];
  for (const t of tiers) { list = DEF_PLAYS.filter(t); if (list.length >= 2) break; }
  let pick = pickW(w, list, list.map((p) => Math.max(weight(p), 0.02)));
  // (PRO to LEGEND, away from the goal line: most downs, the call that has held up best against what this human
  // has been running — counterCall)
  if (w.hard && !w.autopilot && !w.isUserTeam(dk) && !s.goal) {
    const c = counterCall(w);
    if (c && book.on(c.id) && w.rng.chance(counterRate(w))) pick = c;
  }
  return pick;
}
// Coach's pick: the AI's suggestion for the user's side (a cosmetic rng stream so the pick doesn't perturb the sim);
// the kneel when the offense can run the clock out with it
export function coachPick(w, side) {
  if (side === "O" && kneelOut(w)) return CLOCK_PLAYS.kneel;
  const saved = w.rng.next, savedChance = w.rng.chance;
  const savedPrev = w.lastOffCall;
  let s = (w.playNo * 2654435761 + (side === "O" ? 17 : 91)) >>> 0;
  w.rng.next = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  w.rng.chance = (p) => w.rng.next() < p; // rng.chance() reads the sim's own stream (rng.js closure): route it here too
  const p = side === "O" ? cpuOffCall(w) : cpuDefCall(w);
  w.rng.next = saved; w.rng.chance = savedChance;
  w.lastOffCall = savedPrev;
  return p;
}

// ---------- 4th down: expected points ----------
// EP of a 1st down at x (yards from the own goal line) ≈ 0.065·x − 0.95 (own 20 ≈ 0.4, midfield ≈ 2.3, opp 20 ≈ 4.3).
const EP = (x) => 0.065 * clamp(x, 1, 99) - 0.95;
// conversion odds by yards to go, measured in this engine (sim: 3rd/4th downs)
const CONV = [0, 0.64, 0.53, 0.49, 0.46, 0.43, 0.39, 0.34, 0.28, 0.24, 0.21];
const convProb = (toGo) => (toGo <= 10 ? CONV[Math.max(1, Math.round(toGo))] : Math.max(0.1, 0.21 - (toGo - 10) * 0.012));
// → { go, punt, fg, best, fgProb, fgDist, convProb } for the team with the ball (deterministic: no rng)
export function fourthEval(w) {
  const x = w.los, toGo = w.toGo;
  const lead = w.score[w.possession] - w.score[w.possession === "home" ? "away" : "home"];
  const kicker = w.roster[w.possession].K;
  const fgDist = Math.round(100 - x + 17);
  const pFg = kicker ? fgMakeProb(kicker, fgDist, w.windAng ? Math.abs(w.windAng()) : 0) : 0;
  const pConv = convProb(toGo);
  const goal = x + toGo >= 100;
  const goEP = pConv * (goal ? 6.3 : EP(x + toGo) + (toGo >= 6 ? 0.3 : 0)) - (1 - pConv) * EP(100 - x);
  const fgEP = pFg * (3 - EP(25)) - (1 - pFg) * EP(100 - Math.min(x - 7, 80));
  const net = Math.min(42, 100 - x - 8);
  const puntEP = -EP(x + net >= 100 ? 20 : 100 - (x + net));
  const r = { go: goEP, fg: fgDist <= KICKING.FG_RANGE ? fgEP : -9, punt: puntEP, fgProb: pFg, fgDist, convProb: pConv };
  // the scoreboard and the clock override the chart late in the game
  const q4 = w.quarter >= 4, clock = w.clock;
  if (q4 && clock < 150 && lead < 0) {
    if (lead >= -3 && pFg > 0.35) { r.fg += 3; }
    else { r.go += 4; }
    if (clock < 60 && lead < -3) r.punt -= 6;
  }
  if (q4 && clock < 120 && lead > 0) { r.punt += 0.6; r.fg += lead <= 3 ? 1 : 0.3; r.go -= 0.5; }
  let best = "punt", bv = r.punt;
  if (r.fg > bv) { best = "fg"; bv = r.fg; }
  if (r.go > bv) { best = "go"; bv = r.go; }
  r.best = best;
  return r;
}
// (the coach's word to his person: by the chart, as his risk has it — riskFourth)
export function coachFourth(w) {
  if (lastSnapFG(w)) return "fg";
  const e = fourthEval(w), risk = riskOf(w);
  return risk === "balanced" ? e.best : riskFourth(w, e, risk);
}
// ---------- the coach's risk (config.js RISK) ----------
// team.risk: careful · balanced · aggressive · reckless (Franchise: a person's team's own pick, league.js setRisk; every
// other team balanced, the coach as he always was). It makes the 4th-down and two-point calls whenever the CPU coaches
// that team — a sim, the autopilot, the CPU's own team, an online seat it plays — and is the coach's word to its person
// (coachFourth, patChoice: COACH on the 4th-down and try panels, the call at :00).
export const RISKS = ["careful", "balanced", "aggressive", "reckless"];
export const riskOf = (w, k = w.possession) => { const t = w.teams[k], r = t && t.risk; return RISKS.includes(r) ? r : "balanced"; };
// a careful, aggressive or reckless coach's 4th down (e: fourthEval) → "go" | "punt" | "fg"
function riskFourth(w, e, risk) {
  if (risk === "reckless") return "go";
  if (risk === "careful") {
    const lead = w.score[w.possession] - w.score[w.possession === "home" ? "away" : "home"];
    const kickDoes = lead >= -3 && e.fgDist <= KICKING.FG_RANGE && e.fgProb > RISK.FG_OK;
    const must = (w.ot || (w.quarter >= 4 && w.clock < RISK.MUST)) && lead < 0 && !kickDoes;
    return must ? "go" : e.fgDist <= KICKING.FG_RANGE && e.fg > e.punt ? "fg" : "punt";
  }
  const o = [["go", e.go + RISK.GO], ["punt", e.punt], ["fg", e.fg]];
  o.sort((a, b) => b[1] - a[1]);
  return o[0][0];
}
// The last snap of a half: a CPU offense in range kicks the field goal on any down — in Q2, or in Q4 when three points
// tie it or win it — when a play now would leave no time to kick after it: the time left at the snap (a running clock:
// the kick unit hurries on, HURRY_SEC after the whistle) is under a play (CLOCK.PLAY_T) and what it takes to stop the
// clock after one (a timeout; else a hurry-up). The coach tells the user the same (coachFourth, the FIELD GOAL button).
// (A drill snaps its plays when the kick unit would; the milk snaps them late enough to come back here: milkAt.)
export function lastSnapFG(w) {
  if (w.ot || (w.quarter !== 2 && w.quarter !== 4)) return false;
  const lead = w.score[w.possession] - w.score[w.possession === "home" ? "away" : "home"];
  if (w.quarter === 4 && (lead > 0 || lead < -3)) return false;
  const left = w.halfLeft(), runs = w.clockRunning();
  const atSnap = runs ? left - Math.max(0, w.playClock - (RULES.PLAY_CLOCK - TIMING.HURRY_SEC)) : left;
  if (atSnap <= 0 || atSnap > CLOCK.PLAY_T + (w.timeouts[w.possession] > 0 ? 1 : TIMING.HURRY_SEC)) return false;
  const e = fourthEval(w);
  return e.fgDist <= KICKING.FG_RANGE && e.fgProb >= 0.25;
}
// CPU coaches follow the chart, a little more aggressive near midfield, with some variety on the close calls
export function fourthDownChoice(w) {
  const e = fourthEval(w), risk = riskOf(w);
  if (risk !== "balanced") return riskFourth(w, e, risk); // (careful, aggressive, reckless: their own coach, no coin flip)
  // coaches are a little more conservative than the chart; bold ones (data.js aiFor go4, 0.45 = balanced) go more
  const tend = w.teams[w.possession] && w.teams[w.possession].ai;
  const bold = tend && Number.isFinite(tend.go4) ? (tend.go4 - 0.45) * 1.2 : 0;
  // (PRO to LEGEND: the coach goes by the chart against a human — no cold feet, no coin flip on a close call)
  if (w.hard && !w.autopilot && !w.isUserTeam(w.possession)) { const o = [["go", e.go + bold * 0.5], ["punt", e.punt], ["fg", e.fg]]; o.sort((a, b) => b[1] - a[1]); return o[0][0]; }
  const opts = [["go", e.go - 0.3 + bold], ["punt", e.punt], ["fg", e.fg]];
  opts.sort((a, b) => b[1] - a[1]);
  if (opts[0][1] - opts[1][1] < 0.25 && w.rng.chance(0.35)) return opts[1][0];
  return opts[0][0];
}
// the try after a touchdown (diff: the margin with the touchdown in), by the team's risk: careful only when the kick can't
// tie it late, balanced the late-game chart, aggressive the chart from the second half on, reckless always
export function patChoice(w, teamKey) {
  const other = teamKey === "home" ? "away" : "home";
  const diff = w.score[teamKey] - w.score[other], risk = riskOf(w, teamKey);
  if (risk === "reckless") return "two";
  if (risk === "careful") return w.quarter >= 4 && diff === -2 ? "two" : "kick";
  if (risk === "aggressive" && w.quarter >= 3 && (RISK.TWO_AGG.includes(diff) || (w.quarter >= 4 && diff === -1))) return "two";
  if (w.quarter >= 4 && (diff === -1 || diff === 1 || diff === -5 || diff === -2 || diff === -10)) return "two";
  return "kick";
}
// ---------- fakes (F4: config.js FAKE) ----------
// The CPU's fake instead of the punt or the field goal it chose (ch) → true now and then: rarely, and only where it makes
// sense — short yardage around midfield and on their side of it, a short field goal's spot, more when it's behind in
// the second half; never in overtime, protecting a lead late, from its own end or on 4th and long. Its coach's risk:
// careful never fakes, aggressive twice as often (reckless goes for it instead of kicking at all). Draws a number only
// in those spots
export function cpuFake(w, ch) {
  const risk = riskOf(w), C = FAKE.CPU, x = w.los, toGo = w.toGo;
  if (w.ot || risk === "careful" || risk === "reckless" || toGo > 4) return false;
  const lead = scoreLead(w, w.possession), late2 = w.half() === 2;
  if (lead > 0 && w.quarter >= 4) return false;
  let p;
  if (ch === "punt") {
    if (x < 40 || x > 70) return false;
    p = C.punt[toGo <= 2 ? 0 : 1] * (x >= 50 ? C.PAST_MID : 1) * (lead < 0 && late2 ? C.BEHIND : 1);
  } else if (ch === "fg") {
    if (x < 80) return false;
    p = C.fg[toGo <= 2 ? 0 : 1] * (lead < -3 && w.quarter >= 4 ? C.BEHIND : 1);
  } else return false;
  if (risk === "aggressive") p *= C.AGGRESSIVE;
  return p > 0 && w.rng.chance(p); // (FAKE.CPU at 0: no number drawn, the games as before them)
}
// The kick defense smells a fake (its men read it sooner: FAKE.WARY): 4th and 3 or less from around midfield or a short
// field goal's spot, or the kicking team has faked already this game (world.fakes)
export function fakeWary(w, kind) {
  if (w.fakes && w.fakes[w.possession] > 0) return true;
  return w.toGo <= 3 && (kind === "fg" ? w.los >= 80 : w.los >= 40 && w.los <= 70);
}
// A fake revealed (world.fakeGo): the kick defense becomes a defense. Its rushers rush the man with the ball; the men on
// the gunners take them; the punt returner drops to the deep middle; everyone else takes the nearest receiver still
// free, else a robber's spot. Each but the rushers reads it a moment late (FAKE.REACT, less when wary) and plays the
// kick until then (p.ai.fooled: fooledThink)
export function fakeDefense(w, f) {
  const recs = w.off.filter((p) => p.as && p.as.kind === "route");
  const free = new Set(recs);
  const [r0, r1] = FAKE.REACT, k = f.wary ? FAKE.WARY : 1;
  const ret = f.kind === "punt" ? w.def.reduce((a, d) => (d.x > a.x ? d : a), w.def[0]) : null; // (the deepest: the returner)
  const jobs = new Map();
  for (const d of w.def) if (d.ai.puntRush || d.ai.fgRush) jobs.set(d, { kind: "rush" });
  if (ret && !jobs.has(ret)) jobs.set(ret, { kind: "zone", zone: "deepMid" });
  // the gunners: the men who were holding them up (CB1 on WR1, CB2 on WR2)
  for (const [cb, g] of [["CB1", "WR1"], ["CB2", "WR2"]]) {
    const d = w.bySlot(w.def, cb), r = w.bySlot(w.off, g);
    if (d && !jobs.has(d) && r && free.has(r)) { jobs.set(d, { kind: "man", target: r }); free.delete(r); }
  }
  // the rest, nearest first
  const rest = w.def.filter((d) => !jobs.has(d));
  for (const r of [...free].sort((a, b) => a.x - b.x)) {
    let best = null, bd = 1e9;
    for (const d of rest) { if (jobs.has(d)) continue; const dd = d.distTo(r.x, r.y); if (dd < bd) { bd = dd; best = d; } }
    if (best) { jobs.set(best, { kind: "man", target: r }); free.delete(r); }
  }
  for (const d of w.def) {
    const job = jobs.get(d) || { kind: "zone", zone: "robber" };
    d.as = job;
    d.ai.bite = 0; d.ai.contain = 0.55 + w.rng.next() * 0.45;
    // (a punt's rushers were going for the punter: a direct snap to the up-back gets past them for a moment too)
    const rush = job.kind === "rush";
    d.ai.fooled = rush && !(f.up && d.ai.puntRush) ? null : w.t + (rush ? FAKE.RUSH_REACT : r0 + r1 * w.rng.next()) * k;
  }
}
// the fake's offense: its protection or its run blocks, from where everyone stands (world.fakeGo)
export function fakeOffense(w, play) {
  if (play.type === "run") assignRunBlocks(w); else assignPassPro(w);
}
// a man the fake has fooled (fakeDefense): he plays the kick — a punt's wall drops back toward the returner, its
// returner waits for the ball, a field goal's men stand their ground — until he reads it
function fooledThink(w, p) {
  if (w.playType !== "normal" || !w.fake) { p.ai.fooled = null; p.want = 0; return; }
  const k = w.kicker;
  if (w.fake.kind === "punt" && p.ai.puntRush && k) { steer(p, k.x + 1.6, k.y, 1); p.sprint = true; } // (still after the punter's kick)
  else if (w.fake.kind === "punt") steer(p, p.x + (p.as && p.as.zone === "deepMid" ? 0 : 1.2), p.y, 0.5);
  else p.want = 0;
}

// CPU kick: power/accuracy with the kicker's error. Field goals: power to clear the bar from this distance (with a
// margin), accuracy ~ N(0, σ) where σ grows a little with distance and shrinks with the kicker's leg; the kicker aims
// most of the way into the wind. Calibrated to ~95% inside 30 yd, ~80% in the 40s, ~60% from 50+.
export function cpuKick(w, kicker, kind) {
  const k = clamp(kicker.r.kick / 100, 0.3, 1.1);
  if (kind === "fg" || kind === "pat") {
    const dist = 110 - w.holderSpot[0];
    const need = fgPowerFor(kicker, dist);
    const power = clamp(need + KICKING.CPU_POWER_MARGIN + w.rng.gauss() * 0.035, 0.2, 1);
    const sigma = KICKING.CPU_SIGMA * (1.2 - 0.32 * kickQuality(kicker)) * (1 + Math.max(0, dist - 40) * 0.008);
    const acc = clamp(w.rng.gauss() * sigma, -1, 1);
    const windA = w.windAng ? w.windAng() : 0;
    const aim = clamp((-windA / KICKING.AIM_ANG) * (0.6 + w.rng.next() * 0.35), -1, 1);
    return { power, acc, aim };
  }
  // an onside kick: a short one angled off to one side (as the human kicks them), where the cover team can get to it
  if (kind === "kickoff" && w.onside) return { power: w.rng.next() * 0.15, acc: clamp(w.rng.gauss() * (0.16 - k * 0.09), -1, 1), aim: (w.rng.chance(0.5) ? -1 : 1) * (0.75 + w.rng.next() * 0.25) };
  const power = kind === "kickoff" ? 0.86 + w.rng.next() * 0.12 : 0.82 + w.rng.next() * 0.16;
  const acc = w.rng.gauss() * (0.16 - k * 0.09);
  return { power: clamp(power + w.rng.gauss() * 0.03, 0.2, 1), acc: clamp(acc, -1, 1), aim: 0 };
}
// CPU special-teams calls: kickoff type (onside when it must, a squib to keep it away late) and the return lane
export function cpuKickType(w, kickTeam) {
  const other = kickTeam === "home" ? "away" : "home";
  const diff = w.score[kickTeam] - w.score[other];
  const q = w.quarter, clock = w.clock;
  if (onsideTime(w, kickTeam)) return "onside";
  if (!w.ot && (q === 2 || q >= 4) && clock < 25 && diff >= 0) return "squib";
  return w.rng.chance(0.06) ? "squib" : "normal";
}
// the kicking team is down late enough that it has to kick onside (a CPU receiving team brings its hands team)
export function onsideTime(w, kickTeam) {
  const diff = w.score[kickTeam] - w.score[kickTeam === "home" ? "away" : "home"];
  return !w.ot && w.quarter >= 4 && diff < 0 && diff >= -16 && (w.clock < 130 || (diff < -8 && w.clock < 240));
}
export function cpuReturnLane(w) {
  const r = w.rng.next();
  return r < 0.5 ? "middle" : r < 0.75 ? "left" : "right";
}
// ---------- the clock (world.js "the clock between plays") ----------
// The CPU manages the game like a coach, the same at every difficulty (config.js CLOCK): no timeouts before the two-
// minute warning (the warning stops the clock anyway, and the timeouts are worth more after it); after it, a team that
// needs points stops the clock — its defense after the other team's in-bounds plays, its offense once time gets short
// (one kept for the field goal while that's the plan) — and a team that's ahead never does. Its plan with the ball
// (clockPlan) sets its tempo, its play calls, spikes and kneels. Everything here is pure: no random number is drawn.
const scoreLead = (w, k) => w.score[k] - w.score[k === "home" ? "away" : "home"]; // k's lead (− behind)
// The field-goal line for team k: the first yard line (offense coords) its kicker makes it from at least p of the time
// in this game's wind (99: nowhere in his range)
export function fgLine(w, k = w.possession, p = CLOCK.FG_TRY) {
  const kicker = w.roster[k] && w.roster[k].K;
  if (!kicker) return 99;
  const wind = Math.abs((w.wind || 0) * KICKING.WIND_ANG);
  for (let x = 117 - KICKING.FG_RANGE; x < 99; x++) if (fgMakeProb(kicker, 117 - x, wind) >= p) return x;
  return 99;
}
// No real chance of getting into field-goal range before the half ends from los: the yards to the kicker's line
// (FG_TRY) at a drill's pace plus the kick's set-up take longer than share × (the time left and what its timeouts buy)
export function noChance(w, share, los = w.los) {
  const k = w.possession, need = Math.max(0, fgLine(w, k, CLOCK.FG_TRY) - los) / CLOCK.DRILL_YPS + CLOCK.KICK_SET;
  return w.halfLeft() + CLOCK.TO_SAVE * w.timeouts[k] < need * share;
}
// How much time a drill has for what it needs (the time left and what its timeouts buy, over the yards to its target at
// a drill's pace and the kick's set-up; the target: the field-goal line while that's the plan, else the end zone): above
// CLOCK.DRILL_EASY it can take its time (cpuOffCall: more balanced calls)
function drillTime(w) {
  const k = w.possession, need = Math.max(0, (fgPlan(w, k) ? fgLine(w, k, CLOCK.FG_TRY) : 100) - w.los) / CLOCK.DRILL_YPS + CLOCK.KICK_SET;
  return (w.halfLeft() + CLOCK.TO_SAVE * w.timeouts[k]) / need;
}
// The plan of the team with the ball, from the score and the clock (los: where the ball is, at a whistle the spot of
// the play just over):
//   "drill"   it needs points before the half is over: the hurry-up (cpuTempo), passes, timeouts once the warning is
//             given (cpuTimeout), a spike when it must, the field goal on the last snap (lastSnapFG) — behind late in
//             the game (CLOCK.HURRY), tied in its last 2:00 or in the first half's last 2:00 with a chance (noChance)
//   "milk"    a field goal wins it, the game's last CLOCK.MILK s, its kicker sure enough (MILK_FG): runs (or knees),
//             the clock run down for the kick on the last snap (milkAt)
//   "protect" ahead late (CHEW_FROM, half the 4th quarter at most), or nothing to play for at the end of a half: runs,
//             in bounds, the play clock run down to :02, the kneel when it ends it (kneelOut)
//   null      anything else
export function clockPlan(w, los = w.los) {
  if (w.ot) return null;
  const k = w.possession, d = scoreLead(w, k), left = w.halfLeft();
  if (w.half() === 2) {
    if (d > 0) return left <= Math.min(TIMING.CHEW_FROM, w.quarterSec / 2) ? "protect" : null;
    if (d >= -2 && left <= CLOCK.MILK && los >= fgLine(w, k, CLOCK.MILK_FG[0])) return "milk";
    if (d < 0) return left <= CLOCK.HURRY[d >= -8 ? 0 : d >= -16 ? 1 : 2] ? "drill" : null;
    return left <= RULES.TWO_MIN ? (noChance(w, CLOCK.CHANCE[1], los) ? "protect" : "drill") : null;
  }
  return left <= RULES.TWO_MIN ? (noChance(w, CLOCK.CHANCE[0], los) ? "protect" : "drill") : null;
}
// The CPU offense's tempo for this snap: "hurry" — its drill: no huddle, no accelerated clock, the snap HURRY_SEC after
// the whistle (a field-goal unit in a half's last 2:00 too) — else "normal" (it never holds the snap to run the clock)
export function cpuTempo(w) {
  const pt = w.playType;
  if (w.ot || (pt !== "normal" && pt !== "punt" && pt !== "fg")) return "normal";
  const plan = clockPlan(w);
  // (it never stalls the snap to run time off: no "chew" or "milk" any more, a protecting or milking team lines up and
  // snaps like any other play)
  if (pt === "punt" || plan === "protect" || plan === "milk") return "normal";
  if (pt === "fg") return w.halfLeft() <= RULES.TWO_MIN ? "hurry" : "normal";
  // (a drill already in range of the field goal it needs — the first half's, or one that wins it — with time to spare has
  // no reason to hurry: the other team would get the ball back with the time it saved)
  const d = scoreLead(w, w.possession);
  if (plan === "drill" && (w.half() === 1 || d >= -2) && w.los >= fgLine(w, w.possession, CLOCK.FG_IN) && drillTime(w) > CLOCK.DRILL_EASY) return "normal";
  return plan === "drill" ? "hurry" : "normal";
}
// The milk's snap, on the play clock: once the game clock (running with it: no accelerated clock this late) is down to
// a play (CLOCK.PLAY_T; a kneel's a second and a half) and the kick's set-up after it (1 s with a timeout to stop it,
// the kick unit's HURRY_SEC without), with CLOCK.PAD to spare; the kick itself with PAD left. Never past :02 (CHEW_AT)
export function milkAt(w) {
  const k = w.possession, off = w.call.off, play = off && off.kneel ? TIMING.KNEEL_T + 1 : CLOCK.PLAY_T;
  const after = w.playType === "fg" ? 0 : play + (w.timeouts[k] > 0 ? 1 : TIMING.HURRY_SEC);
  return Math.max(TIMING.CHEW_AT, w.playClock - Math.max(0, w.halfLeft() - after - CLOCK.PAD));
}
// The kneels run out the clock for team k from this down (the time on the play clock first if the game clock runs,
// then a kneel for each down left before 4th, the play clock again after each one unless the other team stops it:
// its timeouts, the two-minute warning still to come)
function kneelsRunOut(w, k, down, runs) {
  const left = w.halfLeft(), knees = 4 - down, stops = w.timeouts[k === "home" ? "away" : "home"] + (w.twoMin !== w.half() && left > RULES.TWO_MIN ? 1 : 0);
  const now = runs ? Math.max(0, w.playClock - TIMING.CHEW_AT) : 0;
  return knees > 0 && now + knees * TIMING.KNEEL_T + Math.max(0, knees - stops) * (RULES.PLAY_CLOCK - TIMING.CHEW_AT) >= left;
}
// Victory formation: the team with the ball takes knees until time runs out — ahead in the second half, or with nothing
// to play for at the end of a half (clockPlan "protect": tied late with no chance, to overtime; the first half) — when
// they run out the clock (kneelsRunOut). In the milk, a kneel instead of a run when the kick is close enough already
// (the ball a yard back): no fumble.
export function kneelOut(w) {
  if (w.ot || w.playType !== "normal" || w.down >= 4) return false;
  const k = w.possession, d = scoreLead(w, k), plan = clockPlan(w);
  if (plan === "milk") return w.los - 1 >= fgLine(w, k, CLOCK.MILK_FG[1]);
  if (w.half() === 2 ? d < 0 || (d === 0 && plan !== "protect") : plan !== "protect") return false;
  return kneelsRunOut(w, k, w.down, w.clockRunning());
}
// the field goal is the plan for team k (one timeout kept for it until the end: cpuTimeout): the first half, or three
// points or fewer down (or tied) late
const fgPlan = (w, k) => w.half() === 1 || (scoreLead(w, k) <= 0 && scoreLead(w, k) >= -3);
// Spike it: the drill with the clock running and no timeout left to stop it, the half nearly over, time to get it off
// (SPIKE_SEC after the whistle) and a down to spare — 3rd down only to set up a field goal that counts
export function cpuSpike(w) {
  if (w.ot || w.playType !== "normal" || !w.clockRunning() || w.down >= 4) return false;
  const k = w.possession;
  if (w.timeouts[k] > 0 || clockPlan(w) !== "drill") return false;
  const left = w.halfLeft(), until = Math.max(0, w.playClock - (RULES.PLAY_CLOCK - TIMING.SPIKE_SEC));
  if (left > 40 || left - until < 2) return false;
  if (w.down < 3) return true;
  const d = scoreLead(w, k), e = fourthEval(w);
  return e.fgDist <= KICKING.FG_RANGE && (w.half() === 1 || (d <= 0 && d >= -3));
}
// the CPU's clock play this down (a kneel, a spike) or null
export function cpuClockPlay(w) { return kneelOut(w) ? CLOCK_PLAYS.kneel : cpuSpike(w) ? CLOCK_PLAYS.spike : null; }
// Timeouts, called at the whistle of a play after which the clock runs (world.whistleClock; the state is still the
// play's: the ball goes to the result's spot). Never before the two-minute warning, never by a team that's ahead in the
// second half.
//   the offense, once the warning is given, in its drill: when time is what it's short of (TO_NEED) or the end is near
//     (TO_AT), one kept while the field goal is the plan for its set-up in the last FG_TO s (in range of a field goal
//     that wins it, only that one); in the milk only when the kick can't wait
//   the defense: behind late (by two scores or less), after every in-bounds play, unless the other team can kneel it out
//     anyway; tied late or before the half, when the other team runs the clock down (protecting, milking, in range of
//     the kick that wins it late) or is about to punt (3rd down short of the sticks out of field-goal range) with time
//     left to use the ball
export function cpuTimeout(w, k) {
  if (w.timeouts[k] <= 0 || w.ot || !w.clockRunning() || w.clock < 1) return false;
  const left = w.halfLeft(), d = scoreLead(w, k);
  if (left > RULES.TWO_MIN || (w.half() === 2 && d > 0)) return false; // before the warning; ahead: the clock is on its side
  const r = w.result, spot = r && r.x != null ? clamp(r.x, 1, 99) : w.los, plan = clockPlan(w, spot);
  if (w.possession === k) {
    if (plan === "milk") return left < CLOCK.PLAY_T + TIMING.HURRY_SEC + CLOCK.PAD; // the kick can't wait for a play and the unit's hurry
    if (plan !== "drill") return false;
    if (left <= CLOCK.FG_TO) return true; // the end: the field goal's set-up in range, else one more snap at the end zone
    const fg = fgPlan(w, k), spare = w.timeouts[k] - (fg ? 1 : 0);
    // (in range of a field goal that wins it, or the first half's: the clock is on its side until the kick's set-up)
    if (spare <= 0 || ((w.half() === 1 || d >= -2) && spot >= fgLine(w, k, CLOCK.FG_IN))) return false;
    // time is what it's short of: the yards to its target (the field-goal line while that's the plan, else the end zone;
    // two scores down, always) at a drill's pace, with TO_NEED to spare — or the end is near (TO_AT)
    const need = Math.max(0, (fg ? fgLine(w, k, CLOCK.FG_TRY) : 100) - spot) / CLOCK.DRILL_YPS;
    return d < -8 || left <= need * CLOCK.TO_NEED + CLOCK.KICK_SET || left <= CLOCK.TO_AT[0] + CLOCK.TO_AT[1] * spare;
  }
  // the defense: is it over (the other team can kneel out the rest whatever it does: kneelsRunOut from its next down)?
  const opp = w.possession, first = spot - w.los >= w.toGo - 1e-6, next = first ? 1 : w.down + 1;
  const hopeless = next <= 3 && kneelsRunOut(w, opp, next, true);
  if (w.half() === 2 && d < 0) return d >= -16 && !hopeless;
  // (tied late with the other team in range of the kick that wins it: it lets the clock run down too — cpuTempo)
  const slowInRange = plan === "drill" && w.half() === 2 && spot >= fgLine(w, opp, CLOCK.FG_IN);
  const runsDown = (plan === "protect" || plan === "milk" || slowInRange) && !hopeless;
  const punt = w.down === 3 && !first && spot < fgLine(w, opp, CLOCK.FG_TRY);
  return left >= 25 && (runsDown || punt);
}
// ====================== PRO to LEGEND: the CPU's hard brains ======================
// Only for the CPU team against a human at PRO (w.hard 1), CHAMPION (2), MASTER (3) or LEGEND (4) (difficulty.js; how
// much of each: config.js HARD), and only while the human has the controls: at ROOKIE none of this runs or draws a
// random number, nor in a CPU-vs-CPU game. It reads what a coach could see: the presnap look, and what the human did on
// the downs before (w.scout, written at each whistle: scoutPlay) — never the human's call for the down being played.
// p plays for the CPU in a human game at PRO to LEGEND → its level (1–4), else 0
export const hardOf = (w, p) => (w.hard && !w.autopilot && !w.isUserTeam(p.teamKey) ? w.hard : 0);
// a defender can get to where a pass comes down about when it does (HARD.BALL_LATE s after): he plays the ball
function ballReach(p, b, d) { return d < 13 || d / (p.r.speed * PHYS.SPRINT_MULT) < Math.max(0, b.T - b.t) + HARD.BALL_LATE; }
// Man coverage in phase with the receiver: he matches the receiver's run (velocity, plus a pull toward his spot) instead
// of chasing where the receiver was. His spot: a short cushion on top (never stepping up toward the line before the
// receiver gets to him), with inside leverage — outside once the receiver releases outside (the fade's outside step
// doesn't leave him a yard behind)
function coverTight(w, p, r, H) {
  const [c0, c1] = HARD.CUSHION[H - 1], lag = HARD.LAG[H - 1];
  const hold = Math.min(p.x, p.sx), out = r.y < MID_Y || (r.y === MID_Y && parOf(w) < 0) ? -1 : 1; // (out: toward the receiver's sideline)
  // (he sees the release coming: turns and runs before the receiver is on top of him)
  const tx = Math.max(r.x + r.vx * Math.max(lag, HARD.TURN * (r.vx > 2 ? 1 : 0)) + (w.t < 1.2 ? c0 : c1), hold);
  const ty = r.y + r.vy * lag + (r.vy * out > 1.2 && r.x - w.los > 0.5 ? out * 0.45 : -out * 0.4);
  const k = HARD.MIRROR;
  let vx = (tx - p.x) * k, vy = (ty - p.y) * k + r.vy;
  if (r.x + c0 > hold - 0.5) vx += r.vx; // he's on him: run with him
  const m = Math.hypot(vx, vy);
  if (m < 0.05) { p.want = 0; return; }
  p.mx = vx / m; p.my = vy / m;
  p.want = Math.min(1.15, m / p.r.speed);
  p.sprint = m > p.r.speed * 0.9;
}
// A scrambling QB still behind the line: a cover man with a receiver to cover stays on him (man: his man; zone: the
// route runner nearest him, within 7 yd) unless the QB is about to run past him; the spy, the rush and whoever has
// nobody close come after the QB, and everyone rallies once he crosses the line (defThink's run read)
function plaster(w, p, as, qb) {
  if (qb.x > w.los - 0.6 || p.distTo(qb.x, qb.y) < 4) return false;
  let r = as.kind === "man" ? as.target : null;
  if (!r && as.kind === "zone") { let bd = 7; for (const o of w.off) { if (!o.as || o.as.kind !== "route" || o.down > 0) continue; const dd = o.distTo(p.x, p.y); if (dd < bd) { bd = dd; r = o; } } }
  if (!r || r.down > 0 || r.x - w.los < 1.5) return false;
  coverTight(w, p, r, hardOf(w, p) || 1);
  return true;
}
// Pursuit of the human's ball carrier: every man takes a full angle on where he's going (HARD.LEAD of his run)
function pursueHard(w, p, c) { pursue(p, c, HARD.LEAD, 0, 1.15); }
// the only route runner within r of a zone's landmark
function aloneIn(w, tgt, lx, ly, r) {
  for (const o of w.off) if (o !== tgt && o.as && o.as.kind === "route" && Math.hypot(o.x - lx, o.y - ly) <= r) return false;
  return true;
}
// how long (× the normal) a CPU defender bites on the human's play action: not at all from a deep zone
function paBite(w, p, as) {
  const H = hardOf(w, p);
  if (!H) return 1;
  if (as.kind === "zone" && (ZONES[as.zone] || ZONES.robber)[0] >= 14) return 0;
  const S = w.scout;
  return HARD.PA_BITE[H - 1] * (S && S.plays >= 3 && S.pa / S.plays > 0.3 ? 0.6 : 1);
}
// the CPU's defense has seen the human run the draw lately (HARD.DRAW_AT of it, recent downs weighing most)
const drawRead = (w, p) => Boolean(hardOf(w, p) && w.scout && w.scout.play && (w.scout.play.draw || 0) >= HARD.DRAW_AT);
// a dump-off: a receiver short of 45% of the yards to go (not on a screen)
const checkDown = (w, play, r) => !play.screen && r.x - w.los < 0.45 * w.toGo && r.x - w.los < 6;
// a receiver the offense should feed: faster and surer-handed than its other route runners (HARD.STARS of that)
function starBonus(w, r, H) {
  let n = 0, sp = 0, h = 0;
  for (const o of w.off) if (o.as && o.as.kind === "route") { n++; sp += o.r.speed; h += o.r.hands; }
  return n ? clamp((r.r.speed - sp / n) * 0.35 + (r.r.hands - h / n) / 90, -0.3, 0.5) * HARD.STARS[H - 1] : 0;
}
// What a play has been worth to the CPU offense against a human this game (cpuOffCall's weights at PRO to LEGEND:
// w.scout.mine: its success rate, shrunk toward HARD.PLAY_PRIOR, how plays generally fare against a good human
// defense; a play with no prior, 0.25), so it leans on what works and leaves what doesn't
function playValue(w, id) {
  const m = w.scout && w.scout.mine && w.scout.mine[id], pr = HARD.PLAY_PRIOR[id] != null ? HARD.PLAY_PRIOR[id] : 0.25, k = HARD.PRIOR_N;
  return m ? (m.s + pr * k) / (m.n + k) : pr;
}
// run / pass: how much better the CPU's passes have done than its runs this game (→ a shift of the pass rate)
function mixShift(w) {
  const k = w.scout && w.scout.mineKind;
  if (!k || !k.run || !k.pass) return 0;
  const sr = (k.run.s + 0.25 * 4) / (k.run.n + 4), sp = (k.pass.s + 0.25 * 4) / (k.pass.n + 4);
  return clamp((sp - sr) * HARD.MIX[w.hard - 1], -0.2, 0.2);
}
// The CPU offense at the line (world.updatePresnap, once a down, the human on defense): it reads the human's look and
// checks into a better play from the same formation — a blitz look (six or more up near the line, or both corners pressed
// and five up) against a pass: its quick game; a stacked box against a run: its best pass; a light box against a pass on
// a short down: its best run
export function hardPresnap(w) {
  const play = w.call.off, H = w.hard;
  if (w.hardAud === w.playNo || !play || play.clock || w.playType !== "normal" || w.isUserTeam(w.possession)) return;
  w.hardAud = w.playNo;
  if (!w.rng.chance(HARD.AUDIBLE[H - 1])) return;
  let front = 0, box = 0, press = 0;
  for (const d of w.def) {
    const dx = d.sx - w.los, dy = Math.abs(d.sy - w.ballY);
    if (dx < 2.6 && dy < 9) front++;
    if (dx < 7.5 && dy < 7) box++;
    if ((d.slot === "CB1" || d.slot === "CB2") && dx < 2.5) press++;
  }
  const blitz = front >= 6 || (press >= 2 && front >= 5);
  const same = OFF_PLAYS.filter((p) => p.formation === play.formation && p.id !== play.id);
  // (designed QB runs as cpuOffCall calls them: a runner's; the QB SNEAK at QB_RUN.SNEAK yd or less)
  const qbOk = qbRunOk(w), sneakOk = w.toGo <= QB_RUN.SNEAK;
  const best = (type) => { let b = null, bv = -1; for (const p of same) if (p.type === type && !(type === "pass" && (p.deep || p.flea)) && (qbOk || !qbRunPlay(p)) && (sneakOk || p.id !== "sneak")) { const v = playValue(w, p.id); if (v > bv) { bv = v; b = p; } } return b; };
  let to = null;
  if (play.type === "pass" && blitz && !play.quick && !play.screen) to = same.find((p) => p.quick) || null;
  else if (play.type === "run" && box >= 8 && w.toGo > 2) to = best("pass");
  else if (play.type === "pass" && box <= 5 && w.toGo <= 3 && w.down >= 2) to = best("run");
  if (to && playValue(w, to.id) >= playValue(w, play.id) - 0.05) w.audible(to, true);
}
// The human's offense in concepts (what a defensive coordinator plans for): the fade, deep shots, the quick game, the
// intermediate passes, outside runs, inside runs; a pass he scrambled on counts as a scramble
const CONCEPT = { fade: "fade", pashot: "deep", flea: "deep", fourverts: "deep", slants: "quick", mesh: "quick", hbscreen: "quick", paflat: "quick", pacross: "mid", ycross: "mid", curlflat: "mid", paboot: "mid", toss: "edge", stretch: "edge", izone: "inside", draw: "inside", power: "inside", iso: "inside", counter: "inside", readopt: "inside", qbpower: "inside", sneak: "inside", dive: "inside" , // the doubled playbook's (pro-feedback): its RPOs count as the runs they mostly are
  dagger: "deep", wheel: "deep", papost: "deep", bunchcorner: "deep", stick: "quick", snag: "quick", wrscreen: "quick", tescreen: "quick",
  drive: "mid", smash: "mid", levels: "mid", flood: "mid", outs: "mid", nakedboot: "mid", widezone: "edge", jetsweep: "edge",
  tripszone: "inside", trap: "inside", gtcounter: "inside", delay: "inside", qbdraw: "inside", qbcounter: "inside", rposlant: "inside",
  rpoglance: "inside" };
const RUN_CONCEPT = { edge: true, inside: true };
// The call that should hold up best against the human's recent mix (w.scout.con, weighted toward run or pass by what he
// does on this down and distance: w.scout.kind): HARD.COUNTER is each call's first-down rate against each concept (the
// game's own, at CHAMPION); a softmax pick keeps it from being predictable. null until it has seen a few downs.
function counterCall(w) {
  const S = w.scout;
  if (!S || !S.con || S.plays < HARD.COUNTER_AFTER) return null;
  const bucket = (w.down >= 3 ? 3 : w.down === 2 ? 2 : 1) + (w.toGo > 6 ? "L" : "S");
  const run = (S.kind["run" + bucket] || 0) + 0.5, pass = (S.kind["pass" + bucket] || 0) + 0.5;
  let tot = 0;
  const P = {};
  for (const c in HARD.COUNTER) { P[c] = ((S.con[c] || 0) + 0.15) * (RUN_CONCEPT[c] ? run : pass) / (run + pass); tot += P[c]; }
  const calls = HARD.CALLS, E = calls.map((_, i) => { let e = 0; for (const c in P) e += (P[c] / tot) * HARD.COUNTER[c][i]; return e; });
  const lo = Math.min(...E);
  let sum = 0;
  const wt = E.map((e) => { const v = Math.exp(-HARD.COUNTER_BETA * (e - lo) / 100); sum += v; return v; });
  let r = w.rng.next() * sum;
  for (let i = 0; i < calls.length; i++) { r -= wt[i]; if (r <= 0) return DEF_PLAYS.find((p) => p.id === calls[i]) || null; }
  return null;
}
// How often the defense goes with its counter: HARD.COUNTER_P — and nearly always against a human who keeps running the
// same thing (HARD.SPAM of the rest of the way once one concept is SPAM_AT of his recent plays and more): spamming one
// money play is what gets read
function counterRate(w) {
  const base = HARD.COUNTER_P[w.hard - 1], C = w.scout && w.scout.con;
  if (!C) return base;
  let tot = 0, top = 0;
  for (const k in C) { tot += C[k]; top = Math.max(top, C[k]); }
  return base + (1 - base) * HARD.SPAM * clamp((tot > 0 ? top / tot : 0) - HARD.SPAM_AT, 0, 0.35) / 0.35;
}
// how much of the human's passing goes to this receiver lately (0..1) and how dangerous he is (speed, hands, that share)
const tgtShare = (w, slot) => { const S = w.scout, T = S && S.tgt; if (!T) return 0; let tot = 0; for (const k in T) tot += T[k]; return tot > 0.5 ? (T[slot] || 0) / tot : 0; };
const danger = (w, r) => r.r.speed + r.r.hands / 60 + 1.5 * tgtShare(w, r.slot);
// The presnap look (world.setupPlay, the CPU on defense): the better cover corner travels to the more dangerous outside
// receiver, and the corners press or play off whatever the call (pressed corners no longer give a blitz away).
// manOrder: setupPlay's receivers (0 / 1: the outside men the corners line up over)
export function hardAlign(w, def, dplay, manOrder) {
  if (!w.hard || w.autopilot || w.isUserTeam(w.defTeam)) return;
  const c1 = w.bySlot(def, "CB1"), c2 = w.bySlot(def, "CB2"), m0 = manOrder[0], m1 = manOrder[1];
  if (c1 && c2 && m0 && m1 && m0 !== m1) {
    const ds = c2.r.speed - c1.r.speed, dd = danger(w, m0) - danger(w, m1);
    if (Math.abs(ds) > 0.15 && Math.abs(dd) > 0.2 && ds * dd > 0) {
      const x = c1.x, y = c1.y, a = c1.as;
      c1.x = c2.x; c1.y = c2.y; c1.as = c2.as; c2.x = x; c2.y = y; c2.as = a;
    }
  }
  if (dplay.formation === "GOALLINE") return;
  const press = w.rng.chance(HARD.PRESS), f = defFormation(dplay.formation, w.teams[w.defTeam].scheme).pos;
  for (const c of [c1, c2]) if (c) c.x = Math.min(w.los + (press ? 1.6 : (f[c.slot] || [6])[0]), 109);
}
// At the snap: over-the-top help on the human's favorite receiver (a deep defender takes him: coverZone), and a spy
// when the human keeps scrambling
function hardSnap(w) {
  if (w.isUserTeam(w.defTeam)) return;
  const S = w.scout;
  if (!S) return;
  // (all decided from the look and the scout, not from the human's play: a bracket on a man who stays in to block just
  // covers his zone, coverZone)
  let fav = null, fv = HARD.BRACKET_AT;
  for (const r of w.off) { if (!ELIGIBLE.includes(r.slot)) continue; const v = (S.tgt && S.tgt[r.slot]) || 0; if (v > fv) { fv = v; fav = r; } }
  if (fav) {
    let help = null, hd = 1e9;
    for (const d of w.def) {
      if (!d.as || d.as.kind !== "zone" || (ZONES[d.as.zone] || ZONES.robber)[0] < 14) continue;
      const dd = Math.abs(w.ballY - (ZONES[d.as.zone] || ZONES.robber)[1] - fav.y);
      if (dd < hd) { hd = dd; help = d; }
    }
    if (help) help.ai.bracket = fav;
  }
  if (S.plays >= 3 && S.scr / S.plays >= HARD.SPY_AT && !w.def.some((d) => d.as && d.as.kind === "spy")) {
    let spy = null, sd = 1e9;
    for (const d of w.def) {
      if (!d.as || !(d.as.kind === "zone" && (ZONES[d.as.zone] || ZONES.robber)[0] < 11)) continue;
      const dd = Math.abs(d.y - w.ballY) + (d.slot.startsWith("ILB") ? 0 : 3);
      if (dd < sd) { sd = dd; spy = d; }
    }
    if (spy) spy.as = { kind: "spy" };
  }
  // a stunt (a twist): an end crashes inside, the man inside him loops around behind to the end's spot — the protection
  // matched rushers to blockers by where they lined up, so the looper can come free
  if (w.rng.chance(HARD.STUNT[w.hard - 1])) {
    const de = w.rng.chance(0.5) ? "DE1" : "DE2", e = w.bySlot(w.def, de), n = w.bySlot(w.def, "NT");
    if (e && n && e.as && n.as && e.as.kind === "rush" && n.as.kind === "rush") {
      e.ai.stunt = { x: w.los - 0.8, y: (e.sy + n.sy) / 2, until: 0.75 };
      n.ai.stunt = { x: w.los + 0.4, y: e.sy + (e.sy - n.sy) * 0.4, until: 0.95 };
    }
  }
}
// The whistle of a scrimmage down the human played (world.endPlay): what the CPU learns. Old downs fade (HARD.MEMORY a
// down), so it follows a human who changes what he does. The human's offense: his plays, formations, run / pass by
// down and distance, who he throws to, his scrambles; against his defense: how the CPU's own plays fare.
export function scoutPlay(w, res) {
  const S = w.scout;
  if (!S || w.autopilot || w.playType !== "normal" || !w.call.off || w.call.off.clock || w.call.off.fake) return;
  const k = HARD.MEMORY, fade = (o) => { for (const x in o) o[x] *= k; };
  const bump = (o, key, v = 1) => { o[key] = (o[key] || 0) + v; };
  if (w.isUserTeam(w.possession)) {
    const play = w.call.off;
    S.play = S.play || {}; S.form = S.form || {}; S.tgt = S.tgt || {}; S.kind = S.kind || {}; S.con = S.con || {};
    fade(S.play); fade(S.form); fade(S.tgt); fade(S.kind); fade(S.con);
    const scrambled = play.type === "pass" && w.scr && w.scr.play === w.playNo && w.scr.level >= 1;
    if (CONCEPT[play.id]) bump(S.con, scrambled ? "scramble" : CONCEPT[play.id]);
    S.scr = (S.scr || 0) * k; S.pa = (S.pa || 0) * k + (play.pa ? 1 : 0); S.plays = (S.plays || 0) * k + 1;
    bump(S.play, play.id); bump(S.form, play.formation);
    bump(S.kind, (play.type === "run" ? "run" : "pass") + (w.down >= 3 ? 3 : w.down === 2 ? 2 : 1) + (w.toGo > 6 ? "L" : "S"));
    const r = w.passThrown && !w.thrownAway ? w.ball.target : null;
    if (r && r.side === "O") bump(S.tgt, r.slot, r.x - w.los > 8 || (r.as && r.as.name === "fade") ? 1.4 : 1);
    if (w.scr && w.scr.play === w.playNo && w.scr.level >= 1) S.scr += 1;
  } else {
    // the CPU's own offense against the human: each play's first downs (playValue), and runs against passes (mixShift)
    S.mine = S.mine || {}; S.mineKind = S.mineKind || {};
    // (a success keeps it on schedule: 40% of the yards to go on 1st down, 60% on 2nd, all of them on 3rd and 4th)
    const play = w.call.off, x = res.type === "td" && res.carrierSide === "O" ? 100 : res.x;
    const lost = res.carrierSide === "D" || Boolean(res.fumble && res.lost);
    const ok = !lost && (res.type === "td" || (res.type !== "incomplete" && x - w.los >= w.toGo * (w.down === 1 ? 0.4 : w.down === 2 ? 0.6 : 1) - 1e-6));
    const v = ok ? 1 : lost ? -0.5 : 0;
    for (const [o, key] of [[S.mine, play.id], [S.mineKind, play.type === "run" ? "run" : "pass"]]) { const m = o[key] || (o[key] = { n: 0, s: 0 }); m.n++; m.s += v; }
  }
}
// The human's throw (world.action "pass"): the placement help a ball to an open man gets (HARD.ASSIST instead of
// 0.55 / 0.8), worse on the run (HARD.RUN_ERR at a sprint, more when he fades away from the throw), and the real
// pressure on him (the AI only measures it for a QB it drives) → the assist to throw with
export function hardThrow(w, qb, rec, open) {
  const H = w.hard;
  const [ga, ya] = HARD.ASSIST[H - 1];
  let a = open > 2.4 ? ga : open > 1 ? ya : 1;
  const sp = Math.hypot(qb.vx, qb.vy);
  if (sp > 2.5) {
    const tx = rec.x - qb.x, ty = rec.y - qb.y, tm = Math.hypot(tx, ty) || 1;
    const away = Math.max(0, -(qb.vx * tx + qb.vy * ty) / (tm * sp)); // moving away from where he throws it
    a *= 1 + HARD.RUN_ERR[H - 1] * clamp((sp - 2.5) / 4.5, 0, 1) * (1 + away);
  }
  let near = 99;
  for (const d of w.def) if (d.down <= 0 && !d.engaged) near = Math.min(near, d.distTo(qb.x, qb.y));
  w.pressure = clamp((4 - near) / 3, 0, 1);
  return a;
}
export { OFF_PLAYS, DEF_PLAYS, playsIn, offPlay };
export const ARM = arm01;
export const KICK_PHYS = PHYS;
