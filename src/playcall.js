// The football panels, built on ui.showPanel: the play call (formation tabs, play cards with diagrams, COACH'S PICK,
// FLIP, NO HUDDLE / SPIKE / KNEEL, FIELD GOAL late in a half), 4th down, the try after a touchdown, kickoff type,
// return lane, the coin toss, and the pre-snap audible / defensive audible / hot route menus. Same World calls as
// ALL-22 PRO's ui-playcall.js.
import { FORMATIONS, OFF_FORMATION_ORDER, DEF_FORMATION_ORDER, playsIn, defFormation, HOT_ROUTES, ROUTE_LIB, asCalled, DEF_AUDIBLES, defAudiblePlay, basePlay, CLOCK_PLAYS } from "./sim/playbook.js";
import * as AI from "./sim/ai.js";
import { KICKING, FAKE } from "./sim/config.js";
import { ROUTE_LABEL, hotList, currentRoute } from "./sim/controls.js";
import { cap } from "./sim/bindings.js";
import { offSVG, defSVG, routeSVG } from "./diagrams.js";
import { esc } from "./ui.js";
import { CoachFace, coachLine } from "./coach3d.js";
import { coinStrip } from "./coin-art.js";

const ORD = ["", "1ST", "2ND", "3RD", "4TH"];
function offTag(p) {
  if (p.type === "run") return p.rpo ? ["RPO", "pa"] : p.option ? ["OPTION", "run"] : p.carrier === "QB" ? ["QB RUN", "run"] : p.toss ? ["SWEEP", "run"] : ["RUN", "run"];
  if (p.screen) return ["SCREEN", "pass"];
  return p.pa ? ["PLAY ACTION", "pa"] : p.quick ? ["QUICK PASS", "pass"] : ["PASS", "pass"];
}
function defTag(p) { return p.blitz ? ["BLITZ", "blitz"] : p.sim ? ["SIM PRESSURE", "blitz"] : p.cov === "man" ? ["MAN", "man"] : ["ZONE", "zone"]; }
function cosmetic(w, fn) {
  const saved = w.rng.next; let s = (w.playNo * 2654435761 + 7) >>> 0;
  w.rng.next = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  try { return fn(); } finally { w.rng.next = saved; }
}
export function specialOffer(w) {
  let s; try { s = w.specialCalls(); } catch (_) { return null; }
  if (!s) return null;
  const out = {}, norm = (v, d) => (Array.isArray(v) ? v : v ? d : null);
  const kt = norm(s.kickType, ["normal", "squib", "onside"]); if (kt) out.kickType = kt;
  const rl = norm(s.returnLane, ["middle", "left", "right"]); if (rl) out.returnLane = rl;
  return out.kickType || out.returnLane ? out : null;
}
export const fieldGoalOffer = (w) => { try { const s = w.specialCalls(); return (s && s.fieldGoal) || null; } catch (_) { return null; } };
export const clockOffer = (w) => { try { const s = w.specialCalls(); return (s && s.clock) || null; } catch (_) { return null; } };
export function coachFourth(w) {
  try { const r = w.coachFourth(); if (r === "go" || r === "punt" || r === "fg") return r; } catch (_) { /* fall back */ }
  return cosmetic(w, () => AI.fourthDownChoice(w));
}
export function situation(w) {
  const off = w.teams[w.possession].abbr, def = w.teams[w.possession === "home" ? "away" : "home"].abbr;
  const spot = w.los < 50 ? `${off} ${Math.round(w.los)}` : w.los > 50 ? `${def} ${Math.round(100 - w.los)}` : "MIDFIELD";
  const dd = w.playType === "two" ? "2-PT TRY" : `${ORD[w.down]} &amp; ${w.los + w.toGo >= 100 ? "GOAL" : Math.max(1, Math.round(w.toGo))}`;
  return `${dd} · ${spot}`;
}
const keyTag = (id) => (cap(id) ? `<kbd>${esc(cap(id))}</kbd>` : "");

let coinURL = null;
const COIN = () => (coinURL = coinURL || coinStrip()); // (drawn once)

export class CallPanel {
  constructor(ui, app) { this.ui = ui; this.app = app; this.flip = false; this.hotRec = null; }
  flipFor(w, side) { const k = this.flipKey; return Boolean(k && k.w === w && k.n === w.playNo && k.side === side && k.pt === w.playType && this.flip); }

  // ---------- the play call ----------
  showPlayCall(w, side, coach) {
    this.w = w; this.side = side; this.coach = coach;
    this.flip = this.flipFor(w, side);
    this.flipKey = { w, n: w.playNo, side, pt: w.playType };
    this.forms = (side === "O" ? OFF_FORMATION_ORDER : DEF_FORMATION_ORDER).filter((f) => playsIn(f, side).length);
    this.formIdx = Math.max(0, this.forms.indexOf(coach.formation));
    this.renderCall(w, true);
  }
  refreshCall(w) { this.renderCall(w, false, this.ui.sel); }
  renderCall(w, toCoach, keepI = null) {
    const side = this.side, coach = this.coach, f = this.forms[this.formIdx];
    const scheme = w.teams[side === "O" ? w.possession : w.defTeam].scheme;
    const fname = (k) => (side === "O" ? FORMATIONS[k].name : defFormation(k, scheme).name);
    const plays = playsIn(f, side);
    const nP = plays.length, nT = this.forms.length;
    // items: plays 0..nP-1, tabs nP..nP+nT-1, coach card, then the extras
    const cards = plays.map((p, i) => {
      const [tag, tc] = side === "O" ? offTag(p) : defTag(p);
      const shown = asCalled(p, this.flip);
      const isCoach = coach.id === p.id;
      return `<button class="card pc ${isCoach ? "pick" : ""}" data-i="${i}" data-k="${i < 9 ? i + 1 : ""}">
        <span class="pk">${i < 9 ? i + 1 : ""}</span>${side === "O" ? offSVG(shown) : defSVG(shown, scheme)}
        <span class="pn">${esc(p.name)}</span><span class="pt ${tc}">${tag}</span>${isCoach ? '<span class="cb">COACH</span>' : ""}</button>`;
    }).join("");
    const tabs = this.forms.map((k, i) => `<button class="tab ${i === this.formIdx ? "on" : ""} ${coach.formation === k ? "cf" : ""}" data-i="${nP + i}" data-tab="1">${esc(fname(k))}</button>`).join("");
    const cIdx = nP + nT;
    const fg = side === "O" ? fieldGoalOffer(w) : null, ck = side === "O" ? clockOffer(w) : null;
    this.fg = fg; this.ck = ck;
    let extra = "", n = cIdx + 1;
    const ex = {};
    if (fg) { ex.fg = n; extra += `<button class="xb ${fg.recommend ? "pick" : ""}" data-i="${n++}">FIELD GOAL · ${fg.fgDist} YD ${keyTag("fieldGoal")}</button>`; }
    if (ck) {
      ex.nh = n; extra += `<button class="xb ${ck.noHuddle.on ? "on" : ck.noHuddle.recommend ? "pick" : ""}" data-i="${n++}">NO HUDDLE ${keyTag("noHuddle")}</button>`;
      if (ck.spike) { ex.spike = n; extra += `<button class="xb ${ck.spike.recommend ? "pick" : ""}" data-i="${n++}">SPIKE ${keyTag("spike")}</button>`; }
      if (ck.kneel) { ex.kneel = n; extra += `<button class="xb ${ck.kneel.recommend ? "pick" : ""}" data-i="${n++}">KNEEL ${keyTag("kneelCall")}</button>`; }
    }
    ex.flip = n; extra += `<button class="xb ${this.flip ? "on" : ""}" data-i="${n++}">FLIP ${keyTag("flip")}</button>`;
    const nhTag = side === "D" && w.noHuddle && w.noHuddle[w.possession] ? '<span class="tagw">NO HUDDLE</span>' : "";
    const html = `<div class="ph"><span class="sit">${situation(w)}</span><span class="side ${side === "O" ? "o" : "d"}">${side === "O" ? "OFFENSE" : "DEFENSE"}</span>${nhTag}<span class="xbs">${extra}</span></div>
      <div class="tabs">${tabs}</div>
      <div class="cards">${cards}</div>
      <button class="coachbar" data-i="${cIdx}"><span class="cface-wrap" aria-hidden="true"></span><span class="cbub"><span class="cq">“${esc(coachLine((side === "O" ? offTag(coach) : defTag(coach))[0], w.playNo + coach.name.length))}”</span><span class="cpk">COACH'S PICK <b>${esc(coach.name)}</b> · ${esc(fname(coach.formation))} ${keyTag("coach")}</span></span></button>
      <div class="hint">◀ ▶ PLAY · ▲ ▼ FORMATION · ENTER OR 1-${Math.min(9, nP)} CALL · ${esc(cap("coach"))} COACH · ${esc(cap("flip"))} FLIP · ${esc(cap("timeout"))} TIMEOUT</div>`;
    const pickCoach = () => { this.app.audio.sfx("select"); this.app.callPlay(coach, this.flip); };
    const toggleFlip = () => { this.flip = !this.flip; this.app.audio.sfx("blip"); this.renderCall(w, false, this.ui.sel); };
    const keys = [["coach", pickCoach], ["flip", toggleFlip]];
    if (fg) keys.push(["fieldGoal", () => this.app.fourthChoice("fg")]);
    if (ck) { keys.push(["noHuddle", () => this.app.toggleNoHuddle()]); if (ck.kneel) keys.push(["kneelCall", () => this.app.callPlay(ck.kneel.play || CLOCK_PLAYS.kneel)]); if (ck.spike) keys.push(["spike", () => this.app.callPlay(ck.spike.play || CLOCK_PLAYS.spike)]); }
    const setForm = (i) => { if (i === this.formIdx) return; this.formIdx = i; this.app.audio.sfx("blip"); this.renderCall(w, false, 0); };
    const self = this;
    this.ui.showPanel("call", html, {
      cls: "call",
      keys,
      sel: keepI != null ? keepI : toCoach ? Math.max(0, plays.findIndex((p) => p.id === coach.id)) : 0,
      onFocus(i) { if (i >= nP && i < nP + nT) setForm(i - nP); },
      onPick(i) {
        if (i < nP) { self.app.audio.sfx("select"); self.app.callPlay(plays[i], self.flip); }
        else if (i < nP + nT) setForm(i - nP);
        else if (i === cIdx) pickCoach();
        else if (i === ex.fg) self.app.fourthChoice("fg");
        else if (i === ex.nh) self.app.toggleNoHuddle();
        else if (i === ex.spike) self.app.callPlay(ck.spike.play || CLOCK_PLAYS.spike);
        else if (i === ex.kneel) self.app.callPlay(ck.kneel.play || CLOCK_PLAYS.kneel);
        else if (i === ex.flip) toggleFlip();
      },
    });
    // the coach's talking head beside his pick (he says his piece when the call opens)
    const wrap = this.ui.panel.querySelector(".cface-wrap");
    if (wrap) {
      const face = (this.app.coachFace = this.app.coachFace || new CoachFace());
      wrap.append(face.canvas);
      if (toCoach) face.show(this.app.kits[side === "O" ? w.possession : w.defTeam]);
    }
    // ▲ ▼ change formation directly (the cards stay one row)
    this.ui.pOpts.keys.push(["up", () => setForm((this.formIdx + nT - 1) % nT)], ["down", () => setForm((this.formIdx + 1) % nT)]);
  }

  // ---------- 4th down ----------
  showFourth(w) {
    const rec = coachFourth(w);
    const fgDist = Math.round(100 - w.los + 17), toGo = w.los + w.toGo >= 100 ? "GOAL" : Math.max(1, Math.round(w.toGo));
    const fgOk = fgDist <= KICKING.FG_RANGE, up = w.toGo <= FAKE.UPBACK, fakeFG = typeof w.canFake === "function" && w.canFake("fg");
    const opts = [["go", "GO FOR IT", `4TH & ${toGo}`, true], ["punt", "PUNT", "FLIP THE FIELD", true], ["fg", "FIELD GOAL", fgOk ? `${fgDist} YARDS` : "OUT OF RANGE", fgOk],
      ["fakePunt", "FAKE PUNT", up ? "THE UP-BACK RUNS IT" : "THE PUNTER RUNS OR THROWS", true], ["fakeFG", "FAKE FIELD GOAL", fakeFG ? "THE HOLDER RUNS OR THROWS" : "OUT OF RANGE", fakeFG]];
    const cards = opts.map(([k, t, s, ok], i) => `<button class="card big ${k === rec ? "pick" : ""} ${i > 2 ? "fake" : ""}" data-i="${i}" data-k="${i + 1}" ${ok ? "" : "disabled"}><span class="pk">${i + 1}</span><span class="bt">${t}</span><span class="bs">${s}</span>${k === rec ? '<span class="cb">COACH</span>' : ""}</button>`).join("");
    this.ui.showPanel("fourth", `<div class="ph"><span class="sit">${situation(w)}</span><span class="side o">4TH DOWN</span></div><div class="cards">${cards}</div><div class="hint">1-5 OR ◀ ▶ + ENTER</div>`, {
      cls: "small", sel: Math.max(0, ["go", "punt", "fg"].indexOf(rec)),
      onPick: (i) => this.app.fourthChoice(opts[i][0]),
    });
  }
  // ---------- the try ----------
  showPat(w) {
    const lead = w.score[w.user] - w.score[w.user === "home" ? "away" : "home"];
    const late = w.quarter >= 4 && w.clock < 300;
    const rec = late && [-2, -5, -10, 1, 5].includes(lead) ? "two" : "kick"; // (lead already counts the six)
    const opts = [["kick", "KICK THE PAT", "+1 · KICK METER"], ["two", "GO FOR 2", "+2 · ONE PLAY FROM THE 2"]];
    const cards = opts.map(([k, t, s], i) => `<button class="card big ${k === rec ? "pick" : ""}" data-i="${i}" data-k="${i + 1}"><span class="pk">${i + 1}</span><span class="bt">${t}</span><span class="bs">${s}</span></button>`).join("");
    this.ui.showPanel("pat", `<div class="ph"><span class="sit">AFTER THE TOUCHDOWN</span><span class="side o">THE TRY</span></div><div class="cards">${cards}</div><div class="hint">1-2 OR ◀ ▶ + ENTER</div>`, {
      cls: "small", sel: rec === "two" ? 1 : 0, onPick: (i) => this.app.patChoice(opts[i][0]),
    });
  }
  // ---------- special teams ----------
  showKickType(w, list) {
    const lead = w.score[w.user] - w.score[w.user === "home" ? "away" : "home"];
    const rec = w.quarter >= 4 && w.clock < 150 && lead < 0 && lead >= -8 ? "onside" : "normal";
    const info = { normal: ["NORMAL", "DEEP KICK · COVER IT"], squib: ["SQUIB", "LOW LINE DRIVE"], onside: ["ONSIDE", "RISKY · RECOVER IT YOURSELF"] };
    const cards = list.map((t, i) => `<button class="card big ${rec === t ? "pick" : ""}" data-i="${i}" data-k="${i + 1}"><span class="pk">${i + 1}</span><span class="bt">${info[t][0]}</span><span class="bs">${info[t][1]}</span></button>`).join("");
    this.ui.showPanel("special", `<div class="ph"><span class="sit">${esc(w.teams[w.user].abbr)} KICKOFF</span><span class="side o">SPECIAL TEAMS</span></div><div class="cards">${cards}</div><div class="hint">PICK A KICK · THEN ${esc(cap("kick"))} THREE TIMES: START, POWER, ACCURACY</div>`, {
      cls: "small", sel: Math.max(0, list.indexOf(rec)), onPick: (i) => { this.ui.hidePanel(); this.app.setKickType(list[i]); },
    });
  }
  showReturn(w, lanes) {
    const label = { middle: ["MIDDLE", "WEDGE UP THE GUT"], left: ["LEFT", "WALL ON THE LEFT"], right: ["RIGHT", "WALL ON THE RIGHT"] };
    const cards = lanes.map((t, i) => `<button class="card big ${i === 0 ? "pick" : ""}" data-i="${i}" data-k="${i + 1}"><span class="pk">${i + 1}</span><span class="bt">${label[t][0]}</span><span class="bs">${label[t][1]}</span></button>`).join("");
    this.ui.showPanel("special", `<div class="ph"><span class="sit">${w.playType === "punt" ? "PUNT RETURN" : "KICK RETURN"}</span><span class="side d">RETURN LANE</span></div><div class="cards">${cards}</div><div class="hint">1-3 OR ◀ ▶ + ENTER</div>`, {
      cls: "small", onPick: (i) => { this.ui.hidePanel(); this.app.setReturnLane(lanes[i]); },
    });
  }
  // ---------- coin toss ----------
  showCoin(w) {
    this.coin = { t0: this.app.t, result: null, call: null, done: 0, chose: false };
    this.renderCoin(w, null);
    w.coinHold = true;
  }
  renderCoin(w, res) {
    const opp = w.teams[w.user === "home" ? "away" : "home"];
    const opts = !res ? [["heads", "HEADS"], ["tails", "TAILS"]] : [["receive", "RECEIVE", "BALL FIRST"], w.coin && w.coin.kind === "ot" ? ["kick", "KICK", "BALL SECOND"] : ["defer", "DEFER", "BALL IN THE 2ND HALF"]];
    const cards = opts.map(([k, t, s], i) => `<button class="card big" data-i="${i}" data-k="${i + 1}" data-c="${k}"><span class="pk">${i + 1}</span><span class="bt">${t}</span>${s ? `<span class="bs">${s}</span>` : ""}</button>`).join("");
    this.ui.showPanel("coin", `<div class="ph"><span class="sit">COIN TOSS</span><span class="side o">${res ? "YOU WON THE TOSS" : `${esc(opp.abbr)} SAYS: YOU CALL IT`}</span></div>
      <div class="coinrow"><div class="coin ${res ? `landed ${this.coin.result || "heads"}` : "spin"}" data-coin style="--coin: url(${COIN()})"></div><div class="cards">${cards}</div></div>
      <div class="cres" data-res>${res || ""}</div>`, {
      cls: "small coinp",
      onPick: (i) => {
        const c = this.coin;
        if (!c || (!res ? c.call : c.chose)) return;
        if (res && this.app.t - c.t0 < 0.6) return;
        this.ui.items.forEach((b) => { b.disabled = true; b.classList.toggle("on", +b.dataset.i === i); });
        if (res) { c.chose = true; this.app.coinChoice(opts[i][0]); return; }
        c.call = opts[i][0]; c.t0 = this.app.t;
        this.ui.panel.querySelector("[data-coin]").classList.add("fast");
        this.app.coinCall(c.call);
      },
    });
  }
  coinResult(e, w) {
    const c = this.coin;
    if (!c || this.ui.panelMode !== "coin") return;
    const userWon = e.winner === w.user;
    const face = e.result || (c.call ? (userWon ? c.call : c.call === "heads" ? "tails" : "heads") : "heads");
    c.result = face; c.t0 = this.app.t;
    const team = w.teams[e.winner];
    if (e.pending && userWon) { this.renderCoin(w, `<b>${face.toUpperCase()}.</b> ${esc(team.abbr)} WINS THE TOSS`); return; }
    const choice = e.choice ? String(e.choice).toUpperCase() : userWon ? "RECEIVE" : "KICK";
    const coin = this.ui.panel.querySelector("[data-coin]"); if (coin) coin.className = `coin landed ${face}`;
    const r = this.ui.panel.querySelector("[data-res]");
    if (r) { r.innerHTML = `<b>${face.toUpperCase()}.</b> ${esc(team.abbr)} WINS THE TOSS AND WILL ${esc(choice)}`; r.classList.add(userWon ? "won" : "lost"); }
    c.done = this.app.t + 2;
  }
  coinChosen(e, w) {
    const c = this.coin;
    if (!c || this.ui.panelMode !== "coin") return;
    const r = this.ui.panel.querySelector("[data-res]");
    if (r) r.innerHTML = `<b>${String(c.result || "").toUpperCase()}.</b> ${esc(w.teams[e.winner].abbr)} WILL ${esc(String(e.choice).toUpperCase())}`;
    c.done = this.app.t + 1.6;
  }
  tickCoin(t) { const c = this.coin; if (c && c.done && t > c.done) { this.coin = null; if (this.ui.panelMode === "coin") this.ui.hidePanel(); } }

  // ---------- at the line ----------
  showAudible(w) {
    const cur = w.call.off, plays = playsIn(cur.formation, "O");
    const cards = plays.map((p, i) => {
      const [tag, tc] = offTag(p);
      return `<button class="card pc ${p.id === cur.id ? "cur" : ""}" data-i="${i}" data-k="${i + 1}"><span class="pk">${i + 1}</span>${offSVG(asCalled(p, cur.flip))}<span class="pn">${esc(p.name)}</span><span class="pt ${tc}">${tag}</span>${p.id === cur.id ? '<span class="cb now">CALLED</span>' : ""}</button>`;
    }).join("");
    this.ui.showPanel("audible", `<div class="ph"><span class="sit">AUDIBLE · ${esc(FORMATIONS[cur.formation].name)}</span><span class="side o">AT THE LINE</span></div><div class="cards">${cards}</div><div class="hint">1-${plays.length} OR ENTER TO AUDIBLE · BACKSPACE KEEPS THE PLAY</div>`, {
      cls: "call", sel: Math.max(0, plays.findIndex((p) => p.id !== cur.id)), back: () => this.ui.hidePanel(), keys: [["audible", () => this.ui.hidePanel()]],
      onPick: (i) => { if (plays[i].id === cur.id) this.ui.hidePanel(); else this.app.audible(plays[i]); },
    });
  }
  showDefAudible(w) {
    const scheme = w.teams[w.defTeam].scheme, called = basePlay(w.defCalled || w.call.def), flip = Boolean((w.defCalled || w.call.def).flip);
    const now = w.defAud ? w.defAud.id : "called";
    const items = [...DEF_AUDIBLES.map((x) => ({ id: x.id, name: x.name, tag: x.sub, play: defAudiblePlay(x, called) })), { id: "called", name: called.name, tag: "THE CALL", play: called }];
    const cards = items.map((x, i) => `<button class="card pc ${x.id === now ? "cur" : ""}" data-i="${i}" data-k="${i + 1}"><span class="pk">${i + 1}</span>${defSVG(asCalled(x.play, flip), scheme)}<span class="pn">${esc(x.name)}</span><span class="pt ${x.id === "called" ? "zone" : defTag(x.play)[1]}">${esc(x.tag)}</span>${x.id === now ? '<span class="cb now">NOW</span>' : ""}</button>`).join("");
    this.ui.showPanel("daudible", `<div class="ph"><span class="sit">AUDIBLE · DEFENSE</span><span class="side d">AT THE LINE</span></div><div class="cards">${cards}</div><div class="hint">1-${items.length} OR ENTER · BACKSPACE KEEPS IT</div>`, {
      cls: "call", sel: Math.max(0, items.findIndex((x) => x.id !== now)), back: () => this.ui.hidePanel(), keys: [["audible", () => this.ui.hidePanel()]],
      onPick: (i) => { if (items[i].id === now) this.ui.hidePanel(); else this.app.defAudible(items[i].id); },
    });
  }
  showHot(w, rec, cycled = false) {
    this.hotRec = rec;
    const recs = hotList(w);
    if (!rec) {
      const cards = recs.map((p, i) => `<button class="card rc" data-i="${i}" data-k="${i + 1}"><span class="pk">${i + 1}</span><span class="bt">${p.slot.replace(/\d/, "")}</span><span class="bs">${esc(p.name.toUpperCase())}</span><span class="pt">${ROUTE_LABEL[currentRoute(w, p)] || currentRoute(w, p).toUpperCase()}</span></button>`).join("");
      this.ui.showPanel("hot", `<div class="ph"><span class="sit">HOT ROUTE</span><span class="side o">PICK A RECEIVER</span></div><div class="cards">${cards}</div><div class="hint">1-5 RECEIVER · HOLD ${esc(cap("hotRoute"))} + 1-5 TO CYCLE HIS ROUTE · BACKSPACE CLOSES</div>`, {
        cls: "small", back: () => this.ui.hidePanel(), onPick: (i) => this.showHot(w, recs[i]),
      });
      return;
    }
    const cur = currentRoute(w, rec);
    const cards = HOT_ROUTES.map((r, i) => `<button class="card rc ${r === cur ? "cur" : ""}" data-i="${i}" data-k="${i + 1}"><span class="pk">${i + 1}</span>${routeSVG(ROUTE_LIB, r)}<span class="pn">${ROUTE_LABEL[r] || r.toUpperCase()}</span></button>`).join("");
    this.ui.showPanel("hot", `<div class="ph"><span class="sit">HOT ROUTE · ${rec.slot.replace(/\d/, "")} ${esc(rec.name.toUpperCase())}</span><span class="side o">${cycled ? "ROUTE CHANGED" : "NEW ROUTE"}</span></div><div class="cards">${cards}</div><div class="hint">1-5 ROUTE · BACKSPACE CLOSES</div>`, {
      cls: "small", sel: Math.max(0, HOT_ROUTES.indexOf(cur)), back: () => this.ui.hidePanel(), onPick: (i) => this.app.applyHot(rec, HOT_ROUTES[i], false),
    });
  }
}
