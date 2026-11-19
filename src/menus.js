// Screens over the field: title, team select, the draft board, pause, controls, halftime and the final.
import { TEAM_DEFS, TEAM_BY_KEY, kitsFor, autoDraft, twoWay, schemeOf, DRAFT_ORDER } from "./teams.js";
import { SNACKS, SNACK_BY_KEY, GROUPS } from "./snacks.js";
import { snackPortraits, SnackStage } from "./portraits.js";
import { RULES } from "./sim/config.js";
import { fitOf, NUMBERS } from "./sim/ratings.js";
import { cap } from "./sim/bindings.js";
import { esc, boxColors, inkOn } from "./ui.js";

export const LEVELS = [[2, "PRO"], [3, "ALL-PRO"], [4, "MASTER"], [5, "LEGEND"]];
const levelName = (d) => (LEVELS.find((x) => x[0] === d) || LEVELS[1])[1];
const qName = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function showTitle(app) {
  app.ui.showHud(false);
  app.ui.showScreen("title", `
    <div class="title cover-title">
      <img class="box" src="assets/cover.jpg" alt="Snack League: Pizza Slice hurdles a burger diving at its legs" width="1200" height="1600">
      <div class="menu">
        <h1 class="sr-only">Snack League</h1>
        <button class="mi go" data-i="0">PLAY</button>
        <button class="mi" data-i="1">HOW TO PLAY</button>
      </div>
    </div>`, {
    cls: "night-title cover-screen",
    onPick: (i) => {
      app.audio.unlock(); app.audio.sfx("select");
      if (i === 0) showSelect(app);
      else showControls(app, () => showTitle(app));
    },
  });
}

const STYLE_NAME = { air: "AIR RAID", ground: "GROUND AND POUND", blitz: "BLITZ HAPPY", trick: "TRICK PLAYS", balanced: "BALANCED" };
// team select: your colors, then the opponent; then the draft and the game options
export function showSelect(app, step = 0, pickU = null) {
  const taken = step === 1 ? pickU : null;
  const cards = TEAM_DEFS.map((d, i) => `<button class="tc ${d.key === taken ? "taken" : ""}" data-i="${i}" ${d.key === taken ? "disabled" : ""} style="--c:${d.jersey};--a:${d.accent}">
      <span class="tb"><b>${esc(d.abbr)}</b></span><span class="tn">${esc(d.name)}</span>
      <span class="ts">${STYLE_NAME[d.style] || "BALANCED"}</span></button>`).join("");
  const sel = step === 1 ? TEAM_DEFS.findIndex((d) => d.key !== pickU && d.key !== (app.lastOpp || "")) : Math.max(0, TEAM_DEFS.findIndex((d) => d.key === (app.lastUser || "harbor")));
  app.ui.showScreen("select", `<div class="sel"><div class="sh"><span class="st">${step === 0 ? "CHOOSE YOUR TEAM" : "CHOOSE YOUR OPPONENT"}</span><span class="ss">${step === 1 ? `${esc(TEAM_BY_KEY[pickU].name)} vs … · they draft from the snacks you leave` : "Pick your colors. You draft your snacks next."}</span></div><div class="tgrid">${cards}</div><div class="hint">ARROWS + ENTER · BACKSPACE GOES BACK</div></div>`, {
    cls: "dim", sel,
    back: () => (step === 0 ? showTitle(app) : showSelect(app, 0)),
    onPick: (i) => { app.audio.sfx("select"); const k = TEAM_DEFS[i].key; if (step === 0) showSelect(app, 1, k); else showDraft(app, pickU, k); },
  });
}

// ---------- the draft board ----------
// Eleven spots in an offensive formation; the 25 snacks below in their four groups. Pick a spot, pick a snack.
const SPOT_AT = {
  WR1: [9, 22], LT: [29, 22], LG: [39.5, 22], C: [50, 22], RG: [60.5, 22], RT: [71, 22], TE: [81.5, 22], WR2: [91, 40],
  QB: [50, 52], FB: [37, 80], HB: [63, 80],
};
const LABEL = { QB: "QB", HB: "HB", FB: "FB", WR1: "WR", WR2: "WR", TE: "TE", LT: "LT", LG: "LG", C: "C", RG: "RG", RT: "RT" };
const DEF_LABEL = { DE1: "DE", DE2: "DE", NT: "NT", OLB1: "OLB", OLB2: "OLB", ILB1: "ILB", ILB2: "ILB", CB1: "CB", CB2: "CB", S1: "S", S2: "S" };
const N_SPOTS = DRAFT_ORDER.length, FIRST_SNACK = N_SPOTS, ORDERED = GROUPS.flatMap((g) => SNACKS.filter((s) => s.group === g.key));
const I_AUTO = FIRST_SNACK + ORDERED.length, I_CLEAR = I_AUTO + 1, I_READY = I_AUTO + 2;
const kitOf = (d) => ({ jersey: d.jersey, accent: d.accent, helmet: d.helmet, pants: d.pants });

export function showDraft(app, pickU, pickO, st = null, focus = 0) {
  const def = TEAM_BY_KEY[pickU], scheme = schemeOf(def);
  st = st || { picks: { ...(app.lastUser === pickU && app.lastPicks ? app.lastPicks : {}) }, cur: "QB" };
  const kit = kitsFor({ kit: kitOf(def) }, { kit: kitOf(TEAM_BY_KEY[pickO]) }).home;
  const img = snackPortraits(kit);
  const by = Object.fromEntries(Object.entries(st.picks).map(([slot, k]) => [k, slot]));
  const full = DRAFT_ORDER.every((s) => st.picks[s]);
  const D = full ? twoWay(def, st.picks) : null, plays = {};
  if (D) for (const [ds, os] of Object.entries(D)) if (ds !== "K") plays[os] = DEF_LABEL[ds];
  if (D) plays[D.K] = (plays[D.K] ? plays[D.K] + " · " : "") + "K";
  const spots = DRAFT_ORDER.map((slot, i) => {
    const k = st.picks[slot], [x, y] = SPOT_AT[slot];
    return `<button class="dspot ${st.cur === slot ? "cur" : ""} ${k ? "has" : ""}" data-i="${i}" style="left:${x}%;top:${y}%" aria-label="${LABEL[slot]}${k ? `: ${esc(SNACK_BY_KEY[k].name)}` : ", empty"}">
      <span class="dimg" ${k ? `style="--g:${GROUPS.find((g) => g.key === SNACK_BY_KEY[k].group).color}"` : ""}>${k ? `<img src="${img[k]}" alt="">` : ""}</span>
      <span class="dlab">${LABEL[slot]}${plays[slot] ? `<em>${plays[slot]}</em>` : ""}</span></button>`;
  }).join("");
  const groups = GROUPS.map((g) => `<div class="dgroup" style="--g:${g.color};--gi:${g.ink}"><div class="dgh">${g.name}</div><div class="dgrid">${
    SNACKS.filter((s) => s.group === g.key).map((s) => {
      const i = FIRST_SNACK + ORDERED.indexOf(s), at = by[s.key];
      return `<button class="dsnack ${at ? "taken" : ""}" data-i="${i}" aria-label="${esc(s.name)}${at ? `, drafted at ${LABEL[at]}` : ""}"><img src="${img[s.key]}" alt="">${at ? `<b>${LABEL[at]}</b>` : ""}</button>`;
    }).join("")}</div></div>`).join("");
  const left = DRAFT_ORDER.filter((s) => !st.picks[s]).length;
  app.ui.showScreen("draft", `<div class="draft" style="--c:${kit.jersey};--a:${kit.accent}">
    <div class="sh"><span class="st">DRAFT YOUR SNACKS</span><span class="ss">${esc(def.name)} · ${left ? `${left} to go` : "Your eleven play offense and defense"}</span></div>
    <div class="dtop"><div class="dfield"><i class="los"></i>${spots}</div><div class="dcard" aria-live="polite"></div></div>
    <div class="dgroups">${groups}</div>
    <div class="dact"><button class="mi" data-i="${I_AUTO}">AUTO FILL</button><button class="mi" data-i="${I_CLEAR}">CLEAR</button><button class="mi go" data-i="${I_READY}" ${full ? "" : "disabled"}>READY</button></div>
    <div class="hint">PICK A SPOT, THEN A SNACK · PICK A FILLED SPOT AGAIN TO EMPTY IT · BACKSPACE GOES BACK</div></div>`, {
    cls: "dim draft-screen", sel: focus,
    back: () => showSelect(app, 1, pickU),
    onFocus: (i) => card(i),
    onPick: (i) => {
      if (i < N_SPOTS) {
        const slot = DRAFT_ORDER[i];
        if (st.cur === slot && st.picks[slot]) delete st.picks[slot]; else st.cur = slot;
        app.audio.sfx("blip");
      } else if (i < I_AUTO) {
        const key = ORDERED[i - FIRST_SNACK].key, prev = by[key], mine = st.picks[st.cur];
        if (prev === st.cur) return;
        st.picks[st.cur] = key;
        if (prev) { if (mine) st.picks[prev] = mine; else delete st.picks[prev]; }
        const k = DRAFT_ORDER.indexOf(st.cur);
        st.cur = [...DRAFT_ORDER.slice(k + 1), ...DRAFT_ORDER.slice(0, k + 1)].find((s) => !st.picks[s]) || st.cur;
        app.audio.sfx("select");
      } else if (i === I_AUTO) { st.picks = autoDraft(def, st.picks); app.audio.sfx("select"); }
      else if (i === I_CLEAR) { st.picks = {}; st.cur = "QB"; app.audio.sfx("blip"); }
      else { app.audio.sfx("select"); app.lastPicks = { ...st.picks }; showOptions(app, pickU, pickO, st); return; }
      showDraft(app, pickU, pickO, st, i);
    },
  });
  // the card: whoever is under the cursor (a snack on the board, or the one in a spot)
  function card(i) {
    const el = app.ui.layer.querySelector(".dcard");
    if (!el) return;
    const key = i < N_SPOTS ? st.picks[DRAFT_ORDER[i]] : i < I_AUTO ? ORDERED[i - FIRST_SNACK].key : st.picks[st.cur];
    if (!key) { el.innerHTML = `<p class="dempty">Pick a snack for <b>${LABEL[DRAFT_ORDER[i] || st.cur]}</b>.</p>`; return; }
    const s = SNACK_BY_KEY[key], g = GROUPS.find((x) => x.key === s.group), sp = s.sp;
    const bar = (label, v) => `<div class="dbar"><span>${label}</span><i><u style="width:${Math.round(Math.max(0.04, Math.min(1, (v - 30) / 110)) * 100)}%"></u></i></div>`;
    const best = DRAFT_ORDER.map((slot) => [LABEL[slot], fitOf(sp, slot, scheme)]).sort((a, b) => b[1] - a[1]).map((x) => x[0]).filter((x, j, a) => a.indexOf(x) === j).slice(0, 3);
    el.innerHTML = `<div class="dstage-wrap"></div><div class="dci"><span class="dchip" style="--g:${g.color};--gi:${g.ink}">${g.name}</span><h3>${esc(s.name)}</h3>
      <p>${esc(s.blurb)}</p>${bar("SPEED", sp.spe)}${bar("POWER", sp.atk)}${bar("BLOCKING", sp.def)}${bar("HANDS", sp.spd)}${bar("ARM", sp.spa)}
      <p class="dbest">Best at <b>${best.join(", ")}</b> · ${Math.round(sp.kg / 0.4536)} lb${by[key] ? ` · drafted at <b>${LABEL[by[key]]}</b>` : ""}</p></div>`;
    app.stage = app.stage || new SnackStage();
    el.querySelector(".dstage-wrap").append(app.stage.canvas);
    app.stage.show(key, kit, by[key] ? NUMBERS[by[key]] : "");
  }
  card(focus);
}

function showOptions(app, pickU, pickO, st) {
  const s = app.settings, U = TEAM_BY_KEY[pickU], O = TEAM_BY_KEY[pickO];
  const row = (label, val) => `<span class="ol">${label}</span><span class="ov">◀ ${val} ▶</span>`;
  app.ui.showScreen("select", `<div class="sel opts">
    <div class="sh"><span class="st">GAME OPTIONS</span><span class="ss"><b style="color:${U.accent}">${esc(U.name)}</b> vs <b style="color:${O.accent}">${esc(O.name)}</b></span></div>
    <button class="orow" data-i="0">${row("DIFFICULTY", levelName(s.difficulty))}</button>
    <button class="orow" data-i="1">${row("QUARTER LENGTH", qName(s.quarter))}</button>
    <button class="orow" data-i="2">${row("SPRINT", s.sprintMode === "toggle" ? "TOGGLE" : "HOLD")}</button>
    <button class="mi go" data-i="3">KICK OFF</button>
    <div class="hint">◀ ▶ CHANGE · ENTER ON KICK OFF · BACKSPACE GOES BACK</div></div>`, {
    cls: "dim", sel: 3,
    back: () => showDraft(app, pickU, pickO, st, N_SPOTS + ORDERED.length + 2),
    keys: [["left", () => change(-1)], ["right", () => change(1)]],
    onPick: (i) => { if (i < 3) change(1); else { app.audio.sfx("select"); app.lastUser = pickU; app.lastOpp = pickO; app.startGame(pickU, pickO, st.picks); } },
  });
  function change(d) {
    const i = app.ui.sel;
    if (i === 0) { const L = LEVELS.map((x) => x[0]); app.setSetting("difficulty", L[(L.indexOf(s.difficulty) + d + L.length) % L.length]); }
    else if (i === 1) { const Q = RULES.QUARTER_OPTS; app.setSetting("quarter", Q[(Q.indexOf(s.quarter) + d + Q.length) % Q.length]); }
    else if (i === 2) app.setSetting("sprintMode", s.sprintMode === "toggle" ? "hold" : "toggle");
    else return;
    app.audio.sfx("blip");
    const keep = i; showOptions(app, pickU, pickO, st); app.ui.focusAt(keep);
  }
}

export function showControls(app, back) {
  const r = (k, what) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${what}</td></tr>`;
  app.ui.showScreen("controls", `<div class="help">
    <div class="sh"><span class="st">HOW TO PLAY</span><span class="ss">Keyboard or gamepad. Every play starts at the play call.</span></div>
    <div class="cols">
      <table><caption>OFFENSE</caption>${r("W A S D", "Move (arrows too)")}${r(cap("sprint"), "Sprint")}${r(cap("snap"), "Snap")}${r("1-5", "Throw to that receiver (tap = bullet, hold = lob)")}${r(cap("audible"), "Audible at the line")}${r(`${cap("hotRoute")} + 1-5`, "Hot route")}${r(cap("throwAway"), "Throw it away")}</table>
      <table><caption>BALL CARRIER</caption>${r(`${cap("jukeL")} / ${cap("jukeR")}`, "Juke left / right")}${r(cap("spin"), "Spin")}${r(cap("stiff"), "Stiff arm")}${r(cap("truck"), "Truck")}${r(cap("dive"), "Dive or QB slide")}${r(cap("lateral"), "Lateral")}</table>
      <table><caption>DEFENSE</caption>${r(cap("switch"), "Switch player")}${r(cap("tackle"), "Tackle")}${r(cap("hitstick"), "Hit stick")}${r(cap("swat"), "Jump and swat")}${r("Click", "Take the defender you click")}</table>
      <table><caption>KICKING AND GAME</caption>${r(`${cap("kick")} ×3`, "Start, set power, stop in the green")}${r(cap("kickType"), "Kickoff type")}${r(cap("fairCatch"), "Fair catch")}${r(cap("timeout"), "Timeout")}${r(cap("camera"), "Change camera")}${r("ESC", "Pause")}</table>
    </div>
    <button class="mi" data-i="0">BACK</button></div>`, { cls: "dim", back, onPick: back });
}

export function showPause(app) {
  const w = app.world, cam = app.camMode === "all22" ? "ALL-22" : app.camMode.toUpperCase();
  app.ui.showScreen("pause", `<div class="pause"><div class="sh"><span class="st">PAUSED</span><span class="ss">${esc(w.teams.away.abbr)} ${w.score.away} · ${esc(w.teams.home.abbr)} ${w.score.home}</span></div>
    <div class="menu"><button class="mi" data-i="0">RESUME</button><button class="mi" data-i="1">CAMERA · ${cam}</button><button class="mi" data-i="2">HOW TO PLAY</button><button class="mi" data-i="3">QUIT TO TITLE</button></div></div>`, {
    cls: "dim", back: () => app.resume(),
    onPick: (i) => {
      if (i === 0) app.resume();
      else if (i === 1) { app.cycleCam(); showPause(app); app.ui.focusAt(1); }
      else if (i === 2) showControls(app, () => showPause(app));
      else app.quit();
    },
  });
}

function statTable(w) {
  const S = w.stats, rows = [
    ["TOTAL YARDS", (k) => S[k].passYds + S[k].rushYds], ["PASSING", (k) => `${S[k].passCmp}/${S[k].passAtt}, ${S[k].passYds} YD`], ["RUSHING", (k) => `${S[k].rushAtt} FOR ${S[k].rushYds}`],
    ["FIRST DOWNS", (k) => S[k].firstDowns], ["3RD DOWN", (k) => `${S[k].thirdConv}/${S[k].thirdAtt}`], ["TURNOVERS", (k) => S[k].ints + S[k].fumLost], ["SACKS BY", (k) => S[k === "home" ? "away" : "home"].sacks],
  ];
  return `<table class="stats"><tr><th></th><th>${esc(w.teams.away.abbr)}</th><th>${esc(w.teams.home.abbr)}</th></tr>${rows.map(([l, f]) => `<tr><td>${l}</td><td>${f("away")}</td><td>${f("home")}</td></tr>`).join("")}</table>`;
}
function scoreLine(w) {
  return `<div class="final">${["away", "home"].map((k) => `<div class="fs" style="--c:${boxColors(w.teams[k].kit)[0]};--a:${boxColors(w.teams[k].kit)[1]};--t:${inkOn(boxColors(w.teams[k].kit)[0])}"><span>${esc(w.teams[k].name)}</span><b>${w.score[k]}</b></div>`).join("")}</div>`;
}
export function showHalftime(app, w) {
  app.ui.showScreen("halftime", `<div class="half"><div class="sh"><span class="st">HALFTIME</span></div>${scoreLine(w)}${statTable(w)}<button class="mi" data-i="0">START THE SECOND HALF</button></div>`, {
    cls: "dim", onPick: () => { app.ui.clear(); w.continueHalftime(); },
  });
}
export function showResults(app, w) {
  const you = w.user, won = w.score[you] > w.score[you === "home" ? "away" : "home"], tie = w.score.home === w.score.away;
  app.ui.showScreen("results", `<div class="half"><div class="sh"><span class="st">FINAL${w.ot ? " · OT" : ""}</span><span class="ss">${tie ? "A tie." : won ? "You won." : "You lost."}</span></div>${scoreLine(w)}${statTable(w)}
    <div class="menu row"><button class="mi" data-i="0">REMATCH</button><button class="mi" data-i="1">NEW MATCHUP</button><button class="mi" data-i="2">TITLE</button></div></div>`, {
    cls: "dim",
    onPick: (i) => { if (i === 0) app.startGame(app.lastUser, app.lastOpp, app.lastPicks); else if (i === 1) { app.toTitle(); showSelect(app); } else app.toTitle(); },
  });
}
