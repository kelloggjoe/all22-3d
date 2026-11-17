// Event bus: the contract between the simulation (world/physics/ai) and everything that reacts to it
// (fx, audio, hud/ui, replay, camera, play art). Each World owns a bus (createBus); the live game's reactors attach to
// it once per match via their attach(bus, w, app) functions (see main.js wire()). The title-screen attract game's bus
// has no reactors (silent flyover). Listeners are isolated: a throwing listener is logged once per event type and
// recorded in bus.errors (exposed via __game.errors) — it can never break the sim or the other listeners.
//
// PAYLOADS (field coords are offense-relative: x = yards from the offense's own goal line, y = 0..FIELD_W;
// `player`/`carrier`/… are live Player objects — read them, don't keep them past the match; p.pid is the player's id in a
// franchise world (squad.js), p.slot the spot he's playing):
//   phase        { phase }                                   world.setPhase: init|coin|playcall|presnap|live|dead|pat|halftime|over
//   coinTossStart{ kind, caller }                            coin toss begins (kind "start"|"ot"); phase "coin". If the
//                                                            human is the caller (waitUser "coin"), the UI may show
//                                                            HEADS/TAILS → world.action("coinCall", {call, choice?});
//                                                            no call within TIMING.COIN_SEC → called at random
//                                                            (set world.coinHold = true to wait for the call).
//   coinToss     { kind, winner, choice, call, result, caller, receiver, auto, pending? }   the toss result (choice
//                                                            "receive"|"defer"|"kick"; receiver = who gets the kickoff).
//                                                            pending: the human won and chooses now (choice / receiver
//                                                            null, waitUser "coinChoice" → action("coinChoice", {choice}))
//   coinChoice   { kind, winner, choice, receiver }          the human winner's choice (after a pending coinToss)
//   playCall     { down, toGo, los, waitUser, two? }         play-call phase begins (waitUser "call" = the user must pick)
//   presnap      { off, def }                                both calls set (play objects from playbook.js)
//   audible      { play }                                    offense audible applied
//   hotRoute     { slot, route }                             receiver route changed at the line
//   snap         { play } | { kick: true, type? }            ball snapped (kick: special-teams snap; type = kickoff type)
//   kickoff      { team, setup: true, type }                 kickoff set up (team = kicking team key; type normal|squib|onside)
//   specialCall  { call, value, team }                       special-teams call made: call "kickType" (normal|squib|
//                                                            onside) or "returnLane" (middle|left|right) — world.specialCalls()
//   punt         { setup: true, block } | { player }         punt formation set up (block: the return team sells out
//                                                            for the block) | punter kicked it
//   pat          { setup: true }                             PAT kick formation set up
//   fieldGoalSetup { setup: true }                           field-goal formation set up
//   kick         { kind, power, accuracy, player, type?, blocked? }  ball kicked (kind kickoff|punt|fg|pat)
//   kickBlocked  { kind, player, kicker }                    punt / FG / PAT blocked (player = the blocker); the ball
//                                                            is loose behind the line — "recover" {scoop} if the rush
//                                                            picks it up and runs with it
//   return       { player }                                  returner caught a kick and is returning it
//   fairCatch    { player }                                  fair catch made
//   kneel        { player }                                  returner took a knee in his end zone (→ touchback)
//   touchback    { kneel? }
//   handoff      { player, keep?, pitch?, flea? }            ball handed/pitched (keep: QB keeps it on the read option)
//   pitch        { player, to, flea?, lateral? }             toss / flea-flicker / user lateral launched
//   flicker      { player }                                  flea flicker: the QB has it back and can throw
//   throw        { qb, target, ball, lob, dist } | { qb, target: null, ball, away: true }  pass / throw-away
//   catch        { player, kick? }                           completed catch (kick: caught a kick)
//   drop         { player }                                  receiver dropped it
//   incomplete   { swat? , drop?, overthrow? }               pass falls incomplete
//   interception { player, qb }
//   jump         { player }                                  a defender leaps (swat attempt / kick-block leap)
//   swat         { player, receiver? }                       a pass batted down — ONCE per ball (the leap itself is "jump")
//   block        { blocker, defender }                       blocker engaged
//   shed         { blocker, defender }                       defender shed the block
//   pancake      { blocker, defender }
//   tackleAttempt{ tackler, carrier }
//   tackle       { tackler, carrier, power, fumble? }        carrier brought down (power ≈ impact, 0..~20)
//   brokenTackle { tackler, carrier, move }
//   hitStick     { player } | { tackler, carrier, power, boom: true }   move start | landed big hit
//   juke | spin | dive | slide | stiffArm  { player }        ball-carrier / defender move started
//   truck        { player, defender?, failed? }              (no defender = move start)
//   fumble       { player, by? , muff? }                     ball out (muff: dropped kick)
//   recover      { player, scoop? }                          loose ball recovered (scoop: a blocked kick picked up)
//   turnover     { kind }                                    kind int|downs|onside|muff|fumble (a kick return fumbled away)
//   sack         { qb, tackler }
//   outOfBounds  { player }
//   switch       { player }                                  user's controlled player changed
//   whistle      { result }                                  play over: result = { type, x, carrierSide, carrier, playType,
//                                                            sack?, fumble?, lost?, retYds?, stop, blocked?, doink?,
//                                                            kneel?, short?, kick?: {dist, power, acc}, … } (world.endPlay)
//   firstDown    { team }
//   touchdown    { team, scorer, defensive, blocked? }
//   fieldGoal    { good, distance, team, blocked?, doink?, short? }   (doink: off an upright / the crossbar)
//   patChoice    { team }                                    try choice pending (kick or go for two)
//   patResult    { good, team, blocked?, doink?, defensive? }  (defensive: a blocked PAT returned for 2 the other way)
//   twoPoint     { setup: true } | { good, team, defensive? }
//   safety       { team }                                    team that scored: the defense, or the kicking / passing team
//                                                            (a returner / interceptor downed in his own end zone)
//   scoreChange  { team, pts, kind, score }
//   possession   { team }
//   timeout      { team, left }                              left: the team's timeouts left. In a game with a human in it
//                                                            the wait starts (world.timeoutWait: RULES.TIMEOUT_SEC)
//   timeoutEnd   { team }                                    the wait is over: the play clock runs, the ball can be snapped
//   quarterEnd   { q }
//   halftime     {}
//   overtime     {}                                          then a fresh coin toss (coinTossStart {kind: "ot"}); modified
//                                                            sudden death: a TD or safety ends it; a FG on the first
//                                                            possession gets answered; tie after 2 possessions each
//   gameOver     { winner, score }
//   sub          { team, slot, out, in, reason }             franchise worlds (world.js options): a substitution at a dead
//                                                            ball (out / in = pids; reason "injury" | "fatigue" | "return")
//   injury       { team, pid, slot, severity, weeks, playNo, quarter, clock, how }   a player hurt (severity "minor" |
//                                                            "short" | "medium" | "long" | "season"; how "tackle" | "sack" |
//                                                            "hitStick" | "pileUp" | "truck"); also listed in w.injuries
//   takeover     { team, human }                             world.takeOver applied at a dead ball (team: the human's
//                                                            side, null = the autopilot plays both)
//   replayStart  {} / replayEnd {}                           emitted by main.js (replay.js) around instant replays
//   badge        { badge }                                   league badge earned (main.js finishGame)
//   "*"          listener receives every event as (payload, type)
export function createBus() {
  const map = new Map();
  const logged = new Set();
  const bus = {
    muted: false,
    errors: [],
    on(type, fn) {
      if (!map.has(type)) map.set(type, []);
      map.get(type).push(fn);
      return () => bus.off(type, fn);
    },
    off(type, fn) {
      const l = map.get(type);
      if (!l) return;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    emit(type, payload) {
      if (bus.muted) return;
      const p = payload || {};
      const l = map.get(type);
      if (l) for (let i = 0; i < l.length; i++) call(l[i], p, type);
      const any = map.get("*");
      if (any) for (let i = 0; i < any.length; i++) call(any[i], p, type);
    },
    clear() { map.clear(); },
  };
  function call(fn, p, type) {
    try { fn(p, type); } catch (e) {
      if (bus.errors.length < 50) bus.errors.push(`listener "${type}": ${e && e.message ? e.message : e}`);
      if (!logged.has(type)) { logged.add(type); console.error(`[bus] listener for "${type}" threw`, e); }
    }
  }
  return bus;
}

export const bus = createBus();
