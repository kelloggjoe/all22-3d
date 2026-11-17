// ALL-22 PRO audio: a 16-bit broadcast in WebAudio, all synthesized (no files).
//   Graph: voices → music / sfx buses → master gain → compressor → speakers. Volumes (master / music / sfx) persist in
//   `all22pro-audio-v1`, mute in `all22pro-muted`. Every one-shot voice disconnects itself when it ends (live-voice
//   accounting in stats(); the crowd bed and buses are the only persistent nodes), so long autoplay runs never leak.
//   Music: a lookahead step sequencer (tick() each frame) playing original chiptune pieces — "Under the Lights" (menu),
//   "Route to Indigo" (league map), "Hall of Fame", "Training Center" (the hub), "Pfeffer's Theme" (the rival),
//   "Under the Lights: Two-Minute Drill" (a game's final two minutes) — with pulse (12.5/25/50 %), triangle, brass, organ and drum voices.
//   Match sound: attach(bus, w, app) subscribes to the match bus — QB "HUT", whistles, kick thumps, hit-stick booms,
//   PA horn on touchdowns, organ riffs, a home crowd that cheers or groans depending on who benefits, a "DE-FENSE!"
//   chant on the opponent's 3rd downs, replay tape whooshes, badge jingles. Menus call sfx(name) directly.
//   The crowd is PEOPLE, not noise: audio-crowd.js bakes (once, time-sliced in tick()) a 10 s stereo "walla" loop of
//   thousands of short vowel syllables, voice-chorus reactions and single shouts / whistles / clap bursts; the crowd
//   section below plays them (bed level by match situation, voice-like lifts on big plays, random sparse shouts).
// Public API: installUnlock() · unlock(force) · setMuted(m) · muted · setVolume(kind, v) · getVolume(kind) · volumes ·
//   music(on|track) · track · sfx(name, k) · evolution(on|times) · swell(v, dur) · crowdLevel(v) · react(kind, k) · chant(on) · tick() ·
//   attach(bus, w, app) · stats().
import { CrowdBank, CROWD_SR } from "./audio-crowd.js";
const MUTE_KEY = "all22pro-muted";
// recorded clips (the repo's audio/): fetched and decoded once there's a context; clip(name) plays one
const CLIPS = {}; // (ALL-22 3D ships no recorded clips: clip() plays nothing, every synthesized cue still plays)
const VOL_KEY = "all22pro-audio-v1";
const A4 = 440;
const NOTE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
// "C#5" → Hz
export function hz(n) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) return 0;
  const semi = NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return A4 * Math.pow(2, semi / 12);
}
const midiHz = (m) => A4 * Math.pow(2, (m - 69) / 12);
// crowd levels: the bed's level gain = tick()'s situation target (0.018 paused … 0.18 a loud 3rd down) × CROWD_K;
// sparse extras ride the same level; reactions / chant go straight to the sfx bus at RX_VOL.
const CROWD_K = 0.78; // the walla bed sits ~2 dB (RMS) under the old noise bed at the same target — darker, so quieter still
const EXTRA_VOL = 0.3;
const RX_VOL = { cheer: 0.42, roar: 0.4, groan: 0.3, oooh: 0.3, chant: 0.16 };
const CHORD_Q = { "": [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7], dim: [0, 3, 6] };
// "Em" / "B7" / "G/B" → { root midi (octave 3), tones[], bass midi }
function chord(name) {
  const [main, over] = name.split("/");
  const m = /^([A-G])([#b]?)(.*)$/.exec(main);
  const pc = (l, acc) => (NOTE[l] + 9 + (acc === "#" ? 1 : acc === "b" ? -1 : 0) + 12) % 12;
  const root = 48 + pc(m[1], m[2]);
  const tones = (CHORD_Q[m[3]] || CHORD_Q[""]).map((i) => root + i);
  let bass = root - 12;
  if (over) { const o = /^([A-G])([#b]?)$/.exec(over); bass = 36 + pc(o[1], o[2]); if (bass > root - 6) bass -= 12; }
  return { root, tones, bass };
}

// ---------- the music ----------
// Each song: step = a 16th note (stepDur s), bar = `bar` steps; lead tokens are `res` steps each ("-" holds, "." rests).
// Bass, harmony and drums are generated per chord from the song's patterns.
const SONGS = {
  // "Under the Lights" — the title theme: driving rock in E minor, brass stabs in the second half.
  menu: {
    bpm: 140, bar: 16, res: 2, swing: 0,
    chords: ["Em", "C", "G", "D", "Em", "C", "Am", "B7", "C", "D", "Bm", "Em", "C", "D", "G", "B7"],
    lead: [
      "E5 . G5 . B5 - A5 G5", "E5 - - - . . D5 E5", "G5 . B5 . D6 - C6 B5", "A5 - - - . . F#5 A5",
      "B5 . A5 G5 E5 . G5 A5", "B5 - C6 - B5 - G5 -", "A5 . G5 . E5 . C5 .", "D#5 - F#5 - B5 - A5 -",
      "G5 - - E5 G5 - C6 -", "A5 - - F#5 A5 - D6 -", "B5 - A5 - F#5 - D5 -", "E5 - - - G5 - B5 -",
      "C6 - B5 - A5 - G5 -", "F#5 - G5 - A5 - D6 -", "B5 - - - D6 - - -", "D#6 - B5 - F#5 - D#5 -",
    ],
    leadInst: "pulse25", leadVol: 0.11,
    bass: [[0, 0], [2, 12], [4, 0], [6, 12], [8, 7], [10, 12], [12, 0], [14, 7]], bassInst: "tri", bassVol: 0.2, bassLen: 1.6,
    arp: { steps: 1, pattern: [0, 1, 2, 3, 2, 1], inst: "pulse12", vol: 0.035, octave: 12 },
    stabs: { bars: [0, 4, 8, 9, 10, 11, 12, 13, 14, 15], steps: [0, 10], inst: "brass", vol: 0.07 },
    drums: (bar, st) => {
      const fill = bar % 8 === 7;
      let o = "";
      if (st === 0 || st === 8 || st === 10 || (st === 3 && bar % 2)) o += "k";
      if (st === 4 || st === 12 || (fill && st >= 12)) o += "s";
      if (st % 2 === 0 && !(fill && st >= 12)) o += st === 14 ? "o" : "h";
      if (st === 0 && bar % 8 === 0) o += "c";
      return o;
    },
  },
  // "Route to Indigo" — the league map: a lilting 6/8 travel tune in G.
  league: {
    bpm: 92 * 3 / 2, bar: 12, res: 2, swing: 0,
    chords: ["G", "Em", "C", "D", "G", "Bm", "C", "D", "Am", "D", "G", "Em", "Am", "C", "D", "D7"],
    lead: [
      "D5 - B4 D5 - G5", "E5 - - D5 - B4", "C5 - E5 G5 - E5", "F#5 - - A5 - -",
      "G5 - D5 B4 - D5", "F#5 - D5 B4 - A4", "E5 - C5 G4 - C5", "D5 - - - . .",
      "A4 - C5 E5 - C5", "D5 - F#5 A5 - F#5", "B5 - A5 G5 - D5", "E5 - G5 B5 - -",
      "C6 - B5 A5 - E5", "G5 - E5 C5 - E5", "F#5 - A5 D6 - C6", "A5 - F#5 D5 - C5",
    ],
    leadInst: "pulse25v", leadVol: 0.1,
    bass: [[0, 0], [6, 7], [10, 12]], bassInst: "tri", bassVol: 0.21, bassLen: 1.5,
    chordHits: { steps: [2, 4, 8, 10], inst: "pulse12", vol: 0.04, len: 0.09 },
    drums: (bar, st) => {
      let o = "";
      if (st === 0) o += "k";
      if (st % 2 === 0) o += "z";
      if (st === 6) o += "t";
      if (st === 0 && bar % 8 === 0) o += "c";
      return o;
    },
  },
  // "Hall of Fame" — a slow brass anthem in C with timpani.
  hof: {
    bpm: 84, bar: 16, res: 4, swing: 0,
    chords: ["C", "G/B", "Am", "F", "C", "F", "G", "C"],
    lead: ["G4 C5 E5 G5", "G5 - F5 D5", "E5 - C5 A4", "F5 - - -", "E5 G5 C6 -", "A5 - F5 A5", "G5 - D5 B4", "C5 - - -"],
    leadInst: "brass", leadVol: 0.12,
    bass: [[0, 0], [8, 7]], bassInst: "tri", bassVol: 0.22, bassLen: 7,
    pad: { inst: "pulse12", vol: 0.03 },
    drums: (bar, st) => {
      let o = "";
      if (st === 0) o += "T";
      if (bar === 7 && st >= 8 && st % 2 === 0) o += "T";
      if (st === 0 && bar === 0) o += "c";
      return o;
    },
  },
  // "Training Center" — the hub between games: a bouncy home-base tune in C, offbeat chords like a town on a sunny day.
  center: {
    bpm: 126, bar: 16, res: 2, swing: 0,
    chords: ["C", "Am", "F", "G", "C", "Am", "Dm7", "G7", "F", "G", "Em", "Am", "F", "G7", "C", "G7"],
    lead: [
      "C5 E5 G5 - E5 - C5 -", "A4 C5 E5 - C5 - A4 -", "F5 - E5 F5 A5 - F5 -", "G5 - - - D5 - . .",
      "E5 G5 C6 - B5 - G5 -", "A5 - G5 E5 C5 - E5 -", "D5 F5 A5 - C6 - A5 -", "B5 - - - G5 - . .",
      "A5 - G5 - F5 - A5 -", "B5 - A5 - G5 - B5 -", "G5 - E5 - B4 - E5 -", "C6 - B5 A5 E5 - . .",
      "F5 A5 C6 - A5 - F5 -", "G5 B5 D6 - B5 - F5 -", "E5 - G5 - C6 - - -", "D5 - B4 - G4 - . .",
    ],
    leadInst: "pulse25v", leadVol: 0.1,
    bass: [[0, 0], [4, 7], [8, 12], [12, 7]], bassInst: "tri", bassVol: 0.2, bassLen: 1.8,
    chordHits: { steps: [2, 6, 10, 14], inst: "pulse12", vol: 0.035, len: 0.08 },
    drums: (bar, st) => {
      let o = "";
      if (st === 0 || st === 8 || (st === 14 && bar % 4 === 3)) o += "k";
      if (st === 4 || st === 12) o += "s";
      if (st % 2 === 0) o += "h";
      if (st === 0 && bar % 8 === 0) o += "c";
      return o;
    },
  },
  // "Pfeffer's Theme" — the rival: a cocky, strutting D minor with a pumping bass and brass shoving in.
  rival: {
    bpm: 156, bar: 16, res: 2, swing: 0,
    chords: ["Dm", "Dm", "Bb", "A7", "Dm", "Dm", "Gm", "A7", "Bb", "C", "Am", "Dm", "Bb", "C", "A7", "A7"],
    lead: [
      "D5 . D5 F5 A5 - G5 F5", "E5 F5 E5 D5 C#5 - A4 -", "D5 . D5 F5 Bb5 - A5 G5", "A5 - - - C#6 - E6 -",
      "F6 - E6 D6 A5 - F5 -", "G5 F5 E5 F5 D5 - . .", "Bb5 - A5 G5 D5 - G5 -", "C#6 - - - A5 - E5 -",
      "F5 - Bb5 - D6 - Bb5 -", "E5 - G5 - C6 - G5 -", "A5 - C6 - E6 - C6 -", "D6 - - - A5 - F5 -",
      "D6 C6 Bb5 A5 G5 - F5 -", "E5 F5 G5 A5 Bb5 - C6 -", "C#6 - - - E6 - - -", "A5 G5 F5 E5 C#5 - A4 -",
    ],
    leadInst: "pulse25", leadVol: 0.11,
    bass: [[0, 0], [2, 12], [4, 0], [6, 12], [8, 0], [10, 12], [12, 0], [14, 12]], bassInst: "tri", bassVol: 0.2, bassLen: 1.4,
    stabs: { bars: [3, 7, 11, 14, 15], steps: [0, 6, 12], inst: "brass", vol: 0.07 },
    drums: (bar, st) => {
      const fill = bar % 4 === 3 && st >= 12;
      let o = "";
      if (st === 0 || st === 6 || st === 8) o += "k";
      if (st === 4 || st === 12 || (fill && st % 2 === 0)) o += "s";
      if (!fill && st % 2 === 0) o += st === 14 ? "o" : "h";
      if (st === 0 && bar % 4 === 0) o += "c";
      return o;
    },
  },
};
// "Under the Lights: Two-Minute Drill" — the title theme with the clock running out: up a whole step, faster, the bass
// pumping eighths, brass on every bar, a hat on every sixteenth and a snare roll into every fourth bar.
SONGS.clutch = {
  ...SONGS.menu,
  bpm: 168, transpose: 2,
  leadInst: "pulse25", leadVol: 0.115,
  bass: [[0, 0], [2, 0], [4, 12], [6, 0], [8, 0], [10, 12], [12, 0], [14, 7]], bassInst: "tri", bassVol: 0.21, bassLen: 1.1,
  arp: { steps: 1, pattern: [0, 1, 2, 3, 2, 1], inst: "pulse12", vol: 0.04, octave: 12 },
  stabs: { bars: [...Array(16).keys()], steps: [0, 6, 10], inst: "brass", vol: 0.065 },
  drums: (bar, st) => {
    const roll = bar % 4 === 3 && st >= 8;
    let o = "";
    if (st === 0 || st === 3 || st === 6 || st === 8 || st === 11) o += "k";
    if (st === 4 || st === 12 || roll) o += "s";
    if (!roll) o += st === 14 ? "o" : "h";
    if (st === 0 && bar % 4 === 0) o += "c";
    return o;
  },
};
// Stingers: short scored phrases [note, length in 16ths, (optional) harmony note]
const STINGS = {
  wheelWin: { bpm: 220, inst: "pulse25", harm: "pulse12", notes: [["E5", 1, "C5"], ["G5", 1, "E5"], ["C6", 3, "G5"]], bass: ["C3", 5] },
  wheelBig: { bpm: 210, inst: "pulse25", harm: "pulse12", notes: [["C5", 1, "G4"], ["E5", 1, "C5"], ["G5", 1, "E5"], ["C6", 1, "G5"], ["E6", 1, "C6"], ["G6", 5, "E6"]], bass: ["C3", 10] },
  cardRare: { bpm: 240, inst: "pulse25", harm: "pulse12", notes: [["G5", 1, "D5"], ["B5", 1, "G5"], ["D6", 1, "B5"], ["G6", 4, "D6"]], bass: ["G3", 7] },
  cardUltra: { bpm: 170, inst: "brass", harm: "pulse25", notes: [["C5", 1, "G4"], ["E5", 1, "C5"], ["G5", 1, "E5"], ["C6", 1, "G5"], ["E6", 1, "C6"], ["G6", 1, "E6"], ["C7", 7, "G6"]], bass: ["C3", 13], timp: true },
  badge: { bpm: 150, inst: "pulse25", harm: "pulse12", notes: [["G5", 1, "D5"], ["A5", 1, "E5"], ["B5", 1, "G5"], ["D6", 2, "B5"], ["B5", 1, "G5"], ["D6", 1, "B5"], ["G6", 6, "D6"]], bass: ["G3", 13] },
  fanfare: { bpm: 160, inst: "brass", harm: "pulse25", notes: [["C5", 1, "G4"], ["E5", 1, "C5"], ["G5", 1, "E5"], ["C6", 3, "G5"], ["G5", 1, "E5"], ["C6", 1, "G5"], ["E6", 6, "C6"]], bass: ["C3", 14] },
  champion: { bpm: 132, inst: "brass", harm: "pulse25", notes: [["G4", 2, "D4"], ["C5", 2, "G4"], ["E5", 2, "C5"], ["G5", 4, "E5"], ["E5", 1, "C5"], ["G5", 1, "E5"], ["C6", 4, "G5"], ["D6", 2, "B5"], ["E6", 8, "C6"]], bass: ["C3", 26], timp: true },
  victory: { bpm: 168, inst: "brass", harm: "pulse25", notes: [["E5", 1, "C5"], ["G5", 1, "E5"], ["C6", 2, "G5"], [".", 1], ["G5", 1, "E5"], ["C6", 1, "G5"], ["E6", 6, "C6"]], bass: ["C3", 13] },
  defeat: { bpm: 96, inst: "brass", harm: null, notes: [["A4", 2], ["G#4", 2], ["G4", 2], ["F#4", 6]], bass: ["D3", 12], droop: true },
  tdfanfare: { bpm: 176, inst: "brass", harm: "pulse25", notes: [["C5", 1, "G4"], ["C5", 1, "G4"], ["G5", 2, "E5"], ["E5", 1, "C5"], ["G5", 1, "E5"], ["C6", 5, "G5"]], bass: ["C3", 11] },
  halftime: { bpm: 150, inst: "pulse25", harm: "pulse12", notes: [["G4", 1, "E4"], ["C5", 1, "G4"], ["E5", 1, "C5"], ["G5", 3, "E5"], ["F5", 1, "D5"], ["E5", 1, "C5"], ["D5", 1, "B4"], ["C5", 4, "G4"]], bass: ["C3", 13] },
  organ: { bpm: 152, inst: "organ", harm: "organ", notes: [["A4", 1, "E4"], ["C5", 1, "A4"], ["E5", 1, "C5"], ["A5", 2, "E5"], ["G5", 1, "E5"], ["E5", 1, "C5"], ["G5", 1, "D5"], ["A5", 4, "E5"]] },
  // Scout Challenges (scout-game.js): a new one (a bright two-bar call), cleared (a climbing run to a held top note),
  // failed (a trombone-ish slide down)
  chalNew: { bpm: 200, inst: "pulse25", harm: "pulse12", notes: [["E5", 1, "C5"], ["G5", 1, "E5"], ["C6", 2, "G5"], [".", 1], ["C6", 1, "G5"], ["C6", 1, "A5"], ["D6", 1, "B5"], ["E6", 4, "C6"]], bass: ["C3", 12] },
  chalWin: { bpm: 190, inst: "pulse25", harm: "pulse12", notes: [["C5", 1, "G4"], ["D5", 1, "A4"], ["E5", 1, "C5"], ["G5", 1, "E5"], ["C6", 1, "G5"], ["E6", 1, "C6"], ["G6", 6, "E6"]], bass: ["C3", 12] },
  chalFail: { bpm: 110, inst: "brass", harm: null, notes: [["G4", 2], ["F#4", 2], ["F4", 2], ["E4", 8]], bass: ["C3", 14], droop: true },
  // the world map (world-map.js): a flag climbs its pole, then the next Gym opens
  flagUp: { bpm: 240, inst: "pulse25", harm: "pulse12", notes: [["C5", 1, "G4"], ["D5", 1, "A4"], ["E5", 1, "B4"], ["F5", 1, "C5"], ["G5", 1, "D5"], ["A5", 1, "E5"], ["B5", 1, "F5"], ["C6", 2, "G5"], [".", 1], ["G5", 1, "E5"], ["C6", 6, "G5"]], bass: ["C3", 16] },
  gymOpen: { bpm: 200, inst: "pulse25", harm: "pulse12", notes: [["G5", 1, "E5"], ["C6", 1, "G5"], ["E6", 1, "C6"], ["G6", 1, "E6"], ["E6", 1, "C6"], ["G6", 5, "E6"]] },
  arrive: { bpm: 220, inst: "pulse25", harm: null, notes: [["C6", 1], ["E6", 1], ["G6", 2]] },
};

// ---------- getting the sound out ----------
// Browsers let audio start only inside a user gesture (a click, a key press). installUnlock() watches GESTURES on
// window, capture phase, passive: the context is created / resumed and kick()'s one-sample silent buffer played
// synchronously inside the gesture, before any game handler runs and plays its first blip. Every later gesture re-tries
// while the context isn't 'running'. A hidden page suspends the context (syncVisibility); it comes back on return.
const GESTURES = ["pointerup", "click", "keydown"];
const quiet = (p) => { if (p && p.catch) p.catch(() => {}); }; // resume()/suspend() may reject
// resume a context that isn't running + play a one-sample silent buffer (call it synchronously inside a gesture)
function kick(ctx) {
  if (!ctx || ctx.state === "closed") return;
  if (ctx.state !== "running") quiet(ctx.resume());
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.onended = () => src.disconnect();
    src.start(0);
  } catch (_) { /* a context mid-close */ }
}
// the page's audio session where the browser has one (navigator.audioSession): 'playback' while the sound is on,
// 'auto' (mixable) while it's off
class Session {
  constructor() { this.want = false; }
  setType(type) {
    try { const s = typeof navigator !== "undefined" ? navigator.audioSession : null; if (s && s.type !== type) s.type = type; } catch (_) { /* read-only build */ }
  }
  claim() { this.want = true; this.setType("playback"); }
  release() { this.want = false; this.setType("auto"); }
  hide() {}
  show() {}
  get stalled() { return false; }
  stats() { const s = typeof navigator !== "undefined" ? navigator.audioSession : null; return { claimed: this.want, type: s ? s.type : "n/a" }; }
}

export class Audio {
  constructor() {
    this.ctx = null; this.master = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (_) { /* private mode */ }
    this.vol = { master: 0.8, music: 0.6, sfx: 0.9 };
    try { const v = JSON.parse(localStorage.getItem(VOL_KEY) || "null"); if (v) for (const k of ["master", "music", "sfx"]) if (Number.isFinite(v[k])) this.vol[k] = Math.max(0, Math.min(1, v[k])); } catch (_) { /* ignore */ }
    this.track = null; this.want = null; // current / requested music track
    this.song = null; this.step = 0; this.nextT = 0; this.trackGain = null;
    this.evolutionGain = null;
    this.crowd = null; this.crowdTarget = 0; this.crowdSet = -1; this.chantOn = false; this.chantNext = 0;
    this.lastAt = new Map();
    this.n = { created: 0, ended: 0, live: 0, peak: 0, skipped: 0 };
    this.app = null; this.w = null;
    this.compiled = {};
    this.session = new Session();
    this.unlockAt = -1e9; this.autoResumeAt = -1e9; this.ran = false; this.unlocks = 0;
    // A hidden tab stops requestAnimationFrame, so tick() (the only thing that moves the crowd bed and the music
    // scheduler) stops too and the looping crowd noise would roar on at its last live level. Suspend the whole
    // context while hidden; resume on return unless muted (setMuted(false) resumes then). tick()'s catch-up guard
    // keeps the sequencer from bursting the steps it missed.
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => this.syncVisibility());
  }
  syncVisibility() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed") return;
    if (document.hidden) { if (ctx.state === "running") quiet(ctx.suspend()); }
    else if (!this.muted && ctx.state !== "running") quiet(ctx.resume()); // 'suspended' (or 'interrupted')
  }
  // gestures that may start audio, on window in the capture phase (main.js calls this once; see the note above
  // Session for why these and not pointerdown)
  installUnlock() {
    if (typeof window === "undefined") return;
    const fn = () => {
      const c = this.ctx;
      if (c && c.state === "running" && (this.muted || (this.session.want && !this.session.stalled))) return; // common case: all set
      if (this.waiting) this.wokeAt = performance.now(); // (this press starts the sound: main.js toggleMute)
      this.unlock();
    };
    for (const ev of GESTURES) window.addEventListener(ev, fn, { capture: true, passive: true });
  }
  // an 'interrupted' context or a suspend we didn't ask for, while visible and unmuted:
  // resume straight away (allowed once a gesture has started the context); the next gesture re-tries anyway
  onState() {
    const c = this.ctx;
    if (this.app && this.app.ui && this.app.ui.syncMute) this.app.ui.syncMute(); // (the HUD's note: waiting or not)
    if (c.state === "running") { this.ran = true; return; }
    if (c.state === "closed" || this.muted || document.hidden) return;
    if (!this.ran && performance.now() - this.unlockAt > 5000) return; // never started by a gesture: nothing to restore
    const now = performance.now();
    if (now - this.autoResumeAt < 1000) return;
    this.autoResumeAt = now;
    quiet(c.resume());
  }
  // Sound on but not playing yet: nothing has been tapped or pressed on this page (a browser starts a page's sound only
  // with that), as when Franchise opens a game here (QA, Discord: a watched game was silent until the note was pressed
  // twice, off and on again). The HUD's note says so (ui.js syncMute), its first press starts the sound rather than
  // turning it off (main.js toggleMute), and a Franchise game that begins this way says to tap (franchise.js).
  get waiting() { const c = this.ctx; return !this.muted && !(c && (c.state === "running" || performance.now() - this.unlockAt < 600)); }
  // sounds go only into a running context, or one resuming inside this very gesture (so the first menu tap is
  // heard): a suspended / interrupted context would bank them and fire them all at once when it resumes
  live() {
    const c = this.ctx;
    return Boolean(c) && !this.muted && (c.state === "running" || ((c.state === "suspended" || c.state === "interrupted") && performance.now() - this.unlockAt < 600));
  }
  // ---------- setup ----------
  // Safe to call from anywhere (every input calls it); it can only *start* sound inside a gesture (see above).
  // force: create the context even before any user activation (test harnesses running with an autoplay policy).
  unlock(force = false) {
    if (!this.ctx && !force) { const ua = typeof navigator !== "undefined" && navigator.userActivation; if (ua && !ua.hasBeenActive) return; } // pre-gesture: it would only start suspended
    const hidden = typeof document !== "undefined" && document.hidden;
    // the session first ('playback'), so the context starts inside it
    if (!this.muted && !hidden) this.session.claim();
    if (this.ctx) {
      if (this.ctx.state !== "running" && this.ctx.state !== "closed" && !hidden) { this.unlockAt = performance.now(); this.unlocks++; kick(this.ctx); }
      return;
    }
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    let ctx;
    try { ctx = new AC({ latencyHint: "interactive" }); } catch (_) { ctx = new AC(); }
    this.ctx = ctx;
    this.unlockAt = performance.now(); this.unlocks++;
    kick(ctx); // resume + a one-sample silent buffer, inside the gesture
    ctx.addEventListener("statechange", () => this.onState());
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 10; this.comp.ratio.value = 4.5; this.comp.attack.value = 0.004; this.comp.release.value = 0.22;
    this.master = ctx.createGain();
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.applyVolumes(true);
    this.loadClips();
    // shared buffers + waveforms
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let s = 7;
    for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
    const pulse = (duty) => {
      const N = 40, re = new Float32Array(N), im = new Float32Array(N);
      for (let k = 1; k < N; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      return ctx.createPeriodicWave(re, im);
    };
    this.waves = { pulse12: pulse(0.125), pulse25: pulse(0.25), pulse50: pulse(0.5) };
    { const N = 12, re = new Float32Array(N), im = new Float32Array(N); [[1, 1], [2, 0.75], [3, 0.5], [4, 0.42], [6, 0.3], [8, 0.22]].forEach(([k, a]) => { im[k] = a; }); this.waves.organ = ctx.createPeriodicWave(re, im); }
    this.shaper = ctx.createWaveShaper();
    { const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 3); } this.shaper.curve = c; }
    this.shaper.connect(this.sfxBus); // persistent distortion send for the hit-stick boom
    this.startCrowd();
    if (this.want) this.music(this.want, this.wantLevel);
  }
  applyVolumes(now) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (p, v) => { p.cancelScheduledValues(t); if (now) p.setValueAtTime(v, t); else p.setTargetAtTime(v, t, 0.03); };
    set(this.master.gain, this.muted ? 0 : this.vol.master * 0.9);
    set(this.musicBus.gain, this.vol.music * 0.8);
    set(this.sfxBus.gain, this.vol.sfx);
  }
  setMuted(m) {
    this.muted = Boolean(m);
    try { localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0"); } catch (_) { /* ignore */ }
    // sound off hands the audio session back (the player's own music may play on); sound on claims it again
    if (this.muted) this.session.release(); else if (this.ctx) this.session.claim();
    this.applyVolumes(false);
    if (!this.muted && typeof document !== "undefined") this.syncVisibility(); // left suspended by a hide while muted
  }
  // kind: "master" | "music" | "sfx", v 0..1 (persisted)
  setVolume(kind, v) {
    if (!(kind in this.vol)) return;
    this.vol[kind] = Math.max(0, Math.min(1, Number(v) || 0));
    try { localStorage.setItem(VOL_KEY, JSON.stringify(this.vol)); } catch (_) { /* ignore */ }
    this.applyVolumes(false);
  }
  getVolume(kind) { return this.vol[kind]; }
  get volumes() { return { ...this.vol }; }
  stats() {
    const b = this.crowdBake;
    return { ...this.n, track: this.track, ctx: this.ctx ? this.ctx.state : "none", crowd: +(this.crowdSet || 0).toFixed(3), unlocks: this.unlocks, session: this.session.stats(),
      crowdBank: b ? { landed: b.landed.length, done: b.done, ms: Math.round(b.ms) } : null };
  }

  // ---------- voices (every one disconnects itself on end) ----------
  // a voice counts as live until it ends. Its onended can fail to come (WebKit doesn't play a voice cut off from the
  // speakers, so it never ends): then a timer a beat past its stop time lets it go, or the count would climb to room()'s
  // cap and every sound after it would be refused (the evolution scene's skip left the game silent)
  track_(src, nodes, endT) {
    this.n.created++; this.n.live++; if (this.n.live > this.n.peak) this.n.peak = this.n.live;
    let gone = false;
    const done = () => { if (gone) return; gone = true; this.n.ended++; this.n.live--; for (const nd of nodes) { try { nd.disconnect(); } catch (_) { /* already */ } } };
    src.onended = done;
    if (endT != null && this.ctx) setTimeout(done, Math.max(0, endT - this.ctx.currentTime) * 1000 + 1500);
  }
  loadClips() {
    this.clips = this.clips || {};
    for (const [name, url] of Object.entries(CLIPS)) {
      if (name in this.clips) continue;
      this.clips[name] = null;
      fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((b) => new Promise((ok, no) => this.ctx.decodeAudioData(b, ok, no)))
        .then((buf) => { this.clips[name] = buf; }, () => { /* no clip: the moment goes by without it */ });
    }
  }
  // a recorded clip on the sfx bus; its length in seconds, or 0 if it can't play (not loaded, muted, no context)
  clip(name, vol = 1, delay = 0) {
    const buf = this.clips && this.clips[name];
    if (!buf || !this.live()) return 0;
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain(), t = ctx.currentTime + 0.01 + delay;
    src.buffer = buf; g.gain.value = vol; src.connect(g); g.connect(this.sfxBus);
    src.start(t); this.track_(src, [src, g], t + buf.duration);
    return buf.duration;
  }
  room(pri = 1) { if (this.n.live > (pri > 1 ? 90 : 60)) { this.n.skipped++; return false; } return true; }
  osc(type, freq, t, dur, vol, dest, opt = {}) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    if (this.waves[type]) o.setPeriodicWave(this.waves[type]); else o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opt.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.slide), t + (opt.slideT || dur));
    if (opt.vib) { /* gentle vibrato via a detune ramp pair */ o.detune.setValueAtTime(0, t + 0.12); o.detune.linearRampToValueAtTime(opt.vib, t + 0.2); o.detune.linearRampToValueAtTime(-opt.vib, t + 0.32); o.detune.linearRampToValueAtTime(0, t + 0.44); }
    const a = opt.attack || 0.004, rel = opt.release || 0.06, sus = opt.sustain != null ? opt.sustain : 0.7;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setTargetAtTime(vol * sus, t + a, opt.decay || 0.08);
    g.gain.setTargetAtTime(0.0001, t + Math.max(a, dur - rel * 0.5), rel / 3);
    let last = g;
    const nodes = [o, g];
    if (opt.filter) {
      const f = ctx.createBiquadFilter(); f.type = opt.filter.type || "lowpass"; f.Q.value = opt.filter.q || 0.8;
      f.frequency.setValueAtTime(opt.filter.f0, t);
      if (opt.filter.f1) f.frequency.exponentialRampToValueAtTime(opt.filter.f1, t + (opt.filter.t1 || 0.05));
      if (opt.filter.f2) f.frequency.exponentialRampToValueAtTime(opt.filter.f2, t + Math.max(0.06, dur));
      g.connect(f); last = f; nodes.push(f);
    }
    o.connect(g); last.connect(dest || this.sfxBus);
    o.start(t); o.stop(t + dur + rel + 0.05);
    this.track_(o, nodes, t + dur + rel + 0.05);
  }
  noise(dur, vol, freq, q = 1, t = 0, type = "bandpass", dest = null, opt = {}) {
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    t = t || ctx.currentTime;
    src.buffer = this.noiseBuf; src.loop = dur > 0.4;
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
    if (opt.sweep) f.frequency.exponentialRampToValueAtTime(opt.sweep, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + (opt.attack || 0.003));
    if (opt.hold) g.gain.setValueAtTime(vol, t + opt.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.sfxBus);
    src.start(t, (this.n.created * 0.137) % 1.5); src.stop(t + dur + 0.03);
    this.track_(src, [src, f, g], t + dur + 0.03);
  }
  // a formant "voice" (HUT / crowd chant syllables): a buzzy source through two vowel formants
  vowel(t, dur, pitch, f1, f2, vol, voices = 1, dest = null) {
    const ctx = this.ctx;
    const g = ctx.createGain(), b1 = ctx.createBiquadFilter(), b2 = ctx.createBiquadFilter();
    b1.type = "bandpass"; b1.frequency.value = f1; b1.Q.value = 6;
    b2.type = "bandpass"; b2.frequency.value = f2; b2.Q.value = 8;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.setValueAtTime(vol, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    b1.connect(g); b2.connect(g); g.connect(dest || this.sfxBus);
    const shared = [g, b1, b2];
    let left = voices;
    for (let i = 0; i < voices; i++) {
      const o = ctx.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(pitch * (1 + (i - voices / 2) * 0.031), t);
      o.frequency.linearRampToValueAtTime(pitch * (0.92 + i * 0.01), t + dur);
      o.connect(b1); o.connect(b2);
      o.start(t + i * 0.008); o.stop(t + dur + 0.03);
      this.n.created++; this.n.live++;
      let gone = false; // (and a timer, if its onended never comes: track_)
      const done = () => { if (gone) return; gone = true; this.n.ended++; this.n.live--; o.disconnect(); if (--left === 0) for (const nd of shared) nd.disconnect(); };
      o.onended = done; setTimeout(done, Math.max(0, t + dur + 0.03 - ctx.currentTime) * 1000 + 1500);
    }
  }
  ok(name, cool) {
    const now = this.ctx.currentTime, last = this.lastAt.get(name) || -9;
    if (now - last < cool) return false;
    this.lastAt.set(name, now);
    return true;
  }

  // ---------- music ----------
  compile(name) {
    if (this.compiled[name]) return this.compiled[name];
    const S = SONGS[name];
    const stepDur = 60 / S.bpm / 4;
    const tr = S.transpose || 0, up = Math.pow(2, tr / 12); // (a song played in another key: semitones)
    const len = S.bar * S.chords.length;
    const steps = Array.from({ length: len }, () => []);
    // lead
    S.lead.forEach((barStr, bi) => {
      const toks = barStr.trim().split(/\s+/);
      toks.forEach((tk, i) => {
        if (tk === "-" || tk === ".") return;
        let n = 1;
        while (toks[i + n] === "-") n++;
        steps[bi * S.bar + i * S.res].push({ inst: S.leadInst, f: hz(tk) * up, dur: n * S.res * stepDur * 0.92, vol: S.leadVol, lead: true });
      });
    });
    S.chords.forEach((cn, bi) => {
      const c0 = chord(cn), c = { root: c0.root + tr, bass: c0.bass + tr, tones: c0.tones.map((m) => m + tr) }, base = bi * S.bar;
      for (const [st, iv] of S.bass) steps[base + st].push({ inst: S.bassInst, f: midiHz(c.bass + iv), dur: stepDur * S.bassLen * (S.bar === 12 ? 1.2 : 1), vol: S.bassVol });
      if (S.arp) for (let st = 0; st < S.bar; st += S.arp.steps) { const p = S.arp.pattern[(st / S.arp.steps) % S.arp.pattern.length]; const tone = c.tones[p % c.tones.length] + (p >= c.tones.length ? 12 : 0) + S.arp.octave; steps[base + st].push({ inst: S.arp.inst, f: midiHz(tone), dur: stepDur * 0.8, vol: S.arp.vol }); }
      if (S.chordHits) for (const st of S.chordHits.steps) for (const tn of c.tones.slice(0, 3)) steps[base + st].push({ inst: S.chordHits.inst, f: midiHz(tn + 12), dur: S.chordHits.len, vol: S.chordHits.vol });
      if (S.stabs && S.stabs.bars.includes(bi)) for (const st of S.stabs.steps) for (const tn of c.tones.slice(0, 3)) steps[base + st].push({ inst: S.stabs.inst, f: midiHz(tn + 12), dur: stepDur * 2.2, vol: S.stabs.vol });
      if (S.pad) for (const tn of c.tones.slice(0, 3)) steps[base].push({ inst: S.pad.inst, f: midiHz(tn + 12), dur: stepDur * S.bar * 0.96, vol: S.pad.vol });
      for (let st = 0; st < S.bar; st++) { const dr = S.drums(bi, st); if (dr) steps[base + st].push({ drum: dr }); }
    });
    const song = { name, stepDur, len, steps };
    this.compiled[name] = song;
    return song;
  }
  // music(true) = menu theme · music("league" | "hof" | "menu" | "center" | "rival" | "clutch") · music(false) = silence
  // level: this track's loudness (1 = full; a game's music plays lower under the action: main.js MATCH_MUSIC)
  music(on, level = 1) {
    const name = on === true ? "menu" : on || null;
    this.want = name; this.wantLevel = level;
    if (!this.ctx) { this.track = name; return; }
    if (name === this.track && this.song) {
      if (this.trackGain && level !== this.level) { this.level = level; this.trackGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.25); }
      return;
    }
    // fade the old track out on its own gain, start the new one on a fresh gain
    const t = this.ctx.currentTime;
    if (this.trackGain) { const old = this.trackGain; old.gain.cancelScheduledValues(t); old.gain.setTargetAtTime(0.0001, t, 0.08); setTimeout(() => old.disconnect(), 900); }
    this.trackGain = null; this.song = null; this.track = name;
    if (!name || !SONGS[name]) return;
    this.trackGain = this.ctx.createGain();
    this.trackGain.gain.setValueAtTime(0.0001, t); this.trackGain.gain.setTargetAtTime(level, t + 0.05, 0.12); this.level = level;
    this.trackGain.connect(this.musicBus);
    this.song = this.compile(name); this.step = 0; this.nextT = t + 0.08;
  }
  playStep(song, i, t) {
    const dest = this.trackGain;
    for (const ev of song.steps[i]) {
      if (ev.drum) { this.drum(ev.drum, t, dest); continue; }
      this.inst(ev.inst, ev.f, t, ev.dur, ev.vol, dest);
    }
  }
  inst(name, f, t, dur, vol, dest) {
    if (name === "tri") this.osc("triangle", f, t, dur, vol, dest, { sustain: 0.85, release: 0.05 });
    else if (name === "pulse25") this.osc("pulse25", f, t, dur, vol, dest, { sustain: 0.65, release: 0.06 });
    else if (name === "pulse25v") this.osc("pulse25", f, t, dur, vol, dest, { sustain: 0.7, release: 0.08, vib: dur > 0.3 ? 14 : 0 });
    else if (name === "pulse12") this.osc("pulse12", f, t, dur, vol, dest, { sustain: 0.5, release: 0.04 });
    else if (name === "organ") this.osc("organ", f, t, dur, vol, dest, { sustain: 0.95, release: 0.08, attack: 0.01 });
    else if (name === "brass") this.osc("sawtooth", f, t, dur, vol, dest, { attack: 0.02, sustain: 0.8, release: 0.1, filter: { f0: 500, f1: 2600, t1: 0.06, f2: 1300, q: 1.2 } });
    else this.osc("square", f, t, dur, vol, dest);
  }
  drum(code, t, dest) {
    for (const ch of code) {
      if (ch === "k") { this.osc("sine", 150, t, 0.16, 0.42, dest, { slide: 42, slideT: 0.12, sustain: 0.3, decay: 0.05, release: 0.05 }); }
      else if (ch === "s") { this.noise(0.13, 0.13, 1900, 0.8, t, "bandpass", dest); this.osc("triangle", 190, t, 0.06, 0.08, dest, { slide: 140, sustain: 0.2 }); }
      else if (ch === "h") this.noise(0.035, 0.045, 7600, 0.7, t, "highpass", dest);
      else if (ch === "o") this.noise(0.16, 0.05, 6400, 0.7, t, "highpass", dest);
      else if (ch === "c") this.noise(0.9, 0.07, 5200, 0.5, t, "highpass", dest);
      else if (ch === "z") this.noise(0.05, 0.028, 9000, 0.9, t, "highpass", dest); // shaker
      else if (ch === "t") this.noise(0.09, 0.04, 7000, 2, t, "bandpass", dest); // tambourine
      else if (ch === "T") { this.osc("sine", 72, t, 0.55, 0.38, dest, { slide: 58, sustain: 0.4, decay: 0.15, release: 0.2 }); this.noise(0.25, 0.08, 280, 0.8, t, "lowpass", dest); } // timpani
    }
  }
  sting(name, t0 = 0) {
    const S = STINGS[name];
    if (!S) return;
    const t = t0 || this.ctx.currentTime + 0.01, sd = 60 / S.bpm / 4;
    let at = 0;
    for (const [n, len, h] of S.notes) {
      if (n !== ".") {
        const dur = len * sd * 0.95;
        this.inst(S.inst, hz(n), t + at * sd, dur, S.inst === "brass" ? 0.13 : 0.12, this.sfxBus);
        if (h && S.harm) this.inst(S.harm, hz(h), t + at * sd, dur, 0.06, this.sfxBus);
        if (S.droop && len >= 6) this.osc("sawtooth", hz(n), t + at * sd, dur, 0.07, this.sfxBus, { slide: hz(n) * 0.8, slideT: dur, filter: { f0: 900, q: 1 } });
      }
      at += len;
    }
    if (S.bass) this.osc("triangle", hz(S.bass[0]), t, S.bass[1] * sd, 0.2, this.sfxBus, { sustain: 0.8 });
    if (S.timp) for (let i = 0; i < 6; i++) this.drum("T", t + i * sd * 2, this.sfxBus);
  }

  // ---------- crowd (the voices are baked by audio-crowd.js; this plays them) ----------
  // Graph: bed = two copies of the 10 s stereo walla loop (half a loop apart, channels swapped, playback rates 0.991 /
  //   1.013 so they never line up: no audible loop) → lift (voice-like rise on big plays) → muffle (pause / replay) →
  //   level (tick(): the match situation, × CROWD_K) → sfx bus. Sparse single shouts / whistles / clap bursts join the
  //   bed at random (into the muffle: same level, same pause muffling); reactions and the chant go to the sfx bus.
  //   Persistent nodes: the bed's 2 sources + splitter/merger + lift/muffle/level; every one-shot is track_()ed.
  startCrowd() {
    if (!this.ctx || this.crowd) return;
    const ctx = this.ctx;
    const level = ctx.createGain(); level.gain.value = 0;
    const muffle = ctx.createBiquadFilter(); muffle.type = "lowpass"; muffle.frequency.value = 6000;
    const lift = ctx.createGain(); lift.gain.value = 1;
    lift.connect(muffle); muffle.connect(level); level.connect(this.sfxBus);
    this.crowd = { g: level, muffle, lift, srcs: [], rates: [0.991, 1.013], bank: Object.create(null), seg: null };
    this.extraAt = 0; this.chantG = null; this.liftPeak = 1;
    this.crowdBake = new CrowdBank(7, (name, d) => this.crowdLanded(name, d)); // baked a few ms per frame in tick()
  }
  crowdLanded(name, d) {
    const c = this.crowd, ctx = this.ctx;
    if (!c || !d) return;
    const b = ctx.createBuffer(2, d.n, CROWD_SR);
    b.getChannelData(0).set(d.L); b.getChannelData(1).set(d.R);
    c.bank[name] = b;
    if (name === "extras") c.seg = d.seg;
    if (name !== "bed" || c.srcs.length) return;
    const t = ctx.currentTime;
    c.rates.forEach((rate, i) => {
      const src = ctx.createBufferSource(); src.buffer = b; src.loop = true; src.playbackRate.value = rate;
      if (i) { // the second copy with left and right swapped: decorrelated stereo
        const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2);
        src.connect(sp); sp.connect(mg, 0, 1); sp.connect(mg, 1, 0); mg.connect(c.lift);
      } else src.connect(c.lift);
      src.start(t, i ? b.duration * 0.5 : 0);
      c.srcs.push(src);
    });
  }
  crowdLevel(v) { this.crowdTarget = Math.max(0, Math.min(1, v)); }
  // a lift of the crowd bed (big plays): v is the old bed-gain scale (0.2 a kick in the air … 0.85 a touchdown). The
  // bed is voices, so lifting it is "everyone gets louder": a quick two-stage rise (the near voices first, then the
  // stands), pitch up a little as people shout, a ragged hold, then back down — never a slow swell.
  swell(v = 0.3, dur = 1.6) {
    const c = this.crowd;
    if (!c || !this.ctx) return;
    const k = Math.max(0, Math.min(1, v / 0.85)), t = this.ctx.currentTime, peak = 1 + 1.3 * k;
    if (t < (this.swellUntil || 0) - 1.5 && peak < this.liftPeak) return; // a bigger lift is already up
    this.liftPeak = peak; this.swellUntil = t + dur + 1.5;
    const g = c.lift.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 + 0.5 * (peak - 1), t, 0.05);
    g.setTargetAtTime(peak, t + 0.1 + Math.random() * 0.08, 0.1);
    g.setTargetAtTime(peak * (0.86 + Math.random() * 0.1), t + dur * 0.55, 0.25);
    g.setTargetAtTime(1, t + dur, 0.45);
    c.srcs.forEach((src, i) => {
      const p = src.playbackRate, r = c.rates[i];
      p.cancelScheduledValues(t); p.setTargetAtTime(r * (1 + 0.03 * k), t, 0.12); p.setTargetAtTime(r, t + dur, 0.6);
    });
  }
  // one baked crowd sample (a reaction, a chant cycle, an extras segment) — rate and pan varied a little
  crowdShot(name, t, vol, dest, off = 0, dur = 0, pan = 0) {
    const c = this.crowd, b = c && c.bank[name];
    if (!b || !this.room(1)) return null;
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b; src.playbackRate.value = 0.96 + Math.random() * 0.08;
    g.gain.value = vol;
    src.connect(g);
    const nodes = [src, g];
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(dest); nodes.push(p); } else g.connect(dest);
    if (dur) src.start(t, Math.min(off, b.duration - 0.05), Math.max(0.05, Math.min(dur, b.duration - off))); else src.start(t);
    this.track_(src, nodes, t + (dur || b.duration) / src.playbackRate.value);
    return g;
  }
  // crowd reactions over the bed: cheer / roar (home crowd happy), groan (unhappy), oooh — choruses of voices
  react(kind, k = 1) {
    if (!this.live()) return;
    const t = this.ctx.currentTime + 0.02, kk = Math.min(1.2, k), bus = this.sfxBus;
    if (kind === "roar" || kind === "cheer") {
      this.swell(Math.min(0.85, 0.3 + 0.55 * k), 1 + 2.2 * k);
      this.crowdShot(kind, t, RX_VOL[kind] * (0.45 + 0.6 * kk), bus);
      if (kind === "roar" && k >= 0.8) this.crowdShot("cheer", t + 0.35, RX_VOL.cheer * 0.5 * kk, bus, 0, 0, Math.random() < 0.5 ? -0.4 : 0.4);
    } else if (kind === "groan") {
      this.swell(0.2 + 0.15 * k, 1.2);
      this.crowdShot("groan", t, RX_VOL.groan * (0.55 + 0.5 * kk), bus);
    } else if (kind === "oooh") {
      this.crowdShot("oooh", t, RX_VOL.oooh, bus);
      this.swell(0.35, 1.2);
    }
  }
  // home crowd chant on the opponent's 3rd downs: "DE-FENSE!" clap clap (tick() repeats it every 1.75 s)
  chant(on) {
    this.chantOn = on;
    if (on && this.ctx) this.chantNext = Math.max(this.chantNext, this.ctx.currentTime + 0.2);
    if (!on && this.chantG && this.ctx) { const g = this.chantG.gain, t = this.ctx.currentTime; g.cancelScheduledValues(t); g.setTargetAtTime(0, t, 0.06); this.chantG = null; }
  }
  chantCycle(t) { this.chantG = this.crowdShot("chant", t, RX_VOL.chant, this.sfxBus, 0, 0, (Math.random() - 0.5) * 0.3); }

  // ---------- per frame: music scheduler + crowd mix ----------
  tick() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (this.song && !this.muted && this.trackGain) {
      if (this.nextT < now - 0.3) this.nextT = now + 0.05; // tab was hidden: don't burst-catch-up
      while (this.nextT < now + 0.18) { this.playStep(this.song, this.step, this.nextT); this.nextT += this.song.stepDur; this.step = (this.step + 1) % this.song.len; }
    }
    // the crowd follows the match situation
    const app = this.app, w = this.w;
    let target = 0, muffle = 6000;
    if (app && app.mode === "game" && w && app.world === w) {
      target = 0.06;
      if (app.paused) { target = 0.018; muffle = 900; }
      else if (app.replayActive) { target = 0.035; muffle = 1400; }
      else {
        const ph = w.phase;
        if ((ph === "presnap" || ph === "playcall") && w.down === 3 && w.playType === "normal") target = w.possession === w.user ? 0.05 : 0.15; // loud when the crowd's team is on defense
        else if (ph === "live") target = 0.09;
        else if (ph === "over") target = 0.05;
        if (w.quarter >= 4 && Math.abs(w.score.home - w.score.away) <= 8 && w.clock < 90) target += 0.03;
      }
      if (this.chantOn && now >= this.chantNext && this.live() && !app.paused && !app.replayActive) { this.chantCycle(now + 0.02); this.chantNext = now + 1.75; }
      // the odd single voice / whistle / clap burst from the stands, at random (never in step with the bed's loop)
      const c = this.crowd;
      if (c && c.seg && now >= this.extraAt && this.live() && !app.paused && !app.replayActive) {
        if (this.extraAt > 0) { const sg = c.seg[(Math.random() * c.seg.length) | 0]; this.crowdShot("extras", now + 0.02, sg.vol * EXTRA_VOL, c.muffle, sg.off, sg.dur, (Math.random() - 0.5) * 1.5); }
        this.extraAt = now + 1.2 + Math.random() * 4.5;
      }
    } else if (this.chantOn) this.chantOn = false;
    if (this.crowdTarget > target) target = this.crowdTarget;
    if (this.crowd && Math.abs(target - this.crowdSet) > 0.004) {
      this.crowdSet = target;
      this.crowd.g.gain.setTargetAtTime(target * CROWD_K, now, 0.5);
    }
    if (this.crowd && this.crowdMuffle !== muffle) { this.crowdMuffle = muffle; this.crowd.muffle.frequency.setTargetAtTime(muffle, now, 0.2); }
    // bake the crowd's voices a few ms per frame until every buffer has landed (the bed starts as soon as it does)
    if (this.crowdBake && !this.crowdBake.done && !this.muted) this.crowdBake.work(4);
  }

  // ---------- the match: every sound cue for a sim event ----------
  attach(bus, w, app) {
    const au = this;
    au.app = app; au.w = w; au.chantOn = false; au.crowdTarget = 0;
    // the crowd's team: yours, except in a Franchise game, where the stands are the home team's (an away game: they groan
    // at your touchdowns and chant when you have the ball; app.fr.crowd), and a replay's (net/watch.js: app.watch.crowd)
    const crowd = w.user;
    const mine = (team) => Boolean(crowd) && team === crowd;
    const teamOf = (p) => (p && p.teamKey) || null;
    bus.on("kickoff", () => { au.crowdLevel(0.13); setTimeout(() => au.crowdLevel(0), 2500); });
    bus.on("kick", (e) => { au.sfx(e.kind === "kickoff" ? "kickoff" : "kick", e.power || 1); if (e.kind === "kickoff" || e.kind === "punt") au.swell(0.2, 1.3); });
    bus.on("snap", (e) => { au.chant(false); if (!e.kick) au.sfx("hut"); });
    bus.on("throw", (e) => { if (!e.away) au.sfx("throw", e.lob ? 1.2 : 1); });
    bus.on("catch", (e) => au.sfx(e && e.kick ? "catchKick" : "catch"));
    bus.on("drop", () => au.sfx("inc"));
    bus.on("tackle", (e) => { const k = Math.min(1.6, (e.power || 5) / 14); au.sfx("hit", Math.min(1, 0.4 + k * 0.5)); });
    bus.on("hitStick", (e) => { if (e.boom) { au.sfx("boom"); au.react(mine(teamOf(e.tackler)) ? "roar" : "oooh", 0.6); } });
    bus.on("juke", () => au.sfx("juke"));
    bus.on("spin", () => au.sfx("spin"));
    bus.on("stiffArm", () => au.sfx("stiff"));
    bus.on("dive", () => au.sfx("dive"));
    bus.on("truck", (e) => { if (e.defender && !e.failed) au.sfx("truck"); });
    bus.on("pancake", () => au.sfx("hit", 0.7));
    bus.on("swat", (e) => { if (e.receiver !== undefined || e.player) au.sfx("swat"); });
    bus.on("sack", (e) => { au.sfx("hit", 1); au.react(mine(teamOf(e.tackler)) ? "roar" : "groan", 0.6); });
    bus.on("interception", (e) => { au.sfx("pick"); au.react(mine(teamOf(e.player)) ? "roar" : "groan", 0.8); });
    bus.on("fumble", () => { au.react("oooh"); });
    bus.on("recover", (e) => { au.react(mine(teamOf(e.player)) ? "cheer" : "groan", 0.5); });
    bus.on("incomplete", (e) => { if (!e.swat) au.sfx("inc"); });
    bus.on("firstDown", (e) => { au.sfx("firstdown"); if (mine(e.team)) au.react("cheer", 0.25); });
    bus.on("touchdown", (e) => { au.sfx("horn"); au.sfx("tdfanfare"); au.react(mine(e.team) ? "roar" : "groan", 1); });
    bus.on("fieldGoal", (e) => { if (e.doink) au.sfx("swat", 1.2); if (e.good) { au.sfx("organ"); au.react(mine(e.team) ? "cheer" : "groan", 0.5); } else au.react(mine(e.team) ? "groan" : "cheer", 0.45); });
    // football team's blocked kicks (a thud and the crowd's gasp) and the coin toss
    bus.on("kickBlocked", (e) => { au.sfx("hit", 1); au.react(mine(teamOf(e.player)) ? "roar" : "oooh", 0.7); });
    bus.on("coinToss", () => au.sfx("blip"));
    bus.on("patResult", (e) => { au.react(mine(e.team) === Boolean(e.good) ? "cheer" : "groan", 0.3); });
    bus.on("twoPoint", (e) => { if (e.setup) return; au.react(mine(e.team) === Boolean(e.good) ? "cheer" : "groan", 0.5); });
    bus.on("safety", (e) => { au.sfx("horn", 0.6); au.react(mine(e.team) ? "roar" : "groan", 0.8); });
    bus.on("playCall", (e) => {
      if (w.down !== 3 || e.two || w.playType !== "normal") return;
      if (w.possession === crowd) au.sfx("organ"); else au.chant(true);
    });
    bus.on("whistle", () => { au.chant(false); au.sfx("whistle"); });
    bus.on("timeout", () => au.sfx("whistle2"));
    bus.on("timeoutEnd", () => au.sfx("whistle")); // the referee: ready for play
    bus.on("twoMinute", () => au.sfx("whistle2"));
    bus.on("quarterEnd", (e) => { if (e.q !== 2) au.sfx("horn", 0.55); });
    // halftime: the horn, the announcer's "HALFTIME!" (audio/halftime.mp3; a real game only), then the jingle after it
    bus.on("halftime", () => {
      au.sfx("horn", 0.6);
      const d = au.app && au.app.mode === "game" && au.app.world === w ? au.clip("halftime", 1, 0.35) : 0;
      if (d) setTimeout(() => au.sfx("halftime"), (0.35 + d) * 1000); else au.sfx("halftime");
    });
    bus.on("overtime", () => au.sfx("vs"));
    bus.on("gameOver", (e) => { const won = e.winner && e.winner === w.user; au.sfx(won ? "victory" : e.winner ? "defeat" : "horn"); au.react(mine(e.winner) ? "roar" : e.winner ? "groan" : "oooh", 1); });
    bus.on("audible", () => au.sfx("select"));
    bus.on("hotRoute", () => au.sfx("blip"));
    bus.on("switch", () => au.sfx("tick"));
    bus.on("replayStart", () => au.sfx("tape"));
    bus.on("replayEnd", () => au.sfx("tapeEnd"));
    bus.on("badge", () => au.sfx("badge"));
    // the broadcast open: a brassy "da-da-DAAA" before the opening kickoff
    au.sfx("open");
  }

  evolution(on = true) {
    const old = this.evolutionGain;
    if (old && this.ctx) {
      const now = this.ctx.currentTime;
      old.gain.cancelScheduledValues(now);
      old.gain.setTargetAtTime(0.0001, now, 0.035);
      // (faded out, but left connected until its last note is over: notes cut off from the speakers may never end)
      const left = Math.max(0.25, (this.evolutionEnd || 0) - now + 0.3);
      setTimeout(() => { try { old.disconnect(); } catch (_) { /* already disconnected */ } }, left * 1000);
      this.evolutionGain = null;
    }
    if (on === false || !this.live() || !this.room(2)) return;

    const times = Array.isArray(on) ? on : [500, 1700, 3400, 5200];
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const morph = Math.max(0.08, times[0] / 1000);
    const reveal = Math.max(morph + 0.12, times[1] / 1000);
    const confirm = Math.max(reveal + 0.18, times[2] / 1000);
    const end = Math.max(confirm + 0.35, times[3] / 1000);
    const bus = this.evolutionGain = ctx.createGain();
    this.evolutionEnd = t + end + 0.2;
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.linearRampToValueAtTime(0.78, t + 0.04);
    bus.gain.setValueAtTime(0.78, t + Math.max(0.05, end - 0.22));
    bus.gain.exponentialRampToValueAtTime(0.0001, t + end);
    bus.connect(this.sfxBus);

    this.osc("triangle", 92, t, reveal + 0.08, 0.055, bus, { slide: 440, slideT: reveal, sustain: 0.75, release: 0.08 });
    const charge = ["C5", "E5", "G5", "B5", "C6", "E6", "G6", "B6"];
    const chargeCount = reveal < 0.7 ? 6 : 14;
    for (let i = 0; i < chargeCount; i++) {
      const p = i / chargeCount;
      const at = t + reveal * (1 - Math.pow(1 - p, 1.45));
      const note = charge[i % charge.length];
      this.osc("pulse25", hz(note), at, 0.075, 0.045 + p * 0.025, bus, { sustain: 0.42, release: 0.025 });
    }
    this.noise(Math.max(0.12, reveal - morph + 0.12), 0.065, 650, 1.8, t + morph, "bandpass", bus, { sweep: 5200 });

    for (const [note, delay] of [["C5", 0], ["G5", 0.045], ["C6", 0.09], ["E6", 0.135]]) {
      this.osc("pulse12", hz(note), t + reveal + delay, 0.42, 0.065, bus, { sustain: 0.62, release: 0.08 });
    }
    this.noise(0.45, 0.055, 4800, 2.4, t + reveal, "highpass", bus, { sweep: 9000 });

    const flourish = [["C6", 0], ["E6", 0.11], ["G6", 0.22], ["C7", 0.34]];
    for (const [note, delay] of flourish) {
      this.osc("pulse25", hz(note), t + confirm + delay, delay === 0.34 ? 0.62 : 0.16, 0.085, bus, { sustain: 0.7, release: 0.09 });
      this.osc("sine", hz(note) * 2, t + confirm + delay, 0.2, 0.028, bus, { sustain: 0.35, release: 0.08 });
    }
    setTimeout(() => { if (this.evolutionGain === bus) { this.evolutionGain = null; try { bus.disconnect(); } catch (_) { /* already disconnected */ } } }, Math.ceil((end + 0.25) * 1000));
  }

  // ---------- one-shot cues (menus, kick meter, the league call these by name too) ----------
  sfx(name, k = 1) {
    if (!this.live()) return;
    const COOL = { wheelTick: 0.015, wheelWin: 0.5, wheelBig: 0.5, cardRare: 0.3, cardUltra: 0.5, packTear: 0.3, packShake: 0.5, badge: 1.5, tape: 0.5, tapeEnd: 0.5, hut: 0.25, whistle: 0.3, hit: 0.05, boom: 0.3, catch: 0.08, throw: 0.1, organ: 1.2, horn: 0.6, firstdown: 0.5, inc: 0.15, vs: 0.4, victory: 2, defeat: 2, flagUp: 1, gymOpen: 1, chalNew: 0.8, chalWin: 0.8, chalFail: 0.8, champion: 2, fanfare: 2, tdfanfare: 1, halftime: 1, open: 3, kick: 0.2, kickoff: 0.5, juke: 0.1, spin: 0.1, swat: 0.15 };
    if (!this.ok(name, COOL[name] != null ? COOL[name] : 0.03)) return;
    if (!this.room(name === "badge" || name === "victory" || name === "champion" ? 2 : 1)) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.005;
    switch (name) {
      case "hut": { // QB cadence
        this.noise(0.05, 0.16, 1800, 1.4, t, "bandpass");
        this.vowel(t + 0.03, 0.13, 132, 640, 1190, 0.62, 2);
        this.noise(0.025, 0.14, 3200, 1, t + 0.16, "highpass");
        break;
      }
      case "whistle": { // referee pea whistle: a trill (two detuned tones beating fast)
        this.osc("sine", 2750, t, 0.34, 0.14, null, { sustain: 0.9, release: 0.05 });
        this.osc("sine", 2870, t, 0.34, 0.12, null, { sustain: 0.9, release: 0.05 });
        this.noise(0.3, 0.05, 2800, 6, t, "bandpass");
        break;
      }
      case "whistle2": this.sfx("whistle"); this.lastAt.set("whistle", -9); setTimeout(() => this.sfx("whistle"), 380); break;
      case "kick": this.osc("sine", 160, t, 0.14, 0.45 * Math.min(1.2, 0.6 + 0.4 * k), null, { slide: 50, slideT: 0.1, sustain: 0.3, decay: 0.04 }); this.noise(0.03, 0.18, 2600, 1, t, "highpass"); break;
      case "kickoff": this.osc("sine", 130, t, 0.22, 0.6, null, { slide: 42, slideT: 0.14, sustain: 0.3, decay: 0.05 }); this.noise(0.05, 0.25, 2200, 1, t, "highpass"); this.noise(0.6, 0.06, 700, 0.6, t + 0.05, "bandpass", null, { sweep: 1800 }); break;
      case "throw": this.noise(0.24 * k, 0.11, 900, 1.4, t, "bandpass", null, { sweep: 2600 }); break;
      case "catch": this.noise(0.05, 0.16, 1100, 1.2, t, "bandpass"); this.osc("triangle", 210, t, 0.07, 0.14, null, { slide: 150, sustain: 0.3 }); break;
      case "catchKick": this.noise(0.06, 0.14, 900, 1.2, t, "bandpass"); this.osc("triangle", 180, t, 0.08, 0.12, null, { slide: 130 }); break;
      case "hit": this.noise(0.13, 0.42 * k, 420, 0.8, t, "lowpass"); this.osc("sine", 96, t, 0.13, 0.32 * k, null, { slide: 46, sustain: 0.3, decay: 0.04 }); break;
      case "boom": { // hit stick: sub drop + distorted crack
        this.osc("sine", 74, t, 0.6, 0.55, this.shaper, { slide: 30, slideT: 0.45, sustain: 0.6, decay: 0.12, release: 0.15 });
        this.noise(0.08, 0.32, 2100, 0.8, t, "bandpass");
        this.noise(0.5, 0.22, 260, 0.7, t, "lowpass");
        break;
      }
      case "truck": this.noise(0.18, 0.4, 300, 0.8, t, "lowpass"); this.vowel(t + 0.02, 0.16, 105, 520, 950, 0.25, 1); break;
      case "stiff": this.noise(0.08, 0.2, 700, 1, t, "bandpass"); this.vowel(t, 0.12, 120, 600, 1000, 0.2, 1); break;
      case "juke": this.noise(0.13, 0.12, 2600, 2.5, t, "bandpass", null, { sweep: 4800 }); break;
      case "spin": this.noise(0.26, 0.11, 1800, 3, t, "bandpass", null, { sweep: 5200 }); this.noise(0.2, 0.06, 5200, 3, t + 0.08, "bandpass", null, { sweep: 2000 }); break;
      case "dive": this.noise(0.25, 0.1, 1200, 1.5, t, "bandpass", null, { sweep: 400 }); this.noise(0.12, 0.2, 380, 0.8, t + 0.22, "lowpass"); break;
      case "swat": this.noise(0.06, 0.24, 2500, 1.2, t, "bandpass"); this.osc("square", 520, t, 0.05, 0.05, null, { slide: 300 }); break;
      case "pick": this.osc("pulse25", 660, t, 0.08, 0.08); this.osc("pulse25", 990, t + 0.07, 0.12, 0.08); break;
      case "inc": this.osc("triangle", 320, t, 0.12, 0.13, null, { slide: 170 }); this.osc("triangle", 260, t + 0.15, 0.08, 0.07, null, { slide: 160 }); break;
      case "firstdown": this.osc("pulse25", hz("E6"), t, 0.08, 0.08); this.osc("pulse25", hz("B6"), t + 0.08, 0.16, 0.08); break;
      case "horn": { // stadium PA air horn
        const d = 0.9 * k;
        for (const [f, v] of [[hz("A3"), 0.16], [hz("C#4") * 1.003, 0.13], [hz("E4") * 0.997, 0.11]]) this.osc("sawtooth", f * 0.94, t, d, v, null, { slide: f, slideT: 0.06, attack: 0.012, sustain: 0.92, release: 0.12, filter: { f0: 1600, q: 1.4 } });
        break;
      }
      case "organ": this.sting("organ", t); break;
      case "tdfanfare": this.sting("tdfanfare", t + 0.25); break;
      case "badge": this.sting("badge", t); break;
      case "fanfare": this.sting("fanfare", t); break;
      case "champion": this.sting("champion", t); break;
      case "victory": this.sting("victory", t + 0.1); break;
      case "defeat": this.sting("defeat", t + 0.1); break;
      case "halftime": this.sting("halftime", t + 0.4); break;
      case "arrive": this.sting("arrive", t); break;
      case "flagUp": this.sting("flagUp", t); break;
      case "wheelWin": this.sting("wheelWin", t); break;
      case "wheelBig": this.sting("wheelBig", t); break;
      case "wheelTick": this.osc("pulse12", 1760, t, 0.02, 0.05, null, { release: 0.01 }); break;
      case "cardRare": this.sting("cardRare", t); break;
      case "cardUltra": this.sting("cardUltra", t); break;
      case "cardFlip": this.noise(0.09, 0.07, 2400, 1.2, t, "bandpass"); this.osc("pulse25", 520, t + 0.05, 0.05, 0.05); break;
      case "cardDeal": this.noise(0.05, 0.06, 3600, 1.5, t, "bandpass"); break;
      case "packShake": for (let i = 0; i < 7; i++) this.noise(0.05, 0.05 + i * 0.008, 1800 + i * 300, 1.5, t + i * 0.11, "bandpass"); break;
      case "packTear": this.noise(0.32, 0.16, 5200, 0.8, t, "highpass"); this.osc("pulse25", 392, t + 0.1, 0.07, 0.08); this.osc("pulse25", 784, t + 0.17, 0.12, 0.08); break;
      case "gymOpen": this.sting("gymOpen", t); break;
      case "chalNew": this.sting("chalNew", t); break;
      case "chalWin": this.sting("chalWin", t); break;
      case "chalFail": this.sting("chalFail", t + 0.05); break;
      case "open": { // broadcast open: three brass hits + timpani + crash
        for (const [dt, len] of [[0, 0.12], [0.17, 0.12], [0.34, 0.75]]) for (const n of ["C4", "G4", "C5", "E5"]) this.inst("brass", hz(n), t + dt, len, 0.06, this.sfxBus);
        this.drum("T", t, this.sfxBus); this.drum("T", t + 0.34, this.sfxBus); this.drum("c", t + 0.34, this.sfxBus);
        break;
      }
      case "challenger": { // A NEW CHALLENGER APPROACHES (hub-ambush.js): a long rising whoosh, a slam, a brass stinger, a cymbal
        this.noise(0.55, 0.16, 300, 1.1, t, "bandpass", null, { sweep: 5200 });
        this.osc("sine", 60, t + 0.55, 0.8, 0.6, this.shaper, { slide: 28, slideT: 0.6, sustain: 0.5, decay: 0.15, release: 0.2 });
        this.noise(0.12, 0.34, 1800, 0.8, t + 0.55, "bandpass");
        this.drum("T", t + 0.55, this.sfxBus);
        for (const n of ["C4", "G4", "C5", "E5", "G5"]) this.inst("brass", hz(n), t + 0.72, 0.6, 0.05, this.sfxBus);
        this.noise(1.1, 0.12, 7000, 0.6, t + 0.72, "highpass");
        break;
      }
      case "vs": { // intro card: whoosh up, timpani, stab
        this.noise(0.32, 0.12, 400, 1.2, t, "bandpass", null, { sweep: 3800 });
        this.drum("T", t + 0.3, this.sfxBus);
        for (const n of ["D4", "A4", "D5", "F5"]) this.inst("brass", hz(n), t + 0.3, 0.32, 0.055, this.sfxBus);
        break;
      }
      case "tape": { // VCR rewind into the replay
        this.osc("sine", 70, t, 0.08, 0.25, null, { sustain: 0.2 });
        this.noise(0.55, 0.3, 3400, 1.6, t + 0.04, "bandpass", null, { sweep: 380 });
        this.osc("sawtooth", 620, t + 0.04, 0.5, 0.035, null, { slide: 160, slideT: 0.5, filter: { f0: 1400 } });
        break;
      }
      case "tapeEnd": this.noise(0.18, 0.08, 500, 1.2, t, "bandpass", null, { sweep: 2600 }); this.osc("sine", 90, t + 0.15, 0.06, 0.15); break;
      case "blip": this.osc("pulse25", 880, t, 0.04, 0.06, null, { sustain: 0.5, release: 0.02 }); break;
      case "tick": this.osc("pulse12", 1320, t, 0.03, 0.04, null, { release: 0.02 }); break;
      case "select": this.osc("pulse25", 660, t, 0.05, 0.08); this.osc("pulse25", 990, t + 0.05, 0.08, 0.08); break;
      case "back": this.osc("pulse25", 660, t, 0.05, 0.07); this.osc("pulse25", 440, t + 0.05, 0.08, 0.07); break;
      case "buzz": this.osc("square", 110, t, 0.18, 0.07, null, { vib: 60, filter: { f0: 900 } }); break;
      case "meter": this.osc("pulse25", 440 + k * 600, t, 0.03, 0.04, null, { release: 0.02 }); break;
      case "perfect": this.osc("pulse25", 1318, t, 0.12, 0.09); this.osc("pulse25", 1760, t + 0.1, 0.18, 0.09); break;
      case "oooh": this.react("oooh"); break;
      case "td": this.sfx("horn"); this.sfx("tdfanfare"); this.swell(0.5, 3); break;
      default: break;
    }
  }
}
