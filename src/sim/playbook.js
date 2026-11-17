// Formations + plays (data) and pixel route diagrams.
// Offense coords relative to the ball at the snap: [dx, dy]: dx = yards downfield (− = backfield),
// dy = yards to the offense's RIGHT. Routes: points relative to the receiver's alignment as [downfield, outside]
// (outside = toward the receiver's sideline). Run paths: points relative to the ball [dx, dy].
import { PASS_RUSH } from "./config.js";
const OL = { LT: [-0.7, -2.5], LG: [-0.7, -1.25], C: [-0.6, 0], RG: [-0.7, 1.25], RT: [-0.7, 2.5] };

export const FORMATIONS = {
  SHOTGUN: { name: "SHOTGUN", pos: { ...OL, QB: [-5, 0], HB: [-5, 1.6], FB: [-1.2, -9.5], TE: [-1, 3.9], WR1: [-0.8, -16], WR2: [-0.8, 15.5] } },
  SINGLEBACK: { name: "SINGLEBACK", pos: { ...OL, QB: [-1.1, 0], HB: [-6.5, 0], FB: [-1.6, -4.4], TE: [-1, 3.9], WR1: [-0.8, -15.5], WR2: [-0.8, 15] } },
  IFORM: { name: "I-FORM", pos: { ...OL, QB: [-1.1, 0], HB: [-7, 0], FB: [-4.6, 0], TE: [-1, 3.9], WR1: [-0.8, -15.5], WR2: [-0.8, 15] } },
  PISTOL: { name: "PISTOL", pos: { ...OL, QB: [-3.8, 0], HB: [-6.6, 0], FB: [-1.2, 9], TE: [-1, -3.9], WR1: [-0.8, -15.5], WR2: [-0.8, 15.5] } },
  GOALLINE: { name: "GOAL LINE", pos: { ...OL, QB: [-1.1, 0], HB: [-5.6, 0], FB: [-3.6, 0], TE: [-1, 3.9], WR1: [-1, -5.2], WR2: [-1, 7.5] } },
  // (2026-10-25, the playbook doubled) TRIPS: three to the right (the tight end in line, the slot, the wide man), the
  // back offset away. EMPTY: nobody in the backfield, the back and the slot split out, two left and three right. ACE:
  // two tight ends in line (12 personnel; a slot team's slot lines up there). BUNCH: three stacked tight on the right,
  // the point man on the line
  TRIPS: { name: "TRIPS", pos: { ...OL, QB: [-5, 0], HB: [-5, -1.6], TE: [-1, 3.9], FB: [-1.2, 9], WR1: [-0.8, -16], WR2: [-0.8, 15.5] } },
  EMPTY: { name: "EMPTY", pos: { ...OL, QB: [-5, 0], HB: [-1.2, -9], FB: [-1.2, 10], TE: [-1, 4.4], WR1: [-0.8, -16], WR2: [-0.8, 15.5] } },
  ACE: { name: "ACE", pos: { ...OL, QB: [-1.1, 0], HB: [-6.5, 0], FB: [-1, -3.9], TE: [-1, 3.9], WR1: [-0.8, -15.5], WR2: [-0.8, 15] } },
  BUNCH: { name: "BUNCH", pos: { ...OL, QB: [-5, 0], HB: [-5, -1.6], WR2: [-0.8, 9.6], FB: [-2, 8.4], TE: [-2, 10.9], WR1: [-0.8, -16] } },
  // the kneel (CLOCK_PLAYS): the QB under center, two up-backs at his hips, a deep back as the safety, everyone tight
  VICTORY: { name: "VICTORY", pos: { ...OL, QB: [-1.1, 0], FB: [-2.6, -1.6], WR2: [-2.6, 1.6], HB: [-7.5, 0], TE: [-1, 3.9], WR1: [-1, -3.9] } },
};

const R = {
  go: { pts: [[3, 0], [45, 0.5]], cont: true },
  slant: { pts: [[1.5, 0], [7, -5]], cont: true },
  out: { pts: [[6, 0], [6.4, 6]], cont: true },
  quickOut: { pts: [[4, 0], [4.2, 6]], cont: true },
  dig: { pts: [[11, 0], [11.4, -10]], cont: true },
  curl: { pts: [[10, 0], [8.6, -1.2]], settle: true },
  hitch: { pts: [[5.5, 0], [4.6, -0.3]], settle: true },
  post: { pts: [[10, 0], [28, -11]], cont: true },
  corner: { pts: [[10, 0], [24, 9]], cont: true },
  flat: { pts: [[1, 1.5], [3, 7]], cont: true },
  drag: { pts: [[2.5, 0], [4, -16]], cont: true },
  mesh: { pts: [[1.5, 0], [5, -18]], cont: true },
  wheel: { pts: [[0.5, 4], [3, 7], [30, 8]], cont: true },
  seam: { pts: [[5, 0], [32, -1]], cont: true },
  cross: { pts: [[6, 0], [12, -18]], cont: true },
  check: { pts: [[1.2, 3.5], [2.2, 4]], settle: true, delay: 0.9 },
  bootFlat: { pts: [[1, -2], [3, -12]], cont: true },
  // screen: block for a beat, then leak out behind the line to the flat (the linemen release in front of him)
  screen: { pts: [[0.6, 3.6], [1.1, 7.6]], settle: true, delay: 0.85 },
  // fade: outside release, then up to the back corner (goal line / red zone) — thrown as a lob
  fade: { pts: [[2, 1.6], [16, 3]], cont: true },
  // (the playbook doubled) in5: a shallow in at 5–6 · deepDig: a dig at 13 · sail: a corner at 11–15 (flood's middle
  // level) · stick: 5–6, turned out to face the QB · snag: sits down inside at 5 · deepOut: the two-minute out at 12 ·
  // swing and angle: a back's · glance: the RPO's quick seam. The screens (scr: the QB waits until he's set, ai.rateRec;
  // the convoy forms in front of him, ai.screenBlock): bubble (a step back and out, caught on the move), tunnel (the
  // wide man back inside toward the QB), teScreen (the tight end blocks a beat, then slips to the flat)
  in5: { pts: [[5.5, 0], [6, -9]], cont: true },
  deepDig: { pts: [[13, 0], [13.5, -10]], cont: true },
  sail: { pts: [[11, 0], [15, 8]], cont: true },
  stick: { pts: [[5.5, 0], [5.2, 1.2]], settle: true },
  snag: { pts: [[5, 0], [5.2, -1.6]], settle: true },
  deepOut: { pts: [[12, 0], [11.6, 7]], cont: true },
  swing: { pts: [[-1.2, 3.5], [0.4, 7.5], [2, 10]], cont: true },
  angle: { pts: [[0.6, 3.2], [4.5, 1.2], [6, -2.5]], cont: true },
  glance: { pts: [[3, 0], [10, -3.5]], cont: true },
  tunnel: { pts: [[0, -2.2], [1.6, -3]], cont: true, scr: true },
  teScreen: { pts: [[0.5, 2.4], [0.9, 5.4], [3, 6.6]], cont: true, delay: 0.8, scr: true },
};
const route = (r, extra) => ({ kind: "route", ...R[r], name: r, ...(extra || {}) });
const pass = { kind: "block", block: "pass" };
const runb = { kind: "block", block: "run" };
const OLpass = { LT: pass, LG: pass, C: pass, RG: pass, RT: pass };
const OLrun = { LT: runb, LG: runb, C: runb, RG: runb, RT: runb };

const screenb = { kind: "block", block: "screen" }; // pass-set for a beat, then release to lead the screen
const flea = { kind: "flea" }; // flea flicker: take the handoff, run at the line, pitch it back to the QB

// side: +1 = runs to the offense's right, −1 left. run: path points relative to the ball.
// hole (runs): the aiming point [dx, dy] the blocking scheme is built around (default: the path's 2nd point).
// Pass-play flags: pa (play-action fake), boot (QB rolls out), quick (3-step timing), screen, flea (flea flicker),
// deep (max-protect shot: the QB waits for the deep routes), read (s: when the QB starts his reads — rhythm concepts),
// release (s: when the screen's blockers leave their pass set to lead it; else 0.85). pos: a play's own spots over its
// formation's (the jet sweep's receiver in a tight slot: offPos; a defensive call's over its front's: defPos).
// Run flags: toss, option (read option), delay (draw; a QB carrier's too: he sets up as if to pass, then runs), jet (a
// toss to a man crossing in front of the QB: pitched once he's close), rpo (the run-pass option: the slot whose quick
// route is the pass; at the mesh the QB hands off or pulls it and throws there: world.js, ai.rpoRead),
// surge (short yardage: the line gets a push and holds its blocks). w: CPU play-calling weight (default 1) — the slow
// gap runs (power, counter, iso) are called less, the perimeter runs and the draw more (rushing ≈ 3.5–6 yd/carry).
// Blocks: pass, run, screen (pass-set, then lead the screen), lead (aim: a back or a tackle through the hole), pull (a
// guard kicks out the end man; wrap: through the hole for the linebacker instead), trap (pull and kick out the first
// lineman past the center on the play side).
export const OFF_PLAYS = [
  // SHOTGUN
  { id: "fourverts", name: "FOUR VERTS", formation: "SHOTGUN", type: "pass", drop: 2, read: 2, w: 0.45, a: { ...OLpass, WR1: route("go"), WR2: route("go"), TE: route("seam"), FB: route("seam"), HB: route("check"), QB: { kind: "qb" } }, prog: ["WR2", "TE", "FB", "WR1", "HB"] },
  { id: "mesh", name: "MESH", formation: "SHOTGUN", type: "pass", drop: 1.5, read: 1.25, w: 1.2, a: { ...OLpass, WR1: route("mesh"), TE: route("mesh"), WR2: route("corner"), FB: route("dig"), HB: route("flat", { side: 1 }), QB: { kind: "qb" } }, prog: ["WR1", "TE", "HB", "FB", "WR2"] },
  { id: "slants", name: "SLANTS", formation: "SHOTGUN", type: "pass", drop: 1, quick: true, w: 1.2, a: { ...OLpass, WR1: route("slant"), WR2: route("slant"), FB: route("slant"), TE: route("hitch"), HB: route("flat", { side: -1 }), QB: { kind: "qb" } }, prog: ["WR2", "WR1", "FB", "TE", "HB"] },
  { id: "draw", name: "HB DRAW", formation: "SHOTGUN", type: "run", carrier: "HB", delay: 0.65, w: 1.15, hole: [1, 0.4], run: [[-3.5, 0.6], [1, 0.4], [6, 0.2]], a: { ...OLpass, WR1: route("go"), WR2: route("go"), TE: runb, FB: route("hitch"), QB: { kind: "qb", handoff: true } } },
  { id: "hbscreen", name: "HB SCREEN", formation: "SHOTGUN", type: "pass", drop: 3, screen: true, w: 0.35, a: { LT: pass, LG: screenb, C: screenb, RG: screenb, RT: pass, WR1: route("go"), WR2: route("go"), TE: route("seam"), FB: route("hitch"), HB: route("screen"), QB: { kind: "qb" } }, prog: ["HB", "FB", "TE"] },
  { id: "drive", name: "DRIVE", formation: "SHOTGUN", type: "pass", drop: 2, read: 1.5, a: { ...OLpass, FB: route("drag"), WR2: route("dig"), TE: route("stick"), WR1: route("post"), HB: route("check"), QB: { kind: "qb" } }, prog: ["FB", "WR2", "TE", "HB", "WR1"] },
  // SINGLEBACK
  { id: "izone", name: "INSIDE ZONE", formation: "SINGLEBACK", type: "run", carrier: "HB", w: 0.8, hole: [0.5, 1], run: [[-4, 0.5], [0.5, 1], [6, 0.8]], a: { ...OLrun, TE: runb, FB: runb, WR1: runb, WR2: runb, QB: { kind: "qb", handoff: true } } },
  { id: "pacross", name: "PA CROSSERS", formation: "SINGLEBACK", type: "pass", drop: 2.5, pa: true, a: { ...OLpass, WR1: route("cross"), WR2: route("post"), TE: route("drag"), FB: route("flat", { side: 1 }), HB: { kind: "fake" }, QB: { kind: "qb" } }, prog: ["WR1", "WR2", "TE", "FB"] },
  { id: "curlflat", name: "CURL FLAT", formation: "SINGLEBACK", type: "pass", drop: 2, read: 1.45, a: { ...OLpass, WR1: route("curl"), WR2: route("curl"), TE: route("flat"), FB: route("flat"), HB: route("check"), QB: { kind: "qb" } }, prog: ["WR2", "TE", "WR1", "FB", "HB"] },
  { id: "stretch", name: "OUTSIDE STRETCH", formation: "SINGLEBACK", type: "run", carrier: "HB", w: 1.3, hole: [0, 5.6], run: [[-4.6, 2.4], [-2, 5.6], [2, 6.6], [9, 7]], a: { ...OLrun, TE: runb, FB: runb, WR1: runb, WR2: runb, QB: { kind: "qb", handoff: true } } },
  { id: "pashot", name: "PA DEEP SHOT", formation: "SINGLEBACK", type: "pass", drop: 3, pa: true, deep: true, a: { ...OLpass, WR1: route("post"), WR2: route("go"), TE: pass, FB: pass, HB: { kind: "fake" }, QB: { kind: "qb" } }, prog: ["WR2", "WR1"] },
  { id: "smash", name: "SMASH", formation: "SINGLEBACK", type: "pass", drop: 2.5, read: 1.65, a: { ...OLpass, WR1: route("hitch"), WR2: route("hitch"), FB: route("corner"), TE: route("corner"), HB: route("check"), QB: { kind: "qb" } }, prog: ["TE", "WR2", "FB", "WR1", "HB"] },
  // I-FORM
  { id: "power", name: "POWER O", formation: "IFORM", type: "run", carrier: "HB", w: 0.55, hole: [0.4, 1.9], run: [[-4.5, 0.5], [0.4, 1.9], [6, 2.4]], a: { ...OLrun, LG: { kind: "block", block: "pull" }, TE: runb, FB: { kind: "block", block: "lead", aim: [1, 2.1] }, WR1: runb, WR2: runb, QB: { kind: "qb", handoff: true } } },
  { id: "iso", name: "ISO", formation: "IFORM", type: "run", carrier: "HB", w: 0.45, hole: [0.5, -1.8], run: [[-4, -0.6], [0.5, -1.8], [6, -2]], a: { ...OLrun, TE: runb, FB: { kind: "block", block: "lead", aim: [1, -1.8] }, WR1: runb, WR2: runb, QB: { kind: "qb", handoff: true } } },
  { id: "paboot", name: "PA BOOT", formation: "IFORM", type: "pass", drop: 2.5, pa: true, boot: -1, a: { ...OLpass, WR1: route("dig"), WR2: route("post"), TE: route("cross"), FB: route("bootFlat"), HB: { kind: "fake" }, QB: { kind: "qb" } }, prog: ["FB", "TE", "WR1", "WR2"] },
  { id: "toss", name: "TOSS", formation: "IFORM", type: "run", carrier: "HB", toss: true, w: 1.25, hole: [0, -7.5], run: [[-6.2, -3], [-3.5, -6.4], [0.5, -8.2], [8, -8.8]], a: { ...OLrun, TE: runb, FB: { kind: "block", block: "lead", aim: [0.5, -7] }, WR1: runb, WR2: runb, QB: { kind: "qb", handoff: true } } },
  { id: "flea", name: "FLEA FLICKER", formation: "IFORM", type: "pass", drop: 2, flea: true, a: { ...OLpass, WR1: route("post"), WR2: route("go"), TE: route("seam", { delay: 0.7 }), FB: pass, HB: flea, QB: { kind: "qb" } }, prog: ["WR2", "WR1", "TE"] },
  { id: "trap", name: "TRAP", formation: "IFORM", type: "run", carrier: "HB", w: 0.25, hole: [0.4, 1.4], run: [[-4.4, 0.3], [0.4, 1.4], [6, 1.6]], a: { ...OLrun, LG: { kind: "block", block: "trap" }, TE: runb, FB: { kind: "block", block: "lead", aim: [1, 1.2] }, WR1: runb, WR2: runb, QB: { kind: "qb", handoff: true } } },
  // PISTOL
  { id: "readopt", name: "READ OPTION", formation: "PISTOL", type: "run", carrier: "HB", option: true, w: 1.2, hole: [0.5, -1.4], run: [[-4.2, -1], [0.5, -1.4], [6, -1.4]], a: { ...OLrun, TE: runb, FB: runb, WR1: runb, WR2: runb, QB: { kind: "qb", handoff: true } } },
  { id: "counter", name: "COUNTER", formation: "PISTOL", type: "run", carrier: "HB", hole: [0.4, -1.9], w: 0.35, run: [[-4.8, 0.6], [-3.2, -1.2], [0.4, -1.9], [6, -2.4]], a: { ...OLrun, RG: { kind: "block", block: "pull" }, TE: runb, FB: runb, WR1: runb, WR2: runb, QB: { kind: "qb", handoff: true } } },
  { id: "ycross", name: "Y-CROSS", formation: "PISTOL", type: "pass", drop: 2.5, a: { ...OLpass, TE: route("cross"), WR1: route("post"), WR2: route("dig"), FB: route("out"), HB: route("check"), QB: { kind: "qb" } }, prog: ["TE", "WR2", "FB", "WR1", "HB"] },
  { id: "qbpower", name: "QB POWER", formation: "PISTOL", type: "run", carrier: "QB", w: 0.5, hole: [0.5, 2.6], run: [[-2.4, 1.3], [0.5, 2.6], [6, 3]], a: { ...OLrun, LG: { kind: "block", block: "pull" }, TE: runb, FB: runb, WR1: runb, WR2: runb, HB: { kind: "block", block: "lead", aim: [0.6, 2.6] }, QB: { kind: "qb", keep: true } } },
  { id: "rposlant", name: "RPO SLANT", formation: "PISTOL", type: "run", carrier: "HB", rpo: "WR2", w: 0.6, hole: [0.5, 1], run: [[-4.2, 0.6], [0.5, 1], [6, 0.8]], a: { ...OLrun, TE: runb, FB: runb, WR1: runb, WR2: route("slant"), QB: { kind: "qb", handoff: true } } },
  { id: "qbcounter", name: "QB COUNTER", formation: "PISTOL", type: "run", carrier: "QB", w: 0.45, hole: [0.4, -2], run: [[-4.4, 0.8], [-3, -0.6], [0.4, -2], [6, -2.4]], a: { ...OLrun, RG: { kind: "block", block: "pull" }, TE: runb, FB: runb, WR1: runb, WR2: runb, HB: { kind: "block", block: "lead", aim: [0.6, -2.2] }, QB: { kind: "qb", keep: true } } },
  // GOAL LINE
  { id: "sneak", name: "QB SNEAK", formation: "GOALLINE", type: "run", carrier: "QB", surge: true, hole: [0.6, 0.1], run: [[0.6, 0.1], [4, 0]], a: { ...OLrun, TE: runb, FB: { kind: "block", block: "lead", aim: [1, 0] }, HB: runb, WR1: runb, WR2: runb, QB: { kind: "qb", sneak: true } } },
  { id: "dive", name: "HB DIVE", formation: "GOALLINE", type: "run", carrier: "HB", surge: true, hole: [0.5, 0.9], run: [[-3, 0.3], [0.5, 0.9], [5, 0.9]], a: { ...OLrun, TE: runb, FB: { kind: "block", block: "lead", aim: [1, 1] }, WR1: runb, WR2: runb, QB: { kind: "qb", handoff: true } } },
  { id: "paflat", name: "PA FLAT", formation: "GOALLINE", type: "pass", drop: 2, pa: true, a: { ...OLpass, TE: route("flat"), FB: route("flat", { side: -1 }), WR1: route("slant"), WR2: route("corner"), HB: { kind: "fake" }, QB: { kind: "qb" } }, prog: ["TE", "FB", "WR2", "WR1"] },
  { id: "fade", name: "FADE", formation: "GOALLINE", type: "pass", drop: 1.5, lob: true, a: { ...OLpass, WR1: route("fade"), WR2: route("fade"), TE: route("flat"), FB: pass, HB: pass, QB: { kind: "qb" } }, prog: ["WR2", "WR1", "TE"] },
  // TRIPS
  { id: "rpoglance", name: "RPO GLANCE", formation: "TRIPS", type: "run", carrier: "HB", rpo: "FB", w: 0.9, hole: [0.5, 1], run: [[-4.4, -0.4], [0.5, 1], [6, 1]], a: { ...OLrun, TE: runb, FB: route("glance"), WR2: runb, WR1: runb, QB: { kind: "qb", handoff: true } } },
  { id: "jetsweep", name: "JET SWEEP", formation: "TRIPS", type: "run", carrier: "WR1", toss: true, jet: true, w: 0.35, pos: { WR1: [-1.4, -4.6] }, hole: [0, 10], run: [[-1.7, -2.2], [-1.8, 0.5], [-1.1, 4.5], [1.5, 9], [8, 12]], a: { ...OLrun, TE: runb, FB: runb, WR2: runb, HB: { kind: "fake" }, QB: { kind: "qb", handoff: true } } }, // the backside receiver from a tight slot, across to the trips side
  { id: "tripszone", name: "WEAK ZONE", formation: "TRIPS", type: "run", carrier: "HB", w: 0.8, hole: [0.5, -1.2], run: [[-4.4, -1.8], [0.5, -1.2], [6, -1.4]], a: { ...OLrun, TE: runb, FB: runb, WR2: runb, WR1: runb, QB: { kind: "qb", handoff: true } } },
  { id: "levels", name: "LEVELS", formation: "TRIPS", type: "pass", drop: 2, read: 1.6, a: { ...OLpass, TE: route("in5"), FB: route("deepDig"), WR2: route("go"), WR1: route("curl"), HB: route("check"), QB: { kind: "qb" } }, prog: ["FB", "TE", "WR1", "HB", "WR2"] },
  { id: "flood", name: "FLOOD", formation: "TRIPS", type: "pass", drop: 2.5, read: 1.75, a: { ...OLpass, WR2: route("go"), FB: route("sail"), TE: route("flat"), WR1: route("post"), HB: route("check"), QB: { kind: "qb" } }, prog: ["FB", "TE", "WR2", "WR1", "HB"] },
  { id: "wrscreen", name: "WR SCREEN", formation: "TRIPS", type: "pass", drop: 1, quick: true, screen: true, read: 0.3, release: 0.05, w: 0.45, a: { ...OLpass, WR2: route("tunnel"), FB: screenb, TE: screenb, WR1: route("go"), HB: pass, QB: { kind: "qb" } }, prog: ["WR2", "WR1"] }, // the slot and the tight end lead it at once (release)
  // EMPTY
  { id: "qbdraw", name: "QB DRAW", formation: "EMPTY", type: "run", carrier: "QB", delay: 0.7, w: 0.6, hole: [1, 0.4], run: [[-5.6, 0], [1, 0.4], [6, 0.3]], a: { ...OLpass, WR1: route("go"), WR2: route("go"), HB: route("seam"), FB: route("seam"), TE: route("hitch"), QB: { kind: "qb", keep: true } } },
  { id: "outs", name: "OUTS", formation: "EMPTY", type: "pass", drop: 2, read: 1.75, a: { ...OLpass, WR1: route("deepOut"), WR2: route("deepOut"), HB: route("out"), FB: route("out"), TE: route("stick"), QB: { kind: "qb" } }, prog: ["WR2", "FB", "WR1", "HB", "TE"] },
  { id: "stick", name: "STICK", formation: "EMPTY", type: "pass", drop: 1.5, quick: true, read: 0.95, a: { ...OLpass, TE: route("stick"), FB: route("flat"), WR2: route("go"), HB: route("stick"), WR1: route("slant"), QB: { kind: "qb" } }, prog: ["TE", "FB", "HB", "WR1", "WR2"] },
  { id: "dagger", name: "DAGGER", formation: "EMPTY", type: "pass", drop: 2.5, read: 2.05, a: { ...OLpass, FB: route("seam"), WR2: route("deepDig"), TE: route("stick"), HB: route("in5"), WR1: route("go"), QB: { kind: "qb" } }, prog: ["WR2", "FB", "TE", "HB", "WR1"] },
  { id: "wheel", name: "SLOT WHEEL", formation: "EMPTY", type: "pass", drop: 2.5, read: 1.8, a: { ...OLpass, HB: route("wheel"), WR1: route("slant"), FB: route("curl"), WR2: route("go"), TE: route("drag"), QB: { kind: "qb" } }, prog: ["HB", "WR1", "FB", "TE", "WR2"] },
  // ACE
  { id: "widezone", name: "WIDE ZONE", formation: "ACE", type: "run", carrier: "HB", w: 1.15, hole: [0, -5.6], run: [[-4.6, -2.4], [-2, -5.6], [2, -6.6], [9, -7]], a: { ...OLrun, TE: runb, FB: runb, WR1: runb, WR2: runb, QB: { kind: "qb", handoff: true } } },
  { id: "gtcounter", name: "GT COUNTER", formation: "ACE", type: "run", carrier: "HB", w: 0.2, hole: [0.4, -2.2], run: [[-4.8, 0.6], [-3.2, -1.2], [0.4, -2.2], [6, -2.6]], a: { ...OLrun, RG: { kind: "block", block: "pull" }, RT: { kind: "block", block: "pull", wrap: true }, TE: runb, FB: runb, WR1: runb, WR2: runb, QB: { kind: "qb", handoff: true } } },
  { id: "papost", name: "PA POST", formation: "ACE", type: "pass", drop: 3, pa: true, deep: true, a: { ...OLpass, WR1: route("post"), WR2: route("deepDig"), TE: pass, FB: pass, HB: { kind: "fake" }, QB: { kind: "qb" } }, prog: ["WR1", "WR2"] },
  { id: "nakedboot", name: "NAKED BOOT", formation: "ACE", type: "pass", drop: 2.5, pa: true, boot: 1, a: { ...OLpass, TE: route("flat"), FB: route("drag"), WR2: route("sail"), WR1: route("post"), HB: { kind: "fake" }, QB: { kind: "qb" } }, prog: ["TE", "FB", "WR2", "WR1"] },
  { id: "tescreen", name: "TE SCREEN", formation: "ACE", type: "pass", drop: 3, screen: true, release: 0.7, w: 0.3, a: { LT: pass, LG: pass, C: screenb, RG: screenb, RT: screenb, TE: route("teScreen"), FB: pass, HB: screenb, WR1: route("go"), WR2: route("go"), QB: { kind: "qb" } }, prog: ["TE", "WR2"] },
  // BUNCH
  { id: "snag", name: "SNAG", formation: "BUNCH", type: "pass", drop: 1.5, read: 1.25, a: { ...OLpass, WR2: route("snag"), TE: route("corner"), FB: route("flat"), WR1: route("slant"), HB: route("check"), QB: { kind: "qb" } }, prog: ["TE", "WR2", "FB", "WR1", "HB"] },
  { id: "bunchcorner", name: "BUNCH CORNER", formation: "BUNCH", type: "pass", drop: 2, read: 1.65, a: { ...OLpass, WR2: route("corner"), TE: route("flat"), FB: route("in5"), WR1: route("dig"), HB: route("check"), QB: { kind: "qb" } }, prog: ["WR2", "TE", "FB", "WR1", "HB"] },
  { id: "delay", name: "DELAY", formation: "BUNCH", type: "run", carrier: "HB", delay: 0.8, w: 0.45, hole: [1, -0.8], run: [[-3.6, -1], [1, -0.8], [6, -1]], a: { ...OLpass, WR1: route("go"), WR2: route("go"), TE: route("seam"), FB: route("out"), QB: { kind: "qb", handoff: true } } },
];
export const OFF_FORMATION_ORDER = ["SHOTGUN", "TRIPS", "BUNCH", "EMPTY", "SINGLEBACK", "ACE", "IFORM", "PISTOL", "GOALLINE"];
// Clock plays: the play call's SPIKE and KNEEL, the CPU's two-minute drill and victory formation (ai.js). Not in
// OFF_PLAYS, so the CPU never picks them at random and the formation tabs don't list them; world.js clockPlay() runs
// them: the QB spikes it into the ground (an incomplete pass: the clock stops and a down is gone) or takes a knee (a
// run for a yard's loss: the clock runs on). Everyone else blocks.
const allBlock = { ...OLpass, HB: pass, FB: pass, TE: pass, WR1: pass, WR2: pass };
export const CLOCK_PLAYS = {
  spike: { id: "spike", name: "SPIKE", formation: "SINGLEBACK", type: "pass", clock: true, spike: true, prog: [], a: { ...allBlock, QB: { kind: "qb" } } },
  kneel: { id: "kneel", name: "KNEEL", formation: "VICTORY", type: "run", clock: true, kneel: true, carrier: "QB", hole: [0, 0], run: [[-1.4, 0]], a: { ...allBlock, QB: { kind: "qb", keep: true } } },
};

// Fakes (F4, 2026-10-29: fake punts and fake field goals; world.js fakeGo): the kick unit's own plays once the snap is in
// the hands of the man it went to. The kick formations stay as the kick lines up (world.js setupPunt / setupFG): only
// the jobs change, so the defense sees a kick until the snap. Not in OFF_PLAYS (the play call never lists them).
//   punt    the punter takes it and throws (or runs): the gunners stop on a hitch in front of the men holding them up,
//           the tight end runs a shallow in, the right up-back leaks to the flat; the left one stays in. A quick read
//   upback  4th and a yard or so (config.js FAKE.UPBACK): the snap goes straight to the left up-back, who runs behind
//           the line's run blocks, the other up-back leading
//   fg      the holder takes it and rolls out to the tight end's side (boot): the tight end's flat, the left wing's
//           corner, the right wing in the flat late; or he runs it
export const FAKE_PLAYS = {
  punt: { id: "fakepunt", name: "FAKE PUNT", formation: "SHOTGUN", type: "pass", fake: "punt", quick: true, read: 1.1, a: { ...OLpass, WR1: route("hitch"), WR2: route("hitch"), TE: route("in5"), HB: route("flat"), FB: pass }, prog: ["TE", "WR2", "WR1", "HB"] },
  upback: { id: "fakeup", name: "FAKE PUNT", formation: "SHOTGUN", type: "run", fake: "punt", carrier: "FB", surge: true, hole: [0.6, -0.7], run: [[-3.5, -0.8], [0.6, -0.7], [6, -0.7]], a: { ...OLrun, TE: runb, HB: { kind: "block", block: "lead", aim: [1, -0.7] }, WR1: runb, WR2: runb } },
  fg: { id: "fakefg", name: "FAKE FIELD GOAL", formation: "GOALLINE", type: "pass", fake: "fg", boot: 1, read: 1.25, a: { ...OLpass, TE: route("flat"), WR1: route("corner"), FB: route("flat", { delay: 0.6 }), HB: pass }, prog: ["TE", "WR1", "FB"] },
};

// Defense: alignments [dx beyond LOS, dy]. CBs align on the outside receivers at the snap (dynamic).
const DEF_FORM = {
  BASE34: { name: "3-4", pos: { DE1: [1, -3.1], NT: [1, 0], DE2: [1, 3.1], OLB1: [1.3, -5.6], ILB1: [4.8, -2], ILB2: [4.8, 2], OLB2: [1.3, 5.6], CB1: [6, -15], CB2: [6, 15], S1: [12, -7.5], S2: [12, 7.5] } },
  BASE43: { name: "4-3", pos: { DE1: [1, -4], NT: [1, -1.2], ILB2: [1, 1.2], DE2: [1, 4], OLB1: [4.6, -4.4], ILB1: [5, 0], OLB2: [4.6, 4.4], CB1: [6, -15], CB2: [6, 15], S1: [12, -7.5], S2: [12, 7.5] } },
  NICKEL: { name: "NICKEL", pos: { DE1: [1, -3.6], NT: [1, -0.8], DE2: [1, 3.6], OLB1: [1.3, -5.6], ILB1: [5, -1.5], ILB2: [5.5, 9], OLB2: [1.3, 5.6], CB1: [6, -15], CB2: [6, 15], S1: [12.5, -8], S2: [12.5, 8] } },
  DIME: { name: "DIME", pos: { DE1: [1, -3.6], NT: [1, 0], DE2: [1, 3.6], OLB1: [5.5, -9], ILB1: [6, 0], ILB2: [5.5, 9], OLB2: [1.3, 5.6], CB1: [7, -15], CB2: [7, 15], S1: [14, -9], S2: [14, 9] } },
  GOALLINE: { name: "GOAL LINE", pos: { DE1: [0.8, -3.4], NT: [0.8, -1], DE2: [0.8, 3.4], OLB1: [0.8, -5.4], ILB1: [2.2, -1.6], ILB2: [2.2, 1.6], OLB2: [0.8, 5.4], CB1: [2, -6], CB2: [2, 8], S1: [4.5, -3], S2: [4.5, 3] } },
  // With config.js PASS_RUSH.FRONTS43 (off: the run died against them, config.js says why), a 4-3 keeps its four down
  // linemen in every front — its tackles (the NT and ILB2 spots) inside — and in the nickel and the dime its outside
  // linebackers play off the ball and in the slot, where the 3-4 stands its ILB2 (defFormation; the calls' a43: the ILB2
  // rushes and the OLB2 takes his job). Without it a 4-3 plays these fronts as a 3-4 does: a tackle on the slot receiver.
  NICKEL43: { name: "NICKEL", pos: { DE1: [1, -4], NT: [1, -1.2], ILB2: [1, 1.2], DE2: [1, 4], OLB1: [4.6, -4.5], ILB1: [5, 0.5], OLB2: [5.5, 9], CB1: [6, -15], CB2: [6, 15], S1: [12.5, -8], S2: [12.5, 8] } },
  DIME43: { name: "DIME", pos: { DE1: [1, -4], NT: [1, -1.2], ILB2: [1, 1.2], DE2: [1, 4], OLB1: [5.5, -9], ILB1: [6, 0], OLB2: [5.5, 9], CB1: [7, -15], CB2: [7, 15], S1: [14, -9], S2: [14, 9] } },
  GOALLINE43: { name: "GOAL LINE", pos: { DE1: [0.8, -3.4], NT: [0.8, -1.1], ILB2: [0.8, 1.1], DE2: [0.8, 3.4], OLB1: [0.8, -5.4], ILB1: [2.2, 0], OLB2: [0.8, 5.4], CB1: [2, -6], CB2: [2, 8], S1: [4.5, -3], S2: [4.5, 3] } },
  // (the playbook doubled) BEAR: the run front — five on the line inside the tackles' reach, both inside linebackers
  // stacked close, the strong safety down in the box (eight in it), one deep. A 4-3 keeps its four down linemen here
  // (BEAR43: its tackles at the NT and ILB2 spots), whatever FRONTS43 says: it's the front for stopping the run
  BEAR: { name: "BEAR", pos: { DE1: [1, -2.6], NT: [1, 0], DE2: [1, 2.6], OLB1: [1.2, -5], OLB2: [1.2, 5], ILB1: [4.5, -2.4], ILB2: [4.5, 2.4], CB1: [5, -15], CB2: [5, 15], S1: [7, 6], S2: [12, 0] } },
  BEAR43: { name: "BEAR", pos: { DE1: [1, -3.6], NT: [1, -1.1], ILB2: [1, 1.1], DE2: [1, 3.6], OLB1: [1.2, -5.6], OLB2: [1.2, 5.6], ILB1: [4.5, 0], CB1: [5, -15], CB2: [5, 15], S1: [7, 5], S2: [12, 0] } },
};
// Zone landmarks [depth, dy]
export const ZONES = {
  deepHalfL: [17, -11], deepHalfR: [17, 11], deepMid: [16, 0], deep3L: [15, -17], deep3R: [15, 17],
  quarterLL: [15, -18], quarterL: [15, -6], quarterR: [15, 6], quarterRR: [15, 18],
  flatL: [4.5, -16], flatR: [4.5, 16], hookL: [8, -6.5], hookR: [8, 6.5], hookM: [9, 0], curlL: [9, -12], curlR: [9, 12],
  robber: [10, 0], deepPrevL: [24, -12], deepPrevR: [24, 12], deepPrevM: [26, 0], gl_flatL: [2, -10], gl_flatR: [2, 10], gl_mid: [3, 0],
};
const z = (k) => ({ kind: "zone", zone: k });
const man = (n) => ({ kind: "man", n }); // n = manIndex (0 = outside-left #1, 1 = outside-right #1, 2.. inside receivers)
const rush = { kind: "rush" };
const spy = { kind: "spy" };
// Per front: which slots are DL in 4-3 vs 3-4 is handled by the scheme; plays list assignments for every defender.
export const DEF_PLAYS = [
  { id: "c2", name: "COVER 2", formation: "BASE", cov: "zone", a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, ILB1: z("hookL"), ILB2: z("hookR"), OLB2: z("curlR"), CB1: z("flatL"), CB2: z("flatR"), S1: z("deepHalfL"), S2: z("deepHalfR") }, a43: { ILB2: rush, OLB1: z("curlL"), ILB1: z("hookM"), OLB2: z("curlR") } },
  { id: "c3", name: "COVER 3", formation: "BASE", cov: "zone", a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, ILB1: z("hookL"), ILB2: z("hookR"), OLB2: z("flatR"), CB1: z("deep3L"), CB2: z("deep3R"), S1: z("flatL"), S2: z("deepMid") }, a43: { ILB2: rush, OLB1: z("flatL"), ILB1: z("hookL"), OLB2: z("flatR"), S1: z("deepMid"), S2: z("hookR") } }, // 3-4: S1 rotates down to his own flat, S2 to the deep middle; 4-3: OLB1 + ILB1 take the left flat and hook, OLB2 + S2 the right
  { id: "manblitz", name: "MAN BLITZ", formation: "BASE", cov: "man", blitz: true, a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, OLB2: rush, ILB2: rush, ILB1: man(3), CB1: man(0), CB2: man(1), S1: man(2), S2: z("deepMid") }, a43: { ILB2: rush, OLB2: rush, OLB1: rush, ILB1: man(3) }, pos43: { OLB1: [1.3, -5.6], OLB2: [1.3, 5.6] } }, // (a 4-3 sends six too: both outside linebackers walk up to the edge, as a 3-4's stand there)
  { id: "c2mb", name: "COVER 2 MAN", formation: "BASE", cov: "man", a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, OLB2: man(4), ILB1: man(3), ILB2: man(2), CB1: man(0), CB2: man(1), S1: z("deepHalfL"), S2: z("deepHalfR") }, a43: { ILB2: rush, OLB1: man(2), ILB1: man(3), OLB2: man(4) } },
  { id: "tampa2", name: "TAMPA 2", formation: "BASE", w: 0.9, cov: "zone", a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, ILB1: z("deepMid"), ILB2: z("hookL"), OLB2: z("hookR"), CB1: z("flatL"), CB2: z("flatR"), S1: z("deepHalfL"), S2: z("deepHalfR") }, a43: { ILB2: rush, OLB1: z("hookL"), OLB2: z("hookR") } }, // the middle linebacker runs the deep middle between the halves
  { id: "c1r", name: "COVER 1 ROBBER", formation: "BASE", w: 0.5, cov: "man", a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, OLB2: man(4), ILB1: man(3), ILB2: man(2), CB1: man(0), CB2: man(1), S1: z("robber"), S2: z("deepMid") }, a43: { ILB2: rush, OLB1: man(2), OLB2: man(4) } },
  { id: "c4", name: "COVER 4", formation: "NICKEL", cov: "zone", a: { DE1: rush, NT: rush, DE2: rush, OLB2: rush, OLB1: z("flatL"), ILB1: z("hookM"), ILB2: z("flatR"), CB1: z("quarterLL"), CB2: z("quarterRR"), S1: z("quarterL"), S2: z("quarterR") }, a43: { ILB2: rush, OLB2: z("flatR") } },
  { id: "zblitz", name: "ZONE BLITZ", formation: "NICKEL", cov: "zone", blitz: true, a: { DE1: z("flatL"), NT: rush, DE2: rush, OLB1: rush, ILB1: rush, ILB2: z("hookR"), OLB2: rush, CB1: z("deep3L"), CB2: z("deep3R"), S1: z("hookL"), S2: z("deepMid") }, a43: { ILB2: rush, OLB2: z("hookR") }, pos43: { OLB1: [1.3, -5.6] } }, // S1 drops to his own hook, S2 to the deep middle
  { id: "c1", name: "COVER 1", formation: "NICKEL", cov: "man", a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, OLB2: rush, ILB1: man(3), ILB2: man(2), CB1: man(0), CB2: man(1), S1: z("deepMid"), S2: man(4) }, a43: { ILB2: rush, OLB2: man(2) } },
  { id: "c0n", name: "COVER 0 BLITZ", formation: "NICKEL", w: 0.6, cov: "man", blitz: true, a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, OLB2: rush, ILB1: rush, ILB2: man(2), CB1: man(0), CB2: man(1), S1: man(3), S2: man(4) }, a43: { ILB2: rush, OLB2: man(2) }, pos43: { OLB1: [1.3, -5.6] } },
  { id: "c6", name: "COVER 6", formation: "NICKEL", cov: "zone", a: { DE1: rush, NT: rush, DE2: rush, OLB2: rush, OLB1: z("hookL"), ILB1: z("hookM"), ILB2: z("curlR"), CB1: z("quarterLL"), S1: z("quarterL"), CB2: z("flatR"), S2: z("deepHalfR") }, a43: { ILB2: rush, OLB2: z("curlR") } }, // quarters to the left, cover 2 to the right
  { id: "creeper", name: "SIM PRESSURE", formation: "NICKEL", w: 0.65, cov: "zone", sim: true, a: { DE1: z("flatL"), NT: rush, DE2: rush, OLB1: rush, ILB1: rush, ILB2: z("hookR"), OLB2: z("flatR"), CB1: z("deep3L"), CB2: z("deep3R"), S1: z("hookL"), S2: z("deepMid") }, a43: { ILB2: rush, OLB1: z("hookR") } }, // four come, a linebacker among them, an end drops: cover 3 behind
  { id: "c2man", name: "COVER 2 MAN", formation: "DIME", cov: "man", a: { DE1: rush, NT: rush, DE2: rush, OLB2: rush, OLB1: man(2), ILB1: man(3), ILB2: man(4), CB1: man(0), CB2: man(1), S1: z("deepHalfL"), S2: z("deepHalfR") }, a43: { ILB2: rush, OLB2: man(4) } },
  { id: "prevent", name: "PREVENT", formation: "DIME", cov: "zone", a: { DE1: rush, NT: rush, DE2: rush, OLB2: z("hookR"), OLB1: z("hookL"), ILB1: z("hookM"), ILB2: z("curlR"), CB1: z("deepPrevL"), CB2: z("deepPrevR"), S1: z("deepPrevM"), S2: z("deep3L") }, a43: { ILB2: rush, OLB2: z("curlR") } },
  { id: "c3d", name: "COVER 3", formation: "DIME", cov: "zone", a: { DE1: rush, NT: rush, DE2: rush, OLB2: rush, OLB1: z("flatL"), ILB1: z("hookM"), ILB2: z("flatR"), CB1: z("deep3L"), CB2: z("deep3R"), S1: z("deepMid"), S2: z("hookR") }, a43: { ILB2: rush, OLB2: z("flatR") } },
  { id: "dimeblitz", name: "DIME BLITZ", formation: "DIME", cov: "man", blitz: true, a: { DE1: rush, NT: rush, DE2: rush, OLB2: rush, OLB1: rush, ILB1: man(3), ILB2: man(4), CB1: man(0), CB2: man(1), S1: man(2), S2: z("deepMid") }, a43: { ILB2: rush, OLB2: man(4) } },
  { id: "c4d", name: "COVER 4", formation: "DIME", cov: "zone", a: { DE1: rush, NT: rush, DE2: rush, OLB2: rush, OLB1: z("hookL"), ILB1: z("hookM"), ILB2: z("hookR"), CB1: z("quarterLL"), CB2: z("quarterRR"), S1: z("quarterL"), S2: z("quarterR") }, a43: { ILB2: rush, OLB2: z("hookR") } },
  { id: "dsim", name: "DIME SIM", formation: "DIME", w: 0.8, cov: "zone", sim: true, a: { DE1: z("hookL"), NT: rush, DE2: z("hookR"), OLB2: rush, OLB1: rush, ILB1: rush, ILB2: z("flatR"), CB1: z("deep3L"), CB2: z("deep3R"), S1: z("flatL"), S2: z("deepMid") }, a43: { ILB2: rush, OLB2: z("flatR") } }, // both ends drop, two from the dime come: cover 3
  { id: "plug", name: "PLUG", formation: "GOALLINE", cov: "man", run: true, a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, OLB2: rush, ILB1: rush, ILB2: rush, CB1: man(0), CB2: man(1), S1: man(2), S2: spy } },
  { id: "c0", name: "COVER 0 BLITZ", formation: "GOALLINE", cov: "man", blitz: true, a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, OLB2: rush, ILB2: rush, ILB1: man(3), CB1: man(0), CB2: man(1), S1: man(2), S2: man(4) } },
  { id: "glzone", name: "FLAT ZONE", formation: "GOALLINE", cov: "zone", a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, OLB2: z("gl_flatR"), ILB1: z("gl_mid"), ILB2: rush, CB1: z("gl_flatL"), CB2: man(1), S1: z("hookL"), S2: z("hookR") } },
  { id: "bear", name: "BEAR", formation: "BEAR", w: 0.8, cov: "man", run: true, a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, OLB2: rush, ILB1: man(3), ILB2: man(4), S1: man(2), CB1: man(0), CB2: man(1), S2: z("deepMid") }, a43: { ILB2: rush, OLB2: man(4) } },
  { id: "bearblitz", name: "BEAR BLITZ", formation: "BEAR", w: 0.25, cov: "man", blitz: true, run: true, a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, OLB2: rush, ILB1: rush, ILB2: rush, S1: man(2), S2: man(3), CB1: man(0), CB2: man(1) } }, // seven come, nobody deep
  { id: "sblitz", name: "SAFETY BLITZ", formation: "BEAR", w: 0.5, cov: "man", blitz: true, run: true, a: { DE1: rush, NT: rush, DE2: rush, OLB1: rush, S1: rush, OLB2: man(4), ILB1: man(3), ILB2: man(2), CB1: man(0), CB2: man(1), S2: z("deepMid") }, a43: { ILB2: rush, OLB1: man(2) } }, // the strong safety, down in the box, comes too
];
export const DEF_FORMATION_ORDER = ["BASE", "NICKEL", "DIME", "BEAR", "GOALLINE"];
// Defensive audibles (world.js defAudible; F3, 2026-10-29): the human defense's quick changes at the line, each one
// key, button or tap from its menu (ui-playcall.js showDefAudible), then back to the call it made. BLITZ: its front's
// own blitz (by: the called front → a call; the bear's and the goal line's their own); PREVENT: the dime's deep zones;
// MAN PRESS: cover 1 with the corners pressed on the outside receivers (press: world.js alignDefense, the jam at the snap:
// ai.snapSetup); STACK THE BOX: the bear front, eight in the box
export const DEF_AUDIBLES = [
  { id: "blitz", name: "BLITZ", sub: "SEND PRESSURE", by: { BASE: "manblitz", NICKEL: "c0n", DIME: "dimeblitz", BEAR: "bearblitz", GOALLINE: "c0" } },
  { id: "prevent", name: "PREVENT", sub: "DEEP ZONES", play: "prevent" },
  { id: "press", name: "MAN PRESS", sub: "JAM AND COVER", play: "c1", press: true },
  { id: "stack", name: "STACK THE BOX", sub: "EIGHT IN THE BOX", play: "bear" },
];
// an audible's call against the one made (called: the play as drawn) → a DEF_PLAYS entry
export function defAudiblePlay(a, called) {
  const id = a.by ? a.by[called && called.formation] || a.by.BASE : a.play;
  return DEF_PLAYS.find((p) => p.id === id) || null;
}

// A front by the defense's scheme: a 4-3's own base and bear always, its nickel, dime and goal line with FRONTS43
const OWN43 = new Set(["BASE", "BEAR"]);
export function defFormation(name, scheme) {
  const f43 = scheme && scheme.def === "43";
  if (name === "BASE") return f43 ? DEF_FORM.BASE43 : DEF_FORM.BASE34;
  return (f43 && (OWN43.has(name) || PASS_RUSH.FRONTS43) && DEF_FORM[name + "43"]) || DEF_FORM[name];
}
export function defAssignments(play, scheme) {
  return scheme && scheme.def === "43" && play.a43 && (OWN43.has(play.formation) || PASS_RUSH.FRONTS43) ? { ...play.a, ...play.a43 } : play.a;
}
export const offPlay = (id) => OFF_PLAYS.find((p) => p.id === id);
export const defPlay = (id) => DEF_PLAYS.find((p) => p.id === id);

// ---------- FLIP ----------
// A FLIPped call runs the play mirrored left ↔ right (every dy → −dy): the formation or the front (offPos / defPos), the
// run path and its hole, the lead blocks' aiming points, the bootleg's side, every route's outside for a man lined up
// on the ball (side), the zones (their mirror landmarks: flatL ↔ flatR …) and with them the blitz side. Each man keeps
// his own job from his mirrored spot (on a flipped POWER O the same left guard pulls, from the right side of the
// line); routes break by alignment, so they mirror with the formation, and the pass, the run and the play action follow.
// The name stays (no play names a side). Kicks, spikes and kneels don't flip. A defense lines up to the offense's
// formation: its calls are drawn against an offense with its strength (the tight end) on the right, so it mirrors with
// a flipped offense and its own FLIP mirrors it against the formation (world.js setupPlay).
// mirrorPlay(play) → its mirror image (flip: true, base: the play as drawn, the same id), made once per play and kept,
// so the cards redraw without allocating; the play itself for what can't flip. asCalled(play, flip) → the play as it
// runs; basePlay(play) → the play as drawn. parOf(w) → the play's mirror parity (−1 on a flipped offensive call):
// whatever has no side of its own — a tie (a back right on the ball's line, two cuts equally open), a random spray left
// or right — goes the mirrored way on a flipped play (the odds don't change), so a flipped play runs as the exact mirror
// image of the original (allpro/flip-test.js).
const negPt = ([dx, dy]) => [dx, 0 - dy]; // (0 − dy: a man on the ball's line stays at +0)
// every zone's mirror image: the zone at the same depth on the other side (flatL ↔ flatR, quarterLL ↔ quarterRR; the
// middle ones are their own); a zone without one gets its mirror landmark added (ZONES)
const ZONE_FLIP = {};
for (const k of Object.keys(ZONES)) {
  const [d, y] = ZONES[k];
  let m = y === 0 ? k : Object.keys(ZONES).find((j) => ZONES[j][0] === d && ZONES[j][1] === -y);
  if (!m) { m = `${k}~`; ZONES[m] = [d, 0 - y]; ZONE_FLIP[m] = k; }
  ZONE_FLIP[k] = m;
}
const mirrorAssign = (a, def) => {
  const o = {};
  for (const s in a) {
    const x = a[s];
    if (def) o[s] = x.kind === "zone" ? { ...x, zone: ZONE_FLIP[x.zone] || x.zone } : x;
    else o[s] = x.kind === "route" ? { ...x, side: 0 - (x.side || 1) } : x.aim ? { ...x, aim: negPt(x.aim) } : x;
  }
  return o;
};
const MIRRORS = new WeakMap();
export function mirrorPlay(play) {
  if (!play || play.flip || play.clock || !play.a) return play;
  let m = MIRRORS.get(play);
  if (m) return m;
  m = { ...play, flip: true, base: play };
  if (play.type) {
    m.a = mirrorAssign(play.a, false);
    if (play.run) m.run = play.run.map(negPt);
    if (play.hole) m.hole = negPt(play.hole);
    if (play.boot) m.boot = 0 - play.boot;
  } else {
    m.a = mirrorAssign(play.a, true);
    if (play.a43) m.a43 = mirrorAssign(play.a43, true);
  }
  MIRRORS.set(play, m);
  return m;
}
export const basePlay = (play) => (play && play.base) || play;
export const asCalled = (play, flip) => (flip ? mirrorPlay(basePlay(play)) : basePlay(play));
export const parOf = (w) => (w.call && w.call.off && w.call.off.flip ? -1 : 1);
const POS_FLIP = new WeakMap(); // a formation's spots → their mirror image
function mirrorPos(pos) {
  let m = POS_FLIP.get(pos);
  if (!m) { m = {}; for (const s in pos) m[s] = negPt(pos[s]); POS_FLIP.set(pos, m); }
  return m;
}
// where a call lines up, by slot: the offense's formation, the defense's front (by the defense's scheme)
export const offPos = (play) => { const base = FORMATIONS[play.formation].pos, pos = play.pos ? posWith(base, play.pos) : base; return play.flip ? mirrorPos(pos) : pos; };
// (a call's own spots — pos — over its formation's or its front's; kept per pair, so a FLIPped call's mirror is made
// once)
const WITH = new WeakMap();
function posWith(base, own) {
  let m = WITH.get(own);
  if (!m) WITH.set(own, (m = new Map()));
  let r = m.get(base);
  if (!r) m.set(base, (r = { ...base, ...own }));
  return r;
}
// (a call's own alignment: pos, and a 4-3's pos43 where it has one — its linebackers walking up to the edge to blitz)
export const defPos = (play, scheme) => {
  const own = play.pos43 && scheme && scheme.def === "43" && (OWN43.has(play.formation) || PASS_RUSH.FRONTS43) ? play.pos43 : play.pos;
  const base = defFormation(play.formation, scheme).pos, pos = own ? posWith(base, own) : base;
  return play.flip ? mirrorPos(pos) : pos;
};
export const playsIn = (formation, side) => (side === "O" ? OFF_PLAYS : DEF_PLAYS).filter((p) => p.formation === formation);
export const ELIGIBLE = ["WR1", "WR2", "TE", "FB", "HB"];
export const HOT_ROUTES = ["go", "slant", "out", "curl", "block"];
export function hotRoute(name) {
  return name === "block" ? { kind: "block", block: "pass" } : { kind: "route", ...R[name], name };
}
export const ROUTE_LIB = R;

// ---------- Pixel diagrams (drawn on a small canvas, scaled up by CSS with pixelated rendering) ----------
function line(g, x0, y0, x1, y1, col) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  g.fillStyle = col;
  for (let i = 0; i < 400; i++) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
// Offense diagram: up = downfield. W×H canvas; t in [0,1] animates the routes being drawn.
export function drawOffDiagram(cv, play, t = 1, colors = {}) {
  const g = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const sc = W / 40; // 40 yards wide view
  const losY = Math.round(H * 0.72);
  const toPx = (dx, dy) => [Math.round(W / 2 + dy * sc), Math.round(losY - dx * sc)];
  g.fillStyle = colors.bg || "#0f3d22"; g.fillRect(0, 0, W, H);
  g.fillStyle = colors.stripe || "#12472a";
  for (let y = losY % 8; y < H; y += 16) g.fillRect(0, y, W, 8);
  g.fillStyle = "#3d7dff"; g.fillRect(0, losY, W, 1);
  const pos = offPos(play), fs = play.flip ? -1 : 1; // (a FLIPped play draws mirrored)
  const runCol = colors.run || "#ffd23e", routeCol = colors.route || "#f4f4ec", blockCol = colors.block || "#ff7a5a", hiCol = colors.hi || "#5ef0ff";
  for (const slot in pos) {
    const [dx, dy] = pos[slot];
    const as = play.a[slot] || {};
    const [px, py] = toPx(dx, dy);
    if (as.kind === "route") {
      const out = dy > 0.5 ? 1 : dy < -0.5 ? -1 : (as.side || 1);
      let [lx, ly] = [px, py];
      const pts = as.pts;
      const total = pts.length;
      const upto = t * total;
      for (let i = 0; i < total; i++) {
        if (i > upto) break;
        let [ax, ay] = toPx(dx + pts[i][0], dy + pts[i][1] * out);
        const frac = Math.min(1, upto - i);
        ax = lx + (ax - lx) * frac; ay = ly + (ay - ly) * frac;
        ay = Math.max(1, ay);
        line(g, lx, ly, ax, ay, (play.prog && play.prog[0] === slot) ? hiCol : routeCol);
        lx = ax; ly = ay;
      }
      g.fillStyle = (play.prog && play.prog[0] === slot) ? hiCol : routeCol;
      g.fillRect(Math.round(lx) - 1, Math.round(ly) - 1, 3, 3);
    } else if (as.kind === "block") {
      const ty = py - 3;
      line(g, px, py, px, ty, blockCol);
      line(g, px - 2, ty, px + 2, ty, blockCol);
      if (as.block === "screen") {
        // screen release: a short lane toward the screen side, in front of the back
        const hb = pos.HB || [0, 1];
        const sd = hb[1] > 0 || (hb[1] === 0 && fs > 0) ? 1 : -1;
        const k = Math.min(1, t * 1.5);
        const [ex, ey] = toPx(dx + 2.2, dy + sd * 4.5);
        line(g, px, ty, px + (ex - px) * k, ty + (ey - ty) * k, blockCol);
      }
    } else if (as.kind === "flea") {
      // flea flicker: the back runs at the line, then pitches it back to the QB
      const [ax, ay] = toPx(-1.6, dy - 0.8 * fs);
      const k = Math.min(1, t * 2);
      line(g, px, py, px + (ax - px) * k, py + (ay - py) * k, runCol);
      if (t > 0.5) {
        const [qx, qy] = toPx(pos.QB[0] - 4.5, pos.QB[1] + 2.2 * fs);
        const k2 = Math.min(1, (t - 0.5) * 2);
        for (let i = 0; i <= 8; i += 2) { const a = i / 8, b2 = Math.min(1, (i + 1) / 8); if (a > k2) break; line(g, ax + (qx - ax) * a, ay + (qy - ay) * a, ax + (qx - ax) * Math.min(b2, k2), ay + (qy - ay) * Math.min(b2, k2), hiCol); }
      }
    }
  }
  if (play.type === "run" && play.run) {
    const c = play.carrier || "HB";
    let [lx, ly] = toPx(...pos[c]);
    const pts = play.run;
    const upto = t * pts.length;
    for (let i = 0; i < pts.length; i++) {
      if (i > upto) break;
      let [ax, ay] = toPx(pts[i][0], pts[i][1]);
      const frac = Math.min(1, upto - i);
      ax = lx + (ax - lx) * frac; ay = ly + (ay - ly) * frac;
      line(g, lx, ly, ax, ay, runCol);
      lx = ax; ly = ay;
    }
    g.fillStyle = runCol;
    g.fillRect(Math.round(lx) - 2, Math.round(ly) - 1, 5, 1);
    g.fillRect(Math.round(lx) - 1, Math.round(ly) - 2, 3, 1);
    g.fillRect(Math.round(lx), Math.round(ly) - 3, 1, 1);
  }
  for (const slot in pos) {
    const [px, py] = toPx(...pos[slot]);
    g.fillStyle = "#0b0d1a"; g.fillRect(px - 2, py - 2, 5, 5);
    g.fillStyle = slot === "QB" ? "#ffd23e" : ELIGIBLE.includes(slot) ? "#f4f4ec" : "#9aa3c0";
    g.fillRect(px - 1, py - 1, 3, 3);
  }
}
export function drawDefDiagram(cv, play, scheme, t = 1) {
  const g = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const sc = W / 40;
  const losY = Math.round(H * 0.82);
  const toPx = (dx, dy) => [Math.round(W / 2 + dy * sc), Math.round(losY - dx * sc)];
  g.fillStyle = "#2a0f1a"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#33121f";
  for (let y = losY % 8; y < H; y += 16) g.fillRect(0, y, W, 8);
  g.fillStyle = "#3d7dff"; g.fillRect(0, losY, W, 1);
  const pos = defPos(play, scheme); // (a FLIPped call draws mirrored)
  const a = defAssignments(play, scheme);
  for (const slot in pos) {
    const [dx, dy] = pos[slot];
    const as = a[slot] || {};
    const [px, py] = toPx(dx, dy);
    if (as.kind === "zone") {
      const [zx, zy] = ZONES[as.zone];
      const [qx, qy] = toPx(zx, zy);
      const k = Math.min(1, t * 1.4);
      line(g, px, py, px + (qx - px) * k, Math.max(1, py + (qy - py) * k), "#9aa3c0");
      const deep = zx >= 14;
      g.fillStyle = deep ? "#3b7dff" : zx >= 7 ? "#ffd23e" : "#57e36a";
      const rx = Math.round(qx), ry = Math.max(2, Math.round(qy));
      g.fillRect(rx - 4, ry - 2, 9, 5);
    } else if (as.kind === "rush") {
      const k = Math.min(1, t * 1.4);
      line(g, px, py, px, py + 7 * k, "#ff5a4a");
      g.fillStyle = "#ff5a4a"; g.fillRect(px - 1, py + Math.round(7 * k), 3, 1);
    } else if (as.kind === "man") {
      line(g, px, py, px, py - 4, "#ff9b2e");
    }
  }
  for (const slot in pos) {
    const [px, py] = toPx(...pos[slot]);
    g.fillStyle = "#0b0d1a"; g.fillRect(px - 2, py - 2, 5, 5);
    g.fillStyle = "#ff8a8a";
    g.fillRect(px - 2, py - 2, 1, 1); g.fillRect(px + 2, py - 2, 1, 1); g.fillRect(px, py, 1, 1);
    g.fillRect(px - 2, py + 2, 1, 1); g.fillRect(px + 2, py + 2, 1, 1); g.fillRect(px - 1, py - 1, 1, 1);
    g.fillRect(px + 1, py - 1, 1, 1); g.fillRect(px - 1, py + 1, 1, 1); g.fillRect(px + 1, py + 1, 1, 1);
  }
}
