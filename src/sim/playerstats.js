// Stats by player (World option playerStats): w.statsBy[team][pid], one line per player who took a snap or got a
// stat. The slot-keyed w.pstats (world.js recordStats, the existing UI) keeps crediting whoever holds the slot.
//
// LINE: everything pstats has — pa pc py ptd pint (passing) · ra ry rtd (rushing) · rec recy rectd (receiving) · tkl
//   sck int (defense) · ret rety (kick and punt returns) — plus tgt (targets) · lr / lc (longest rush / catch, null
//   until one) · sk sky (sacked, yards lost) · td (touchdowns scored, any kind) · fum fuml (fumbles, lost) · pd
//   (passes defended: batted down) · stt (special-teams tackles: a kick or punt returner brought down) · blk (kicks
//   blocked) · hs (hit sticks landed by a human) · fgm fga lfg (field goals, longest) · xpm xpa · kick (kicking points)
//   · pu puy p20 (punts, gross yards, inside the 20) · so sd sst (snaps on offense, defense, special teams) · two
//   (two-point tries converted: the passer and the receiver, or the runner) · hsk (half sacks: a sack shared with a
//   second defender, half to each — his sacks are sck + hsk / 2: sacksOf) · tfl (tackles for a loss: a runner or a
//   receiver brought down behind the line; a sack is its own) · prs (pressures: his sacks, full or half, and the
//   throws he hurried — the nearest defender, not blocked, within PASS_RUSH.PRESS of the QB as he let it go) · itd
//   (interceptions returned for a touchdown) · ftd (fumbles and blocked kicks returned for one) · krt prt (kickoff and
//   punt returns for one). The touchdown kinds are among his td too.
// And since 2026-10-29 (the blockers' line and the takeaways' — Franchise's OL stats and its Defensive Player of the
//   Game read them; ALL-22 PRO's own screens don't):
//   pan   pancakes: his block put his man on the ground (physics.js tryEngage's pancake), on any play but a two-point try
//   bt    block tries: the scrimmage downs on which he blocked a defender for his team's ball carrier or passer — engaged
//         as the blocker, his team with the ball (the offense: a return's blocks after a takeaway are the other side's,
//         and kicks aren't scrimmage downs) — one a down, however many men he took on
//   bw    block wins: those of his tries in which none of the men he blocked that down made the tackle, a sack (half of
//         one too) or a pressure (hurried the throw: prs below), nor got by him to the ball (a tackle attempt on his
//         team's ball carrier, missed or not). Block win % = bw / bt
//   sa    sacks allowed: the sacker (the tackler of a sack: prs and sck / hsk) was last blocked by him that down — engaged
//         when he made it, or beaten before. Nobody's when the sacker came unblocked; a shared sack's partner's blocker
//         gets a pressure allowed, not a sack
//   prsa  pressures allowed: the same for every pressure — a sack's tackler and its partner, the man who hurried a throw
//   ff    forced fumbles: the tackle that knocked the ball loose was his (physics.js fumble's `by`), on any play but a try
//   fr    fumble recoveries: he fell on a loose ball that had been fumbled (his own team's or the other team's; a muffed
//         kick isn't a fumble), on any play but a try
//   pbs   pass-block snaps: the dropbacks on which he was in pass protection — a scrimmage down whose call was a pass
//         (play action and screens too; not a spike, a kneel or a two-point try; a fake punt's or field goal's pass from
//         its snap's hands on), his job at the snap a pass block (or a screen's pass set); counted however the down
//         ended: a completion, a sack, a scramble, a pick. A back or a tight end who checks before his route isn't
//         counted (his job is the route). Sacks allowed per pass-block snap: sa / pbs
//   Σsa ≤ the other team's sacks (the rest came unblocked) and Σprsa ≤ the other team's Σprs; Σff ≤ the other team's
//   fum. None of them has a team total (TOTALS).
// A TWO-POINT TRY isn't a play from scrimmage in the stats (world.js recordTwo, as in the NFL): no attempts, yards,
//   touchdowns, sacks, picks, tackles or fumbles; only the conversion (two). Its snap still counts as a snap.
// TEAM TOTALS: credit() mirrors world.js recordStats / endPlay increment for increment, so every team total with a
//   player counterpart is the sum of the players': passAtt Σpa · passCmp Σpc · passYds Σpy · passTD Σptd · ints Σpint ·
//   rushAtt Σra · rushYds Σry · rushTD Σrtd · sacks Σsk · sackYds Σsky · fumLost Σfuml · rets Σret · retYds Σrety · punts
//   Σpu · fgAtt Σfga · fgMade Σfgm · patAtt Σxpa · patMade Σxpm · swats Σpd · kicksBlocked Σblk · hitSticks Σhs · tds Σtd;
//   and the other team's sacks = Σ(sck + hsk / 2), its ints = Σint. Two credits are fixed against pstats: an
//   interception goes to the defender who made it (pstats: whoever has the ball at the whistle), and a sack with no
//   tackler (the QB run out of bounds or down in his end zone) to the nearest defender.
import { PASS_RUSH } from "./config.js";
const other = (k) => (k === "home" ? "away" : "home");
const newLine = () => ({
  pa: 0, pc: 0, py: 0, ptd: 0, pint: 0, sk: 0, sky: 0, ra: 0, ry: 0, rtd: 0, lr: null, rec: 0, recy: 0, rectd: 0, tgt: 0, lc: null, td: 0, fum: 0, fuml: 0,
  tkl: 0, sck: 0, int: 0, pd: 0, stt: 0, blk: 0, hs: 0, ret: 0, rety: 0, fgm: 0, fga: 0, lfg: null, xpm: 0, xpa: 0, kick: 0, pu: 0, puy: 0, p20: 0,
  so: 0, sd: 0, sst: 0, two: 0, hsk: 0, tfl: 0, prs: 0, itd: 0, ftd: 0, krt: 0, prt: 0,
  pan: 0, bt: 0, bw: 0, sa: 0, prsa: 0, ff: 0, fr: 0, pbs: 0,
});
// a line's sacks, half sacks included (a line or a slot's pstats)
export const sacksOf = (l) => (l.sck || 0) + (l.hsk || 0) / 2;
// The man a sack is shared with: another defender within PASS_RUSH.HALF of the QB at the whistle, not blocked and on his
// feet (the nearest), or null — the tackler's alone. (world.js recordStats asks it too, for the slot's line.)
export function halfPartner(w, qb, t) {
  if (!PASS_RUSH.HALF || !qb || !t) return null;
  let best = null, bd = PASS_RUSH.HALF;
  for (const d of w.def) {
    if (d === t || d.engaged || d.down > 0) continue;
    const dd = d.distTo(qb.x, qb.y);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}
// A pass as it leaves the QB's hand (physics.js throwTo, ai.js throwAway): the nearest defender within PASS_RUSH.PRESS
// of him who isn't blocked hurried it (w.hurry: his pressure, credit() at the whistle)
export function hurried(w, qb) {
  let best = null, bd = PASS_RUSH.PRESS;
  if (qb) for (const d of w.def) {
    if (d.engaged || d.down > 0) continue;
    const dd = d.distTo(qb.x, qb.y);
    if (dd < bd) { bd = dd; best = d; }
  }
  w.hurry = best;
}
export const LINE_KEYS = Object.keys(newLine());
export function line(w, team, p) {
  const T = w.statsBy[team];
  return T[p.pid] || (T[p.pid] = newLine());
}
const longest = (cur, v) => (cur == null ? v : Math.max(cur, v));

// the snap: who played it (offense, defense, special teams); the down's blocks start over (the blockers' lines)
export function snapped(w) {
  const scrim = w.playType === "normal" || w.playType === "two";
  for (const p of w.players) { const L = line(w, p.teamKey, p); if (!scrim) L.sst++; else if (p.side === "O") L.so++; else L.sd++; }
  const B = w.psBlocks || (w.psBlocks = { men: new Map(), last: new Map(), tried: new Set() });
  B.men.clear(); B.last.clear(); B.tried.clear();
}
// a fumble (physics.js fumble): his fumble, and the tackle that forced it (by: the tackler)
export function fumbled(w, p, by) {
  if (w.playType === "two") return;
  line(w, p.teamKey, p).fum++;
  if (by && by.teamKey !== p.teamKey) line(w, by.teamKey, by).ff++;
}
// The blockers' lines (bt bw sa prsa pan; physics.js calls these with player stats on). A block taken on (tryEngage):
// on a scrimmage down, the offense's man blocking for its ball carrier or passer — the men he took on, and each man's
// last blocker (who gave up a sack or a pressure)
export function engaged(w, bl, d) {
  const B = w.psBlocks;
  if (!B || w.playType !== "normal" || bl.side !== "O") return;
  let men = B.men.get(bl);
  if (!men) B.men.set(bl, (men = new Set()));
  men.add(d); B.last.set(d, bl);
}
export function pancaked(w, bl) { if (w.playType !== "two") line(w, bl.teamKey, bl).pan++; }
// a tackle attempt (physics.js tackles): on a scrimmage down, a defender who got to the offense's ball carrier
export function tried(w, d, c) { const B = w.psBlocks; if (B && w.playType === "normal" && c.side === "O" && d.side === "D") B.tried.add(d); }
// a fumble fallen on (physics.js looseBall)
export function recovered(w, p) { if (w.playType !== "two") line(w, p.teamKey, p).fr++; }
// the down's blocks at the whistle: a try for each man who blocked, a win unless one of his men made a play (losers:
// the defenders who got to the ball, made the tackle, a sack or a pressure); the sackers' and the hurrier's last
// blockers gave them up. sackers: [the tackler, his partner] of a sack
function blocks(w, res, sackers) {
  // pass-block snaps (pbs): a dropback's men in pass protection, whatever came of it
  const call = w.call.off;
  if (call && call.type === "pass" && !call.clock) for (const p of w.off) { const a = p.as; if (a && a.kind === "block" && (a.block === "pass" || a.block === "screen")) line(w, w.possession, p).pbs++; }
  const B = w.psBlocks;
  if (!B || (!B.men.size && !B.last.size)) return;
  const ok = w.possession, dk = other(ok), losers = new Set(B.tried);
  if (res.tackler && res.carrierSide === "O") losers.add(res.tackler);
  for (const s of sackers) if (s) losers.add(s);
  const hurry = !sackers.length && w.passThrown && w.hurry && w.hurry.teamKey === dk ? w.hurry : null;
  if (hurry) losers.add(hurry);
  for (const [bl, men] of B.men) {
    const L = line(w, ok, bl);
    L.bt++;
    let won = true;
    for (const d of men) if (losers.has(d)) { won = false; break; }
    if (won) L.bw++;
  }
  const allowed = (d, sack) => { const bl = d && B.last.get(d); if (!bl) return; const L = line(w, ok, bl); L.prsa++; if (sack) L.sa++; };
  if (sackers.length) { allowed(sackers[0], true); allowed(sackers[1], false); }
  if (hurry) allowed(hurry, false);
}

// the whistle (world.endPlay, right after recordStats)
export function credit(w, res) {
  const ok = w.possession, dk = other(ok), pt = w.playType, c = res.carrier;
  if (pt === "two") creditTwo(w, res);
  else if (pt === "normal") {
    const gained = Math.round((res.type === "td" && res.carrierSide === "O" ? 100 : res.x) - w.los);
    if (res.sack) {
      const q = line(w, ok, c); q.sk++; q.sky += -gained;
      const t = res.tackler || nearest(w.def, c), h = res.tackler ? halfPartner(w, c, t) : null;
      if (t) { const T = line(w, dk, t); T.prs++; if (h) { T.hsk++; const H = line(w, dk, h); H.hsk++; H.prs++; } else T.sck++; }
      blocks(w, res, t ? [t, h] : []);
      return; // (recordStats stops at a sack too)
    }
    blocks(w, res, []);
    if (w.passThrown) {
      const qb = w.qb || w.roster[ok].QB, q = line(w, ok, qb);
      q.pa++;
      if (w.hurry && w.hurry.teamKey === dk) line(w, dk, w.hurry).prs++;
      const rec = w.catchSpot != null ? w.ball.target : null;
      if (rec && rec !== w.qb) {
        q.pc++; q.py += gained;
        const r = line(w, ok, rec); r.rec++; r.recy += gained; r.lc = longest(r.lc, gained);
        if (res.type === "td" && res.carrierSide === "O") { q.ptd++; r.rectd++; }
      }
      if (w.intSpot != null) { q.pint++; const i = w.intBy || (c && c.side === "D" ? c : null); if (i) line(w, dk, i).int++; }
      const tg = w.ball.target;
      if (tg && !w.thrownAway && tg !== w.qb && tg.teamKey === ok) line(w, ok, tg).tgt++;
    } else if (c && res.carrierSide === "O") {
      // the run is the runner's: a fumble his own side fell on stays his carry, not the recoverer's
      const runner = res.fumble && w.fumbleBy && w.fumbleBy.teamKey === ok ? w.fumbleBy : c;
      const r = line(w, ok, runner); r.ra++; r.ry += gained; r.lr = longest(r.lr, gained);
      if (res.type === "td") r.rtd++;
    }
    if (res.tackler && res.carrierSide === "O") {
      const T = line(w, dk, res.tackler); T.tkl++;
      if (gained < 0 && !(w.call.off && w.call.off.clock)) T.tfl++; // (a loss: behind the line; a kneel isn't one)
    }
    if (res.fumble && res.lost) fumLost(w, res.carrierSide === "O" ? dk : ok);
  }
  const kick = pt === "kickoff" || pt === "punt";
  if (kick && c && c.side === "D" && w.retStart != null && !w.blockReturn) { const r = line(w, dk, c); r.ret++; r.rety += res.retYds; }
  if (kick && res.fumble && res.lost && res.carrierSide === "O") fumLost(w, dk);
  if (kick && res.tackler && c && c.side === "D" && res.tackler.teamKey === ok) line(w, ok, res.tackler).stt++;
  // kicking and punting: whoever kicked it (world.endPlay counts field goals and extra points, launchKick punts)
  const k = w.kicker;
  if (k && pt === "fg" && (res.type === "fg" || res.blocked)) { const L = line(w, ok, k); L.fga++; if (res.good) { L.fgm++; L.kick += 3; L.lfg = longest(L.lfg, w.fgDist); } }
  if (k && pt === "pat") { const L = line(w, ok, k); L.xpa++; if (res.good) { L.xpm++; L.kick++; } }
  if (k && pt === "punt" && w.kicked) {
    const L = line(w, ok, k);
    L.pu++;
    if (!w.blockedKick) {
      const end = res.type === "touchback" ? 100 : w.catchSpot != null ? w.catchSpot : res.x;
      L.puy += Math.round(Math.min(100, end) - w.los);
      if (res.type !== "touchback" && res.type !== "td" && res.carrierSide === "D" && res.x > 80) L.p20++;
    }
  }
  if (w.blockedKick && w.kickBlocker) line(w, dk, w.kickBlocker).blk++;
  if (w.swatted && w.swatBy) line(w, dk, w.swatBy).pd++;
  if (res.type === "td" && pt !== "two" && pt !== "pat" && c) {
    const L = line(w, res.carrierSide === "O" ? ok : dk, c);
    L.td++;
    // the touchdowns that aren't the offense's own: a fumble recovered from the other team (or a blocked kick picked up)
    // and taken in, an interception returned, a kickoff or a punt returned
    if (res.fumble && res.lost) L.ftd++;
    else if (res.carrierSide === "D" && !res.fumble) {
      if (w.blockReturn) L.ftd++;
      else if (pt === "normal") { if (w.intSpot != null) L.itd++; }
      else if (pt === "kickoff") L.krt++;
      else if (pt === "punt") L.prt++;
    }
  }
}
// a two-point try converted: the passer and his receiver, or the runner (world.js recordTwo, credit for credit)
function creditTwo(w, res) {
  if (res.sack || res.type !== "td" || res.carrierSide !== "O") return;
  const ok = w.possession, c = res.carrier, rec = w.passThrown && w.catchSpot != null ? w.ball.target : null;
  if (rec && rec !== w.qb) { line(w, ok, w.qb || w.roster[ok].QB).two++; line(w, ok, rec).two++; } else if (c) line(w, ok, c).two++;
}
// a fumble lost by team (the last man to put it on the ground)
function fumLost(w, team) {
  const f = w.fumbleBy;
  if (f && f.teamKey === team) line(w, team, f).fuml++;
}
function nearest(list, c) {
  let best = null, bd = 1e9;
  if (c) for (const d of list) { const dd = d.distTo(c.x, c.y); if (dd < bd) { bd = dd; best = d; } }
  return best;
}
// The sums the team totals must equal: [team stat, player key (or a line's value: sacksOf), whose players] (true = the
// other team's)
export const TOTALS = [
  ["passAtt", "pa"], ["passCmp", "pc"], ["passYds", "py"], ["passTD", "ptd"], ["ints", "pint"], ["rushAtt", "ra"], ["rushYds", "ry"],
  ["rushTD", "rtd"], ["sacks", "sk"], ["sackYds", "sky"], ["fumLost", "fuml"], ["rets", "ret"], ["retYds", "rety"], ["punts", "pu"],
  ["fgAtt", "fga"], ["fgMade", "fgm"], ["patAtt", "xpa"], ["patMade", "xpm"], ["swats", "pd"], ["kicksBlocked", "blk"], ["hitSticks", "hs"],
  ["tds", "td"], ["sacks", sacksOf, true], ["ints", "int", true],
];
