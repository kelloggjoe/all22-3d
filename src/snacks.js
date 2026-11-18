// The Snack League roster: 25 fixed snacks in four groups. Pure data (no three.js): the sim rates each one at any
// slot from its stat record sp (sim/ratings.js), so the same snack is a better QB or a better guard depending on it.
//   sp: hp toughness · atk strength · def blocking and anchor · spa arm and vision · spd hands · spe speed · kg · m height
// body: what the 3D build stretches (height, leg and arm length, hip width)
export const GROUPS = [
  { key: "balance", name: "Balance", color: "#4caf50", ink: "#0c2e10" },
  { key: "technique", name: "Technique", color: "#e0c341", ink: "#3a2f05" },
  { key: "speed", name: "Speed", color: "#42a5f5", ink: "#08294a" },
  { key: "power", name: "Power", color: "#ef5b6b", ink: "#45070f" },
];
const BASE = {
  balance: { hp: 90, atk: 90, def: 88, spa: 82, spd: 86, spe: 92, kg: 108, m: 1.88 },
  technique: { hp: 78, atk: 72, def: 66, spa: 110, spd: 110, spe: 92, kg: 95, m: 1.86 },
  speed: { hp: 72, atk: 72, def: 58, spa: 70, spd: 88, spe: 120, kg: 86, m: 1.82 },
  power: { hp: 106, atk: 112, def: 110, spa: 54, spd: 60, spe: 56, kg: 142, m: 1.93 },
};
const BODY = {
  balance: { height: 0.95, legs: 0.88, arms: 1.0, girth: 1.0 },
  technique: { height: 0.94, legs: 0.86, arms: 1.1, girth: 0.95 },
  speed: { height: 0.96, legs: 1.02, arms: 1.0, girth: 0.82 },
  power: { height: 1.0, legs: 0.74, arms: 1.0, girth: 1.4 },
};
// [key, name, group, stat tweaks, body tweaks, one line on the card]
const LIST = [
  ["burger", "Burger", "power", { def: 10, kg: 8 }, {}, "A wall of beef and bun. Anchors any line."],
  ["watermelon", "Watermelon", "power", { kg: 26, hp: 12, spe: -10, def: 6 }, { girth: 1.55 }, "The heaviest snack in the league. Nobody moves him."],
  ["burrito", "Burrito", "power", { atk: 10, spe: 14, def: -12, kg: -16 }, { girth: 1.1, legs: 0.85 }, "Wrapped tight and runs downhill."],
  ["pineapple", "Pineapple", "power", { atk: 14, spe: 10, def: -8, kg: -12 }, { girth: 1.2, legs: 0.85 }, "Spiky off the edge. Gets to the quarterback."],
  ["cake", "Layer Cake", "power", { m: 0.08, def: 6, hp: 6 }, { height: 1.05 }, "Three layers of road grader."],
  ["turkeyleg", "Turkey Leg", "power", { atk: 18, spd: -10, def: -4 }, { girth: 1.25 }, "Hits like a holiday dinner."],
  ["hotdog", "Hot Dog", "speed", { atk: 10, hp: 8, spe: -4, kg: 10 }, { girth: 0.8 }, "A tough runner who keeps his legs churning."],
  ["fries", "Fries", "speed", { spd: 12, spe: -2 }, { girth: 0.9 }, "Sure hands, sharp routes."],
  ["banana", "Banana", "speed", { spe: 8, m: 0.06, spd: 4 }, { height: 1.02, legs: 1.08 }, "Long, quick and slippery."],
  ["popsicle", "Popsicle", "speed", { spe: 14, hp: -12, kg: -10 }, { girth: 0.72, legs: 1.08 }, "The fastest snack in the league, if a bit fragile."],
  ["churro", "Churro", "speed", { spa: 22, spe: 2 }, { girth: 0.75 }, "Sugar-coated scrambler with a live arm."],
  ["corndog", "Corn Dog", "speed", { atk: 14, def: 8, spe: -8, kg: 14 }, { girth: 0.9 }, "Battered and built for contact."],
  ["taco", "Taco", "technique", { spa: 14, spd: 4 }, { girth: 1.1 }, "The league's best pure passer."],
  ["sushi", "Sushi Roll", "technique", { spd: 14, spe: 8, spa: -10 }, { girth: 0.95 }, "Never drops a ball."],
  ["pretzel", "Pretzel", "technique", { spe: 8, def: 10, spa: -14 }, { legs: 0.95 }, "Twists out of any tackle. Smothers receivers."],
  ["icecream", "Ice Cream Cone", "technique", { spa: 8, spd: 8, hp: -10, spe: 4 }, { legs: 0.92 }, "Smooth touch, melts under pressure."],
  ["cupcake", "Cupcake", "technique", { spd: 8, atk: 10, spa: 4 }, { girth: 0.95 }, "Sweet hands and a big leg on kicks."],
  ["egg", "Fried Egg", "technique", { def: 12, spe: 10, spa: -16 }, { girth: 0.9 }, "Sunny side up and lockdown in coverage."],
  ["pizza", "Pizza Slice", "balance", {}, {}, "Does a little of everything."],
  ["donut", "Donut", "balance", { spe: 8, spd: 8, kg: -12, def: -8 }, { girth: 0.95 }, "Rangy in the secondary."],
  ["sandwich", "Sandwich", "balance", { hp: 10, def: 10, spe: -6, kg: 10 }, { girth: 1.1 }, "Stacked and dependable."],
  ["waffle", "Waffle", "balance", { def: 12, spa: -8, kg: 8 }, { girth: 1.1 }, "Every pocket holds. A natural blocker."],
  ["cookie", "Cookie", "balance", { spe: 8, atk: -6, spd: 6 }, { girth: 0.9 }, "Crumbles defenders with quick cuts."],
  ["apple", "Apple", "balance", { hp: 8, spd: 6, spa: 6, atk: -4 }, {}, "Healthy all-rounder. Keeps the doctor away."],
  ["pancakes", "Pancakes", "balance", { def: 14, kg: 16, spe: -10, hp: 6 }, { girth: 1.25, legs: 0.8 }, "Throws pancake blocks. Obviously."],
];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const SNACKS = LIST.map(([key, name, group, tweak, body, blurb]) => {
  const b = BASE[group], sp = { types: [] };
  for (const k of ["hp", "atk", "def", "spa", "spd", "spe"]) sp[k] = clamp(b[k] + (tweak[k] || 0), 20, 150);
  sp.kg = b.kg + (tweak.kg || 0); sp.m = +(b.m + (tweak.m || 0)).toFixed(2);
  return { key, name, group, sp, body: { ...BODY[group], ...body }, blurb };
});
export const SNACK_BY_KEY = Object.fromEntries(SNACKS.map((s) => [s.key, s]));
