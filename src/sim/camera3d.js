// Camera rig: Pro / Zoom / ALL-22 / Broadcast cams. A pinhole camera at (x, y, h) in ABSOLUTE stadium yards
// (home attacks +X) with yaw `ang` (0 = looking along +X) and a shifted lens (no pitch: vertical lines stay vertical,
// the horizon row sits high so the stadium shows). Critically damped springs → smooth, never jerky.
// Also owns the Pro Cam rig brain (direct(): where the camera looks for every phase / play type / replay / title
// flyover) and the camera "punch" zoom on big moments (attach(bus) subscribes to the events that trigger it).
// API: cam.mode / cam.modeD = "pro" | "zoom" | "all22" (rig presets, CAM in config.js): the player's OFFENSE and DEFENSE
//      cameras (main.js settings cam / camD); cam.onD = the defense one is in use this play (defensePlay, picked as each
//      play is set up) · cam.inUse() = the one in use · cam.snapNext = true (snap on next direct)
//      replays: the sideline telephoto by default; replay.angle = "endzone" (+ optional replay.endDir ±1) = a low zoomed
//      end-zone camera (replay.js picks the angle) · cam.cuts counts hard cuts (whip-pans / swoops are cut instead)
//      cam.kick(v) (punch impulse 0..1) · cam.direct(dt, w, isAttract, replay|null, renderer, t) once per frame
//      cam.project(X, Y, Z, out) world → buffer · cam.aim(...)/snap()/update(dt) low-level rig.
//      THE TURN (Discord, 2026-10-29: "Flip the screen so I can return interceptions … I be catching myself running
//      backwards"): cam.turnOn (Settings: TURNOVER CAMERA, main.js turnCam) · cam.turnedFor(w) · cam.stickFor(raw, w) →
//      the stick in the World's screen terms · cam.screenSign(w) (a screen-relative left / right for the World) — see
//      "the turn" below.
import { CAM, FIELD_W, MID_Y } from "./config.js";

// The turn: how long the swing round the ball takes (s, eased), how much wider and higher the shot opens up halfway
// round (× the rig's distance back; yards up), and the stick: one pushed at least HOLD when the turn starts keeps
// moving the player the way it did until it's let go (under FREE) or swung more than AWAY radians from there.
export const TURN = { SEC: 0.85, WIDE: 0.18, LIFT: 1.5, HOLD: 0.3, FREE: 0.2, AWAY: (2 * Math.PI) / 3 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// critically damped spring: x'' = k²(t − x) − 2k x'. Returns the new velocity; the caller integrates the position
// (no per-frame array allocation).
function springVel(cur, vel, target, k, dt) {
  const a = k * k * (target - cur) - 2 * k * vel;
  return vel + a * dt;
}
// The human's team is on defense this play: the other team's downs, field goals and tries, and the human's own kickoffs
// and punts (his team covers the return; returning one is offense). Never with the CPU on both sides (?autoplay).
export function defensePlay(w) {
  if (!w.user || w.autopilot) return false;
  const kick = w.playType === "kickoff" || w.playType === "punt";
  return (w.user === w.possession) === kick;
}

export class Camera {
  constructor() {
    this.mode = "pro"; this.modeD = "all22"; this.onD = false;
    // doubles from the start (-0 / x.5): the fields keep one representation for the whole session (no deopts)
    this.x = 10.5; this.y = MID_Y; this.h = 8.5; this.ang = -0;
    this.vx = -0; this.vy = -0; this.vh = -0; this.va = -0;
    this.tx = 10.5; this.ty = MID_Y; this.th = 8.5; this.ta = -0;
    this.fx = 1; this.fy = -0; this.rx = -0; this.ry = -1;
    this.F = 300.5; this.cx = 320; this.hy = 90; this.W = 640; this.H = 360;
    this.fovMul = 1; this.horizonFrac = CAM.HORIZON; this.aspK = 1;
    this.shakeX = 0; this.shakeY = 0; this.punch = -0;
    this.stiff = CAM.STIFF;
    this.punchT = 0; // decaying punch impulse (set by kick(); punch = lens zoom derived from it each frame)
    this.snapNext = false;
    this.lastPhase = ""; this.lastWorld = null; this.cuts = 0; this.cutWhy = {}; this.replayAngle = undefined; // TV-style cuts instead of whip-pans / swoops
    // the turn (below): on (the setting), this play's turn { w, n: playNo, dir } or null, the swing under way or null,
    // the stick held as it started (null: none), the stick as last given (stickFor) and the World's copy of it
    this.turnOn = true; this.turn = null; this.swing = null; this.held = null;
    this.raw = { mx: 0, my: 0 }; this.stickOut = { mx: 0, my: 0, sprint: false };
    this.turns = 0; // turns started (tests)
  }
  // ---------- rig brain ----------
  attach(bus) {
    bus.on("interception", () => this.kick(1));
    bus.on("fumble", () => this.kick(0.7));
    bus.on("touchdown", () => this.kick(1));
  }
  kick(v) { this.punchT = v; }
  inUse() { return this.onD ? this.modeD : this.mode; }
  decayPunch(dt, off) {
    this.punchT = Math.max(0, (this.punchT || 0) - dt * 0.9);
    this.punch = off ? 0 : Math.min(1, this.punchT * 1.4);
  }
  // Aim the rig for this frame. replay = the Replay when an instant replay is playing (else null); r = Renderer
  // (ball/actor positions in absolute coords); t = app time (title flyover).
  direct(dt, w, isAttract, replay, r, t) {
    if (replay) {
      if (replay.direct) { replay.direct(this, r, dt); return; } // FX team: replay.js directs its own angles (sideline / end zone)
      // fallback (no replay director) — focus: the ball carrier, else the ball (absolute coords; no per-frame array)
      let fx = r.ballX, fy = r.ballY;
      for (let i = 0; i < r.nA; i++) { const a = r.actors[i]; if (a.hasBall) { fx = a.X; fy = a.Y; break; } }
      if (replay.angle === "endzone") {
        // reverse angle: a low, slightly zoomed camera ~26 yd ahead of the play in the attack direction (or
        // replay.endDir), looking back at it — the end-zone camera once the play nears the goal line
        const dir = replay.endDir || (w && w.possession === "away" ? -1 : 1);
        const camX = clamp(fx + dir * 26, -12, 112);
        this.fovMul = 1.5; this.horizonFrac = 0.3;
        this.aim(fx, fy * 0.75 + MID_Y * 0.25, dir > 0 ? Math.PI : 0, Math.abs(camX - fx), 3.6);
      } else {
        this.fovMul = 1.55; this.horizonFrac = 0.2; // telephoto from the sideline, like a TV replay
        this.aim(fx, Math.max(fy, MID_Y), Math.PI / 2, Math.max(fy, MID_Y) + 6.2, 10);
      }
      if (this.snapNext || replay.angle !== this.replayAngle) { this.snapNext = false; this.replayAngle = replay.angle; this.snap(); this.cuts++; } // angle switch = cut
      this.stiff = 3; if (dt > 0) this.update(dt);
      return;
    }
    if (isAttract) {
      // title: slow Mode 7 flyover orbiting the stadium
      const a = t * 0.07;
      this.fovMul = 1; this.horizonFrac = 0.3;
      this.x = 50 - Math.cos(a) * 52; this.y = MID_Y - Math.sin(a) * 24; this.h = 11 + Math.sin(t * 0.23) * 4;
      this.ang = Math.atan2(MID_Y - this.y, 50 - this.x);
      this.tx = this.x; this.ty = this.y; this.th = this.h; this.ta = this.ang; this.vx = this.vy = this.vh = this.va = 0;
      this.basis(); this.updateLens();
      return;
    }
    // The player's two cameras: the DEFENSE CAMERA while the human's team is on defense (defensePlay), else the OFFENSE
    // CAMERA. The side is read as each play is set up (the play call, the pre-snap) and kept until the next one, so the
    // camera never changes mid-play: after a turnover it stays through the return and the dead ball. A new match starts
    // on the offense camera (the coin toss). A change is a TV cut, like the kickoff's below.
    if (w !== this.lastWorld) this.onD = false;
    if (w.phase === "playcall" || w.phase === "presnap") this.onD = defensePlay(w);
    // A human receiving a kickoff gets the offense camera behind the returner, so up-screen is the return direction.
    // Other kickoffs keep the high ALL-22 view for coverage lanes. The saved camera settings themselves never change.
    const userReturn = w.playType === "kickoff" && w.user && !w.autopilot && w.isUserTeam(w.defTeam);
    const mode = w.playType === "kickoff" && !userReturn ? "all22" : this.inUse();
    if (mode !== this.liveMode) { if (this.liveMode) this.snapNext = true; this.liveMode = mode; }
    const bc = mode === "broadcast";
    const rig = !bc && CAM[mode] && CAM[mode].back ? CAM[mode] : CAM.pro;
    this.fovMul = 1; this.horizonFrac = rig.horizon || CAM.HORIZON; this.stiff = CAM.STIFF;
    const offDir = w.possession === "home" ? 1 : -1; // offense attack direction in abs X
    const userD = w.user && !w.autopilot && w.userSide() === "D";
    const scrim = w.playType === "normal" || w.playType === "two";
    // On defense in a scrimmage play the camera sits behind the offense, as on the user's own drives (world.screenDir()
    // turns the controls with it): the routes, the coverage and the ball run up the screen and stay in view. From
    // behind the user's defense the play came AT the camera, and anything past ~5-8 yd fell off the bottom edge.
    const behindO = userD && scrim;
    const camD = userD && !behindO; // looking from behind the user's defense: punts, kickoffs and kicks
    let dir;
    // a human returning a kick or punt: the camera turns behind his returner once the return is on. Covering one (the
    // kicking team) keeps the view his coverage runs in, as the site's camera does
    const userReturning = Boolean(w.user) && !w.autopilot && w.isUserTeam(w.defTeam);
    const returnUnderway = userReturning && (w.playType === "kickoff" || w.playType === "punt") && w.kicked && (r.ballState === "held" || w.returner);
    if (returnUnderway) dir = -offDir;
    else if (w.autopilot || !w.user || behindO) dir = w.playType === "kickoff" && w.kicked ? -offDir : offDir;
    else dir = w.user === "home" ? 1 : -1;
    const turned = this.turnFor(w, dir, bc); // the human's team has the ball going the other way: the turn (below)
    if (turned) dir = turned;
    const ang = dir > 0 ? 0 : Math.PI;
    const losAbs = w.possession === "home" ? w.los : 100 - w.los;
    const bYabs = w.possession === "home" ? w.ballY : FIELD_W - w.ballY;
    let fxp = losAbs, fyp = bYabs * 0.65 + MID_Y * 0.35, back = rig.back, h = rig.height;
    if (w.phase === "live" || w.phase === "dead") {
      fxp = r.ballX; fyp = r.ballY * 0.8 + MID_Y * 0.2;
      const kickAir = (w.playType === "kickoff" || w.playType === "punt") && r.ballState !== "held";
      if (w.playType === "fg" || w.playType === "pat") { fxp = losAbs * 0.6 + r.ballX * 0.4; fyp = MID_Y; }
      back = kickAir ? rig.back + 4 : rig.followBack; h = kickAir ? rig.height + 2 : rig.followHeight;
      // a kick coming AT the camera (the receiving side): don't chase the ball over our heads — sit behind the
      // landing spot so the ball drops into the frame from above the far stands
      if (kickAir && w.ball.kind !== "snap" && (r.ballX - this.x) * dir > 0 && (w.ball.vx || 0) * (w.possession === "home" ? 1 : -1) * dir < 0) {
        const lx = w.possession === "home" ? w.ball.tx : 100 - w.ball.tx, ly = w.possession === "home" ? w.ball.ty : FIELD_W - w.ball.ty;
        if (Number.isFinite(lx)) { fxp = lx; fyp = (Number.isFinite(ly) ? ly : MID_Y) * 0.7 + MID_Y * 0.3; back = rig.back + 1; h = rig.height + 1.5; }
      }
      if (r.ballState !== "held" && w.ball.kind && (w.ball.kind === "pass" || w.ball.kind === "lob")) { fxp = r.ballX; back = rig.followBack + 3; h = rig.followHeight + 1; }
    }
    // following the play from behind the offense live: a touch further back and higher than the follow rig, so the
    // carrier rides ~60-65% down the screen (clear of the bottom-edge legends) instead of at the bottom edge
    if (w.phase === "live" && scrim && !camD && mode === "pro" && r.ballState === "held") { back += 2; h += 1.5; }
    // pre-snap behind the offense: the deep back (7 yd behind the line) stays clear of the bottom-edge legend
    if (w.phase === "presnap" && scrim && !camD && mode === "pro") { back += 2.5; h += 1; }
    if (camD && (w.phase === "presnap" || w.phase === "playcall")) { back = rig.back + 4.5; h = rig.height + 1.5; }
    fyp = Math.max(11, Math.min(FIELD_W - 11, fyp)); // never hug the side walls
    if (w.phase === "playcall" || w.phase === "pat") { back += 10; h += 1.5; }
    // kickoff set-up: frame the tee (not in the dead ball, so a return TD's celebration stays in the shot)
    if (w.playType === "kickoff" && w.phase !== "live" && w.phase !== "dead") { fxp = losAbs; back = rig.back + 2; }
    // dead ball (the whistle): never keep chasing the ball once the play is over
    const res = w.phase === "dead" && !bc ? w.result : null;
    if (res) {
      if (res.type === "incomplete" && scrim) {
        // incompletion: the ball skids off to the sideline / bench — reset to the line of scrimmage on the pre-snap rig
        fxp = losAbs; fyp = Math.max(11, Math.min(FIELD_W - 11, bYabs * 0.65 + MID_Y * 0.35)); back = rig.back; h = rig.height;
      } else if (res.type === "td") {
        // touchdown: ease well back and up so the scorer, the teammates gathering and the confetti read against the
        // field (the end-line clamp below keeps the crowd wall out of the top two-thirds of the frame)
        back += 10; h += 4;
      } else if (w.playType !== "fg" && w.playType !== "pat") { back += 3; h += 1.5; } // tackle / out of bounds: the pile ~60% down
      // within ~20 yd of the end line ahead: clamp the look-at so the end line projects ≥ ~55% down the screen
      // instead of aiming into the stands
      fxp = dir > 0 ? Math.min(fxp, 92) : Math.max(fxp, 8);
    }
    const toWall = dir > 0 ? 116 - fxp : fxp + 16;
    if (toWall < 40) { const k = (40 - toWall) / 40; h += k * 4.5; back += k * 3; }
    if (bc) {
      // Broadcast Cam: high on the home sideline, looking across the field, panning with the ball (a TV main camera)
      this.fovMul = 1.4; this.horizonFrac = 0.16;
      this.aim(fxp, MID_Y + 3, Math.PI / 2, MID_Y + 9.3, 13);
    } else this.aim(fxp + dir * (w.phase === "live" ? 2 : 0), fyp, ang, back, h);
    // the turn's swing under way: round the ball, not a cut
    if (this.swing) { this.swingStep(dt, fxp + dir * (w.phase === "live" ? 2 : 0), fyp, back, h); this.lastPhase = w.phase; this.lastWorld = w; return; }
    // Cut (like a TV director) instead of whip-panning or swooping: a turn of more than ~35° (possession flips in
    // autopilot, kicks), a new match/world, a target far away, or the next play set up away from where the last ended.
    const ph = w.phase, lp = this.lastPhase;
    const between = ph !== lp && (ph === "playcall" || ph === "presnap" || ph === "pat") && (lp === "dead" || lp === "live" || lp === "halftime" || lp === "pat" || lp === "init" || lp === "");
    this.lastPhase = ph;
    const ddx = this.tx - this.x, ddy = this.ty - this.y, far = Math.sqrt(ddx * ddx + ddy * ddy);
    const why = this.snapNext ? "snap" : w !== this.lastWorld ? "world" : Math.abs(this.ta - this.ang) > 0.6 ? "turn" : far > 30 ? "far" : between && far > 6 ? "reset" : "";
    if (why) { this.snapNext = false; this.snap(); this.cuts++; this.cutWhy[why] = (this.cutWhy[why] || 0) + 1; }
    this.lastWorld = w;
    this.update(dt);
  }
  // ---------- the turn ----------
  // On defense in a scrimmage play the human watches from behind the other team's offense (dir above: world.screenDir()
  // turns his controls the same way). When his team gets the ball going the other way in a live play (an interception,
  // a fumble recovered, a blocked kick picked up and returned), the view turns round for the return: the camera swings
  // round the ball (swingStep: TURN.SEC, eased, never a cut) to sit behind it the way his team now goes, and stays that
  // way through the dead ball. The next play's set-up goes back to the rule above (after a turnover the ball is his, so
  // it already faces that way; a ball lost back in the same play turns it back there). Once a play; never with the
  // setting off (TURNOVER CAMERA · STAY), with the CPU playing his team (autopilot, a replay's watch), or in the
  // broadcast camera (across the field: no way to turn). → the way the view faces for the turn (±1), or 0: the rule
  turnFor(w, dir, bc) {
    let T = this.turn;
    if (T && (T.w !== w || T.n !== w.playNo || (w.phase !== "live" && w.phase !== "dead"))) { T = this.turn = null; this.swing = null; }
    if (!T && this.turnOn && !bc && w.phase === "live" && w.user && !w.autopilot) {
      const b = w.ball, c = b.state === "held" ? b.carrier : null, mine = w.user === "home" ? 1 : -1; // (his team's way, in abs X)
      if (c && c.teamKey === w.user && dir !== mine) {
        T = this.turn = { w, n: w.playNo, dir: mine };
        this.swing = { dir: mine, init: false };
        this.turns++;
        // a stick pushed as it turns keeps running him the way it did (stickFor)
        const m = Math.hypot(this.raw.mx, this.raw.my);
        this.held = m >= TURN.HOLD ? { mx: this.raw.mx / m, my: this.raw.my / m } : null;
      }
    }
    return T ? T.dir : 0;
  }
  // One frame of the swing: the camera goes round the ball's spot (a point that follows the ball as the follow rig
  // does: a critically damped spring from where the camera was looking) from its own heading to the new one, the
  // shorter way past the middle of the field (never out over the stands), eased in and out (smoothstep), opening up a
  // little wider and higher halfway round. It starts exactly where the camera is and ends moving as the rig would, on
  // its target, so the follow rig takes over without a cut. fx, fy, back, h: the rig's aim for this frame (direct).
  swingStep(dt, fx, fy, back, h) {
    const S = this.swing;
    if (!S.init) {
      S.init = true; S.t = 0; S.a0 = this.ang; S.b0 = back; S.h0 = this.h;
      S.cx = this.x + Math.cos(this.ang) * back; S.cy = this.y + Math.sin(this.ang) * back; S.vx = this.vx; S.vy = this.vy;
      const to = S.dir > 0 ? 0 : Math.PI, sgn = (S.cy - MID_Y) * Math.cos(S.a0) >= 0 ? 1 : -1; // (halfway round: on the field's middle side)
      S.a1 = to + 2 * Math.PI * Math.round((S.a0 + sgn * Math.PI - to) / (2 * Math.PI));
    }
    S.t += dt;
    const s = Math.min(1, S.t / TURN.SEC), e = s * s * (3 - 2 * s), open = Math.sin(Math.PI * s), k = this.stiff;
    S.vx = springVel(S.cx, S.vx, fx, k, dt); S.cx += S.vx * dt;
    S.vy = springVel(S.cy, S.vy, fy, k * 0.9, dt); S.cy += S.vy * dt;
    const a = S.a0 + (S.a1 - S.a0) * e, d = S.b0 + (back - S.b0) * e + back * TURN.WIDE * open;
    const px = this.x, py = this.y;
    this.ang = a;
    this.x = clamp(S.cx - Math.cos(a) * d, -14, 114); this.y = clamp(S.cy - Math.sin(a) * d, -6.5, FIELD_W + 6.5);
    this.h = clamp(S.h0 + (h - S.h0) * e + TURN.LIFT * open, 1.5, 40);
    if (s >= 1) {
      // round: the follow rig takes over, moving on as the swing left it
      this.swing = null;
      this.vx = dt > 0 ? (this.x - px) / dt : 0; this.vy = dt > 0 ? (this.y - py) / dt : 0; this.vh = 0; this.va = 0;
    }
    this.basis();
    this.updateLens();
  }
  // ---------- the controls follow the screen ----------
  // The World maps the stick by its own screen (world.js screenDir: up is the other team's way on defense in a
  // scrimmage play), so while the view is turned for this World's live play the stick and a screen-relative left or
  // right go to it the other way round. A stick already pushed as the turn started (held) keeps moving the player the
  // way it did until it's let go (under TURN.FREE) or swung more than TURN.AWAY from there: a returner already running
  // for the end zone doesn't turn back as the screen comes round. main.js (and net/online.js: the stick it sends) give
  // the World stickFor's copy; controls.js the side of a juke.
  turnedFor(w) { const T = this.turn; return Boolean(T && w && T.w === w && T.n === w.playNo && w.phase === "live"); }
  stickFor(raw, w) {
    const out = this.stickOut;
    this.raw.mx = raw.mx; this.raw.my = raw.my;
    let f = 1;
    if (this.turnedFor(w)) {
      const H = this.held;
      if (H) {
        const m = Math.hypot(raw.mx, raw.my);
        if (m < TURN.FREE || (raw.mx * H.mx + raw.my * H.my) / m < Math.cos(TURN.AWAY)) this.held = null;
      }
      f = this.held ? 1 : -1;
    } else this.held = null;
    out.mx = raw.mx * f; out.my = raw.my * f; out.sprint = Boolean(raw.sprint);
    return out;
  }
  // a screen-relative left (-1) or right (+1) as the World reads it: the other way round while the view is turned
  screenSign(w) { return this.turnedFor(w) ? -1 : 1; }
  setBuffer(w, h) {
    this.W = w; this.H = h;
    this.cx = w >> 1;
    // the focal length follows the buffer height, so a screen narrower than 16:10 (an iPad, a 4:3 laptop) lost the sides
    // of the field (the split-out receivers sat at the edges at the snap): there the lens widens to 16:10's horizontal
    // field of view. 16:10 and wider (phones, desktops) are unchanged.
    this.aspK = Math.min(1, w / h / 1.6);
    this.updateLens();
  }
  updateLens() {
    // the punch-in zoom fades out (0 at < 25 yd) when the stadium wall is close ahead: punching into the stands only
    // magnifies crowd texels (e.g. a touchdown celebration in the end zone)
    const punch = this.punch > 0 ? this.punch * clamp((this.wallAhead() - 25) / 10, 0, 1) : 0;
    this.F = CAM.FOCAL * this.H * this.fovMul * this.aspK * (1 + punch * 0.18);
    this.hy = Math.round(this.H * this.horizonFrac);
  }
  // distance from the camera to the stadium bowl wall straight ahead (walls at X -16 / 116, Y -8 / FIELD_W + 8, as
  // mode7.js builds them)
  wallAhead() {
    const fx = this.fx, fy = this.fy;
    let d = 1e9;
    if (fx > 1e-3) d = (116 - this.x) / fx; else if (fx < -1e-3) d = (this.x + 16) / -fx;
    if (fy > 1e-3) d = Math.min(d, (FIELD_W + 8 - this.y) / fy); else if (fy < -1e-3) d = Math.min(d, (this.y + 8) / -fy);
    return d;
  }
  basis() {
    const c = Math.cos(this.ang), s = Math.sin(this.ang);
    this.fx = c; this.fy = s; this.rx = s; this.ry = -c;
  }
  // set the rig target: focus point (abs), heading angle, distance back, height
  aim(fx, fy, ang, back, height, lateral = 0) {
    // unwrap the target angle to the nearest equivalent of the current one
    let a = ang;
    while (a - this.ang > Math.PI) a -= Math.PI * 2;
    while (a - this.ang < -Math.PI) a += Math.PI * 2;
    this.ta = a;
    this.tx = fx - Math.cos(a) * back + Math.sin(a) * lateral;
    this.ty = fy - Math.sin(a) * back - Math.cos(a) * lateral;
    this.th = height;
  }
  snap() { this.x = this.tx; this.y = this.ty; this.h = this.th; this.ang = this.ta; this.vx = this.vy = this.vh = this.va = 0; this.basis(); }
  update(dt) {
    const k = this.stiff;
    this.vx = springVel(this.x, this.vx, this.tx, k, dt); this.x = this.x + this.vx * dt;
    this.vy = springVel(this.y, this.vy, this.ty, k * 0.9, dt); this.y = this.y + this.vy * dt;
    this.vh = springVel(this.h, this.vh, this.th, k * 0.8, dt); this.h = this.h + this.vh * dt;
    this.va = springVel(this.ang, this.va, this.ta, k * 0.7, dt); this.ang = this.ang + this.va * dt;
    // keep inside the stadium bowl
    this.x = clamp(this.x, -14, 114); this.y = clamp(this.y, -6.5, FIELD_W + 6.5); this.h = clamp(this.h, 1.5, 40);
    if (!Number.isFinite(this.x + this.y + this.h + this.ang)) { this.x = 10; this.y = MID_Y; this.h = 8; this.ang = 0; this.vx = this.vy = this.vh = this.va = 0; }
    this.basis();
    this.updateLens();
  }
  // world (abs) → buffer. Writes into out {f, sx, sy, s}. Returns false if behind the camera.
  project(X, Y, Z, out) {
    const dx = X - this.x, dy = Y - this.y;
    const f = dx * this.fx + dy * this.fy;
    out.f = f;
    if (f < CAM.NEAR_CULL) return false;
    const u = dx * this.rx + dy * this.ry;
    const inv = this.F / f;
    out.sx = this.cx + u * inv + this.shakeX;
    out.sy = this.hy + (this.h - Z) * inv + this.shakeY;
    out.s = inv;
    return true;
  }
}
