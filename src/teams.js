// Human teams for ALL-22 3D. The simulation (sim/ratings.js) rates a player from a stat record
// { hp, atk, def, spa, spd, spe, kg, m, types } on the scale ALL-22 PRO was balanced on. Each human player gets a
// record built from his position's archetype plus his own seeded variation, so the World plays exactly as before.
import { ALL_SLOTS, SLOTS_OFF, SLOTS_DEF, NUMBERS, ratingsFor, fitOf, aiFor, roleOf } from "./sim/ratings.js";
import { createRng } from "./sim/rng.js";

// Stat archetypes by role: [hp, atk, def, spa, spd, spe, kg, m]. atk = strength, def = blocking/anchor,
// spa = arm/vision, spd = hands/awareness, spe = speed, kg/m = body size.
const ARCH = {
  QB: [80, 70, 60, 112, 96, 74, 102, 1.91],
  HB: [86, 98, 68, 64, 70, 104, 98, 1.80],
  FB: [92, 100, 92, 50, 62, 70, 112, 1.84],
  SLOT: [74, 72, 56, 74, 92, 112, 86, 1.80],
  WR: [72, 70, 54, 80, 98, 116, 90, 1.88],
  TE: [90, 96, 88, 62, 82, 82, 116, 1.95],
  OL: [104, 92, 118, 50, 60, 46, 142, 1.96],
  DE: [90, 112, 82, 50, 62, 92, 122, 1.96],
  NT: [110, 104, 106, 44, 56, 50, 148, 1.90],
  DT: [104, 108, 98, 44, 58, 60, 138, 1.92],
  OLB: [88, 104, 80, 56, 70, 96, 112, 1.91],
  ILB: [92, 102, 90, 60, 76, 86, 110, 1.88],
  MLB: [94, 102, 90, 66, 82, 86, 111, 1.88],
  CB: [72, 74, 70, 60, 98, 116, 87, 1.83],
  S: [80, 86, 76, 72, 96, 104, 94, 1.85],
  K: [60, 110, 50, 130, 70, 92, 88, 1.83],
};

const FIRST = ["Marcus", "Darius", "Tyler", "Jalen", "Caleb", "Andre", "Malik", "Brett", "Trevor", "Isaiah", "Devin", "Luke", "Cole", "Xavier", "Terrell", "Nolan", "Jamal", "Owen", "Quentin", "Reggie", "Silas", "Tobias", "Wade", "Zion", "Elijah", "Grant", "Hunter", "Keenan", "Miles", "Rashad", "Bo", "Cedric", "Dante", "Emmett", "Felix", "Gavin", "Hank", "Ivan", "Jace", "Kendall", "Lamar", "Mason", "Nate", "Omar", "Pierce", "Rocco", "Sterling", "Tre", "Victor", "Wyatt"];
const LAST = ["Hollis", "Okafor", "Brennan", "Castillo", "Whitfield", "Mbeki", "Lindqvist", "Arrington", "Dupree", "Fairbanks", "Garrity", "Hutchins", "Iverson", "Jefferson", "Kowalski", "Lockhart", "Maddox", "Nakamura", "Oduya", "Prescott", "Quarles", "Ramsey", "Stroud", "Thibodeaux", "Underwood", "Vance", "Wakefield", "Yates", "Zeller", "Abernathy", "Bellamy", "Crowder", "Delacroix", "Ellison", "Fontenot", "Gaines", "Holloway", "Ingram", "Jennings", "Kearney", "Lyles", "Montague", "Nwosu", "Ogletree", "Pruitt", "Rhodes", "Sizemore", "Tolliver", "Varner", "Winslow"];

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
const TRAITS = {
  QB: ["field-general", "cannon-arm", "touch-passer", "poised", "clutch"], HB: ["elusive", "power-runner", "breakaway", "secure", "goal-line"],
  WR: ["route-runner", "sure-hands", "deep-threat", "high-pointer", "chain-mover"], TE: ["sure-hands", "chain-mover"], OL: ["anchor", "road-grader", "pocket-shield"],
  DE: ["edge-rusher", "strip-artist"], NT: ["run-stopper"], DT: ["run-stopper", "edge-rusher"], OLB: ["edge-rusher", "closer", "enforcer"], ILB: ["sure-tackler", "gang-tackler"],
  MLB: ["sure-tackler", "enforcer"], CB: ["lockdown", "ball-hawk"], S: ["ball-hawk", "enforcer", "closer"], K: [],
};
const TRAIT_NAME = (k) => k.replace(/-/g, " ").toUpperCase();

// One player's stat record: the archetype, his talent (shared lift) and per-stat variation
function statRecord(role, rng, talent) {
  const a = ARCH[role] || ARCH.WR;
  const v = (x, s) => Math.max(20, Math.round(x * talent * (1 + (rng.next() - 0.5) * s)));
  return { hp: v(a[0], 0.16), atk: v(a[1], 0.16), def: v(a[2], 0.16), spa: v(a[3], 0.18), spd: v(a[4], 0.16), spe: v(a[5], 0.12),
    kg: Math.round(a[6] * (1 + (rng.next() - 0.5) * 0.12)), m: +(a[7] * (1 + (rng.next() - 0.5) * 0.04)).toFixed(2), types: [] };
}

export function makeTeam(def, opts = {}) {
  const rng = createRng(hashKey(def.key));
  const scheme = { def: def.style === "blitz" || def.style === "ground" ? "43" : "34", off: def.style === "air" ? "slot" : "fb" };
  const boost = opts.boost || 1;
  const used = new Set(), players = {}, lineup = {};
  const nameFor = () => { for (;;) { const n = `${rng.pick(FIRST)} ${rng.pick(LAST)}`; if (!used.has(n)) { used.add(n); return n; } } };
  const base = 0.96 + (def.diff - 5) * 0.025;
  for (const slot of [...ALL_SLOTS, "K"]) {
    const role = roleOf(slot, scheme);
    const star = rng.next() < 0.18;
    const talent = base * (star ? 1.07 : 1) * (0.97 + rng.next() * 0.06);
    const sp = statRecord(role, rng, talent);
    const pool = TRAITS[role] || [];
    const tk = pool.length && rng.next() < 0.45 ? rng.pick(pool) : null;
    const full = nameFor();
    players[slot] = {
      slot, id: `${def.key}-${slot}`, name: full.split(" ").slice(-1)[0], full, num: NUMBERS[slot], level: 15, star: star ? 1 : 0,
      trait: tk ? { key: tk, name: TRAIT_NAME(tk) } : null, sp,
      skin: rng.int(0, 1), r: ratingsFor(sp, slot, scheme, boost),
    };
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

// a player re-rated at another spot (the World's rateSlot: coach.js substitutions)
export const rateSlot = (p, slot) => { const info = p.team.players[p.slot]; return info && info.sp ? ratingsFor(info.sp, slot, p.team.scheme, p.team.boost || 1) : null; };
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
