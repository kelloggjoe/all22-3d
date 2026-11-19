// ALL-22 PRO — every tunable in one place (feel, rules, camera rig, palette, timings).
export const FIELD_W = 53.333; // sideline to sideline, yards
export const HASH_L = 23.58;
export const HASH_R = 29.75;
export const MID_Y = FIELD_W / 2;

// The game clock is Madden's on the NFL's rules (world.js "the clock between plays"): it runs on after a play that ends
// in bounds, through the play call, and the accelerated clock takes the play clock down to ACCEL once the play is
// called. The quarter lengths keep the snaps (and the real minutes) of the old 2 / 3 / 5-minute quarters, which ran
// 6 s between in-bounds plays: QUARTER_OLD maps a saved old length to its new one (main.js loadSettings).
export const RULES = {
  QUARTER_SEC: 360, // 6:00 quarters, Madden's default (settings: QUARTER_OPTS)
  QUARTER_OPTS: [225, 360, 600], // 3:45 / 6:00 / 10:00
  QUARTER_OLD: { 120: 225, 180: 360, 300: 600 },
  PLAY_CLOCK: 40, // the play clock from the whistle of a play the offense keeps the ball after
  PLAY_CLOCK_ADMIN: 25, // … after a timeout, the two-minute warning, a change of possession, a score or a new quarter
  ACCEL: 25, // accelerated clock: once the play is called, the play clock drops to this (a running game clock with it). 0 = off
  ACCEL_OPTS: [25, 20, 15, 10, 0], // the setting (Madden's minimum play clock time); 0 = OFF
  TWO_MIN: 120, // the two-minute warning (time left in the half)
  OOB_STOP: [120, 300], // out of bounds stops the clock until the snap inside the last 2:00 of the 1st half / 5:00 of the game
  TIMEOUTS: 3,
  // a timeout's wait (s, real time): nobody snaps or kicks until it's over, the game clock stays stopped and the play clock
  // waits at :25 (world.js timeoutWait). Only a game with a human in it waits: a sim or the CPU against itself plays on.
  // At most: SNAP (or KICK) skips the rest (world.js skipTimeout; online, once both players are ready)
  TIMEOUT_SEC: 15,
  KICKOFF_SPOT: 35,
  TOUCHBACK_KO: 25,
  TOUCHBACK_PUNT: 20,
  TWO_PT_SPOT: 98,
  PAT_SPOT: 85, // PAT snapped from the 15 (x = 85 in offense coords)
  OT_MAX_POSS: 2,
  CLOCK_SCALE: 1, // game seconds per live real second
  // the game clock reads whole seconds, rounded down (ui.js clock): under CLOCK_ZERO s left it reads 0:00, and then the
  // period is over — at a play's whistle (a score at 0:00 ends the half or the game, after the try for a touchdown) and
  // between plays (nobody snaps at 0:00). world.js whistleClock / runClocks (B3, 2026-10-29: a field goal whose whistle
  // left 0.08 s read 0:00, and the kickoff came anyway)
  CLOCK_ZERO: 1,
  MAX_PLAY_SEC: 25, // invariant: a down must end within this much game time
};

// Player motion / contact (yards, seconds)
export const PHYS = {
  RADIUS: 0.5,
  SPRINT_MULT: 1.12,
  SPRINT_TURN: 0.6, // turn-rate penalty while sprinting
  BASE_SPEED: 5.4, SPEED_RANGE: 2.9, // top speed = BASE + RANGE * spe/150
  ACCEL_BASE: 11, ACCEL_RANGE: 7,
  ENGAGE_DIST: 1.05,
  TACKLE_DIST: 0.95,
  TACKLE_COOLDOWN: 0.32,
  TACKLE_BASE: 0.47,
  DIVE_TACKLE_BONUS: 0.16,
  HITSTICK_BONUS: 0.08, HITSTICK_WHIFF: 0.3, HITSTICK_FUMBLE: 0.09,
  // the defender a human is controlling makes his own plays count (physics.js mine): his hit stick's fumble odds ×,
  // his interception odds ×, his breakup odds × (SWAT_JUMP: × when he leaps for it with SWAT)
  USER_PLAY: { FUMBLE: 1.6, INT: 1.35, SWAT: 1.35, SWAT_JUMP: 1.6 },
  FUMBLE_BASE: 0.012,
  JUKE_EVADE: 0.38, SPIN_EVADE: 0.42, STIFF_EVADE: 0.3, TRUCK_EVADE: 0.33,
  // a truck that knocks the tackler down flings him back the way the carrier runs, harder the faster the carrier and
  // the heavier he is than the tackler: (speed − FROM) × K yd/s, at most MAX, times √(his kg / the tackler's) in
  // 0.7–1.5. The tackler slides that off while he's down (×0.86 a step): about a yard at full speed, nothing at a jog
  TRUCK_FLING: { FROM: 3, K: 6, MAX: 24 },
  // (Snack League) how silly the hits are: the sim slides a flying body farther (KEEP of his speed a step instead of
  // 0.86) and the ragdolls launch LAUNCH × farther and LIFT × higher (render3d.js / tackle3d.js read this too)
  SILLY: { KEEP: 0.968, LAUNCH: 2.3, LIFT: 1.9, DRIVE: 1.5, TACKLE: 1.7 },
  // (Snack League) a dive's launch on his momentum: CARRY × his speed along the dive + PUSH (yd/s), LIFT (LIFT_D
  // for a tackler) + LIFT_K × speed up, never less than MIN_OUT forward and MIN_LIFT up; a pancake / stiff arm's shove (yd/s); a giant head's pull on a hit stick
  DIVE: { CARRY: 1.15, PUSH: 1.5, LIFT: 2.2, LIFT_D: 1.2, LIFT_K: 0.26, MIN_OUT: 5, MIN_LIFT: 2.6 }, PANCAKE_PUSH: 9, STIFF_PUSH: 10, HEAD_TARGET: 0.09,
  // dominoes: a body flying faster than FROM yd/s knocks over whoever he hits (odds K per yd/s over FROM, × the weight
  // ratio's square root, ÷ the victim's footing), passing on KEEP of his speed; a knocked man is down DOWN + DOWN_K × speed
  // loose-ball pinball: a big hit pops it (fumble odds + K per point of impact power over FROM, at most MAX; the ball
  // out at SPEED + SPEED_K × power, up VZ + VZ_K × power); a loose fumble caroms off any body it meets (BUMP yd: the
  // bounce keeps KEEP of its speed plus the body's), a man reaching for it bobbles it (BASE + SPEED × its speed − his
  // hands over 75 ÷ HANDS, a diver less: DIVE; at most MAX, never past BOBBLES), and it hops off the turf at random
  // (TWIST radians); anyone within DIVE_AT yards dives for it, and a diver reaches DIVE_REACH
  POP: { FROM: 40, K: 0.0026, MAX: 0.1, SPEED: 3.5, SPEED_K: 0.06, VZ: 3, VZ_K: 0.04 },
  PINBALL: { BUMP: 0.75, KEEP: 0.7, BASE: 0.32, SPEED: 0.08, HANDS: 450, DIVE: 0.12, MIN: 0.08, MAX: 0.75, BOBBLES: 6, TWIST: 0.9, DIVE_AT: 3.2, DIVE_REACH: 1.35 },
  // contact: a tackle can always reach past the two bodies (REACH yd beyond them; ARM for a blocked man's grab), so a
  // defender touching the carrier always tries; a broken tackle staggers the runner (slowed STAGGER + STAGGER_K × the
  // hit's momentum s, at most STAGGER_MAX; a truck or stiff arm a little: BRUSH; a juke or spin not at all)
  CONTACT: { REACH: 0.18, ARM: 0.1, STAGGER: 0.05, STAGGER_K: 0.0018, STAGGER_MAX: 0.18, BRUSH: 0.05 },
  DOMINO: { FROM: 3, K: 0.2, MIN: 0.15, MAX: 0.95, KEEP: 0.65, DOWN: 0.55, DOWN_K: 0.05, GAP: 0.15, AGAIN: 0.7 },
  MOVE_COOLDOWN: 1.2,
  GRAVITY: 13, // yd/s^2, a little floaty-arcade
  BULLET_SPEED: [19, 27], // by arm 0..1
  LOB_SPEED: [18, 23], // a deep ball still gets there: ~2 s of hang time on a 40-yard shot
  CATCH_REACH: 1.25,
  CATCH_BASE: 0.95, // a catchable, uncontested ball (drops ≈ 4%)
  INT_BASE: 0.075,
  CONTEST_REACH: 2.6, // a defender this close to the ball at the catch contests it (0 at the edge → 1 on the ball)
  BREAK_BASE: 0.21, // pass-breakup odds at a full contest (a timed leap / inside position add to it); 0.26 before F1 (below)
  THROW_ERR: 1.9, // ball-placement spread (× distance/arm/pressure error); 2.12 before F1 (below)
  // F1 (2026-10-29, Discord: "Picks needa be more common fr these QBs be throwing the worst passes and all my DBs wanna
  // do is swat"): off-target throws come from pressure, a bad read or a weak QB, and a defender in position catches the
  // ball more often instead of only batting it (physics.js throwTo / resolveCatch, ai.js snapSetup / rateRec):
  //   THROW_ARM    the placement error's arm factor: [a, b] → a − b × arm (0..1: arm01); was [1.2, 0.75]
  //   THROW_PRESS  how much a free rusher on him widens it (× pressure 0..1); was 0.9
  //   READ_ERR     the CPU's QB misjudges how open each receiver is by this much (yd, a normal spread drawn at the
  //                snap) × (1 − his read: his team's skill), so a weak one throws into coverage now and then; was 0
  //   INT_SHARE    of the balls a defender gets a hand on (the odds as before: the contest), the share he catches:
  //                ([0] + [1] × his position) × his ball skills (hands, and his fit at his spot), at most [2]; his
  //                position: how much nearer the ball he is than the receiver, past INT_POS[0] yd, over INT_POS[1] yd
  //                — a ball the receiver can still fight him for is batted, one thrown where only he can get to it
  //                (off target, or into his lane) is his to catch. (Before: the pick's odds and the breakup's apart,
  //                about one in eight of the balls he played)
  // Measured (tools/qa/pro-oct29/ints.mjs: 128 CPU-vs-CPU PRO games and 128 Franchise sims, main b772f53 → this): PRO
  // 2.72% → 2.63% of attempts picked (0.77 → 0.73 a team-game), Franchise 2.39% → 2.71% (0.66 → 0.75); breakups 5.48 →
  // 4.59 and 5.82 → 4.93 a team-game; completions 55.9% → 59.4% and 50.4% → 53.9%, points a team-game 13.6 → 15.4 and
  // 11.6 → 12.7. Where the picks come from (PRO): a throw within half a yard of its spot 1.4% → 0.0%, two yards or more
  // off 6.6% → 14.8%; a clean pocket 2.1% → 1.2%, heavy pressure 3.4% → 5.1%; a ball the receiver is nearer than any
  // defender 1.5% → 0.0%. BREAK_BASE 0.26 → 0.21. The first cut (INT_SHARE [0.03, 0.5, 0.8] from level with the
  // receiver: exactly INT_POS [0, 1.5] now) picked a person's tight-window throws far more (his fades, the defender
  // level with the receiver), and the retune that batted them all left a forced fade free — so at PRO to LEGEND the
  // CPU's defender keeps his pick odds from before F1 on the person's ball (HARD.INT_FLOOR). A person against the CPU
  // (tools/qa/pro-hard/games.mjs, the QA bots, 96 games each, main → this): his defense picks 0.92 → 1.24 a game at PRO
  // (the average bot) and 0.98 → 1.33 (the skilled one); the skilled one's picked 1.30 → 1.60 at PRO (4.5% → 4.9% of
  // his attempts) and wins 74% → 84% there, 59% → 54% at CHAMPION and 24% → 27% at MASTER
  THROW_ARM: [1.3, 0.95], THROW_PRESS: 1.4, READ_ERR: 0.5, INT_SHARE: [0, 1, 0.8], INT_POS: [0.8, 0.8],
  THROW_ADJUST: 0.3, // how far a receiver can adjust from the intended spot toward a misplaced ball (0..1)
  JAM: [3, 0.4], // MAN PRESS (a defensive audible): a pressed corner within [0] yd of his man jams him for [1] s at the snap
  SHED_MEAN: [2.2, 4.4], // pass-rush shed time range (weaker rusher → longer)
  RUN_SHED_MEAN: [1.6, 3.4],
  RUN_SEAL: 0.6, // how fast a run block turns the defender away from the hole (yd/s)
  BACKSIDE_SHED: 0.55, // backside run blocks shed this much sooner (pursuit from behind)
  STALK_SHED: 0.6, // a receiver's stalk block on a defensive back holds this fraction as long
  SHED_REACT: 0.7, // per second: a blocked defender comes off the block when the back runs at him…
  SHED_REACT_DIST: 1.9, // …within this many yards
  SCRAMBLE_BOX: 4.6, // a QB this far (yd) across from the middle of the pocket has left it (ai.readScramble)
  SCRAMBLE_SHED: 0.4, // per second: a pass rusher comes off his block once the QB has left the pocket — much sooner
  //                     when his blocker is no longer between him and the QB, rarely while he still is
  QUICK_WIN: 0.29, // chance a pass rusher beats his man off the snap (more vs a weaker blocker)
  SACK_STICK: 0.22, // tackle-odds bonus on a QB still in the pocket (sacks)
  // A QB who keeps retreating with the ball on a pass play (the owner's call, from online play: a QB ran straight back
  // and had all day, never sacked): past a normal drop (QB_DEEP_FREE yd behind the line) he loses QB_DEEP_PER of his
  // speed a yard, down to QB_DEEP_FLOOR (18 yd deep); the rushers don't, so they run him down. And a ball thrown while
  // backing up flies a little wider (FADE_ERR more spread at a full-speed retreat: subtle, the owner asked). Measured
  // with bots: a retreating QB was caught ~75 yd deep (90th pct), now ~30; the CPU's drops stay inside 8 yd.
  QB_DEEP_FREE: 8, QB_DEEP_PER: 0.04, QB_DEEP_FLOOR: 0.6, FADE_ERR: 0.1,
  // the CPU QB under pressure (ai.qbThink): a rusher this many seconds from getting home and nobody open — he throws it
  // away at THROW_AWAY odds (raw → sharp QB, by his coach's skill) or hangs in there and takes what comes
  SACK_SOON: 0.3, THROW_AWAY: [0.15, 0.4],
  // rushers the protection can't block (ai.assignPassPro): a QB who sees it coming throws hot, early, to a man at least
  // HOT_OPEN open. HOT_SEE: his odds, raw → sharp QB, against one free rusher (a disguised blitz) / an all-out
  // pressure look (two free, or seven coming: hard to miss)
  HOT_SEE: [[0, 0.15], [0.75, 0.97]], HOT_OPEN: 1.8,
  // an interception (ai.readTurnover): the old offense sees it and turns to chase after TURN_REACT[0] s plus
  // TURN_REACT[1] s for every yard he was from the catch (until then he finishes what he was doing)
  TURN_REACT: [0.4, 0.03],
  KICK_RUSH_PUSH: 0.45, // extra push for a field-goal / punt block rush (penetration up the middle)
  ARM_TACKLE_DIST: 0.9, // an engaged defender can still grab a carrier this close…
  ARM_TACKLE_MULT: 0.5, // …at this fraction of a clean tackle's odds
  KICK_G: 11,
};

// Kicking (field goals graft build A's model; blocked kicks graft build D's rule)
export const KICKING = {
  FG_ELEV: 0.62, // launch angle (rad)
  FG_V0: 15, FG_VP: 14, // ball speed = V0 + VP · power · (0.7 + 0.3 · leg) — a strong leg clears the bar from ~62 yd
  ACC_ANG: 0.42, // hook/slice (rad) per unit of meter accuracy error (0 = the sweet spot)
  AIM_ANG: 0.04, // rad per unit of aim (−1..1, set with ←/→ before the meter)
  WIND_ANG: 0.0025, // rad per mph of crosswind (14 mph ≈ 1.75 yd of drift on a 50-yarder)
  UPRIGHT: 3.08, // half the gap between the uprights (yd)
  BAR: 3.33, // crossbar height (yd)
  FG_RANGE: 62, // the longest field goal anyone tries (yd): the user's FIELD GOAL cards, the coach and the CPU
  CPU_SIGMA: 0.135, // CPU accuracy spread (≈95% inside 30 yd, ≈80% in the 40s, ≈60% from 50+)
  CPU_POWER_MARGIN: 0.07, // CPU kickers swing a little harder than the minimum
  BLOCK_REACH: 1.25, // a free rusher this close to the kick point can get a hand on it
  BUST: 0.16, // on a block call, chance the protection busts and an edge rusher comes clean
  // Onside kicks (scratchpad tool pro-onside/grid.mjs: the human kicking onside over aim × power × accuracy). The
  // receiving team reads the kick from its flight (ai.onsideReturn): caught by surprise it breaks on the ball
  // ONSIDE_READ s after the boot (the weakest coach … the best), set for one (ai.onsideWary) after ONSIDE_READ_SET;
  // until then it takes its first steps back at ONSIDE_DROP effort. Its nearest man goes for the ball with the nearest
  // on the far side of it (unless he's ONSIDE_FAR yd further off); the rest block the cover men within ONSIDE_BLOCK
  // yd. A coach of ONSIDE_ADAPT skill or better brings his hands team right after the kicker's first onside try.
  ONSIDE_READ: [0.55, 0.4], ONSIDE_READ_SET: 0.15, ONSIDE_DROP: 0.25, ONSIDE_FAR: 6, ONSIDE_BLOCK: 6, ONSIDE_ADAPT: 0.6,
  ONSIDE_ROLL: 2.5, // how fast the hop dies out (1/s): the receivers' read of where it will be
  ONSIDE_SCATTER: [0.6, 1.5], // where it comes down: σ (yd) long/short, left/right of where the meter sent it
  ONSIDE_HOP: [0.45, 0.35], // the hop off the turf: up to this many radians off line, ± this share of its pace
  // a bouncing onside kick squirts off the man who gets to it (still live) this often — ONSIDE_MUFF_SET for a
  // receiving team set for it (its hands team; halfway for a front line that stays home) — plus ONSIDE_PRESSURE for
  // each yard an opponent is inside 4 yd of him. The human's onside kicks: ≈28% recovered as a surprise (≈42% at the
  // very best spot), ≈10% into a team that's set for one; the CPU's own late onside kicks ≈10%.
  ONSIDE_MUFF: 0.44, ONSIDE_MUFF_SET: 0.26, ONSIDE_PRESSURE: 0.07,
  // The punt returner (the CPU's, the autopilot's, and a human's unless he calls FAIR CATCH: physics.js launchKick /
  // kickFlight, ai.js kickThink, world.js action). A punt coming down inside his own LET_GO yard line he lets go: he
  // gets out of its way, his teammates keep clear of it, and it bounces on (about 0.22 s of its speed, ~3 yd) into the
  // end zone for a touchback, unless the cover team gets to it and downs it first (one that comes to rest untouched is
  // dead there). Any other punt he fields: inside his own 10 the CPU returns it, never a fair catch; outside it the CPU
  // fair-catches when a cover man is within FAIR_NEAR yd of him. Measured CPU against CPU (tools/qa/pro-faircatch:
  // punts.mjs, ep.mjs): one let go from the 3 out is downed short of the goal line (at the 1–7, behind even a fair catch
  // where it came down), while a return from inside the 10 gets to the 13–24; one coming down inside the 2½ is a
  // touchback about 90% of the time (73% from the 2½ to the 2, all of them inside the 1½). LET_GO 0: the old rule (he
  // fields every punt; the CPU fair-catches it inside his 10).
  LET_GO: 2.5, FAIR_NEAR: 5,
  // A CPU kick returner who catches a kickoff more than KO_KNEEL yd deep in his end zone takes a knee for the touchback
  // (physics.js kickFlight). Measured (tools/qa/pro-faircatch/kickoffs.mjs): run out from anywhere in the end zone, a
  // return reached the 17–20 against the touchback's 25 (0–½ yd deep: the 19.9; 2–2½: the 18.1), so: any end-zone
  // catch. (2.5: the old rule, returned when caught less than 2½ yd deep.)
  KO_KNEEL: 0,
  // A ball whistled dead where it comes down — a kick in the end zone (a touchback) or out of bounds, an incomplete pass —
  // settles there (physics.js ballGrounded / ballStep): a hop of SETTLE[0] yd/s, SETTLE[1] of its pace kept, then a roll
  // slowing SETTLE[2] per s: 2–5 yd on, at rest in about 1.3 s (the dead ball lasts 1.6). A look only: the play's spot
  // is the whistle's.
  SETTLE: [2, 0.35, 5],
};

// The CPU against a human, by level (difficulty.js: w.hard 1 PRO, 2 CHAMPION, 3 MASTER, 4 LEGEND — the CPU team against
// a human; ROOKIE has no brains, only its own ROOKIE knobs). Each array is [PRO, CHAMPION, MASTER, LEGEND]. The brains
// first: every one of their knobs from its level's strength, 0 (the knob does nothing) to 1 (its strong end: the
// scales of tools/qa/pro-hard/knobs.mjs; tools/qa/fr-diff/tiers.mjs makes these arrays) — PRO 0.7, CHAMPION, MASTER and
// LEGEND 1 (it learns the human's habits and counters them, knows every play, covers tighter, reads faster), the three
// on the human's own side (ASSIST, RUN_ERR, CATCH: his throws' aim, on the run, his contested catches) no stronger than
// MASTER's were (0.6); then, where the brains fall short, surer tackling (TACKLE ×) and quicker reads (READ s): CHAMPION
// 1.05 / −0.2, MASTER 1.25 / −0.3, LEGEND 1.5 / −0.6, with MASTER's coach at MASTER and LEGEND (and in PRO's own games a
// roster floor, FLOOR). Calibrated (pro-feedback, 2026-10-25) to the owner's targets with the skilled-human bot (react
// 150–250 ms, the open man, sprint-jukes, the fade, scramble-then-throw, route-jumping on defense; tools/qa/fr-diff/
// bot-games.mjs, Franchise games): its wins in 100, ROOKIE 65, PRO 35, CHAMPION 15, MASTER 6, LEGEND 2 (before: ROOKIE
// 80, PRO 58, CHAMPION 26, MASTER 16 at 6f15663)
export const HARD = {
  // ROOKIE's [tackle odds (×), its quarterback's read offset (s)] (difficulty.js setupDifficulty: 0.88 and 0.3 before);
  // and for each level from PRO: the CPU's tackle odds and its quarterback's read offset
  ROOKIE: [0.97, 0.05],
  TACKLE: [1, 1.05, 1.25, 1.5], READ: [0, -0.2, -0.3, -0.6],
  // pass defense (ai.defThink / coverTight / coverZone): reaction to a throw (× the normal), how late (s) a defender may
  // get to where it comes down and still play it, the swat's extra reach (yd) and odds; man coverage's cushion [early,
  // late] (yd), lag (s), how hard he pulls to his spot (1/s) and how far ahead (s) he reads a release; how closely a
  // zone matches the receiver in it [deep lateral, underneath], and how closely an underneath zone carries a vertical
  BALL_REACT: [0.615, 0.45, 0.45, 0.45], BALL_LATE: 0.35, SWAT_REACH: [0.35, 0.5, 0.5, 0.5], SWAT: [0.21, 0.3, 0.3, 0.3],
  CUSHION: [[0.69, 0.32], [0.3, 0.2], [0.3, 0.2], [0.3, 0.2]], LAG: [0.14, 0.08, 0.08, 0.08], MIRROR: 3, TURN: 0.45,
  ZONE_MATCH: [[0.99, 0.555], [1, 0.45], [1, 0.45], [1, 0.45]], SINK: 0.95,
  // the catch (physics.resolveCatch, the CPU's defender on the human's pass): extra breakup odds (× the contest), the
  // interception odds (×; × INT_FORCED more on a throw to a man the HUD didn't show open), catch odds lost (× contest)
  BREAK: [0.182, 0.26, 0.26, 0.26], INT: [1.56, 1.8, 1.8, 1.8], INT_FORCED: [1.35, 1.5, 1.5, 1.5], CATCH: [0.06, 0.06, 0.06, 0.06],
  // F1 (physics.js resolveCatch): the pick odds as they were before F1 (INT and INT_FORCED on them) the CPU's defender
  // keeps at the least on the human's ball, × this — the base game's rule (config.js PHYS INT_SHARE: a defender clearly
  // in front of the receiver) left a ball forced into level coverage, a fade, only to be batted. PRO's a little less
  // than all of it, to keep its picks of the skilled bot near 1.5 a game (tools/qa/pro-hard/games.mjs)
  INT_FLOOR: [0.7, 1, 1, 1],
  // run defense (ai.defThink, physics.tackles / blocking): the run read (× the normal), the pursuit angle's lead
  // (normally 0.7 for the secondary, 0.9 the front), how much of a juke / spin's tackle dodge still works on the CPU's
  // tacklers, how much sooner (×) a blocked man comes off to tackle a back running at him, and how much of the draw the
  // human must have run lately before it's read like any other run
  RUN_READ: [0.685, 0.55, 0.55, 0.55], LEAD: 1, JUKE: [0.685, 0.55, 0.55, 0.55], SHED: [1.56, 1.8, 1.8, 1.8], DRAW_AT: 1.5,
  // play action (how long a second-level defender bites, × the normal; never from a deep zone), the presnap look (ai.
  // hardAlign: corners press this often whatever the call) and stunts (ai.hardSnap: an end crashes, the nose loops)
  PA_BITE: [0.615, 0.45, 0.45, 0.45], PRESS: 0.45, STUNT: [0.21, 0.3, 0.3, 0.3],
  // the scout (ai.scoutPlay): each old down counts this much less; over-the-top help on a receiver once he has this much
  // of the human's throws, a spy once the human scrambles on this share of his downs (ai.hardSnap)
  MEMORY: 0.92, BRACKET_AT: 1.6, SPY_AT: 0.22,
  // the human's throws (ai.hardThrow): the placement help to a man the HUD shows [green, yellow] (normally 0.55 / 0.8),
  // and the extra error at a full sprint (doubled throwing away from his run)
  ASSIST: [[0.7, 0.89], [0.7, 0.89], [0.7, 0.89], [0.7, 0.89]], RUN_ERR: [0.54, 0.54, 0.54, 0.54],
  // the CPU's QB (ai.qbThink / rateRec): seconds per read down the progression (normally 0.45), the open-enough bar [at
  // his first read, the least] and how fast it falls (per s), the extra reach credited to the human's own defender
  // (normally 0.45 × his speed × the ball's flight), how much his stars count, the worth of a catch's depth past 60% of
  // the yards to go (per yd), and how long (s) into his reads he waits before a dump-off (unless the rush is on him)
  READ_STEP: [0.345, 0.3, 0.3, 0.3], THR: [[2.52, 0.83], [2.4, 0.8], [2.4, 0.8], [2.4, 0.8]], THR_FALL: [0.805, 0.85, 0.85, 0.85],
  USER_RANGE: [0.59, 0.65, 0.65, 0.65], STARS: [0.7, 1, 1, 1], DEPTH: [0.042, 0.06, 0.06, 0.06],
  CHECKDOWN: [0.63, 0.9, 0.9, 0.9],
  // the CPU's play calls (ai.cpuOffCall's playValue / mixShift / hardPresnap): each play's success rate against a good human defense
  // before it has been run this game (PRIOR_N downs' worth), how hard it leans on the better ones, how far its run /
  // pass mix follows what works, and how often its QB checks out of a play at the line. PLAY_PRIOR: the CPU's first
  // downs with each play against the skilled bot at CHAMPION (pro-feedback, 2026-10-25: 160 games, every play of the
  // doubled playbook, each rate shrunk toward 0.25 by 40 downs; the sneak, the dive and QB POWER as they were — a short
  // yardage play's rate is its down's; a play missing here: 0.25)
  PLAY_PRIOR: { pacross: 0.37, paflat: 0.36, slants: 0.35, levels: 0.35, fade: 0.32, wheel: 0.3, smash: 0.3, pashot: 0.29, nakedboot: 0.28, flood: 0.27,
    stick: 0.27, papost: 0.26, bunchcorner: 0.25, snag: 0.24, stretch: 0.24, flea: 0.24, trap: 0.24, izone: 0.22, fourverts: 0.22, tripszone: 0.21,
    draw: 0.2, ycross: 0.2, widezone: 0.2, curlflat: 0.19, power: 0.19, toss: 0.18, gtcounter: 0.18, wrscreen: 0.17, dagger: 0.17, tescreen: 0.17,
    outs: 0.15, delay: 0.15, hbscreen: 0.15, drive: 0.14, jetsweep: 0.14, readopt: 0.13, mesh: 0.12, iso: 0.12, counter: 0.11, paboot: 0.1,
    qbpower: 0.15, sneak: 0.4, dive: 0.45 },
  PRIOR_N: 5, PICK_BETA: [3.5, 5, 5, 5], MIX: [0.56, 0.8, 0.8, 0.8], AUDIBLE: [0.595, 0.85, 0.85, 0.85],
  // the CPU's defensive calls against the human (ai.counterCall): on this share of downs (away from the goal line and
  // the prevent), once it has seen COUNTER_AFTER downs, the call with the fewest first downs against his recent mix of
  // concepts — COUNTER[concept] in CALLS order: the first-down rates a skilled human's plays get against each call at
  // CHAMPION, measured — picked by a softmax (COUNTER_BETA per 100%) so it stays hard to read; against a human who keeps
  // running one concept (SPAM_AT of his recent plays, all the way at 0.35 more) the counter comes SPAM of the rest of
  // the way to every down. Measured again with the doubled playbook (pro-feedback, 2026-10-25: tools/qa/pro-hard/
  // downs.mjs, the skilled bot's plays forced against each call, 720 downs a cell; the fade, PA SHOT for the deep shots,
  // FOUR VERTS scrambled, SLANTS and MESH, PA CROSSERS for the middle, TOSS and STRETCH, DRAW, INSIDE ZONE and the READ
  // OPTION), with its six new calls from TAMPA 2 on
  CALLS: ["c2", "c3", "c4", "c1", "c2mb", "manblitz", "zblitz", "c0n", "c2man", "c3d", "dimeblitz", "tampa2", "c1r", "c6", "creeper", "c4d", "dsim"],
  COUNTER: {
    fade: [95, 81, 54, 96, 96, 67, 81, 60, 95, 80, 64, 81, 96, 39, 79, 43, 75],
    deep: [97, 67, 38, 97, 96, 70, 73, 70, 92, 66, 68, 97, 96, 60, 65, 49, 60],
    scramble: [65, 72, 64, 79, 49, 45, 70, 38, 40, 72, 30, 42, 80, 82, 69, 68, 42],
    quick: [21, 20, 21, 24, 18, 40, 11, 38, 3, 12, 1, 27, 22, 8, 12, 38, 16],
    mid: [19, 27, 49, 25, 82, 18, 45, 66, 87, 21, 67, 19, 79, 31, 43, 28, 21],
    edge: [42, 28, 27, 35, 58, 43, 23, 25, 47, 25, 18, 30, 38, 28, 18, 21, 27],
    inside: [48, 33, 38, 33, 74, 37, 33, 34, 48, 30, 34, 42, 32, 39, 28, 28, 31],
  },
  COUNTER_P: [0.63, 0.9, 0.9, 0.9], COUNTER_AFTER: 2, COUNTER_BETA: 12, SPAM: 0.85, SPAM_AT: 0.4,
  // MASTER's and LEGEND's roster floor (PRO's own games: difficulty.cpuTeamFor): the scouting ratings' weights [pass,
  // rush, defense, speed], where the floor sits against the human's strength [MASTER, LEGEND] (−6: about as strong),
  // the most a boost may rise; every MASTER and LEGEND coach's skill and QB read
  STRENGTH: [1, 1, 1, 1], FLOOR: [-6, -3], MAX_BOOST: 1.6, MASTER_SKILL: 1, MASTER_READ: -0.15,
};

// FLIP (playbook.js mirrorPlay): the CPU offense flips its play calls as a player can (ai.cpuFlip), so a call's name
// doesn't give its side away. CPU: false → it never flips (and draws no random numbers for it: games play exactly as
// before the feature). WIDE_P: with the ball off a hash, an outside play goes to the wide side of the field this often;
// HASH_OFF: the ball counts as off a hash this many yards or more from the middle of the field (the hashes are 3.1 off)
export const FLIP = { CPU: true, WIDE_P: 0.8, HASH_OFF: 1.5 };

// Camera rig (yards). F (focal length in buffer px) = FOCAL * bufferHeight (wider below 16:10: camera3d.js setBuffer).
export const CAM = {
  FOCAL: 0.84,
  HORIZON: 0.27, // horizon row as a fraction of the buffer height
  SPRITE_YD_PER_PX: 0.043, // world size of one sprite pixel
  pro: { back: 16.5, height: 8, lead: 6, followBack: 12.5, followHeight: 6.2 },
  zoom: { back: 10.5, height: 5, lead: 4, followBack: 9, followHeight: 4.4 },
  all22: { back: 21, height: 22, lead: 12, followBack: 19.5, followHeight: 20, horizon: -0.32 }, // horizon above the frame: steep coaches-film look
  broadcast: { side: 30, height: 9, lead: 0 },
  STIFF: 4.2, // critically damped spring (1/s)
  NEAR_CULL: 1.2,
};

// Pixel palette (ints are 0xAABBGGRR for Uint32 writes; css for DOM/canvas fills)
export const PAL = {
  ink: "#0b0d1a", white: "#f4f4ec", gold: "#ffd23e", red: "#e8413b", blue: "#3b7dff",
  los: "#4aa8ff", firstDown: "#ffdd33", cyan: "#5ef0ff", magenta: "#ff4fd8", green: "#57e36a",
  orange: "#ff9b2e", gray: "#8a90a8", dark: "#1a1e33",
};
export const SPARK = ["#fff6c8", "#ffd23e", "#ff9b2e", "#f4f4ec"];
export const DUST = ["#b9a27a", "#9c8761", "#d8c69c"];
export const CONFETTI = ["#ff4fd8", "#ffd23e", "#5ef0ff", "#57e36a", "#f4f4ec", "#e8413b"];

// Sky presets: stepped bands top → horizon
export const SKY = {
  night: { bands: ["#05061a", "#080a24", "#0c1030", "#11163c", "#171d48", "#1f2654", "#2a3162"], haze: "#2c3366", stars: true, lights: true },
  dusk: { bands: ["#1b1544", "#33205a", "#5a2a66", "#8a3a62", "#c4545a", "#ec7a52", "#ffb062"], haze: "#d48a6a", stars: false, lights: true },
  day: { bands: ["#2a6fd6", "#3a80e0", "#4b90e8", "#5ea0ee", "#74b2f2", "#8cc4f6", "#a8d4f8"], haze: "#a9cfe9", stars: false, lights: false },
};

// Home field (World option homeField: true, or a strength; off = a neutral site): the crowd is loudest when the visitors
// have the ball on the downs that matter (3rd and 4th down, two-point tries). Their quarterback (the CPU's) reads a beat
// later and every throw is a touch less accurate, and their line hears the snap count late: the home rush gets off its
// blocks a little sooner. Between equal teams the home side wins ≈ 55% (+1.2 to 1.7 points a game; 2,000 mirror matches
// with and without the franchise options; 49.4% with it off).
export const HOME_FIELD = { READ: 0.2, ACC: 0.115, RUSH: 0.1 };

// Designed QB runs (ai.js qbRunner / redZoneCarrier): QB POWER and the READ OPTION's keep are for a QB who can really
// run — SPEED and AGILITY at least these, and a runner (runAbility: speed, then agility / AG_PER, power / PW_PER, the
// weights of what gained yards on QB POWER) no more than MARGIN behind his own back's. In the red zone and at the goal
// line the back gets them, unless the QB is the better runner by BETTER. The QB SNEAK is for any QB, as in the NFL, with
// SNEAK yd or less to go. Measured on 1,024 Franchise games (tools/qa/pro-feedback/season.mjs): QB POWER gained 1.5–2.0
// yd a carry for QBs slower than 6.6 and 3.4–4.0 from 7.0, the backs' runs 4.4; the sneak converted 89% at a yard or
// less for any QB (the HB DIVE 85%), 61% from 1½–2 and 17% from 3–5. (SPEED 0, AGILITY 0, MARGIN 99, BETTER −99 and
// SNEAK 99: the calls as before it.)
export const QB_RUN = { SPEED: 7, AGILITY: 60, AG_PER: 60, PW_PER: 150, MARGIN: 0.25, BETTER: 0.25, SNEAK: 1 };

// The pass rush and who gets the credit (pro-feedback, 2026-10-25). Before it the edge had nearly every sack: rushers
// the protection left free on a blitz, or who beat a tackle — a 3-4's outside linebackers 77% of its sacks, a 4-3's
// ends 52% and its outside linebackers 38%, its tackles 5%, a 3-4's nose 2% (1,024 Franchise games: tools/qa/
// pro-feedback/season.mjs). A lineman who beat his man inside was picked up again (8 times in 10) or walled off by the
// bodies in front of him before he got near the QB. Now, as in the NFL (4-3 teams: the ends about half the sacks, the
// tackles a fifth to a quarter, the linebackers 10–20%; 3-4 teams: the outside linebackers about half or more, the line
// about a third):
//   BEAT       a rusher who beats his man off the snap (PHYS.QUICK_WIN): [s before anyone can pick him up again, s his man
//              stumbles, s he's through the line — slipping past the bodies in his way — for an even match (× how much he
//              outclasses his man, 0.5–1.6)]
//   HELP       on a pass play a lineman the protection leaves over doubles the interior rusher nearest him (ai.
//              assignPassPro: the nose, a tackle): the man doubled isn't through the line when he beats his first
//              blocker, and the double team picks him up as he comes off (physics.js tryEngage)
//   FRONTS43   a 4-3 keeps its four down linemen in its nickel, dime and goal-line fronts, its outside linebackers
//              taking the slot (playbook.js defFormation, the calls' a43). Off: a 4-3 plays those fronts as a 3-4 does,
//              its second tackle on the slot receiver. Held back at first (292cc62: the run died against them, 2.75 yd
//              a carry at a 4-3's nickel — the old run blocking left two linebackers free against four linemen); on
//              since the run blocking's count (RUN_BLOCK), runs at a 4-3's nickel 3.75 yd a carry, a 3-4's 3.70
//   CALLS      how much the defense's play caller favours its pressure (a blitz, a sim) by the down [3rd and medium or
//              short, 3rd and long, 2nd and long, any other] (ai.defFit; 1.6, 1.4, 1, 0.5 before)
//   FREE       what leaving a rusher free costs the protection (ai.assignPassPro: less for a man out wide). 7.5 left a
//              4-3's two blitzing linebackers both free — a look its quarterback can't miss, so he got the ball out —
//              where a 3-4's blitz had one coming free, the one that sacks: 8.5 picks up one of the two
//   HALF       a sack is shared, half to each, with a second defender within this many yd of the QB, not blocked
//   PRESS      a pressure: the nearest defender within this many yd of the QB as he lets it go (thrown away too), not
//              blocked — and every sack, full or half (playerstats.js)
// Measured over Franchise seasons (2,048 games, season.mjs): a 4-3's sacks to its ends 56%, its tackles 16%, its
// linebackers 27% (main: 53%, 5%, 42%); a 3-4's to its outside linebackers 60%, its ends 32%, its nose 7% (main: 77%,
// 19%, 3%); 10% of sacks shared; 3.9% of dropbacks a sack (2.8% before); the backs' runs 4.24 yd a carry (4.29 before).
// The doubled playbook's quick game (6f15663) took it to 2.5% of dropbacks; with QB_READ, CALLS, FRONTS43 and FREE, and
// the 4-3's blitzers walking up to the edge (playbook.js pos43; 2,048 games): 6.5%, the season's leaders 16–21 sacks
// (17.5 the median); a 3-4's to its outside linebackers 53%, its ends 38%, its nose 7%; a 4-3's to its ends 46%, its
// linebackers 36%, its tackles 18%. The same rosters playing the other scheme (season.mjs SWAP): a 4-3 gives up 0.4
// points a game fewer than a 3-4 (± 0.2), where it gave up 0.7 more (051857b).
// (BEAT [1, 0.18, 0], HELP false, FRONTS43 false, HALF 0, CALLS [1.6, 1.4, 1, 0.5], FREE 7.5: the pass rush and the
// credit as before it.)
export const PASS_RUSH = { BEAT: [1, 0.18, 0.46], HELP: true, FRONTS43: true, HALF: 1.6, PRESS: 2.5, CALLS: [2.2, 2, 1.3, 0.9], FREE: 8.5 };

// When a quarterback starts his reads (ai.qbThink: the play's read, else by its kind; a screen's as it is), as K × that
// + ADD seconds (K 1, ADD 0: as before it). The doubled playbook's quick concepts had him letting it go at 1.71 s from
// the snap, before most rushes get home (sacks 2.5% of dropbacks): its reads retimed (playbook.js) and ADD 0.1, 1.89 s
// and 5.9% (pro-feedback, 2026-10-25)
export const QB_READ = { K: 1, ADD: 0.1 };

// The run blocking's count (pro-feedback, 2026-10-25: the owner's call). Before it every run blocker took the defender
// nearest his playside gap, one each, in the order the line stood: against four down linemen two linebackers went
// free on the inside zone (and a tight end or wing found nobody left), POWER O gained nothing, and a 4-3 held the runs
// to 2.3 yd a carry at its base against a 3-4's 3.3 (forced runs, tools/qa/pro-playbook/forced.mjs). Now (ai.js
// assignRunScheme) the line counts the box from the play side: a man with a down lineman in his gap blocks him; an
// uncovered man doubles his neighbour's man and climbs to a linebacker (the combo); a gap scheme's play side blocks
// down, its kick-out takes the end man and its wrap or lead the playside linebacker; a trap's guard the first lineman
// past the center. Whoever's left is the backside edge or a backside linebacker.
//   SCHEME   on (false: the blocking as before it)
//   CLIMB    [s, s at random on top]: when a combo's second man leaves the double for his linebacker (sooner if the
//            linebacker comes downhill at it, or the man doubled is gone)
//   HOLD     while doubled, his shed clock runs this much slower; PUSH: the ground he gives; DRIVE: the double's drive
//            off the ball; REACT: how much less he comes off it when the back runs at him (physics.blocking)
//   VISION   the back reads it: near the line with the ball, his way to the hole shut (a block or a man in it), he
//            picks his own lane (ai.carrierThink), drawn to the hole this much (0: his path to the line, as before)
//   GIVE     the ground a run block gives an even match (0.6, the pass block's, before)
//   LB_READ  how soon (s) a zone linebacker keys the run (0.55, every zone's, before)
//   TWO_GAP  a 3-4's down linemen hold their ground against a run block (its push, + this)
//   LATE     [s, s]: a double's second man with nobody on the man yet takes him himself after this long (no linebacker
//            for him to climb to | one)
// Measured over Franchise seasons (1,024 games against 6f15663's 512, season.mjs): the backs 4.25 yd a carry (4.06);
// runs at a 3-4 3.83, a 4-3 4.01 (3.93, 3.37); the gap runs (POWER O, COUNTER, GT COUNTER, TRAP) 3.1 yd and 44%
// success (1.9, 31%), TRAP 39% (30%); the inside zone 4.8 (3.9)
export const RUN_BLOCK = { SCHEME: true, CLIMB: [0.4, 0.3], HOLD: 0.6, PUSH: 0.35, DRIVE: 0.3, REACT: 0.35, VISION: 0.8, GIVE: 0.35, LB_READ: 0.35, TWO_GAP: 0.45, LATE: [0.25, 0.45] };

export const TIMING = {
  DEAD_SEC: 1.6,
  PRESNAP_CPU_SEC: 0.7, // (Snack League: the CPU lines up and snaps quickly, no clock games)
  HUDDLE_SEC: 0.5,
  BANNER_SEC: 1.6,
  REPLAY_SEC: 5.5,
  COIN_SEC: 2.4, // window for the human's heads/tails call (world.action("coinCall")) before it is called at random
  //               (a coin-toss UI sets world.coinHold = true to wait for the player instead)
  COIN_RESULT_SEC: 1.4, // the toss result stays up this long before the kickoff is set
  RETURN_CALL_SEC: 1.0, // extra presnap time when the human receives a kick (to pick a return lane)
  DEF_SWITCH_SEC: 1.0, // extra presnap time when the human is on defense in a scrimmage play (to switch defenders)
  // the clock between plays (world.js): a no-huddle offense lines up in NO_HUDDLE_SET; a CPU offense in its hurry-up
  // snaps HURRY_SEC after the whistle (a spike SPIKE_SEC); one running out the clock snaps with CHEW_AT (± 1) on the play
  // clock; a human defense facing a hurry-up has HURRY_CALL_SEC to call its play
  NO_HUDDLE_SET: 0.6, HURRY_SEC: 8, SPIKE_SEC: 6, CHEW_AT: 2, HURRY_CALL_SEC: 10,
  // a CPU ahead protects its lead (runs, the play clock run to :02) in the game's last CHEW_FROM seconds, at most half
  // the 4th (ai.clockPlan)
  CHEW_FROM: 180,
  SPIKE_T: 0.3, KNEEL_T: 0.5, // snap → the spike / the kneel
  KNEEL_SEC: 0.45, // a returner's kneel in the end zone → touchback
  PUNT_OP_SEC: 1.95, // snap → punt (the punter catches, takes his two steps)
  FG_OP_SEC: 1.28, // snap → hold → kick (NFL operation time ≈ 1.3 s)
};

// The CPU's clock management (ai.js "the clock": clockPlan, cpuTempo, cpuTimeout, kneelOut, cpuSpike, lastSnapFG) —
// the same at every difficulty, for every CPU team (exhibition, the leagues, Franchise, an online seat the CPU plays).
// Measured with tools/qa/pro-cpuclock/measure.mjs: a two-minute drill gains ≈ 0.7 yd a second of game clock (a hurry-up
// snap 8 s after the whistle, a pass ≈ 5.4 yd, a third of them incomplete), a timeout saves it ≈ 8 s.
export const CLOCK = {
  // the hurry-up when behind in the 2nd half: from this much time left in the game, down 1–8 / 9–16 / more
  HURRY: [150, 300, 420],
  // its chance (noChance): the yards to the field-goal line at DRILL_YPS, plus KICK_SET to stop the clock and kick,
  // against the time left and TO_SAVE a timeout; it plays for points when it has CHANCE [1st half, tied late] of that
  DRILL_YPS: 0.7, TO_SAVE: 8, KICK_SET: 6, CHANCE: [0.85, 0.95],
  // the field-goal line (fgLine): where its kicker makes it this often — a drill's target (FG_TRY), and comfortably in
  // range (FG_IN: a drill there with time to spare stops hurrying and keeps its timeouts for the kick's set-up, and a tied
  // defense facing it spends its own to keep time to answer)
  FG_TRY: 0.6, FG_IN: 0.75,
  // a drill's timeouts after an in-bounds play once the warning is given (one is kept while the field goal is the plan,
  // for the kick's set-up inside FG_TO s): when the time left is under TO_NEED × the time its yards take (and the kick's
  // set-up), or inside TO_AT[0] + TO_AT[1] s for each one it has to spare
  FG_TO: 20, TO_AT: [30, 15], TO_NEED: 1.25,
  // MILK: a field goal wins it, the game's last MILK s, the kicker making it MILK_FG[0] of the time from here: the offense
  // runs the clock down and kicks on the last snap (earlier, a drill in range still plays for the touchdown: in this
  // engine that wins more). A kneel instead of a run when he'd still make it MILK_FG[1] from a yard back. Its snap leaves
  // PLAY_T s for the play, PAD s to spare, and the kick's set-up after it (1 s with a timeout to stop the clock, the
  // field-goal unit's HURRY_SEC hurry without)
  MILK: 40, MILK_FG: [0.82, 0.9], PLAY_T: 5.5, PAD: 3,
  // the drill's ball carrier within SIDELINE yd of a sideline heads out of bounds (ai.sidelinePlan)
  SIDELINE: 11,
  // a drill with this many times the time it needs (ai.drillTime) takes its time: two-thirds passes on early downs, not
  // 82% (cpuOffCall), and no hurry once it's in range of a field goal that wins it (cpuTempo)
  DRILL_EASY: 1.6,
};

// The coach's risk (F10, Discord 2026-10-29: "A option for how risky your ai is … careful (will punt/kick unless it's
// required to win the game) · reckless (will basically always go for it on 4th)"): a team's 4th-down and two-point coach,
// team.risk (ai.js riskOf: Franchise's setting for a person's team, league.js setRisk; everyone else BALANCED, the coach
// as he always was). ai.js fourthDownChoice / coachFourth / patChoice:
//   careful     punts or kicks unless only going for it can still win: the 4th quarter's last MUST s (overtime too),
//               behind, and no field goal in range (FG_OK of the time) that ties it or wins it; two points only when the
//               kick can't tie it late (down 2 after the touchdown, the 4th quarter)
//   balanced    the chart, a little more careful than it (ai.js fourthDownChoice), two points on the late-game chart
//   aggressive  the chart leaning GO yd of expected points to going for it, never cold feet; two points by the chart
//               from the second half on (TWO_AGG: the margin after the touchdown)
//   reckless    goes for it on every 4th down (the last snap of a half in range still kicks: ai.lastSnapFG), and for two
//               after every touchdown
export const RISK = { MUST: 150, FG_OK: 0.35, GO: 0.25, TWO_AGG: [1, 4, 5, 12, -2, -5, -9, -10, -13] };

// Fake punts and field goals (F4, Discord 2026-10-29; world.js fakeGo, ai.js cpuFake / fakeWary / fakeDefense):
//   UPBACK  a fake punt on 4th and this many yards or fewer goes to the up-back (a direct snap, a run); longer, to the
//           punter (he throws or runs)
//   REACT   [s, s at random on top]: how long each man of the kick defense plays the kick once the snap is in the fake's
//           hands (the rushers don't wait, but a punt's go on at the punter for RUSH_REACT s when the up-back has it);
//           WARY: × that when it smelled a fake coming (ai.fakeWary)
//   HOLD    the fake's thrower (the CPU's) runs it himself when nobody's open this long into his reads (4th down: a
//           throw away is a turnover)
//   CPU     the CPU's own fakes (ai.cpuFake): instead of a punt [4th and 2 or less, 4th and 3–4] between its own 40 and
//           their 30 (× PAST_MID the other side of midfield, × BEHIND behind in the second half), instead of a field
//           goal [4th and 2 or less, 3–4] inside their 20 (× BEHIND behind by more than 3 in the 4th quarter); never in
//           overtime, never protecting a lead late, never from its own end or on 4th and long; an aggressive coach
//           twice as often (AGGRESSIVE), a careful one never (a reckless one goes for it anyway)
export const FAKE = { UPBACK: 1.5, REACT: [0.45, 0.6], RUSH_REACT: 0.3, WARY: 0.55, HOLD: 1.3, CPU: { punt: [0.07, 0.035], fg: [0.06, 0.03], PAST_MID: 1.5, BEHIND: 1.6, AGGRESSIVE: 2 } };

export const SPEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
