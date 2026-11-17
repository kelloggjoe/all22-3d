// ALL-22 PRO's player math, pure (no globals, no DOM, no Math.random): the 23 slots, the position roles and fit (the
// builder's position rating: draft.js ROLES / positionScore, ported here), the SPEC.md §2 ratings and the CPU tendencies
// a team's style sets. data.js feeds it the site's Pokédex (pokedata.js / pokemon.js globals); Franchise feeds it each
// player's own stats (franchise/ratings.js); world.js takes its slot lists from here, so the simulation itself reads no
// globals. A stat record `sp` = { hp, atk, def, spa, spd, spe, kg, types: [type names], m (height in meters) } and is
// treated as read-only (its features are cached by identity). Same inputs → the same numbers as before the split, bit
// for bit, and the same fit as draft.js (tools/franchise/test/ratings-extract.mjs checks every species, slot, scheme).
import { PHYS } from "./config.js";

export const SLOTS_OFF = ["QB", "HB", "FB", "WR1", "WR2", "TE", "LT", "LG", "C", "RG", "RT"];
export const SLOTS_DEF = ["DE1", "NT", "DE2", "OLB1", "ILB1", "ILB2", "OLB2", "CB1", "CB2", "S1", "S2"];
export const ALL_SLOTS = [...SLOTS_OFF, ...SLOTS_DEF];
export const NUMBERS = {
  QB: 12, HB: 22, FB: 44, WR1: 11, WR2: 88, TE: 87, LT: 71, LG: 72, C: 70, RG: 74, RT: 78,
  DE1: 91, NT: 95, DE2: 99, OLB1: 55, ILB1: 52, ILB2: 54, OLB2: 58, CB1: 21, CB2: 24, S1: 31, S2: 42, K: 3,
};
export const SLOT_LABEL = {
  QB: "QB", HB: "HB", FB: "FB", WR1: "WR", WR2: "WR", TE: "TE", LT: "LT", LG: "LG", C: "C", RG: "RG", RT: "RT",
  DE1: "DE", NT: "NT", DE2: "DE", OLB1: "OLB", ILB1: "ILB", ILB2: "ILB", OLB2: "OLB", CB1: "CB", CB2: "CB", S1: "S", S2: "S", K: "K",
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const normLogKg = (kg) => clamp((Math.log(Math.max(kg, 0.1)) - Math.log(5)) / (Math.log(400) - Math.log(5)), 0, 1);

// ---------- Position roles (draft.js; keep the two in step: the extraction test compares them) ----------
// Each role values a mix of base stats (and size: kg, m = height); a few types get a small football-flavored bump.
export const ROLES = {
  QB: { stats: { spa: 0.34, spd: 0.22, spe: 0.18, atk: 0.1, hp: 0.16 }, types: { psychic: 6, normal: 2, dragon: 2 } },
  HB: { stats: { spe: 0.34, atk: 0.3, hp: 0.16, def: 0.1, kg: 0.1 }, types: { fighting: 3, ground: 3, normal: 2 } },
  FB: { stats: { atk: 0.28, def: 0.26, hp: 0.2, kg: 0.26 }, types: { rock: 4, ground: 4, fighting: 3, normal: 2 } },
  WR: { stats: { spe: 0.5, atk: 0.14, spa: 0.14, m: 0.12, spd: 0.1 }, types: { electric: 4, flying: 4 } },
  TE: { stats: { atk: 0.24, def: 0.2, hp: 0.16, spe: 0.14, kg: 0.14, m: 0.12 }, types: { fighting: 3, water: 2 } },
  OL: { stats: { def: 0.3, hp: 0.24, kg: 0.3, atk: 0.1, spd: 0.06 }, types: { rock: 5, steel: 5, ground: 3, fighting: 2 } },
  DE: { stats: { atk: 0.34, spe: 0.28, hp: 0.14, kg: 0.14, def: 0.1 }, types: { fighting: 5, dark: 2, dragon: 2 } },
  NT: { stats: { kg: 0.34, hp: 0.24, def: 0.22, atk: 0.2 }, types: { rock: 4, ground: 4, steel: 3, fighting: 2 } },
  OLB: { stats: { atk: 0.3, spe: 0.3, def: 0.18, hp: 0.14, spd: 0.08 }, types: { fighting: 4, dark: 3, bug: 2 } },
  ILB: { stats: { atk: 0.3, def: 0.28, hp: 0.2, spe: 0.14, spd: 0.08 }, types: { fighting: 4, dark: 3, ground: 2 } },
  CB: { stats: { spe: 0.46, spd: 0.22, def: 0.14, atk: 0.1, m: 0.08 }, types: { flying: 3, dark: 3, ghost: 3 } },
  S: { stats: { spe: 0.32, spd: 0.26, def: 0.16, hp: 0.14, spa: 0.12 }, types: { flying: 4, psychic: 3 } },
  // 4-3 front and the slot offense
  DT: { stats: { kg: 0.28, atk: 0.26, hp: 0.2, def: 0.18, spe: 0.08 }, types: { rock: 3, ground: 3, steel: 3, fighting: 3 } },
  MLB: { stats: { atk: 0.28, def: 0.24, hp: 0.18, spe: 0.16, spd: 0.14 }, types: { fighting: 4, dark: 3, ground: 2 } },
  SLOT: { stats: { spe: 0.48, atk: 0.16, spd: 0.14, spa: 0.12, hp: 0.1 }, types: { electric: 4, flying: 3, fairy: 2 } },
};
// Schemes: defense "34" or "43", offense "fb" (fullback) or "slot" (slot receiver). Every spot keeps its id in each
// scheme; the 4-3 turns the NT and one ILB into tackles and the other ILB into the middle linebacker, and the slot
// offense turns the fullback into a slot receiver.
export const BASE_SCHEME = { def: "34", off: "fb" };
export const SLOT_ROLE = {
  S1: "S", S2: "S", CB1: "CB", CB2: "CB", OLB1: "OLB", OLB2: "OLB", ILB1: "ILB", ILB2: "ILB",
  DE1: "DE", DE2: "DE", NT: "NT",
  WR1: "WR", WR2: "WR", LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL", TE: "TE",
  QB: "QB", FB: "FB", HB: "HB",
};
const SCHEME_ROLE = { "43": { NT: "DT", ILB2: "DT", ILB1: "MLB" }, slot: { FB: "SLOT" } };
const draftRole = (slot, scheme = BASE_SCHEME) => (SCHEME_ROLE[scheme.def] || {})[slot] || (SCHEME_ROLE[scheme.off] || {})[slot] || SLOT_ROLE[slot];
export function roleOf(slot, scheme) {
  if (slot === "K") return "K";
  return draftRole(slot, scheme);
}
// How much each spot matters to its side of the ball (each side sums to 1).
const OL_W = { LT: 0.074, LG: 0.074, C: 0.074, RG: 0.074, RT: 0.074 };
export const OFFENSE_BY = {
  fb: { QB: 0.24, HB: 0.1, FB: 0.04, WR1: 0.09, WR2: 0.09, TE: 0.07, ...OL_W },
  slot: { QB: 0.24, HB: 0.1, FB: 0.06, WR1: 0.085, WR2: 0.085, TE: 0.06, ...OL_W },
};
export const DEFENSE_BY = {
  "34": { DE1: 0.11, DE2: 0.11, NT: 0.1, OLB1: 0.08, OLB2: 0.08, ILB1: 0.09, ILB2: 0.09, CB1: 0.11, CB2: 0.11, S1: 0.06, S2: 0.06 },
  "43": { DE1: 0.11, DE2: 0.11, NT: 0.085, ILB2: 0.085, OLB1: 0.08, OLB2: 0.08, ILB1: 0.11, CB1: 0.11, CB2: 0.11, S1: 0.06, S2: 0.06 },
};

const norm = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
const featureCache = new WeakMap();
export function featuresOf(sp) {
  let f = featureCache.get(sp);
  if (f) return f;
  f = {
    hp: norm(sp.hp, 20, 150), atk: norm(sp.atk, 20, 140), def: norm(sp.def, 20, 140),
    spa: norm(sp.spa, 20, 140), spd: norm(sp.spd, 20, 140), spe: norm(sp.spe, 20, 130),
    kg: norm(Math.log(Math.max(sp.kg, 0.1)), Math.log(5), Math.log(400)),
    m: norm(sp.m, 0.3, 2.2),
  };
  featureCache.set(sp, f);
  return f;
}
// 0–100: how well a stat record fits a slot in a scheme (the builder's position rating).
export function positionScore(sp, slot, scheme = BASE_SCHEME) {
  const role = ROLES[draftRole(slot, scheme)];
  const f = featuresOf(sp);
  let s = 0;
  for (const k in role.stats) s += role.stats[k] * f[k];
  let bonus = 0;
  for (const t of sp.types) bonus = Math.max(bonus, role.types[t] || 0);
  return Math.max(0, Math.min(100, s * 100 + bonus));
}
export function kickRating(sp) {
  return clamp(0.45 * sp.spa + 0.3 * sp.atk + 0.25 * sp.spe, 20, 130) / 1.3;
}
// 0–1 (the kicker's: his leg)
export function fitOf(sp, slot, scheme) {
  if (slot === "K") return clamp(kickRating(sp) / 100, 0, 1);
  return positionScore(sp, slot, scheme) / 100;
}

// SPEC.md §2 ratings, with the fit multiplier and a small type flavor. boost scales AI teams' difficulty. fit may be
// passed in (data.js passes its own, which falls back to 0.6 on a bad id or slot, as it always has).
export function ratingsFor(sp, slot, scheme, boost = 1, fit = fitOf(sp, slot, scheme)) {
  const types = sp.types.slice();
  const lk = normLogKg(sp.kg);
  const eff = (0.75 + 0.35 * fit) * boost;
  const has = (t) => types.includes(t);
  let speed = PHYS.BASE_SPEED + PHYS.SPEED_RANGE * (sp.spe / 150);
  if (has("electric")) speed *= 1.03;
  speed *= 0.94 + 0.08 * fit * Math.min(boost, 1.1);
  return {
    speed: clamp(speed, 5.2, 8.9),
    accel: clamp(PHYS.ACCEL_BASE + PHYS.ACCEL_RANGE * (sp.spe / 150) - 2.5 * lk, 8, 19),
    power: clamp((0.55 * sp.atk + 0.25 * sp.def + 25 * lk) * eff * (has("fighting") ? 1.06 : 1), 20, 140),
    anchor: clamp((0.5 * sp.def + 0.2 * sp.hp + 30 * lk) * eff * (has("rock") || has("steel") ? 1.06 : 1), 20, 140),
    hands: clamp((0.45 * sp.spd + 0.35 * sp.spa + 0.2 * sp.spe) * eff, 15, 130),
    arm: clamp((0.6 * sp.spa + 0.4 * sp.spd) * eff * (has("psychic") ? 1.05 : 1), 15, 140),
    agility: clamp((sp.spe - 30 * lk) * eff, 10, 140),
    toughness: clamp(sp.hp * eff, 15, 160),
    kick: kickRating(sp) * Math.min(boost, 1.1),
    fit, ghost: has("ghost"), flying: has("flying"),
    kg: sp.kg, types,
  };
}

// ---------- species fit by Pokédex id ----------
// The simulation's out-of-position fallback (squad.js) needs a species' fit from its Pokédex id, which takes the site's
// data globals; this module reads none. data.js registers its fitOf here when it loads (the PRO page always loads it),
// so PRO plays exactly as before; without it (Franchise in Node or a worker) speciesFit throws and squad.js uses the
// league's own ratings (the World's rateAt option).
let SPECIES_FIT = null;
export const setSpeciesFit = (fn) => { SPECIES_FIT = fn; };
export function speciesFit(id, slot, scheme) {
  if (!SPECIES_FIT) throw new Error("speciesFit: no species data on this page");
  return SPECIES_FIT(id, slot, scheme);
}

// ---------- CPU tendencies ----------
// skill (0..1 decision quality) and read (s added to the CPU QB's read start) rise with the ladder's diff; the rest
// comes from the coach's style and aggression, for the football AI (ai.js) to read:
//   passBias (+ = throw more), blitz (0..1 blitz call rate), go4 (0..1 4th-down boldness), trick (0..1 PA/reverse
//   preference).
export const skillFor = (diff) => +clamp(0.08 + 0.068 * diff, 0, 1).toFixed(3);
// CPU QB read delay offset (s): slow, late reads early in the ladder, quick ones at the top
export const readFor = (diff) => +(0.3 - 0.034 * diff).toFixed(3);
export function aiFor(def, diff) {
  const st = def.style || "balanced", ag = def.aggression != null ? def.aggression : 0.5;
  return {
    skill: skillFor(diff), read: readFor(diff),
    passBias: st === "air" ? 0.16 : st === "ground" ? -0.18 : st === "trick" ? 0.04 : 0,
    blitz: clamp((st === "blitz" ? 0.42 : 0.16) + 0.3 * ag, 0, 0.85),
    go4: clamp(0.15 + 0.6 * ag, 0, 1),
    trick: st === "trick" ? 0.45 : 0.08,
  };
}
