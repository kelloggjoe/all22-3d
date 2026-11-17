// Keyboard and gamepad → a movement intent (polled once per frame) + named actions (pushed to handlers).
// The user's team always moves "up the screen": intent.my = +1 is up (forward), intent.mx = +1 is right.
// The player's bindings (bindings.js B) say which keys move, sprint, throw to each receiver and hold the hot route,
// and which keys and buttons pause, mute and switch the camera; every other key or button is named for what it is and
// controls.js reads it against the bindings of the moment. Every keyboard event carries key (the key id, bindings.js)
// and d (1-9 for a digit key: the menus' card numbers, whatever the bindings). Action names fired:
//   keyboard  pause (Esc, the PAUSE keys) mute cam · navUp/Down/Left/Right (the arrows and the movement keys, with
//             repeat) · enter space tab back (Backspace) · passPress{k} pass{k, lob, air} (receiver k's key: tap =
//             bullet, hold = lob) · hot{k} (a receiver's key while a HOT ROUTE key is held) · hUp{used} (a HOT ROUTE key
//             let go) · digit (6-9, and 1-5 when they don't throw) · any other key: its id ("f", "q"…: controls.js
//             matches it against the bindings; unbound ones only skip a replay, the legend's ANY KEY)
//   gamepad   gpA gpB gpX gpY gpLB gpRB gpLT gpRT gpBack gpL3 gpR3 pause(Start) + padUp{b, held} on release (a button
//             bound to pause / mute / camera fires that instead), navUp/… from the D-pad and left stick (with menu
//             auto-repeat), rs{dir} right-stick flicks
// While the remap screen waits for a key or button (capture set), the next press goes to it and nowhere else.
// Hold durations use this.t (advanced by update(dt)) so they are exact under the ?manual test clock.
import { B, PAD_NAMES, keyId, padStyleOf } from "./bindings.js";

const PAD = PAD_NAMES;
const NAV = { 12: "navUp", 13: "navDown", 14: "navLeft", 15: "navRight" };
const NAMED = { escape: "pause", enter: "enter", space: "space", tab: "tab", backspace: "back" }; // the menus' keys
const NO_DEFAULT = new Set(["space", "tab", "backspace", "shift", "enter", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
const LOB_HOLD = 0.22, LOB_FULL = 0.7;
const US_SHIFT = { "?": "/", ":": ";", '"': "'", "<": ",", ">": ".", "{": "[", "}": "]", _: "-", "+": "=", "~": "`", "|": "\\" };


// Which listed gamepad to read. A desktop can list other devices as gamepads ahead of the controller in use (a wheel
// or joystick, a virtual pad from controller software, even some keyboards and mice), and reading only the first one
// left that controller dead ("it detects that it is plugged in but no buttons work"). So the pad that last had a
// button pressed or a stick pushed is the one read; until one has, a standard-mapping pad (an Xbox or PlayStation
// controller as the browser knows it) comes before others. A stuck axis or button (a pedal, a throttle) never
// changes, so it never takes over. S: { sig: {}, active: null }, kept by the caller.
function pickPad(list, S) {
  let first = null, std = null;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || p.connected === false || !p.buttons || !p.buttons.length) continue;
    if (!first) first = p;
    if (!std && p.mapping === "standard") std = p;
    let sig = 0;
    for (let b = 0; b < p.buttons.length && b < 17; b++) { const x = p.buttons[b]; if (x && (x.pressed || x.value > 0.5)) sig |= 1 << b; }
    const axes = p.axes || [];
    for (let a = 0; a < 4 && a < axes.length; a++) { if (axes[a] > 0.6) sig |= 1 << (17 + 2 * a); else if (axes[a] < -0.6) sig |= 1 << (18 + 2 * a); }
    const was = S.sig[p.index];
    S.sig[p.index] = sig;
    if (was !== undefined && sig !== was && sig !== 0) S.active = p.index; // something new pressed or pushed on it
  }
  const act = S.active != null ? list[S.active] : null;
  return act && act.connected !== false && act.buttons && act.buttons.length ? act : std || first;
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.intent = { mx: 0, my: 0, sprint: false };
    this.handlers = [];
    this.passDown = new Map();
    this.idle = 99;
    this.t = 0;
    this.isTouch = false; // (a desktop game: keyboard, mouse and gamepad)
    this.device = "keyboard"; // last device used (legend glyphs): keyboard or gamepad
    this.pad = { prev: new Array(17).fill(false), t0: new Array(17).fill(0), as: new Array(17).fill(""), id: "", nav: null, navT: 0, rs: null, connected: false, pick: { sig: {}, active: null } };
    this.padStyle = "xbox"; // the controller's look for hints: "ps" (PlayStation symbols) or "xbox" (bindings.js padStyleOf)
    this.hotUsed = false;
    this.capture = null; // the remap screen's handler for the next press ({dev: "k", id} | {dev: "p", i}), or null
    this.capKey = null; // the key it took (its keyup is swallowed too)
    this.used = new Set(); // receiver / hot-route keys whose press did something else (a SNAP on 1): their release doesn't throw or open HOT ROUTE (markUsed)
    this.unshifted = {}; // KeyboardEvent.code → the key's character without Shift (keyName)
    this.deviceListeners = [];
    this.sprintMode = "hold"; // SPRINT STYLE (settings.sprintMode): "hold", or "toggle" (a tap latches it until the whistle)
    this.sprintLatched = false;
    if (typeof window === "undefined") return;
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => { this.keys.clear(); this.passDown.clear(); this.used.clear(); this.capKey = null; });
    window.addEventListener("pointerdown", () => { this.idle = 0; }, { capture: true, passive: true }); // (a tap or a click is the human acting: clock-ff.js)
    window.addEventListener("gamepadconnected", (e) => { this.pad.id = e.gamepad && e.gamepad.id || "GAMEPAD"; this.pad.connected = true; this.setStyle(); this.setDevice("gamepad"); this.fire("padConnected", { id: this.pad.id }); });
    window.addEventListener("gamepaddisconnected", () => { this.pad.connected = false; this.fire("padDisconnected"); if (this.device === "gamepad") this.setDevice("keyboard"); });
  }
  on(fn) { this.handlers.push(fn); }
  onDevice(fn) { this.deviceListeners.push(fn); }
  setDevice(d) { if (this.device === d) return; this.device = d; for (const f of this.deviceListeners) f(d); }
  // a PlayStation pad shows PlayStation symbols (the listeners repaint what's showing)
  setStyle() { const s = padStyleOf(this.pad.id); if (s === this.padStyle) return; this.padStyle = s; for (const f of this.deviceListeners) f(this.device); }
  fire(name, arg) { this.idle = 0; for (const h of this.handlers) h(name, arg || {}); }
  held(k) { return this.keys.has(k); }
  // a HOT ROUTE key is down (a receiver's key then cycles his route instead of throwing)
  hotHeld() { const h = B.hot; for (let i = 0; i < h.length; i++) if (this.keys.has(h[i])) return true; return false; }
  setSprintMode(mode) { this.sprintMode = mode === "toggle" ? "toggle" : "hold"; this.sprintLatched = false; }
  resetSprintToggle() { this.sprintLatched = false; }
  anyHeld(list) { for (let i = 0; i < list.length; i++) if (this.keys.has(list[i])) return true; return false; }
  // a key's press did something else than its release would (a receiver's key bound to SNAP at the line, the HOT ROUTE
  // key calling the play): its release then does nothing (controls.js marks them)
  markUsed(k) { if (k && (B.rec.has(k) || B.hot.includes(k)) && this.keys.has(k)) this.used.add(k); }

  // ---------- keyboard ----------
  keyName(e) {
    const c = e.code || "";
    if (/^Digit[0-9]$/.test(c)) return c[5]; // physical digits: Shift+1 (sprinting) still throws, AZERTY works
    if (/^Numpad[0-9]$/.test(c)) return c[6];
    const k = e.key;
    if (!k || k.length !== 1) return k;
    // Shift (sprinting) changes a punctuation key's character ("/" → "?"): a key bound to one still works, read as
    // it reads without Shift (learned from the key's last unshifted press; a US layout's pairs until then)
    if (e.shiftKey && c) { const u = this.unshifted[c] || US_SHIFT[k]; if (u) return u; }
    else if (c) this.unshifted[c] = k.toLowerCase();
    return k.toLowerCase();
  }
  onKey(e, down) {
    const tg = e.target;
    if (tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.isContentEditable)) return;
    // macOS drops other keys' keyups while Cmd is down (Cmd+Shift+4 mid-play): Cmd's own keyup lets go of them all
    if (!down && e.key === "Meta") { this.keys.clear(); this.passDown.clear(); this.used.clear(); this.capKey = null; return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
    const k = this.keyName(e), id = keyId(k);
    // the remap screen is waiting for a key: this one is the answer (Esc: it cancels), and nothing else sees it
    if (this.capture && down) { e.preventDefault(); this.setDevice("keyboard"); if (!e.repeat) { this.capKey = id; const f = this.capture; f({ dev: "k", id }); } return; }
    if (!down && this.capKey === id) { this.capKey = null; e.preventDefault(); return; }
    if (NO_DEFAULT.has(id) || B.all.has(id) || B.nav.has(id)) e.preventDefault();
    const d = k.length === 1 && k >= "1" && k <= "9" ? +k : 0;
    if (down) {
      this.setDevice("keyboard");
      if (this.keys.has(id)) { const nv = B.nav.get(id); if (e.repeat && nv) this.fire(nv, { repeat: true, key: id, d }); return; }
      this.keys.add(id);
      this.idle = 0;
      if (this.sprintMode === "toggle" && B.sprintKeys.includes(id)) this.sprintLatched = !this.sprintLatched;
      const rec = B.rec.get(id);
      if (rec) {
        if (this.hotHeld()) { this.hotUsed = true; this.fire("hot", { k: rec, key: id, d }); return; }
        this.passDown.set(id, [this.t, rec]);
        this.fire("passPress", { k: rec, key: id, d });
        return;
      }
      if (B.hot.includes(id)) this.hotUsed = false;
      const name = id === "escape" ? "pause" : B.global.get(id) || B.nav.get(id) || NAMED[id] || (d ? "digit" : id);
      this.fire(name, { key: id, d, k: d || undefined });
    } else {
      this.keys.delete(id);
      if (this.used.delete(id)) { this.passDown.delete(id); return; }
      if (B.hot.includes(id)) { if (!this.hotHeld()) this.fire("hUp", { used: this.hotUsed }); return; }
      const pd = this.passDown.get(id);
      if (pd) {
        const held = Math.max(0, this.t - pd[0]);
        this.passDown.delete(id);
        this.fire("pass", passArgs(pd[1], held));
      }
    }
  }

  // ---------- per-frame poll ----------
  update(dt) {
    this.t += dt;
    this.idle += dt;
    let mx = 0, my = 0;
    const M = B.move;
    if (this.anyHeld(M.left)) mx -= 1;
    if (this.anyHeld(M.right)) mx += 1;
    if (this.anyHeld(M.up)) my += 1;
    if (this.anyHeld(M.down)) my -= 1;
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    const toggle = this.sprintMode === "toggle";
    let sprint = toggle ? this.sprintLatched : this.anyHeld(B.sprintKeys);
    const gp = this.pollPad(dt);
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, m = Math.hypot(ax, ay);
      if (m > 0.2) { const s = Math.min(1, (m - 0.2) / 0.75) / m; mx = ax * s; my = -ay * s; }
      else {
        const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
        const dx = (b(15) ? 1 : 0) - (b(14) ? 1 : 0), dy = (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
        if (dx || dy) { const s = dx && dy ? Math.SQRT1_2 : 1; mx = dx * s; my = dy * s; }
      }
      const sp = B.sprintPad;
      if (!toggle) for (let i = 0; i < sp.length; i++) { const rt = gp.buttons[sp[i]]; if (rt && (rt.pressed || rt.value > 0.3)) sprint = true; }
    }
    if (Math.hypot(mx, my) > 0.15) this.idle = 0;
    this.intent.mx = mx; this.intent.my = my; this.intent.sprint = sprint;
    return this.intent;
  }
  // Standard-mapping gamepad: button edges → actions (+ release with hold time), D-pad/left-stick menu navigation with
  // auto-repeat, right-stick flicks. Returns the pad (or null).
  pollPad(dt) {
    const nav = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : null;
    const P = this.pad;
    const gp = nav ? pickPad(nav, P.pick) : null;
    if (!gp) { if (P.prev.some(Boolean)) P.prev.fill(false); P.nav = null; return null; }
    if (!P.connected || P.id !== (gp.id || "GAMEPAD")) { P.connected = true; P.id = gp.id || "GAMEPAD"; this.setStyle(); }
    for (let i = 0; i < PAD.length; i++) {
      const b = gp.buttons[i];
      const now = Boolean(b && (b.pressed || b.value > 0.5));
      if (now !== P.prev[i]) {
        P.prev[i] = now;
        if (now) {
          P.t0[i] = this.t; this.setDevice("gamepad");
          // the remap screen is waiting for a button: this press is the answer (START / the D-pad: it cancels)
          if (this.capture) { P.as[i] = ""; if (NAV[i]) { P.nav = NAV[i]; P.navT = 0.34; } const f = this.capture; f({ dev: "p", i }); continue; }
          if (this.sprintMode === "toggle" && B.sprintPad.includes(i)) this.sprintLatched = !this.sprintLatched;
          const g = B.globalPad.get(i); // a button bound to pause / mute / camera
          P.as[i] = g ? "" : PAD[i];
          if (g) this.fire(g, { b: i });
          else if (PAD[i]) this.fire(PAD[i]); else if (NAV[i]) { this.fire(NAV[i]); P.nav = NAV[i]; P.navT = 0.34; }
        }
        else if (P.as[i]) { this.fire("padUp", { b: P.as[i], held: this.t - P.t0[i] }); P.as[i] = ""; }
        else if (NAV[i] && P.nav === NAV[i]) P.nav = null;
      }
    }
    // left stick as menu navigation (auto-repeat), D-pad repeat
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    let sdir = null;
    if (Math.abs(ax) > 0.62 || Math.abs(ay) > 0.62) sdir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? "navRight" : "navLeft") : (ay > 0 ? "navDown" : "navUp");
    const dpad = [12, 13, 14, 15].find((i) => P.prev[i]);
    const dir = dpad != null ? NAV[dpad] : sdir;
    if (dir && dir !== P.nav) { P.nav = dir; P.navT = 0.34; if (dpad == null) { this.setDevice("gamepad"); this.fire(dir, { stick: true }); } }
    else if (dir && dir === P.nav) { P.navT -= dt; if (P.navT <= 0) { P.navT = 0.11; this.fire(dir, { repeat: true, stick: dpad == null }); } }
    else if (!dir) P.nav = null;
    // right-stick flick (juke / truck / hit stick)
    const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0, rm = Math.hypot(rx, ry);
    if (rm > 0.72 && !P.rs) { P.rs = Math.abs(rx) > Math.abs(ry) ? (rx > 0 ? "right" : "left") : (ry > 0 ? "down" : "up"); this.setDevice("gamepad"); this.fire("rs", { dir: P.rs }); }
    else if (rm < 0.35) P.rs = null;
    if (Math.hypot(ax, ay) > 0.2) this.setDevice("gamepad");
    return gp;
  }
}
function passArgs(k, held) { return { k, lob: held > LOB_HOLD, air: Math.min(1, held / LOB_FULL) }; }
export function keyCap(key) {
  return ({ " ": "SPACE", Escape: "ESC", Tab: "TAB" })[key] || String(key || "?").toUpperCase();
}
export const PASS_HOLD = { LOB_HOLD, LOB_FULL };
