// The player's controls: every action's keyboard keys and controller buttons, remappable in Settings → CONTROLS
// (ui-controls.js). ACTIONS is the one table: its defaults are the game's controls as they always were, and B holds
// the live bindings — read by input.js (movement, sprint, the receiver and hot-route keys, pause / mute / camera, which
// buttons run the menus), by controls.js (each CONTEXTS binding names its action) and by every hint (the HUD legend,
// How to Play, the play-call panels, the kick meter, the title tips). Touch controls are fixed.
// Saved on this device at once (all22pro-controls-v1: only what differs from the defaults); signed in, cloud saves
// sync it (saves.js, newest wins). Franchise game days run this game, so they use the same controls.
// Rules:
//   · Locked: Esc and the controller's START always pause; the D-pad and HOME are never bound; F-keys, Ctrl / Alt /
//     Cmd and other system keys can't be used.
//   · Menus (and the in-game panels) always answer the arrow keys, Enter and Esc, and the D-pad, A, B and START: an
//     action used there can't take those (ACTIONS' situations below; FIXED).
//   · A key may do different things in different situations (SPACE snaps on offense and switches players on
//     defense); a clash only exists inside one situation, and then the two bindings swap (rebind()).
//   · SWAP A AND B (Nintendo-style players) swaps every action on A with B, the menus' A and B too.
// Key ids: input.js keyName(): single characters lowercase ("w", "1", ";"), " " → "space", other keys their
// KeyboardEvent.key lowercased ("tab", "enter", "shift", "arrowup", "backspace"). Pad buttons: standard-mapping
// indices (0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT · 8 BACK · 10 L3 · 11 R3).
export const STORE = "all22pro-controls-v1";
export const PAD_NAMES = ["gpA", "gpB", "gpX", "gpY", "gpLB", "gpRB", "gpLT", "gpRT", "gpBack", "pause", "gpL3", "gpR3", "", "", "", "", "gpHome"]; // input.js event names
export const PAD_GLYPH = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "BACK", "START", "L3", "R3", "UP", "DOWN", "LEFT", "RIGHT", "HOME"]; // ui-art.js padGlyphURL names
const PAD_OK = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11]; // bindable buttons

// Situations (where a key is read): line = at the line on offense, lineD = pre-snap on defense, kick = the kick meter,
// pocket = the QB before the throw, run = the ball carrier, def = defense / kick coverage, ret = fielding a punt,
// free = an offensive player without the ball, call = the play call, fourth = 4th down / PAT / kick panels,
// hot / audible = those panels, dead = the dead ball after a play, menu = menus (title, pause, settings...).
const GAME = ["line", "lineD", "kick", "pocket", "run", "def", "ret", "free", "call", "fourth", "hot", "audible", "dead"];
const ARROWS = ["arrowup", "arrowdown", "arrowleft", "arrowright"];
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
// what a situation keeps for itself, whatever the bindings: the menus' keys and buttons, the number keys that pick the
// panels' cards, LB / RB that change formations on the play call, the arrows that aim kicks
const MENU_K = ["enter", ...ARROWS], MENU_P = [0, 1];
const FIXED_K = { kick: ["arrowleft", "arrowright"], call: [...MENU_K, ...DIGITS], fourth: [...MENU_K, ...DIGITS], audible: [...MENU_K, ...DIGITS], hot: MENU_K, menu: MENU_K };
const FIXED_P = { call: [...MENU_P, 4, 5], fourth: MENU_P, audible: MENU_P, menu: MENU_P };
const OWN_ARROW = { up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright" };

export const GROUPS = [["move", "MOVE"], ["line", "OFFENSE · PRE-SNAP"], ["pass", "PASSING"], ["run", "BALL CARRIER"], ["def", "DEFENSE"], ["kick", "KICKING"], ["call", "PLAY CALL"], ["game", "GAME"]];
// id, label, group, situations (keyboard; pctx: the controller's when different), default keys, default buttons.
// move: a direction (the stick and D-pad move; not bindable on the controller). note: shown under the label.
const A = (id, label, group, ctx, keys, pad, o) => ({ id, label, group, ctx, keys, pad, ...o });
export const ACTIONS = [
  A("up", "MOVE UP", "move", [...GAME, "menu"], ["w", "arrowup"], [], { move: "navUp" }),
  A("down", "MOVE DOWN", "move", [...GAME, "menu"], ["s", "arrowdown"], [], { move: "navDown" }),
  A("left", "MOVE LEFT", "move", [...GAME, "menu"], ["a", "arrowleft"], [], { move: "navLeft" }),
  A("right", "MOVE RIGHT", "move", [...GAME, "menu"], ["d", "arrowright"], [], { move: "navRight" }),
  A("sprint", "SPRINT / SCRAMBLE", "move", ["pocket", "run", "def", "ret", "free"], ["shift"], [7]),
  A("snap", "SNAP", "line", ["line"], ["space"], [0]),
  A("audible", "AUDIBLE", "line", ["line", "lineD", "audible"], ["tab"], [2], { note: "AT THE LINE: YOUR PLAY ON OFFENSE, YOUR CALL ON DEFENSE" }),
  // (held, the HOT ROUTE key turns the receivers' keys into hot routes wherever you are: it keeps off the pocket's keys)
  A("hotRoute", "HOT ROUTE", "line", ["line", "hot", "pocket"], ["h"], [3], { pctx: ["line"], note: "HOLD + A RECEIVER'S KEY: CYCLE HIS ROUTE" }),
  A("spike", "SPIKE", "line", ["line", "call"], ["x"], [6], { note: "AT THE LINE AND ON THE PLAY CALL" }),
  A("pass1", "RECEIVER 1", "pass", ["pocket", "hot"], ["1"], [0], { rec: 1 }),
  A("pass2", "RECEIVER 2", "pass", ["pocket", "hot"], ["2"], [1], { rec: 2 }),
  A("pass3", "RECEIVER 3", "pass", ["pocket", "hot"], ["3"], [2], { rec: 3 }),
  A("pass4", "RECEIVER 4", "pass", ["pocket", "hot"], ["4"], [3], { rec: 4 }),
  A("pass5", "RECEIVER 5", "pass", ["pocket", "hot"], ["5"], [5], { rec: 5 }),
  A("throwAway", "THROW IT AWAY", "pass", ["pocket"], ["c"], [4]),
  A("jukeL", "JUKE LEFT", "run", ["run"], ["q"], []),
  A("jukeR", "JUKE RIGHT", "run", ["run"], ["e"], []),
  A("juke", "JUKE", "run", ["run"], [], [0], { note: "AWAY FROM THE TACKLER, OR THE WAY YOU'RE PUSHING" }),
  A("spin", "SPIN", "run", ["run"], ["f"], [1]),
  A("stiff", "STIFF ARM", "run", ["run"], ["r"], [2]),
  A("truck", "TRUCK", "run", ["run"], ["t"], [3]),
  A("dive", "DIVE", "run", ["run"], ["c"], [5], { note: "IN YOUR OWN END ZONE ON A RETURN: KNEEL" }),
  A("lateral", "LATERAL", "run", ["run"], ["x"], [4], { note: "TO THE NEAREST TEAMMATE BEHIND THE BALL" }),
  A("switchPre", "SWITCH (PRE-SNAP)", "def", ["lineD"], ["space"], [0, 1]),
  A("tackle", "TACKLE", "def", ["def"], ["f"], [0]),
  A("switch", "SWITCH PLAYER", "def", ["def"], ["space"], [1]),
  A("hitstick", "HIT STICK", "def", ["def"], ["r"], [2]),
  A("swat", "SWAT", "def", ["def"], ["e"], [3]),
  A("kick", "KICK", "kick", ["kick"], ["space"], [0], { note: "THREE PRESSES: START · POWER · ACCURACY" }),
  A("kickType", "KICKOFF TYPE", "kick", ["kick"], ["tab"], [3]),
  A("fairCatch", "FAIR CATCH", "kick", ["ret"], ["c"], [3]),
  A("coach", "COACH'S PICK", "call", ["call"], ["c"], [3]),
  // (F, BOWL's FLIP key, is FIELD GOAL on PRO's play call: G sits next to it)
  A("flip", "FLIP PLAY", "call", ["call"], ["g"], [11], { note: "RUN THE PLAY THE OTHER WAY" }),
  A("fieldGoal", "FIELD GOAL", "call", ["call"], ["f"], [2], { note: "LATE IN A HALF, IN RANGE" }),
  A("noHuddle", "NO HUDDLE", "call", ["call"], ["n"], [7]),
  A("kneelCall", "KNEEL", "call", ["call"], ["k"], []),
  A("timeout", "TIMEOUT", "game", ["line", "lineD", "kick", "call", "fourth", "dead"], ["t"], [8], { note: "BETWEEN PLAYS" }),
  A("pause", "PAUSE", "game", [...GAME, "menu"], ["p"], [], { note: "ESC AND START ALWAYS PAUSE" }),
  A("camera", "CAMERA", "game", GAME, ["v"], []),
  A("ffwd", "FAST FORWARD", "game", GAME, ["b"], [], { note: "WHILE THE CPU HAS THE BALL" }),
  A("mute", "MUTE", "game", [...GAME, "menu"], ["m"], []),
];
export const BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
const GLOBAL = { pause: "pause", camera: "cam", mute: "mute", ffwd: "ffwd" }; // actions input.js fires by name, wherever you are

// ---------- the live bindings: rebuilt by apply(), read on every input (no allocation) ----------
export const B = {
  kb: {}, pad: {}, // action → key ids / button indices (in effect: SWAP A AND B applied)
  swapAB: false,
  move: { up: [], down: [], left: [], right: [] },
  nav: new Map(), // movement key → navUp | navDown | navLeft | navRight (the arrows always are)
  rec: new Map(), // receiver key → 1-5
  recPad: new Map(), // receiver button name (gpA…) → 1-5
  hot: [], // the hot-route keys (held: a receiver's key cycles his route)
  sprintKeys: [], sprintPad: [],
  global: new Map(), globalPad: new Map(), // key / button index → pause | cam | mute
  all: new Set(), // every bound key (input.js keeps the browser's own use of them away: Firefox's quick find on / and ')
  ok: "gpA", back: "gpB", // the menus' confirm and back buttons
  custom: false, // anything differs from the defaults
  ver: 0,
};
let user = { k: {}, p: {}, ab: false }; // what differs from the defaults (as saved)
const listeners = [];
export const onChange = (fn) => listeners.push(fn);

const swap = (i) => (B.swapAB && (i === 0 || i === 1) ? 1 - i : i);
const dflt = (a, dev) => (dev === "k" ? a.keys : a.move ? [] : a.pad);
const stored = (a, dev) => { const o = dev === "k" ? user.k : user.p; return Object.prototype.hasOwnProperty.call(o, a.id) ? o[a.id] : dflt(a, dev); };
const ctxOf = (a, dev) => (dev === "p" && a.pctx ? a.pctx : a.ctx);
const shares = (a, b, dev) => ctxOf(a, dev).some((s) => ctxOf(b, dev).includes(s));

export function apply() {
  B.swapAB = Boolean(user.ab);
  for (const a of ACTIONS) { B.kb[a.id] = stored(a, "k").slice(); B.pad[a.id] = a.move ? [] : stored(a, "p").map(swap); }
  for (const d of ["up", "down", "left", "right"]) B.move[d] = B.kb[d];
  B.nav.clear(); B.rec.clear(); B.recPad.clear(); B.global.clear(); B.globalPad.clear(); B.all.clear();
  for (const a of ACTIONS) {
    for (const k of B.kb[a.id]) B.all.add(k);
    if (a.move) for (const k of B.kb[a.id]) B.nav.set(k, a.move);
    if (a.rec) { for (const k of B.kb[a.id]) B.rec.set(k, a.rec); for (const i of B.pad[a.id]) B.recPad.set(PAD_NAMES[i], a.rec); }
    if (GLOBAL[a.id]) { for (const k of B.kb[a.id]) B.global.set(k, GLOBAL[a.id]); for (const i of B.pad[a.id]) B.globalPad.set(i, GLOBAL[a.id]); }
  }
  for (const k of ARROWS) B.nav.set(k, `nav${k[5].toUpperCase()}${k.slice(6)}`); // the arrows always steer the menus their own way
  B.hot = B.kb.hotRoute; B.sprintKeys = B.kb.sprint; B.sprintPad = B.pad.sprint;
  B.ok = B.swapAB ? "gpB" : "gpA"; B.back = B.swapAB ? "gpA" : "gpB";
  B.custom = B.swapAB || Object.keys(user.k).length > 0 || Object.keys(user.p).length > 0;
  B.ver++;
  for (const f of listeners) { try { f(B); } catch (e) { console.error(e); } }
}

// ---------- what can be bound ----------
const NAMED = new Set(["space", "tab", "enter", "backspace", "shift", ...ARROWS, "insert", "delete", "home", "end", "pageup", "pagedown"]);
export const keyOk = (k) => typeof k === "string" && (k.length === 1 ? k !== " " && k === k.toLowerCase() : NAMED.has(k));
export const padOk = (i) => PAD_OK.includes(i);
// a KeyboardEvent.key / input.js keyName() → the key id
export const keyId = (k) => (k === " " ? "space" : k.length === 1 ? k.toLowerCase() : String(k).toLowerCase());

// ---------- names ----------
const CAP = { space: "SPACE", tab: "TAB", enter: "ENTER", backspace: "BKSP", shift: "SHIFT", escape: "ESC", arrowup: "{up}", arrowdown: "{down}", arrowleft: "{left}", arrowright: "{right}", insert: "INS", delete: "DEL", home: "HOME", end: "END", pageup: "PG UP", pagedown: "PG DN" };
// a key's keycap text ({up} etc.: ui-art.js iconize turns them into pixel arrows)
export const keyCap = (k) => CAP[k] || String(k).toUpperCase();
export const caps = (id) => (B.kb[id] || []).map(keyCap);
export const cap = (id, sep = "/") => caps(id).join(sep);
export const glyphs = (id) => (B.pad[id] || []).map((i) => PAD_GLYPH[i]);
export const glyphOf = (id) => glyphs(id)[0] || "";
export const padName = (id) => PAD_NAMES[(B.pad[id] || [])[0]] || "";
// the five receiver keys: "1-5" while they're 1 to 5, else each one ("J K L ; '")
export function recCap(sep = " ") {
  const k = [1, 2, 3, 4, 5].map((n) => B.kb[`pass${n}`][0]);
  if (k.every((x, i) => x === String(i + 1))) return "1-5";
  return k.map((x) => (x ? keyCap(x) : "-")).join(sep);
}
export const recKey = (n) => { const k = B.kb[`pass${n}`][0]; return k ? keyCap(k) : ""; };
export const recGlyph = (n) => glyphOf(`pass${n}`);

// ---------- loading and saving ----------
function clean(raw) {
  const out = { k: {}, p: {}, ab: false };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [dev, ok, max] of [["k", keyOk, 4], ["p", padOk, 3]]) {
    const src = raw[dev];
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    for (const [id, list] of Object.entries(src)) {
      const a = BY_ID[id];
      if (!a || !Array.isArray(list) || list.length > max || (dev === "p" && a.move)) continue;
      const l = [...new Set(list.filter(ok))];
      if (l.length !== list.length) continue;
      out[dev][id] = l;
    }
  }
  out.ab = raw.ab === true || raw.ab === 1;
  return out;
}
// a saved set that clashes (hand-edited, or defaults that moved since): the saved choice keeps the key, a default loses
// it; inputs a situation keeps for itself are dropped
const own = (o, id) => Object.prototype.hasOwnProperty.call(o, id);
function settle() {
  for (const dev of ["k", "p"]) {
    const o = dev === "k" ? user.k : user.p;
    for (const a of ACTIONS) {
      if (dev === "p" && a.move) continue;
      const cur = stored(a, dev), keep = cur.filter((x) => !blocked(a, dev, x)); // (FIXED_P is the same either way round)
      if (keep.length !== cur.length) o[a.id] = keep;
    }
    for (let i = 0; i < ACTIONS.length; i++) for (let j = i + 1; j < ACTIONS.length; j++) {
      const a = ACTIONS[i], b = ACTIONS[j];
      if ((dev === "p" && (a.move || b.move)) || !shares(a, b, dev)) continue;
      for (const x of stored(a, dev).slice()) {
        if (!stored(b, dev).includes(x)) continue;
        const loser = own(o, b.id) && !own(o, a.id) ? a : b;
        o[loser.id] = stored(loser, dev).filter((y) => y !== x);
      }
    }
  }
}
// an input this action can't have (a situation of its keeps it for itself): the reason, else ""
function blocked(a, dev, x) {
  // a direction may take its own arrow (it moves as well as it steers the menus), never another one
  if (a.move && dev === "k" && ARROWS.includes(x)) return x === OWN_ARROW[a.id] ? "" : "THE ARROWS RUN THE MENUS";
  const fixed = dev === "k" ? FIXED_K : FIXED_P;
  for (const s of ctxOf(a, dev)) {
    const f = fixed[s];
    if (!f || !f.includes(x)) continue;
    if (dev === "p") return x === 4 || x === 5 ? "LB AND RB CHANGE FORMATIONS" : "A AND B RUN THE MENUS";
    if (s === "kick") return "THE ARROWS AIM KICKS";
    return x === "enter" ? "ENTER RUNS THE MENUS" : DIGITS.includes(x) ? "THE NUMBER KEYS PICK CARDS" : "THE ARROWS RUN THE MENUS";
  }
  return "";
}
let store = null;
try { store = typeof localStorage !== "undefined" ? localStorage : null; } catch (_) { /* storage blocked */ }
export function load() {
  let raw = null;
  try { raw = store ? JSON.parse(store.getItem(STORE) || "null") : null; } catch (_) { raw = null; }
  user = clean(raw);
  settle();
  apply();
}
function save() {
  if (!store) return;
  const any = user.ab || Object.keys(user.k).length || Object.keys(user.p).length;
  const out = { v: 1, k: user.k, p: user.p, ...(user.ab ? { ab: true } : {}) };
  try { if (any) store.setItem(STORE, JSON.stringify(out)); else store.removeItem(STORE); } catch (_) { /* full or blocked: this session only */ }
}
// what differs from the defaults is all that's kept (a later default change reaches every action left as it was)
function setList(a, dev, list) {
  const o = dev === "k" ? user.k : user.p;
  const d = dflt(a, dev);
  if (list.length === d.length && list.every((x, i) => x === d[i])) delete o[a.id];
  else o[a.id] = list;
}

// ---------- rebinding ----------
// rebind(action id, "k" | "p", key id | the button pressed) → { ok, msg, moved: [{ id, from, to }] }. The action
// takes that one input; another action that had it in a situation they share takes the action's old input instead
// (the first one free for it), else is left without one. The button is the one pressed: SWAP A AND B is undone for
// what's saved.
export function rebind(id, dev, x) {
  const a = BY_ID[id];
  if (!a) return { ok: false, msg: "" };
  if (dev === "k" ? !keyOk(x) : !padOk(x)) return { ok: false, msg: dev === "k" ? "THAT KEY CAN'T BE USED" : "THAT BUTTON CAN'T BE USED" };
  if (dev === "p" && a.move) return { ok: false, msg: "THE STICK AND D-PAD MOVE" };
  const why = blocked(a, dev, x);
  if (why) return { ok: false, msg: why };
  const cur = dev === "k" ? B.kb : B.pad; // in effect (pressed buttons, SWAP A AND B applied)
  const old = cur[id].slice();
  if (old.length === 1 && old[0] === x) return { ok: true, msg: "", moved: [] };
  const next = {}; // action → its new list (in effect)
  next[id] = [x];
  const clash = ACTIONS.filter((b) => b.id !== id && !(dev === "p" && b.move) && cur[b.id].includes(x) && shares(a, b, dev));
  const list = (b) => next[b.id] || cur[b.id];
  const free = (b, y) => !blocked(b, dev, y) && !ACTIONS.some((c) => c.id !== b.id && !(dev === "p" && c.move) && list(c).includes(y) && shares(b, c, dev));
  const moved = [];
  for (const b of clash) next[b.id] = cur[b.id].filter((y) => y !== x);
  for (const b of clash) {
    const give = old.find((y) => y !== x && free(b, y));
    if (give !== undefined) { const at = cur[b.id].indexOf(x); next[b.id].splice(Math.min(at, next[b.id].length), 0, give); }
    moved.push({ id: b.id, from: x, to: next[b.id].slice() });
  }
  for (const [k, l] of Object.entries(next)) setList(BY_ID[k], dev, dev === "p" ? l.map(swap) : l);
  save();
  apply();
  return { ok: true, msg: swapMsg(dev, x, moved), moved };
}
// "X WAS SPIKE · SPIKE IS NOW Y" (several: "F WAS SPIN, TACKLE · NOW W")
function swapMsg(dev, x, moved) {
  if (!moved.length) return "";
  const name = (y) => (dev === "k" ? keyCap(y) : `{pad:${PAD_GLYPH[y]}}`);
  const now = (l) => (l.length ? l.map(name).join("/") : "UNSET");
  const labels = moved.map((m) => BY_ID[m.id].label);
  if (moved.length === 1) return `${name(x)} WAS ${labels[0]} · ${labels[0]} IS NOW ${now(moved[0].to)}`;
  const same = moved.every((m) => now(m.to) === now(moved[0].to));
  return same ? `${name(x)} WAS ${labels.join(", ")} · NOW ${now(moved[0].to)}` : moved.map((m) => `${name(x)} WAS ${BY_ID[m.id].label} · NOW ${now(m.to)}`).join(" · ");
}
export function toggleSwap() { user.ab = !user.ab; save(); apply(); return B.swapAB; }
export function reset() { user = { k: {}, p: {}, ab: false }; save(); apply(); }
// which actions differ from their defaults (the remap screen marks them)
export const changed = (id, dev) => Object.prototype.hasOwnProperty.call(dev === "k" ? user.k : user.p, id);

// ---------- the controller's look: PlayStation symbols for a PlayStation pad, else Xbox letters ----------
export const padStyleOf = (id) => (/054c|dualshock|dualsense|playstation/i.test(String(id || "")) ? "ps" : "xbox");

// another tab, or cloud saves bringing this account's controls from another device: take them at once
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => { if (e.key === STORE || e.key === null) load(); });
  window.addEventListener("all22:saves", (e) => { const k = e.detail && e.detail.keys; if (!k || k.includes(STORE)) load(); });
}
load();
