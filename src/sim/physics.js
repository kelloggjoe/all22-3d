// Movement, separation, blocking engagements, tackling, catching and 3D ball flight.
// Pure simulation (no DOM); everything random comes from w.rng.
// Field goals (graft of build A's model): the ball leaves the holder at a fixed launch angle; the meter's accuracy
// error hooks/slices it (angle = acc·0.42 + aim·0.04 + crosswind), power sets the speed (range). It is good if it
// crosses the end line (x = 110, where the uprights stand) inside the uprights and over the crossbar; within a
// few inches of an upright it doinks. Blocked kicks: a free rusher at the kick point (or under the ball's first
// yards of flight) gets a hand on it; the ball is live — the kicking team can fall on it, the rush can scoop & score.
import { PHYS, FIELD_W, MID_Y, KICKING, HOME_FIELD } from "./config.js";

import { HARD } from "./config.js"; // PRO to LEGEND (difficulty.js): the CPU against a human
// FLIP: a random spray left or right (a fumble's bounce, a throw's miss, a tipped ball, a block's jostle) and a tie
// go the mirrored way on a FLIPped play (the odds don't change), so it runs as the mirror image (playbook.js parOf)
import { parOf } from "./playbook.js";
import { PASS_RUSH, RUN_BLOCK } from "./config.js";
import { hurried, engaged, pancaked, tried, recovered } from "./playerstats.js";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
export const arm01 = (p) => clamp((p.r.arm - 40) / 90, 0, 1);
// kicker leg 0.55..1.15 (1 ≈ a strong NFL leg)
export const kickQuality = (k) => clamp(((k && k.r.kick) || 60) / 90, 0.55, 1.15);
const fgSpeed = (k, power) => KICKING.FG_V0 + KICKING.FG_VP * power * (0.7 + 0.3 * kickQuality(k));
// meter power this kicker needs to clear the crossbar from dist yards (> 1 = out of range)
export function fgPowerFor(k, dist) {
  const e = KICKING.FG_ELEV, g = PHYS.KICK_G, c = Math.cos(e);
  const rise = dist * Math.tan(e) - (KICKING.BAR + 0.25 - 0.3);
  if (rise <= 0.2) return 0.05;
  const v = Math.sqrt((g * dist * dist) / (2 * c * c * rise));
  return (v - KICKING.FG_V0) / (KICKING.FG_VP * (0.7 + 0.3 * kickQuality(k)));
}
// standard normal CDF (Abramowitz–Stegun 7.1.26) — deterministic, no rng
function phi(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
// probability a CPU-quality kick from dist yards is good (the coach's and the CPU's FG chart)
export function fgMakeProb(k, dist, windAbs = 0) {
  const need = fgPowerFor(k, dist);
  if (need > 1.02) return 0;
  const sigma = KICKING.CPU_SIGMA * (1.2 - 0.32 * kickQuality(k)) * (1 + Math.max(0, dist - 40) * 0.008);
  const half = KICKING.UPRIGHT / Math.max(8, dist);
  const spread = Math.hypot(KICKING.ACC_ANG * sigma, windAbs * 0.3);
  let p = 2 * phi(half / spread) - 1;
  if (need > 0.9) p *= clamp((1.02 - need) / 0.12, 0, 1) * 0.5 + 0.5;
  return clamp(p, 0, 0.995);
}

// ---------- Movement ----------
export function movePlayers(w, dt) {
  const ps = w.players;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.stun > 0) p.stun -= dt;
    if (p.down > 0) { p.down -= dt; const f = p.fly > 0 ? 0.95 : 0.86; if (p.fly > 0) p.fly -= dt; p.vx *= f; p.vy *= f; p.x += p.vx * dt; p.y += p.vy * dt; if (p.down <= 0) p.lie = 0; continue; }
    if (p.moveCool > 0) p.moveCool -= dt;
    if (p.tackleCool > 0) p.tackleCool -= dt;
    if (p.engageCool > 0) p.engageCool -= dt;
    if (p.slow > 0) p.slow -= dt;
    if (p.flash > 0) p.flash -= dt;
    if (p.move) { p.moveT += dt; if (p.moveT > moveDur(p.move) && !(p.move === "dive" && p.z > 0)) endMove(w, p); } // (a dive: until he lands)
    // vertical (jumps, dives)
    if (p.z > 0 || p.vz) { p.vz -= PHYS.GRAVITY * dt; p.z += p.vz * dt; if (p.z <= 0) { p.z = 0; p.vz = 0; } }
    if (p.engaged) continue; // engaged pairs move in blocking()
    if (p.move === "dive" && p.z > 0) { p.x += p.vx * dt; p.y += p.vy * dt; continue; } // flying: momentum only
    const traitSpeed = p.trait && (p.trait.key === "quick-feet" || (p.trait.key === "return-ace" && w.playType !== "normal")) ? 1.05 : 1;
    const routeSpeed = p.trait && p.trait.key === "route-runner" && p.as && p.as.kind === "route" ? 1.05 : 1;
    const relentless = p.trait && p.trait.key === "relentless" && w.phaseT > 4 ? 1.04 : 1;
    const clutch = p.trait && p.trait.key === "clutch" && Math.abs(w.score.home - w.score.away) <= 8 && (w.ot || w.quarter >= w.regulationQuarters && w.clock <= 120) ? 1.04 : 1;
    // (traits.js) BREAKAWAY with the ball, CLOSER after a carrier, UNDERDOG while his team trails
    const tk = p.trait && p.trait.key;
    const lateTrait = tk === "breakaway" && p.hasBall ? 1.04 : tk === "closer" && p.side === "D" && w.ball.carrier ? 1.03
      : tk === "underdog" && w.score[p.teamKey] < w.score[p.teamKey === "home" ? "away" : "home"] ? 1.04 : 1;
    let chemSpeed = 1;
    if (w.chemistryFor && (p.hasBall || p.side === "D" && w.ball.carrier)) {
      let mate = null, dist = 5;
      for (const q of ps) if (q !== p && q.teamKey === p.teamKey && q.side === p.side) { const d = p.dist(q); if (d < dist) { dist = d; mate = q; } }
      if (mate) chemSpeed = w.chemistryFor(p, mate);
    }
    let top = p.r.speed * traitSpeed * routeSpeed * relentless * clutch * lateTrait * chemSpeed * (p.sprint ? PHYS.SPRINT_MULT : 1) * (p.slow > 0 ? 0.55 : 1);
    if (p.stun > 0) top *= 0.15;
    if (p.hasBall && p.slot === "QB" && !w.losCrossed && w.call && w.call.off && w.call.off.type === "pass") {
      top *= 0.92;
      // (retreating past a normal drop: slower the deeper he goes, PHYS.QB_DEEP_*)
      const deep = Number.isFinite(w.los) ? w.los - p.x - PHYS.QB_DEEP_FREE : 0;
      if (deep > 0) top *= Math.max(PHYS.QB_DEEP_FLOOR, 1 - PHYS.QB_DEEP_PER * deep);
    }
    const want = clamp(p.want, 0, 1.25);
    let m = Math.hypot(p.mx, p.my);
    let tx = 0, ty = 0;
    if (m > 0.001 && want > 0) { tx = (p.mx / m) * top * want; ty = (p.my / m) * top * want; }
    // special-move velocity overrides
    if (p.move === "juke") { tx += p.moveDX * 7; ty += p.moveDY * 7; }
    else if (p.move === "dive" || p.move === "hitstick") { const k = p.move === "dive" ? 1.25 : 1.4; tx = p.moveDX * top * k; ty = p.moveDY * top * k; }
    const acc = p.r.accel * (p.sprint ? 0.85 : 1) * (p.move === "juke" ? 2.4 : 1);
    let dvx = tx - p.vx, dvy = ty - p.vy;
    const dv = Math.hypot(dvx, dvy), maxDv = acc * dt * (dv > top ? 1.4 : 1);
    if (dv > maxDv) { dvx *= maxDv / dv; dvy *= maxDv / dv; }
    p.vx += dvx; p.vy += dvy;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const sp = p.vx * p.vx + p.vy * p.vy;
    // backpedals keep facing downfield / the offense (QB drop, DBs and LBs dropping into coverage)
    const pre = w.phase === "live" && w.playType === "normal" && !w.passThrown && !w.handedOff;
    const backpedal = pre && (p.side === "O" ? p.slot === "QB" && p.vx < 0.5 : p.vx > 0 && sp < 30 && p.as && (p.as.kind === "zone" || p.as.kind === "man"));
    if (backpedal) { p.faceX = p.side === "O" ? 1 : -1; p.faceY = 0; }
    else if (sp > 0.6) { const s = Math.sqrt(sp); p.faceX = p.vx / s; p.faceY = p.vy / s; }
  }
}
const MOVE_DUR = { juke: 0.32, spin: 0.34, stiff: 0.45, truck: 0.4, dive: 0.5, hitstick: 0.38, swat: 0.6, slide: 0.5 };
export const moveDur = (m) => MOVE_DUR[m] || 0.4;
function endMove(w, p) {
  const m = p.move;
  p.move = null; p.moveT = 0;
  if ((m === "dive" || m === "hitstick") && !p.hasBall && w.phase === "live") {
    // whiffed: on the ground for a moment
    p.down = m === "dive" ? 0.9 : 0.7; p.lie = 1;
  }
}

// Start a special move. dirX/dirY = direction (offense coords). Returns true when started.
export function startMove(w, p, move, dirX = 0, dirY = 0) {
  if (!p.canAct || p.move || p.moveCool > 0 || p.engaged) return false;
  p.move = move; p.moveT = 0;
  const m = Math.hypot(dirX, dirY) || 1;
  p.moveDX = dirX / m; p.moveDY = dirY / m;
  p.moveCool = move === "dive" || move === "hitstick" ? 0.6 : PHYS.MOVE_COOLDOWN;
  if (move === "swat") { p.vz = 4.6; p.z = 0.01; }
  if (move === "dive") {
    // a dive launches him on his own momentum: the faster he's going, the farther and higher he flies (a carrier's run
    // ends where he lands: world.js; a tackler who misses is on the ground where he lands: endMove)
    const sp = Math.hypot(p.vx, p.vy), along = Math.max(0, p.vx * p.moveDX + p.vy * p.moveDY);
    // (every dive is a real launch: even from a standstill he leaves his feet and flies forward, never just drops)
    if (!dirX && !dirY) { const f = Math.hypot(p.vx, p.vy) > 0.5 ? [p.vx, p.vy] : [p.faceX || 1, p.faceY || 0], k = Math.hypot(f[0], f[1]) || 1; p.moveDX = f[0] / k; p.moveDY = f[1] / k; }
    const out = Math.max(Math.max(along, sp * 0.6) * PHYS.DIVE.CARRY + PHYS.DIVE.PUSH, PHYS.DIVE.MIN_OUT);
    p.vx = p.moveDX * out; p.vy = p.moveDY * out;
    p.vz = Math.max((p.hasBall ? PHYS.DIVE.LIFT : PHYS.DIVE.LIFT_D) + sp * PHYS.DIVE.LIFT_K, PHYS.DIVE.MIN_LIFT); p.z = 0.01;
  }
  // a swat attempt is a "jump"; the "swat" event fires once per ball, when a pass is actually batted (resolveCatch)
  w.bus.emit(move === "stiff" ? "stiffArm" : move === "hitstick" ? "hitStick" : move === "swat" ? "jump" : move, { player: p });
  return true;
}

// ---------- Separation ----------
export function separate(w) {
  const ps = w.players;
  const n = ps.length;
  for (let i = 0; i < n; i++) {
    const a = ps[i];
    if (a.down > 0) continue;
    for (let j = i + 1; j < n; j++) {
      const b = ps[j];
      if (b.down > 0 || a.engaged === b) continue;
      // a busted protection: he slips through (a rusher through the line too, except past the man doubling him: PASS_RUSH.HELP)
      if ((a.ai.free || b.ai.free) && a.side !== b.side && !w.kicked && a.ai.help !== b && b.ai.help !== a) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const rr = a.radius + b.radius;
      if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), push = (rr - d) * 0.5;
      const ma = Math.log(4 + a.r.kg), mb = Math.log(4 + b.r.kg);
      let ka = mb / (ma + mb), kb = ma / (ma + mb);
      // a beaten tackler (stunned) gives way to the carrier: the runner slides past him, never held up by him
      if (a.side !== b.side && (a.hasBall || b.hasBall)) {
        const run = a.hasBall ? a : b, other = a.hasBall ? b : a;
        if (other.stun > 0) { if (run === a) { ka = 0; kb = 1; } else { ka = 1; kb = 0; } }
      }
      const nx = dx / d, ny = dy / d;
      if (!a.engaged) { a.x -= nx * push * ka * 2; a.y -= ny * push * ka * 2; }
      if (!b.engaged) { b.x += nx * push * kb * 2; b.y += ny * push * kb * 2; }
    }
  }
}

// How well a defender plays a scrambling QB (ai.readScramble), 0..1: his coach's skill (data.js aiFor: ≈0.1 the first
// gym … ≈0.96 the Champion), and for the CPU's side the difficulty too (as tackleMult: ROOKIE lower, CHAMPION and MASTER higher)
export function scrambleIQ(w, p) {
  const ai = p.team && p.team.ai;
  const sk = ai && Number.isFinite(ai.skill) ? ai.skill : 0.5;
  return clamp(sk + (p.teamKey === w.user ? 0 : w.difficulty === 1 ? -0.15 : w.difficulty >= 3 ? 0.15 : 0), 0, 1);
}

// ---------- Blocking ----------
// A blocker with a block target engages on contact. Engaged pairs drift by the power contest; the defender sheds after a
// randomized time (stronger rushers shed sooner). Big mismatches pancake.
export function tryEngage(w, blocker, def) {
  // (the man doubling a rusher picks him up the moment he comes off his first block: PASS_RUSH.HELP)
  const dbl = blocker.ai.help === def && !w.kicked;
  if (blocker.engaged || def.engaged || (def.engageCool > 0 && !dbl) || def.down > 0 || blocker.down > 0 || def.hasBall) return false;
  if (def.ai.free && !w.kicked && !dbl) return false; // a busted protection: this rusher came clean
  // contact distance grows with body size (separate() keeps two big linemen ~1.2 yd apart, center to center)
  const reach = Math.max(PHYS.ENGAGE_DIST, blocker.radius + def.radius + 0.12) + blocker.radius * 0.2;
  if (blocker.distTo(def.x, def.y) > reach) return false;
  blocker.engaged = def; def.engaged = blocker;
  blocker.blocking = true; def.blocking = false;
  blocker.blockT = 0; def.blockT = 0;
  const run = w.call && w.call.off && w.call.off.type === "run";
  const pr = def.r.power * 0.6 + def.r.agility * 0.4, an = blocker.r.anchor * 0.6 + blocker.r.power * 0.4;
  const ratio = clamp(an / Math.max(20, pr), 0.5, 1.8);
  const [lo, hi] = run ? PHYS.RUN_SHED_MEAN : PHYS.SHED_MEAN;
  const mean = lerp(lo, hi, clamp((ratio - 0.6) / 1.0, 0, 1));
  def.shedAt = mean * (0.45 + w.rng.next() * 1.1);
  // backside cut-off blocks on runs don't hold for long: that's where the backside pursuit comes from
  if (run && w.runSide && (def.y - w.ballY) * w.runSide < -1.5) def.shedAt *= PHYS.BACKSIDE_SHED;
  if (run && w.call.off.surge) def.shedAt *= 1.6;
  if (blocker.slot === "WR1" || blocker.slot === "WR2") def.shedAt *= PHYS.STALK_SHED; // receivers' stalk blocks
  // a pass rusher wins some reps outright (a quick swim / rip): the sacks and the hurried throws come from these; a man
  // beaten that way stays beaten a beat (blocking: PASS_RUSH.BEAT), and the rusher is through the line for a moment —
  // the longer, the more he outclasses his man (BEAT[2] for an even match) — unless the protection doubles him: there's
  // still the second blocker (PASS_RUSH.HELP). A double team that has caught him holds him: no quick win off it.
  def.ai.beat = false; def.ai.slip = 0;
  if (dbl) def.shedAt = Math.max(def.shedAt, mean);
  else if (!run && def.side === "D" && (w.playType === "normal" || w.playType === "two") && w.rng.chance(clamp(PHYS.QUICK_WIN + (1 / ratio - 1) * 0.12, 0.03, 0.34))) {
    def.shedAt = 0.45 + w.rng.next() * 0.75; def.ai.beat = true;
    if (PASS_RUSH.BEAT[2] > 0 && !(PASS_RUSH.HELP && w.off.some((b) => b.ai.help === def))) def.ai.slip = PASS_RUSH.BEAT[2] * clamp(1 / ratio, 0.5, 1.6);
  }
  else if (!run && def.side === "D" && w.rng.chance(0.07)) def.shedAt = 0.45 + w.rng.next() * 0.75; // a kick rush
  if (w.crowd && def.teamKey === "home") def.shedAt *= 1 - HOME_FIELD.RUSH * w.crowd; // the visitors' line hears the snap count late
  blocker.shedAt = def.shedAt;
  w.bus.emit("block", { blocker, defender: def });
  if (w.statsBy) engaged(w, blocker, def); // (the blockers' lines: playerstats.js)
  // pancake: huge mismatch, small chance
  if (ratio > 1.35 && w.rng.chance(0.05 + (ratio - 1.35) * 0.25)) {
    release(blocker, def);
    { const dx = def.x - blocker.x, dy = def.y - blocker.y, m = Math.hypot(dx, dy) || 1, k = PHYS.PANCAKE_PUSH * Math.sqrt(blocker.r.kg / def.r.kg); def.down = 1.3; def.lie = 1; def.vx = (dx / m) * k; def.vy = (dy / m) * k; def.fly = 0.4; }
    w.bus.emit("pancake", { blocker, defender: def });
    if (w.statsBy) pancaked(w, blocker);
  }
  return true;
}
export function release(a, b) {
  if (a) { a.engaged = null; a.engageCool = 0.5; a.blocking = false; }
  if (b) { b.engaged = null; b.engageCool = 0.7; b.blocking = false; }
}
export function blocking(w, dt) {
  const ps = w.players;
  for (let i = 0; i < ps.length; i++) {
    const bl = ps[i];
    const d = bl.engaged;
    if (!d || !bl.blocking) continue; // each pair once, from the blocker's side
    bl.blockT += dt; d.blockT += dt;
    if (bl.down > 0 || d.down > 0 || bl.stun > 0) { release(bl, d); continue; }
    // run defense: a defender reads the back and comes off the block to make the play when he runs at him
    const run = w.call && w.call.off && w.call.off.type === "run";
    const c = w.ball.carrier;
    // a double team (the run's combo, config.js RUN_BLOCK): a second blocker with a shoulder on him, not blocking anyone
    // else: he gives ground and stays on the block longer
    const h = run && d.side === "D" ? d.ai.helper : null;
    const dbl = Boolean(h && h.ai.helping === d && !h.engaged && h.down <= 0 && h.distTo(d.x, d.y) < 1.7);
    if (dbl) d.blockT -= dt * RUN_BLOCK.HOLD;
    if (run && c && c.side !== d.side && d.side === "D" && w.handedOff) {
      const dc = Math.hypot(c.x - d.x, c.y - d.y);
      // leverage: a blocker sitting between his man and the ball holds him; one who lost the angle doesn't
      const bx = bl.x - d.x, by = bl.y - d.y, bm = Math.hypot(bx, by) || 1;
      const lev = ((c.x - d.x) * bx + (c.y - d.y) * by) / ((dc || 1) * bm);
      const levK = lev > 0.35 ? 0.35 : lev < -0.2 ? 1.6 : 1;
      const H = hardTackle(w, d, c); // (PRO to LEGEND: the CPU's man comes off a block to make the play sooner)
      if (dc < PHYS.SHED_REACT_DIST && w.rng.chance(dt * PHYS.SHED_REACT * levK * (w.call.off.surge ? 0.35 : 1) * (dbl ? RUN_BLOCK.REACT : 1) * clamp((d.r.power * 0.6 + d.r.agility * 0.4) / Math.max(30, bl.r.anchor * 0.7 + bl.r.power * 0.3), 0.5, 1.6) * (H ? HARD.SHED[H - 1] : 1))) d.blockT = d.shedAt;
    }
    // a scrambling QB (ai.readScramble): a pass set is built for the pocket. Once he's left it, the rusher comes off to
    // chase — at once when his blocker no longer sits between him and the QB, seldom while he still walls him off; a
    // cover man who got caught up in the protection (following a back in) just slips off it
    const scr = w.scr;
    if (!run && scr && scr.level >= 1 && scr.play === w.playNo && c && c === w.qb && d.side === "D" && !w.passThrown && (w.playType === "normal" || w.playType === "two")) {
      const dc = Math.hypot(c.x - d.x, c.y - d.y) || 1;
      const bx = bl.x - d.x, by = bl.y - d.y, bm = Math.hypot(bx, by) || 1;
      const lev = ((c.x - d.x) * bx + (c.y - d.y) * by) / (dc * bm);
      const levK = d.as && d.as.kind !== "rush" ? 4 : lev > 0.6 ? 0.15 : lev < 0.1 ? 1.5 : 0.8;
      if (w.rng.chance(dt * PHYS.SCRAMBLE_SHED * levK * (0.7 + 0.6 * scrambleIQ(w, d)) * clamp((d.r.power * 0.6 + d.r.agility * 0.4) / Math.max(30, bl.r.anchor * 0.7 + bl.r.power * 0.3), 0.5, 1.6))) d.blockT = d.shedAt;
    }
    if (d.blockT >= d.shedAt) {
      release(bl, d);
      // shed: rusher bursts past, blocker stumbles a touch (beaten off the snap: PASS_RUSH.BEAT — and he's through the
      // line for a moment: he slips past the bodies in his way, nobody can pick him up)
      const beat = d.ai.beat && w.call && w.call.off && w.call.off.type === "pass";
      bl.stun = beat ? PASS_RUSH.BEAT[1] : 0.18; d.engageCool = beat ? PASS_RUSH.BEAT[0] : 1.0;
      if (beat && d.ai.slip > 0) { d.ai.free = true; d.ai.freeUntil = w.t + d.ai.slip; }
      w.bus.emit("shed", { blocker: bl, defender: d });
      continue;
    }
    // power contest: the pair drifts along the defender's desired direction (resisted) or the blocker's drive
    const dTrait = d.trait && (d.trait.key === "edge-rusher" && !run || d.trait.key === "run-stopper" && run) ? 1.07 : 1;
    const bTrait = bl.trait && (bl.trait.key === "road-grader" && run || bl.trait.key === "pocket-shield" && !run) ? 1.07 : 1;
    const dPow = d.r.power * dTrait, bPow = bl.r.power * bTrait * (run ? 1.05 : 0.95), bAnc = bl.r.anchor * (bl.trait && bl.trait.key === "anchor" ? 1.08 : 1);
    let mx = d.mx, my = d.my;
    const m = Math.hypot(mx, my) || 1;
    mx /= m; my /= m;
    let push = clamp((dPow - bAnc * 0.85) / 80, -0.5, 0.8) - (dbl ? RUN_BLOCK.PUSH : 0); // + = rusher winning
    // (a 3-4's down linemen two-gap the run: they hold their ground against a block, the double team too — RUN_BLOCK)
    if (run && d.side === "D" && RUN_BLOCK.TWO_GAP && (d.slot === "DE1" || d.slot === "NT" || d.slot === "DE2") && w.teams[d.teamKey].scheme.def !== "43") push += RUN_BLOCK.TWO_GAP;
    // a kick-block rush is an all-out bull rush at a unit that only holds its gaps: it gains ground
    if (!w.kicked && d.side === "D" && (d.ai.fgRush || d.ai.puntRush) && (w.playType === "fg" || w.playType === "pat" || w.playType === "punt")) push += PHYS.KICK_RUSH_PUSH;
    const surge = run && w.call.off.surge;
    const drive = run ? clamp((bPow - d.r.anchor * 0.8) / 70 + (surge ? 0.35 : 0) + (dbl ? RUN_BLOCK.DRIVE : 0), 0, surge ? 1.2 : 0.9 + (dbl ? RUN_BLOCK.DRIVE : 0)) : 0;
    const dir = bl.side === "O" ? 1 : -1; // blockers drive toward the opponent's goal
    const dk = run ? 0.7 : 1; // on runs the defender fights to get off the block toward the ball
    const give = run ? RUN_BLOCK.GIVE : 0.6; // (how much ground a block gives to an even match: the run's own, RUN_BLOCK)
    let vx = mx * (give + push) * 1.6 * dk + dir * drive * 1.4;
    let vy = my * (give + push) * 1.6 * dk;
    if (run && w.runHoleY != null) vy += Math.sign(d.y - w.runHoleY || parOf(w)) * (0.5 + drive) * PHYS.RUN_SEAL; // seal away from the hole
    // blocker slides to stay in front (mirror)
    const jitter = (w.rng.next() - 0.5) * 0.4;
    vx += jitter; vy += jitter * parOf(w);
    bl.vx = vx; bl.vy = vy; d.vx = vx; d.vy = vy;
    bl.x += vx * dt; bl.y += vy * dt; d.x += vx * dt; d.y += vy * dt;
    // keep contact distance
    const dx = d.x - bl.x, dy = d.y - bl.y, dd = Math.hypot(dx, dy) || 1, want = bl.radius + d.radius - 0.05;
    const k = (dd - want) * 0.5;
    bl.x += (dx / dd) * k; bl.y += (dy / dd) * k; d.x -= (dx / dd) * k; d.y -= (dy / dd) * k;
  }
}

// ---------- Tackling ----------
export function tackles(w, dt) {
  const c = w.ball.carrier;
  if (!c || w.ball.state !== "held" || w.phase !== "live") return;
  const ps = w.players;
  for (let i = 0; i < ps.length; i++) {
    const d = ps[i];
    if (d.side === c.side || !d.canAct || d.tackleCool > 0) continue;
    if (w.ball.kind === "kickwait") continue;
    // a defender still locked up with a blocker can only reach out and grab a carrier going right past him
    const arm = Boolean(d.engaged);
    if (arm && (d.engaged === c || d.blocking)) continue;
    const touch = d.radius + c.radius + (arm ? PHYS.CONTACT.ARM : PHYS.CONTACT.REACH); // (never short of the bodies touching)
    const reach = Math.max(touch, (arm ? PHYS.ARM_TACKLE_DIST : PHYS.TACKLE_DIST) * (d.r.reach || 1) + c.radius * 0.3) + (d.move === "dive" ? 0.75 : d.move === "hitstick" ? 0.4 : 0);
    const dx = c.x - d.x, dy = c.y - d.y;
    if (dx * dx + dy * dy > reach * reach) continue;
    if (c.z > 1.2) continue; // hurdling/diving over
    if (w.godMode && c.teamKey === w.user && c === w.control) {
      d.tackleCool = PHYS.TACKLE_COOLDOWN;
      d.stun = 0.35;
      w.bus.emit("brokenTackle", { tackler: d, carrier: c, move: "god" });
      continue;
    }
    d.tackleCool = PHYS.TACKLE_COOLDOWN;
    const closing = Math.max(0, (d.vx * dx + d.vy * dy) / (Math.hypot(dx, dy) || 1));
    let p = PHYS.TACKLE_BASE + 0.0042 * (d.r.power - c.r.power) + 0.022 * closing + (d.r.fit - 0.5) * 0.12;
    if (arm) p *= PHYS.ARM_TACKLE_MULT;
    if (d.move === "dive") p += PHYS.DIVE_TACKLE_BONUS;
    const hit = d.move === "hitstick";
    if (hit) p += PHYS.HITSTICK_BONUS - (w.rng.chance(PHYS.HITSTICK_WHIFF) ? 0.5 : 0) + ((c.r.head || 1.15) - 1.15) * PHYS.HEAD_TARGET; // (a giant head: a hit-stick magnet)
    // carrier moves
    const H = hardTackle(w, d, c); // (PRO to LEGEND: the CPU's tackler doesn't bite as often on the human's moves)
    if (c.move === "juke") p -= PHYS.JUKE_EVADE * (0.7 + c.r.agility / 300) * (c.r.ghost ? 1.05 : 1) * (H ? HARD.JUKE[H - 1] : 1);
    else if (c.move === "spin") p -= PHYS.SPIN_EVADE * (0.7 + c.r.agility / 300) * (H ? HARD.JUKE[H - 1] : 1);
    else if (c.move === "stiff") p -= PHYS.STIFF_EVADE * clamp((c.r.power - d.r.power * 0.6) / 60 + 0.6, 0.3, 1.4);
    else if (c.move === "truck") p -= PHYS.TRUCK_EVADE * clamp((c.r.power - d.r.power * 0.7) / 50 + 0.5, 0.1, 1.5);
    if (c.slot === "QB" && !w.losCrossed && w.call.off && w.call.off.type === "pass" && !w.passThrown) p += PHYS.SACK_STICK; // a QB in the pocket gets wrapped up
    if (c.slow > 0) p += 0.1;
    // gang tackle: another defender already in contact
    const gang = w.lastTackleTry > w.t - 0.5;
    if (gang) p += 0.12;
    w.lastTackleTry = w.t;
    if (d.trait && d.trait.key === "sure-tackler") p *= 1.1;
    if (d.trait && d.trait.key === "enforcer") p *= 1.06;
    if (c.trait && (c.trait.key === "elusive" || c.trait.key === "power-runner")) p *= .93;
    if (c.trait && c.trait.key === "goal-line" && c.side === "O" && c.x >= 95) p *= .85;
    if (d.trait && d.trait.key === "gang-tackler" && gang) p *= 1.12;
    p = clamp(p * (d.teamKey === w.user ? 1 : w.tackleMult || 1), 0.12, 0.96); // difficulty: the CPU's tackling only
    w.bus.emit("tackleAttempt", { tackler: d, carrier: c });
    if (w.statsBy) tried(w, d, c);
    if (w.rng.chance(p)) {
      const power = Math.hypot(d.vx, d.vy) * Math.log(5 + d.r.kg) * (hit ? 1.7 : 1);
      const approach = {
        carrierVx: c.vx, carrierVy: c.vy, carrierVz: c.vz,
        tacklerVx: d.vx, tacklerVy: d.vy, tacklerVz: d.vz,
        hit, arm, dive: d.move === "dive",
      };
      if (w.squad) w.tackleHit(c, d, power, hit, gang); // franchise: injury rolls, the hit's toll on the legs
      // fumble?
      const fp = (PHYS.FUMBLE_BASE + (hit ? PHYS.HITSTICK_FUMBLE : 0)) * clamp(110 / (c.r.toughness + 40), 0.6, 1.6) * (w.fumbleMult || 1)
        * (d.trait && d.trait.key === "enforcer" ? 1.2 : 1) * (c.trait && c.trait.key === "sure-hands" ? .7 : 1)
        * (c.trait && c.trait.key === "secure" ? .5 : 1) * (d.trait && d.trait.key === "strip-artist" ? 1.35 : 1)
        * userFumbleMult(w, d, hit)
        + clamp((power - PHYS.POP.FROM) * PHYS.POP.K, 0, PHYS.POP.MAX); // (a big hit pops it loose: pinball)
      d.anim = "tackle"; d.animT = 0;
      if (d.move !== "dive") { d.down = 0.7; d.lie = 1; }
      c.down = 1.0; c.lie = 1; c.flash = 0.1;
      c.vx = c.vx * 0.5 + d.vx * 0.35; c.vy = c.vy * 0.5 + d.vy * 0.35;
      if (d.trait && (d.trait.key === "sure-tackler" || d.trait.key === "enforcer")) w.bus.emit("trait", { player: d, name: d.trait.name });
      if (hit) w.bus.emit("hitStick", { tackler: d, carrier: c, power, boom: true });
      if (c.move === "truck") w.bus.emit("truck", { player: c, defender: d, failed: true });
      if (w.ball.kind !== "kickwait" && w.rng.chance(fp) && !w.noFumbles) {
        fumble(w, c, d, power);
        w.bus.emit("tackle", { tackler: d, carrier: c, power, approach, fumble: true });
        return;
      }
      w.bus.emit("tackle", { tackler: d, carrier: c, power, approach });
      w.tackled(c, d);
      return;
    }
    // broken tackle
    d.stun = 0.55; d.flash = 0.08;
    if (c.move === "truck") {
      d.down = 1.2; d.lie = 1;
      // the momentum behind it flings him back (PHYS.TRUCK_FLING)
      const F = PHYS.TRUCK_FLING, sp = Math.hypot(c.vx, c.vy), push = clamp((sp - F.FROM) * F.K, 0, F.MAX) * clamp(Math.sqrt((c.r.kg || 1) / (d.r.kg || 1)), 0.7, 1.5);
      if (push > 0 && sp > 0) { d.vx = (c.vx / sp) * push; d.vy = (c.vy / sp) * push; d.fly = 0.5; }
      w.bus.emit("truck", { player: c, defender: d, fling: push });
      if (w.squad) w.truckHit(d, c);
    }
    else if (c.move === "stiff") { const m = Math.hypot(dx, dy) || 1; d.stun = 0.8; d.vx = (-dx / m) * PHYS.STIFF_PUSH; d.vy = (-dy / m) * PHYS.STIFF_PUSH; d.fly = 0.3; }
    // the runner feels it: a stagger as big as the hit he broke (a truck or stiff arm only brushes him; a juke or spin
    // left the tackler grabbing air)
    const K = PHYS.CONTACT, jolt = Math.hypot(d.vx, d.vy) * Math.log(5 + d.r.kg) * (hit ? 1.7 : 1);
    const stagger = c.move === "juke" || c.move === "spin" ? 0 : c.move === "truck" || c.move === "stiff" ? K.BRUSH : clamp(K.STAGGER + jolt * K.STAGGER_K, 0, K.STAGGER_MAX);
    if (stagger > 0) c.slow = Math.max(c.slow, stagger);
    w.bus.emit("brokenTackle", { tackler: d, carrier: c, move: c.move, stagger });
  }
}

// ---------- Dominoes ----------
// A body flying through the play (knocked flying by a truck, a pancake, a stiff arm or another domino, or diving full
// out) knocks over whoever he crashes into: the faster and heavier he is, the likelier; big feet keep a man up. He
// passes on part of his speed, so one big hit can bowl over a row of men. The ball carrier never goes down to debris
// (a diver who reaches him is a tackle: tackles()). Seeded like everything else (w.rng): a game replays the same.
export function dominoes(w) {
  if (w.phase !== "live") return;
  const D = PHYS.DOMINO, ps = w.players, c = w.ball.carrier;
  for (const p of ps) {
    const flying = (p.fly > 0 && (p.down > 0 || p.stun > 0)) || (p.move === "dive" && !p.hasBall && p.z > 0);
    if (!flying) continue;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp < D.FROM) continue;
    for (const q of ps) {
      if (q === p || q === c || !q.canAct || w.t - q.knockT < D.AGAIN) continue;
      const dx = q.x - p.x, dy = q.y - p.y, gap = p.radius + q.radius + D.GAP;
      if (dx * dx + dy * dy > gap * gap) continue;
      if ((dx * p.vx + dy * p.vy) <= 0) continue; // only what's in front of him
      q.knockT = w.t;
      const odds = clamp((sp - D.FROM) * D.K * Math.sqrt(p.r.kg / q.r.kg) / (q.r.footing || 1), D.MIN, D.MAX);
      if (!w.rng.chance(odds)) { q.stun = Math.max(q.stun, 0.25); p.vx *= 0.5; p.vy *= 0.5; w.bus.emit("dominoHold", { player: q, by: p }); break; }
      if (q.engaged) release(q, q.engaged);
      q.move = null; q.moveT = 0;
      q.down = D.DOWN + D.DOWN_K * sp; q.lie = 1; q.fly = 0.35;
      q.vx = p.vx * D.KEEP; q.vy = p.vy * D.KEEP;
      p.vx *= 1 - D.KEEP * 0.6; p.vy *= 1 - D.KEEP * 0.6;
      w.bus.emit("knockover", { player: q, by: p, speed: sp });
      break; // one man at a time: the next contact comes on the next step
    }
  }
}

export function fumble(w, carrier, by, power = 0) {
  const b = w.ball, POP = PHYS.POP;
  carrier.hasBall = false;
  b.state = "loose"; b.kind = "fumble"; b.carrier = null;
  b.x = carrier.x; b.y = carrier.y; b.z = 0.8;
  const a = w.rng.next() * Math.PI * 2, out = POP.SPEED + Math.max(0, power - POP.FROM) * POP.SPEED_K;
  b.vx = Math.cos(a) * out + carrier.vx * 0.3; b.vy = Math.sin(a) * out * parOf(w) + carrier.vy * 0.3; b.vz = POP.VZ + Math.max(0, power - POP.FROM) * POP.VZ_K;
  b.t = 0; b.bobbles = 0; b.bumpBy = null; b.bumpT = -9;
  carrier.down = 1.0; carrier.lie = 1;
  w.fumbleBy = carrier;
  if (w.squad) w.fumbled(carrier, by);
  w.bus.emit("fumble", { player: carrier, by });
}

// ---------- Ball flight ----------
// Launch a ballistic flight from (x,y,z0) landing at (tx,ty,z1) after T seconds.
export function launch(b, x, y, z0, tx, ty, z1, T, g = PHYS.GRAVITY) {
  b.x = x; b.y = y; b.z = z0;
  b.tx = tx; b.ty = ty; b.T = T; b.t = 0;
  b.vx = (tx - x) / T; b.vy = (ty - y) / T;
  b.vz = (z1 - z0) / T + 0.5 * g * T;
  b.g = g;
}

// Throw to a receiver: bullet (lob=false) or lob (air 0..1). Leads the receiver; error from distance, arm and pressure.
// assist (human throws only, world.action "pass"): a multiplier on the placement error — the CPU throws to open men
// on its read, a human throws on rhythm, so a ball to a man the HUD shows open is placed more kindly.
export function throwTo(w, qb, rec, lob = false, air = 0.5, assist = 1) {
  const b = w.ball;
  const a = arm01(qb);
  let speed = lob ? lerp(PHYS.LOB_SPEED[0], PHYS.LOB_SPEED[1], a) * (1.05 - 0.25 * air) : lerp(PHYS.BULLET_SPEED[0], PHYS.BULLET_SPEED[1], a);
  if (qb.trait && qb.trait.key === "cannon-arm") speed *= 1.06;
  // lead: iterate predicted catch point
  let px = rec.x, py = rec.y, T = 0.5;
  const lead = rec.ai.settle ? 0.25 : 1.0;
  for (let k = 0; k < 4; k++) {
    T = Math.max(0.35, Math.hypot(px - qb.x, py - qb.y) / speed);
    px = rec.x + rec.vx * T * lead; py = rec.y + rec.vy * T * lead;
  }
  // keep catch points in bounds: inside the sidelines and the end lines (a deep ball led past the back of the end
  // zone would send the receiver on into the stands)
  px = clamp(px, -9.2, 109.2);
  py = clamp(py, 0.8, FIELD_W - 0.8);
  const dist = Math.hypot(px - qb.x, py - qb.y);
  const pressure = w.pressure || 0;
  // ball placement: the error grows with distance and pressure and shrinks with the arm. The receiver runs to the
  // INTENDED spot and can only partly adjust to a bad ball (THROW_ADJUST) — off-target throws fall incomplete.
  // (traits.js: a FIELD GENERAL places it a little better, and so does a CLUTCH passer in a close game's last 2:00)
  const command = qb.trait && qb.trait.key === "field-general" ? 0.9 : 1;
  const clutchPass = qb.trait && qb.trait.key === "clutch" && Math.abs(w.score.home - w.score.away) <= 8 && (w.ot || (w.quarter >= w.regulationQuarters && w.clock <= 120)) ? 0.96 : 1;
  const poise = qb.trait && qb.trait.key === "poised" ? 0.5 : 1, touch = lob && qb.trait && qb.trait.key === "touch-passer" ? 0.88 : 1;
  let err = touch * (0.25 + dist * 0.03) * (PHYS.THROW_ARM[0] - a * PHYS.THROW_ARM[1]) * (1 + pressure * poise * PHYS.THROW_PRESS) * (w.accMult || 1) * assist * command * clutchPass;
  // (thrown while backing away from the line: a fade-away, a little wider, PHYS.FADE_ERR at a full-speed retreat)
  err *= 1 + PHYS.FADE_ERR * clamp(-qb.vx / Math.max(1, qb.r.speed), 0, 1);
  if (w.crowd) err *= 1 + HOME_FIELD.ACC * w.crowd; // a visiting QB in a loud building on a big down (world.js homeField)
  const ix = px, iy = py;
  const ang = w.rng.next() * Math.PI * 2, mag = Math.abs(w.rng.gauss()) * err * PHYS.THROW_ERR;
  px += Math.cos(ang) * mag; py += Math.sin(ang) * mag * parOf(w);
  T = Math.max(0.35, Math.hypot(px - qb.x, py - qb.y) / speed);
  qb.hasBall = false;
  b.state = "air"; b.kind = lob ? "lob" : "pass"; b.carrier = null; b.thrower = qb; b.target = rec; b.tipped = false;
  launch(b, qb.x, qb.y, 2.1, px, py, 1.5, T);
  b.ix = ix; b.iy = iy;
  w.passThrown = true;
  w.passId = (w.passId || 0) + 1; // one swat per ball
  w.throwErr = mag;
  qb.anim = "throw"; qb.animT = 0;
  rec.ai.target = null;
  hurried(w, qb); // (who's on him as he lets it go: a pressure)
  w.bus.emit("throw", { qb, target: rec, ball: b, lob, dist });
}

export function ballStep(w, dt) {
  const b = w.ball;
  if ((w.playType === "kickoff" || w.playType === "punt") && !w.onside && !w.autopilot && w.returner && w.isUserTeam(w.returner.teamKey) && (!w.control || w.control.teamKey !== w.user)) w.control = w.returner;
  b.spin += dt * (b.state === "air" ? 18 : 0);
  if (b.state === "held") {
    const c = b.carrier;
    if (c) { b.x = c.x + c.faceX * 0.25; b.y = c.y + c.faceY * 0.25; b.z = c.z + 1.1; }
    return;
  }
  if (b.state === "air") {
    b.t += dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vz -= (b.g || PHYS.GRAVITY) * dt;
    if (b.kind === "pass" || b.kind === "lob") {
      // swat / tip attempts by jumping defenders near the ball path late in flight
      if (b.t >= b.T - 0.02) { resolveCatch(w); return; }
    } else if (b.kind === "snap" || b.kind === "pitch") {
      if (b.t >= b.T) {
        const r = b.target; b.state = "held"; b.carrier = r; r.hasBall = true;
        const flick = b.kind === "pitch" && w.call && w.call.off && w.call.off.flea && r === w.qb;
        b.kind = "";
        if (flick) { w.handedOff = false; w.flickT = w.t; w.bus.emit("flicker", { player: r }); } // flea flicker: the QB has it back
        w.bus.emit("handoff", { player: r, pitch: true });
      }
    } else if (b.kind !== "deflect" && b.kind !== "inc") kickFlight(w, dt);
    if (b.state === "air" && b.z <= 0 && b.t > 0.1) {
      b.z = 0;
      ballGrounded(w);
    }
    return;
  }
  // a kick or an incomplete pass whistled dead where it came down (ballGrounded settle): its hop and roll to rest, in
  // the dead ball only
  if (b.state === "dead") { if (w.phase === "dead" && SETTLES.has(b.kind)) settleStep(b, dt); return; }
  if (b.state === "loose") {
    b.t += dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vz -= PHYS.GRAVITY * dt;
    if (b.z <= 0) {
      const hop = Math.abs(b.vz) > 2;
      b.z = 0; b.vz = hop ? -b.vz * (b.kind === "fumble" ? 0.5 : 0.35) : 0; b.vx *= 0.7; b.vy *= 0.7;
      if (hop && b.kind === "fumble" && w.phase === "live") { // a football's hop: off at an angle nobody can call
        const t = (w.rng.next() - 0.5) * 2 * PHYS.PINBALL.TWIST, c = Math.cos(t), s = Math.sin(t), vx = b.vx;
        b.vx = vx * c - b.vy * s; b.vy = vx * s + b.vy * c;
      }
    }
    b.vx *= 1 - 0.9 * dt; b.vy *= 1 - 0.9 * dt;
    looseBall(w, dt);
  }
}

// ---------- Kicks, catches, loose balls (moved from world.js; world.js delegates) ----------
export function launchKick(w, kind) {
  const b = w.ball, ki = w.kickInput || { power: 0.8, acc: 0, aim: 0 };
  const k = w.kicker;
  const kr = Math.min(1.15, Math.max(0.55, k.r.kick / 90));
  w.kicked = true;
  w.kickPower = ki.power; w.kickAcc = ki.acc;
  b.carrier = null; if (k) k.hasBall = false;
  if (w.holder) w.holder.hasBall = false;
  b.state = "air"; b.kind = kind; b.thrower = k;
  k.anim = "kick"; k.animT = 0;
  if (kind === "kickoff") {
    let dist = (w.onside ? 11 : w.squib ? 38 : 46) + ki.power * (w.onside ? 3 : 26) * kr;
    let ty = clamp(w.ballY + (ki.aim || 0) * 14 + ki.acc * 9, 4, FIELD_W - 4);
    // an onside kick is driven into the turf: it comes off the foot a little long or short, left or right
    if (w.onside) { dist += w.rng.gauss() * KICKING.ONSIDE_SCATTER[0]; ty = clamp(ty + w.rng.gauss() * KICKING.ONSIDE_SCATTER[1], 2, FIELD_W - 2); }
    const T = w.onside ? 1.0 : w.squib ? 1.6 : 3.7 + ki.power * 0.5; // ~4 s of hang time
    launch(b, w.los, w.ballY, 0.3, w.los + dist, ty + w.windY() * T * 0.5, 0, T, PHYS.KICK_G);
    b.kind = w.onside ? "onside" : "kickoff";
    if (w.onside) { w.onsideFree = false; if (w.onsideTries) w.onsideTries[w.possession]++; }
    // returner: nearest deep man to the landing spot. Onside: a human (either side) gets the man nearest the landing
    // spot, to go get it (the AI plays him until the stick moves)
    if (!w.onside) {
      let best = w.returners[0], bd = 1e9;
      for (const r of w.returners) { const d = r.distTo(w.los + dist, ty); if (d < bd) { bd = d; best = r; } }
      w.returner = best;
      if (w.isUserTeam(best.teamKey) && !w.autopilot) w.control = best;
    } else if (!w.autopilot && w.user) {
      let best = null, bd = 1e9;
      const receiving = w.possession === "home" ? "away" : "home";
      for (const p of w.players.filter((x) => x.teamKey === receiving)) { const d = p.distTo(w.los + dist, ty); if (d < bd) { bd = d; best = p; } }
      if (best) w.control = best;
    }
    w.bus.emit("kick", { kind, power: ki.power, accuracy: ki.acc, player: k, type: w.onside ? "onside" : w.squib ? "squib" : "normal" });
    return;
  }
  if (kind === "punt") {
    w.stats[w.possession].punts++;
    if (tryBlock(w, k.x + 0.9, k.y, kind, 1)) return;
    // distance from the PUNTER, who stands 14 yd behind the line (≈ 38–45 net once the return is in). Near the goal a
    // long punt is a pin (lands inside the 6 … a few yards deep), not an automatic touchback.
    const dist = 14 + (30 + ki.power * 24) * (0.85 + kr * 0.2);
    const tx = Math.min(k.x + dist, 94 + w.rng.next() * 9);
    const ty = clamp(w.ballY + (ki.aim || 0) * 12 + ki.acc * 10, 2, FIELD_W - 2);
    const T = 3.3 + ki.power * 1.1;
    launch(b, k.x, k.y, 1.2, tx, clamp(ty + w.windY() * T * 0.5, 1, FIELD_W - 1), 0, T, PHYS.KICK_G);
    // the returner reads it off the foot: coming down inside his own LET_GO, he lets it go (ai.js kickThink), the CPU's
    // and a human's alike, unless the human has called FAIR CATCH (it calls a let-go off later too: world.action)
    w.letGo = KICKING.LET_GO > 0 && b.tx > 100 - KICKING.LET_GO && !(w.fairCatch && w.isUserTeam(w.defTeam));
    w.bus.emit("kick", { kind, power: ki.power, accuracy: ki.acc, player: k });
    w.bus.emit("punt", { player: k });
    return;
  }
  // field goal / PAT (build A's model): fixed launch angle, speed from power, hook/slice from the meter's accuracy
  const sx = w.holderSpot[0], sy = w.holderSpot[1];
  w.fgEval = false;
  w.fgDist = Math.round(110 - sx);
  if (tryBlock(w, sx + 1.1, sy, kind, 1)) return;
  const v = fgSpeed(k, clamp(ki.power, 0, 1));
  const ang = (ki.acc || 0) * KICKING.ACC_ANG + (ki.aim || 0) * KICKING.AIM_ANG + (w.windAng ? w.windAng() : 0);
  const base = Math.atan2(MID_Y - sy, 110 - sx); // aimed at the middle of the uprights
  const dirx = Math.cos(base + ang), diry = Math.sin(base + ang);
  const e = KICKING.FG_ELEV, h = v * Math.cos(e);
  b.x = sx; b.y = sy; b.z = 0.3; b.t = 0; b.g = PHYS.KICK_G;
  b.vx = h * dirx; b.vy = h * diry; b.vz = v * Math.sin(e);
  b.T = (2 * b.vz) / PHYS.KICK_G;
  b.tx = sx + h * b.T * dirx; b.ty = sy + h * b.T * diry;
  w.bus.emit("kick", { kind, power: ki.power, accuracy: ki.acc, player: k });
}
// A free rusher at the kick point gets a hand on it: the ball pops loose behind the line (live — see looseBall).
// odds = chance multiplier (the early-flight check below uses the same rule while the ball is still low).
function tryBlock(w, kx, ky, kind, odds) {
  if (w.blockRolled) return false;
  let best = null, bd = 99;
  for (const d of w.def) {
    if (d.engaged || d.down > 0 || d.stun > 0) continue;
    const reach = KICKING.BLOCK_REACH + (d.move === "swat" ? 0.5 : d.move === "dive" ? 0.35 : 0);
    const dd = d.distTo(kx, ky);
    if (dd < reach && dd - reach < bd) { bd = dd - reach; best = d; }
  }
  if (!best) return false;
  w.blockRolled = true;
  const reach = KICKING.BLOCK_REACH + (best.move === "swat" ? 0.5 : best.move === "dive" ? 0.35 : 0);
  const p = clamp((0.45 + 0.5 * (1 - best.distTo(kx, ky) / reach)) * odds, 0, 0.92);
  if (!w.rng.chance(p)) return false;
  blockKick(w, best, kind, kx, ky);
  return true;
}
function blockKick(w, d, kind, kx, ky) {
  const b = w.ball, k = w.kicker;
  w.kicked = true; w.blockedKick = kind;
  if (w.squad) w.kickBlocker = d;
  if (k) k.hasBall = false;
  if (w.holder) w.holder.hasBall = false;
  b.state = "loose"; b.kind = "blocked"; b.carrier = null; b.t = 0; b.thrower = k;
  b.x = kx; b.y = ky; b.z = 1.4;
  if (kind === "punt") { b.x = d.x - 0.4; b.y = d.y; b.z = 1.0; b.vx = d.vx * 0.3 - 0.6; b.vy = d.vy * 0.3 + (w.rng.next() - 0.5) * 2; b.vz = 1.2 + w.rng.next(); } // smothered: it drops at his feet
  else { b.vx = -(3 + w.rng.next() * 5); b.vy = (w.rng.next() - 0.5) * 9; b.vz = 3 + w.rng.next() * 2.5; }
  d.flash = 0.15;
  // the kicker and the holder freeze for a beat; the rush is already flowing toward the ball; nobody's blocking now
  if (k) k.stun = 0.6;
  if (w.holder) w.holder.stun = 0.6;
  for (const p of w.players) {
    if (p.engaged && p.blocking) release(p, p.engaged);
    if (p.side === "O" && p !== k && p !== w.holder && p.distTo(kx, ky) < 5) p.stun = Math.max(p.stun, 0.35); // they were blocking
  }
  if (k) { k.anim = "kick"; k.animT = 0; }
  w.stats[w.defTeam].kicksBlocked = (w.stats[w.defTeam].kicksBlocked || 0) + 1;
  w.bus.emit("kick", { kind, power: 0, accuracy: 0, player: k, blocked: true });
  w.bus.emit("kickBlocked", { kind, player: d, kicker: k });
}
export function kickFlight(w, dt) {
  const b = w.ball;
  if (b.kind === "fg" || b.kind === "pat") {
    // a rusher who got through can still get a hand on it in the first yards of flight
    if (b.t < 0.32 && !w.blockRolled) {
      for (const d of w.def) {
        if (d.engaged || d.down > 0) continue;
        const top = 2.25 + d.z + (d.move === "swat" ? 0.45 : 0);
        if (b.z < top && Math.hypot(d.x - b.x, d.y - b.y) < 0.8) { if (tryBlock(w, b.x, b.y, b.kind, 1.15)) return; break; }
      }
    }
    if (!w.fgEval && b.x >= 110) {
      w.fgEval = true;
      const off = Math.abs(b.y - MID_Y);
      let good = b.z > KICKING.BAR && off < KICKING.UPRIGHT;
      // doink: off an upright (or the crossbar) — it caroms in or out
      const doink = (Math.abs(off - KICKING.UPRIGHT) < 0.16 && b.z > KICKING.BAR - 0.1) || (off < KICKING.UPRIGHT && Math.abs(b.z - KICKING.BAR) < 0.14);
      if (doink) { good = w.rng.chance(0.42); b.vx *= -0.35; b.vy *= 0.5; b.vz = Math.abs(b.vz) * 0.4; }
      w.endPlay({ type: b.kind, good, doink, x: w.los, carrierSide: "O", stop: true, kick: { dist: w.fgDist, power: w.kickPower, acc: w.kickAcc } });
    }
    return;
  }
  // kickoff / punt: returner catch (a punt he lets go: nobody fields it). A kick already whistled dead — out of bounds
  // in the air (world.js checkRules), flying on until it's down — is nobody's: no catch, no muff after the whistle
  const r = w.returner;
  if (!r || b.kind === "onside" || w.letGo || w.phase !== "live") return;
  if (b.vz < 0 && b.z < 2.8 && r.canAct && r.distTo(b.x, b.y) < 1.45) {
    if (w.playType === "punt" && !w.fairCatch && !w.isUserTeam(w.defTeam)) {
      let near = 99;
      for (const p of w.off) near = Math.min(near, p.distTo(r.x, r.y));
      // covered, outside his own 10 (inside it he returns it); KICKING.LET_GO 0: covered, or anywhere inside his 10
      if (KICKING.LET_GO ? near < KICKING.FAIR_NEAR && r.x < 90 : near < KICKING.FAIR_NEAR || r.x >= 90) w.fairCatch = true;
    }
    // muff chance
    if (w.rng.chance(0.012)) { b.state = "loose"; b.kind = "muff"; b.vz = 2; b.vx *= 0.3; b.vy *= 0.3; w.bus.emit("fumble", { player: r, muff: true }); return; }
    b.state = "held"; b.carrier = r; r.hasBall = true; b.kind = "";
    w.catchSpot = r.x; w.retStart = r.x;
    w.bus.emit("catch", { player: r, kick: true });
    if (w.fairCatch) { w.bus.emit("fairCatch", { player: r }); w.endPlay({ type: "fairCatch", x: r.x, carrierSide: "D", stop: true }); return; }
    if (r.x > 100) {
      // the CPU's returner downs it in his end zone for the touchback: a punt always, a kickoff caught more than
      // KICKING.KO_KNEEL yd deep (a human: his KNEEL)
      const kneel = w.isUserTeam(w.defTeam) ? false : r.x > 100 + KICKING.KO_KNEEL || (w.playType === "punt");
      if (kneel) { w.returnKneel = true; w.kneelT = 0; }
    }
    w.bus.emit("return", { player: r });
    if (w.isUserTeam(r.teamKey) && !w.autopilot) w.control = r;
  }
}
export function ballGrounded(w) {
  const b = w.ball;
  const k = b.kind;
  if (k === "pass" || k === "lob" || k === "deflect" || k === "inc") {
    w.endPlay({ type: "incomplete", x: w.los, carrierSide: "O", stop: true });
    settle(b);
    return;
  }
  if (k === "fg" || k === "pat") {
    if (!w.fgEval) { w.fgEval = true; w.endPlay({ type: k, good: false, short: true, x: w.los, carrierSide: "O", stop: true, kick: { dist: w.fgDist, power: w.kickPower, acc: w.kickAcc } }); }
    b.state = "dead"; b.vx = b.vy = b.vz = 0; b.z = 0; // rests where it landed
    return;
  }
  if (k === "kickoff" || k === "punt" || k === "onside") {
    if (b.x >= 100 && k !== "onside") { w.endPlay({ type: "touchback", x: 100, carrierSide: "D", stop: true }); settle(b); return; }
    if (b.y < 0 || b.y > FIELD_W) { w.endPlay({ type: k === "punt" ? "puntOob" : "kickOob", x: b.x, carrierSide: "D", stop: true }); settle(b); return; }
    b.state = "loose"; b.kind = k === "onside" ? "onsideRoll" : "rolling"; b.vz = 2.4; b.t = 0;
    b.vx *= k === "onside" ? 0.6 : 0.45; b.vy *= 0.45;
    if (k === "onside" && b.x - w.los >= 10) w.onsideFree = true; // it has gone the 10 yards: anybody's ball
    // an onside kick takes a crazy hop: off the turf at an angle and a pace nobody can call (KICKING.ONSIDE_HOP)
    if (k === "onside") {
      const [ang, pace] = KICKING.ONSIDE_HOP, a = (w.rng.next() * 2 - 1) * ang, s = 1 + (w.rng.next() * 2 - 1) * pace;
      const vx = b.vx, vy = b.vy, c = Math.cos(a), sn = Math.sin(a);
      b.vx = (vx * c - vy * sn) * s; b.vy = (vx * sn + vy * c) * s; b.vz = 2.4 * (0.75 + w.rng.next() * 0.5);
    }
  }
}
// A ball whistled dead where it came down — a kick in the end zone (a touchback) or out of bounds (or whistled out of
// bounds in the air, world.js checkRules, and down now), an incomplete pass: dead, with a hop and a short roll
// (KICKING.SETTLE) that ballStep plays out to rest. A look only — nothing picks it up, no random number is drawn, the
// play's spot is the whistle's. (It stayed "air", and slid on at its full pace through the dead ball: a kick out of the
// end zone and through the stands, a missed pass across the field and over the sideline.) The online Mirror keeps the
// landing spot it had from the flight (net/mirror.js setState), as the server's ball keeps launch's.
const SETTLES = new Set(["kickoff", "punt", "onside", "pass", "lob", "inc", "deflect"]);
// a loose kick the whistle ended where it was recovered (looseBall: an onside kick or a muff the kicking team fell on, a
// punt downed): dead there, at rest — the recovering team's ball (or the receiving team's, downed), nobody else's
const deadBall = (b) => { b.state = "dead"; b.vx = 0; b.vy = 0; b.vz = 0; b.z = 0; };
function settle(b) {
  const [hop, keep] = KICKING.SETTLE;
  b.state = "dead"; b.z = 0; b.vz = hop; b.vx *= keep; b.vy *= keep;
}
function settleStep(b, dt) {
  if (b.z > 0 || b.vz > 0) { b.z += b.vz * dt; b.vz -= PHYS.GRAVITY * dt; }
  if (b.z <= 0) { b.z = 0; if (b.vz < 0) { const v = -b.vz; b.vz = v > 2 ? v * 0.35 : 0; b.vx *= 0.7; b.vy *= 0.7; } } // (a second, smaller hop)
  // (it stops at the stadium's walls; one that came down past them, in the stands, stays there)
  const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
  if (nx < -15 || nx > 115 || ny < -7.5 || ny > FIELD_W + 7.5) { b.vx = 0; b.vy = 0; } else { b.x = nx; b.y = ny; }
  if (b.z === 0 && b.vz === 0) {
    const f = Math.max(0, 1 - KICKING.SETTLE[2] * dt); // (as the loose ball's: no Math.exp, which V8s round differently)
    b.vx *= f; b.vy *= f;
    if (Math.hypot(b.vx, b.vy) < 0.05) b.vx = b.vy = 0;
  }
}
export function looseBall(w, dt) {
  const b = w.ball;
  // after the whistle a loose ball is nobody's: no recovery, no muff, no pick-up, no random number drawn (it rolls on
  // only where the play left it so: out of bounds, into the end zone). A recovery that ends the play leaves it dead
  // where it was recovered (deadBall): it was live after its own whistle — an onside kick the kicking team fell on was
  // muffed again and again through the dead ball (MUFFED!, random numbers drawn), a muff or a downed punt picked up by
  // the receiving team
  if (w.phase !== "live") return;
  if (b.kind === "blocked" && (b.y < -0.5 || b.y > FIELD_W + 0.5 || b.x < -9.8)) {
    // a blocked kick out of bounds: dead there (out the back of the end zone = safety)
    w.endPlay({ type: b.x <= 0 ? "safety" : "blockOob", x: b.x, carrierSide: "O", stop: true, blocked: true });
    return;
  }
  if (b.y < -0.5 || b.y > FIELD_W + 0.5 || (b.kind === "fumble" && (b.x < -10.5 || b.x > 110.5))) {
    // out of bounds: last possession keeps / kicks go to the receiver. An offense's fumble out of its own end zone is
    // a safety, out of the other end zone a touchback (over a sideline or the end line)
    const by = w.fumbleBy ? w.fumbleBy.side : "O";
    if (b.kind === "rolling" || b.kind === "onsideRoll" || b.kind === "muff") w.endPlay({ type: "puntOob", x: b.x, carrierSide: "D", stop: true });
    else if (by === "O" && b.x <= 0) w.endPlay({ type: "safety", x: b.x, carrierSide: "O", fumble: true, stop: true });
    else if (by === "O" && b.x >= 100) w.endPlay({ type: "touchback", x: 100, carrierSide: "D", fumble: true, lost: true, stop: true });
    // the defense's fumble (an interception / fumble / kick return) out of the end zone it attacks: a touchback, the
    // offense's ball at its own 20 (advance: a takeaway lost back, a new series)
    else if (by === "D" && b.x <= 0) w.endPlay({ type: "recovery", x: 20, carrierSide: "O", fumble: true, lost: true, touchback: true, stop: true });
    else w.endPlay({ type: "oob", x: b.x, carrierSide: by, stop: true });
    return;
  }
  if (b.kind === "blocked") {
    if (b.t < 0.25 || b.z > 1.1) return;
    let best = null, bd = 0.9;
    for (const p of w.players) { if (!p.canAct) continue; const d = p.distTo(b.x, b.y); if (d < bd) { bd = d; best = p; } }
    if (!best) return;
    b.state = "held"; b.carrier = best; best.hasBall = true; b.kind = "";
    if (best.side === "O") {
      // the kicking team falls on it: dead at the spot (4th down: the other team's ball there)
      w.bus.emit("recover", { player: best });
      w.endPlay({ type: best.x <= 0 ? "safety" : "blockRecovered", x: best.x, carrierSide: "O", stop: true, blocked: true });
      return;
    }
    // the rush scoops it up and takes off
    w.returner = best; w.retStart = best.x; w.blockReturn = true;
    if (w.isUserTeam(best.teamKey) && !w.autopilot) w.control = best;
    w.bus.emit("recover", { player: best, scoop: true });
    return;
  }
  if (b.kind === "rolling" && b.x >= 100) { w.endPlay({ type: "touchback", x: 100, carrierSide: "D", stop: true }); return; }
  if (b.kind === "fumble") bump(w, b);
  if (b.t < 0.3 || b.z > 1.0) return;
  // rolling punt stops → downed (one the returner let go and nobody's at: dead where it lies, the receiving team's ball)
  if (b.kind === "rolling" && Math.hypot(b.vx, b.vy) < 0.5 && b.t > 1.2) {
    for (const p of w.off) if (p.distTo(b.x, b.y) < 2.5) { w.downedBy = p; w.endPlay({ type: "downed", x: b.x, carrierSide: "D", stop: true }); deadBall(b); return; }
    if (w.letGo) { w.endPlay({ type: "downed", x: b.x, carrierSide: "D", stop: true }); deadBall(b); return; }
  }
  // an onside kick is the kicking team's to recover only once it has gone 10 yards or the receivers have touched it
  const onside = b.kind === "onsideRoll";
  if (onside && b.x - w.los >= 10) w.onsideFree = true;
  let best = null, bd = 0.85;
  for (const p of w.players) {
    // (a punt let go: the receiving team stays off it, ai.js kickThink — it never picks it up)
    const diver = b.kind === "fumble" && p.move === "dive" && p.z < 0.6;
    if ((!p.canAct && !diver) || (onside && p.side === "O" && !w.onsideFree) || (w.letGo && p.side === "D")) continue;
    const d = p.distTo(b.x, b.y) - (diver ? PHYS.PINBALL.DIVE_REACH - 0.85 : 0);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) return;
  if (onside) {
    // a bouncing onside kick is hard to field: it can squirt off him (still live), likelier with the other team on him
    // (a receiving team set for it fields it cleanly more often: KICKING.ONSIDE_MUFF_SET)
    let near = 99;
    for (const q of best.side === "O" ? w.def : w.off) if (q.canAct) near = Math.min(near, q.distTo(best.x, best.y));
    const set = best.side === "D" ? (w.onsideSet || 0) / 2 : 0;
    if (w.rng.chance(KICKING.ONSIDE_MUFF + (KICKING.ONSIDE_MUFF_SET - KICKING.ONSIDE_MUFF) * set + Math.max(0, 4 - near) * KICKING.ONSIDE_PRESSURE)) {
      b.vx = (w.rng.next() - 0.5) * 7; b.vy = (w.rng.next() - 0.5) * 7; b.vz = 2 + w.rng.next() * 2; b.z = 0.3; b.t = 0;
      best.stun = Math.max(best.stun, 0.35); w.kickTouch = true; // touched: the clock runs (world.updateLive)
      if (best.side === "D") w.onsideFree = true;
      w.bus.emit("fumble", { player: best, muff: true });
      return;
    }
    if (best.side === "O") { w.endPlay({ type: "onsideRecovered", x: b.x, carrierSide: "O", stop: true }); deadBall(b); return; }
    b.state = "held"; b.carrier = best; best.hasBall = true; b.kind = ""; w.returner = best; w.catchSpot = best.x; w.retStart = best.x;
    if (w.isUserTeam(best.teamKey) && !w.autopilot) w.control = best;
    return;
  }
  if (b.kind === "rolling" || b.kind === "muff") {
    if (best.side === "O") {
      if (b.kind === "muff") { w.endPlay({ type: "muffRecovered", x: b.x, carrierSide: "O", stop: true }); deadBall(b); return; }
      w.downedBy = best; w.endPlay({ type: "downed", x: b.x, carrierSide: "D", stop: true }); deadBall(b); return;
    }
    b.state = "held"; b.carrier = best; best.hasBall = true; b.kind = ""; w.returner = best; w.catchSpot = best.x; w.retStart = best.x;
    if (w.isUserTeam(best.teamKey) && !w.autopilot) w.control = best;
    return;
  }
  // fumble recovery ends the play at the spot … unless he bobbles it (pinball: it squirts off him, still live)
  if (b.kind === "fumble") {
    const B = PHYS.PINBALL, sp = Math.hypot(b.vx, b.vy), diving = best.move === "dive";
    const odds = clamp(B.BASE + sp * B.SPEED - (best.r.hands - 75) / B.HANDS - (diving ? B.DIVE : 0), B.MIN, B.MAX);
    if ((b.bobbles || 0) < B.BOBBLES && w.rng.chance(odds)) {
      b.bobbles = (b.bobbles || 0) + 1;
      carom(w, b, best, 2.5 + w.rng.next() * 2);
      best.stun = Math.max(best.stun, 0.2);
      w.bus.emit("bobble", { player: best });
      return;
    }
  }
  const lostBy = w.fumbleBy;
  b.state = "held"; b.carrier = best; best.hasBall = true; b.kind = "";
  w.bus.emit("recover", { player: best });
  if (w.statsBy) recovered(w, best);
  const lost = Boolean(lostBy && lostBy.side !== best.side);
  // a recovery in an end zone scores: the defense in the offense's end zone (a strip-sack touchdown), the offense in
  // its own (safety) or in the opponent's (touchdown). The defense in its own end zone stays a touchback (advance).
  if (best.side === "D" && best.x <= 0) { w.endPlay({ type: "td", x: 0, carrierSide: "D", carrier: best, fumble: true, lost, stop: true }); return; }
  if (best.side === "O" && best.x <= 0) { w.endPlay({ type: "safety", x: best.x, carrierSide: "O", fumble: true, lost, stop: true }); return; }
  if (best.side === "O" && best.x >= 100) { w.endPlay({ type: "td", x: 100, carrierSide: "O", carrier: best, fumble: true, lost, stop: true }); return; }
  w.endPlay({ type: "recovery", x: best.x, carrierSide: best.side, fumble: true, lost, stop: true });
}
// pinball: the loose ball off a body (away from his middle, his own motion in it), up in the air again
function carom(w, b, p, up) {
  const B = PHYS.PINBALL;
  let nx = b.x - p.x, ny = b.y - p.y;
  const n = Math.hypot(nx, ny);
  if (n < 1e-3) { const a = w.rng.next() * Math.PI * 2; nx = Math.cos(a); ny = Math.sin(a); } else { nx /= n; ny /= n; }
  const sp = Math.hypot(b.vx, b.vy), into = b.vx * nx + b.vy * ny;
  if (into < 0) { b.vx -= 2 * into * nx; b.vy -= 2 * into * ny; } // reflected off him
  const spread = (w.rng.next() - 0.5) * 1.2, c = Math.cos(spread), s = Math.sin(spread), vx = b.vx;
  b.vx = (vx * c - b.vy * s) * B.KEEP + p.vx * 0.5 + nx * 1.5; b.vy = (vx * s + b.vy * c) * B.KEEP + p.vy * 0.5 + ny * 1.5;
  if (Math.hypot(b.vx, b.vy) < 2) { b.vx += nx * 2.5; b.vy += ny * 2.5; }
  b.vz = Math.max(b.vz, up); b.z = Math.max(b.z, 0.4); b.t = 0.15; b.bumpBy = p; b.bumpT = w.t;
}
// a moving loose fumble that runs into a body (standing or down: the pile is a bumper) caroms off it
function bump(w, b) {
  if (b.z > 1.6 || Math.hypot(b.vx, b.vy) < 3) return;
  for (const p of w.players) {
    if (p === b.bumpBy && w.t - b.bumpT < 0.35) continue;
    if (p.distTo(b.x, b.y) > PHYS.PINBALL.BUMP) continue;
    carom(w, b, p, 1.6 + w.rng.next() * 1.6);
    w.bus.emit("bump", { player: p });
    return;
  }
}
// PRO to LEGEND (difficulty.js w.hard): the CPU's tackler on the human's ball carrier → its level (1–4), else 0
const hardTackle = (w, d, c) => (w.hard && !w.autopilot && w.isUserTeam(c.teamKey) && !w.isUserTeam(d.teamKey) ? w.hard : 0);
// the defender a human is controlling (not the AI playing his teammates, not autopilot) makes his own plays count
// (config.js PHYS.USER_PLAY): his hit stick's fumble odds, and his pick and breakup odds on a ball he plays
const mine = (w, p) => Boolean(p) && p === w.control && !w.autopilot && w.isUserTeam(p.teamKey);
export const userFumbleMult = (w, d, hit) => (hit && mine(w, d) ? PHYS.USER_PLAY.FUMBLE : 1);
export function userBallOdds(w, dfd, jump, pInt, pBreak) {
  if (!mine(w, dfd)) return { pInt, pBreak };
  const U = PHYS.USER_PLAY, i = Math.min(0.9, pInt * U.INT);
  return { pInt: i, pBreak: Math.max(0, Math.min(0.95 - i, pBreak * (jump ? U.SWAT_JUMP : U.SWAT))) };
}
// PRO to LEGEND (difficulty.js w.hard): the CPU's defender on the human's pass → its level (1–4), else 0
const hardBall = (w, dfd, b) => (w.hard && !w.autopilot && b.thrower && w.isUserTeam(b.thrower.teamKey) && !w.isUserTeam(dfd.teamKey) ? w.hard : 0);
// In the field of play: between the sidelines and the end lines (x = -10 and 110).
const onField = (p) => p.x > -10 && p.x < 110 && p.y > 0 && p.y < FIELD_W;
const outOfBounds = (w) => { w.ball.kind = "inc"; w.bus.emit("incomplete", { oob: true }); };

export function resolveCatch(w) {
  const b = w.ball, rec = b.target;
  if (!rec) { b.kind = "inc"; return; }
  const reach = PHYS.CATCH_REACH * (rec.r.reach || 1); // (long arms reach farther)
  if (b.z > 3.6) { b.kind = "inc"; w.bus.emit("incomplete", { overthrow: true }); return; }
  // nearest defender who can play the ball
  let dfd = null, dd = 99;
  for (const d of w.def) {
    if (!d.canAct && d.z <= 0) continue;
    const dist = d.distTo(b.x, b.y);
    if (dist < dd) { dd = dist; dfd = d; }
  }
  const rd = rec.canAct ? rec.distTo(b.x, b.y) : 99;
  // contest 0..1: how well the nearest defender is placed on the ball (inside position and a timed leap help)
  let contest = 0;
  if (dfd) {
    const jump = dfd.move === "swat" && dfd.z > 0.15;
    const dReach = PHYS.CONTEST_REACH + (jump ? 0.45 : 0);
    contest = clamp((dReach - dd) / dReach, 0, 1);
    if (contest > 0 && dd < rd - 0.2) contest = Math.min(1, contest * 1.3 + 0.12);
    if (contest > 0) {
      const closer = dd < rd;
      let pInt = PHYS.INT_BASE * contest * (dfd.r.hands / 85) * (closer ? 1 : 0.4) * (b.kind === "lob" ? 1.15 : 1) * (w.intMult || 1) * (dfd.trait && dfd.trait.key === "ball-hawk" ? 1.18 : 1);
      let pBreak = contest * (PHYS.BREAK_BASE + (jump ? 0.18 : 0) + (closer ? 0.12 : 0)) * (w.breakMult || 1) * (dfd.trait && dfd.trait.key === "lockdown" ? 1.15 : 1);
      // PRO to LEGEND: the CPU's defender plays the human's ball better, and a forced throw gets picked more
      const H = hardBall(w, dfd, b);
      if (H) { pBreak += contest * HARD.BREAK[H - 1]; pInt *= HARD.INT[H - 1] * (w.throwOpen < 1 ? HARD.INT_FORCED[H - 1] : 1); }
      if (rd > reach) { pInt *= 1.6; pBreak = Math.min(0.9, pBreak * 1.3 + 0.1); }
      // F1 (config.js PHYS.INT_SHARE): the balls he gets a hand on as before, and of those the share he catches by his
      // position and his ball skills (hands; his fit at his spot). His position: how much nearer the ball he is than
      // the receiver, past INT_POS[0] — a ball the receiver can still fight him for is batted, one thrown where only he
      // can get to it (off target, or into his lane) is his to catch
      if (PHYS.INT_SHARE) {
        const [s0, s1, sMax] = PHYS.INT_SHARE, onIt = Math.min(0.95, pInt + pBreak);
        const pos = clamp((rd - dd - PHYS.INT_POS[0]) / PHYS.INT_POS[1], 0, 1), skill = clamp((dfd.r.hands - 30) / 70, 0.25, 1.4) * (0.85 + 0.3 * (dfd.r.fit || 0.5));
        const share = clamp((s0 + s1 * pos) * skill * (b.kind === "lob" ? 1.15 : 1) * (w.intMult || 1), 0, sMax);
        // PRO to LEGEND (the CPU's defender on the human's ball, H above): at the least his pick odds as they were
        // before F1, HARD.INT and INT_FORCED on them (× HARD.INT_FLOOR), level with the receiver too: a ball forced
        // into coverage costs at the hard levels
        pInt = Math.min(onIt, Math.max(onIt * share, H ? pInt * HARD.INT_FLOOR[H - 1] : 0)); pBreak = onIt - pInt;
      }
      ({ pInt, pBreak } = userBallOdds(w, dfd, jump, pInt, pBreak)); // the human's own defender on the ball
      const roll = w.rng.next();
      if (roll < pInt) {
        if (!onField(dfd)) { outOfBounds(w); return; } // picked off out of bounds: no interception
        b.state = "held"; b.carrier = dfd; dfd.hasBall = true; b.kind = ""; dfd.flash = 0.12;
        w.intSpot = dfd.x; w.retStart = dfd.x;
        if (w.squad) w.intBy = dfd;
        if (w.isUserTeam(dfd.teamKey)) w.control = dfd;
        else if (w.isUserTeam(rec.teamKey)) w.control = rec;
        w.bus.emit("interception", { player: dfd, qb: b.thrower });
        w.bus.emit("turnover", { kind: "int" });
        return;
      }
      if (roll < pInt + pBreak) {
        b.kind = "deflect"; b.vx *= -0.25; b.vy = (w.rng.next() - 0.5) * 6 * parOf(w); b.vz = 3.5 + w.rng.next() * 2;
        if (!w.swatted) { w.swatted = true; w.stats[w.defTeam].swats++; if (w.squad) w.swatBy = dfd; w.bus.emit("swat", { player: dfd, receiver: rec }); }
        w.bus.emit("incomplete", { swat: true });
        return;
      }
    }
  }
  if (rd < reach) {
    if (!onField(rec)) { outOfBounds(w); return; } // caught out of bounds (past the end line or a sideline): incomplete
    let p = PHYS.CATCH_BASE + (rec.r.hands - 75) / 320 + (b.kind === "lob" && rec.r.flying ? 0.04 : 0);
    p -= contest * (0.12 + (contest > 0 && hardBall(w, dfd, b) ? HARD.CATCH[hardBall(w, dfd, b) - 1] : 0)); // (PRO to LEGEND: a contested catch is harder)
    if (rec.trait && rec.trait.key === "sure-hands") p += 0.07;
    if (rec.trait && rec.trait.key === "high-pointer" && contest > 0) p += 0.06;
    if (rec.trait && rec.trait.key === "chain-mover" && w.down >= 3) p += 0.06;
    if (rec.trait && rec.trait.key === "deep-threat" && b.kind === "lob") p += 0.05;
    p -= Math.max(0, rd - reach * 0.6) / (reach * 0.4) * 0.14; // a reach / diving catch
    p *= w.catchMult || 1;
    const catchChem = w.chemistryFor && b.thrower ? w.chemistryFor(rec, b.thrower) : 1; // (chemistry.js: the passer and his receiver)
    p *= catchChem;
    if (w.rng.chance(Math.max(0.2, Math.min(0.97, p)))) {
      // the gather: a receiver gives up speed to secure the ball (a lot on a deep ball, a little in stride)
      const lob = b.kind === "lob", keep = lob ? 0.55 : 0.82;
      rec.vx *= keep; rec.vy *= keep; if (lob) rec.slow = Math.max(rec.slow, 0.22);
      b.state = "held"; b.carrier = rec; rec.hasBall = true; b.kind = ""; rec.flash = 0.1;
      rec.anim = "catch"; rec.animT = 0;
      w.catchSpot = rec.x;
      if (w.isUserTeam(rec.teamKey) && !w.autopilot) w.control = rec;
      w.bus.emit("catch", { player: rec });
      if (rec.trait && (rec.trait.key === "sure-hands" || rec.trait.key === "high-pointer")) w.bus.emit("trait", { player: rec, name: rec.trait.name });
      if (catchChem !== 1) w.bus.emit("chemistry", { player: rec, partner: b.thrower, positive: catchChem > 1 });
      return;
    }
    b.kind = "inc"; b.vz = 1.5; b.vx *= 0.2; b.vy *= 0.2;
    w.bus.emit("drop", { player: rec });
    w.bus.emit("incomplete", { drop: true });
    return;
  }
  b.kind = "inc";
  w.bus.emit("incomplete", {});
}

export { clamp, lerp };
export const inBounds = (y) => y > 0 && y < FIELD_W;
export const MID = MID_Y;
