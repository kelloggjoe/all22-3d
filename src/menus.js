// Screens over the field: title, team select, pause, controls, halftime and the final.
import { TEAM_DEFS, TEAM_BY_KEY, makeTeam } from "./teams.js";
import { RULES } from "./sim/config.js";
import { cap } from "./sim/bindings.js";
import { esc } from "./ui.js";

export const LEVELS = [[2, "PRO"], [3, "ALL-PRO"], [4, "MASTER"], [5, "LEGEND"]];
const levelName = (d) => (LEVELS.find((x) => x[0] === d) || LEVELS[1])[1];
const qName = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const CARDS = new Map();
const cardTeam = (key) => { if (!CARDS.has(key)) CARDS.set(key, makeTeam(TEAM_BY_KEY[key])); return CARDS.get(key); };

export function showTitle(app) {
  app.ui.showHud(false);
  app.ui.showScreen("title", `
    <div class="title">
      <div class="logo"><span class="l1">ALL-22</span><span class="l2">3D</span></div>
      <div class="tag">Eleven on eleven. Call the play, then play it.</div>
      <div class="menu">
        <button class="mi" data-i="0">PLAY</button>
        <button class="mi" data-i="1">HOW TO PLAY</button>
      </div>
      <div class="foot">Player models and animations: Quaternius (CC0)</div>
    </div>`, {
    cls: "dim",
    onPick: (i) => { app.audio.unlock(); app.audio.sfx("select"); if (i === 0) showSelect(app); else showControls(app, () => showTitle(app)); },
  });
}

// team select: your team, then the opponent, then the game options
export function showSelect(app, step = 0, pickU = null, pickO = null) {
  const s = app.settings;
  if (step < 2) {
    const taken = step === 1 ? pickU : null;
    const cards = TEAM_DEFS.map((d, i) => {
      const t = cardTeam(d.key), r = t.ratings;
      return `<button class="tc ${d.key === taken ? "taken" : ""}" data-i="${i}" ${d.key === taken ? "disabled" : ""} style="--c:${d.jersey};--a:${d.accent}">
        <span class="tb"><b>${esc(d.abbr)}</b><i>${t.ovr}</i></span><span class="tn">${esc(d.name)}</span>
        <span class="tr"><em>PASS ${r.pass}</em><em>RUN ${r.rush}</em><em>DEF ${r.def}</em><em>SPD ${r.speed}</em></span>
        <span class="ts">${esc(d.style === "air" ? "AIR RAID" : d.style === "ground" ? "GROUND AND POUND" : d.style === "blitz" ? "BLITZ HAPPY" : d.style === "trick" ? "TRICK PLAYS" : "BALANCED")}</span></button>`;
    }).join("");
    const sel = step === 1 ? TEAM_DEFS.findIndex((d) => d.key !== pickU && d.key !== (app.lastOpp || "")) : Math.max(0, TEAM_DEFS.findIndex((d) => d.key === (app.lastUser || "harbor")));
    app.ui.showScreen("select", `<div class="sel"><div class="sh"><span class="st">${step === 0 ? "CHOOSE YOUR TEAM" : "CHOOSE YOUR OPPONENT"}</span><span class="ss">${step === 1 ? `${esc(TEAM_BY_KEY[pickU].name)} vs …` : "You play the home side"}</span></div><div class="tgrid">${cards}</div><div class="hint">ARROWS + ENTER · BACKSPACE GOES BACK</div></div>`, {
      cls: "dim", sel,
      back: () => (step === 0 ? showTitle(app) : showSelect(app, 0)),
      onPick: (i) => { app.audio.sfx("select"); const k = TEAM_DEFS[i].key; if (step === 0) showSelect(app, 1, k); else showSelect(app, 2, pickU, k); },
    });
    return;
  }
  const U = TEAM_BY_KEY[pickU], O = TEAM_BY_KEY[pickO];
  const row = (label, val) => `<span class="ol">${label}</span><span class="ov">◀ ${val} ▶</span>`;
  app.ui.showScreen("select", `<div class="sel opts">
    <div class="sh"><span class="st">GAME OPTIONS</span><span class="ss"><b style="color:${U.accent}">${esc(U.name)}</b> vs <b style="color:${O.accent}">${esc(O.name)}</b></span></div>
    <button class="orow" data-i="0">${row("DIFFICULTY", levelName(s.difficulty))}</button>
    <button class="orow" data-i="1">${row("QUARTER LENGTH", qName(s.quarter))}</button>
    <button class="orow" data-i="2">${row("SPRINT", s.sprintMode === "toggle" ? "TOGGLE" : "HOLD")}</button>
    <button class="mi go" data-i="3">KICK OFF</button>
    <div class="hint">◀ ▶ CHANGE · ENTER ON KICK OFF · BACKSPACE GOES BACK</div></div>`, {
    cls: "dim", sel: 3,
    back: () => showSelect(app, 1, pickU),
    keys: [["left", () => change(-1)], ["right", () => change(1)]],
    onPick: (i) => { if (i < 3) change(1); else { app.audio.sfx("select"); app.lastUser = pickU; app.lastOpp = pickO; app.startGame(pickU, pickO); } },
  });
  function change(d) {
    const i = app.ui.sel;
    if (i === 0) { const L = LEVELS.map((x) => x[0]); app.setSetting("difficulty", L[(L.indexOf(s.difficulty) + d + L.length) % L.length]); }
    else if (i === 1) { const Q = RULES.QUARTER_OPTS; app.setSetting("quarter", Q[(Q.indexOf(s.quarter) + d + Q.length) % Q.length]); }
    else if (i === 2) app.setSetting("sprintMode", s.sprintMode === "toggle" ? "hold" : "toggle");
    else return;
    app.audio.sfx("blip");
    const keep = i; showSelect(app, 2, pickU, pickO); app.ui.focusAt(keep);
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
  return `<div class="final">${["away", "home"].map((k) => `<div class="fs" style="--c:${w.teams[k].kit.jersey};--a:${w.teams[k].kit.accent}"><span>${esc(w.teams[k].name)}</span><b>${w.score[k]}</b></div>`).join("")}</div>`;
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
    onPick: (i) => { if (i === 0) app.startGame(app.lastUser, app.lastOpp); else if (i === 1) { app.toTitle(); showSelect(app); } else app.toTitle(); },
  });
}
