// Fictional franchises, their generated rosters, and the team ratings shown in the matchup menu.
import { ALL_SLOTS, SLOTS_OFF, SLOTS_DEF, NUMBERS, ratingsFor, fitOf, aiFor } from "./sim/ratings.js";
import { SNACKS, SNACK_BY_KEY } from "./snacks.js";
import { createRng } from "./sim/rng.js";
import { generatePlayer } from "./player-generator.js";
import { applyBody } from "./body.js";

// Original, fictional franchises. colors: jersey, accent, helmet, pants. style/aggression drive the CPU coach.
export const TEAM_DEFS = [
  { key: "harbor", name: "Harbor City Mariners", short: "Mariners", abbr: "HCM", jersey: "#123a6b", accent: "#f2b134", helmet: "#123a6b", pants: "#e9e6dc", style: "air", aggression: 0.55, diff: 6 },
  { key: "ironvale", name: "Ironvale Forge", short: "Forge", abbr: "IVF", jersey: "#7a1f1f", accent: "#c9ced6", helmet: "#2b2b2f", pants: "#2b2b2f", style: "ground", aggression: 0.45, diff: 6 },
  { key: "prairie", name: "Prairie Comets", short: "Comets", abbr: "PRC", jersey: "#1c6e4a", accent: "#f5f1e6", helmet: "#f5f1e6", pants: "#1c6e4a", style: "balanced", aggression: 0.5, diff: 5 },
  { key: "summit", name: "Summit Ridge Peaks", short: "Peaks", abbr: "SRP", jersey: "#4b2a7b", accent: "#e8c547", helmet: "#4b2a7b", pants: "#e8c547", style: "blitz", aggression: 0.7, diff: 6 },
  { key: "bayou", name: "Bayou Kings", short: "Kings", abbr: "BYK", jersey: "#0f7c86", accent: "#f06d3a", helmet: "#ffffff", pants: "#ffffff", style: "trick", aggression: 0.65, diff: 5 },
  { key: "canyon", name: "Red Canyon Outlaws", short: "Outlaws", abbr: "RCO", jersey: "#c24a1b", accent: "#2a2420", helmet: "#2a2420", pants: "#e3d3b8", style: "air", aggression: 0.6, diff: 7 },
  { key: "glacier", name: "Glacier Bay Huskies", short: "Huskies", abbr: "GBH", jersey: "#dfe8f2", accent: "#1d4f91", helmet: "#1d4f91", pants: "#1d4f91", style: "balanced", aggression: 0.4, diff: 5 },
  { key: "motor", name: "Motor City Pistons", short: "Pistons", abbr: "MCP", jersey: "#1a1a1a", accent: "#d7262e", helmet: "#d7262e", pants: "#9aa0a6", style: "ground", aggression: 0.55, diff: 7 },
];
export const TEAM_BY_KEY = Object.fromEntries(TEAM_DEFS.map((d) => [d.key, d]));

const hashKey = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) || 7; };
export function makeTeam(def, opts = {}) {
  const rng = createRng(hashKey(`${opts.seed ?? 0}:${def.key}`));
  const scheme = { def: def.style === "blitz" || def.style === "ground" ? "43" : "34", off: def.style === "air" ? "slot" : "fb" };
  const boost = opts.boost || 1;
  const used = new Set(), players = {}, lineup = {};
  const base = 0.96 + (def.diff - 5) * 0.025;
  for (const slot of [...ALL_SLOTS, "K"]) {
    players[slot] = generatePlayer({ slot, scheme, teamKey: def.key, base, boost, rng, used });
    lineup[slot] = players[slot].id;
  }
  const diff = def.diff;
  const t = {
    key: def.key, name: def.name, short: def.short, abbr: def.abbr, colors: [def.jersey, def.accent], kit: { jersey: def.jersey, accent: def.accent, helmet: def.helmet, pants: def.pants },
    diff, lineup, scheme, players, boost, style: def.style, aggression: def.aggression, ai: aiFor(def, diff),
  };
  t.skill = t.ai.skill;
  t.ovr = overall(t);
  t.ratings = teamRatings(t);
  return t;
}

// ---------- Snack League: drafted teams ----------
// You draft 11 snacks onto the offense; they play both ways, so the defense and the kicker are filled from the same
// 11 by fit. The CPU drafts from whatever is left.
export const DRAFT_ORDER = ["QB", "HB", "WR1", "WR2", "TE", "FB", "LT", "LG", "C", "RG", "RT"];
const DEF_ORDER = ["CB1", "CB2", "DE1", "DE2", "NT", "ILB1", "OLB1", "OLB2", "ILB2", "S1", "S2"];
export const schemeOf = (def) => ({ def: def.style === "blitz" || def.style === "ground" ? "43" : "34", off: def.style === "air" ? "slot" : "fb" });
const bestFor = (keys, slot, scheme) => keys.reduce((best, k) => (!best || fitOf(SNACK_BY_KEY[k].sp, slot, scheme) > fitOf(SNACK_BY_KEY[best].sp, slot, scheme) ? k : best), null);
// fill the open offense slots from a pool, the most important spots first
export function autoDraft(def, picks = {}, taken = new Set()) {
  const scheme = schemeOf(def), out = { ...picks };
  const used = new Set([...taken, ...Object.values(out)]);
  for (const slot of DRAFT_ORDER) {
    if (out[slot]) continue;
    const k = bestFor(SNACKS.map((s) => s.key).filter((k) => !used.has(k)), slot, scheme);
    out[slot] = k; used.add(k);
  }
  return out;
}
// the two-way assignments: defense spot → the offense slot of the snack who plays it, and the kicker
export function twoWay(def, picks) {
  const scheme = schemeOf(def), left = new Set(DRAFT_ORDER), byKey = Object.fromEntries(DRAFT_ORDER.map((s) => [picks[s], s]));
  const D = {};
  for (const slot of DEF_ORDER) {
    const k = bestFor([...left].map((s) => picks[s]), slot, scheme);
    D[slot] = byKey[k]; left.delete(byKey[k]);
  }
  D.K = byKey[bestFor(DRAFT_ORDER.map((s) => picks[s]), "K", scheme)];
  return D;
}
export function makeSnackTeam(def, picks, opts = {}) {
  const scheme = schemeOf(def), boost = opts.boost || 1, D = twoWay(def, picks);
  const players = {}, lineup = {};
  const make = (slot, from) => {
    const s = SNACK_BY_KEY[picks[from]];
    return { slot, id: `${def.key}-${s.key}-${slot}`, snack: s.key, name: s.name, full: s.name, num: NUMBERS[from], level: 15, star: 0, sp: s.sp, r: ratingsFor(s.sp, slot, scheme, boost), snackBody: s.body, look: { skin: 0, socks: 0, gloves: 0 } };
  };
  for (const slot of SLOTS_OFF) players[slot] = make(slot, slot);
  for (const slot of [...SLOTS_DEF, "K"]) players[slot] = make(slot, D[slot]);
  for (const slot of Object.keys(players)) lineup[slot] = players[slot].id;
  const t = {
    key: def.key, name: def.name, short: def.short, abbr: def.abbr, colors: [def.jersey, def.accent], kit: { jersey: def.jersey, accent: def.accent, helmet: def.helmet, pants: def.pants },
    diff: def.diff, lineup, scheme, players, boost, style: def.style, aggression: def.aggression, ai: aiFor(def, def.diff), picks, twoWay: D,
  };
  t.skill = t.ai.skill;
  t.ovr = overall(t);
  t.ratings = teamRatings(t);
  return t;
}

// a player re-rated at another spot (the World's rateSlot: coach.js substitutions)
export const rateSlot = (p, slot) => { const info = p.team.players[p.slot]; return info && info.sp ? applyBody(ratingsFor(info.sp, slot, p.team.scheme, p.team.boost || 1), info.dna) : null; };
export function overall(t) {
  let s = 0;
  for (const slot of ALL_SLOTS) s += fitOf(t.players[slot].sp, slot, t.scheme);
  return Math.round(Math.max(40, Math.min(99, 52 + (s / ALL_SLOTS.length) * 55 * (t.boost || 1) - 6)));
}
// A team card's four bars, 40–99
export function teamRatings(t) {
  const P = t.players, sc = (v, lo, hi) => Math.round(40 + 59 * Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
  const avg = (slots, f) => slots.reduce((a, s) => a + f(P[s].r), 0) / slots.length;
  return {
    pass: sc(P.QB.r.arm * 0.5 + avg(["WR1", "WR2", "TE"], (r) => r.hands) * 0.5, 60, 130),
    rush: sc(P.HB.r.speed * 8 + avg(["LT", "LG", "C", "RG", "RT"], (r) => r.power) * 0.5, 80, 130),
    def: sc(avg(SLOTS_DEF, (r) => r.power * 0.5 + r.speed * 6), 70, 115),
    speed: sc(avg([...SLOTS_OFF, ...SLOTS_DEF], (r) => r.speed), 6.2, 7.6),
  };
}
// home and away colors that read apart on the field: the away team wears white when the jerseys clash
export function kitsFor(home, away) {
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
  const dist = (a, b) => { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16); return Math.hypot((x >> 16) - (y >> 16), ((x >> 8) & 255) - ((y >> 8) & 255), (x & 255) - (y & 255)); };
  const hk = { ...home.kit }, ak = { ...away.kit };
  if (dist(hk.jersey, ak.jersey) < 120 || Math.abs(lum(hk.jersey) - lum(ak.jersey)) < 40) {
    if (lum(ak.jersey) > 200) { ak.jersey = ak.accent; } else { ak.number = ak.jersey; ak.jersey = "#f4f4f0"; }
  }
  hk.number = hk.number || (lum(hk.jersey) > 170 ? hk.accent : "#ffffff");
  ak.number = ak.number || (lum(ak.jersey) > 170 ? ak.accent : "#ffffff");
  return { home: hk, away: ak };
}
