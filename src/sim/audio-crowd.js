// ALL-22 PRO audio — the stadium crowd's voices, synthesized ONCE into sample buffers (direct sample synthesis, no
// files, no nodes). audio.js plays them (bed loop, reactions, chant, sparse shouts) and owns every level.
// WHY (fix for "the crowd sounds like ocean waves"): the old bed was one looping white-noise buffer through two broad
//   band-passes with a 0.23 Hz gain wobble — steady band-limited noise with a slow ~4 s swell is literally how surf
//   sounds. A crowd is people talking. The bed here is ~10 s of "walla": a few thousand short syllables (a buzzy
//   glottal pulse through three vowel formants; 110–280 Hz voices, 80–300 ms syllables, random onsets, stereo spread)
//   from 150 talkers — far, mid and near — over a faint low rumble, rendered CIRCULARLY so the loop has no seam. Its
//   level flickers at speech rate (2–10 Hz) instead of swelling. Reactions (cheer, roar, groan, oooh, "DE-FENSE!")
//   are choruses of the same voices sharing a pitch / vowel contour, plus claps and fans' two-finger whistles.
//   "extras" holds single shouts, whistles and clap bursts that audio.js drops in at random (never in step with the
//   loop). Technique borrowed from ALL-22 BOWL (game/audio-bank.js formant voices + claps), re-done as plain sample
//   math so it bakes the same everywhere (no OfflineAudioContext) and can be time-sliced.
// API: new CrowdBank(seed, onReady(name, {L, R, n, seg?})) · work(ms) → true when every buffer has landed ·
//   CROWD_SR. Buffers land in order: bed, cheer, roar, groan, oooh, chant, extras (~0.1–0.2 s of work on a desktop).
export const CROWD_SR = 22050;
const SR = CROWD_SR;
const BED_SEC = 10;
const TAU = Math.PI * 2;

// one period of a glottal flow DERIVATIVE (Rosenberg pulse, differentiated = lip radiation): the buzzy voice source
const GT = 512, NZ = 8192;
const GLOT = new Float32Array(GT), NOISE = new Float32Array(NZ);
{
  const flow = (p) => (p < 0.42 ? 0.5 * (1 - Math.cos((Math.PI * p) / 0.42)) : p < 0.6 ? Math.cos((Math.PI / 2) * ((p - 0.42) / 0.18)) : 0);
  let mx = 0;
  for (let i = 0; i < GT; i++) { GLOT[i] = flow((i + 1) / GT) - flow(i / GT); mx = Math.max(mx, Math.abs(GLOT[i])); }
  for (let i = 0; i < GT; i++) GLOT[i] /= mx;
  let s = 99;
  for (let i = 0; i < NZ; i++) { s = (s * 16807) % 2147483647; NOISE[i] = (s / 2147483647) * 2 - 1; }
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Vowel formants (F1, F2, F3 Hz; adult male averages, Peterson & Barney); women's voices scale them ×1.16.
const V = {
  i: [270, 2290, 3010], I: [390, 1990, 2550], e: [530, 1840, 2480], ae: [660, 1720, 2410], a: [730, 1090, 2440],
  o: [570, 840, 2410], U: [440, 1020, 2240], u: [300, 870, 2240], A: [640, 1190, 2390], R: [490, 1350, 1690],
};
const BED_V = ["i", "e", "a", "o", "u", "A", "R"];
const FM = [1, 1.16]; // formant scale: men, women
const BED_Q = [4, 6, 8], BED_G = [1, 1.25, 0.7];
const RX_Q = [5, 7, 9], RX_G = [1, 1.1, 0.6];

// ---------- filters ----------
// One formant band-pass (RBJ, 0 dB peak, gain g): dst += g·BP(src). Circular: the state warms up on the tail first,
// so a loop's end flows into its start. (The bed runs one formant per bake step: each step stays a few ms.)
function formant(src, dst, n, f, q, g) {
  const w = (TAU * Math.min(f, SR * 0.45)) / SR, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b0 = (al / a0) * g, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = n - Math.min(n, 2048); i < n; i++) { const x = src[i], y = b0 * (x - x2) - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; }
  for (let i = 0; i < n; i++) { const x = src[i], y = b0 * (x - x2) - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; dst[i] += y; }
}
// The same with the formants gliding along a vowel path [[t, [F1,F2,F3]], ...] (re-tuned every 32 samples).
function formantsPath(src, dst, n, path, fm, Q, G) {
  for (let k = 0; k < 3; k++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let b = 0; b < n; b += 32) {
      const w = (TAU * Math.min(vAt(path, b / SR, k) * fm, SR * 0.45)) / SR, al = Math.sin(w) / (2 * Q[k]), a0 = 1 + al;
      const b0 = (al / a0) * G[k], a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - al) / a0, e = Math.min(n, b + 32);
      for (let i = b; i < e; i++) { const x = src[i], y = b0 * (x - x2) - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; dst[i] += y; }
    }
  }
}
// piecewise-linear path value at t: [[t, v], ...]
function pAt(p, t) {
  if (t <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) if (t < p[i][0]) { const [ta, va] = p[i - 1], [tb, vb] = p[i]; return va + ((vb - va) * (t - ta)) / (tb - ta); }
  return p[p.length - 1][1];
}
function vAt(p, t, k) {
  if (t <= p[0][0]) return p[0][1][k];
  for (let i = 1; i < p.length; i++) if (t < p[i][0]) { const ta = p[i - 1][0], tb = p[i][0], va = p[i - 1][1][k]; return va + ((p[i][1][k] - va) * (t - ta)) / (tb - ta); }
  return p[p.length - 1][1][k];
}

// ---------- voice sources (summed per formant group, filtered once per group) ----------
// One bed syllable: pitch glides f0 → f1, quick attack, gentle sag, rounded release; jitter + shimmer per glottal
// period, a little breath. Circular (wraps at n).
function syllable(L, R, n, i0, len, f0, f1, amp, pan, br, nz) {
  const gl = Math.cos(pan * 1.5708) * amp, gr = Math.sin(pan * 1.5708) * amp;
  const att = Math.max(1, Math.min(len * 0.3, SR * 0.018)), rel = len * 0.4, relAt = len - rel;
  let ph = (nz & 255) / 256, jit = 1, sh = 1, i = i0, z = nz;
  const inc0 = f0 / SR, dinc = (f1 - f0) / SR / len;
  for (let k = 0; k < len; k++, i++) {
    if (i >= n) i -= n;
    ph += (inc0 + dinc * k) * jit;
    if (ph >= 1) { ph -= 1; jit = 1 + NOISE[(z * 7) & (NZ - 1)] * 0.02; sh = 1 + NOISE[(z * 13) & (NZ - 1)] * 0.12; }
    const e = k < att ? k / att : k < relAt ? 1 - (0.25 * (k - att)) / (relAt - att) : 0.75 * ((len - k) / rel) * ((len - k) / rel);
    const s = (GLOT[(ph * GT) | 0] * sh + NOISE[z++ & (NZ - 1)] * br) * e;
    L[i] += s * gl;
    R[i] += s * gr;
  }
}
// One chorus voice: pitch (×base) and amplitude follow the reaction's paths, time-stretched by sc from t0.
function chorusVoice(L, R, n, o) {
  const gl = Math.cos(o.pan * 1.5708) * o.gain, gr = Math.sin(o.pan * 1.5708) * o.gain;
  const i0 = Math.max(0, Math.floor(o.t0 * SR)), i1 = Math.min(n, Math.ceil((o.t0 + o.len * o.sc) * SR));
  let ph = o.ph, jit = 1, sh = 1, z = o.nz;
  for (let b = i0; b < i1; b += 32) {
    const e = Math.min(i1, b + 32), m = e - b;
    const ta = (b / SR - o.t0) / o.sc, tb = (e / SR - o.t0) / o.sc;
    const fa = (pAt(o.f0, ta) * o.base) / SR, fb = (pAt(o.f0, tb) * o.base) / SR, aa = pAt(o.amp, ta), ab = pAt(o.amp, tb);
    for (let i = b, k = 0; i < e; i++, k++) {
      const u = k / m;
      ph += (fa + (fb - fa) * u) * jit;
      if (ph >= 1) { ph -= 1; jit = 1 + NOISE[(z * 7) & (NZ - 1)] * o.jit; sh = 1 + NOISE[(z * 13) & (NZ - 1)] * 0.15; }
      const s = (GLOT[(ph * GT) | 0] * sh + NOISE[z++ & (NZ - 1)] * o.br) * (aa + (ab - aa) * u);
      L[i] += s * gl;
      R[i] += s * gr;
    }
  }
}
// A hand clap (noise burst through a hand-sized band-pass; after BOWL's addClap), into L/R.
function clap(L, R, n, t, amp, f, q, pan, z) {
  const i0 = Math.floor(t * SR), len = Math.floor(SR * 0.035), tau = SR * (0.0025 + ((z & 15) / 15) * 0.002), up = SR * 0.0008;
  const w = (TAU * f) / SR, al = Math.sin(w) / (2 * q), a0 = 1 + al, b0 = al / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - al) / a0;
  const gl = Math.cos(pan * 1.5708) * amp, gr = Math.sin(pan * 1.5708) * amp;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let k = 0; k < len; k++) {
    const i = i0 + k;
    if (i >= n) break;
    const x = NOISE[(z + k * 3) & (NZ - 1)] * (k < up ? k / up : Math.exp(-(k - up) / tau));
    const y = b0 * (x - x2) - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    if (i >= 0) { L[i] += y * gl; R[i] += y * gr; }
  }
}
// A crowd clapping along: loose (rate claps/s each) or on shared beats.
function claps(L, R, n, r, { people = 30, rate = 3, from = 0, to = n / SR, beats = null, spread = 0.03, amp = 1 }) {
  for (let p = 0; p < people; p++) {
    const f = 900 + r() * 1600, q = 1.2 + r() * 1.2, a = amp * (0.4 + r() * 0.6), pan = r();
    if (beats) { for (const b of beats) clap(L, R, n, b + (r() - 0.5) * 2 * spread, a, f, q, pan, (r() * NZ) | 0); continue; }
    const per = 1 / (rate * (0.8 + r() * 0.4));
    for (let t = from + r() * per; t < to; t += per * (0.9 + r() * 0.2)) clap(L, R, n, t, a * (0.7 + r() * 0.3), f, q, pan, (r() * NZ) | 0);
  }
}
// A fan's two-finger whistle: "wheeet!" (sometimes "wheet-whooo"), pitch scooping up with a fast vibrato.
function whistle(L, R, n, t, vol, r) {
  const f0 = 1650 + r() * 650, top = f0 * (1.3 + r() * 0.25), d = 0.22 + r() * 0.3, pan = r(), two = r() < 0.45;
  const parts = two ? [[t, d, f0, top], [t + d + 0.05, 0.38, top * 0.98, f0 * 0.82]] : [[t, d, f0, top]];
  const gl = Math.cos(pan * 1.5708) * vol, gr = Math.sin(pan * 1.5708) * vol;
  for (const [ts, dur, fa, fb] of parts) {
    const i0 = Math.floor(ts * SR), len = Math.floor(dur * SR), gl3 = len * 0.3, a = SR * 0.025;
    let ph = 0;
    for (let k = 0; k < len && i0 + k < n; k++) {
      const f = (k < gl3 ? fa + ((fb - fa) * k) / gl3 : fb) + 22 * Math.sin((TAU * 6.5 * k) / SR);
      ph += f / SR;
      const e = k < a ? k / a : k > len * 0.55 ? (len - k) / (len * 0.45) : 1;
      const s = (Math.sin(TAU * ph) + NOISE[k & (NZ - 1)] * 0.06) * e;
      L[i0 + k] += s * gl;
      R[i0 + k] += s * gr;
    }
  }
}
// A consonant: a noise burst, high-passed (one pole at hp Hz) or low-passed (lp Hz), triangle-ish envelope.
function hiss(L, R, n, t, dur, amp, hp, lp, z) {
  const i0 = Math.floor(t * SR), len = Math.floor(dur * SR), ah = Math.exp((-TAU * (hp || 1)) / SR), al = 1 - Math.exp((-TAU * (lp || 1)) / SR);
  let xp = 0, y = 0;
  for (let k = 0; k < len && i0 + k < n; k++) {
    const x = NOISE[(z + k) & (NZ - 1)];
    y = hp ? ah * (y + x - xp) : y + al * (x - y);
    xp = x;
    const e = k < len * 0.25 ? k / (len * 0.25) : (len - k) / (len * 0.75), s = y * e * amp;
    L[i0 + k] += s;
    R[i0 + k] += s;
  }
}
// 2nd-order high-pass (RBJ, Q 0.7), in place, circular (the state warms up on the tail first)
function highpass(x, n, f) {
  const w = (TAU * f) / SR, al = Math.sin(w) / 1.4, a0 = 1 + al, cw = Math.cos(w);
  const b0 = (1 + cw) / 2 / a0, b1 = -(1 + cw) / a0, a1 = (-2 * cw) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = n - Math.min(n, 4096); i < n; i++) { const v = x[i], y = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; }
  for (let i = 0; i < n; i++) { const v = x[i], y = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
}
function rms(L, R, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += L[i] * L[i] + R[i] * R[i];
  return Math.sqrt(s / (2 * n)) || 1;
}
function scale(L, R, n, k) {
  for (let i = 0; i < n; i++) { L[i] *= k; R[i] *= k; }
}
function peakNorm(L, R, n, peak) {
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
  if (m > 0) scale(L, R, n, peak / m);
}

// ---------- reactions: choruses of voices sharing one pitch / vowel contour ----------
// spec: dur, n voices, jit (onset spread s), wide (stereo width), f0 [[t, ×pitch]], vow [[t, vowel]], amp [[t, a]],
//   men [lo, hi] / women [lo, hi] base pitch, br (breath), post(L, R, n, r) for claps / whistles / consonants
const RX = {
  cheer: { dur: 2.8, n: 30, jit: 0.1, wide: 1, men: [150, 210], women: [260, 340], br: 0.1,
    f0: [[0, 0.85], [0.1, 1.2], [0.4, 1.28], [1.5, 1.2], [2.6, 1.02]], vow: [[0, "e"], [0.18, "ae"], [0.55, "a"], [2.4, "A"]],
    amp: [[0, 0], [0.08, 1], [1.3, 0.8], [2.7, 0]],
    post(L, R, n, r) { claps(L, R, n, r, { people: 30, rate: 3.6, from: 0.3, to: 2.4, amp: 0.55 }); for (let i = 0; i < 2; i++) whistle(L, R, n, 0.3 + r() * 1.3, 0.05, r); } },
  roar: { dur: 3.8, n: 44, jit: 0.3, wide: 1, men: [140, 220], women: [250, 360], br: 0.12,
    f0: [[0, 0.88], [0.25, 1.2], [0.8, 1.36], [2.2, 1.3], [3.6, 1.05]], vow: [[0, "a"], [0.5, "a"], [1.6, "ae"], [2.6, "a"], [3.6, "A"]],
    amp: [[0, 0], [0.22, 0.8], [0.7, 1], [2.4, 0.85], [3.7, 0]],
    post(L, R, n, r) { claps(L, R, n, r, { people: 40, rate: 3.8, from: 0.5, to: 3.4, amp: 0.6 }); for (let i = 0; i < 3; i++) whistle(L, R, n, 0.4 + r() * 2.2, 0.05, r); } },
  groan: { dur: 2.2, n: 28, jit: 0.1, wide: 1, men: [110, 160], women: [190, 260], br: 0.08,
    f0: [[0, 1.2], [0.3, 1.15], [0.9, 0.95], [2.0, 0.78]], vow: [[0, "o"], [0.55, "a"], [1.4, "A"]],
    amp: [[0, 0], [0.12, 1], [0.6, 0.75], [2.1, 0]] },
  oooh: { dur: 2.0, n: 26, jit: 0.12, wide: 1, men: [110, 160], women: [190, 260], br: 0.06,
    f0: [[0, 0.93], [0.14, 1.0], [0.45, 1.13], [0.95, 1.0], [1.85, 0.8]], vow: [[0, "u"], [0.5, [380, 820, 2300]], [1.2, [430, 780, 2300]]],
    amp: [[0, 0], [0.14, 0.7], [0.45, 1], [1.0, 0.6], [1.9, 0]] },
  // "DE-FENSE!" (clap clap): one 1.75 s cycle, the voices nearly in time
  chant: { dur: 1.75, n: 24, jit: 0.035, wide: 0.9, men: [135, 150], women: [215, 235], br: 0.05,
    f0: [[0, 0.95], [0.06, 1.04], [0.3, 1.0], [0.42, 0.86], [0.62, 0.82], [0.76, 0.8]],
    vow: [[0, [300, 1900, 2700]], [0.08, "i"], [0.34, "i"], [0.44, "e"], [0.64, [500, 1700, 2450]], [0.7, [260, 1500, 2400]]],
    amp: [[0, 0], [0.03, 0], [0.05, 1], [0.23, 0.85], [0.3, 0], [0.44, 0], [0.46, 1], [0.64, 0.8], [0.69, 0.35], [0.76, 0]],
    post(L, R, n, r) {
      hiss(L, R, n, 0.02, 0.03, 0.25, 0, 600, 11); // d
      hiss(L, R, n, 0.37, 0.08, 0.18, 1600, 0, 333); // f
      hiss(L, R, n, 0.73, 0.14, 0.22, 4000, 0, 777); // s
      claps(L, R, n, r, { people: 34, beats: [1.04, 1.3], spread: 0.025, amp: 0.7 });
    } },
};
const clock = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
const vowel = (v) => (typeof v === "string" ? V[v] : v);

export class CrowdBank {
  constructor(seed, onReady) {
    this.r = rng(seed || 22);
    this.onReady = onReady;
    this.steps = [];
    this.i = 0;
    this.ms = 0; // total bake time
    this.landed = [];
    this.planBed();
    for (const name of ["cheer", "roar", "groan", "oooh", "chant"]) this.planChorus(name, RX[name]);
    this.planExtras();
  }
  get done() { return this.i >= this.steps.length; }
  // run queued work for about `ms` milliseconds; true when everything has landed
  work(ms) {
    const t0 = clock();
    while (this.i < this.steps.length) {
      this.steps[this.i++]();
      if (clock() - t0 > ms) break;
    }
    this.ms += clock() - t0;
    return this.done;
  }
  land(name, d) {
    this.landed.push(name);
    if (this.onReady) this.onReady(name, d);
  }

  // ---- the bed: 150 talkers (far / mid / near) on a circular 10 s timeline ----
  planBed() {
    const r = this.r, n = BED_SEC * SR, groups = BED_V.length * 2;
    const G = Array.from({ length: groups }, () => []);
    const talkers = (count, aLo, aHi, width, pLo, pHi) => {
      for (let p = 0; p < count; p++) {
        const g = r() < 0.45 ? 1 : 0;
        const base = g ? 180 + r() * 100 : 110 + r() * 60;
        const amp = aLo + r() * (aHi - aLo), pan = 0.5 + (r() - 0.5) * width;
        let t = r() * n;
        const end = t + n;
        while (t < end) {
          const syl = 2 + Math.floor(r() * 6);
          let pitch = base * (0.95 + r() * 0.12);
          for (let s = 0; s < syl && t < end; s++) {
            const len = Math.floor(SR * (0.08 + r() * 0.22)), f0 = pitch * (0.94 + r() * 0.16);
            const v = Math.floor(r() * BED_V.length);
            G[v * 2 + g].push([Math.floor(t) % n, len, f0, f0 * (0.86 + r() * 0.22), amp * (0.55 + r() * 0.45), pan, 0.04 + r() * 0.08, (r() * NZ) | 0]);
            t += len * (0.85 + r() * 0.35);
            pitch *= 0.97; // declination over an utterance
          }
          t += SR * (pLo + r() * (pHi - pLo)); // breath / listening pause
        }
      }
    };
    talkers(110, 0.13, 0.3, 1, 0.25, 2); // the far stands: density
    talkers(36, 0.3, 0.5, 0.9, 0.2, 1.4); // the section around you
    talkers(14, 0.42, 0.6, 0.85, 0.15, 1); // the rows nearby: the speech-rate flicker (many, none standing out)
    const L = new Float32Array(n), R = new Float32Array(n), sL = new Float32Array(n), sR = new Float32Array(n);
    for (let gi = 0; gi < groups; gi++) {
      const list = G[gi], F = V[BED_V[gi >> 1]], fm = FM[gi & 1];
      const half = list.length >> 1;
      this.steps.push(() => {
        sL.fill(0); sR.fill(0);
        for (let j = 0; j < half; j++) { const s = list[j]; syllable(sL, sR, n, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]); }
      });
      this.steps.push(() => {
        for (let j = half; j < list.length; j++) { const s = list[j]; syllable(sL, sR, n, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]); }
      });
      for (let k = 0; k < 3; k++) {
        this.steps.push(() => formant(sL, L, n, F[k] * fm, BED_Q[k], BED_G[k]));
        this.steps.push(() => formant(sR, R, n, F[k] * fm, BED_Q[k], BED_G[k]));
      }
    }
    // keep the voices' energy in the voice band: a 150 Hz high-pass (circular) under the formants
    this.steps.push(() => highpass(L, n, 150));
    this.steps.push(() => highpass(R, n, 150));
    // faint low body: the stadium's rumble (noise through two one-pole low-passes at 110 Hz, circular), ~24 dB under
    // the voices — one channel per bake step
    const bL = new Float32Array(n), bR = new Float32Array(n), a = 1 - Math.exp((-TAU * 110) / SR);
    for (const b of [bL, bR]) {
      this.steps.push(() => {
        for (let i = 0; i < n; i++) b[i] = r() * 2 - 1;
        let y1 = 0, y2 = 0;
        for (let i = n - 4096; i < n; i++) { y1 += a * (b[i] - y1); y2 += a * (y1 - y2); }
        for (let i = 0; i < n; i++) { y1 += a * (b[i] - y1); y2 += a * (y1 - y2); b[i] = y2; }
      });
    }
    this.steps.push(() => {
      const k = (rms(L, R, n) * 0.063) / rms(bL, bR, n);
      for (let i = 0; i < n; i++) { L[i] += bL[i] * k; R[i] += bR[i] * k; }
      scale(L, R, n, 0.12 / rms(L, R, n)); // bed level: RMS 0.12 (audio.js scales it)
      this.land("bed", { L, R, n });
    });
  }

  // ---- a reaction: n voices, men and women, left and right sources, one formant glide per gender ----
  planChorus(name, S) {
    const r = this.r, n = Math.ceil(S.dur * SR);
    const vow = S.vow.map(([t, v]) => [t, vowel(v)]);
    const src = [0, 1].map(() => [new Float32Array(n), new Float32Array(n)]);
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let v0 = 0; v0 < S.n; v0 += 6) {
      this.steps.push(() => {
        for (let v = v0; v < Math.min(S.n, v0 + 6); v++) {
          const g = r() < 0.45 ? 1 : 0, rg = g ? S.women : S.men;
          chorusVoice(src[g][0], src[g][1], n, {
            t0: r() * S.jit, sc: 0.93 + r() * 0.14, len: S.dur, base: rg[0] + r() * (rg[1] - rg[0]),
            f0: S.f0, amp: S.amp, gain: 0.6 + r() * 0.4, pan: 0.5 + (r() - 0.5) * S.wide, br: S.br, jit: 0.025, ph: r(), nz: (r() * NZ) | 0,
          });
        }
      });
    }
    for (let g = 0; g < 2; g++) for (let side = 0; side < 2; side++) this.steps.push(() => formantsPath(src[g][side], side ? R : L, n, vow, FM[g], RX_Q, RX_G));
    this.steps.push(() => {
      peakNorm(L, R, n, 0.7);
      if (S.post) S.post(L, R, n, r);
      peakNorm(L, R, n, 0.9);
      this.land(name, { L, R, n });
    });
  }

  // ---- extras: single shouts, whistles and clap bursts (segments audio.js picks from at random) ----
  planExtras() {
    const r = this.r, n = Math.ceil(9.6 * SR), L = new Float32Array(n), R = new Float32Array(n), seg = [];
    const shouts = [
      { f0: [[0, 0.9], [0.06, 1.15], [0.3, 1.0]], vow: [[0, "e"], [0.18, "i"]], amp: [[0, 0], [0.03, 1], [0.24, 0.7], [0.34, 0]], d: 0.38, vol: 1 }, // "hey!"
      { f0: [[0, 0.95], [0.1, 1.35], [0.45, 1.25], [0.6, 1.0]], vow: [[0, "u"], [0.6, "u"]], amp: [[0, 0], [0.06, 0.9], [0.45, 0.8], [0.62, 0]], d: 0.66, vol: 0.8 }, // "woo!"
      { f0: [[0, 1.1], [0.15, 1.2], [0.4, 0.92]], vow: [[0, "i"], [0.1, "e"], [0.25, "ae"], [0.45, "A"]], amp: [[0, 0], [0.04, 1], [0.32, 0.7], [0.46, 0]], d: 0.5, vol: 0.9 }, // "yeah!"
      { f0: [[0, 1.0], [0.08, 1.12], [0.32, 0.95]], vow: [[0, "o"], [0.25, "u"]], amp: [[0, 0], [0.03, 1], [0.25, 0.75], [0.36, 0]], d: 0.4, vol: 0.9 }, // "go!"
      { f0: [[0, 1.0], [0.12, 1.08], [0.2, 1.22], [0.5, 1.0]], vow: [[0, "A"], [0.14, "A"], [0.2, "a"], [0.42, [300, 1300, 2400]]], amp: [[0, 0], [0.03, 0.8], [0.12, 0.3], [0.18, 1], [0.44, 0.6], [0.55, 0]], d: 0.58, vol: 0.85 }, // "c'mon!"
    ];
    let t = 0.05;
    const tmp = [0, 1].map(() => [new Float32Array(n), new Float32Array(n)]);
    for (const sh of shouts) {
      const g = r() < 0.4 ? 1 : 0, at = t;
      this.steps.push(() => {
        const s = tmp[g];
        s[0].fill(0); s[1].fill(0);
        chorusVoice(s[0], s[1], n, { t0: at, sc: 1, len: sh.d, base: g ? 250 + r() * 60 : 150 + r() * 40, f0: sh.f0, amp: sh.amp, gain: sh.vol, pan: 0.5, br: 0.1, jit: 0.02, ph: r(), nz: (r() * NZ) | 0 });
        formantsPath(s[0], L, n, sh.vow.map(([tt, v]) => [tt + at, vowel(v)]), FM[g], RX_Q, RX_G);
      });
      seg.push({ off: at, dur: sh.d + 0.08, vol: 0.9 });
      t += sh.d + 0.25;
    }
    this.steps.push(() => {
      peakNorm(L, R, n, 0.5); // the shouts so far (left channel only: audio.js pans each segment)
      for (let i = 0; i < n; i++) R[i] = L[i];
      let tt = t;
      for (let i = 0; i < 2; i++) { whistle(L, R, n, tt, 0.35, r); seg.push({ off: tt, dur: 1.05, vol: 0.55 }); tt += 1.15; }
      // clap bursts: one fan clapping along, then a smattering of a few
      const a = rms(L, R, n) * 6;
      for (let k = 0; k < 6; k++) clap(L, R, n, tt + k * 0.27 + r() * 0.02, a, 1300 + r() * 400, 1.6, 0.5, (r() * NZ) | 0);
      seg.push({ off: tt, dur: 1.75, vol: 0.7 });
      tt += 1.85;
      for (let p = 0; p < 6; p++) { const f = 900 + r() * 1500, pan = r(); for (let k = 0; k < 4 + Math.floor(r() * 4); k++) clap(L, R, n, tt + p * 0.05 + k * (0.24 + r() * 0.06), a * (0.5 + r() * 0.5), f, 1.5, pan, (r() * NZ) | 0); }
      seg.push({ off: tt, dur: 1.6, vol: 0.6 }); // (ends at ~9.6 s: inside the buffer)
      peakNorm(L, R, n, 0.9);
      this.land("extras", { L, R, n, seg });
    });
  }
}
