// Player and Ball. Positions are in yards in OFFENSE coordinates (offense attacks +x; y across, 0..53.33).
// The renderer converts to absolute stadium coordinates (world.absX/absY), so the camera never jumps on turnovers.
export class Player {
  constructor(team, teamKey, info) {
    this.team = team; // team object (data.makeTeam)
    this.teamKey = teamKey; // 'home' | 'away'
    this.slot = info.slot;
    this.id = info.id;
    this.num = info.num;
    this.name = info.name;
    this.level = info.level || 15;
    this.trait = info.trait || null;
    this.star = info.star === 2 ? 2 : info.star ? 1 : 0; // (data.js makeTeam: a star player; 2: a Gym's super ace)
    this.shiny = Boolean(info.shiny); // (✦ shiny.js: drawn from his shiny sheet)
    this.r = info.r;
    this.radius = 0.42 + Math.min(0.2, Math.log10(Math.max(1, info.r.kg)) * 0.08);
    this.side = "O";
    this.pos = "";
    // fields other modules add later, declared up front so every Player keeps one hidden class (no megamorphic
    // property reads → no per-frame HeapNumber garbage): snap spot (world), move direction (physics), blocker flag,
    // and the presentation-only FX move state (fx.js / replay.js; the sim never reads it). Doubles start as -0.
    this.sx = -0; this.sy = -0; this.moveDX = -0; this.moveDY = -0; this.blocking = false;
    this.fxK = 0; this.fxT = -0; this.fxD = -0; this.fxGather = 0;
    // Franchise (squad.js; inert unless a World option turns it on): player id, the ratings for the slot he's playing
    // (r = those with fatigue / injury applied), energy 1 fresh → 0 spent, this play's effort, the injury he carries,
    // plays left on the sideline (a minor one), the roster slot he holds (null on the bench), the last snap he played
    this.pid = info.pid != null ? String(info.pid) : null;
    this.base = info.r; this.effR = null;
    this.energy = -0; this.energy += 1; this.work = -0; // doubles from the start
    this.inj = null; this.rest = 0; this.at = null; this.lastSnap = -1;
    this.reset(0, 0);
  }
  reset(x, y) {
    this.x = x; this.y = y; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.mx = 0; this.my = 0; // desired direction (unit-ish) set by ai/input
    this.want = 0; // desired speed fraction 0..1.2
    this.sprint = false;
    this.state = "stance";
    this.engaged = null; this.shedAt = 0; this.engageCool = 0; this.blockT = 0;
    this.stun = 0; this.down = 0; this.slow = 0;
    this.tackleCool = 0; this.moveCool = 0;
    this.move = null; this.moveT = 0; // active special move: juke/spin/stiff/truck/dive/hitstick/swat
    this.hasBall = false;
    this.as = null; // play assignment
    this.ai = { wp: 0, t: 0, target: null, zone: null, read: 0, settle: false, cut: 0, lane: 0 };
    this.user = false;
    this.anim = "stance"; this.animT = 0;
    this.flash = 0; this.celebrate = 0;
    this.faceX = 1; this.faceY = 0; // last meaningful heading (offense coords)
    this.lie = 0; // lying-down rotation (0, 1 = 90°)
  }
  get speedNow() { return Math.hypot(this.vx, this.vy); }
  dist(o) { return Math.hypot(o.x - this.x, o.y - this.y); }
  distTo(x, y) { return Math.hypot(x - this.x, y - this.y); }
  get canAct() { return this.stun <= 0 && this.down <= 0; }
}

export class Ball {
  constructor() { this.reset(); }
  reset() {
    this.state = "dead"; // held | air | loose | dead
    this.carrier = null;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.kind = ""; // pass | lob | punt | kickoff | fg | pat | pitch | snap | fumble
    this.from = null; this.target = null;
    this.t = 0; this.T = 0; // time in flight / planned flight time
    this.tx = 0; this.ty = 0; // planned landing point
    this.spin = 0;
    this.thrower = null;
    this.tipped = false;
  }
}
