// Seeded PRNG (mulberry32). Game logic never calls Math.random.
export function createRng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    gauss: () => (next() + next() + next() - 1.5) / 0.5,
    get seed() { return s; },
  };
}

// Cosmetic randomness for fx/crowd (never affects game state; keeps the sim deterministic).
let cs = 12345;
export function crand() {
  cs = (cs * 1103515245 + 12345) & 0x7fffffff;
  return cs / 0x7fffffff;
}
