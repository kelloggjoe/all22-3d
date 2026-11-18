// Rules / state machine: coin toss, downs, clock, timeouts, scoring, kickoffs, punts, returns, PAT/2-pt, FG,
// blocked kicks, halftime, overtime (modified sudden death).
// Coordinates are OFFENSE coordinates (the team with possession attacks +x). absX/absY map to the stadium.
//
// WORLD COMMAND API (input / UI → world):
//   action(name, arg)  live/presnap commands: snap · pass {k, lob, air} · switch · switchTo {slot} (a tapped defender of
//                      his) · tackle · hitstick · swat · fairCatch · juke {side} · spin · stiff · truck · dive ·
//                      throwAway (user QB) · kneel (returner in his end zone)
//                      special-teams calls: kickType {type: normal|squib|onside} · returnLane {lane: middle|left|right}
//                      coin toss: coinCall {call: heads|tails, choice?: receive|defer} · coinChoice {choice: receive|defer|kick}
//   specialCalls()     what can be called right now (see the method) · coachFourth() → "go"|"punt"|"fg"
//   kickGuide()        FG/PAT meter guide {dist, power, acc, aim} (power line, accuracy window, wind aim)
//   userAssignment()   the user defender's job → {type:"zone",x,y,r,X,Y,zone,deep} | {type:"man",target} | {type:"rush"} …
//   setCall(side, play, flip) · chooseSpecial(kind) · audible(play) · hotRoute(slot, route) · callTimeout(team) ·
//   choosePAT(kind) · continueHalftime() · setKick(power, acc, aim) · passTargets() · userSide() · absX/absY
//   the clock: setNoHuddle(on) (the human offense's hurry-up) · action("spike") at the line · clockRunning() ·
//   callLeft() (the human's time to call / snap before the coach does) · halfLeft() · w.playClock, w.playClockOn ·
//   timeoutWait() (a timeout's wait: the time left, s; w.timeoutBy called it) · skipTimeout(team) (a team's SKIP:
//   READY to end it, w.timeoutReady) (see "the clock between plays")
//   coachSub(team, slot, other) the human's substitutions (PRO's Depth Chart): other { slot } or { pid } (coach.js)
//   takeOver(team)     watch and jump in: "home" | "away" → that team's human plays from the next dead ball; null → the
//                      autopilot plays both sides again (also at a dead ball)
//   FLIP (playbook.js mirrorPlay): setCall(side, play, flip) runs a call mirrored. The flip is plain data on the call:
//                      w.call.off / w.call.def is then the play's mirror image (flip: true, base = the play as drawn, the
//                      same id; flip left out: the play as given). The CPU offense flips its own calls (ai.cpuFlip,
//                      config.js FLIP). The defense lines up to the offense's formation (setupPlay → w.defSet, the
//                      defense as it lines up: mirrored with a flipped offense, and against it when it flipped its own
//                      call). An audible keeps the call's FLIP; a hot route breaks the mirrored way for a man lined up
//                      on the ball. Kicks, spikes and kneels never flip.
//
// FRANCHISE OPTIONS (constructor; all off by default, and then the World plays exactly as before): subs (use each
// team's depth chart, team.depth: bench + substitutions) · fatigue · injuries "off" | "low" | "normal" | "high" ·
// playerStats (w.statsBy[team][pid]) · playByPlay (w.pbp) · rateAt(info, slot, scheme) → ratings (the league's rating
// of a player out of position; else squad.js rerate) · otPossessions (overtime possessions each before a tie; default
// RULES.OT_MAX_POSS) · noTies (overtime goes on until someone wins) · homeField (true or a strength: the home crowd,
// config.js HOME_FIELD; off = a neutral site). squad.js / playerstats.js / pbp.js; results the league reads after the
// game: w.statsBy, w.injuries (the injury events), w.pbp, w.people (who's who), with w.score, w.winner, w.stats, w.ot.
// Events: sub { team, slot, out, in, reason } · injury { team, pid, slot, severity, weeks, playNo, quarter, clock, how } ·
// takeover { team, human }.
import { RULES, TIMING, FIELD_W, MID_Y, HASH_L, HASH_R, PHYS, KICKING, FAKE } from "./config.js";
import { Player, Ball } from "./entities.js";
import * as P from "./physics.js";
import * as AI from "./ai.js";
import { FORMATIONS, defFormation, defAssignments, ELIGIBLE, hotRoute, offPlay, defPlay, OFF_PLAYS, ZONES, CLOCK_PLAYS, asCalled, offPos, defPos, parOf, DEF_AUDIBLES, defAudiblePlay, basePlay, FAKE_PLAYS } from "./playbook.js";
import { createRng } from "./rng.js";
import { SLOTS_OFF, SLOTS_DEF } from "./ratings.js";
import * as SQ from "./squad.js";
import * as PS from "./playerstats.js";
import * as PBP from "./pbp.js";
import * as CO from "./coach.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const other = (k) => (k === "home" ? "away" : "home");
export const KICK_TYPES = ["normal", "squib", "onside"];
export const RETURN_LANES = ["middle", "left", "right"];
const BETWEEN = new Set(["dead", "playcall", "presnap", "pat"]); // the phases a timeout can be called in (callTimeout)
// return lane → target y in KICKING-team coordinates (the returner runs toward −x; his left is −y)
const LANE_Y = { middle: MID_Y, left: MID_Y - 12, right: MID_Y + 12 };

function newStats() {
  return { passAtt: 0, passCmp: 0, passYds: 0, passTD: 0, ints: 0, rushAtt: 0, rushYds: 0, rushTD: 0, sacks: 0, sackYds: 0, fumLost: 0, firstDowns: 0, rets: 0, retYds: 0, plays: 0, punts: 0, fgAtt: 0, fgMade: 0, patAtt: 0, patMade: 0, twoAtt: 0, twoMade: 0, totalYds: 0, swats: 0, hitSticks: 0, tds: 0, kicksBlocked: 0, thirdAtt: 0, thirdConv: 0 };
}

export class World {
  constructor(o) {
    this.bus = o.bus;
    this.seed = o.seed || 1;
    this.rng = createRng(this.seed);
    this.teams = { home: o.home, away: o.away };
    this.user = o.user || null;
    this.autopilot = Boolean(o.autopilot);
    this.headless = Boolean(o.headless);
    this.quarterSec = o.quarterSec || RULES.QUARTER_SEC;
    this.regulationQuarters = Math.max(1, Math.min(4, o.regulationQuarters || 4)); // (a rival game: 1)
    this.difficulty = o.difficulty || 2; // 1 ROOKIE · 2 PRO · 3 CHAMPION · 4 MASTER · 5 LEGEND (difficulty.js setupDifficulty: the CPU team's knobs)
    this.roster = { home: {}, away: {} };
    for (const k of ["home", "away"]) {
      const t = this.teams[k];
      for (const slot in t.players) {
        const pl = new Player(t, k, t.players[slot]);
        pl.pos = slot;
        this.roster[k][slot] = pl;
      }
    }
    this.ball = new Ball();
    this.score = { home: 0, away: 0 };
    this.timeouts = { home: RULES.TIMEOUTS, away: RULES.TIMEOUTS };
    this.quarter = 1;
    this.clock = this.quarterSec;
    this.stats = { home: newStats(), away: newStats() };
    this.pstats = { home: {}, away: {} };
    this.players = []; this.off = []; this.def = [];
    this.phase = "init"; this.phaseT = 0; this.t = 0;
    this.playType = "normal";
    this.possession = "home";
    this.los = 25; this.down = 1; this.toGo = 10; this.ballY = MID_Y;
    this.call = { off: null, def: null };
    // the clock between plays ("the clock between plays" below). accel: the accelerated clock's play clock (0 = off;
    // main.js passes the setting, headless sims get the default)
    this.accel = Number.isFinite(o.accel) && o.accel >= 0 ? o.accel : RULES.ACCEL;
    this.clockRun = false; // the game clock runs between plays: true · "set" (out of bounds: once the ball is set) · false
    this.playClock = RULES.PLAY_CLOCK_ADMIN; this.playClockOn = false;
    this.clockDone = -1; // the play whose whistle the clock rules have been applied to
    this.broke = -1; // the play whose huddle has broken (the accelerated clock, the CPU's snap)
    this.tempo = null; // this snap's CPU tempo: { kind: "normal" | "hurry" | "chew" | "milk" | "spike", snapAt } (play clock)
    this.noHuddle = { home: false, away: false }; // a hurry-up offense (the human's NO HUDDLE, the CPU's two-minute drill)
    this.timeoutLeft = 0; this.timeoutBy = null; // a timeout's wait: its time left (s) and the team that called it (timeoutWait)
    this.timeoutReady = { home: false, away: false }; // each team's SKIP during the wait (skipTimeout)
    this.twoMin = 0; // the half (1 | 2) whose two-minute warning has been given
    this.snapHalf = 0; // the time left in the half at the snap (a two-minute warning during the play comes at its whistle)
    this.playNo = 0;
    this.errors = [];
    this.log = [];
    this.ot = null;
    this.firstReceiver = "home";
    this.control = null;
    this.input = null;
    this.inputIdle = 99;
    this.hot = {}; // hot routes for this play
    this.waitUser = null;
    this.result = null;
    this.drive = { start: 25, plays: 0 };
    this.playLog = [];
    this.stuck = 0;
    this.maxPlayT = 0;
    this.playDurations = [];
    this.tackleMult = 1;
    this.lastTackleTry = -9;
    this.qbReadDelay = 0;
    this.coin = null; // {kind, caller, call, result, winner, choice, auto} once tossed
    this.coinHold = false; // a coin-toss UI sets this to wait for the human's call (else it's called after COIN_SEC)
    this.passId = 0; this.swatTry = -1;
    this.laneByTeam = { home: "middle", away: "middle" }; // each team's (sticky) return-lane call
    this.returnLane = "middle"; this.returnLaneY = null;
    this.onside = false; this.squib = false;
    this.onsideTries = { home: 0, away: 0 }; // onside kicks each team has tried this game (ai.onsideWary)
    this.fakes = { home: 0, away: 0 }; // fake punts and field goals each team has run this game (ai.fakeWary)
    this.onsideSet = 0; this.onsideRead = 0; this.onsideFree = false; this.onsideCh = null; // this kick's (setupKickoff)
    this.lastOffCall = null;
    // crosswind for kicks (absolute: + blows toward stadium +Y)
    this.wind = Math.round((this.rng.next() * 2 - 1) * 14);
    // League rules (see the top of the file): overtime possessions before a tie, no ties at all, the home crowd
    this.otPossessions = Number.isInteger(o.otPossessions) && o.otPossessions > 0 ? o.otPossessions : RULES.OT_MAX_POSS;
    this.noTies = Boolean(o.noTies);
    this.homeEdge = o.homeField === true ? 1 : Number.isFinite(o.homeField) && o.homeField > 0 ? o.homeField : 0;
    this.crowd = 0; // this play's crowd noise against the visiting offense (snap; config.js HOME_FIELD)
    // Franchise options (see the top of the file): off unless asked for
    const inj = o.injuries === true ? "normal" : o.injuries;
    this.subs = Boolean(o.subs); this.fatigue = Boolean(o.fatigue); this.injuryLevel = SQ.INJURY_LEVELS[inj] ? inj : null;
    this.playerStats = Boolean(o.playerStats); this.playByPlay = Boolean(o.playByPlay);
    this.rateAt = typeof o.rateAt === "function" ? o.rateAt : null; // the league's rating of a player at any spot (squad.js)
    this.squad = null; this.people = null; this.statsBy = null; this.injuries = null; this.pbp = null; this.handoff = null;
    this.intBy = null; this.swatBy = null; this.kickBlocker = null; this.fumbleX = null; // who intercepted / batted it down / blocked the kick; where the offense first fumbled
    if (this.subs || this.fatigue || this.injuryLevel || this.playerStats || this.playByPlay) {
      this.injRng = createRng((Math.imul(this.seed | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0); // its own stream: injuries never shift the game's
      SQ.initSquads(this);
      if (this.injuryLevel) this.injuries = [];
      if (this.playerStats) this.statsBy = { home: {}, away: {} };
      if (this.playByPlay) this.pbp = PBP.create(this);
    }
  }
  windY() { return (this.possession === "home" ? 1 : -1) * this.wind * 0.035; }
  // crosswind as a kick-angle offset (rad, offense coords: + drifts toward +y)
  windAng() { return (this.possession === "home" ? 1 : -1) * this.wind * KICKING.WIND_ANG; }

  // ---------- helpers ----------
  get offTeam() { return this.possession; }
  get defTeam() { return other(this.possession); }
  absX(x) { return this.possession === "home" ? x : 100 - x; }
  absY(y) { return this.possession === "home" ? y : FIELD_W - y; }
  bySlot(list, slot) { for (const p of list) if (p.slot === slot) return p; return null; }
  userSide() { if (!this.user) return null; return this.user === this.possession ? "O" : "D"; }
  // the human's offense chasing the other team's carrier after a turnover (an interception, a fumble returned): his men
  // play defense until the whistle (SWITCH, TACKLE, HIT STICK)
  userChasing() {
    const c = this.ball.carrier;
    return Boolean(this.user) && !this.autopilot && this.phase === "live" && this.ball.state === "held" && c && c.teamKey !== this.user && c.side === "D" && (this.playType === "normal" || this.playType === "two");
  }
  isUserTeam(k) { return this.user === k && !this.autopilot; }
  ps(team, slot) {
    const t = this.pstats[team];
    if (!t[slot]) t[slot] = { pa: 0, pc: 0, py: 0, ptd: 0, pint: 0, ra: 0, ry: 0, rtd: 0, rec: 0, recy: 0, rectd: 0, tkl: 0, sck: 0, int: 0, ret: 0, rety: 0, kick: 0, two: 0, hsk: 0, tfl: 0 };
    return t[slot];
  }
  setPhase(ph) { this.phase = ph; this.phaseT = 0; this.bus.emit("phase", { phase: ph }); }

  start() {
    this.coinToss("start");
  }

  // ---------- coin toss ----------
  // The human calls it (action "coinCall") during the "coin" phase — the UI shows the call; with no call within
  // TIMING.COIN_SEC the call is made at random. Winner's choice: the CPU usually defers to the 2nd half at the start (as
  // real teams do) and receives in overtime; a human winner picks once the coin is down (action "coinChoice": receive or
  // defer — receive or kick in overtime; waitUser "coinChoice"), or receives if he doesn't within COIN_SEC (no coinHold).
  coinToss(kind) {
    const human = Boolean(this.user) && !this.autopilot;
    this.coin = { kind, caller: human ? this.user : "away", call: null, result: null, winner: null, choice: null, auto: false, done: false };
    this.playType = "kickoff";
    this.possession = "home";
    this.los = 50; this.ballY = MID_Y; this.down = 1; this.toGo = 10;
    this.call = { off: null, def: null };
    this.coinScene();
    this.setPhase("coin");
    this.waitUser = human && !this.headless ? "coin" : null;
    this.bus.emit("coinTossStart", { kind, caller: this.coin.caller });
    if (!this.waitUser) this.resolveCoin(null, null);
  }
  // captains at midfield (QB/HB/TE of each team), everyone else lined up on their sideline
  coinScene() {
    const H = this.roster.home, A = this.roster.away;
    const caps = ["QB", "HB", "TE"];
    const home = SLOTS_OFF.map((s) => H[s]), away = SLOTS_OFF.map((s) => A[s]);
    this.placeAll(home, away);
    const line = (list, y, face) => { let i = 0; for (const p of list) { if (caps.includes(p.slot)) continue; p.reset(31 + i * 4, y); p.faceX = 0; p.faceY = face; i++; } };
    line(home, -2.4, 1); line(away, FIELD_W + 2.4, -1);
    // captains face each other across the midfield logo (spread across the field so the Pro Cam sees them side by side)
    caps.forEach((s, i) => { const h = H[s], a = A[s]; h.reset(50 - 0.5 + (i % 2) * 0.6, MID_Y + 1.7 + i * 1.35); h.faceX = 0; h.faceY = -1; a.reset(50 - 0.5 + (i % 2) * 0.6, MID_Y - 1.7 - i * 1.35); a.faceX = 0; a.faceY = 1; });
    for (const p of this.players) { p.sx = p.x; p.sy = p.y; }
    this.ball.reset(); this.ball.x = 50; this.ball.y = MID_Y; this.ball.z = 0.05; this.ball.state = "dead";
    this.control = null;
  }
  resolveCoin(call, choice) {
    const c = this.coin;
    if (!c || c.done) return;
    c.done = true;
    c.auto = !call;
    c.call = call === "heads" || call === "tails" ? call : (this.rng.chance(0.5) ? "heads" : "tails");
    c.result = this.rng.chance(0.5) ? "heads" : "tails";
    c.winner = c.call === c.result ? c.caller : other(c.caller);
    this.phaseT = 0;
    // a human who won it (and is at the toss UI) makes his choice now that he knows
    if (this.isUserTeam(c.winner) && this.waitUser === "coin" && !choice) {
      this.waitUser = "coinChoice";
      this.bus.emit("coinToss", { kind: c.kind, winner: c.winner, choice: null, call: c.call, result: c.result, caller: c.caller, receiver: null, auto: c.auto, pending: true });
      return;
    }
    this.chooseCoin(choice, false);
  }
  // the winner's choice → who receives the kickoff (at the start, the other team receives the 2nd half's: continueHalftime)
  chooseCoin(choice, pending) {
    const c = this.coin;
    const humanWon = this.isUserTeam(c.winner);
    if (c.kind === "ot") c.choice = humanWon && (choice === "defer" || choice === "kick") ? "kick" : "receive";
    else c.choice = humanWon ? (choice === "defer" || choice === "kick" ? "defer" : "receive") : this.rng.chance(0.8) ? "defer" : "receive";
    const receiver = c.choice === "receive" ? c.winner : other(c.winner);
    if (c.kind === "start") this.firstReceiver = receiver;
    c.receiver = receiver;
    this.waitUser = null;
    this.phaseT = 0;
    if (pending) this.bus.emit("coinChoice", { kind: c.kind, winner: c.winner, choice: c.choice, receiver });
    else this.bus.emit("coinToss", { kind: c.kind, winner: c.winner, choice: c.choice, call: c.call, result: c.result, caller: c.caller, receiver, auto: c.auto });
    if (this.headless) this.afterCoin();
  }
  afterCoin() {
    const c = this.coin;
    if (!c || !c.receiver || this.phase !== "coin") return;
    if (this.handoff) this.applyHandoff();
    this.setupKickoff(other(c.receiver), RULES.KICKOFF_SPOT);
  }
  updateCoin() {
    const c = this.coin;
    if (!c) return;
    if (!c.done) { if ((this.phaseT > TIMING.COIN_SEC && !this.coinHold) || this.autopilot) this.resolveCoin(null, null); return; }
    if (!c.receiver) { if ((this.phaseT > TIMING.COIN_SEC && !this.coinHold) || this.autopilot) this.chooseCoin("receive", true); return; }
    if (this.phaseT > TIMING.COIN_RESULT_SEC) this.afterCoin();
  }

  // ---------- units ----------
  unitOffense(k) { return SLOTS_OFF.map((s) => this.roster[k][s]); }
  unitDefense(k) { return SLOTS_DEF.map((s) => this.roster[k][s]); }

  placeAll(off, def) {
    this.off = off; this.def = def;
    this.players = [...off, ...def];
    for (const p of off) { p.side = "O"; }
    for (const p of def) { p.side = "D"; }
    this.ball.reset();
    this.qb = null; this.kicker = null; this.holder = null; this.returner = null;
    this.passThrown = false; this.handedOff = false; this.losCrossed = false; this.kicked = false; this.thrownAway = false;
    this.fairCatch = false; this.letGo = false; this.downedBy = null; this.returnKneel = false; this.handoffT = 0; this.pressure = 0; this.fumbleBy = null;
    this.result = null; this.t = 0; this.kickInput = null; this.carrierDesignate = null; this.kneelT = 0;
    this.catchSpot = null; this.intSpot = null; this.retStart = null; this.retMom = null; this.retOut = false; this.lastTackleTry = -9; this.swatted = false; this.runHoleY = null;
    this.runSide = 0; this.blockRolled = false; this.blockedKick = null; this.blockReturn = false; this.flickT = null; this.readDef = null; this.kickTouch = false; this.hurry = null; this.rpoThrow = false; this.rpoKey = null;
    this.fake = null; // a fake punt or field goal lined up (setupPunt / setupFG; fakeGo)
    if (this.squad) { this.intBy = null; this.swatBy = null; this.kickBlocker = null; this.fumbleX = null; }
  }

  // ---------- kickoffs ----------
  setupKickoff(kickTeam, spot = RULES.KICKOFF_SPOT, opts = {}) {
    if (this.squad) SQ.deadBall(this, kickTeam, true); // substitutions, rest, effective ratings (squad.js)
    this.possession = kickTeam;
    this.playType = "kickoff";
    this.call = { off: null, def: null };
    // kick type: the CPU decides now; a human kicker starts from a normal kick (Tab / action "kickType" changes it)
    const type = opts.onside ? "onside" : opts.squib ? "squib" : this.isUserTeam(kickTeam) ? "normal" : AI.cpuKickType(this, kickTeam);
    this.onside = type === "onside"; this.squib = type === "squib";
    this.los = spot; this.ballY = MID_Y; this.down = 1; this.toGo = 10;
    const kt = kickTeam, rt = other(kickTeam);
    const k = this.roster[kt].K;
    const cover = SLOTS_DEF.filter((s) => s !== "NT").map((s) => this.roster[kt][s]);
    const chosen = this.squad ? SQ.returners(this, rt, "kr") : []; // a team's own kick returners (squad.js), if it named any
    const recv = this.unitOffense(rt);
    this.placeAll([k, ...cover], recv);
    this.kicker = k;
    k.reset(spot - 6, MID_Y);
    cover.forEach((p, i) => { const y = 4 + i * ((FIELD_W - 8) / 9); p.reset(spot - 1, y); });
    // return team: 5 front, 4 mid, 2 deep (hands team up front when an onside kick is coming: the CPU's own onside
    // kick, or a human kicker who's down late enough that he has to, or who keeps trying them — anything else is a
    // surprise). onsideSet: how set it is for one (0 surprise · 1 front line home · 2 hands team: ai.onsideWary), and
    // onsideRead how soon it breaks on one (ai.onsideReturn). deep: the team's named returners, else the fastest
    const order = [...chosen, ...recv.filter((p) => !chosen.includes(p)).sort((a, b) => b.r.speed - a.r.speed)];
    const deep = order.slice(0, 2), rest = order.slice(2);
    deep[0].reset(96, MID_Y - 6); deep[1].reset(95, MID_Y + 6);
    const wary = this.isUserTeam(kt) ? AI.onsideWary(this, rt, kt) : 0;
    const hands = this.isUserTeam(kt) ? AI.onsideTime(this, kt) || wary >= 2 : this.onside;
    this.handsTeam = hands;
    this.onsideSet = hands ? 2 : wary;
    this.onsideRead = AI.onsideRead(this, rt, this.onsideSet);
    rest.forEach((p, i) => {
      if (i < 5) p.reset(spot + 12 + (i % 2), 10 + i * 8.3);
      else p.reset(spot + (hands ? 17 : 30), 9 + (i - 5) * 11.7);
    });
    for (const p of this.players) { p.sx = p.x; p.sy = p.y; p.faceX = p.side === "O" ? 1 : -1; p.faceY = 0; }
    this.returners = deep;
    this.returner = deep[0];
    this.setReturnLane(rt);
    this.ball.state = "dead"; this.ball.x = spot; this.ball.y = MID_Y; this.ball.z = 0.3;
    this.control = this.isUserTeam(rt) ? deep[0] : this.isUserTeam(kt) ? k : null;
    this.waitUser = this.isUserTeam(kt) ? "kick" : null;
    this.setPhase("presnap");
    this.bus.emit("kickoff", { team: kt, setup: true, type });
  }
  // the receiving team's lane call for this kick (CPU: decided now; a human keeps their last call)
  setReturnLane(rt) {
    if (!this.isUserTeam(rt)) this.laneByTeam[rt] = AI.cpuReturnLane(this);
    this.returnLane = this.laneByTeam[rt];
    this.returnLaneY = LANE_Y[this.returnLane];
  }
  get kickType() { return this.onside ? "onside" : this.squib ? "squib" : "normal"; }

  // ---------- regular plays ----------
  beginPlayCall() {
    if (this.squad) SQ.deadBall(this, this.possession, false); // substitutions, rest, effective ratings (squad.js)
    this.playType = "normal";
    this.call = { off: null, def: null };
    this.defCalled = null; this.defAud = null; this.realignT = null; this.realignT = null; // (a defensive audible lasts its down)
    this.hot = {};
    this.waitUser = null;
    this.huddle();
    this.setPhase("playcall");
    this.clockAtCall();
    const offCPU = !this.isUserTeam(this.possession), defCPU = !this.isUserTeam(this.defTeam);
    if (offCPU) this.noHuddle[this.possession] = AI.cpuTempo(this) === "hurry"; // the CPU's two-minute drill
    if (offCPU && AI.lastSnapFG(this)) { this.setupFG(false); return; } // time for one more snap: kick it
    if (this.down === 4 && offCPU) {
      const ch = AI.fourthDownChoice(this);
      // (now and then a fake instead: ai.cpuFake — rarely, only where it makes sense)
      if (ch === "punt") { this.setupPunt(AI.cpuFake(this, "punt")); return; }
      if (ch === "fg") { this.setupFG(false, AI.cpuFake(this, "fg")); return; }
    }
    if (offCPU) this.call.off = this.cpuOffense(); // a spike or a kneel when the clock says so
    if (defCPU || (offCPU && this.call.off.clock)) this.call.def = AI.cpuDefCall(this); // (a spike or a kneel: the human defense doesn't call)
    this.waitUser = !offCPU ? "call" : !this.call.def ? "call" : null;
    this.bus.emit("playCall", { down: this.down, toGo: this.toGo, los: this.los, waitUser: this.waitUser });
  }
  huddle() {
    // players gather in huddles behind/in front of the ball (visual between plays)
    const off = this.unitOffense(this.possession), def = this.unitDefense(this.defTeam);
    this.placeAll(off, def);
    const bx = this.los, by = this.ballY;
    off.forEach((p, i) => { const a = (i / 11) * Math.PI * 2; p.reset(bx - 8 + Math.cos(a) * 2.2, by + Math.sin(a) * 2.2); p.faceX = -Math.cos(a); p.faceY = -Math.sin(a); });
    def.forEach((p, i) => { const a = (i / 11) * Math.PI * 2; p.reset(bx + 9 + Math.cos(a) * 2.4, by + Math.sin(a) * 2.4); p.faceX = -Math.cos(a); p.faceY = -Math.sin(a); });
    this.ball.reset(); this.ball.x = bx; this.ball.y = by; this.ball.z = 0.2;
    this.control = null;
  }
  // flip: run it mirrored (FLIP on the play call; left out: the play as given — a mirrored copy stays mirrored)
  setCall(side, play, flip = Boolean(play && play.flip)) {
    if (this.phase !== "playcall") return;
    this.call[side === "O" ? "off" : "def"] = asCalled(play, flip);
    if (this.call.off && this.call.def) this.setupPlay();
  }
  // the CPU offense's call: a spike or a kneel when the clock says so, else its play, FLIPped or not (ai.cpuFlip)
  cpuOffense() { return AI.cpuClockPlay(this) || AI.cpuFlip(this, AI.cpuOffCall(this)); }
  // 4th-down specials chosen by the user: punt · fg · fakePunt · fakeFG (F4: the kick unit lines up for the kick, and
  // the snap goes to the man who runs or throws — canFake says when)
  chooseSpecial(kind) {
    if (this.phase !== "playcall") return;
    if (kind === "punt") this.setupPunt();
    else if (kind === "fg") this.setupFG(false);
    else if (kind === "fakePunt" && this.canFake("punt")) this.setupPunt(true);
    else if (kind === "fakeFG" && this.canFake("fg")) this.setupFG(false, true);
  }
  // a fake can be called on a 4th down from scrimmage; a fake field goal only where the kick would be in range
  canFake(kind) { return this.playType === "normal" && this.down === 4 && (kind === "punt" || 117 - this.los <= KICKING.FG_RANGE); }

  setupPlay() {
    const play = this.call.off;
    const off = this.unitOffense(this.possession), def = this.unitDefense(this.defTeam);
    this.placeAll(off, def);
    this.playType = this.playType === "two" ? "two" : "normal";
    const pos = offPos(play);
    for (const p of off) {
      const [dx, dy] = pos[p.slot];
      p.reset(this.los + dx, clamp(this.ballY - dy, 1, FIELD_W - 1));
      p.as = this.hot[p.slot] || play.a[p.slot] || { kind: "block", block: "pass" };
      p.faceX = 1; p.faceY = 0;
    }
    this.qb = this.bySlot(off, "QB");
    this.alignDefense();
    // break the huddle: start a few yards back and jog in (no huddle: they're nearly there)
    const near = this.noHuddleNow();
    for (const p of this.players) {
      p.sx = p.x; p.sy = p.y;
      const back = (p.side === "O" ? -3.5 : 3.5) * (near ? 0.25 : 1);
      p.x += back; p.ai.home = [p.sx, p.sy];
    }
    this.ball.x = this.los; this.ball.y = this.ballY; this.ball.z = 0.2; this.ball.state = "dead";
    // control
    const us = this.userSide();
    if (us === "O" && !this.autopilot) this.control = play.type === "run" ? this.bySlot(off, play.carrier || "HB") : this.qb;
    else if (us === "D" && !this.autopilot) this.control = this.bySlot(def, this.userDefSlot || "ILB1") || def[4];
    else this.control = null;
    this.waitUser = us === "O" && !this.autopilot ? "snap" : null;
    this.setPhase("presnap");
    this.bus.emit("presnap", { off: play, def: this.defSet });
  }

  // The defense's alignment and assignments for its call (setupPlay; again after a defensive audible: defAudible). It
  // sets to the formation's strength: its calls are drawn against an offense with its strength (the tight end) on the
  // right, so it mirrors with a FLIPped offense, and its own FLIP mirrors it against the formation. again: an audible at
  // the line — each man's new spot (sx, sy: he jogs there, updatePresnap), where he stands now kept
  alignDefense(again = false) {
    const play = this.call.off, dplay = asCalled(this.call.def, Boolean(play.flip) !== Boolean(this.call.def.flip));
    this.defSet = dplay; // (the defense as it lines up)
    const off = this.off, def = this.def;
    const scheme = this.teams[this.defTeam].scheme;
    const dpos = defPos(dplay, scheme);
    const da = defAssignments(dplay, scheme);
    // man(0) / man(1): the outside receivers on the defense's left / right as its call is drawn (a mirrored defense:
    // its right / left — CB1 takes the outside man on his own side)
    const recs = off.filter((p) => ELIGIBLE.includes(p.slot)).map((p) => ({ p, dy: this.ballY - (again ? p.sy : p.y) }));
    const dpar = dplay.flip ? -1 : 1;
    recs.sort((a, b) => (a.dy - b.dy) * dpar);
    const manOrder = [];
    if (recs.length) {
      manOrder.push(recs[0].p, recs[recs.length - 1].p);
      const inner = recs.slice(1, -1).sort((a, b) => Math.abs(b.dy) - Math.abs(a.dy)).map((r) => r.p);
      manOrder.push(...inner);
    }
    // (MAN PRESS: the corners up on the outside receivers' noses, defAudible)
    const press = dplay.formation === "GOALLINE" || dplay.blitz || Boolean(this.defAud && this.defAud.press);
    const was = again ? def.map((p) => [p.x, p.y]) : null; // (where they stand: they jog to the new spots)
    for (const p of def) {
      let [dx, dy] = dpos[p.slot] || [5, 0];
      const as = da[p.slot] || { kind: "zone", zone: "robber" };
      p.reset(p.x, p.y);
      p.as = { ...as };
      if (as.kind === "man") p.as.target = manOrder[as.n] || null;
      if (this.defAud && this.defAud.press && (p.slot === "CB1" || p.slot === "CB2") && as.kind === "man") p.as.press = true; // (ai.coverMan, the jam: ai.snapSetup; kept when the offense audibles after it)
      // corners align over the outside receivers
      const rx = (r) => (again ? r.sy : r.y);
      if (p.slot === "CB1" && manOrder[0]) { dy = this.ballY - rx(manOrder[0]) - 0.8 * Math.sign(this.ballY - rx(manOrder[0]) || dpar) * -1; dx = press ? 1.6 : dx; }
      if (p.slot === "CB2" && manOrder[1]) { dy = this.ballY - rx(manOrder[1]); dx = press ? 1.6 : dx; }
      // keep everyone in the field of play near the goal line (no one aligns past the end line)
      p.x = Math.min(this.los + dx, 109); p.y = clamp(this.ballY - dy, 1, FIELD_W - 1);
      p.faceX = -1; p.faceY = 0;
    }
    if (this.hard) AI.hardAlign(this, def, dplay, manOrder); // PRO to LEGEND: the CPU's presnap look (ai.js)
    AI.pairMan(this, def); // man coverage by alignment: nobody chases a receiver lined up on the other side of the ball
    if (again) def.forEach((p, i) => { p.sx = p.x; p.sy = p.y; p.ai.home = [p.sx, p.sy]; [p.x, p.y] = was[i]; });
  }
  // ---------- defensive audibles (F3, Discord 2026-10-29: "Please add defensive audibles") ----------
  // The human defense at the line (a scrimmage down or a try, its call made, the offense's not a spike or a kneel):
  // defAudible(id) changes the call there — playbook.js DEF_AUDIBLES: "blitz" (its front's own blitz), "prevent" (deep
  // zones), "press" (cover 1, the corners pressed on the outside receivers: a jam at the snap, ai.snapSetup), "stack"
  // (the bear front: eight in the box) — or back to the call it made ("called"). Its men jog to their new spots and jobs
  // (alignDefense); its own FLIP stays; the offense keeps its play (the CPU's check at the line, ai.hardPresnap, never
  // answers one). → true when it took. Event "defAudible" { id, def } (online: the defense's seat only, as its call)
  defAudible(id) {
    if (this.phase !== "presnap" || (this.playType !== "normal" && this.playType !== "two") || !this.call.def || !this.call.off || this.call.off.clock) return false;
    const called = this.defCalled || this.call.def;
    const A = id === "called" ? null : DEF_AUDIBLES.find((x) => x.id === id);
    const play = id === "called" ? basePlay(called) : A ? defAudiblePlay(A, basePlay(called)) : null;
    if (!play) return false;
    this.defCalled = called;
    this.defAud = A ? { id, press: Boolean(A.press), playNo: this.playNo } : null;
    this.call.def = asCalled(play, Boolean(called.flip));
    this.hardAud = this.playNo; // (the CPU offense has checked, or never will: it keeps its play)
    this.realignT = this.phaseT;
    this.alignDefense(true);
    this.bus.emit("defAudible", { id, def: this.call.def });
    return true;
  }
  // audible / hot route (user, pre-snap; cpu: the CPU's own check at the line, ai.hardPresnap — no "audible" event). The
  // audible keeps the call's FLIP (flip: say otherwise); a hot route for a man lined up on the ball breaks the mirrored
  // way on a flipped play (his outside: snap)
  audible(play, cpu = false, flip = Boolean(this.call.off && this.call.off.flip)) {
    if (this.phase !== "presnap" || this.playType !== "normal" && this.playType !== "two") return;
    this.call.off = asCalled(play, flip);
    this.hot = {};
    const keepT = this.phaseT;
    this.setupPlay();
    this.phaseT = Math.max(keepT, TIMING.HUDDLE_SEC);
    for (const p of this.players) { p.x = p.sx; p.y = p.sy; }
    if (!cpu) this.bus.emit("audible", { play });
  }
  hotRoute(slot, routeName) {
    if (this.phase !== "presnap") return;
    const p = this.bySlot(this.off, slot);
    if (!p) return;
    const as = hotRoute(routeName);
    if (as.kind === "route" && this.call.off && this.call.off.flip) as.side = -1;
    this.hot[slot] = as;
    p.as = as;
    this.bus.emit("hotRoute", { slot, route: routeName });
  }

  // ---------- punts / field goals ----------
  setupPunt(fake = false) {
    this.playType = "punt";
    this.call = { off: null, def: null };
    const chosen = this.squad ? SQ.returners(this, this.defTeam, "pr") : []; // a team's own punt returner, if it named one
    const off = this.unitOffense(this.possession), def = this.unitDefense(this.defTeam);
    const k = this.roster[this.possession].K;
    const unit = off.map((p) => (p.slot === "QB" ? k : p));
    this.placeAll(unit, def);
    const f = FORMATIONS.SHOTGUN.pos;
    for (const p of unit) {
      let [dx, dy] = f[p.slot] || [-1, 0];
      if (p === k) { dx = Math.max(-14, -9.5 - this.los); dy = 0; } // backed up: at the back of the end zone, not past it
      if (p.slot === "HB") { dx = -7; dy = 1.5; }
      if (p.slot === "FB") { dx = -7; dy = -1.5; }
      if (p.slot === "WR1") { dx = -0.8; dy = -20; }
      if (p.slot === "WR2") { dx = -0.8; dy = 20; }
      if (p.slot === "TE") { dx = -1; dy = 3.8; }
      p.reset(this.los + dx, clamp(this.ballY - dy, 1, FIELD_W - 1));
      p.as = { kind: "block", block: "pass" };
      p.faceX = 1;
    }
    const df = defFormation("BASE", this.teams[this.defTeam].scheme).pos;
    const order = def.slice().sort((a, b) => b.r.speed - a.r.speed);
    this.returner = chosen[0] || order.find((p) => p.slot.startsWith("CB") || p.slot.startsWith("S")) || order[0];
    // the receiving team sells out for the block now and then when the punter is backed up
    const blockCall = !this.isUserTeam(this.defTeam) && this.rng.chance(this.los < 30 ? 0.3 : 0.12);
    for (const p of def) {
      let [dx, dy] = df[p.slot] || [3, 0];
      if (p === this.returner) { dx = Math.min(40, 99 - this.los); dy = 0; }
      else if (p.slot.startsWith("CB")) { dx = 1.5; dy = p.slot === "CB1" ? -20 : 20; }
      p.reset(this.los + dx, clamp(this.ballY - dy, 1, FIELD_W - 1));
      p.as = { kind: "rush" };
      p.faceX = -1;
      p.ai.puntRush = p !== this.returner && (DL_RUSH.includes(p.slot) || (blockCall && p.slot.startsWith("OLB")));
      if (p.ai.puntRush) p.x = Math.min(p.x, this.los + 1.2);
    }
    if (blockCall) this.bustRush(def.filter((p) => p.ai.puntRush));
    for (const p of this.players) { p.sx = p.x; p.sy = p.y; }
    this.kicker = k; this.qb = null;
    this.setReturnLane(this.defTeam);
    this.ball.x = this.los; this.ball.y = this.ballY; this.ball.z = 0.2; this.ball.state = "dead";
    const userKick = this.isUserTeam(this.possession), userRet = this.isUserTeam(this.defTeam);
    // a fake (F4): the same punt to the eye; the snap goes to the punter (or, 4th and a yard, the up-back: FAKE.UPBACK)
    if (fake) this.fake = { kind: "punt", up: this.toGo <= FAKE.UPBACK, to: null, on: false, wary: AI.fakeWary(this, "punt") };
    this.control = userRet ? this.returner : userKick && fake ? (this.fake.up ? this.bySlot(unit, "FB") : k) : null;
    this.waitUser = userKick ? (fake ? "snap" : "kick") : null;
    this.setPhase("presnap");
    this.bus.emit("punt", { setup: true, block: blockCall });
  }
  setupFG(pat, fake = false) {
    this.playType = pat ? "pat" : "fg";
    this.call = { off: null, def: null };
    if (pat) { this.los = RULES.PAT_SPOT; this.ballY = MID_Y; }
    const off = this.unitOffense(this.possession), def = this.unitDefense(this.defTeam);
    const k = this.roster[this.possession].K;
    const unit = off.filter((p) => p.slot !== "WR2");
    unit.push(k);
    this.placeAll(unit, def);
    const f = FORMATIONS.GOALLINE.pos;
    this.holderSpot = [this.los - 7, this.ballY];
    for (const p of unit) {
      let [dx, dy] = f[p.slot] || [-1, 0];
      if (p.slot === "QB") { dx = -7; dy = 0; }
      if (p === k) { dx = -9.6; dy = 1.8; }
      if (p.slot === "HB") { dx = -1.6; dy = -4.6; }
      if (p.slot === "FB") { dx = -1.6; dy = 4.6; }
      if (p.slot === "WR1") { dx = -1; dy = -3.8; }
      p.reset(this.los + dx, clamp(this.ballY - dy, 1, FIELD_W - 1));
      p.as = { kind: "block", block: "pass" };
      p.faceX = 1;
    }
    // the block unit: the line and the edges come; on an all-out call the inside backers too
    const allOut = this.rng.chance(0.3);
    const df = defFormation("GOALLINE", this.teams[this.defTeam].scheme).pos;
    for (const p of def) {
      const [dx, dy] = df[p.slot] || [3, 0];
      p.reset(Math.min(this.los + dx + (p.slot.startsWith("S") ? 3 : 0), 109), clamp(this.ballY - dy, 1, FIELD_W - 1));
      p.as = { kind: "rush" }; p.faceX = -1;
      p.ai.fgRush = DL_RUSH.includes(p.slot) || p.slot.startsWith("OLB") || (allOut && (p.slot.startsWith("ILB") || p.slot.startsWith("CB")));
    }
    if (allOut) this.bustRush(def.filter((p) => p.ai.fgRush));
    for (const p of this.players) { p.sx = p.x; p.sy = p.y; }
    this.kicker = k; this.holder = this.bySlot(unit, "QB"); this.qb = null;
    this.ball.x = this.los; this.ball.y = this.ballY; this.ball.z = 0.2; this.ball.state = "dead";
    // a fake (F4): the same kick to the eye; the holder runs or throws it
    if (fake && !pat) this.fake = { kind: "fg", up: false, to: null, on: false, wary: AI.fakeWary(this, "fg") };
    // a defending user gets an edge rusher: get around the corner and leap (E) or lay out (F) to block it
    this.control = this.isUserTeam(this.defTeam) ? (this.bySlot(def, "OLB2") || this.bySlot(def, "DE2")) : this.fake && this.isUserTeam(this.possession) ? this.holder : null;
    this.waitUser = this.isUserTeam(this.possession) ? (this.fake ? "snap" : "kick") : null;
    this.setPhase("presnap");
    this.bus.emit(pat ? "pat" : "fieldGoalSetup", { setup: true });
  }

  // ---------- fakes (F4, Discord 2026-10-29: fake punts and fake field goals) ----------
  // The snap of a fake punt or field goal is in the hands of the man it went to (the punter, the up-back, the holder):
  // from here it's a scrimmage down — its stats, the chains, a turnover on downs short of the line to gain — with the
  // kick unit's own play (playbook.js FAKE_PLAYS: routes and blocks from where everyone stands now) and him as its
  // quarterback: he runs or throws (a person with the stick and the receivers' keys; the CPU's QB brain: ai.qbThink).
  // The defense played the kick until now and each man reads it in a moment (ai.fakeDefense: sooner when it smelled
  // one coming, ai.fakeWary). Event fake { kind, team, run, player } (both teams see it: it's out)
  fakeGo() {
    const f = this.fake, man = f.to, play = f.kind === "fg" ? FAKE_PLAYS.fg : f.up ? FAKE_PLAYS.upback : FAKE_PLAYS.punt;
    f.on = true; f.t = this.t;
    this.playType = "normal";
    this.call = { off: play, def: null };
    this.qb = man; this.holder = null; this.returner = null; this.returners = null;
    for (const p of this.def) if (p.engaged && p.blocking) P.release(p, p.engaged); // (the holds on the gunners let go; the line's blocks hold)
    for (const p of this.off) {
      p.ai = { wp: 0, t: 0, target: null, settle: false, lane: 0, home: [p.x, p.y] };
      p.sx = p.x; p.sy = p.y; // (the play's spots: where they stand)
      p.as = p === man ? { kind: "qb" } : play.a[p.slot] || { kind: "block", block: "pass" };
      if (p.as.kind === "route") {
        const outSign = Math.abs(p.y - this.ballY) > 0.6 ? (p.y < this.ballY ? 1 : -1) : (p.as.side || 1);
        p.ai.wps = p.as.pts.map(([dn, o]) => [Math.min(108, p.x + dn), clamp(p.y - o * outSign, 1.2, FIELD_W - 1.2)]);
      }
    }
    if (play.type === "run") {
      this.handedOff = true; this.handoffT = this.t; this.carrierDesignate = man;
      man.ai.path = play.run.map(([dx, dy]) => [this.los + dx, clamp(this.ballY - dy, 1, FIELD_W - 1)]); man.ai.wp = 0;
      this.runHoleY = clamp(this.ballY - play.hole[1], 1, FIELD_W - 1);
      this.runSide = Math.abs(this.runHoleY - this.ballY) < 1.2 ? 0 : Math.sign(this.runHoleY - this.ballY);
    }
    AI.fakeDefense(this, f);
    AI.fakeOffense(this, play);
    if (this.isUserTeam(this.possession)) this.control = man;
    this.fakes[this.possession]++;
    this.bus.emit("fake", { kind: f.kind, team: this.possession, run: play.type === "run", player: man });
  }

  // a protection bust on a block call: the edge rusher on one side comes clean (nobody can pick him up)
  bustRush(rushers) {
    if (!rushers.length || !this.rng.chance(KICKING.BUST)) return;
    const side = this.rng.chance(0.5) ? 1 : -1;
    let best = rushers[0];
    for (const p of rushers) if ((p.y - this.ballY) * side > (best.y - this.ballY) * side) best = p;
    best.ai.free = true;
  }

  // ---------- snap ----------
  snap() {
    if (this.phase !== "presnap") return;
    if (this.timeoutWait() > 0) return; // a timeout: nobody snaps or kicks until it's over (the CPU, the coach, the human)
    if (this.waitUser === "kick" && !this.kickInput) return;
    for (const p of this.players) { if ((this.playType === "normal" || this.playType === "two") && !p.ai.userShifted) { p.x = p.sx; p.y = p.sy; } p.vx = 0; p.vy = 0; }
    this.clockAtSnap();
    this.setPhase("live");
    this.t = 0;
    this.playUserInput = false;
    this.playNo++;
    this.playStartClock = this.clock;
    if (this.homeEdge) this.crowd = this.possession === "away" && (this.playType === "two" || (this.playType === "normal" && this.down >= 3)) ? this.homeEdge : 0;
    if (this.squad) { SQ.onSnap(this); if (this.statsBy) PS.snapped(this); if (this.pbp) PBP.snap(this); }
    const b = this.ball;
    if (this.playType === "kickoff") {
      if (!this.kickInput) this.kickInput = AI.cpuKick(this, this.kicker, "kickoff");
      b.state = "held"; b.kind = "kickwait"; b.carrier = null;
      this.bus.emit("snap", { kick: true, type: this.kickType });
      return;
    }
    if (this.playType === "punt" || this.playType === "fg" || this.playType === "pat") {
      if (!this.kickInput && !this.fake) this.kickInput = AI.cpuKick(this, this.kicker, this.playType);
      const to = this.fake && this.fake.up ? this.bySlot(this.off, "FB") : this.playType === "punt" ? this.kicker : this.holder;
      if (this.fake) this.fake.to = to;
      const c = this.bySlot(this.off, "C");
      b.state = "air"; b.kind = "snap"; b.target = to;
      P.launch(b, c.x, c.y, 0.5, to.x, to.y, 1.0, this.fake && this.fake.up ? 0.36 : this.playType === "punt" ? 0.62 : 0.42); // (a fake's direct snap to the up-back: half as far)
      this.bus.emit("snap", { kick: true });
      return;
    }
    // offense
    const play = this.call.off;
    if (this.playType === "normal") AI.noteCall(this); // (the calls this game: ai.js, against repeats and the other side's tendencies)
    if (this.down === 3) this.stats[this.possession].thirdAtt++;
    for (const p of this.off) {
      p.ai = { wp: 0, t: 0, target: null, settle: false, lane: 0, home: p.ai.home };
      if (p.as && p.as.kind === "route") {
        // outSign +1 → receiver aligned on the offense's right (smaller y); "outside" in world y is −outSign
        const outSign = Math.abs(p.sy - this.ballY) > 0.6 ? (p.sy < this.ballY ? 1 : -1) : (p.as.side || 1);
        p.ai.wps = p.as.pts.map(([dn, o]) => [Math.min(108, p.sx + dn), clamp(p.sy - o * outSign, 1.2, FIELD_W - 1.2)]);
      }
    }
    for (const p of this.def) p.ai = { wp: 0, t: 0, target: null, settle: false, lane: 0, home: p.ai.home };
    const qb = this.qb, c = this.bySlot(this.off, "C");
    const shotgun = qb.sx < this.los - 2.5;
    b.state = "air"; b.kind = "snap"; b.target = qb;
    P.launch(b, c.x, c.y, 0.5, qb.x, qb.y, 1.2, shotgun ? 0.3 : 0.06);
    if (play.type === "run") {
      const car = this.bySlot(this.off, play.carrier || "HB");
      this.carrierDesignate = car;
      car.ai.path = play.run.map(([dx, dy]) => [this.los + dx, clamp(this.ballY - dy, 1, FIELD_W - 1)]);
      car.ai.wp = 0;
      const hole = play.hole || play.run[Math.min(1, play.run.length - 1)];
      this.runHoleY = clamp(this.ballY - hole[1], 1, FIELD_W - 1);
      this.runSide = Math.abs(this.runHoleY - this.ballY) < 1.2 ? 0 : Math.sign(this.runHoleY - this.ballY);
    } else if (play.flea) {
      // flea flicker: the back comes to the mesh, takes it to the line, pitches it back
      const car = this.bySlot(this.off, "HB");
      this.carrierDesignate = car;
      car.ai.path = [[this.los - 4.4, this.ballY], [this.los - 1.4, this.ballY]];
      car.ai.wp = 0;
    }
    AI.snapSetup(this);
    this.bus.emit("snap", { play });
  }

  // A timeout, between plays (0:00: nothing to stop). In a game with a human in it, it lasts RULES.TIMEOUT_SEC (the wait:
  // timeoutWait), or until it's skipped (skipTimeout). A team can't call another during its own (a second press would
  // only waste one); the other team can, and the wait starts over (nobody ready again). One at the line of a scrimmage
  // down sends both teams back to call it again (reHuddle); a kick stays set and waits (icing: a kick already made at
  // the meter goes again)
  callTimeout(k) {
    if (this.timeouts[k] <= 0 || !BETWEEN.has(this.phase) || this.ot || this.clock <= 0 || (this.timeoutWait() > 0 && this.timeoutBy === k)) return false;
    this.timeouts[k]--;
    this.clockRun = false; // stopped until the snap, 25 on the play clock
    this.playClock = RULES.PLAY_CLOCK_ADMIN;
    const wait = this.timeoutHolds();
    if (wait) { this.timeoutLeft = RULES.TIMEOUT_SEC; this.timeoutBy = k; this.timeoutReady.home = this.timeoutReady.away = false; if (this.phase === "presnap") this.kickInput = null; }
    this.bus.emit("timeout", { team: k, left: this.timeouts[k] });
    if (wait && this.phase === "presnap" && (this.playType === "normal" || this.playType === "two")) this.reHuddle();
    return true;
  }
  // A timeout's wait (callTimeout): the time left (s), or 0. Nobody snaps or kicks until it's over (snap), the game clock
  // stays stopped and the play clock waits at :25 (tickClock), the play call stays open to both teams. Only a game with a
  // human in it waits (timeoutHolds): a sim or the autopilot (the CPU against itself) plays on at once, as it always has,
  // and so does an online match while the CPU plays both seats (seats.js: both tabs hidden or gone)
  timeoutWait() { return this.timeoutLeft > 0 && this.timeoutHolds() ? this.timeoutLeft : 0; }
  timeoutHolds() { return Boolean(this.user) && !this.autopilot && !this.headless && (!this.seats || this.seats.home.human || this.seats.away.human); }
  // SKIP: team k is ready to play on (single-player PRO: the human's SNAP or KICK, or a tap on the timeout's bar —
  // controls.js; online: a seat's READY, online/src/match.js). The wait ends at once when every team is ready, and a
  // team the CPU plays always is (the other side of a single-player game, an online seat that's away or gone): one press
  // ends a single player's wait, his own timeout's or the CPU's; online both people press. It ends exactly as if it had
  // run out (endTimeout): the clocks, the play calls and the huddle as then, the same timeoutEnd → true: the press counted
  skipTimeout(k = this.user) {
    if (!(this.timeoutWait() > 0) || !this.isUserTeam(k) || this.timeoutReady[k]) return false;
    this.timeoutReady[k] = true;
    if (this.timeoutAllReady()) this.endTimeout();
    return true;
  }
  timeoutAllReady() { return (this.timeoutReady.home || !this.isUserTeam("home")) && (this.timeoutReady.away || !this.isUserTeam("away")); }
  // a frame of the wait (update) → true while it still holds the game; "timeoutEnd" when it's over: run out, or every team
  // ready (online: one seat READY, the other's team since taken over by the CPU). The human gone (the autopilot took
  // over, the rest of a Franchise game simmed): no wait, and no word of it
  tickTimeout(dt) {
    if (!this.timeoutHolds()) { this.timeoutLeft = 0; this.timeoutBy = null; this.timeoutReady.home = this.timeoutReady.away = false; return false; }
    if (this.timeoutAllReady()) { this.endTimeout(); return false; }
    this.timeoutLeft = Math.max(0, this.timeoutLeft - dt);
    if (this.timeoutLeft > 1e-6) return true;
    this.endTimeout();
    return false;
  }
  endTimeout() {
    const team = this.timeoutBy;
    this.timeoutLeft = 0; this.timeoutBy = null; this.timeoutReady.home = this.timeoutReady.away = false;
    this.bus.emit("timeoutEnd", { team });
  }
  // A timeout at the line of a scrimmage down or a two-point try: both teams back to the huddle to call it again (a call
  // already made can be changed), as after a real timeout. The huddle breaks again after the new call (breakHuddle: the
  // accelerated clock, the CPU's tempo)
  reHuddle() {
    this.broke = -1;
    if (this.playType !== "two") { this.beginPlayCall(); return; }
    this.hot = {};
    this.twoPointCall();
    this.bus.emit("playCall", { down: 1, toGo: 2, los: this.los, waitUser: this.waitUser, two: true });
  }

  // ---------- the clock between plays (Madden's clock on the NFL's rules) ----------
  // After a play the offense ends in bounds, the game clock keeps running through the dead ball, the play call and the
  // line-up, and the 40-second play clock runs from the whistle. The game clock stops until the snap on an incompletion,
  // a score, a turnover or a change of possession, a kick, a timeout and the two-minute warning (the play clock then
  // reads 25). Out of bounds it starts again once the ball is set (the play call), except in the last 2:00 of the first
  // half and the last 5:00 of the game (RULES.OOB_STOP, time left in the half: with 4-minute quarters the game's last
  // 5:00 begins in the 3rd quarter), when it waits for the snap. First downs don't stop it. The two-minute warning comes
  // when the half's clock reaches 2:00 (at the whistle of a play that runs through it); a quarter that starts at 2:00
  // or less has none. ACCELERATED CLOCK (Madden): when the huddle breaks — both sides have called the play — the play
  // clock drops to `accel` and a running game clock with it; never for a hurry-up offense (noHuddle) nor in a half's
  // last two minutes, where only the time really used comes off. At :00 the coach calls the play and the QB snaps it
  // (hud.js), no delay of game. A CPU offense snaps on its tempo (ai.cpuTempo → tempo.snapAt on the play clock: a
  // hurry-up 8 s after the whistle, one running out the clock at :02, one milking it for a last-snap field goal once
  // the game clock is down to the kick's: ai.milkAt). A sim's dead ball and line-up are quicker than a
  // real game's: the clocks catch up at the end of the dead ball and at the snap, so a sim burns the time a game does.
  // A TIMEOUT'S WAIT (a game with a human in it: timeoutWait) holds both clocks where the timeout left them (the game
  // clock stopped, :25) and the huddle's break; the play call and the line-up keep their own time for when it's over.
  half() { return this.quarter <= 2 ? 1 : 2; }
  halfLeft() { return this.ot ? 0 : this.clock + (this.quarter === 1 || this.quarter === 3 ? this.quarterSec : 0); }
  clockRunning() { return this.clockRun !== false && !this.ot; }
  oobStops() { return this.halfLeft() <= RULES.OOB_STOP[this.half() - 1]; }
  // a hurry-up line-up: the offense's no huddle, or a spike
  noHuddleNow() { return (this.playType === "normal" || this.playType === "two") && (this.noHuddle[this.possession] || Boolean(this.call.off && this.call.off.spike)); }
  // per frame between plays (dead ball, play call, line-up) → false when time ran out and that took over the flow
  tickClock(dt) {
    if (this.phase === "dead" && this.clockDone !== this.playNo) this.whistleClock();
    if (this.timeoutWait() > 0) return true; // a timeout: both clocks wait for it (and the huddle breaks once it's over)
    if (this.phase === "presnap" && this.broke !== this.playNo && !this.breakHuddle()) return false;
    if (this.playType === "kickoff" || this.playType === "pat") return true;
    return this.runClocks(dt);
  }
  // the play call: a 25-second play clock starts (after an administrative stoppage); out of bounds before the late
  // windows, the ball is set: the game clock starts again
  clockAtCall() {
    if (this.clockRun === "set") this.clockRun = true;
    if (!this.playClockOn) { this.playClock = RULES.PLAY_CLOCK_ADMIN; this.playClockOn = true; }
  }
  clockAtSnap() { this.clockRun = false; this.playClockOn = false; this.snapHalf = this.halfLeft(); }
  // the rules at the whistle (the first frame of the dead ball). Under a second left the clock reads 0:00 (RULES.
  // CLOCK_ZERO): the period is over — advance ends it (after the try for a touchdown), as at 0:00 exactly
  whistleClock() {
    this.clockDone = this.playNo;
    if (!this.ot && this.clock < RULES.CLOCK_ZERO) this.clock = 0;
    const r = this.result;
    this.clockRun = false; this.playClockOn = false; this.playClock = RULES.PLAY_CLOCK_ADMIN;
    if (!r) return;
    const warn = !this.ot && this.clock > 0 && this.twoMin !== this.half() && this.snapHalf > RULES.TWO_MIN && this.halfLeft() <= RULES.TWO_MIN;
    // the offense keeps the ball, no score: 40 on the play clock from the whistle; in bounds the game clock runs on
    const spot = r.type === "incomplete" ? this.los : clamp(r.x, 0.5, 99.5);
    const first = r.type !== "incomplete" && spot - this.los >= this.toGo - 1e-6;
    const keeps = this.playType === "normal" && r.carrierSide === "O" && !(r.fumble && r.lost) && r.type !== "td" && r.type !== "safety" && (this.down < 4 || first);
    if (keeps) {
      this.playClock = RULES.PLAY_CLOCK; this.playClockOn = true;
      if (this.ot || this.clock <= 0) { /* overtime has no game clock; at 0:00 the period is over (advance) */ }
      else if (r.type === "oob") this.clockRun = this.oobStops() ? false : "set";
      else if (r.type !== "incomplete") this.clockRun = true;
    } else this.noHuddle.home = this.noHuddle.away = false; // a new possession (or a score, or a kick): no hurry-up carries over
    if (warn) this.twoMinuteWarning();
    // the CPU's timeouts while the clock runs (ai.cpuTimeout): the offense in its two-minute drill, a defense that
    // needs the ball back
    for (const k of [this.possession, this.defTeam]) if (this.clockRun && !this.isUserTeam(k) && AI.cpuTimeout(this, k)) this.callTimeout(k);
  }
  twoMinuteWarning() {
    this.twoMin = this.half();
    this.clockRun = false; // stopped until the snap, 25 on the play clock
    this.playClock = RULES.PLAY_CLOCK_ADMIN;
    this.bus.emit("twoMinute", { half: this.twoMin, q: this.quarter, clock: this.clock });
    if (this.pbp) PBP.note(this, "Two-minute warning"); // (franchise option playByPlay)
  }
  // the huddle breaks: the accelerated clock, and the CPU offense's tempo (when it will snap) → false: time ran out
  breakHuddle() {
    this.broke = this.playNo;
    this.tempo = null;
    if (this.playType === "kickoff" || this.playType === "pat") return true;
    const k = this.possession;
    if (this.accel > 0 && !this.noHuddleNow() && this.halfLeft() > RULES.TWO_MIN && this.playClock > this.accel && !this.runClocks(this.playClock - this.accel)) return false;
    if (this.phase !== "presnap") return true; // (a quarter ran out and the next one started: the play goes on)
    if (this.isUserTeam(k)) return true;
    const tempo = AI.cpuTempo(this), off = this.call.off;
    const kind = off && off.spike ? "spike" : tempo; // (a kneel too: snapped like any play, never held to :02)
    // when the CPU snaps, on the play clock: a hurry-up (a spike) so long after the whistle, a team running out the
    // clock at :02, one milking it for the last snap's field goal once the game clock is down to the kick's (ai.milkAt),
    // a normal huddle about :23 (its line-up after the break: cpuSet)
    // (Ragdoll Football: whatever the tempo, the CPU snaps as soon as it's set — it never sits on the play clock)
    const at = this.playClock - this.cpuSet(true);
    this.tempo = { kind, snapAt: Math.max(0, at) };
    return true;
  }
  // how long the CPU (or the autopilot) takes from the break to the snap in a real game: the line-up (quicker without a
  // huddle), a human defender's moment to switch players, a human returner's to call the lane. A sim: 0.6 s (real: the
  // clocks catch up at the snap, cpuReady)
  cpuSet(real = false) {
    if (this.headless && !real) return 0.6;
    const pt = this.playType, kick = pt === "kickoff" || pt === "punt", userD = this.isUserTeam(this.defTeam), scrim = pt === "normal" || pt === "two";
    const nh = this.noHuddleNow();
    return (nh ? TIMING.NO_HUDDLE_SET + 0.4 : TIMING.PRESNAP_CPU_SEC + TIMING.HUDDLE_SEC) + (pt === "kickoff" ? 0.6 : 0) + (kick && userD ? TIMING.RETURN_CALL_SEC : 0) + (userD && scrim ? (nh ? 1 : TIMING.DEF_SWITCH_SEC) : 0);
  }
  // the CPU snaps once its tempo's play clock comes up (a stopped game clock: as soon as it's set). A sim catches the
  // clocks up to it here → false: not yet, or time ran out before the snap
  cpuReady() {
    const tp = this.tempo;
    if (!tp || this.clockRun !== true || this.playClock <= tp.snapAt + 1e-9) return true;
    if (!this.headless) return false;
    return this.runClocks(this.playClock - tp.snapAt) && this.phase === "presnap";
  }
  // run the clocks between plays for sec seconds: the play clock (when on) and a running game clock. The two-minute
  // warning stops the game clock at 2:00; at 0:00 (under RULES.CLOCK_ZERO s: the clock reads 0:00) the period is over
  // before the snap → false when that took over the flow (halftime, the end of the game, overtime); a new quarter just
  // goes on (stopped clock, 25 on the play clock)
  runClocks(sec) {
    if (!(sec > 0)) return true;
    if (this.playClockOn) this.playClock = Math.max(0, this.playClock - sec);
    if (this.clockRun !== true || this.ot || this.clock <= 0) return true;
    // (≤ 0: the quarter ends first — none; a 1st or 3rd quarter of 2:00 puts the warning at its last 0:00, give or take a
    // rounding error: none either)
    const h = this.halfLeft(), warnAt = this.clock - (h - RULES.TWO_MIN);
    if (this.twoMin !== this.half() && h > RULES.TWO_MIN && h - sec <= RULES.TWO_MIN && warnAt > 1e-6) { this.clock = warnAt; this.twoMinuteWarning(); return true; }
    this.clock = Math.max(0, this.clock - sec);
    if (this.clock > 0 && this.clock >= RULES.CLOCK_ZERO) return true;
    this.clock = 0; this.clockRun = false;
    return !this.checkClockEnd();
  }
  // the human offense's hurry-up (the play call's NO HUDDLE): no accelerated clock, a quick line-up. It lasts the drive.
  setNoHuddle(on) {
    const k = this.user;
    if (!k || this.autopilot || this.possession !== k) return false;
    this.noHuddle[k] = Boolean(on);
    this.bus.emit("noHuddle", { team: k, on: this.noHuddle[k] });
    return true;
  }
  // the human's time to call the play, snap it or kick it before the coach does it for him (hud.js): the play clock —
  // facing a hurry-up offense, a human defense gets HURRY_CALL_SEC to call. null: no clock on him now
  callLeft() {
    if (!this.waitUser || !this.playClockOn || this.playType === "kickoff" || this.playType === "pat") return null;
    if (this.phase === "playcall" && this.waitUser === "call") return this.userSide() === "D" && this.noHuddle[this.possession] ? Math.min(this.playClock, TIMING.HURRY_CALL_SEC - this.phaseT) : this.playClock;
    if (this.phase === "presnap" && (this.waitUser === "snap" || this.waitUser === "kick")) return this.playClock;
    return null;
  }
  // a spike makes sense: the game clock is running (or will once the ball is set), a down to give, regulation
  canSpike() { return this.clockRunning() && this.playType === "normal" && this.down < 4; }
  // the clock plays (playbook.js CLOCK_PLAYS) once the QB has the snap: the spike — into the ground at his feet, an
  // incomplete pass (the clock stops, the down is gone) — and the kneel — he goes down behind the line, the clock runs on
  clockPlay(play, t) {
    const qb = this.qb, b = this.ball;
    if (!qb || b.state !== "held" || b.carrier !== qb) return;
    if (play.spike && t >= TIMING.SPIKE_T) {
      qb.hasBall = false; qb.anim = "throw"; qb.animT = 0;
      b.state = "dead"; b.carrier = null; b.kind = ""; b.x = qb.x + 0.8; b.y = qb.y; b.z = 0; b.vx = b.vy = b.vz = 0;
      this.passThrown = true; this.thrownAway = true;
      this.bus.emit("throw", { qb, target: null, ball: b, away: true, spike: true });
      this.endPlay({ type: "incomplete", x: this.los, carrierSide: "O", stop: true, spike: true });
    } else if (play.kneel) {
      if (t >= TIMING.KNEEL_T * 0.4 && !qb.move) P.startMove(this, qb, "slide", 0, 0);
      if (t >= TIMING.KNEEL_T) this.endPlay({ type: "tackle", x: Math.max(this.los - 1, Math.min(this.los, 1)), carrierSide: "O", stop: false, kneelDown: true }); // a yard lost (never into his end zone)
    }
  }

  // ---------- live ----------
  update(dt) {
    // a timeout's wait runs out (tickTimeout); meanwhile the play call's and the line-up's own time stands still (phaseT:
    // a human defense's time to call against a hurry-up, the CPU's line-up before its snap) for when it's over
    const held = this.timeoutLeft > 0 && this.tickTimeout(dt);
    if (!held || (this.phase !== "playcall" && this.phase !== "presnap")) this.phaseT += dt;
    if ((this.phase === "dead" || this.phase === "playcall" || this.phase === "presnap") && !this.tickClock(dt)) return; // time ran out
    switch (this.phase) {
      case "presnap": return this.updatePresnap(dt);
      case "live": return this.updateLive(dt);
      case "dead": return this.updateDead(dt);
      case "playcall": return this.updatePlaycall(dt);
      case "coin": return this.updateCoin(dt);
      case "pat": if (!this.isUserTeam(this.patTeam) && this.phaseT > (this.headless ? 0 : 0.8)) this.choosePAT(AI.patChoice(this, this.patTeam)); return;
      case "halftime": if (this.headless || this.autopilot) { if (this.phaseT > (this.headless ? 0 : 3)) this.continueHalftime(); } return;
      default: return;
    }
  }
  updatePlaycall(dt) {
    // autopilot / headless user-side calls
    if (this.waitUser === "call" && this.autopilot && this.phaseT > (this.headless ? 0 : 1.2)) {
      if (!this.call.off) this.call.off = this.cpuOffense();
      if (!this.call.def) this.call.def = AI.cpuDefCall(this);
      if (this.down === 4 && this.user === this.possession && this.playType === "normal") {
        const ch = AI.fourthDownChoice(this);
        if (ch === "punt") { this.setupPunt(); return; }
        if (ch === "fg") { this.setupFG(false); return; }
      }
      this.setupPlay();
    }
    if (!this.waitUser && this.call.off && this.call.def) this.setupPlay();
    // idle formation: huddles stand
  }
  updatePresnap(dt) {
    // jog into position (no huddle: a quick set; a defensive audible: the defense shifts to its new spots, quickly)
    const jog = this.phaseT < (this.noHuddleNow() ? TIMING.NO_HUDDLE_SET : TIMING.HUDDLE_SEC + 0.4);
    const shift = this.realignT != null && this.phaseT - this.realignT < 1.5;
    // a human on defense moves his defender before the snap once the huddle has broken (the stick or the movement
    // keys): he stays where he's left (snap keeps him there), kept on his own side and in bounds
    const roam = !this.autopilot && this.userSide() === "D" && (this.playType === "normal" || this.playType === "two") && this.control && this.input && !jog;
    for (const p of this.players) {
      if (this.playType === "normal" || this.playType === "two") {
        if (roam && p === this.control) {
          const inp = this.input, active = Math.hypot(inp.mx, inp.my) > 0.15;
          if (active) {
            const dirU = this.screenDir();
            p.mx = inp.my * dirU; p.my = -inp.mx * dirU;
            p.want = Math.min(1, Math.hypot(inp.mx, inp.my)); p.sprint = Boolean(inp.sprint);
            p.ai.userShifted = true;
          } else { p.want = 0; p.sprint = false; }
        } else if (p.ai.userShifted) { p.want = 0; p.sprint = false; }
        else if (jog || (shift && p.side === "D")) { AI.steer(p, p.sx, p.sy, shift && p.side === "D" ? 1 : 0.75); } else { p.want = 0; p.x += (p.sx - p.x) * 0.2; p.y += (p.sy - p.y) * 0.2; }
      } else p.want = 0;
    }
    P.movePlayers(this, dt);
    if (roam) for (const p of this.def) if (p.ai.userShifted) {
      p.x = clamp(p.x, this.los + 0.7, Math.min(109, this.los + 18));
      p.y = clamp(p.y, 1, FIELD_W - 1);
    }
    if (this.waitUser === "snap" || this.waitUser === "kick") {
      if (this.autopilot && this.phaseT > this.cpuSet() && this.cpuReady()) { if (this.waitUser === "kick" && !this.kickInput) this.kickInput = AI.cpuKick(this, this.kicker, this.playType); this.snap(); }
      else if (this.waitUser === "kick" && this.kickInput && this.phaseT > 0.3) this.snap();
      else if (this.waitUser === "snap" && this.call.off && this.call.off.spike && this.phaseT > TIMING.NO_HUDDLE_SET) this.snap(); // the human's SPIKE goes at once
      return;
    }
    // the CPU snaps once it's set (cpuSet: a human on defense gets a moment to switch defenders, a human returner to
    // call the lane) and its tempo says so (cpuReady: the play clock it snaps on)
    // (PRO to LEGEND: the CPU checks at the line once everyone's set — ai.hardPresnap)
    if (this.hard && this.phaseT > (this.headless ? 0.3 : TIMING.HUDDLE_SEC + 0.45) && (this.playType === "normal" || this.playType === "two")) AI.hardPresnap(this);
    if (this.phaseT > this.cpuSet() && this.cpuReady()) this.snap();
  }
  // Assist: the AI plays the user's man until the user touches the controls this play (not the QB with a pass to throw).
  userDrives(p) {
    if (!this.input) return false;
    // a run's handoff (or the flea flicker's) is scripted: the stick can't drag the QB away from the mesh. The read
    // option's keep is decided by SPRINT at the mesh (scriptedActions reads input.sprint directly), not by moving.
    const off = this.call.off;
    if (p === this.qb && off && !this.handedOff && ((off.type === "run" && off.carrier !== "QB") || (off.flea && this.flickT == null))) return false;
    const active = this.playUserInput;
    // (your QB with a pass to throw is always yours: he holds the ball until you throw it, throw it away, run or get sacked,
    // never thrown for you)
    if (p === this.qb && p.side === "O" && p.hasBall && this.playType !== "kickoff" && !this.passThrown && !this.handedOff && this.call.off && this.call.off.type === "pass" && !this.losCrossed) return true;
    if (this.returnKneel && p === this.returner) return false;
    if (p.hasBall) {
      if (p === this.carrierDesignate && !this.handedOff) return false;
      return active;
    }
    if ((this.playType === "fg" || this.playType === "pat") && p.side === "O") return false;
    if (p === this.carrierDesignate && !this.handedOff) return false;
    if ((this.playType === "kickoff" || this.playType === "punt") && p === this.returner && !p.hasBall) return false;
    return this.inputIdle < 0.6;
  }
  updateLive(dt) {
    this.t += dt;
    if (this.inputIdle < 0.05 && this.t > 0.05) this.playUserInput = true;
    // a kickoff starts the clock when the ball is touched in the field of play (caught, muffed, picked up; a returner
    // who caught it in his end zone: when he brings it out), so a touchback takes no time
    if (this.playType === "kickoff" && !this.kickTouch) { const b = this.ball, c = b.carrier; this.kickTouch = (b.state === "held" && b.kind === "" && c && c.x < 100) || (b.kind === "muff" && b.x < 100); }
    if (!this.ot && this.playType !== "pat" && this.playType !== "two" && (this.playType !== "kickoff" || this.kickTouch)) this.clock = Math.max(0, this.clock - dt * RULES.CLOCK_SCALE);
    this.scriptedActions(dt);
    AI.think(this, dt);
    if (this.control && this.input && !this.autopilot) this.applyUserInput(dt);
    if (this.seats) this.seatsInput(dt); // two humans (online, seats.js): the other seat's player too
    P.movePlayers(this, dt);
    P.blocking(this, dt);
    P.separate(this);
    if (this.fatigue) SQ.effort(this, dt);
    P.ballStep(this, dt);
    if (this.phase !== "live") return;
    P.tackles(this, dt);
    P.dominoes(this);
    if (this.phase !== "live") return;
    this.checkRules();
    if (this.t > RULES.MAX_PLAY_SEC && this.phase === "live") {
      this.errors.push(`play ${this.playNo} exceeded ${RULES.MAX_PLAY_SEC}s (${this.playType}, ball ${this.ball.state}/${this.ball.kind})`);
      this.stuck++;
      const c = this.ball.carrier;
      this.endPlay({ type: c ? "tackle" : "incomplete", x: c ? c.x : this.los, carrierSide: c ? c.side : "O", stop: true });
    }
  }

  // automatic actions: handoffs, pitches, kicks
  scriptedActions(dt) {
    const b = this.ball, t = this.t;
    if (this.playType === "kickoff" || this.playType === "punt") {
      // a returner who took a knee in his end zone: touchback
      if (this.returnKneel && b.carrier && b.carrier === this.returner) {
        this.kneelT += dt;
        if (this.kneelT > TIMING.KNEEL_SEC) { this.endPlay({ type: "touchback", carrierSide: "D", x: 100, stop: true, kneel: true }); return; }
      }
    }
    if (this.playType === "kickoff") {
      if (!this.kicked) {
        const k = this.kicker;
        if (k.distTo(this.los, this.ballY) < 0.7 || t > 1.4) this.launchKick("kickoff");
      }
      return;
    }
    // a fake punt or field goal: the snap in the hands of the man it went to, the play is his (fakeGo)
    if (this.fake && !this.fake.on) { if (b.state === "held" && b.carrier === this.fake.to) this.fakeGo(); return; }
    // a punter backed up to the end line (14 yards deep normally) takes a shorter drop: the snap-to-kick time shrinks with it
    if (this.playType === "punt" && !this.kicked && b.state === "held" && b.carrier === this.kicker && t > TIMING.PUNT_OP_SEC - Math.max(0, 14 - (this.los - this.kicker.sx)) * 0.12) { this.launchKick("punt"); return; }
    if ((this.playType === "fg" || this.playType === "pat") && !this.kicked && t > TIMING.FG_OP_SEC && (b.state === "held" || b.state === "air")) { this.launchKick(this.playType); return; }
    if (this.playType !== "normal" && this.playType !== "two") return;
    const play = this.call.off;
    if (play.clock) { this.clockPlay(play, t); return; } // a spike or a kneel
    const qb = this.qb, car = this.carrierDesignate;
    // flea flicker: handoff → the back runs at the line → pitch back to the QB
    if (play.flea) {
      if (!this.handedOff && b.state === "held" && b.carrier === qb && this.flickT == null && car) {
        AI.steer(qb, car.x, car.y, 0.8);
        if (qb.distTo(car.x, car.y) < 1.25 && t > 0.3) {
          qb.hasBall = false; car.hasBall = true; b.carrier = car; b.kind = "";
          this.handedOff = true; this.handoffT = t;
          this.bus.emit("handoff", { player: car, flea: true });
        }
      } else if (this.handedOff && b.state === "held" && b.carrier === car && this.flickT == null && (car.x > this.los - 2.4 || t > this.handoffT + 0.8)) {
        b.state = "air"; b.kind = "pitch"; b.target = qb; car.hasBall = false; b.carrier = null;
        P.launch(b, car.x, car.y, 1.1, qb.x + qb.vx * 0.45, qb.y + qb.vy * 0.45, 1.3, 0.45);
        this.bus.emit("pitch", { player: car, to: qb, flea: true });
      }
      if (b.carrier === qb && qb && qb.x > this.los + 0.3) this.losCrossed = true;
      return;
    }
    if (play.type !== "run" || this.handedOff || b.state !== "held" || b.carrier !== qb) {
      if (b.carrier === qb && qb && qb.x > this.los + 0.3) this.losCrossed = true;
      return;
    }
    // designed QB runs (sneak, QB power): the QB keeps it and follows the path set at the snap; his draw once its
    // pass set has sold it (play.delay)
    if (play.carrier === "QB") { if (!play.delay || t >= play.delay) { this.handedOff = true; this.handoffT = t; this.carrierDesignate = qb; } return; }
    if (play.toss) {
      // (the jet sweep: the pitch once the man crossing in front of the QB is close)
      if (t > 0.28 && (!play.jet || qb.distTo(car.x, car.y) < 4.5)) {
        // lead the back along his path: where he will be when the pitch gets there
        const T = play.jet ? 0.3 : 0.42; // (the jet's: a shovel to a man going full speed)
        const wp = car.ai.path && car.ai.path.length ? car.ai.path[Math.min(car.ai.wp, car.ai.path.length - 1)] : [car.x, car.y];
        const dx = wp[0] - car.x, dy = wp[1] - car.y, d = Math.hypot(dx, dy) || 1;
        const sp = Math.hypot(car.vx, car.vy);
        const travel = Math.min(d + 1.5, sp * T + 0.5 * car.r.accel * T * T * 0.7);
        b.state = "air"; b.kind = "pitch"; b.target = car; qb.hasBall = false; b.carrier = null;
        P.launch(b, qb.x, qb.y, 1.2, car.x + (dx / d) * travel, car.y + (dy / d) * travel, 1.1, T);
        this.handedOff = true; this.handoffT = t;
        this.bus.emit("pitch", { player: qb, to: car });
      }
      return;
    }
    // QB meets the back at the mesh point. He aims where the back WILL be (≈0.35 s ahead on his current run), not
    // where he is: on a stretch/counter the path carries the back away, and chasing his current spot meant a handoff
    // 2–3 s late or never. Fallback: a back within reach after the mesh window gets the ball anyway.
    const delay = play.delay || 0;
    if (t < delay) { AI.steer(qb, qb.sx - 2.2, qb.sy, 0.6); return; }
    const LEAD = 0.35, path = car.ai.path;
    if (path && car.ai.wp === 0 && path.length > 1) AI.steer(qb, (path[0][0] + car.x + car.vx * LEAD) / 2, (path[0][1] + car.y + car.vy * LEAD) / 2, 1); // head for the mesh point
    else AI.steer(qb, car.x + car.vx * LEAD, car.y + car.vy * LEAD, 1);
    const meshD = qb.distTo(car.x, car.y);
    if (((meshD < 1.25 && t > 0.3) || (meshD < 2.5 && t > delay + 0.8)) && (!play.rpo || t >= AI.RPO_RIDE)) {
      // the RPO: the QB hands it off or pulls it and throws the quick route at once — a human decides (hold SPRINT at
      // the mesh to throw it, as he keeps a read option), the CPU reads the man covering it (ai.rpoRead)
      if (play.rpo) {
        const rec = this.bySlot(this.off, play.rpo);
        const pull = rec && (this.isUserTeam(this.possession) && this.input ? Boolean(this.input.sprint) : AI.rpoRead(this, qb, rec));
        if (pull) {
          this.rpoThrow = true;
          P.throwTo(this, qb, rec, false, 0);
          return;
        }
      }
      if (play.option) {
        // the read: a human decides (hold SPRINT at the mesh to keep); the CPU reads the unblocked edge —
        // crashing down on the back → the QB pulls it and takes the edge he vacated
        let keep;
        if (this.isUserTeam(this.possession) && this.input) keep = Boolean(this.input.sprint);
        else {
          const rd = this.readDef;
          let crash = false;
          if (rd && rd.canAct) crash = Math.hypot(rd.x - car.x, rd.y - car.y) < 3.6;
          else for (const d of this.def) if ((d.slot === "DE1" || d.slot === "DE2") && Math.hypot(d.x - car.x, d.y - car.y) < 3.2) crash = true;
          // (a QB who's no runner gives it every time: ai.qbRunOk)
          keep = (crash ? this.rng.chance(0.85) : this.rng.chance(0.1)) && AI.qbRunOk(this);
        }
        if (keep) {
          this.handedOff = true; this.handoffT = t; this.carrierDesignate = qb;
          const side = Math.sign(car.y - qb.y) || parOf(this);
          qb.ai.path = [[this.los - 1, qb.y - side * 5], [this.los + 4, qb.y - side * 7]]; qb.ai.wp = 0;
          if (this.control === car && !this.autopilot) this.control = qb;
          this.bus.emit("handoff", { player: qb, keep: true });
          return;
        }
      }
      qb.hasBall = false; car.hasBall = true; b.carrier = car; b.kind = "";
      this.handedOff = true; this.handoffT = t;
      this.bus.emit("handoff", { player: car });
    }
  }

  // ball physics lives in physics.js (launchKick, kickFlight, ballGrounded, looseBall, resolveCatch)
  launchKick(kind) { P.launchKick(this, kind); }
  kickFlight(dt) { P.kickFlight(this, dt); }
  ballGrounded() { P.ballGrounded(this); }
  looseBall(dt) { P.looseBall(this, dt); }
  resolveCatch() { P.resolveCatch(this); }
  // franchise hooks from physics.js (only with a franchise option on): the hits (injury rolls, fatigue), fumbles
  tackleHit(c, d, power, hit, gang) { SQ.tackleHit(this, c, d, power, hit, gang); }
  truckHit(d, c) { SQ.truckHit(this, d, c); }
  fumbled(p, by) { if (this.fumbleX == null && p.side === "O") this.fumbleX = p.x; if (this.statsBy) PS.fumbled(this, p, by); }

  checkRules() {
    const b = this.ball, c = b.carrier;
    if (b.state === "held" && c && b.kind === "") {
      if (c.side === "O" && c.x > this.los + 0.5) this.losCrossed = true;
      // out of bounds over a sideline or an end line: in an end zone that's a touchdown (the opponent's) or a safety
      // (your own); a returner / interceptor in his own end zone: a touchback or a safety (ownEndZone)
      if (c.side === "D") this.trackReturn(c);
      if (c.y < 0 || c.y > FIELD_W || c.x < -10 || c.x > 110) {
        this.bus.emit("outOfBounds", { player: c });
        if (c.side === "D" && c.x >= 100) { this.ownEndZone(c, c.x, "oob"); return; }
        const type = c.side === "O" ? (c.x >= 100 ? "td" : c.x <= 0 ? "safety" : "oob") : c.x <= 0 ? "td" : "oob";
        this.endPlay({ type, x: c.x, carrierSide: c.side, stop: true });
        return;
      }
      if (c.side === "O" && c.x >= 100 && this.playType !== "kickoff" && this.playType !== "punt") { this.endPlay({ type: "td", x: 100, carrierSide: "O", stop: true }); return; }
      if (c.side === "D" && c.x <= 0) { this.endPlay({ type: "td", x: 0, carrierSide: "D", stop: true }); return; }
      // QB slide / carrier dive completes
      if (c.move === "slide" && c.moveT > 0.4) { this.tackled(c, null); return; }
      if (c.move === "dive" && c.hasBall && c.z <= 0 && c.moveT > 0.2) { this.tackled(c, null); return; }
    }
    if ((this.playType === "kickoff" || this.playType === "punt") && b.state === "air" && (b.y < -2 || b.y > FIELD_W + 2) && b.z < 1) {
      this.endPlay({ type: this.playType === "punt" ? "puntOob" : "kickOob", x: b.x, carrierSide: "D", stop: true });
    }
  }
  tackled(c, d) {
    let x = c.x;
    if (c.side === "O" && c.vx > 0.5) x += 0.4;
    // short yardage: the line surges and the pile falls forward
    if (c.side === "O" && c.vx > -0.5 && this.call.off && this.call.off.surge && c.x < this.los + 3) x += 0.7;
    if (c.side === "D" && c.vx < -0.5) x -= 0.4;
    if (c.side === "O" && x <= 0) { this.endPlay({ type: "safety", x, carrierSide: "O", stop: true, tackler: d }); return; }
    if (c.side === "D" && x >= 100) { this.ownEndZone(c, x, "tackle", { tackler: d }); return; }
    if (c.side === "O" && x >= 100 && this.playType !== "punt" && this.playType !== "kickoff") { this.endPlay({ type: "td", x: 100, carrierSide: "O", stop: true }); return; }
    if (c.side === "D" && x <= 0) { this.endPlay({ type: "td", x: 0, carrierSide: "D", stop: true }); return; } // a return's forward progress
    this.endPlay({ type: "tackle", x, carrierSide: c.side, stop: false, tackler: d });
  }

  // A returner / interceptor (the D side) downed in his own end zone: where his possession began decides it. Began in the
  // end zone and never brought out → touchback. Began in the field of play (or brought out and back in) → safety (2
  // points to the team that kicked or threw; his team free-kicks), unless his momentum carried him in from inside the 5:
  // then it's his ball where he gained it.
  ownEndZone(c, x, type, extra = {}) {
    this.trackReturn(c);
    if (this.inEndZoneSince()) this.endPlay({ type: "touchback", x: 100, carrierSide: "D", stop: true, ...extra });
    else if (this.retMom) this.endPlay({ type, x: this.retStart, carrierSide: "D", stop: true, momentum: true, ...extra });
    else this.endPlay({ type: "safety", x, carrierSide: "D", stop: true, ...extra });
  }
  // kept up every tick he has the ball (checkRules): the momentum exception (possession gained inside his 5 while moving
  // toward his own goal line; stopping or stepping up before he gets there, or coming back out, ends it) and whether he
  // has had it in the field of play
  trackReturn(c) {
    if (this.retMom == null) this.retMom = this.retStart != null && this.retStart >= 95 && this.retStart < 100 && c.vx > 0.2;
    else if (this.retMom && c.x < 100 && c.vx <= 0) this.retMom = false;
    if (c.x < 100) this.retOut = true;
  }
  // his possession began in his end zone and he hasn't brought it out: downed there (a KNEEL) it's a touchback
  inEndZoneSince() { return this.retStart == null || (this.retStart >= 100 && !this.retOut); }

  // ---------- whistle ----------
  endPlay(res) {
    if (this.phase !== "live") return;
    const b = this.ball;
    res.carrier = b.carrier;
    res.playType = this.playType;
    if (this.blockedKick) res.blocked = true;
    this.result = res;
    this.playDurations.push(this.t);
    this.maxPlayT = Math.max(this.maxPlayT, this.t);
    this.setPhase("dead");
    if (this.hard) AI.scoutPlay(this, res); // PRO to LEGEND: the CPU learns what the human did (ai.js)
    this.recordStats(res);
    if (this.statsBy) PS.credit(this, res);
    for (const p of this.players) { p.want = 0; if (p.engaged) P.release(p, p.engaged); }
    this.bus.emit("whistle", { result: res });
    // points go on the board at the whistle (banners/celebrations now; the flow continues in advance())
    const ok = this.possession, dk = this.defTeam, pt = this.playType;
    if (pt === "fg" && (res.type === "fg" || res.blocked)) {
      this.stats[ok].fgAtt++;
      if (res.good) { this.stats[ok].fgMade++; this.addScore(ok, 3, "fg"); }
      this.bus.emit("fieldGoal", { good: Boolean(res.good), distance: this.fgDist, team: ok, blocked: Boolean(res.blocked), doink: Boolean(res.doink), short: Boolean(res.short) });
    }
    if (res.type === "td" && pt !== "two" && pt !== "pat") {
      const team = res.carrierSide === "O" ? ok : dk;
      this.addScore(team, 6, "td"); this.stats[team].tds++;
      this.bus.emit("touchdown", { team, scorer: res.carrier, defensive: res.carrierSide === "D", blocked: Boolean(res.blocked) });
    } else if (pt === "two") {
      const good = res.type === "td" && res.carrierSide === "O";
      if (good) this.addScore(ok, 2, "two");
      else if (res.type === "td" && res.carrierSide === "D") this.addScore(dk, 2, "def2"); // returned for two the other way
      this.bus.emit("twoPoint", { good, team: ok, defensive: res.type === "td" && res.carrierSide === "D" });
    } else if (pt === "pat") {
      this.stats[ok].patAtt++; // the box score's XP column (ui.js boxTeam)
      if (res.good) { this.stats[ok].patMade++; this.addScore(ok, 1, "pat"); }
      if (res.type === "td" && res.carrierSide === "D") this.addScore(dk, 2, "def2"); // blocked PAT returned all the way
      this.bus.emit("patResult", { good: Boolean(res.good), team: ok, blocked: Boolean(res.blocked), doink: Boolean(res.doink), defensive: res.type === "td" && res.carrierSide === "D" });
    }
    if (res.type === "safety" && pt !== "pat" && pt !== "two") {
      const team = res.carrierSide === "D" ? ok : dk; // a returner / interceptor downed in his own end zone: the kicking / passing team scores
      this.addScore(team, 2, "safety");
      this.bus.emit("safety", { team });
    }
    if (this.squad) { SQ.afterPlay(this); if (this.pbp) PBP.play(this, res); } // fatigue, the play-by-play line
  }
  recordStats(res) {
    const ok = this.possession, dk = this.defTeam;
    const S = this.stats[ok];
    const play = this.call.off;
    const c = res.carrier;
    if (this.playType === "two") { this.recordTwo(res); return; }
    if (this.playType === "normal") {
      const gained = Math.round((res.type === "td" && res.carrierSide === "O" ? 100 : res.x) - this.los);
      S.plays++;
      if (this.playType === "normal" && this.down === 3 && res.carrierSide === "O" && res.type !== "incomplete" && (gained >= this.toGo || res.type === "td")) S.thirdConv++;
      if (play && play.type === "pass" && !this.passThrown && c && c === this.qb && res.carrierSide === "O" && gained < 0 && !this.losCrossed && (res.type === "tackle" || res.type === "safety" || res.type === "oob")) {
        S.sacks++; S.sackYds += -gained;
        // (shared with a second man on the QB: half a sack each — playerstats.halfPartner)
        const t = res.tackler, h = PS.halfPartner(this, c, t);
        if (h) { this.ps(dk, t.slot).hsk++; this.ps(dk, h.slot).hsk++; } else if (t) this.ps(dk, t.slot).sck++;
        this.bus.emit("sack", { qb: c, tackler: t });
        res.sack = true;
        return;
      }
      if (this.passThrown) {
        const QS = this.qb ? this.qb.slot : "QB"; // (the passer: the QB, or a fake's punter or holder)
        S.passAtt++; this.ps(ok, QS).pa++;
        // by what happened to the pass, not by who has the ball at the whistle: a catch fumbled away is still a catch
        // (and no interception), a pick fumbled back is still a pick
        const rec = this.catchSpot != null ? this.ball.target : null;
        if (rec && rec !== this.qb) {
          S.passCmp++; S.passYds += gained; S.totalYds += gained;
          const q = this.ps(ok, QS); q.pc++; q.py += gained;
          const r = this.ps(ok, rec.slot); r.rec++; r.recy += gained;
          if (res.type === "td" && res.carrierSide === "O") { S.passTD++; q.ptd++; r.rectd++; }
        }
        if (this.intSpot != null) { S.ints++; this.ps(ok, QS).pint++; if (c && c.side === "D") this.ps(dk, c.slot).int++; }
      } else if (c && res.carrierSide === "O") {
        S.rushAtt++; S.rushYds += gained; S.totalYds += gained;
        const r = this.ps(ok, c.slot); r.ra++; r.ry += gained;
        if (res.type === "td") { S.rushTD++; r.rtd++; }
      }
      if (res.tackler && res.carrierSide === "O") {
        const T = this.ps(dk, res.tackler.slot); T.tkl++;
        if (gained < 0 && !(play && play.clock)) T.tfl++; // a tackle for a loss (not a sack: that's above; not a kneel)
      }
      if (res.fumble && res.lost) this.stats[res.carrierSide === "O" ? dk : ok].fumLost++; // the side that lost it
    }
    if ((this.playType === "kickoff" || this.playType === "punt") && c && c.side === "D" && this.retStart != null && !this.blockReturn) {
      const R = this.stats[dk];
      const yds = Math.round(this.retStart - (res.type === "td" ? 0 : res.x));
      R.rets++; R.retYds += yds;
      const r = this.ps(dk, c.slot); r.ret++; r.rety += yds;
      res.retYds = yds;
    }
    if ((this.playType === "kickoff" || this.playType === "punt") && res.fumble && res.lost && res.carrierSide === "O") this.stats[dk].fumLost++; // a return fumbled away
  }
  // A two-point try isn't a play from scrimmage in the stats, as in the NFL: no attempts, yards, touchdowns, sacks,
  // picks or tackles. Only the try itself is counted (twoAtt/twoMade) and who converted it (two: the passer and the
  // receiver, or the runner). A sack still gets its banner.
  recordTwo(res) {
    const ok = this.possession, S = this.stats[ok], c = res.carrier, play = this.call.off;
    S.twoAtt++;
    if (play && play.type === "pass" && !this.passThrown && c && c.slot === "QB" && res.carrierSide === "O" && !this.losCrossed && res.type !== "td" && Math.round(res.x - this.los) < 0 && (res.type === "tackle" || res.type === "safety" || res.type === "oob")) {
      this.bus.emit("sack", { qb: c, tackler: res.tackler });
      res.sack = true;
      return;
    }
    if (res.type !== "td" || res.carrierSide !== "O") return;
    S.twoMade++;
    const rec = this.passThrown && this.catchSpot != null ? this.ball.target : null;
    if (rec && rec !== this.qb) { this.ps(ok, "QB").two++; this.ps(ok, rec.slot).two++; } else if (c) this.ps(ok, c.slot).two++;
  }
  updateDead(dt) {
    const wait = this.headless ? 0.05 : this.holdForReplay ? 1e9 : TIMING.DEAD_SEC;
    if (this.phaseT < wait) {
      // players ease to a stop; scorer celebrates
      P.movePlayers(this, dt);
      P.ballStep(this, dt);
      return;
    }
    if (this.headless && !this.runClocks(TIMING.DEAD_SEC - this.phaseT)) return; // a sim's dead ball lasts as long as a real one (the clocks)
    this.advance();
  }

  // apply the result and pick the next phase
  advance() {
    if (this.handoff) this.applyHandoff(); // watch and jump in: control changes hands at the dead ball
    if (this.coachQ) CO.runQueue(this); // the coach's substitutions waiting for the dead ball (coach.js)
    const r = this.result;
    if (!r) return this.beginPlayCall();
    const ok = this.possession, dk = this.defTeam;
    // the ball changes hands at spotX (offense coords of the team that had it). Possession bookkeeping for overtime
    // happens at each place a team's offensive possession ends (possEnded) — never on a kickoff.
    const turnoverTo = (spotX, touchback = 20) => {
      this.possession = dk;
      this.los = spotX >= 100 ? touchback : clamp(100 - spotX, 1, 99);
      this.ballY = this.spotY();
      this.down = 1; this.toGo = Math.min(10, 100 - this.los);
      this.bus.emit("possession", { team: this.possession });
    };
    const pt = this.playType;
    // ---- scoring plays ----
    if (r.type === "td" && pt !== "two" && pt !== "pat") {
      const team = r.carrierSide === "O" ? ok : dk;
      // an offensive possession ends with any touchdown except the kicking team's own return of a kickoff
      if (pt !== "kickoff") this.possEnded(ok);
      if (this.ot) { this.gameOver(); return; } // overtime: a touchdown ends it
      this.patTeam = team;
      this.possession = team;
      this.setPhase("pat");
      this.waitUser = this.isUserTeam(team) ? "pat" : null;
      this.bus.emit("patChoice", { team });
      return;
    }
    if (pt === "pat" || pt === "two") {
      if (this.checkOT() || this.checkClockEnd(true)) return;
      this.setupKickoff(ok, RULES.KICKOFF_SPOT);
      return;
    }
    if (r.type === "safety") {
      this.possEnded(ok);
      if (this.ot) { this.gameOver(); return; } // overtime: a safety ends it
      if (this.checkClockEnd(true)) return;
      this.setupKickoff(r.carrierSide === "D" ? dk : ok, 20); // free kick from the 20 by the team that gave up the safety
      return;
    }
    if (pt === "fg") {
      this.possEnded(ok);
      if (r.good) {
        if (this.checkOT() || this.checkClockEnd(true)) return;
        this.setupKickoff(ok, RULES.KICKOFF_SPOT);
      } else {
        // missed: the spot of the kick (or the 20, whichever is better for the defense); blocked: where it ended
        if (r.blocked) turnoverTo(clamp(r.x, 1, 99));
        else turnoverTo(Math.min(this.los - 7, 80));
        if (this.checkOT() || this.checkClockEnd()) return;
        this.beginPlayCall();
      }
      return;
    }
    // ---- kicks ----
    if (pt === "kickoff" || pt === "punt") {
      const lost = r.type === "recovery" && r.carrierSide === "O"; // the returner fumbled and the kicking team fell on it
      if (r.type === "onsideRecovered" || r.type === "muffRecovered" || lost) {
        if (pt === "punt") this.possEnded(ok); // the punting team gets the ball back: a new possession
        this.los = clamp(r.x, 1, 99); this.down = 1; this.toGo = Math.min(10, 100 - this.los); this.ballY = this.spotY();
        this.bus.emit("turnover", { kind: r.type === "onsideRecovered" ? "onside" : lost ? "fumble" : "muff" });
        if (this.checkOT() || this.checkClockEnd()) return;
        this.beginPlayCall();
        return;
      }
      if (pt === "punt") this.possEnded(ok);
      const tb = pt === "kickoff" ? RULES.TOUCHBACK_KO : RULES.TOUCHBACK_PUNT;
      if (r.type === "touchback") this.bus.emit("touchback", { kneel: Boolean(r.kneel) });
      if (r.type === "kickOob") { turnoverTo(Math.min(this.los + 30, 99) === this.los + 30 ? this.los + 30 : 60); }
      else turnoverTo(r.type === "touchback" ? 100 : r.x, tb);
      if (this.checkOT() || this.checkClockEnd()) return;
      this.beginPlayCall();
      return;
    }
    // ---- regular downs ----
    if (r.carrierSide === "D") {
      // interception / fumble return
      this.possEnded(ok);
      turnoverTo(r.x, 20);
      if (this.checkOT() || this.checkClockEnd()) return;
      this.beginPlayCall();
      return;
    }
    const spot = clamp(r.x, 0.5, 99.5);
    const gained = spot - this.los;
    const needed = this.toGo;
    this.ballY = this.spotY(r.carrier ? r.carrier.y : this.ballY);
    if (r.fumble && r.lost) {
      // the defense took it away and fumbled it back: that drive is over, a new series starts where it was recovered
      this.possEnded(ok);
      this.los = spot; this.down = 1; this.toGo = Math.min(10, 100 - spot);
      if (this.checkOT()) return;
    } else if (gained >= needed - 1e-6) {
      this.los = spot; this.down = 1; this.toGo = Math.min(10, 100 - spot);
      this.stats[ok].firstDowns++;
      this.bus.emit("firstDown", { team: ok });
    } else {
      this.los = r.type === "incomplete" ? this.los : spot;
      this.toGo = needed - (r.type === "incomplete" ? 0 : gained);
      this.down++;
      if (this.down > 4) {
        this.bus.emit("turnover", { kind: "downs" });
        this.possEnded(ok);
        turnoverTo(this.los);
        if (this.checkOT() || this.checkClockEnd()) return;
        this.beginPlayCall();
        return;
      }
    }
    if (this.checkClockEnd()) return;
    this.beginPlayCall();
  }
  spotY(y = this.ballY) { return clamp(y, HASH_L, HASH_R); }
  addScore(team, pts, kind) {
    this.score[team] += pts;
    this.bus.emit("scoreChange", { team, pts, kind, score: { ...this.score } });
  }
  choosePAT(kind) {
    if (this.phase !== "pat") return;
    this.possession = this.patTeam;
    if (this.squad) SQ.deadBall(this, this.possession, false);
    if (kind === "two") {
      this.playType = "two";
      this.los = RULES.TWO_PT_SPOT; this.ballY = MID_Y; this.down = 1; this.toGo = 2;
      this.twoPointCall();
      this.bus.emit("twoPoint", { setup: true });
      this.bus.emit("playCall", { down: 1, toGo: 2, los: this.los, waitUser: this.waitUser, two: true });
      return;
    }
    this.setupFG(true);
  }
  // the two-point try's play call (again after a timeout at the line: reHuddle)
  twoPointCall() {
    this.call = { off: null, def: null };
    this.defCalled = null; this.defAud = null;
    this.huddle();
    this.setPhase("playcall");
    this.clockAtCall();
    const offCPU = !this.isUserTeam(this.possession), defCPU = !this.isUserTeam(this.defTeam);
    if (offCPU) this.call.off = AI.cpuFlip(this, offPlay(this.rng.pick(AI.twoPlays(this)))); // (the CPU's two-point calls)
    if (defCPU) this.call.def = AI.cpuDefCall(this);
    this.waitUser = !offCPU || !defCPU ? "call" : null;
  }

  // ---------- overtime: modified sudden death ----------
  // A touchdown or a safety ends it at once (advance). Otherwise, once BOTH teams have had a possession, the first
  // time the score isn't tied it's over — so a field goal on the opening drive gets answered (a TD wins it, a FG
  // keeps it going, anything else loses it), then it's sudden death. Tie after otPossessions possessions each (option;
  // RULES.OT_MAX_POSS by default) — never with the noTies option (playoffs): it goes on until someone wins.
  possEnded(team) { if (this.ot) this.ot.poss[team]++; }
  checkOT() {
    if (!this.ot) return false;
    const o = this.ot.poss;
    const diff = this.score.home !== this.score.away;
    if ((o.home >= 1 && o.away >= 1 && diff) || (!this.noTies && o.home >= this.otPossessions && o.away >= this.otPossessions)) { this.gameOver(); return true; }
    return false;
  }
  // quarter/half/game transitions; returns true when it took over the flow
  checkClockEnd(afterScore = false) {
    if (this.ot || this.clock > 0) return false;
    this.clockRun = false; this.playClock = RULES.PLAY_CLOCK_ADMIN; // a new quarter: the clock starts at the snap
    const q = this.quarter;
    this.bus.emit("quarterEnd", { q });
    // the end of regulation (4 quarters; a rival game: regulationQuarters 1) — ahead of the quarter breaks below
    if (q >= this.regulationQuarters) {
      if (this.score.home !== this.score.away) { this.gameOver(); return true; }
      if (this.pbp) PBP.close(this, "END REG");
      // overtime: a fresh coin toss decides who gets the ball first
      this.quarter = 5; this.clock = 0;
      this.ot = { poss: { home: 0, away: 0 } };
      this.bus.emit("overtime", {});
      this.coinToss("ot");
      return true;
    }
    if (q === 1 || q === 3) {
      this.quarter++; this.clock = this.quarterSec;
      return false; // (after a score the kickoff still follows; between plays the series goes on)
    }
    if (q === 2) {
      if (this.pbp) PBP.close(this, "END HALF");
      this.quarter = 3; this.clock = this.quarterSec;
      this.timeouts = { home: RULES.TIMEOUTS, away: RULES.TIMEOUTS };
      this.noHuddle.home = this.noHuddle.away = false;
      this.setPhase("halftime");
      this.bus.emit("halftime", {});
      return true;
    }
    return false;
  }
  continueHalftime() {
    if (this.phase !== "halftime") return;
    if (this.handoff) this.applyHandoff();
    if (this.coachQ) CO.runQueue(this); // the coach's substitutions waiting for the dead ball (coach.js)
    this.setupKickoff(this.firstReceiver, RULES.KICKOFF_SPOT); // whoever received first kicks off the 2nd half
  }
  gameOver() {
    if (this.pbp) PBP.close(this, "END GAME");
    this.setPhase("over");
    const winner = this.score.home > this.score.away ? "home" : this.score.away > this.score.home ? "away" : null;
    this.winner = winner;
    this.bus.emit("gameOver", { winner, score: { ...this.score } });
  }

  // ---------- user input ----------
  // intent: {mx, my} in SCREEN terms (up = the way the camera looks: screenDir()), sprint, pressed {...}
  applyUserInput(dt) {
    const p = this.control, inp = this.input;
    if (!p || !inp) return;
    const dirU = this.screenDir();
    const wx = inp.my * dirU, wy = -inp.mx * dirU; // screen up → +x times screenDir(); screen right → −y (offense facing +x)
    const active = Math.hypot(inp.mx, inp.my) > 0.15;
    if (!this.userDrives(p)) return;
    if (active) { p.mx = wx; p.my = wy; p.want = Math.min(1, Math.hypot(inp.mx, inp.my)); }
    else { p.mx = 0; p.my = 0; p.want = 0; }
    p.sprint = Boolean(inp.sprint);
  }
  userDir() { return this.user === this.possession ? 1 : -1; } // the user's attack direction (offense terms)
  // Up-screen in offense coordinates. Kick coverage and returns follow the camera when it flips after the kick.
  screenDir() {
    if (this.playType === "kickoff" || this.playType === "punt") return this.cameraScreenDir || (this.user === this.possession ? 1 : -1);
    return this.user === this.possession || this.playType === "normal" || this.playType === "two" ? 1 : -1;
  }
  // discrete actions from input.js / the UI
  action(name, arg) {
    // calls that work outside live play
    if (name === "coinCall") { if (this.phase === "coin" && this.waitUser === "coin") this.resolveCoin(arg && arg.call, arg && arg.choice); return; }
    if (name === "coinChoice") { if (this.phase === "coin" && this.waitUser === "coinChoice") this.chooseCoin(arg && arg.choice, true); return; }
    if (name === "kickType") { this.setKickType(arg && arg.type); return; }
    if (name === "returnLane") { this.setReturnLaneCall(arg && arg.lane); return; }
    const p = this.control;
    if (this.phase === "presnap") {
      if (name === "snap") { if (this.waitUser === "snap") this.snap(); return; }
      // the human's spike from the line (no huddle): whatever was called, the QB spikes it
      if (name === "spike") { if (this.waitUser === "snap" && this.canSpike() && !(this.call.off && this.call.off.kneel)) { this.call.off = CLOCK_PLAYS.spike; this.hot = {}; this.snap(); } return; }
      // the defense at the line: SWITCH cycles its defenders, a tap on one takes him (switchTo { slot }: controls.js)
      if ((name === "switch" || name === "switchTo") && this.userSide() === "D" && (this.playType === "normal" || this.playType === "two")) { if (name === "switch") this.cycleDefender(); else this.switchTo(arg && arg.slot); return; }
      return;
    }
    if (this.phase !== "live" || !p || this.autopilot) return;
    const dirU = this.userDir();
    const b = this.ball;
    if (name === "pass") {
      const qb = this.qb;
      if (!qb || !qb.hasBall || this.passThrown || this.losCrossed || this.call.off.type !== "pass" || p !== qb) return;
      const rec = this.receiverByIcon(arg.k);
      if (!rec) return;
      // forgiving for a human on an open man (green ≈ open > 2.4, yellow > 1): tighter placement; covered = as thrown
      const open = AI.openness(this, rec, qb);
      // (PRO to LEGEND: less help, worse on the run, and the real pressure on him: ai.hardThrow)
      this.throwOpen = open;
      P.throwTo(this, qb, rec, Boolean(arg.lob), arg.air || 0.5, this.hard ? AI.hardThrow(this, qb, rec, open) : open > 2.4 ? 0.55 : open > 1 ? 0.8 : 1);
      // the user keeps the QB while the ball is in the air: the AI runs the target to the catch point (as it does for
      // CPU passes) and control moves to him at the catch (physics.js resolveCatch); a pick hands the user a chaser
      return;
    }
    if (name === "throwAway") {
      // the user's QB throws it out of bounds (still behind the line, before a pass)
      const qb = this.qb;
      if (!qb || p !== qb || !qb.hasBall || this.passThrown || this.losCrossed || !this.call.off || this.call.off.type !== "pass") return;
      AI.throwAway(this, qb);
      return;
    }
    if (name === "kneel") {
      // returner in his own end zone: take a knee → touchback
      const r = b.carrier;
      if ((this.playType === "kickoff" || this.playType === "punt") && r && r === p && r === this.returner && r.side === "D" && r.x >= 100 && this.inEndZoneSince() && !this.returnKneel) {
        this.returnKneel = true; this.kneelT = 0; r.want = 0; r.vx *= 0.3; r.vy *= 0.3;
        this.bus.emit("kneel", { player: r });
      }
      return;
    }
    if (name === "switch") {
      if (this.userSide() === "D" || this.userChasing() || (this.playType === "kickoff" && this.user === this.possession) || (this.playType === "punt" && this.user === this.possession)) this.switchToBall();
      return;
    }
    // a tap on one of his defenders in a scrimmage play (where SWITCH works on defense: not while his own man has the ball)
    if (name === "switchTo") { if (this.userSide() === "D" && (this.playType === "normal" || this.playType === "two") && !p.hasBall) this.switchTo(arg && arg.slot); return; }
    // FAIR CATCH: he fields it and the ball is dead there. It calls off a let-go at the goal line while he can still get
    // back under it (ai.underInTime); too late for that, he leaves it be (no pick-up on the bounce)
    if (name === "fairCatch") {
      if (this.playType === "punt" && this.isUserTeam(this.defTeam) && b.state === "air") { this.fairCatch = true; if (this.letGo && AI.underInTime(this, this.returner)) this.letGo = false; }
      return;
    }
    const fwdX = dirU, side = (arg && arg.side) || 0;
    if (p.hasBall) {
      if (this.returnKneel && p === this.returner) return;
      // the dive button doubles as: take a knee (returner in his end zone) · throw it away (QB still in the pocket)
      if (name === "dive" && (this.playType === "kickoff" || this.playType === "punt") && p === this.returner && p.side === "D" && p.x >= 100 && this.inEndZoneSince()) { this.action("kneel"); return; }
      if (name === "dive" && p === this.qb && !this.passThrown && !this.losCrossed && this.call.off && this.call.off.type === "pass" && !p.ai.scramble) { this.action("throwAway"); return; }
      if (name === "lateral") return this.lateral(p);
      if (name === "juke") P.startMove(this, p, "juke", 0, -side * this.screenDir()); // side is screen left / right
      else if (name === "spin") P.startMove(this, p, "spin", fwdX, 0);
      else if (name === "stiff") P.startMove(this, p, "stiff", fwdX, 0);
      else if (name === "truck") P.startMove(this, p, "truck", fwdX, 0);
      else if (name === "dive") {
        if (p.slot === "QB" && this.playType === "normal" && !this.handedOff) P.startMove(this, p, "slide", fwdX, 0);
        else P.startMove(this, p, "dive", p.mx || fwdX, p.my || 0);
      }
      return;
    }
    // defense / no ball
    if (name === "tackle" || name === "hitstick") {
      const c = b.carrier;
      let dx = p.mx || fwdX, dy = p.my || 0;
      if (c && c.side !== p.side) { dx = c.x - p.x; dy = c.y - p.y; }
      P.startMove(this, p, name === "tackle" ? "dive" : "hitstick", dx, dy);
      if (name === "hitstick") { this.stats[p.teamKey].hitSticks++; if (this.statsBy) PS.line(this, p.teamKey, p).hs++; }
      return;
    }
    if (name === "swat") {
      // a leap: at a pass in the air (one swat per ball) or to block a kick
      const kickBlock = (this.playType === "fg" || this.playType === "pat" || this.playType === "punt") && !this.kicked && p.side === "D";
      const passAir = b.state === "air" && (b.kind === "pass" || b.kind === "lob");
      if (kickBlock || !passAir) { P.startMove(this, p, "swat", 0, 0); return; }
      if (this.userSwatId === this.passId) return; // one swat per ball
      if (P.startMove(this, p, "swat", 0, 0)) this.userSwatId = this.passId;
      return;
    }
  }
  lateral(from) {
    if (!from || !from.hasBall || this.ball.state !== "held" || from.move || from.down > 0) return null;
    const dir = from.side === "O" ? 1 : -1;
    const mine = from.side === "O" ? this.off : this.def;
    let to = null, best = 99;
    for (const p of mine) {
      if (p === from || !p.canAct || p.engaged || p.teamKey !== from.teamKey) continue;
      const forward = (p.x - from.x) * dir;
      const d = from.distTo(p.x, p.y);
      if (forward > 0.75 || d < 1.2 || d > 10) continue;
      const score = d + Math.max(0, forward) * 4;
      if (score < best) { best = score; to = p; }
    }
    if (!to) return null;
    const b = this.ball, T = clamp(best / 18, 0.22, 0.48);
    from.hasBall = false;
    b.state = "air"; b.kind = "pitch"; b.carrier = null; b.target = to; b.from = from;
    P.launch(b, from.x, from.y, 1.2, to.x + to.vx * T * 0.35, to.y + to.vy * T * 0.35, 1.1, T);
    this.control = to;
    this.bus.emit("pitch", { player: from, to, lateral: true });
    return to;
  }
  receiverByIcon(k) {
    const list = this.passTargets();
    return list[k - 1] || null;
  }
  passTargets() {
    const play = this.call.off;
    if (!play || play.type !== "pass") return [];
    const order = (play.prog || ELIGIBLE).slice();
    for (const s of ELIGIBLE) if (!order.includes(s)) order.push(s);
    const out = [];
    for (const s of order) {
      const p = this.bySlot(this.off, s);
      if (p && p.as && p.as.kind === "route") out.push(p);
    }
    return out.slice(0, 5);
  }
  switchToBall() {
    const b = this.ball;
    const mine = this.user === this.possession ? this.off : this.def;
    let best = null, bd = 1e9;
    for (const p of mine) {
      if (p === this.control) continue;
      const d = p.distTo(b.x, b.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) { this.control = best; this.userDefSlot = best.slot; this.bus.emit("switch", { player: best }); }
  }
  cycleDefender() {
    const order = ["ILB1", "ILB2", "OLB1", "OLB2", "S1", "S2", "CB1", "CB2", "DE1", "NT", "DE2"];
    const cur = this.control ? order.indexOf(this.control.slot) : -1;
    for (let i = 1; i <= order.length; i++) {
      const s = order[(cur + i) % order.length];
      const p = this.bySlot(this.def, s);
      if (p) { this.control = p; this.userDefSlot = s; this.bus.emit("switch", { player: p }); return; }
    }
  }
  // the defender the user tapped (action "switchTo" { slot }; online, his seat's: online/src/match.js), one of his own
  // on the field, is the one he controls now, handed over as cycleDefender does → true when he took him
  switchTo(slot) {
    const p = typeof slot === "string" && !this.autopilot ? this.bySlot(this.def, slot) : null;
    if (!p || p === this.control) return false;
    this.control = p; this.userDefSlot = slot; this.bus.emit("switch", { player: p });
    return true;
  }
  setKick(power, acc, aim = 0) { this.kickInput = { power, acc, aim }; }

  // the human's substitutions, PRO's Depth Chart (coach.js: at once between plays, else at the next dead ball)
  coachSub(team, slot, other) { return CO.coachSub(this, team, slot, other); }
  // ---------- watch and jump in ----------
  // takeOver("home" | "away"): that team goes to the human at the next dead ball — his play calls, snaps, kicks and
  // stick from the next play on; takeOver(null): back to the autopilot (both sides CPU). Queued while a play is on and
  // applied where a dead ball turns into the next play (advance, continueHalftime, afterCoin), or at once before the
  // opening toss. → true when queued.
  takeOver(team) {
    if (team !== null && team !== "home" && team !== "away") return false;
    this.handoff = { team };
    if (this.phase === "init") this.applyHandoff();
    return true;
  }
  applyHandoff() {
    const h = this.handoff;
    this.handoff = null;
    if (h.team) { this.user = h.team; this.autopilot = false; } else this.autopilot = true;
    this.control = null;
    this.bus.emit("takeover", { team: h.team, human: Boolean(h.team) });
  }

  // ---------- special-teams calls ----------
  // kickoff type (the kicking team, before the kick) — normal | squib | onside
  setKickType(type) {
    if (!KICK_TYPES.includes(type) || this.playType !== "kickoff" || this.phase !== "presnap" || this.kicked) return false;
    if (!this.isUserTeam(this.possession) && this.user) return false; // the CPU makes its own call
    this.onside = type === "onside"; this.squib = type === "squib";
    this.bus.emit("specialCall", { call: "kickType", value: type, team: this.possession });
    return true;
  }
  // return lane (the receiving team, any time before the catch) — middle | left | right (the returner's left/right)
  setReturnLaneCall(lane) {
    if (!RETURN_LANES.includes(lane)) return false;
    const kick = this.playType === "kickoff" || this.playType === "punt";
    const rt = this.defTeam;
    if (!kick || !(this.phase === "presnap" || this.phase === "live") || (this.phase === "live" && this.retStart != null)) return false;
    if (this.user && !this.isUserTeam(rt)) return false;
    this.laneByTeam[rt] = lane;
    this.returnLane = lane; this.returnLaneY = LANE_Y[lane];
    this.bus.emit("specialCall", { call: "returnLane", value: lane, team: rt });
    return true;
  }
  // What the user can call right now (null fields = not available):
  //   { kickType: {options, current} | null, returnLane: {options, current} | null, coinCall: {options, choices} | null,
  //     coinChoice: {options, kind} | null (the user won the toss: receive|defer, receive|kick in overtime),
  //     fairCatch: bool, kneel: bool, throwAway: bool, fourth: {recommend, fgDist, fgProb, convProb} | null,
  //     fieldGoal: {fgDist, fgProb, recommend} | null — FIELD GOAL on 1st–3rd down: the last 20 s of a half, in range,
  //     clock: {noHuddle: {on, recommend}, spike: {play, recommend} | null, kneel: {play, recommend} | null} | null —
  //     the human offense's clock management at the play call (recommend: what the coach would do) }
  specialCalls() {
    const userKicks = this.isUserTeam(this.possession), userRet = this.isUserTeam(this.defTeam);
    const kick = this.playType === "kickoff" || this.playType === "punt";
    const b = this.ball, c = this.control;
    const out = { phase: this.phase, playType: this.playType, kickType: null, returnLane: null, coinCall: null, coinChoice: null, fairCatch: false, kneel: false, throwAway: false, fourth: null, fieldGoal: null, clock: null };
    if (this.playType === "kickoff" && this.phase === "presnap" && userKicks && !this.kicked) out.kickType = { options: KICK_TYPES.slice(), current: this.kickType };
    if (kick && userRet && (this.phase === "presnap" || (this.phase === "live" && this.retStart == null))) out.returnLane = { options: RETURN_LANES.slice(), current: this.returnLane };
    if (this.phase === "coin" && this.waitUser === "coin") out.coinCall = { options: ["heads", "tails"], choices: ["receive", "defer"], kind: this.coin && this.coin.kind };
    if (this.phase === "coin" && this.waitUser === "coinChoice") out.coinChoice = { options: this.coin.kind === "ot" ? ["receive", "kick"] : ["receive", "defer"], kind: this.coin.kind };
    if (this.phase === "live") {
      out.fairCatch = this.playType === "punt" && userRet && b.state === "air";
      out.kneel = kick && userRet && c && b.carrier === c && c === this.returner && c.x >= 100 && this.inEndZoneSince() && !this.returnKneel;
      out.throwAway = this.userSide() === "O" && c && c === this.qb && c.hasBall && !this.passThrown && !this.losCrossed && Boolean(this.call.off) && this.call.off.type === "pass";
    }
    if (this.phase === "playcall" && this.down === 4 && this.playType === "normal" && this.isUserTeam(this.possession)) {
      const e = AI.fourthEval(this);
      out.fourth = { recommend: AI.coachFourth(this), fgDist: e.fgDist, fgProb: +e.fgProb.toFixed(2), convProb: +e.convProb.toFixed(2) };
    }
    // the coach kicks on the last snap (AI.lastSnapFG: the time left at the snap decides it)
    if (this.phase === "playcall" && this.down < 4 && this.playType === "normal" && this.isUserTeam(this.possession) && !this.ot && (this.quarter === 2 || this.quarter === 4) && this.halfLeft() <= 20) {
      const e = AI.fourthEval(this);
      if (e.fgDist <= KICKING.FG_RANGE) out.fieldGoal = { fgDist: e.fgDist, fgProb: +e.fgProb.toFixed(2), recommend: AI.lastSnapFG(this) };
    }
    // clock management: NO HUDDLE any time, SPIKE while the clock runs, KNEEL where a knee can end a half — the first
    // half's last 2:00 in his own end, ahead in the game's last 5:00, tied in its last 2:00
    if (this.phase === "playcall" && this.playType === "normal" && this.isUserTeam(this.possession)) {
      const lead = this.score[this.possession] - this.score[this.defTeam], left = this.halfLeft();
      const knee = !this.ot && this.down < 4 && (this.half() === 1 ? left <= RULES.TWO_MIN && this.los < 50 : (lead > 0 && left <= RULES.OOB_STOP[1]) || (lead === 0 && left <= RULES.TWO_MIN));
      out.clock = {
        noHuddle: { on: this.noHuddle[this.possession], recommend: AI.cpuTempo(this) === "hurry" },
        spike: this.canSpike() ? { play: CLOCK_PLAYS.spike, recommend: AI.cpuSpike(this) } : null,
        kneel: knee ? { play: CLOCK_PLAYS.kneel, recommend: AI.kneelOut(this) } : null,
      };
    }
    return out;
  }
  // 4th-down recommendation for the team with the ball: "go" | "punt" | "fg" (deterministic expected points + game state)
  coachFourth() { return AI.coachFourth(this); }
  // FG / PAT meter guide for the HUD: the power that clears the crossbar, the accuracy window (± meter units that
  // still split the uprights — it narrows with distance) and the aim that cancels the crosswind. null otherwise.
  kickGuide() {
    if ((this.playType !== "fg" && this.playType !== "pat") || !this.kicker || !this.holderSpot) return null;
    const dist = 110 - this.holderSpot[0];
    return { dist: Math.round(dist), power: clamp(P.fgPowerFor(this.kicker, dist), 0, 1.2), acc: KICKING.UPRIGHT / (KICKING.ACC_ANG * dist), aim: clamp(-this.windAng() / KICKING.AIM_ANG, -1, 1) };
  }

  // The user-controlled defender's assignment (for the presentation overlay), or null:
  //   {type:"zone", zone, deep, x, y, r, X, Y} (landmark in offense coords and ABSOLUTE stadium coords, radius in yd)
  //   {type:"man", target, slot} · {type:"rush"} · {type:"spy", target} · {type:"pursuit", target} once the ball is out
  userAssignment() {
    const p = this.control;
    if (!p || this.autopilot || this.userSide() !== "D" || p.side !== "D") return null;
    if (!(this.phase === "presnap" || this.phase === "live")) return null;
    if (this.playType !== "normal" && this.playType !== "two") return this.playType === "fg" || this.playType === "pat" ? { type: "rush", block: true } : null;
    const c = this.ball.carrier;
    if (this.phase === "live" && c && c.side === "O" && (this.handedOff || this.losCrossed || c !== this.qb)) return { type: "pursuit", target: c, slot: c.slot };
    const as = p.as || {};
    if (as.kind === "zone") {
      const Z = ZONES[as.zone] || ZONES.robber;
      const x = Math.min(this.los + Z[0], 109), y = clamp(this.ballY - Z[1], 3, FIELD_W - 3);
      const deep = Z[0] >= 14;
      return { type: "zone", zone: as.zone, deep, x, y, r: deep ? 11 : 7.5, X: this.absX(x), Y: this.absY(y) };
    }
    if (as.kind === "man") return as.target ? { type: "man", target: as.target, slot: as.target.slot } : { type: "zone", zone: "robber", deep: false, x: this.los + 10, y: this.ballY, r: 7.5, X: this.absX(this.los + 10), Y: this.absY(this.ballY) };
    if (as.kind === "spy") return { type: "spy", target: this.qb };
    return { type: "rush" };
  }

  // ---------- invariants ----------
  checkInvariants() {
    for (const p of this.players) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) { this.errors.push(`NaN position ${p.slot}`); p.x = this.los; p.y = MID_Y; p.z = 0; p.vx = p.vy = 0; }
      if (p.x < -40 || p.x > 150 || p.y < -30 || p.y > FIELD_W + 30) { this.errors.push(`off-field ${p.slot} ${p.x.toFixed(1)},${p.y.toFixed(1)}`); p.x = clamp(p.x, -12, 112); p.y = clamp(p.y, -8, FIELD_W + 8); }
    }
    const b = this.ball;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) { this.errors.push("NaN ball"); b.x = this.los; b.y = MID_Y; b.z = 0; }
  }
}
const DL_RUSH = ["DE1", "NT", "DE2"];
export { OFF_PLAYS };
