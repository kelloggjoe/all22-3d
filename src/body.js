// A player's body: his look's DNA (kooky.js builds the toon blob from it) and what it does on the field. Pure (no DOM,
// no three.js): the player generator rates every man with it, so headless games play the same as the page.
//   long arms   → farther tackle and catch reach      big mitts   → surer hands
//   stubby legs → quicker cuts, a step slower flat out stilts      → faster, stiffer in the turns
//   giant head  → a hit-stick magnet                   clown shoes → hard to knock over (dominoes)
//   wide load   → anchors blocks
import { createRng } from "./sim/rng.js";

const SKINS = [
  "#8fd694", "#b8a1f0", "#ffb36b", "#7cc6fe", "#ff9ec7", "#c7e84f", "#6fd6c2", "#f4d35e", "#a3b8ff", "#ff8f70",
  "#d9a7e8", "#9be7a8", "#ffd6a5", "#e8b492", "#bc8b67", "#8d5f43",
];
const BODIES = ["potato", "pear", "bean", "barrel", "egg"];
const HEADS = ["round", "round", "bean", "box", "tall", "wide"];
const TOPPERS = ["none", "none", "antenna", "antennae", "horns", "sprout", "mohawk", "ears", "floppy", "tuft"];
const MOUTHS = ["grin", "grin", "o", "teeth", "tongue", "flat"];
const NOSES = ["none", "button", "button", "big", "snout"];
const HELMETS = ["full", "full", "tiny", "none"];
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) || 7; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// a player's DNA: deterministic for his id and name (its own random stream, so rosters stay as they were). Built from
// his base ratings (before his body's perks): heavy men come out round, fast men noodly
export function kookyDNA(player) {
  const rng = createRng(hash(`kooky|${player.id}|${player.full || player.name}`));
  const sp = player.sp || { kg: 100, m: 1.85 }, r = player.r || {};
  const fat = clamp((sp.kg / (sp.m * sp.m) - 26) / 14, 0, 1);
  const quick = clamp(((r.speed || 7) - 6.1) / 2.2, 0, 1);
  const g = () => rng.gauss() * 0.5;
  const pickW = (list, w) => { let t = rng.next() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < list.length; i++) { t -= w[i]; if (t <= 0) return list[i]; } return list[0]; };
  const noodle = rng.chance(0.18 + quick * 0.2);
  const body = fat > 0.6 ? pickW(BODIES, [3, 2, 0, 3, 1]) : quick > 0.6 ? pickW(BODIES, [1, 1, 4, 0, 2]) : rng.pick(BODIES);
  const eyes = pickW([1, 2, 3, 4], [16, 60, 14, 10]);
  return {
    skin: rng.chance(0.82) ? rng.pick(SKINS.slice(0, 13)) : rng.pick(SKINS.slice(13)),
    body,
    girth: clamp(0.62 + fat * 0.75 + g() * 0.25, 0.5, 1.55),
    belly: clamp(0.3 + fat * 0.9 + g() * 0.3, 0, 1.3),
    torso: clamp(1 + g() * 0.25 + (body === "bean" ? 0.15 : 0), 0.75, 1.35),
    head: clamp(1.15 + g() * 0.55 + (player.slot === "QB" ? 0.2 : 0) + (rng.chance(0.12) ? 0.55 : 0), 0.75, 2.1),
    headShape: rng.pick(HEADS),
    neck: rng.chance(0.12) ? 1.9 + rng.next() * 0.8 : clamp(0.6 + rng.next() * 0.6, 0.35, 1.2),
    legs: clamp(0.68 + quick * 0.4 - fat * 0.2 + g() * 0.2, 0.42, 1.3),
    legFat: clamp((noodle ? 0.55 : 0.85) + fat * 0.7 + g() * 0.15, 0.45, 1.6),
    arms: clamp((noodle ? 1.25 : 0.95) + g() * 0.2 + (player.slot === "QB" ? 0.1 : 0), 0.7, 1.55),
    armFat: clamp((noodle ? 0.55 : 0.9) + fat * 0.5 + g() * 0.15, 0.45, 1.5),
    hands: clamp(1 + rng.next() * 0.9 + (/^WR|TE/.test(player.slot || "") ? 0.3 : 0), 0.9, 2.2),
    feet: clamp(1 + rng.next() * 0.9, 0.9, 2),
    eyes, eyeSize: clamp(0.3 + rng.next() * 0.22 - eyes * 0.03, 0.18, 0.5), eyeOdd: rng.chance(0.3),
    lids: rng.chance(0.22), pupils: rng.chance(0.15) ? "tiny" : "big",
    mouth: rng.pick(MOUTHS), nose: rng.pick(NOSES),
    topper: rng.pick(TOPPERS), helmet: rng.pick(HELMETS), mask: rng.chance(0.6),
    pads: clamp(0.8 + fat * 0.6 + g() * 0.3 + (rng.chance(0.15) ? 0.6 : 0), 0.6, 1.9),
    spots: rng.chance(0.25), height: clamp(0.92 + (sp.m - 1.85) * 0.9 + g() * 0.08, 0.78, 1.12),
  };
}

// what the body does to his ratings (a copy). reach: × tackle and catch reach · head: hit-stick target size ·
// footing: how hard he is to knock over
export function applyBody(r, d) {
  if (!r || !d) return r;
  const legs = d.legs - 0.85;
  return {
    ...r,
    speed: clamp(r.speed * (1 + legs * 0.08), 5.2, 9),
    accel: r.accel * (1 - legs * 0.08),
    agility: clamp(r.agility - legs * 40, 10, 150),
    hands: clamp(r.hands + (d.hands - 1.3) * 10, 15, 140),
    anchor: clamp(r.anchor + (d.girth - 1) * 8, 20, 150),
    reach: clamp(1 + (d.arms - 1) * 0.35, 0.9, 1.19),
    head: d.head,
    footing: 1 + (d.feet - 1) * 0.45,
  };
}

// the perks worth a line on the player card (only the ones that stand out)
export function bodyPerks(d) {
  const out = [];
  if (!d) return out;
  const pct = (k) => `${k > 0 ? "+" : ""}${Math.round(k * 100)}%`;
  if (d.arms >= 1.2) out.push(["LONG ARMS", `reach ${pct((d.arms - 1) * 0.35)}`]);
  else if (d.arms <= 0.82) out.push(["T-REX ARMS", `reach ${pct((d.arms - 1) * 0.35)}`]);
  if (d.hands >= 1.6) out.push(["BIG MITTS", `hands +${Math.round((d.hands - 1.3) * 10)}`]);
  if (d.legs <= 0.7) out.push(["STUBBY LEGS", `agility +${Math.round((0.85 - d.legs) * 40)}, speed ${pct((d.legs - 0.85) * 0.08)}`]);
  else if (d.legs >= 1.1) out.push(["STILTS", `speed ${pct((d.legs - 0.85) * 0.08)}, agility -${Math.round((d.legs - 0.85) * 40)}`]);
  if (d.head >= 1.6) out.push(["GIANT HEAD", "a hit-stick magnet"]);
  if (d.feet >= 1.6) out.push(["CLOWN SHOES", "hard to knock over"]);
  if (d.girth >= 1.2) out.push(["WIDE LOAD", `anchor +${Math.round((d.girth - 1) * 8)}`]);
  return out;
}
