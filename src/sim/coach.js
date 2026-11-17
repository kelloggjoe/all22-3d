// The coach's substitutions: PRO's Depth Chart (ui-depth.js) during a game (Discord, 2026-10-29, tweigle: "Access depth
// chart during the game to allow playing backups for additional XP in a blowout or move players around in case of an
// injury (WR2 to WR1, etc)"). Pure simulation, no DOM (world.js imports it: Franchise's sims run it in Node).
//   w.coachSub(k, slot, other) → { ok, when: "now" | "next" } | { ok: false, why }
//     other: { slot } — the men at the two spots trade places (WR2 → WR1: WR1's man goes to WR2); or { pid } — that
//     player in at slot: from the bench (a Franchise game's: its depth chart's players and its extra bench, squad.js),
//     or from another spot (the two trade places). A game without a bench (the builder's 22, PRO's own teams) only
//     moves men between spots.
//   When: between plays at once — the dead ball, the play call (the huddle forms again), the try's choice, halftime, a
//   coin toss — and at the line of a scrimmage play too (the play is set up again with him in, as an audible sets it);
//   during a play, or a kick's set-up, at the next dead ball (w.coachQ, run by world.js advance and continueHalftime).
//   Changes take effect on the next play either way.
//   The human's team only (the UI asks for it); never online (the Worker's match has no Depth Chart).
// In a Franchise game (squad.js) the man put in tops the spot's list, so the fatigue rotation keeps him in (and the
// snaps he plays are his: playerstats.js snapped, the XP that playing brings: franchise/sports/football.js afterWeek).
// Without a squad (PRO's own games) the two men's ratings are re-rated for their new spots (w.rateSlot, the page's own
// rating of a species at a spot; else squad.js rerate), and the box score's slot-keyed lines and the lineup's names
// (w.pstats, w.teams[k].lineup: a copy of the team, never the page's own) follow them.
import { TIMING } from "./config.js";
import * as SQ from "./squad.js";

const SLOTS = SQ.SLOTS_K;
const scrim = (w) => w.playType === "normal" || w.playType === "two";

// who'd move: → { a (the man at slot), b (the one coming in), s2 (b's spot, or null: the bench) } | { why }
function resolve(w, k, slot, other) {
  const R = w.roster[k];
  if (!R || !SLOTS.includes(slot) || !other) return { why: "no such spot" };
  const a = R[slot];
  let b = null, s2 = null;
  if (other.slot != null) {
    if (!SLOTS.includes(other.slot) || other.slot === slot) return { why: "no such spot" };
    s2 = other.slot; b = R[s2];
  } else if (other.pid != null && w.squad) {
    b = w.squad[k].byPid.get(String(other.pid)) || null;
    if (!b) return { why: "not dressed" };
    if (b.at != null) s2 = b.at;
  } else return { why: "no bench" };
  if (!b || b === a) return { why: "already there" };
  if (s2 == null && b.inj && b.inj.out) return { why: "injured" };
  return { a, b, s2 };
}

// the move itself, now (the caller has checked the moment)
function apply(w, k, slot, m) {
  if (m.s2 == null) return SQ.coachIn(w, k, slot, m.b);
  if (w.squad) return SQ.coachSwap(w, k, slot, m.s2);
  return swapPlain(w, k, slot, m.s2);
}
// PRO's own teams: the two men trade spots, their box score lines and names with them
function swapPlain(w, k, s1, s2) {
  const R = w.roster[k], a = R[s1], b = R[s2];
  R[s1] = b; R[s2] = a;
  for (const [p, s] of [[b, s1], [a, s2]]) {
    let r = null;
    try { r = w.rateSlot ? w.rateSlot(p, s) : null; } catch (_) { r = null; }
    if (!r || !Number.isFinite(r.speed)) r = SQ.rerate(p.base, p.id, s, w.teams[k].scheme);
    p.slot = s; p.pos = s; p.base = r; p.r = r;
  }
  // (a copy of the team for the lineup's names: the page's own team object, a rematch's, stays as it was)
  if (!w.coachTeams) w.coachTeams = {};
  if (!w.coachTeams[k]) { w.teams[k] = { ...w.teams[k], lineup: { ...w.teams[k].lineup } }; w.coachTeams[k] = true; }
  const L = w.teams[k].lineup, P = w.pstats[k];
  [L[s1], L[s2]] = [L[s2], L[s1]];
  const p1 = P[s1], p2 = P[s2];
  if (p2) P[s1] = p2; else delete P[s1];
  if (p1) P[s2] = p1; else delete P[s2];
  return true;
}

// Is now a moment it can happen at once? → "now" (a scrimmage play at the line: "reset", set up again) | "next"
export function moment(w) {
  const ph = w.phase;
  if (ph === "dead" || ph === "playcall" || ph === "pat" || ph === "halftime" || ph === "coin" || ph === "init") return "now";
  if (ph === "presnap" && scrim(w)) return "reset";
  return ph === "over" ? "never" : "next";
}

export function coachSub(w, k, slot, other) {
  if (!w.roster[k]) return { ok: false, why: "no such team" };
  const when = moment(w);
  if (when === "never") return { ok: false, why: "the game is over" };
  const m = resolve(w, k, slot, other);
  if (m.why) return { ok: false, why: m.why };
  if (when === "next") {
    (w.coachQ || (w.coachQ = [])).push({ k, slot, other: other.slot != null ? { slot: other.slot } : { pid: String(other.pid) } });
    return { ok: true, when: "next" };
  }
  apply(w, k, slot, m);
  if (when === "reset") reset(w);
  else if (w.phase === "playcall") w.huddle(); // (the huddle forms again with him in it)
  return { ok: true, when: "now" };
}
// the play at the line, set up again with the new men (as an audible does it: the same call, hot routes kept, everyone
// at his spot at once)
function reset(w) {
  const keepT = w.phaseT;
  w.setupPlay();
  w.phaseT = Math.max(keepT, TIMING.HUDDLE_SEC);
  for (const p of w.players) { p.x = p.sx; p.y = p.sy; }
}
// world.js advance / continueHalftime: the moves waiting for the dead ball, in order (each checked again: a man hurt
// on the play stays out)
export function runQueue(w) {
  const Q = w.coachQ;
  w.coachQ = null;
  if (!Q) return;
  for (const q of Q) { const m = resolve(w, q.k, q.slot, q.other); if (!m.why) apply(w, q.k, q.slot, m); }
}

// ---------- what the panel shows ----------
// The 23 spots as they'll be for the next play (the moves waiting applied, on paper): [{ slot, p, next }] (next: the
// spot changes at the dead ball)
export function lineup(w, k) {
  const R = w.roster[k], at = {};
  for (const s of SLOTS) at[s] = R[s];
  const next = new Set();
  for (const q of w.coachQ || []) {
    if (q.k !== k) continue;
    const a = at[q.slot];
    let s2 = q.other.slot != null ? q.other.slot : null, b = s2 ? at[s2] : null;
    if (!s2 && w.squad) { b = w.squad[k].byPid.get(q.other.pid) || null; s2 = b ? SLOTS.find((s) => at[s] === b) || null : null; }
    if (!b || b === a) continue;
    at[q.slot] = b; next.add(q.slot);
    if (s2) { at[s2] = a; next.add(s2); }
  }
  return SLOTS.map((slot) => ({ slot, p: at[slot], next: next.has(slot) }));
}
// Everyone dressed who isn't in the next play's 23 (a Franchise game's bench; none in PRO's own games), depth order
export function bench(w, k) {
  if (!w.squad) return [];
  const on = new Set(lineup(w, k).map((x) => x.p));
  return w.squad[k].list.filter((p) => !on.has(p));
}
// a man's ratings at a spot (the panel's numbers): his own there when he holds it, else as he'd be rated in
export function ratingsAt(w, k, p, slot) {
  if (w.squad ? p.at === slot : p.slot === slot) return p.base;
  if (w.squad) return SQ.coachRatings(w, k, p, slot);
  try { const r = w.rateSlot ? w.rateSlot(p, slot) : null; if (r && Number.isFinite(r.speed)) return r; } catch (_) { /* re-rated */ }
  return SQ.rerate(p.base, p.id, slot, w.teams[k].scheme);
}
