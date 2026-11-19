// Controls: maps input actions (keyboard / gamepad, see input.js) to menu navigation and WORLD COMMANDS
// (w.action(name, arg), w.hotRoute, w.callTimeout, w.audible …) by CONTEXT. CONTEXTS is the single source of truth for
// what each control does in each situation: the touch buttons' labels (ui-touch.js), the HUD control legend (hud.js)
// and the How to Play pages all read it. Each binding names its action in the player's bindings (bindings.js), which
// fill in its keys, buttons and legend cap (applyBindings, again whenever they change). Mixed into App.prototype by
// main.js (methods run with this = app).
import { HOT_ROUTES, ELIGIBLE } from "./playbook.js";
import { B, onChange, PAD_NAMES, PAD_GLYPH, cap, recCap } from "./bindings.js";

// binding: act (Controls method below), label, touch slot (A/B/X/Y diamond, P = small pill), the action it's bound to
// (bindings.js: its key ids and pad button names, and the key caps shown in the legend), when(w, app) → available now.
// hide: dispatch only (no legend, no touch button).
const b = (act, label, touch, bind, when, o) => ({ act, label, touch, bind, keys: [], pad: [], cap: "", when, ...o });
const live2 = (w) => w.playType === "normal" || w.playType === "two";
const timeoutOk = (w) => w.timeouts[w.user] > 0 && !w.ot;
const clockPlay = (w) => Boolean(w.call.off && w.call.off.clock); // a spike or a kneel (playbook.js CLOCK_PLAYS)
export const CONTEXTS = {
  presnapO: [
    b("snap", "SNAP", "A", "snap"),
    b("audibleMenu", "AUDIBLE", "B", "audible", (w) => w.playType === "normal" && !clockPlay(w)),
    b("hotMenu", "HOT ROUTE", "X", "hotRoute", (w) => !clockPlay(w) && live2(w), { noKeys: true }), // the keys: a tap (hUp) or held with a receiver's key (hot). (Not at a fake punt's or field goal's line: its routes are its own)
    b("timeout", "TIMEOUT", "Y", "timeout", timeoutOk),
    b("spike", "SPIKE", "P", "spike", (w) => w.canSpike() && !clockPlay(w)), // the clock is running: spike it instead
  ],
  presnapD: [
    b("cycle", "SWITCH", "A", "switchPre"),
    // (a defensive audible: the AUDIBLE key or button opens its menu — ui-playcall.js showDefAudible)
    b("defAudible", "AUDIBLE", "B", "audible", (w) => Boolean(w.call.def && w.call.off) && !clockPlay(w)),
    b("timeout", "TIMEOUT", "Y", "timeout", timeoutOk),
  ],
  meter: [
    b("kick", "KICK", "A", "kick"),
    b("aimL", "{left} AIM", "X", null, (w, app) => app.hud.meterS && app.hud.meterS.phase === 0),
    b("aimR", "AIM {right}", "B", null, (w, app) => app.hud.meterS && app.hud.meterS.phase === 0),
    b("kickType", "KICK TYPE", "Y", "kickType", (w, app) => w.playType === "kickoff" && app.hud.meterS && app.hud.meterS.phase === 0),
  ],
  pocket: [
    b("throwAway", "THROW AWAY", "P", "throwAway"),
  ],
  carrier: [
    b("juke", "JUKE", "A", "juke"),
    b("jukeL", "JUKE", null, "jukeL", null, { hide: true }),
    b("jukeR", "JUKE", null, "jukeR", null, { hide: true }),
    b("spin", "SPIN", "B", "spin"),
    b("stiff", "STIFF ARM", "X", "stiff"),
    b("truck", "TRUCK", "Y", "truck"),
    b("kneel", "KNEEL", "P", "dive", (w) => inOwnEndZone(w)),
    b("dive", "DIVE", "P", "dive", (w) => !inOwnEndZone(w)),
    b("lateral", "LATERAL", "P", "lateral"), // (world.lateral: to the nearest teammate behind the ball)
  ],
  defense: [
    b("tackle", "TACKLE", "A", "tackle"),
    b("switch", "SWITCH", "B", "switch"),
    b("hitstick", "HIT STICK", "X", "hitstick"),
    b("swat", "SWAT", "Y", "swat"),
  ],
  coverage: [
    b("tackle", "TACKLE", "A", "tackle", (w) => Boolean(w.control)),
    b("switch", "SWITCH", "B", "switch"),
    b("hitstick", "HIT STICK", "X", "hitstick", (w) => Boolean(w.control)),
  ],
  returner: [
    b("fairCatch", "FAIR CATCH", "Y", "fairCatch", (w) => w.playType === "punt" && w.ball.state === "air" && !w.fairCatch),
  ],
};
// label variants resolved once per binding change (bindings() reuses objects: no per-frame allocation)
const VARIANT = { dive: {}, kickType: {} };
// gamepad face buttons → receiver icons in the pocket (Madden): B.recPad (button name → 1-5)
// the same buttons by receiver (1-5): render.js shows them over the receivers while a controller is in hand
export const padRecLabels = () => [1, 2, 3, 4, 5].map((n) => { const i = B.pad[`pass${n}`][0]; return i == null ? "" : PAD_GLYPH[i]; });
// fills every binding's keys, pad buttons and cap from the player's bindings (and the label variants)
export function applyBindings() {
  for (const list of Object.values(CONTEXTS)) {
    for (const x of list) {
      if (!x.bind) { x.keys = []; x.pad = []; x.cap = x.act === "aimL" ? "{left}{right}" : ""; continue; }
      x.keys = x.noKeys ? [] : B.kb[x.bind];
      x.pad = B.pad[x.bind].map((i) => PAD_NAMES[i]);
      x.cap = x.act === "hotMenu" ? (cap("hotRoute") ? `${cap("hotRoute")}+${recCap("")}` : "") : x.act === "juke" ? [cap("jukeL"), cap("jukeR"), cap("juke")].filter(Boolean).join("/") : cap(x.bind);
    }
  }
  for (const lab of ["DIVE", "SLIDE"]) VARIANT.dive[lab] = { ...CONTEXTS.carrier.find((x) => x.act === "dive"), label: lab };
  for (const t of ["normal", "squib", "onside"]) VARIANT.kickType[t] = { ...CONTEXTS.meter.find((x) => x.act === "kickType"), label: `${t.toUpperCase()} KICK` };
}
applyBindings();
onChange(applyBindings);
// right-stick flicks (Madden style) per context
const RS = { carrier: { left: "jukeL", right: "jukeR", up: "truck", down: "spin" }, defense: { up: "hitstick", down: "tackle" }, coverage: { up: "hitstick" } };
// the timeout keys and buttons between plays (the presnap's TIMEOUT binding, also in the dead ball after a play)
const isTimeout = (n, a) => (a && a.key ? B.kb.timeout.includes(a.key) : B.pad.timeout.some((i) => PAD_NAMES[i] === n));
// the KICK and SNAP keys and buttons: in a timeout's wait they skip it (Controls.skippable)
const isKick = (n, a) => (a && a.key ? B.kb.kick.includes(a.key) : B.pad.kick.some((i) => PAD_NAMES[i] === n));
const isSnap = (n, a) => (a && a.key ? B.kb.snap.includes(a.key) : B.pad.snap.some((i) => PAD_NAMES[i] === n));
// a legend entry's key or button that skips a timeout's wait (hud.js legend: it says SKIP then)
export const skipsWait = (key, pad) => (key ? B.kb.snap.includes(key) || B.kb.kick.includes(key) : Boolean(pad) && (B.pad.snap.some((i) => PAD_NAMES[i] === pad) || B.pad.kick.some((i) => PAD_NAMES[i] === pad)));
// a timeout in the dead ball only stops a running clock (world.clockRunning: after a score, a turnover, an incompletion
// or out of bounds late in a half the clock is stopped anyway, so T or BACK there would only waste one)
const clockRuns = (w) => w.clockRunning();
// events that are releases / repeats, not fresh presses (they never skip a replay)
const RELEASES = new Set(["padUp", "hUp", "pass", "rs"]);
export const ROUTE_LABEL = { go: "STREAK", slant: "SLANT", out: "OUT", curl: "CURL", block: "BLOCK", quickOut: "QUICK OUT", bootFlat: "BOOT FLAT" }; // (other routes: their name)
// Taps and clicks on the field, in render-buffer px (an art pixel: about a CSS px on a phone, 2 or more on a desktop or
// a tablet). PAD: the slack ON a sprite (head to feet) or a pass icon. ICON: a pass icon's old reach from its centre,
// kept for a tap NEAR one. REACH, in CSS px (a thumb is as big on any screen): a defender's — one of yours a tap nearly
// hits is still the one (they're small on the ALL-22 camera, and a thumb covers more than it touches)
const TAP = { PAD: 2, ICON: 13, REACH: 10 };
// how far point (x, y) is from the box [x0, x1] × [y0, y1] along the farther axis (0 inside): a tap's distance from a
// sprite or a pass icon (render.js pickPlayer too)
export const tapDist = (x, y, x0, y0, x1, y1) => Math.max(x0 - x, x - x1, y0 - y, y - y1, 0);

// a returner in his own end zone who caught it there: KNEEL is a touchback (carried in from the field it'd be a safety)
function inOwnEndZone(w) {
  const c = w.control;
  return Boolean(c && c.hasBall && (w.playType === "kickoff" || w.playType === "punt") && c.side === "D" && c.x >= 100 && w.inEndZoneSince());
}

export class Controls {
  // ---------- context ----------
  // none · replay · meter · presnapO · presnapD · returnWait · pocket · carrier · defense · coverage · returner · offNoBall
  ctx() {
    const w = this.world;
    if (!w || this.mode !== "game" || this.paused) return "none";
    if (this.replayActive) return "replay";
    if (w.autopilot) return "none";
    const c = w.control, ph = w.phase, kick = w.playType === "kickoff" || w.playType === "punt";
    if (ph === "presnap") {
      if (this.hud.meterS) return "meter";
      if (w.waitUser === "snap") return "presnapO";
      if (w.userSide() === "D" && live2(w)) return "presnapD";
      if (kick && c && c === w.returner) return "returnWait";
      return "none";
    }
    if (ph !== "live") return "none";
    if (!c) return kick && w.user === w.possession && w.kicked ? "coverage" : "none";
    if (c.hasBall) {
      if (c === w.qb && live2(w) && w.call.off && w.call.off.type === "pass" && !w.passThrown && !w.losCrossed) return "pocket";
      return "carrier";
    }
    if (kick && c === w.returner && !w.ball.carrier) return "returner";
    if (kick && w.user === w.possession) return "coverage";
    if (w.userSide() === "D" || w.userChasing()) return "defense";
    return "offNoBall";
  }
  // the bindings available right now (labels resolved) in a reused array — read it before the next call
  bindings(ctx = this.ctx()) {
    const out = this._binds || (this._binds = []);
    out.length = 0;
    const list = CONTEXTS[ctx];
    if (!list) return out;
    const w = this.world;
    for (const x of list) if (!x.when || x.when(w, this)) out.push(x.act === "dive" ? VARIANT.dive[this.diveLabel()] : x.act === "kickType" ? VARIANT.kickType[this.nextKickType()] : x);
    return out;
  }
  diveLabel() { return "DIVE"; } // (Snack League: everyone dives, the QB too)

  // ---------- input dispatch ----------
  onInput(n, a) {
    this.audio.unlock();
    if (n === "padConnected") { this.ui.toast("GAMEPAD CONNECTED"); return; }
    if (n === "padDisconnected") { this.ui.toast("GAMEPAD DISCONNECTED"); return; }
    if (n === "mute") { this.toggleMute(); this.ui.syncMute(); return; }
    if (this.scout && this.scout.blocking) { if (n !== "padConnected" && !(a && a.repeat)) this.scout.press(); return; } // a Scout Challenge card holds the game
    if (n === "ffwd" && this.mode === "game" && this.world && !this.paused && !this.ui.screen) { this.toggleFFBoost(); return; } // (elsewhere B is just B)
    // menus, panels, title. A receiver's or the HOT ROUTE key whose press a panel acted on (it closed or changed:
    // COACH'S PICK on H) doesn't throw or open HOT ROUTE as it comes back up (input.js markUsed)
    const pm = this.ui.panelMode;
    if (this.ui.handle(n, a || {})) { if (a && a.key && !(a.repeat) && this.ui.panelMode !== pm) this.input.markUsed(a.key); return; }
    const w = this.world;
    if (this.mode !== "game" || !w) return;
    if (n === "cam") { this.cycleCam(); return; }
    if (n === "pause") { if (this.replayActive || this.pendingReplay != null) { this.pendingReplay = null; this.endReplay(); return; } this.pause(); return; }
    if (this.replayActive || this.pendingReplay != null) {
      if (!RELEASES.has(n) && !(a && a.repeat)) { this.pendingReplay = null; this.endReplay(); }
      // the replay holds the dead ball: T still stops the clock (not while the CPU plays both teams of a Franchise game:
      // it coaches them, timeouts included)
      if (isTimeout(n, a) && w.phase === "dead" && w.phaseT > 0.3 && clockRuns(w)) this.timeout();
      return;
    }
    const ctx = this.ctx();
    // pocket: receivers by key (input.js: their keys fire pass) or pad (B.recPad: A/B/X/Y/RB, hold = lob)
    if (ctx === "pocket") {
      if (n === "pass") { this.doPass(a.k, a.lob, a.air); return; }
      if (B.recPad.has(n)) { this.padHold = n; return; }
      if (n === "padUp" && this.padHold === a.b) { const held = a.held || 0; this.padHold = null; this.doPass(B.recPad.get(a.b), held > 0.22, Math.min(1, held / 0.7)); return; }
    }
    if (n === "padUp") { if (this.padHold === a.b) this.padHold = null; return; }
    // presnap offense extras
    if (ctx === "presnapO" && live2(w)) {
      if (n === "hot") { this.hotKey(a.k); return; }
      if (n === "hUp") { if (!a.used) this.hotMenu(); return; }
    }
    if (n === "rs" && RS[ctx] && RS[ctx][a.dir]) { this.run(RS[ctx][a.dir]); return; }
    // a timeout's wait: SNAP or KICK skips it, keys and buttons, wherever you are between plays — at the line, on
    // defense (the SNAP key's SWITCH waits for the wait: hud.js's legend says SKIP), the kicker with no meter up yet, the
    // dead ball, or a click on the timeout's bar (ui.js). Online it's your READY
    if (this.skippable() && (isSnap(n, a) || isKick(n, a))) { if (a && a.key) this.input.markUsed(a.key); this.skipWait(); return; }
    if (ctx === "meter" && (n === "navLeft" || n === "navRight")) { this.run(n === "navLeft" ? "aimL" : "aimR"); return; }
    // keyboard (the key's id) / gamepad (the button's name) bindings
    const key = a && a.key;
    for (const x of this.bindings(ctx)) if (key ? x.keys.includes(key) : x.pad.includes(n)) { if (key) this.input.markUsed(key); this.run(x.act); return; }
    // between plays: a timeout (T, the pad's BACK) in the dead ball after a play — to stop the clock before the runoff
    // ends the half, as the CPU does — the play call and the presnap; not once a kick's swing has started on the meter,
    // nor in the first moments after the whistle (a TRUCK still being mashed)
    const between = w.phase === "playcall" || w.phase === "presnap" || (w.phase === "dead" && w.phaseT > 0.3 && clockRuns(w));
    if (isTimeout(n, a) && between && !(this.hud.meterS && this.hud.meterS.phase > 0)) this.timeout();
  }
  run(act) { if (typeof this[`do_${act}`] === "function") this[`do_${act}`](); }

  // ---------- actions ----------
  // (in a timeout's wait nobody snaps: world.timeoutWait — SNAP skips it instead)
  do_snap() { if (this.world.timeoutWait() > 0) this.skipWait(); else this.world.action("snap"); }
  do_spike() { if (this.world.timeoutWait() > 0) this.skipWait(); else this.world.action("spike"); }
  // a timeout's wait you can still skip: not in the first moments after the whistle (a JUKE or a TACKLE still being
  // mashed from the play, as for T), online not once you're READY (then your keys do what they always do; net/online.js
  // readySent: pressed, on its way to the server)
  skippable() {
    const w = this.world, on = this.online;
    return Boolean(w) && !w.autopilot && w.timeoutWait() > 0 && !(w.phase === "dead" && w.phaseT <= 0.3) && !(w.timeoutReady && w.timeoutReady[w.user]) && !(on && on.readySent && on.readySent(w));
  }
  // SKIP the wait (world.skipTimeout): over at once (the referee's whistle: timeoutEnd), only the wait — the clocks, the
  // calls and a kick waiting to go as when it runs out. Online it's your READY, a blip: over once your friend's ready too
  skipWait() {
    const w = this.world;
    if (!this.skippable() || !w.skipTimeout(w.user)) return false;
    if (w.timeoutWait() > 0) this.audio.sfx("blip");
    return true;
  }
  do_cycle() { this.world.action("switch"); }
  do_switch() { this.world.action("switch"); }
  do_timeout() { this.timeout(); }
  // the 'timeout' bus event announces a granted timeout (hud.js); only refusals are toasted here
  timeout() {
    const w = this.world;
    if (w.callTimeout(w.user)) return;
    this.ui.toast(w.timeoutWait() > 0 && w.timeoutBy === w.user ? "YOUR TIMEOUT IS ON" : w.timeouts[w.user] > 0 && !w.ot ? "NOT NOW" : "NO TIMEOUTS LEFT");
  }
  do_audibleMenu() { const w = this.world; if (w.phase === "presnap" && w.playType === "normal" && w.call.off) this.ui.call.showAudible(w); }
  do_defAudible() { const w = this.world; if (w.phase === "presnap" && live2(w) && w.userSide() === "D" && w.call.def && w.call.off && !clockPlay(w)) this.ui.call.showDefAudible(w); }
  do_hotMenu() { this.hotMenu(); }
  hotMenu() { const w = this.world; if (w.phase === "presnap" && w.waitUser === "snap") this.ui.call.showHot(w, null); }
  // H + digit: opens that receiver's route cards; again (H still held / menu open) cycles his route (applied at once)
  hotKey(k) {
    const w = this.world;
    const rec = hotList(w)[k - 1];
    if (!rec) return;
    if (this.ui.panelMode === "hot" && this.ui.call.hotRec === rec) {
      const cur = HOT_ROUTES.indexOf(currentRoute(w, rec));
      this.applyHot(rec, HOT_ROUTES[(cur + 1) % HOT_ROUTES.length], true);
    } else this.ui.call.showHot(w, rec);
  }
  applyHot(rec, route, keepOpen) {
    const w = this.world;
    w.hotRoute(rec.slot, route);
    this.playArt.build(w);
    this.audio.sfx("blip");
    this.ui.toast(`HOT ROUTE · ${rec.slot} ${ROUTE_LABEL[route] || route.toUpperCase()}`, 1100);
    if (keepOpen) this.ui.call.showHot(w, rec, true); else { this.ui.hidePanel(); }
  }
  do_kick() { this.hud.meterPress(); }
  do_aimL() { this.aim(-1); }
  do_aimR() { this.aim(1); }
  aim(d) {
    const m = this.hud.meterS;
    if (!m || m.phase !== 0) return;
    m.aim = Math.max(-1, Math.min(1, m.aim + d * 0.25));
    this.audio.sfx("blip");
  }
  do_kickType() { this.setKickType(this.nextKickType()); }
  nextKickType() { const t = this.kickType(); return t === "normal" ? "squib" : t === "squib" ? "onside" : "normal"; }
  // the kickoff type for THIS kick: the user's call (scoped to the play number), else the world's kickoff flags
  kickType() {
    const w = this.world, kc = this.kickCall;
    if (kc && w && kc.w === w && kc.n === w.playNo) return kc.type;
    return w && w.onside ? "onside" : w && w.squib ? "squib" : "normal";
  }
  // kickoff type: the world API (football team) when present, else the world's kickoff flags
  setKickType(type) {
    const w = this.world;
    w.action("kickType", { type });
    if (typeof w.specialCalls !== "function") { w.onside = type === "onside"; w.squib = type === "squib"; }
    this.kickCall = { w, n: w.playNo, type };
    this.ui.toast(`${type.toUpperCase()} KICK`, 900);
  }
  do_throwAway() {
    const w = this.world;
    w.action("throwAway"); // the world checks it (user QB, still in the pocket, before a pass)
    if (w.thrownAway) this.ui.toast("THROWN AWAY", 900);
  }
  doPass(k, lob, air) {
    const w = this.world;
    if (!w.passTargets()[k - 1]) return;
    w.action("pass", { k, lob: Boolean(lob), air: air || 0 });
  }
  // (in the World's screen terms: the stick as the World has it, turned with the view on a return: camera3d.js stickFor)
  jukeSide() {
    const w = this.world, p = w.control, mx = this.cam.stickOut.mx;
    if (Math.abs(mx) > 0.3) return mx > 0 ? 1 : -1;
    // no stick: juke away from the nearest defender (screen-relative)
    let best = null, bd = 1e9;
    for (const d of w.players) if (d.side !== p.side && d.canAct) { const dd = d.dist(p); if (dd < bd) { bd = dd; best = d; } }
    if (!best) return 1;
    const relX = -(best.y - p.y) * w.screenDir();
    return relX > 0 ? -1 : 1;
  }
  do_juke() { this.world.action("juke", { side: this.jukeSide() }); }
  // JUKE LEFT / RIGHT: the screen's left and right, as the World reads them (the other way round while the view is turned)
  do_jukeL() { this.world.action("juke", { side: -this.cam.screenSign(this.world) }); }
  do_jukeR() { this.world.action("juke", { side: this.cam.screenSign(this.world) }); }
  do_spin() { this.world.action("spin"); }
  do_stiff() { this.world.action("stiff"); }
  do_truck() { this.world.action("truck"); }
  do_lateral() {
    const to = this.world.action("lateral");
    this.ui.toast(to ? `LATERAL · ${to.name.toUpperCase()}` : "NO TEAMMATE BEHIND", 900);
  }
  do_dive() { this.world.action("dive"); }
  do_kneel() {
    const w = this.world;
    w.action("kneel"); // returner in his own end zone, kickoffs and punts → touchback
    if (w.returnKneel) this.ui.toast("KNEEL \u00b7 TOUCHBACK", 900);
  }
  do_tackle() { this.world.action("tackle"); }
  do_hitstick() { this.world.action("hitstick"); }
  do_swat() { this.world.action("swat"); }
  do_fairCatch() { this.world.action("fairCatch"); if (this.world.fairCatch) this.ui.toast("FAIR CATCH CALLED", 900); }

  // V, the HUD's camera button and the pause menu: the next camera for the side the human is on this play (the OFFENSE
  // or DEFENSE CAMERA in Settings; camera3d.js picks the side as each play is set up)
  cycleCam() {
    const order = ["pro", "zoom", "all22"], k = this.cam.onD ? "camD" : "cam";
    const next = order[(order.indexOf(this.camMode) + 1) % order.length];
    this.setSetting(k, next);
    this.ui.toast(`${k === "camD" ? "DEFENSE" : "OFFENSE"} CAMERA · ${next === "all22" ? "ALL-22" : next.toUpperCase()}`, 900);
  }

  // ---------- taps / clicks on the field: receivers, defenders ----------
  bufPoint(clientX, clientY) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    return [(clientX * dpr) / this.r.s, (clientY * dpr) / this.r.s];
  }
  bufLen(css) { return (css * Math.min(3, window.devicePixelRatio || 1)) / this.r.s; } // CSS px → buffer px
  // The receiver a tap or click here throws to (no side effects) → { it (his pass icon), body } or null. The QB in the
  // pocket: ON a pass icon first (icons are drawn over everything: where two overlap, the one drawn last), then ON a
  // receiver's sprite, head to feet (body: where two overlap, the one drawn on top — a receiver's feet beside another's
  // icon are his), then NEAR an icon (the old target: within TAP.ICON of its centre, the nearest) — but never past
  // another receiver's sprite nearer the point. Elsewhere: nobody.
  recAt(clientX, clientY) {
    const icons = this.hud.icons;
    if (!icons || this.mode !== "game" || !this.world || this.world.phase !== "live") return null; // presnap icons are display-only
    const [bx, by] = this.bufPoint(clientX, clientY);
    let best = null;
    for (const it of icons) if (it.sx != null && tapDist(bx, by, it.x0, it.y0, it.x1, it.y1) <= TAP.PAD) best = it;
    if (best) return { it: best, body: false };
    const hit = this.tapHit || (this.tapHit = { on: false, d: 0 });
    const p = this.r.pickPlayer(this.cam, bx, by, (q) => icons.some((it) => it.p === q), TAP.PAD, Infinity, hit);
    if (p && hit.on) return { it: icons.find((it) => it.p === p), body: true };
    let bd = Infinity;
    for (const it of icons) if (it.sx != null && Math.max(Math.abs(it.sx - bx), Math.abs(it.sy - by)) < TAP.ICON) { const d = tapDist(bx, by, it.x0, it.y0, it.x1, it.y1); if (d < bd) { bd = d; best = it; } }
    return best && !(p && p !== best.p && hit.d < bd) ? { it: best, body: false } : null;
  }
  // a click on a receiver throws to him
  tryIconTap(clientX, clientY) {
    const hit = this.recAt(clientX, clientY);
    if (!hit) return false;
    this.doPass(hit.it.k, false, 0);
    return true;
  }
  // The defender a tap or click here would take, or null (no side effects): one of the user's own, while SWITCH works
  // on defense — at the line before the snap, in a live scrimmage play. ON one (where two overlap, the one drawn on
  // top), else the nearest within TAP.REACH.
  defAt(clientX, clientY) {
    const w = this.world, ctx = this.ctx();
    if ((ctx !== "presnapD" && ctx !== "defense") || !live2(w)) return null;
    const [bx, by] = this.bufPoint(clientX, clientY);
    return this.r.pickPlayer(this.cam, bx, by, (q) => q.side === "D" && q.teamKey === w.user, TAP.PAD, this.bufLen(TAP.REACH));
  }
  // He's the controlled player now (world.js switchTo: the switch marker and sound; online the server checks it's his
  // and the moment allows, net/online.js shows it at once) — if he still can be: the moment may have passed while a
  // touch was down. Like SWITCH's press, it counts as touching the controls (he's the user's, not the assist's).
  takeDefender(p) {
    const w = this.world, ctx = this.ctx();
    if (!p || (ctx !== "presnapD" && ctx !== "defense") || !live2(w) || p === w.control || !w.def.includes(p)) return;
    w.action("switchTo", { slot: p.slot });
    this.input.idle = 0;
  }
  // a tap or click on one of the user's defenders takes him → true when it picked one (the tap is used)
  tryDefTap(clientX, clientY) { const p = this.defAt(clientX, clientY); if (p) this.takeDefender(p); return Boolean(p); }
  // a click on the field: skip a replay, or throw to a clicked receiver
  fieldTap(clientX, clientY) {
    if (this.mode !== "game") return false;
    if (this.replayActive || this.pendingReplay != null) { this.pendingReplay = null; this.endReplay(); return true; }
    return this.tryIconTap(clientX, clientY);
  }
  // a click on the field (main.js): does what fieldTap does, else takes a defender
  onCanvasClick(e) { if (!this.fieldTap(e.clientX, e.clientY) && e.button === 0) this.tryDefTap(e.clientX, e.clientY); }
  meterPress() { this.hud.meterPress(); }
}

// receivers in hot-route order: the play's progression first, then the other eligibles (stable while routes change)
export function hotList(w) {
  const play = w.call.off;
  const order = ((play && play.prog) || ELIGIBLE).slice();
  for (const s of ELIGIBLE) if (!order.includes(s)) order.push(s);
  const out = [];
  for (const s of order) { const p = w.bySlot(w.off, s); if (p) out.push(p); }
  return out.slice(0, 5);
}
export function currentRoute(w, p) {
  const as = p.as || {};
  if (as.kind !== "route") return "block";
  return HOT_ROUTES.includes(as.name) ? as.name : as.name || "go";
}
