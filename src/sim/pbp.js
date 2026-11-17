// Play-by-play (World option playByPlay): w.pbp = { plays: [...], drives: [...] }, compact enough to keep with a
// league's box scores (a full game is about 15–25 KB of JSON). Built from the World at the snap and the whistle; no
// randomness, nothing the simulation reads.
// PLAY  { n: play number · q: quarter (5 = overtime) · t: clock at the snap (s) · o: team with the ball ("home" | "away";
//   the kicking team on kickoffs and punts) · dn / tg: down and distance (scrimmage plays) · yl: the line of scrimmage
//   (yards from o's own goal line) · k: kind (run | pass | sack | kickoff | onside | punt | fg | pat | two) · x: what
//   happened, in words, with jersey numbers and names · y: yards gained (scrimmage plays) · s: scoring (TD | FG | XP |
//   2PT | SAF | D2PT: a try returned for two) · sc: [home, away] after a score · d: its drive (index into drives) }.
//   PRO calls no penalties, so there are none to log. The clock's plays are named: a spike (an incomplete pass, as the
//   stats count it) and a kneel (a QB run for a loss of a yard).
// NOTE  { n, q, t, k: "note", x, d? }: the two-minute warning (world.twoMinuteWarning), in the open drive if there is one
// DRIVE { o · q / t: when it started · yl: where · n: plays (the punt or the kick included) · yds · top: game seconds it
//   used (overtime is untimed: 0) · r: how it ended (TD | FG | MISSED FG | BLOCKED FG | PUNT | BLOCKED PUNT | INT |
//   FUMBLE | DOWNS | SAFETY | END HALF | END REG | END GAME; TURNOVER is only a safety net) · q2 / t2: when it ended }.
import { MID_Y, KICKING } from "./config.js";

const other = (k) => (k === "home" ? "away" : "home");
const nm = (p) => (p ? `#${p.num} ${p.name}` : "?");
const yd = (n) => (Math.abs(n) === 1 ? `${n} yd` : `${n} yds`);
const gain = (n) => (n === 0 ? "no gain" : n < 0 ? `a loss of ${yd(-n)}` : yd(n));
// across the field in offense coordinates: smaller y is the offense's right
const side = (dy) => (dy < -4 ? "right" : dy > 4 ? "left" : "middle");

export function create(w) {
  w.pbpS = { snap: null, open: null, g0: 0 };
  return { plays: [], drives: [] };
}
// game seconds elapsed (overtime is untimed)
const gameT = (w) => (Math.min(w.quarter, 4) - 1) * w.quarterSec + (w.quarter > 4 ? w.quarterSec : w.quarterSec - w.clock);
// a yard line as the broadcast says it: "PEW 35", "50"
function spot(w, x, o) {
  const r = Math.round(x);
  if (r === 50) return "50";
  return r < 50 ? `${w.teams[o].abbr} ${Math.max(1, r)}` : `${w.teams[other(o)].abbr} ${Math.max(1, 100 - r)}`;
}

// the snap (world.snap): the situation, and a drive opens on an offense's first scrimmage snap
export function snap(w) {
  const S = w.pbpS, o = w.possession;
  S.snap = { q: w.quarter, t: Math.round(w.clock), o, dn: w.down, tg: Math.max(1, Math.round(w.toGo)), yl: Math.round(w.los * 10) / 10, los: w.los, toGo: w.toGo, by: w.ballY, pt: w.playType, score: { ...w.score } };
  if (w.playType !== "normal" && w.playType !== "fg" && w.playType !== "punt") return;
  if (S.open && S.open.o !== o) close(w, "TURNOVER"); // (a safety net: every change of possession closes it first)
  if (!S.open) {
    S.open = { o, q: w.quarter, t: Math.round(w.clock), yl: Math.round(w.los), n: 0, yds: 0, top: 0, r: null, q2: null, t2: null };
    S.g0 = gameT(w);
    w.pbp.drives.push(S.open);
  }
}
// close the open drive (world.checkClockEnd at the half / the end of regulation, world.gameOver, or a play's result)
export function close(w, result, end) {
  const S = w.pbpS, D = S.open;
  if (!D) return;
  D.r = result;
  D.yds = Math.round((end != null ? end : w.possession === D.o ? w.los : D.yl) - D.yl);
  D.top = Math.max(0, Math.round(gameT(w) - S.g0));
  D.q2 = w.quarter; D.t2 = Math.round(w.clock);
  S.open = null;
}

// the two-minute warning (world.twoMinuteWarning): a line of its own, in the drive it stops
export function note(w, x) {
  const e = { n: w.playNo, q: w.quarter, t: Math.round(w.clock), k: "note", x };
  if (w.pbpS.open) e.d = w.pbp.drives.length - 1;
  w.pbp.plays.push(e);
}
// the whistle (end of world.endPlay, after the points went up)
export function play(w, res) {
  const S = w.pbpS, s = S.snap;
  if (!s) return;
  S.snap = null;
  // a fake punt or field goal (world.fakeGo): a scrimmage down from the snap's hands on, said as one
  const fake = w.fake && w.fake.on ? w.fake.kind : null;
  if (fake) s.pt = "normal";
  const pt = s.pt, o = s.o;
  const e = { n: w.playNo, q: s.q, t: s.t, o };
  if (pt === "normal") { e.dn = s.dn; e.tg = s.tg; }
  e.yl = s.yl;
  const gained = Math.round((res.type === "td" && res.carrierSide === "O" ? 100 : res.x) - s.yl);
  e.k = kind(w, res, pt);
  e.x = (fake ? (fake === "fg" ? "FAKE FIELD GOAL: " : "FAKE PUNT: ") : "") + describe(w, res, s, gained);
  // yards as the stats count them: a sack, a completion, a run the offense kept
  if (pt === "normal") e.y = res.sack ? gained : w.passThrown ? (w.catchSpot != null && w.ball.target && w.ball.target !== w.qb ? gained : 0) : res.carrierSide === "O" ? gained : 0;
  // scoring
  const dh = w.score.home - s.score.home, da = w.score.away - s.score.away;
  if (dh || da) {
    const pts = dh || da, team = dh ? "home" : "away";
    e.s = pts === 6 ? "TD" : pts === 3 ? "FG" : pts === 1 ? "XP" : pts === 2 ? (pt === "two" || pt === "pat" ? (team === o ? "2PT" : "D2PT") : "SAF") : "TD";
    e.sc = [w.score.home, w.score.away];
  }
  // the drive
  const D = S.open;
  if (D && D.o === o && (pt === "normal" || pt === "fg" || pt === "punt")) {
    D.n++;
    e.d = w.pbp.drives.length - 1;
    const r = driveEnd(w, res, pt, s, gained);
    if (r) close(w, r[0], r[1]);
  }
  w.pbp.plays.push(e);
}
// how a play ends its drive: [result, end spot] or null
function driveEnd(w, res, pt, s, gained) {
  if (pt === "fg") return [res.blocked ? "BLOCKED FG" : res.good ? "FG" : "MISSED FG", s.yl];
  if (pt === "punt") return [w.blockedKick ? "BLOCKED PUNT" : "PUNT", s.yl];
  if (res.type === "td" && res.carrierSide === "O") return ["TD", 100];
  if (res.type === "safety" && res.carrierSide === "O") return ["SAFETY", 0];
  if (res.carrierSide === "D" || (res.type === "touchback" && res.fumble)) return [w.intSpot != null ? "INT" : "FUMBLE", s.yl];
  if (res.fumble && res.lost) return null; // the defense took it and gave it back: same offense, a new series
  if (s.dn === 4) { // short of the line to gain on 4th down (world.advance's own test, on the exact spot)
    const sp = res.type === "incomplete" ? s.los : Math.max(0.5, Math.min(99.5, res.x));
    if (sp - s.los < s.toGo - 1e-6) return ["DOWNS", sp];
  }
  return null;
}
function kind(w, res, pt) {
  if (pt === "kickoff") return w.onside ? "onside" : "kickoff";
  if (pt !== "normal") return pt;
  if (res.sack) return "sack";
  return w.passThrown ? "pass" : "run";
}

// ---------- the words ----------
function describe(w, res, s, gained) {
  const pt = s.pt, o = s.o, d = other(o), c = res.carrier, t = res.tackler;
  const ab = (k) => w.teams[k].abbr;
  if (pt === "kickoff" || pt === "punt") return kickWords(w, res, s);
  if (pt === "fg" || pt === "pat") {
    const k = w.kicker;
    let x = pt === "fg" ? `${nm(k)} ${w.fgDist || Math.round(117 - s.yl)}-yd field goal` : `${nm(k)} extra point`;
    if (res.blocked) {
      x += ` BLOCKED by ${nm(w.kickBlocker)}`;
      if (c && c.side === "D") x += res.type === "td" ? `, returned by ${nm(c)} for a TOUCHDOWN` : `, recovered by ${ab(d)} ${nm(c)}`;
      else if (res.type === "blockRecovered") x += `, recovered by ${ab(o)}`;
      return x;
    }
    if (res.good) return x + " is GOOD" + (res.doink ? " (off the upright)" : "");
    const off = w.ball.y - MID_Y;
    return x + " is NO GOOD" + (res.short ? " (short)" : res.doink ? " (off the upright)" : Math.abs(off) >= KICKING.UPRIGHT ? (off < 0 ? " (wide right)" : " (wide left)") : "");
  }
  // scrimmage: a run, a pass, a sack (a fumble's yards: to where the offense put it on the ground)
  const off = w.call.off, qb = w.qb, fumbled = res.fumble && w.fumbleX != null ? Math.round(w.fumbleX - s.yl) : null;
  let x;
  if (res.sack) x = `${nm(c)} sacked${t ? " by " + nm(t) : ""} for ${gain(gained)}`;
  else if (w.passThrown) {
    const b = w.ball, air = b.tx - s.yl, where = `${air >= 15 ? "deep" : "short"} ${side(b.ty - s.by)}`;
    if (res.spike) x = `${nm(qb)} spikes the ball to stop the clock`;
    else if (w.thrownAway) x = `${nm(qb)} throws it away`;
    else if (w.intSpot != null) {
      x = `${nm(qb)} pass ${where} INTERCEPTED by ${nm(w.intBy)}`;
      if (c && c.side === "D" && res.type === "td") x += `, returned ${yd(Math.max(0, Math.round(w.intSpot)))}`;
      else if (c && c.side === "D" && res.type !== "touchback") x += `, returned ${yd(Math.max(0, Math.round(w.intSpot - res.x)))}${t ? ` (${nm(t)})` : ""}`;
    } else if (w.catchSpot != null && b.target && b.target !== qb) x = `${nm(qb)} pass ${where} to ${nm(b.target)} for ${gain(fumbled != null ? fumbled : gained)}${t && !res.fumble ? ` (${nm(t)})` : ""}`;
    else x = `${nm(qb)} pass incomplete ${where}${b.target ? " to " + nm(b.target) : ""}${w.swatBy ? ", broken up by " + nm(w.swatBy) : ""}`;
  } else {
    const runner = res.fumble && w.fumbleBy && w.fumbleBy.teamKey === o ? w.fumbleBy : c && c.side === "O" ? c : w.carrierDesignate || c;
    const qbDrop = off && off.type === "pass" && runner && runner.slot === "QB";
    const dir = off && off.type === "run" ? (w.runSide < 0 ? "right" : w.runSide > 0 ? "left" : "middle") : side(((runner && runner.y) || s.by) - s.by);
    if (res.kneelDown) x = `${nm(runner)} kneels`; // (the clock runs on)
    else if (qbDrop && res.fumble && !runner.ai.scramble && !w.losCrossed) x = `${nm(runner)} sacked`; // a strip sack
    else x = `${nm(runner)} ${qbDrop ? "scrambles" : "runs"} ${dir === "middle" ? "up the middle" : dir}`;
    x += ` for ${gain(fumbled != null ? fumbled : gained)}${t && !res.fumble ? ` (${nm(t)})` : ""}`;
  }
  if (res.fumble) x += `, FUMBLES${c ? `, recovered by ${c.teamKey === o ? "" : ab(c.teamKey) + " "}${nm(c)}` : ""}`;
  if (res.type === "oob" && !res.sack) x += ", out of bounds";
  if (pt === "two") return `TWO-POINT TRY: ${x}, ${res.type === "td" && res.carrierSide === "O" ? "GOOD" : "NO GOOD"}${res.type === "td" && res.carrierSide === "D" ? " (returned for two)" : ""}`;
  if (res.type === "td") x += res.carrierSide === "O" ? ", TOUCHDOWN" : `, TOUCHDOWN ${ab(d)}`;
  else if (res.type === "safety") x += ", SAFETY";
  else if (res.type === "touchback" && res.fumble) x += ", touchback";
  return x;
}
function kickWords(w, res, s) {
  const o = s.o, d = other(o), c = res.carrier, t = res.tackler, k = w.kicker, ret = c && c.side === "D" ? c : w.returner;
  const ab = (kk) => w.teams[kk].abbr;
  const tail = () => {
    let x = "";
    if (res.fumble && c) x += `, FUMBLES, recovered by ${c.teamKey === d ? "" : ab(c.teamKey) + " "}${nm(c)}`;
    if (res.type === "td") x += c && c.side === "O" ? `, TOUCHDOWN ${ab(o)}` : ", TOUCHDOWN";
    else if (res.type === "safety") x += ", SAFETY";
    return x;
  };
  const back = (from) => (res.type === "td" ? Math.round(from) : Math.round(from - res.x));
  if (s.pt === "kickoff") {
    let x = `${nm(k)} ${w.onside ? "onside kick" : w.squib ? "squib kick" : "kicks off"}`;
    if (res.type === "touchback") return x + (res.kneel ? ", downed in the end zone, touchback" : ", touchback");
    if (res.type === "kickOob" || res.type === "puntOob") return x + `, out of bounds`;
    if (res.type === "onsideRecovered") return x + `, recovered by ${ab(o)}`;
    if (res.type === "muffRecovered") return x + `, muffed by ${nm(w.returner)}, recovered by ${ab(o)}`;
    if (w.onside && ret && c === ret && !res.fumble) { // the hands team fell on it (and maybe got a step or two)
      x += `, recovered by ${ab(d)} ${nm(ret)}`;
      return x + (res.type === "td" ? `, returned ${yd(back(w.retStart))}` : ` at the ${spot(w, 100 - res.x, d)}`) + tail();
    }
    if (w.retStart != null && ret) {
      if (w.catchSpot != null && !w.onside) x += ` ${yd(Math.round(w.catchSpot - s.yl))}`;
      x += `, ${nm(ret)} returns ${yd(back(w.retStart))}`;
      if (res.type !== "td") x += ` to the ${spot(w, 100 - res.x, d)}${t ? ` (${nm(t)})` : ""}`;
    }
    return x + tail();
  }
  // punt
  if (w.blockedKick) {
    let x = `${nm(k)} punt BLOCKED by ${nm(w.kickBlocker)}`;
    if (res.type === "blockRecovered" || (c && c.side === "O")) x += `, recovered by ${ab(o)} at the ${spot(w, res.x, o)}`;
    else if (c && c.side === "D") x += res.type === "td" ? `, returned by ${nm(c)}` : `, recovered by ${ab(d)} ${nm(c)}`;
    else if (res.type === "safety") x += "";
    return x + tail();
  }
  const end = res.type === "touchback" ? 100 : w.catchSpot != null ? w.catchSpot : res.x;
  let x = `${nm(k)} punts ${yd(Math.round(Math.min(100, end) - s.yl))}`;
  // into the end zone: one let go that bounced in or came down there, one caught there and downed (a knee) or fair-caught
  if (res.type === "touchback") return x + ` into the end zone${res.kneel ? `, downed by ${nm(ret)}` : ""}, touchback`;
  if (res.type === "fairCatch" && end >= 100) return x + ` into the end zone, fair catch by ${nm(ret)}, touchback`;
  x += ` to the ${spot(w, Math.min(100, end), o)}`;
  if (res.type === "fairCatch") return x + `, fair catch by ${nm(ret)}`;
  // downed by the cover man who got to it (physics.js looseBall), or dead where it came to rest
  if (res.type === "downed") return x + (w.downedBy ? `, downed by ${nm(w.downedBy)}` : ", downed");
  if (res.type === "puntOob") return x + ", out of bounds";
  if (res.type === "muffRecovered") return x + `, muffed by ${nm(w.returner)}, recovered by ${ab(o)}`;
  if (w.retStart != null && ret) {
    x += `, ${nm(ret)} returns ${yd(back(w.retStart))}`;
    if (res.type !== "td") x += t ? ` (${nm(t)})` : "";
  }
  return x + tail();
}
