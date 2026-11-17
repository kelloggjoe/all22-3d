import { NUMBERS, ratingsFor, roleOf } from "./sim/ratings.js";
import { kookyDNA, applyBody } from "./body.js";

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

const PROFILES = {
  QB: [
    ["Big arm", "cannon-arm", { spa: 12, spe: -5 }],
    ["Timing passer", "touch-passer", { spa: 5, spd: 7, atk: -5 }],
    ["Pocket escape", "poised", { spe: 13, spa: -6, kg: -6 }],
  ],
  BACK: [
    ["Downhill runner", "power-runner", { atk: 12, hp: 5, spe: -8, kg: 10 }],
    ["Cutback runner", "elusive", { spe: 10, atk: -6, kg: -7 }],
    ["Ball security", "secure", { spd: 8, hp: 7, spe: -4 }],
  ],
  WR: [
    ["Deep threat", "deep-threat", { spe: 10, kg: -5 }],
    ["Possession target", "sure-hands", { spd: 11, spe: -5 }],
    ["Jump-ball target", "high-pointer", { m: 0.06, kg: 6, spd: 4, spe: -7 }],
  ],
  TE: [
    ["Receiving tight end", "chain-mover", { spd: 10, spe: 7, kg: -6 }],
    ["Blocking tight end", "road-grader", { def: 12, atk: 5, kg: 8, spe: -7 }],
  ],
  LINE: [
    ["Power blocker", "road-grader", { atk: 10, kg: 10, spe: -6 }],
    ["Pass protector", "pocket-shield", { def: 12, spd: 4 }],
    ["Balanced blocker", "anchor", { hp: 9, atk: 4, kg: 4 }],
  ],
  FRONT: [
    ["Run stopper", "run-stopper", { kg: 11, def: 10, spe: -7 }],
    ["Pass rusher", "edge-rusher", { atk: 9, spe: 8, kg: -5 }],
    ["Strip specialist", "strip-artist", { atk: 6, spd: 8, kg: -2 }],
  ],
  LB: [
    ["Sure tackler", "sure-tackler", { def: 10, atk: 5 }],
    ["Pursuit linebacker", "closer", { spe: 11, kg: -6 }],
    ["Heavy hitter", "enforcer", { atk: 12, kg: 8, spe: -4 }],
  ],
  DB: [
    ["Man coverage", "lockdown", { spd: 9, def: 6 }],
    ["Ball hawk", "ball-hawk", { spd: 11, spa: 6, kg: -3 }],
    ["Run support", "enforcer", { atk: 10, kg: 7, spe: -6 }],
  ],
  K: [
    ["Long-range kicker", null, { spa: 11, atk: 6 }],
    ["Placement kicker", null, { spd: 13, spa: 5 }],
  ],
};
const GROUPS = {
  QB: "QB", HB: "BACK", FB: "BACK", SLOT: "WR", WR: "WR", TE: "TE", OL: "LINE",
  DE: "FRONT", NT: "FRONT", DT: "FRONT", OLB: "LB", ILB: "LB", MLB: "LB", CB: "DB", S: "DB", K: "K",
};
const NICKNAMES = [
  "Waffles", "The Fridge Door", "Scooter", "Meatball", "The Speed Bump", "Toaster", "Pogo",
  "Lunchbox", "Skates", "The Turnstile", "Buttonhook", "Socks", "The Bus Stop", "Flapjack",
  "Sidecar", "Three Scoops", "Big Spoon", "The Dishwasher", "Tater", "Noodle",
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const SKIN_TONES = [
  { map: 1, tint: "#ffe9d9" }, { map: 1, tint: "#e8b492" }, { map: 1, tint: "#bc8b67" },
  { map: 0, tint: "#ffe3bc" }, { map: 0, tint: "#dfa982" }, { map: 0, tint: "#aa815f" },
];

export function generatePlayer({ slot, scheme, teamKey, base, boost, rng, used }) {
  const role = roleOf(slot, scheme);
  const [hp, atk, def, spa, spd, spe, kg, m] = ARCH[role];
  const [style, traitKey, mods] = rng.pick(PROFILES[GROUPS[role]]);
  const star = rng.chance(0.15);
  const talent = base * (star ? 1.07 : 1) * rng.range(0.94, 1.06);
  const grade = (key, value) => clamp(Math.round(value * talent + (mods[key] || 0) + rng.gauss() * 8), 20, 150);
  const height = clamp(m + (mods.m || 0) + rng.gauss() * 0.082, 1.61, 2.13);
  const mass = clamp(kg + (mods.kg || 0) + (height - m) * 40 + rng.gauss() * kg * 0.095, 70, 174);
  const sp = {
    hp: grade("hp", hp), atk: grade("atk", atk), def: grade("def", def),
    spa: grade("spa", spa), spd: grade("spd", spd), spe: grade("spe", spe),
    kg: Math.round(mass), m: +height.toFixed(2), types: [],
  };
  let full;
  do { full = `${rng.pick(FIRST)} ${rng.pick(LAST)}`; } while (used.has(full));
  used.add(full);
  const player = {
    slot, id: `${teamKey}-${slot}`, name: full.split(" ").at(-1), full, num: NUMBERS[slot], level: 15, star: Number(star),
    nickname: rng.chance(0.65) ? rng.pick(NICKNAMES) : null, style,
    trait: traitKey ? { key: traitKey, name: traitKey.replace(/-/g, " ").toUpperCase() } : null,
    sp, r: ratingsFor(sp, slot, scheme, boost),
    look: {
      skin: rng.int(0, SKIN_TONES.length - 1), helmet: rng.range(1.04, 1.18), pads: rng.range(0.94, 1.23),
      stripe: rng.int(0, 2), visor: rng.chance(0.24), socks: rng.int(0, 2), gloves: rng.int(0, 2),
    },
  };
  // his body: the look, and what it does on the field
  player.dna = kookyDNA(player);
  player.r = applyBody(player.r, player.dna);
  return player;
}
