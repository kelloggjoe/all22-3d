// Franchise rosters on the field (World options, all off by default: world.js): player identity, the bench and
// substitutions (dead balls only), fatigue and in-game injuries. Pure simulation, no DOM. The only randomness is the
// World's injury stream (w.injRng), so a seed replays the same game and an injury roll never shifts the main stream.
//
// DEPTH CHART (team.depth, from the league): { [slot]: [info, ...] } for the 22 slots + K, index 0 the starter, then
//   the backups in order; info = { pid, id, name, num, r } (r: his ratings at that slot, the fields ratingsFor returns:
//   speed accel power anchor hands arm agility toughness kick fit ghost flying kg types). A player listed at several
//   slots (one info per slot) is one player: he holds one roster slot at a time, so he's never on the field twice.
//   Without a depth chart a team plays its 23 (pid = the slot key), as before.
// SUBSTITUTIONS (option subs), at every dead ball before the next play is set up (deadBall):
//   · injury: a player who can't go gives way to the next healthy player in that slot's list, else the best healthy
//     bench player by fit for the slot (out of position: his ratings re-rated for the slot's role, rerate), else he
//     stays in at reduced ratings. A minor injury sits a few plays when there's a backup, then he plays through it.
//   · fatigue (option fatigue): at HB FB WR TE DE NT OLB ILB a player below FATIGUE.OUT gives way to a fresher backup;
//     the better-ranked man comes back once rested (FATIGUE.RETURN). QB, OL, K and DBs only when spent (FATIGUE.RARE).
//     Only the units about to take the field rotate. Special teams keep reusing whoever holds the slots, as before.
//   · the backfield (a team's usage: Franchise's league.js setUsage), in place of the fatigue rotation at HB for a team
//     that has one: its split of the designed runs between its first two backs, its red zone's back (backfield)
//   · the coach's own (PRO's Depth Chart, coach.js: coachIn / coachSwap below): a man put in at a spot goes to the top of
//     its list, so the rotation keeps him there (it brings back a better-ranked man only); the one he replaced is next.
// THE BENCH (team.bench, a played game's: sim-pro.js gameInput { bench }): the human's active players no list dresses,
//   dressed for the coach's substitutions only — the engine's own never use them (bestFit skips T.extra), so a game
//   nobody substitutes in plays exactly as without them.
// FATIGUE: energy 1 fresh → 0 spent. A snap costs a little plus the play's effort (effort(): running, blocking or
//   rushing, carrying, the hits); off the field it comes back every play, more at quarter breaks and at halftime.
//   Tired legs: speed, acceleration and agility scale with energy (rated(), applied at dead balls).
// INJURIES (option injuries: low | normal | high): a roll on every tackle for the carrier and the tackler (sacks, hit
//   sticks and pile-ups hurt more; by hit power and the player's toughness) and for a defender who gets trucked.
//   Severity → weeks out: minor 0 · short 1–2 · medium 3–6 · long 7–12 (injured reserve) · season 13+.
import { ALL_SLOTS, SLOTS_OFF, SLOTS_DEF, roleOf, speciesFit } from "./ratings.js";
import { Player } from "./entities.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const SLOTS_K = [...ALL_SLOTS, "K"];
const OFF_UNIT = [...SLOTS_OFF, "K"], KICK_UNIT = [...SLOTS_DEF, "K"];

// ---------- tuning (constants; exported for the engine tests) ----------
// fatigue: energy lost per snap = COND[slot] · (SNAP + WORK · effort); off the field +REST a play, on it +BREATH
// between plays; +QBREAK at a quarter break, +HALF at halftime. A slot in ROTATE gives way below OUT (a fresher backup:
// FRESH and GAIN more than him), anyone else below RARE; the better-ranked man returns at RETURN.
export const FATIGUE = {
  SNAP: 0.022, WORK: 0.0085, REST: 0.06, BREATH: 0.012, QBREAK: 0.12, HALF: 0.5, HIT_WORK: 1.2,
  OUT: 0.62, RARE: 0.3, RETURN: 0.86, FRESH: 0.5, GAIN: 0.2,
  // conditioning by role (data.js roleOf: a 4-3 plays its NT and ILB2 as tackles, its ILB1 as the middle linebacker;
  // the slot offense's FB is a slot receiver): backs and the defensive line work hardest; QBs, linemen, kickers least
  // (calibrated on 160 games a step over the four regions: starters' snap shares HB ≈ 72%, FB 75%, SLOT 80%, WR 90%,
  // TE 85%, DE 78%, NT 68%, DT 70%, OLB 85%, ILB 92%, MLB 96%; QB, OL, CB, S play every snap they're healthy for)
  COND: {
    QB: 0.45, HB: 1.59, FB: 1.86, SLOT: 1.36, WR: 1.0, TE: 1.33, OL: 0.5, DE: 1.57, NT: 2.86, DT: 2.24, OLB: 1.37, ILB: 1.14, MLB: 0.96,
    CB: 0.55, S: 0.5, K: 0.3,
  },
  ROTATE: new Set(["HB", "FB", "SLOT", "WR", "TE", "DE", "NT", "DT", "OLB", "ILB", "MLB"]),
};
const F = FATIGUE;
const roleAt = (T, slot) => T.role[slot] || slot;
const outE = (T, slot) => (F.ROTATE.has(roleAt(T, slot)) ? F.OUT : F.RARE);
// injuries: chance per exposure = BASE · level · role · (power / P_REF)^1.25 · frailty (· 1.5 if already hurt);
// severity from SEVERITY, shifted toward the bad end by hit power and frailty
export const INJURY_LEVELS = { low: 0.5, normal: 1, high: 2 };
// (normal ≈ 1 injury per team per game, low ≈ 0.45, high ≈ 1.8; about 60% minor, 2–3% season-ending: 1,000+ games)
export const INJURY = { BASE: 0.016, P_REF: 25, SEVERITY: [["minor", 0.66], ["short", 0.17], ["medium", 0.1], ["long", 0.05], ["season", 0.025]] };
// the weeks out each severity brings (a minor one: a few plays on the sideline, no games); a league's server checks a
// sent result's injuries against these
export const INJURY_WEEKS = { minor: [0, 0], short: [1, 2], medium: [3, 6], long: [7, 12], season: [13, 20] };
const SEV_RANK = { minor: 0, short: 1, medium: 2, long: 3, season: 4 };

// ---------- squads ----------
// w.squad[k] = { k, list: [Player] (everyone dressed, depth order), byPid, depth: {slot: [pid]}, infos: pid → {slot: info},
// pos: pid → primary slot }; w.people[k][pid] = { pid, id, name, num, pos } (names for the box score).
export function initSquads(w) {
  w.rosterVer = 0; w.sqDone = -1; w.sqQ = 1; // roster version (the renderer's bench), the dead ball handled, its quarter
  w.squad = { home: build(w, "home"), away: build(w, "away") };
  w.people = { home: {}, away: {} };
  for (const k of ["home", "away"]) for (const p of w.squad[k].list) w.people[k][p.pid] = { pid: p.pid, id: p.id, name: p.name, num: p.num, pos: w.squad[k].pos.get(p.pid) };
}
function build(w, k) {
  const t = w.teams[k], dc = t.depth && typeof t.depth === "object" ? t.depth : null;
  const T = { k, list: [], byPid: new Map(), depth: {}, infos: new Map(), pos: new Map(), fits: new Map(), rer: new Map(), role: {} };
  for (const slot of SLOTS_K) { try { T.role[slot] = roleOf(slot, t.scheme || { def: "34", off: "fb" }) || slot; } catch (_) { T.role[slot] = slot; } }
  for (const slot of SLOTS_K) {
    const ids = (T.depth[slot] = []);
    for (const info of dc && Array.isArray(dc[slot]) ? dc[slot] : []) {
      if (!info || info.pid == null || !info.r) continue;
      const pid = String(info.pid);
      if (ids.includes(pid)) continue;
      ids.push(pid);
      let m = T.infos.get(pid);
      if (!m) { T.infos.set(pid, (m = {})); T.pos.set(pid, slot); }
      if (!m[slot]) m[slot] = info;
    }
  }
  // with substitutions the whole depth chart dresses (in depth-chart order: the bench stands by position)
  if (w.subs) for (const slot of SLOTS_K) for (const pid of T.depth[slot]) dress(w, T, pid);
  // a played game's bench (the coach's only: T.extra, until he puts one in)
  T.extra = new Set();
  if (w.subs && Array.isArray(t.bench)) for (const info of t.bench) {
    if (!info || info.pid == null || !info.r || !SLOTS_K.includes(info.slot)) continue;
    const pid = String(info.pid);
    if (T.infos.has(pid)) continue;
    T.infos.set(pid, { [info.slot]: info }); T.pos.set(pid, info.slot);
    dress(w, T, pid); T.extra.add(pid);
  }
  // the starters: the first one listed at each slot who isn't already starting elsewhere; a slot with no depth list
  // keeps today's player (pid = the slot)
  for (const slot of SLOTS_K) {
    let p = null;
    for (const pid of T.depth[slot]) { const q = dress(w, T, pid); if (q.at == null) { p = q; break; } }
    if (!p && T.depth[slot].length) p = bestFit(w, T, slot); // his starter already starts elsewhere: out of position
    if (!p) { // no one listed (or no one free): today's player for the slot
      p = w.roster[k][slot];
      if (p.pid == null) p.pid = slot;
      T.byPid.set(p.pid, p); T.list.push(p); T.pos.set(p.pid, slot); T.depth[slot].push(p.pid);
      T.infos.set(p.pid, { [slot]: { pid: p.pid, id: p.id, name: p.name, num: p.num, r: p.base } });
    }
    put(w, T, slot, p);
  }
  return T;
}
// one Player per pid (his first listed slot's info)
function dress(w, T, pid) {
  let p = T.byPid.get(pid);
  if (p) return p;
  const slot = T.pos.get(pid), info = T.infos.get(pid)[slot];
  p = new Player(w.teams[T.k], T.k, { ...info, slot, pid });
  p.pos = slot;
  T.byPid.set(pid, p); T.list.push(p);
  return p;
}
// seat p at slot (his ratings for the slot's role)
function put(w, T, slot, p) {
  w.roster[T.k][slot] = p;
  p.at = slot; p.slot = slot; p.pos = slot;
  p.base = ratingsAt(w, T, p, slot);
}
function ratingsAt(w, T, p, slot) {
  const m = T.infos.get(p.pid);
  if (m && m[slot]) return m[slot].r;
  const key = p.pid + "|" + slot;
  let r = T.rer.get(key);
  if (!r) {
    const own = m ? m[T.pos.get(p.pid)] || m[Object.keys(m)[0]] : null, scheme = w.teams[T.k].scheme;
    // the league's own rating at any spot when it gives one (World option rateAt(info, slot, scheme)), else re-rated
    if (own && w.rateAt) { try { r = w.rateAt(own, slot, scheme); } catch (_) { r = null; } }
    if (!r || !Number.isFinite(r.speed)) r = rerate(own ? own.r : p.base, p.id, slot, scheme);
    T.rer.set(key, r);
  }
  return r;
}
// Out of position: his ratings re-rated for the slot's role, as ratingsFor does it — the fit-weighted ratings (power,
// anchor, hands, arm, agility, toughness: × (0.75 + 0.35·fit)) and speed (× (0.94 + 0.08·fit)) move with the new fit.
export function rerate(r, id, slot, scheme) {
  const f0 = Number.isFinite(r.fit) ? r.fit : 0.6;
  let f1 = f0;
  try { const f = speciesFit(id, slot, scheme || { def: "34", off: "fb" }); if (Number.isFinite(f)) f1 = f; } catch (_) { /* keep f0 */ }
  const q = (0.75 + 0.35 * f1) / (0.75 + 0.35 * f0), s = (0.94 + 0.08 * f1) / (0.94 + 0.08 * f0);
  return {
    ...r, fit: f1, speed: clamp(r.speed * s, 5.2, 8.9), power: clamp(r.power * q, 20, 140), anchor: clamp(r.anchor * q, 20, 140),
    hands: clamp(r.hands * q, 15, 130), arm: clamp(r.arm * q, 15, 140), agility: clamp(r.agility * q, 10, 140), toughness: clamp(r.toughness * q, 15, 160),
  };
}
// his fit for a slot: the league's own rating when the World has one (rateAt), else his species' (data.js)
function fitAt(w, T, p, slot) {
  const key = p.pid + "|" + slot;
  let f = T.fits.get(key);
  if (f == null) {
    const m = T.infos.get(p.pid), own = m ? m[T.pos.get(p.pid)] || m[Object.keys(m)[0]] : null;
    if (own && w.rateAt) { try { const r = m[slot] ? m[slot].r : w.rateAt(own, slot, w.teams[T.k].scheme); if (r && Number.isFinite(r.fit)) f = r.fit; } catch (_) { f = null; } }
    if (f == null) { try { f = speciesFit(p.id, slot, w.teams[T.k].scheme); } catch (_) { f = 0; } }
    if (!Number.isFinite(f)) f = 0;
    T.fits.set(key, f);
  }
  return f;
}
const canPlay = (p) => p.at == null && !(p.inj && p.inj.out) && p.rest <= 0;
// the next man up in the slot's list (rested enough if possible, else the freshest who can go)
function nextUp(T, slot) {
  let alt = null;
  for (const pid of T.depth[slot]) {
    const p = T.byPid.get(pid);
    if (!p || !canPlay(p)) continue;
    if (p.energy >= F.FRESH) return p;
    if (!alt || p.energy > alt.energy) alt = p;
  }
  return alt;
}
// nobody left at the spot: the best healthy bench player by fit for it (then the fresher, then depth order); never one
// of a played game's extra bench (T.extra: the coach's alone)
function bestFit(w, T, slot) {
  let best = null, bf = -1;
  for (const p of T.list) {
    if (!canPlay(p) || T.extra.has(p.pid)) continue;
    const f = fitAt(w, T, p, slot);
    if (f > bf + 1e-9 || (Math.abs(f - bf) <= 1e-9 && best && p.energy > best.energy)) { bf = f; best = p; }
  }
  return best;
}
function seat(w, T, slot, p, out, reason) {
  out.at = null;
  put(w, T, slot, p);
  w.rosterVer++;
  w.bus.emit("sub", { team: T.k, slot, out: out.pid, in: p.pid, reason });
}

// ---------- the coach's substitutions (coach.js: PRO's Depth Chart) ----------
// His man p in at slot from the bench (he can go: not out injured; a minor knock's rest is the coach's call), the one
// there to the bench; p tops the slot's list (the rotation keeps him), the man he replaced right behind him.
export function coachIn(w, k, slot, p) {
  const T = w.squad[k], cur = w.roster[k][slot];
  if (!T || p === cur || p.at != null || (p.inj && p.inj.out)) return false;
  p.rest = 0;
  T.extra.delete(p.pid);
  T.depth[slot] = [p.pid, cur.pid, ...T.depth[slot].filter((x) => x !== p.pid && x !== cur.pid)];
  seat(w, T, slot, p, cur, "coach");
  rated(w, p); rated(w, cur);
  return true;
}
// The men at two spots trade places: each tops the other's list, his ratings for the new spot (ratingsAt).
export function coachSwap(w, k, s1, s2) {
  const T = w.squad[k], R = w.roster[k], a = R[s1], b = R[s2];
  if (!T || !a || !b || a === b) return false;
  T.depth[s1] = [b.pid, ...T.depth[s1].filter((x) => x !== b.pid)];
  T.depth[s2] = [a.pid, ...T.depth[s2].filter((x) => x !== a.pid)];
  put(w, T, s1, b); put(w, T, s2, a);
  w.rosterVer++;
  w.bus.emit("sub", { team: k, slot: s1, out: a.pid, in: b.pid, reason: "coach" });
  w.bus.emit("sub", { team: k, slot: s2, out: b.pid, in: a.pid, reason: "coach" });
  rated(w, a); rated(w, b);
  return true;
}
// his ratings at a spot (the league's own at any spot, else re-rated: ratingsAt), for the panel's numbers
export const coachRatings = (w, k, p, slot) => ratingsAt(w, w.squad[k], p, slot);

// ---------- returners ----------
// A team's chosen returners (team input returners: { kr: [pid…], pr: [pid…] }, in order; without it the engine picks
// as it always has: the fastest). For a kickoff (kind "kr": the offense unit receives) or a punt ("pr": the defense
// unit), a chosen returner who isn't in that unit but can go comes in for the play, for the slowest player there who
// isn't a returner; he goes back out at the next dead ball. Returns the chosen returners now on the field, in order.
export function returners(w, k, kind) {
  const pref = w.teams[k] && w.teams[k].returners && w.teams[k].returners[kind];
  if (!w.squad || !Array.isArray(pref) || !pref.length) return [];
  const T = w.squad[k], slots = kind === "kr" ? SLOTS_OFF : SLOTS_DEF, R = w.roster[k], out = [];
  for (const id of pref.slice(0, kind === "kr" ? 2 : 1)) {
    const p = T.byPid.get(String(id));
    if (!p) continue;
    if (slots.includes(p.at)) { out.push(p); continue; }
    if (!canPlay(p)) continue;
    let slot = null, slow = Infinity;
    for (const s of slots) { const q = R[s]; if (!out.includes(q) && !pref.map(String).includes(q.pid) && q.r.speed < slow) { slow = q.r.speed; slot = s; } }
    if (!slot) continue;
    const q = R[slot];
    seat(w, T, slot, p, q, "returner");
    rated(w, p);
    (w.stSwaps || (w.stSwaps = [])).push({ k, slot, out: q, in: p });
    out.push(p);
  }
  return out;
}
// the players who came in to return a kick go back out (their men back in when they can go)
function undoReturners(w) {
  if (!w.stSwaps || !w.stSwaps.length) return;
  for (const s of w.stSwaps) {
    const T = w.squad[s.k];
    if (w.roster[s.k][s.slot] !== s.in) continue;
    const back = canPlay(s.out) ? s.out : nextUp(T, s.slot) || bestFit(w, T, s.slot);
    if (back) seat(w, T, s.slot, back, s.in, "returner");
  }
  w.stSwaps = [];
}

// ---------- dead balls ----------
// Once per dead ball, before the next play is set up: rest at the breaks, injury replacements (every slot), rotation
// for the units about to take the field (offK's offense + K and the other defense; a kickoff: offK = the kicking team,
// its defense + K and the other offense), then everyone's effective ratings.
export function deadBall(w, offK, kick) {
  if (w.sqDone === w.playNo) return;
  w.sqDone = w.playNo;
  undoReturners(w);
  if (w.quarter !== w.sqQ) {
    const gain = w.sqQ <= 2 && w.quarter >= 3 ? F.HALF : F.QBREAK;
    w.sqQ = w.quarter;
    if (w.fatigue) for (const k of ["home", "away"]) for (const p of w.squad[k].list) p.energy = Math.min(1, p.energy + gain);
  }
  for (const k of ["home", "away"]) {
    const T = w.squad[k], R = w.roster[k];
    if (w.subs) {
      for (const slot of SLOTS_K) {
        const p = R[slot];
        if (!p.inj || !(p.inj.out || p.rest > 0)) continue;
        const q = nextUp(T, slot) || bestFit(w, T, slot);
        if (q) seat(w, T, slot, q, p, "injury");
        else p.rest = 0; // nobody to go in: he plays on, hurt
      }
      const u = !kick && k === offK ? usageOf(w, k) : null;
      for (const slot of kick ? (k === offK ? KICK_UNIT : SLOTS_OFF) : k === offK ? OFF_UNIT : SLOTS_DEF) { if (u && slot === "HB") backfield(w, T, u); else rotate(w, T, slot); }
    }
    for (const slot of SLOTS_K) rated(w, R[slot]);
  }
}
function rotate(w, T, slot) {
  const cur = w.roster[T.k][slot];
  // a better-ranked man who can go (rested, with fatigue on) comes back in
  for (const pid of T.depth[slot]) {
    const p = T.byPid.get(pid);
    if (p === cur) break;
    if (p && canPlay(p) && (!w.fatigue || p.energy >= F.RETURN)) { seat(w, T, slot, p, cur, "return"); return; }
  }
  if (!w.fatigue || cur.energy >= outE(T, slot)) return;
  for (const pid of T.depth[slot]) {
    const p = T.byPid.get(pid);
    if (!p || p === cur || !canPlay(p)) continue;
    if (p.energy >= Math.max(F.FRESH, cur.energy + F.GAIN)) { seat(w, T, slot, p, cur, "fatigue"); return; }
  }
}
// ---------- the backfield ----------
// A Franchise team's usage (w.teams[k].usage, league.js setUsage; none: the fatigue rotation above, as every team
// played before it): { split?: "bell" | "70" | "60" | "50", rz?: "QB" | pid }.
// The two backs: the first two of the HB list who can go (a man hurt, resting a minor knock or on the field elsewhere
// gives his place to the next). split: the designed runs at HB between the 20s (the red zone's too when the team names
// no back there) kept near the HB1's share, the HB2 carrying the rest, a carry either way before they trade (so they
// trade series, not snaps): the back behind his share goes in; a bell cow is the HB1 every snap he can go. Tired legs
// (fatigue on): the carries are the person's call, so the back it's his turn for plays on tired (slower) and gives way
// only when he's spent (RARE), to the fresher of the two, else the freshest back behind them, till he's half rested
// (FRESH); the share catches up after. rz: inside the 20 (and on a try) the team's red-zone back is in at HB, wherever
// the split had them (from another spot he's holding too: its next man up takes it); "QB" leaves HB to the split
// (ai.js gives the QB the red zone's designed runs). Without a split the
// HB rotates as the engine's own (rotate). No randomness: the same game plays the same.
export const SPLIT_SHARE = { bell: 1, 70: 0.7, 60: 0.6, 50: 0.5 };
const SPLIT_SLACK = 0.5;
const usageOf = (w, k) => { const u = w.teams[k] && w.teams[k].usage; return u && (SPLIT_SHARE[u.split] || u.rz) ? u : null; };
// a back who can take this snap at HB (on the field there now, or free on the bench)
const goes = (p, cur) => p && !(p.inj && p.inj.out) && p.rest <= 0 && (p === cur || p.at == null);
function backfield(w, T, u) {
  const R = w.roster[T.k], cur = R.HB, bf = T.bf || (T.bf = { carries: new Map(), total: 0, out: new Set() });
  const rzBack = u.rz && u.rz !== "QB" ? T.byPid.get(String(u.rz)) : null;
  if (rzBack && w.los >= 80 && !(rzBack.inj && rzBack.inj.out) && rzBack.rest <= 0) {
    // (holding another spot, the FB's or a linebacker's he subs at: the next man there takes it, and he moves to HB)
    const at = rzBack.at, other = at != null && at !== "HB" && at !== "QB" && at !== "K" ? nextUp(T, at) || bestFit(w, T, at) : null;
    if (at === "HB" || at == null || other) {
      if (other) seat(w, T, at, other, rzBack, "usage");
      if (rzBack !== cur) seat(w, T, "HB", rzBack, cur, "usage");
      return;
    }
  }
  const share = SPLIT_SHARE[u.split];
  if (!share) { rotate(w, T, "HB"); return; } // (a red-zone back only: the engine's rotation between the 20s)
  const backs = T.depth.HB.map((pid) => T.byPid.get(pid)).filter((p) => goes(p, cur)), [lead, second] = backs;
  if (!lead) return;
  let want = lead;
  if (second && share < 1) {
    // (the HB1's carries against everyone else's at HB: a second back hurt or busy elsewhere, the next one carries his part)
    const c1 = bf.carries.get(lead.pid) || 0, ahead = c1 - share * bf.total;
    // (the man in stays in till his side of the share is a carry past the other's: trading series, not snaps)
    want = cur === second ? (ahead < -SPLIT_SLACK ? lead : second) : ahead > SPLIT_SLACK ? second : lead;
  }
  if (w.fatigue) {
    for (const p of backs) { if (p.energy < F.RARE) bf.out.add(p.pid); else if (p.energy >= F.FRESH) bf.out.delete(p.pid); }
    if (bf.out.has(want.pid)) {
      const alt = [want === lead ? second : lead, ...backs.slice(2)].filter((p) => p && p !== want && !bf.out.has(p.pid)).sort((a, b) => b.energy - a.energy)[0];
      if (alt && alt.energy >= Math.max(F.FRESH, want.energy + F.GAIN)) want = alt;
    }
  }
  if (want !== cur) seat(w, T, "HB", want, cur, "usage");
}
// the snap: who's at HB for a team with a usage, where (inside the 20?), his carries so far (the stats by player)
function backfieldSnap(w) {
  w.bfSnap = null;
  const k = w.possession, u = w.playType === "normal" ? usageOf(w, k) : null;
  if (!u) return;
  const hb = w.roster[k].HB, by = w.statsBy && w.statsBy[k];
  w.bfSnap = { k, hb, rz: w.los >= 80, call: w.call && w.call.off, ra: by ? ((by[hb.pid] || {}).ra || 0) : null };
}
// the whistle: a carry of his on a designed run counts toward the split (the red zone's not, when the team names its
// back there)
function backfieldPlay(w) {
  const s = w.bfSnap;
  w.bfSnap = null;
  if (!s || !s.call || s.call.type !== "run" || s.call.clock) return;
  const u = usageOf(w, s.k);
  if (!u || (s.rz && u.rz && u.rz !== "QB")) return;
  const by = w.statsBy && w.statsBy[s.k], carried = s.ra != null && by ? ((by[s.hb.pid] || {}).ra || 0) > s.ra : (s.call.carrier || "HB") === "HB";
  if (!carried) return;
  const T = w.squad[s.k], bf = T.bf || (T.bf = { carries: new Map(), total: 0, out: new Set() });
  bf.carries.set(s.hb.pid, (bf.carries.get(s.hb.pid) || 0) + 1);
  bf.total++;
}
// effective ratings: p.r = p.base untouched when fresh and healthy, else a scaled copy (tired legs; hurt)
export function rated(w, p) {
  const b = p.base;
  const tf = w.fatigue && p.energy < 1 ? Math.pow(1 - p.energy, 1.3) : 0;
  const ij = p.inj ? (p.inj.out ? 0.86 : 0.95) : 1, ip = p.inj ? (p.inj.out ? 0.88 : 0.96) : 1;
  if (tf === 0 && ij === 1) { p.r = b; return; }
  const e = p.effR || (p.effR = {});
  for (const key in b) e[key] = b[key];
  e.speed = b.speed * (1 - 0.1 * tf) * ij; e.accel = b.accel * (1 - 0.12 * tf) * ij; e.agility = b.agility * (1 - 0.15 * tf) * ij;
  e.power = b.power * ip; e.anchor = b.anchor * ip;
  p.r = e;
}

// ---------- plays ----------
// the snap: who's on the field this play
export function onSnap(w) { for (const p of w.players) p.lastSnap = w.playNo; backfieldSnap(w); }
// every live step (option fatigue): the effort that wears a player down — moving (sprinting most), blocking or
// rushing, carrying the ball
export function effort(w, dt) {
  const ps = w.players;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    p.work += dt * (0.3 + (p.vx * p.vx + p.vy * p.vy) * 0.022 + (p.engaged ? 0.55 : 0) + (p.hasBall ? 0.35 : 0));
  }
}
// the whistle: the snap's toll on the players who played it, rest for everyone else, the sideline clock for a minor
// injury
export function afterPlay(w) {
  const n = w.playNo;
  backfieldPlay(w);
  for (const k of ["home", "away"]) {
    const T = w.squad[k];
    for (const p of T.list) {
      if (p.lastSnap === n) { if (w.fatigue) p.energy = clamp(p.energy - (F.COND[roleAt(T, p.slot)] || 1) * (F.SNAP + F.WORK * p.work) + F.BREATH, 0, 1); }
      else { if (w.fatigue) p.energy = Math.min(1, p.energy + F.REST); if (p.rest > 0) p.rest--; }
      p.work = 0;
    }
  }
}

// ---------- hits and injuries ----------
// a tackle (physics.tackles): the carrier (a sacked QB, a hit stick, a pile-up hurt more) and the tackler
export function tackleHit(w, c, d, power, hit, gang) {
  if (w.fatigue) { c.work += F.HIT_WORK; d.work += F.HIT_WORK * 0.6; }
  if (!w.injuryLevel) return;
  const off = w.call && w.call.off;
  const sack = c.slot === "QB" && c.side === "O" && !w.passThrown && !w.losCrossed && Boolean(off) && off.type === "pass" && (w.playType === "normal" || w.playType === "two");
  const how = sack ? "sack" : hit ? "hitStick" : gang ? "pileUp" : "tackle", pile = gang ? 1.25 : 1;
  roll(w, c, power, (sack ? 1.3 : 1) * pile, how);
  roll(w, d, power, 0.45 * pile, how);
}
// a broken tackle by a truck: the defender who got run over
export function truckHit(w, d, c) {
  if (w.fatigue) d.work += F.HIT_WORK;
  if (!w.injuryLevel) return;
  roll(w, d, Math.hypot(c.vx, c.vy) * Math.log(5 + c.r.kg) * 1.4, 0.8, "truck");
}
function roll(w, p, power, mult, how) {
  const R = w.injRng, pw = clamp(power / INJURY.P_REF, 0.35, 2.6), frail = clamp(110 / ((p.base || p.r).toughness + 40), 0.6, 1.6);
  const prob = INJURY.BASE * (INJURY_LEVELS[w.injuryLevel] || 1) * mult * Math.pow(pw, 1.25) * frail * (p.inj ? 1.5 : 1);
  if (R.next() >= prob) return;
  // harder hits and frailer players get hurt worse
  const shift = clamp(pw * frail, 0.6, 1.8);
  let tot = 0;
  for (const [s, f] of INJURY.SEVERITY) tot += s === "minor" ? f : f * shift;
  let u = R.next() * tot, sev = "minor";
  for (const [s, f] of INJURY.SEVERITY) { u -= s === "minor" ? f : f * shift; if (u <= 0) { sev = s; break; } }
  const weeks = sev === "minor" ? 0 : R.int(...INJURY_WEEKS[sev]);
  if (!p.inj || SEV_RANK[sev] > SEV_RANK[p.inj.severity]) p.inj = { severity: sev, weeks, out: sev !== "minor" };
  if (!p.inj.out) p.rest = Math.max(p.rest, R.int(3, 8)); // a minor one: a few plays on the sideline (with a backup)
  rated(w, p); // hurt now: slower for the rest of the play
  const ev = { team: p.teamKey, pid: p.pid, slot: p.slot, severity: sev, weeks, playNo: w.playNo, quarter: w.quarter, clock: +w.clock.toFixed(1), how };
  w.injuries.push(ev);
  w.bus.emit("injury", ev);
}
