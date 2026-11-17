// Ragdoll Football: boot, the fixed 60 Hz simulation loop, the match flow (play calls,
// kicks, coin toss, halftime, the final) and the 3D presentation.
import { World } from "./sim/world.js";
import { createBus } from "./sim/events.js";
import { Camera } from "./sim/camera3d.js";
import { Audio } from "./sim/audio.js";
import { Input } from "./sim/input.js";
import { PlayArt } from "./sim/playart.js";
import { Controls } from "./sim/controls.js";
import { RULES, KICKING, HARD, FIELD_W } from "./sim/config.js";
import { DEF_AUDIBLES, basePlay } from "./sim/playbook.js";
import * as AI from "./sim/ai.js";
import { TEAM_DEFS, TEAM_BY_KEY, makeTeam, kitsFor, rateSlot } from "./teams.js";
import { loadAthleteAssets } from "./players3d.js";
import { Renderer3D } from "./render3d.js";
import { UI } from "./ui.js";
import { CallPanel, specialOffer, coachFourth, fieldGoalOffer } from "./playcall.js";
import { showTitle, showPause, showHalftime, showResults } from "./menus.js";

const DT = 1 / 60;
const SKEY = "all22-3d-settings-v1";
const params = new URLSearchParams(location.search);
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;
const querySeed = (key) => /^\d{1,10}$/.test(params.get(key) || "") ? Number(params.get(key)) >>> 0 : null;

// the CPU team's knobs at a difficulty (ALL-22 PRO difficulty.js setupDifficulty)
function setupDifficulty(w, diff) {
  const h = diff >= 1 && diff <= 5 ? diff - 1 : 0;
  w.tackleMult = diff === 1 ? HARD.ROOKIE[0] : h ? HARD.TACKLE[h - 1] : 1;
  w.qbReadDelay = diff === 1 ? HARD.ROOKIE[1] : h ? HARD.READ[h - 1] : 0;
  w.hard = h;
  w.scout = h ? { plays: 0 } : null;
}

// the kick meter, the play clock and the pass icons (ALL-22 PRO hud.js logic, drawn by ui.js)
class HudLogic {
  constructor(app) { this.app = app; this.meterS = null; this.icons = null; this.pc = { on: false, t: 0, warned: -1 }; }
  tickPlayClock() {
    const app = this.app, w = app.world, pc = this.pc;
    if (!w) return;
    const ph = w.phase, pt = w.playType;
    pc.on = w.playClockOn && (ph === "dead" || ph === "playcall" || ph === "presnap") && pt !== "kickoff" && pt !== "pat";
    pc.t = w.playClock;
    const left = w.autopilot ? null : w.callLeft();
    if (left == null) return;
    if (left <= 5 && pc.warned !== w.playNo) { pc.warned = w.playNo; if (ph === "presnap" && w.waitUser === "snap") app.ui.toast("PLAY CLOCK", 900); }
    if (left > 0) return;
    if (ph === "playcall" && w.waitUser === "call") app.autoCall();
    else if (ph === "presnap" && w.waitUser === "snap") { app.ui.hidePanel(); w.action("snap"); app.ui.toast("PLAY CLOCK · SNAPPED FOR YOU", 1000); }
    else if (ph === "presnap" && w.waitUser === "kick" && !w.kickInput && !(this.meterS && this.meterS.phase > 0)) {
      const k = AI.cpuKick(w, w.kicker, pt);
      this.meterS = null; app.ui.meter(null);
      w.setKick(k.power, k.acc, k.aim);
      app.ui.toast("PLAY CLOCK · KICKED FOR YOU", 1200);
    }
  }
  meterPress() {
    const m = this.meterS, app = this.app;
    if (!m || !app.world) return;
    if (m.phase === 0) { m.phase = 1; m.t = 0; app.audio.sfx("blip"); }
    else if (m.phase === 1) { m.phase = 2; m.t = 0; m.power = m.p; app.audio.sfx("blip"); }
    else if (m.phase === 2) {
      m.phase = 3; m.acc = m.a;
      const perfect = Math.abs(m.acc) < 0.09;
      if (perfect) app.audio.sfx("perfect");
      app.ui.meter({ ...this.meterInfo(app.world, m), power: m.power, acc: m.acc, label: perfect ? "PERFECT" : "KICK", perfect });
      app.world.setKick(m.power, perfect ? 0 : m.acc, m.aim);
      m.hold = 0.6;
    }
  }
  updateMeter(dt) {
    const app = this.app, w = app.world;
    const need = w && w.phase === "presnap" && w.waitUser === "kick" && !w.kickInput && !w.autopilot && !(w.timeoutWait() > 0) && !app.ui.panelMode;
    if (need && !this.meterS) this.meterS = { phase: 0, p: 0, a: -1, t: 0, power: 0, acc: 0, aim: 0, hold: 0, guide: typeof w.kickGuide === "function" ? w.kickGuide() : null };
    const m = this.meterS;
    if (!m) return;
    if (m.phase === 3) { m.hold -= dt; if (m.hold <= 0) { this.meterS = null; app.ui.meter(null); } return; }
    if (!need) { this.meterS = null; app.ui.meter(null); return; }
    m.t += dt;
    if (m.phase === 1) m.p = Math.max(0, 1 - Math.abs(((m.t * 0.9) % 2) - 1));
    if (m.phase === 2) { m.a = -1 + m.t * 1.9; if (m.a > 1.15) { m.a = 1.15; this.meterPress(); return; } }
    if (m.phase < 3) app.ui.meter({ ...this.meterInfo(w, m), power: m.phase === 1 ? m.p : m.power, acc: m.phase === 2 ? m.a : null });
  }
  meterInfo(w, m) {
    const kind = w.playType === "kickoff" ? `KICKOFF · ${this.app.kickType().toUpperCase()}` : w.playType === "punt" ? "PUNT" : w.playType === "pat" ? "EXTRA POINT" : `FIELD GOAL · ${Math.round(100 - w.los + 17)} YD`;
    const wv = w.possession === "home" ? w.wind : -w.wind;
    const wind = !wv ? "CALM" : `${wv > 0 ? "{left}" : "{right}"} ${Math.abs(wv)} MPH`;
    const stage = [`${this.capKick()} TO START`, `${this.capKick()} TO SET POWER`, `${this.capKick()} IN THE GREEN`, ""][m.phase];
    const g = m.guide;
    let good = null, need = null;
    if (g) {
      const c = ((g.aim - (m.aim || 0)) * KICKING.AIM_ANG) / KICKING.ACC_ANG;
      good = [Math.max(0, (c - g.acc + 1) / 2), Math.min(1, (c + g.acc + 1) / 2)];
      need = g.power;
    } else good = [(1 - 0.09) / 2, (1 + 0.09) / 2];
    return { kind, wind, stage, good, need };
  }
  capKick() { return "SPACE"; }
  // the user QB's targets (1-5) over the receivers: yellow before the snap, green / yellow / red by how open after it
  updateIcons(w, isAttract) {
    this.icons = null;
    if (isAttract || w.autopilot || !w.call.off || w.call.off.type !== "pass" || w.userSide() !== "O") return;
    if (w.phase === "presnap" && (w.playType === "normal" || w.playType === "two")) this.icons = w.passTargets().map((p, i) => ({ p, k: i + 1, open: 1.5 }));
    else if (w.phase === "live" && w.qb && w.qb.hasBall && !w.passThrown && !w.losCrossed) this.icons = w.passTargets().map((p, i) => ({ p, k: i + 1, open: AI.openness(w, p) }));
  }
}

class App {
  constructor() {
    this.canvas = document.getElementById("game");
    this.r = new Renderer3D(this.canvas);
    this.cam = new Camera();
    this.audio = new Audio();
    this.input = new Input();
    this.playArt = new PlayArt();
    this.ui = new UI(document.getElementById("ui"), this);
    this.ui.call = new CallPanel(this.ui, this);
    this.hud = new HudLogic(this);
    this.settings = { quarter: RULES.QUARTER_SEC, accel: RULES.ACCEL, difficulty: 3, cam: "pro", camD: "pro", sound: true, sprintMode: "hold" };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(SKEY) || "{}")); } catch (_) { /* defaults */ }
    if (!RULES.QUARTER_OPTS.includes(this.settings.quarter)) this.settings.quarter = RULES.QUARTER_SEC;
    delete this.settings.characters; // (a save from when the human players were an option)
    this.input.setSprintMode(this.settings.sprintMode);
    this.cam.mode = this.settings.cam; this.cam.modeD = this.settings.camD;
    this.mode = "title"; this.world = null; this.attract = null; this.paused = false; this.replayActive = false;
    this.t = 0; this.acc = 0; this.last = 0; this.shake = 0; this.hitStop = 0;
    this.seed = querySeed("seed") ?? randomSeed();
    this.rosterSeed = querySeed("roster") ?? this.seed;
    this.input.on((n, a) => this.onInput(n, a));
    window.addEventListener("resize", () => this.resize());
    this.canvas.addEventListener("pointerdown", (e) => this.onCanvasClick(e));
    this.audio.installUnlock();
    if (!this.settings.sound) this.audio.setMuted(true);
    this.resize();
    this.frameCb = (t) => this.frame(t);
  }
  get camMode() { return this.cam.inUse(); }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.r.resize(w, h); this.r.cssW = w; this.r.cssH = h;
    const dpr = this.r.gl.getPixelRatio();
    this.cam.setBuffer(Math.round(w * dpr), Math.round(h * dpr));
    this.r.W = Math.round(w * dpr); this.r.H = Math.round(h * dpr);
  }
  saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(this.settings)); } catch (_) { /* private mode */ } }
  setSetting(k, v) {
    this.settings[k] = v; this.saveSettings();
    if (k === "cam") this.cam.mode = v;
    if (k === "camD") this.cam.modeD = v;
    if (k === "sprintMode") this.input.setSprintMode(v);
  }
  toggleMute() { this.audio.unlock(); this.setSetting("sound", this.audio.muted); this.audio.setMuted(!this.settings.sound); this.ui.toast(this.settings.sound ? "SOUND ON" : "SOUND OFF"); }
  toggleFFBoost() {}

  rerollRosters() { this.rosterSeed = randomSeed(); }

  async boot() {
    await loadAthleteAssets();
    document.body.classList.add("ready");
    this.startAttract();
    if (params.get("quick")) this.startGame(params.get("team") || "harbor", params.get("opp") || "canyon");
    else showTitle(this);
    // test hook: ?adv=SECONDS steps the game that far at once (then &freeze=1 holds it there) — headless screenshots
    if (params.get("adv")) {
      const until = params.get("until");
      this.noRender = true; // e.g. "live", "dead", "td" (a touchdown's whistle)
      for (let i = 0, n = Number(params.get("adv")) * 60; i < n; i++) {
        this.tick(DT);
        const w = this.world;
        if (until && w && i > 30 && (until === "td" ? w.phase === "dead" && w.result && w.result.type === "td" && w.phaseT > Number(params.get("after") || 0.6) : w.phase === until && w.phaseT > Number(params.get("after") || 0.8))) break;
      }
      this.noRender = false;
      if (params.get("freeze")) this.frozen = true;
    }
    requestAnimationFrame(this.frameCb);
  }
  // the title: a CPU-vs-CPU game under the orbiting camera
  startAttract() {
    const a = makeTeam(TEAM_DEFS[this.seed % TEAM_DEFS.length], { seed: this.rosterSeed });
    const b = makeTeam(TEAM_DEFS[(this.seed + 3) % TEAM_DEFS.length], { seed: this.rosterSeed });
    const w = new World({ bus: createBus(), home: a, away: b, seed: this.seed + 3, user: "home", autopilot: true, quarterSec: 600 });
    w.rateSlot = rateSlot;
    this.attract = w; this.attractRosterSeed = this.rosterSeed; w.start();
    this.kits = kitsFor(a, b);
    a.kit = this.kits.home; b.kit = this.kits.away;
    this.r.setTeams(a, b, this.kits);
    this.r.watchPlayEvents(w);
    this.mode = "title";
  }
  startGame(userKey, oppKey) {
    this.ui.clear(); this.ui.hidePanel();
    this.lastUser = userKey; this.lastOpp = oppKey;
    const d = this.settings.difficulty;
    const team = makeTeam(TEAM_BY_KEY[userKey], { seed: this.rosterSeed });
    const opp = makeTeam(TEAM_BY_KEY[oppKey], { seed: this.rosterSeed, boost: d >= 5 ? 1.08 : d >= 4 ? 1.04 : 1 });
    if (d >= 4) { opp.ai = { ...opp.ai, skill: Math.max(opp.ai.skill, HARD.MASTER_SKILL || 0.9), read: Math.min(opp.ai.read, HARD.MASTER_READ != null ? HARD.MASTER_READ : 0) }; opp.skill = opp.ai.skill; }
    this.kits = kitsFor(team, opp);
    team.kit = this.kits.home; opp.kit = this.kits.away;
    const bus = createBus();
    const w = new World({ bus, home: team, away: opp, seed: this.seed + 17, user: "home", autopilot: params.get("autoplay") === "1", quarterSec: params.get("quick") ? 120 : this.settings.quarter, accel: this.settings.accel, difficulty: d });
    w.rateSlot = rateSlot;
    setupDifficulty(w, d);
    this.world = w;
    this.r.setTeams(team, opp, this.kits);
    this.r.watchPlayEvents(w);
    this.ui.setTeams(w, this.kits);
    this.ui.showHud(true);
    this.wire(bus, w);
    this.mode = "game"; this.paused = false; this.overShown = false; this.overT = 0;
    this.input.resetSprintToggle();
    w.start();
    this.cam.snap();
  }
  toTitle() { this.world = null; this.ui.hidePanel(); this.ui.meter(null); this.startAttract(); showTitle(this); }
  quit() { this.paused = false; this.toTitle(); }
  pause() { if (this.mode !== "game" || !this.world || this.paused) return; this.paused = true; this.wasPanel = this.ui.panelMode; showPause(this); }
  resume() { this.paused = false; this.ui.clear(); this.reopen = true; }
  endReplay() {}

  // match reactions: banners, toasts, camera punch, shake and hit-stop, coin toss results
  wire(bus, w) {
    this.cam.attach(bus, w, this);
    this.audio.attach(bus, w, this);
    this.playArt.attach(bus, w, this);
    const ui = this.ui, team = (k) => w.teams[k], col = (k) => this.kits[k].jersey;
    const nm = (p) => (p ? `${p.num} ${p.name}`.toUpperCase() : "");
    bus.on("touchdown", (e) => ui.banner("TOUCHDOWN", e.scorer ? `${nm(e.scorer)} · ${team(e.team).name.toUpperCase()}` : team(e.team).name.toUpperCase(), col(e.team), 2600));
    bus.on("fieldGoal", (e) => ui.banner(e.good ? "FIELD GOAL IS GOOD" : e.blocked ? "BLOCKED" : "NO GOOD", `${e.distance || ""} YARDS${e.doink ? " · OFF THE UPRIGHT" : ""}`, e.good ? col(e.team) : "#5a6068", 2000));
    bus.on("patResult", (e) => ui.toast(e.good ? "EXTRA POINT IS GOOD" : e.blocked ? "PAT BLOCKED" : "EXTRA POINT NO GOOD", 1400));
    bus.on("twoPoint", (e) => { if (e.setup) ui.toast("2-POINT TRY", 1200); else ui.banner(e.good ? "2-POINT CONVERSION" : "NO GOOD", "", e.good ? col(e.team) : "#5a6068", 1600); });
    bus.on("interception", (e) => { ui.banner("INTERCEPTED", nm(e.player), col(e.player.teamKey), 2000); this.shake = 0.5; });
    bus.on("fumble", (e) => { if (!e.muff) ui.toast("FUMBLE", 1200); });
    bus.on("turnover", (e) => { if (e.kind === "downs") ui.banner("TURNOVER ON DOWNS", "", "#5a6068", 1700); else if (e.kind === "fumble" || e.kind === "muff") ui.banner("FUMBLE RECOVERED", "", col(w.possession), 1700); });
    bus.on("sack", (e) => { ui.banner("SACK", nm(e.tackler), col(e.tackler ? e.tackler.teamKey : w.defTeam), 1400); this.shake = 0.45; });
    bus.on("safety", (e) => ui.banner("SAFETY", team(e.team).name.toUpperCase(), col(e.team), 2000));
    bus.on("firstDown", () => { if (w.playType === "normal") ui.toast("FIRST DOWN", 1100); });
    bus.on("hitStick", (e) => { if (e.boom) { this.shake = 0.8; this.hitStop = 0.09; ui.toast("BIG HIT", 900); } });
    bus.on("tackle", (e) => { if ((e.power || 0) > 11) this.shake = Math.max(this.shake, 0.3); });
    bus.on("truck", (e) => { if (e.defender && !e.failed) { this.shake = Math.max(this.shake, 0.35); ui.toast("TRUCKED", 800); } });
    bus.on("timeout", (e) => ui.toast(`TIMEOUT · ${team(e.team).abbr} · ${e.left} LEFT`, 1600));
    bus.on("twoMinute", () => ui.banner("TWO-MINUTE WARNING", "", "#ffd400", 1500));
    bus.on("quarterEnd", (e) => { if (e.q !== 2 && e.q < 4) ui.toast(`END OF THE ${["", "1ST", "2ND", "3RD"][e.q]} QUARTER`, 1800); });
    bus.on("overtime", () => ui.banner("OVERTIME", "", "#ffd400", 1800));
    bus.on("coinToss", (e) => ui.call.coinResult(e, w));
    bus.on("coinChoice", (e) => ui.call.coinChosen(e, w));
    bus.on("noHuddle", (e) => { if (e.team === w.user) ui.toast(e.on ? "NO HUDDLE ON" : "NO HUDDLE OFF", 1000); });
    bus.on("whistle", () => this.input.resetSprintToggle());
    bus.on("kickBlocked", () => { ui.banner("BLOCKED", "", col(w.defTeam), 1400); this.shake = 0.4; });
  }

  // ---------- the user's calls (ALL-22 PRO flow.js) ----------
  callPlay(play, flip = false) { const w = this.world; this.ui.hidePanel(); if (w && w.phase === "playcall") w.setCall(this.callSide || w.userSide(), play, Boolean(flip)); }
  fourthChoice(c) {
    const w = this.world;
    this.ui.hidePanel();
    if (c === "go") { this.fourthAsked = { w, n: w.playNo }; this.callSide = "O"; this.coach = AI.coachPick(w, "O"); this.ui.call.showPlayCall(w, "O", this.coach); }
    else { w.chooseSpecial(c); if (c === "fakePunt" || c === "fakeFG") this.ui.toast(`${c === "fakeFG" ? "FAKE FIELD GOAL" : "FAKE PUNT"} · SNAP IT`, 1400); }
  }
  patChoice(c) { this.ui.hidePanel(); this.world.choosePAT(c); }
  audible(p) { const w = this.world; this.ui.hidePanel(); w.audible(p); this.playArt.build(w); this.ui.toast(`AUDIBLE · ${p.name}`, 1100); }
  defAudible(id) {
    const w = this.world;
    this.ui.hidePanel();
    if (!w || !w.defAudible(id)) return;
    const a = DEF_AUDIBLES.find((x) => x.id === id);
    this.ui.toast(a ? `AUDIBLE · ${a.name}` : `AUDIBLE · BACK TO ${basePlay(w.call.def).name}`, 1100);
  }
  toggleNoHuddle() {
    const w = this.world;
    if (!w || w.phase !== "playcall" || w.userSide() !== "O" || !w.setNoHuddle(!w.noHuddle[w.user])) return;
    this.audio.sfx("blip");
    if (this.ui.panelMode === "call") this.ui.call.refreshCall(w);
  }
  coinCall(call) { const w = this.world; if (w) w.action("coinCall", { call }); }
  coinChoice(choice) { const w = this.world; if (w) w.action("coinChoice", { choice }); }
  setReturnLane(lane) { const w = this.world; if (!w) return; w.action("returnLane", { lane }); this.ui.toast(`RETURN ${lane.toUpperCase()}`, 900); }
  autoCall() {
    const w = this.world;
    if (!w || w.phase !== "playcall" || w.waitUser !== "call") return;
    const side = w.userSide();
    if (this.ui.panelMode === "fourth") {
      const c = coachFourth(w);
      this.ui.hidePanel();
      if (c !== "go") { w.chooseSpecial(c); this.ui.toast(`PLAY CLOCK · COACH SENDS THE ${c === "fg" ? "KICKER" : "PUNTER"}`, 1600); return; }
      this.fourthAsked = { w, n: w.playNo };
    }
    const fg = this.ui.panelMode === "call" && side === "O" ? fieldGoalOffer(w) : null;
    if (fg && fg.recommend) { this.ui.hidePanel(); w.chooseSpecial("fg"); this.ui.toast("PLAY CLOCK · COACH SENDS THE KICKER", 1600); return; }
    const coach = AI.coachPick(w, side), flip = this.ui.call.flipFor(w, side);
    this.ui.hidePanel();
    this.callSide = side;
    w.setCall(side, coach, flip);
    this.ui.toast(`PLAY CLOCK · COACH CALLS ${coach.name}`, 1600);
  }
  showSpecial(w, offer) {
    if (!offer) return;
    if (offer.kickType && w.user === w.possession && w.playType === "kickoff") this.ui.call.showKickType(w, offer.kickType);
    else if (offer.returnLane && w.user !== w.possession) this.ui.call.showReturn(w, offer.returnLane);
  }

  // per frame while a match is on (ALL-22 PRO flow.js gameUI)
  gameUI(dt) {
    const w = this.world, ui = this.ui;
    if (!w || this.paused) return;
    const user = !w.autopilot;
    const panelOpen = Boolean(ui.panelMode), screenOpen = Boolean(ui.screen);
    const free = user && !panelOpen && !screenOpen;
    if (this.reopen) { this.reopen = false; }
    if (free && w.waitUser === "coin" && w.phase === "coin" && this.coinShown !== w.coin) { this.coinShown = w.coin; ui.call.showCoin(w); }
    else if (free && (w.playType === "kickoff" || w.playType === "punt") && (w.phase === "presnap" || (w.phase === "playcall" && w.waitUser === "call"))) {
      const key = `${w.playNo}:${w.playType}:${w.phase}`;
      if (!(this.specialAsked && this.specialAsked.w === w && this.specialAsked.key === key)) { this.specialAsked = { w, key }; this.showSpecial(w, specialOffer(w)); }
    }
    else if (free && w.phase === "playcall" && w.waitUser === "call") {
      const side = w.userSide();
      this.callSide = side;
      if (side === "O" && w.down === 4 && w.playType === "normal" && !(this.fourthAsked && this.fourthAsked.w === w && this.fourthAsked.n === w.playNo)) { this.fourthAsked = { w, n: w.playNo }; ui.call.showFourth(w); }
      else { this.coach = AI.coachPick(w, side); ui.call.showPlayCall(w, side, this.coach); }
    }
    else if (free && w.phase === "pat" && w.waitUser === "pat") ui.call.showPat(w);
    const m = ui.panelMode;
    if ((m === "call" || m === "fourth") && w.phase !== "playcall") ui.hidePanel();
    else if (m === "pat" && w.phase !== "pat") ui.hidePanel();
    else if ((m === "audible" || m === "hot") && (w.phase !== "presnap" || w.waitUser !== "snap")) ui.hidePanel();
    else if (m === "daudible" && (w.phase !== "presnap" || w.userSide() !== "D")) ui.hidePanel();
    else if (m === "special" && w.phase !== "presnap" && w.phase !== "playcall") ui.hidePanel();
    else if (m === "coin" && ui.call.coin && !ui.call.coin.result && w.waitUser !== "coin" && w.phase !== "coin" && this.t - ui.call.coin.t0 > 3) ui.hidePanel();
    ui.call.tickCoin(this.t);
    if (w.phase === "halftime" && user && !screenOpen) showHalftime(this, w);
    if (w.phase === "over" && !this.overShown) {
      this.overT += dt;
      if (this.overT > 2.2) { this.overShown = true; ui.hidePanel(); ui.meter(null); showResults(this, w); }
    }
    this.hud.tickPlayClock();
    this.hud.updateMeter(dt);
  }

  // ---------- clicks on the field (controls.js asks these) ----------
  recAt(cx, cy) {
    const icons = this.hud.icons, w = this.world;
    if (!icons || !w || w.phase !== "live") return null;
    let best = null, bd = 30;
    for (const it of icons) if (it.sx != null) { const d = Math.hypot(it.sx - cx, it.sy - cy); if (d < bd) { bd = d; best = it; } }
    if (best) return { it: best };
    const p = this.r.pick(cx, cy, (q) => icons.some((it) => it.p === q), 46);
    return p ? { it: icons.find((it) => it.p === p) } : null;
  }
  defAt(cx, cy) {
    const w = this.world, ctx = this.ctx();
    if ((ctx !== "presnapD" && ctx !== "defense") || !(w.playType === "normal" || w.playType === "two")) return null;
    return this.r.pick(cx, cy, (q) => q.side === "D" && q.teamKey === w.user, 44);
  }
  onCanvasClick(e) { this.audio.unlock(); if (e.button !== 0) return; if (!this.tryIconTap(e.clientX, e.clientY)) this.tryDefTap(e.clientX, e.clientY); }

  // ---------- the loop ----------
  frame(ts) {
    requestAnimationFrame(this.frameCb);
    const dt = Math.min(0.1, Math.max(0, (ts - (this.last || ts)) / 1000));
    this.last = ts;
    this.tick(dt);
  }
  tick(dtr) {
    this.t += dtr;
    this.audio.tick();
    const intent = this.input.update(dtr);
    if (this.ui.screen === "generator" && this.r.preview) {
      const view = this.ui.layer.querySelector("[data-player-view]");
      if (!this.noRender) this.r.renderPlayerPreview(dtr, view.getBoundingClientRect());
      return;
    }
    this.r.clearPlayerPreview();
    const isAttract = this.mode !== "game" || !this.world;
    const w = isAttract ? this.attract : this.world;
    if (!w) return;
    w.input = isAttract ? intent : this.cam.stickFor(intent, w); w.inputIdle = this.input.idle;
    if (!this.paused && !this.frozen) {
      if (this.hitStop > 0) this.hitStop -= dtr;
      else {
        this.acc += dtr * (isAttract ? 1 : Number(params.get("speed") || 1));
        let steps = 0;
        while (this.acc >= DT && steps < 12) {
          w.update(DT);
          if (isAttract && w.phase === "over") { this.startAttract(); return; }
          if (isAttract && w.phase === "halftime") w.continueHalftime();
          this.acc -= DT; steps++;
        }
        if (steps >= 12) this.acc = 0;
      }
    }
    if (!isAttract) this.gameUI(dtr);
    // presentation
    const flip = w.possession !== "home", b = w.ball;
    const rs = this.rs || (this.rs = { ballX: 50, ballY: FIELD_W / 2, ballState: "dead" });
    rs.ballX = flip ? 100 - b.x : b.x; rs.ballY = flip ? FIELD_W - b.y : b.y; rs.ballState = b.state;
    this.cam.decayPunch(dtr, isAttract);
    this.cam.direct(dtr, w, isAttract, null, rs, this.t);
    if (isAttract) { this.cam.h = Math.max(this.cam.h, 14); this.cam.horizonFrac = 0.34; this.cam.updateLens(); }
    // shake (CSS px → buffer px offsets on the lens)
    this.shake = Math.max(0, this.shake - dtr * 1.6);
    const sk = this.shake * this.shake * 14 * this.r.gl.getPixelRatio();
    this.cam.shakeX = sk ? (Math.random() - 0.5) * sk : 0; this.cam.shakeY = sk ? (Math.random() - 0.5) * sk : 0;
    this.playArt.tick(this.paused ? 0 : dtr);
    const losAbs = w.possession === "home" ? w.los : 100 - w.los, fdAbs = w.possession === "home" ? w.los + w.toGo : 100 - (w.los + w.toGo);
    const showLines = !isAttract && (w.playType === "normal" || w.playType === "two") && w.phase !== "dead" && w.phase !== "over";
    this.r.sync(w, this.paused ? 0 : dtr, { showLines, losX: losAbs, fdX: w.los + w.toGo < 100 && w.playType === "normal" ? fdAbs : null, showRing: !isAttract && w.phase !== "dead", playArt: isAttract ? null : this.playArt.current(w) });
    this.r.applyCamera(this.cam);
    if (!this.noRender) this.r.render();
    // HUD over the frame
    if (!isAttract) {
      this.ui.updateHud(w, this.hud.pc);
      this.hud.updateIcons(w, isAttract);
      const list = [];
      if (this.hud.icons && !this.ui.panelMode) {
        const o = { x: 0, y: 0 };
        for (const it of this.hud.icons) {
          const s = this.r.headScreen(it.p, o);
          if (!s) { it.sx = null; continue; }
          it.sx = s.x; it.sy = s.y;
          list.push({ label: it.k, x: s.x, y: s.y, state: it.open > 2.4 ? "open" : it.open > 1.0 ? "mid" : "cov" });
        }
      }
      this.ui.setIcons(list);
      const c = w.control && !w.autopilot ? w.control : null;
      const who = c && w.phase !== "dead" ? `<b>${c.num}</b> ${c.name.toUpperCase()} <i>${c.slot.replace(/\d/, "")}</i>` : "";
      this.ui.legend(this.ui.panelMode || this.ui.screen ? [] : this.bindings(), who);
    }
  }
}
// controls.js methods live on App (they run with this = app); App's own (recAt, defAt, onCanvasClick) win
for (const k of Object.getOwnPropertyNames(Controls.prototype)) if (k !== "constructor" && !Object.prototype.hasOwnProperty.call(App.prototype, k)) Object.defineProperty(App.prototype, k, Object.getOwnPropertyDescriptor(Controls.prototype, k));

const app = new App();
window.__app = app;
app.boot().catch((e) => { console.error(e); document.querySelector(".boot .bs").textContent = "COULD NOT LOAD THE GAME"; });
