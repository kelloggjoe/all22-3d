// The 3D stadium, field and everything drawn from the World each frame. Stadium coordinates (yards): X 0..100 goal
// line to goal line (end zones to -10 / 110), Y 0..53.33 across, Z up. three.js: x = X, y = Z, z = -Y, which keeps the
// original camera's screen left and right (camera3d.js: looking along +X, +Y is on the left).
import * as THREE from "three";
import { FIELD_W, MID_Y, PHYS } from "./sim/config.js";
import { Athlete, uniformMaterial } from "./players3d.js";
import { kookyDNA } from "./kooky.js";
import { Crumbs } from "./snack.js";
import { SidelineCoach } from "./coach3d.js";
import { Tackle3D, Flop3D } from "./tackle3d.js";
import { PixelStadium, jumboInfo } from "./pixel-stadium.js";
import { THROW_END, throwReleaseTime } from "./football-moves.js";

const v3 = new THREE.Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BIG = new Set(["truck", "hit", "stiff", "pancake", "domino"]); // launches that take over from a lesser fall
const lerp = (a, b, t) => a + (b - a) * t;

function goalPost(X, dir) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0xf5d020, roughness: 0.45, metalness: 0.2 });
  const cyl = (r, h) => new THREE.CylinderGeometry(r, r, h, 10);
  const base = new THREE.Mesh(cyl(0.2, 3.3), mat); base.position.set(0, 1.65, 0);
  const goose = new THREE.Mesh(cyl(0.12, 2.2), mat); goose.rotation.z = Math.PI / 2; goose.position.set(dir * 1.1, 3.3, 0);
  const cross = new THREE.Mesh(cyl(0.1, 6.17), mat); cross.rotation.x = Math.PI / 2; cross.position.set(dir * 2.2, 3.33, 0);
  g.add(base, goose, cross);
  for (const s of [-1, 1]) { const up = new THREE.Mesh(cyl(0.07, 11), mat); up.position.set(dir * 2.2, 3.33 + 5.5, s * 3.08); g.add(up); }
  g.position.set(X, 0, -MID_Y);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}


export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.3, 900);
    this.athletes = new Map(); // sim Player → Athlete
    this.ballMesh = this.makeBall();
    this.scene.add(this.ballMesh);
    this.stadium = null;
    this.lines = null;
    this.tmp = new THREE.Vector3();
  }
  resize(w, h) { this.gl.setSize(w, h, false); this.W = w; this.H = h; }

  makeBall() {
    const geo = new THREE.SphereGeometry(0.13, 16, 10); geo.scale(1, 1, 1.7);
    const ball = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6b3416, roughness: 0.65 }));
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.11), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lace.position.set(0, 0.128, 0); ball.add(lace);
    ball.castShadow = true;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; this.ballShadow = shadow; this.scene.add(shadow);
    return ball;
  }

  // build the stadium for a matchup (night game under the lights)
  setTeams(home, away, kits) {
    this.clearPlayerPreview();
    this.stopWatchingPlayEvents?.();
    this.stopWatchingPlayEvents = null;
    this.pendingTackle = null;
    this.flops = new Map(); this.knocks = []; this.wasDown = new Map(); this.flopPlay = -1; this.lurches = new Map();
    this.tackle = null;
    this.throwMotion = null;
    if (this.stadium) { this.scene.remove(this.stadium); this.stadium.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    for (const a of this.athletes.values()) { this.scene.remove(a.root); a.dispose(); }
    this.athletes.clear();
    if (this.uniforms) for (const group of Object.values(this.uniforms)) for (const mat of group.values()) mat.dispose();
    this.uniforms = { home: new Map(), away: new Map() };
    const S = this.stadium = new THREE.Group();
    this.kits = kits; this.teams = { home, away };
    // ALL-22 PRO's pixel stadium: field, stand walls, LED ribbon, night sky, light towers, jumbotrons (pixel-stadium.js)
    this.pixel?.dispose();
    this.pixel = new PixelStadium(home, away, kits);
    S.add(this.pixel.group);
    S.add(goalPost(-10, -1), goalPost(110, 1));
    // the head coaches on their sidelines
    for (const c of Object.values(this.coaches || {})) c.dispose();
    this.coaches = { home: new SidelineCoach(S, kits.home, "home") }; // (your team's coach: you play the home side)
    // pylons
    const pyl = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 });
    for (const X of [0, -10, 100, 110]) for (const Y of [0, FIELD_W]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), pyl); m.position.set(X, 0.3, -Y); S.add(m); }
    // (the benches are painted on the apron: pixel-stadium.js)
    // lights: stadium banks (key light with shadows from above the near sideline), fill, and the towers' look
    S.add(new THREE.HemisphereLight(0xc8d4ff, 0x1d3a1f, 0.9));
    const key = new THREE.DirectionalLight(0xfff3e0, 2.6);
    key.position.set(50, 70, 40); key.target.position.set(50, 0, -MID_Y);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 10; sc.far = 200;
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    this.key = key;
    S.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xbad8ff, 1.03); fill.position.set(50, 60, -(FIELD_W + 40)); fill.target.position.set(50, 0, -MID_Y); S.add(fill, fill.target);
    this.scene.add(S);
    // line of scrimmage (blue) and first down (yellow) lines laid on the turf, TV style
    const lineGeo = new THREE.PlaneGeometry(0.22, FIELD_W);
    this.losLine = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.85, depthWrite: false }));
    this.fdLine = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.9, depthWrite: false }));
    for (const l of [this.losLine, this.fdLine]) { l.rotation.x = -Math.PI / 2; l.position.set(0, 0.03, -MID_Y); l.renderOrder = 1; S.add(l); }
    // the controlled player's ring
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.92, 32), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.renderOrder = 1; S.add(this.ring);
    // play art (route lines on the turf before the snap)
    this.art = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.art.renderOrder = 2; S.add(this.art);
  }

  athleteFor(p) {
    let a = this.athletes.get(p);
    if (!a) {
      const info = p.team.players[p.slot] || {};
      const kit = this.kits[p.teamKey];
      const look = info.look || {};
      const group = this.uniforms[p.teamKey];
      const key = `${look.skin ?? 0}/${look.socks ?? 0}/${look.gloves ?? 0}`;
      if (!group.has(key)) group.set(key, uniformMaterial(kit, look));
      a = new Athlete(group.get(key), kit, { num: p.num, look, m: info.sp?.m, kg: p.r.kg, snack: info.snack, kooky: info.snackBody || info.dna || kookyDNA(info) });
      this.athletes.set(p, a);
      this.scene.add(a.root);
    }
    return a;
  }

  setPlayerPreview(player, kit) {
    this.clearPlayerPreview();
    const material = uniformMaterial(kit, player.look);
    const athlete = new Athlete(material, kit, { num: player.num, look: player.look, m: player.sp.m, kg: player.sp.kg, snack: player.snack, kooky: player.snackBody || player.dna || kookyDNA(player) });
    athlete.root.position.set(40, 0, -MID_Y);
    this.scene.add(athlete.root);
    this.preview = { athlete, material, time: 0 };
  }

  // drop every athlete: athleteFor builds them again on the next frame
  rebuildAthletes() {
    for (const p of [...(this.flops || new Map()).keys()]) this.endFlop(p, false);
    if (this.tackle) { this.tackle.physics.restore(); this.tackle = null; }
    for (const a of this.athletes.values()) { this.scene.remove(a.root); a.dispose(); }
    this.athletes.clear();
  }

  clearPlayerPreview() {
    if (!this.preview) return;
    const { athlete, material } = this.preview;
    this.scene.remove(athlete.root);
    athlete.dispose();
    material.dispose();
    this.preview = null;
    this.ballMesh.visible = true;
  }

  renderPlayerPreview(dt, bounds) {
    const { athlete } = this.preview;
    for (const a of this.athletes.values()) a.root.visible = false;
    for (const mesh of [this.ballMesh, this.ballShadow, this.ring, this.losLine, this.fdLine, this.art]) mesh.visible = false;
    this.preview.time += dt;
    athlete.mixer.update(dt);
    if (athlete.kooky) athlete.kooky.update(athlete, dt);
    athlete.root.rotation.y = 0.21 + Math.sin(this.preview.time * 0.9) * 0.30;
    const { x, z } = athlete.root.position;
    this.key.position.x = this.key.target.position.x = x;
    const { camera, W, H, cssW, cssH } = this;
    camera.position.set(x + 1.50, 1.38, z + 4.55);
    camera.lookAt(x, 1.03, z);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(2.74 * cssH / (9.6 * bounds.height)));
    camera.setViewOffset(W, H, W * (0.5 - (bounds.left + bounds.width / 2) / cssW),
      H * (0.5 - (bounds.top + bounds.height / 2) / cssH), W, H);
    this.render();
  }

  watchPlayEvents(w) {
    const stopTackles = w.bus.on("tackle", ({ carrier, tackler, approach, fumble, power }) => {
      const flip = w.possession !== "home";
      const direction = flip ? -1 : 1;
      const position = (p) => new THREE.Vector3(flip ? 100 - p.x : p.x, p.z, flip ? p.y - FIELD_W : -p.y);
      this.pendingTackle = {
        play: w.playNo, carrier, tackler, fumble, power: power || 0,
        impact: {
          carrierAt: position(carrier), tacklerAt: position(tackler),
          carrierSpeed: new THREE.Vector3(direction * approach.carrierVx, approach.carrierVz, -direction * approach.carrierVy),
          tacklerSpeed: new THREE.Vector3(direction * approach.tacklerVx, approach.tacklerVz, -direction * approach.tacklerVy),
          carrierMass: carrier.r.kg / 100, tacklerMass: tackler.r.kg / 100,
          hit: approach.hit, dive: approach.dive, arm: approach.arm,
        },
      };
      const k = clamp((power || 30) / 45, 0.35, 1.6) * (approach.hit ? 1.5 : 1);
      this.spill(w, carrier, k, tackler); this.spill(w, tackler, k * 0.5);
    });
    // every other knockdown: the force at the moment it happens (the sim changes velocities right after)
    const knock = (player, kind, from = null, force = 0) => {
      if (!player) return;
      this.knocks.push({ play: w.playNo, player, kind, from, force, vel: this.vel3(w, player), at: this.pos3(w, player), fromAt: from ? this.pos3(w, from) : null, fromVel: from ? this.vel3(w, from) : null, dir: this.dir3(w, player) });
      this.spill(w, player, { truck: 1.5, hit: 1.5, pancake: 1.1, domino: 0.9, stiff: 0.8, bounce: 0.5, ankles: 0.35 }[kind] || 0, from);
    };
    const cheer = (sec) => () => this.pixel?.cheerFor(sec);
    const stopCheers = [w.bus.on("recover", cheer(2.5)), w.bus.on("touchdown", cheer(4)), w.bus.on("interception", cheer(2.5)), w.bus.on("sack", cheer(2)), w.bus.on("fieldGoal", (e) => { if (e.good) this.pixel?.cheerFor(2.5); }), w.bus.on("hitStick", (e) => { if (e.boom) this.pixel?.cheerFor(1.5); }),
      w.bus.on("truck", (e) => { if (e.defender && !e.failed) this.pixel?.cheerFor(1.6); }), w.bus.on("knockover", cheer(1.1)), w.bus.on("firstDown", cheer(0.9)),
      w.bus.on("tackle", (e) => { if ((e.power || 0) > 11) this.pixel?.cheerFor(1.2); })];
    const stopKnocks = [
      w.bus.on("truck", (e) => { if (!e.failed && e.defender) knock(e.defender, "truck", e.player, e.fling || 0); }),
      w.bus.on("pancake", (e) => knock(e.defender, "pancake", e.blocker)),
      w.bus.on("brokenTackle", (e) => { if (e.move !== "truck" && e.move !== "god") knock(e.tackler, e.move === "stiff" ? "stiff" : e.move === "juke" || e.move === "spin" ? "ankles" : "bounce", e.carrier); }),
      w.bus.on("dive", (e) => knock(e.player, "dive")),
      w.bus.on("knockover", (e) => knock(e.player, "domino", e.by, e.speed)),
      w.bus.on("brokenTackle", (e) => { if (e.stagger > 0) this.lurches.set(e.carrier, { t: 0, k: e.stagger, from: this.pos3(w, e.tackler) }); }),
      w.bus.on("slide", (e) => knock(e.player, "slide")),
      w.bus.on("fumble", (e) => this.spill(w, e.player, 1)),
    ];
    const stopThrows = w.bus.on("throw", ({ qb, ball, lob, spike }) => {
      const direction = w.possession === "home" ? 1 : -1;
      this.throwMotion = { play: w.playNo, qb, lob, spike, heading: Math.atan2(direction * ball.vx, -direction * ball.vy) };
    });
    // the coaches react: his team's big play, he celebrates; the other team's, he sulks
    const other = (k) => (k === "home" ? "away" : "home");
    const swing = (team, chance = 1) => { if (!team || Math.random() > chance) return; this.coaches?.[team]?.react(true); if (Math.random() < 0.8) this.coaches?.[other(team)]?.react(false); };
    const stopCoaches = [
      w.bus.on("touchdown", (e) => swing(e.team)), w.bus.on("safety", (e) => swing(e.team)), w.bus.on("fieldGoal", (e) => { if (e.good) swing(e.team, 0.8); }),
      w.bus.on("interception", (e) => swing(e.player?.teamKey)), w.bus.on("sack", (e) => swing(e.tackler?.teamKey, 0.85)),
      w.bus.on("hitStick", (e) => { if (e.boom) swing(e.player?.teamKey, 0.7); }), w.bus.on("truck", (e) => { if (e.defender && !e.failed) swing(e.player?.teamKey, 0.7); }),
      w.bus.on("firstDown", () => swing(w.possession, 0.35)),
    ];
    this.stopWatchingPlayEvents = () => { stopTackles(); stopThrows(); for (const f of stopKnocks) f(); for (const f of stopCheers) f(); for (const f of stopCoaches) f(); };
  }

  // where the coach should stand: the first spot on a sideline, from the action on downfield, that's on screen. He
  // works his own sideline during a play; between plays, while nobody's looking at him, he takes whichever sideline puts
  // him closer to the camera (so he's big enough to see).
  // his middle in frame and his feet above the bottom edge (his outer arm can hang off the side)
  coachSeen(X, Y) {
    const cam = this.camera, v = this.coachW || (this.coachW = new THREE.Vector3());
    v.set(X, 1.5, -Y).project(cam); if (v.z > 1 || Math.abs(v.x) > 0.9 || v.y > 0.9) return false;
    v.set(X, 0.2, -Y).project(cam); return v.z <= 1 && v.y > -0.95;
  }
  coachSpot(c, action, ahead, live) {
    const cam = this.camera, v = this.coachV || (this.coachV = new THREE.Vector3());
    cam.updateMatrixWorld();
    const seen = (X, Y) => this.coachSeen(X, Y);
    const steps = [2, 4, 6, 8, 10, 12, 15, 18, 22, 26, 30, 35, 40, 0, -3, -6, -10, -15];
    const find = (Y) => { for (const d of steps) { const X = THREE.MathUtils.clamp(action + ahead * d, 1, 99); if (seen(X, Y)) return X; } return null; };
    const far = (X, Y) => (X == null ? Infinity : cam.position.distanceTo(v.set(X, 1.5, -Y)));
    const otherY = c.Y < FIELD_W / 2 ? FIELD_W - c.Y : -(c.Y - FIELD_W);
    const here = find(c.Y), there = find(otherY);
    if (!live && there != null && far(there, otherY) < far(here, c.Y) * 0.8 && !seen(c.X, c.Y)) { c.Y = otherY; c.X = there; return there; }
    if (here != null) return here;
    return THREE.MathUtils.clamp(action + ahead * 8, 1, 99);
  }
  // knock some toppings off him (pushed along by whoever hit him)
  spill(w, p, power, by = null) {
    if (!p || power <= 0) return;
    const crumbs = this.athletes.get(p)?.kooky?.crumbs;
    if (!crumbs) return;
    this.crumbs ||= new Crumbs(this.scene);
    const vel = this.vel3(w, p); if (by) vel.add(this.vel3(w, by));
    this.crumbs.burst(this.pos3(w, p).add(new THREE.Vector3(0, 1.1, 0)), vel, crumbs, power);
  }
  // three.js position / velocity / move direction of a sim player (offense coords → stadium → three.js axes)
  pos3(w, p) { const flip = w.possession !== "home"; return new THREE.Vector3(flip ? 100 - p.x : p.x, p.z, flip ? p.y - FIELD_W : -p.y); }
  vel3(w, p) { const d = w.possession !== "home" ? -1 : 1; return new THREE.Vector3(d * p.vx, p.vz || 0, -d * p.vy); }
  dir3(w, p) {
    const d = w.possession !== "home" ? -1 : 1, v = new THREE.Vector3(d * (p.moveDX || p.faceX), 0, -d * (p.moveDY || p.faceY));
    return v.lengthSq() > 1e-4 ? v.normalize() : v.set(d, 0, 0);
  }
  startFlop(p, kind, recipe) {
    const cur = this.flops.get(p);
    // a big hit takes over from a lesser fall (a diving defender who gets trucked still goes flying), starting from
    // the pose he's already in
    if (cur && !(BIG.has(kind) && !BIG.has(cur.kind))) return;
    if (cur) this.flops.delete(p);
    const ath = this.athleteFor(p);
    ath.recover = null;
    this.flops.set(p, new Flop3D(ath, kind, recipe));
  }
  endFlop(p, getUp) {
    const fl = this.flops.get(p);
    if (!fl) return;
    if (getUp) this.athletes.get(p)?.beginRecover();
    fl.restore();
    this.flops.delete(p);
  }
  // The launch for each kind of knockdown, scaled by the force behind it (and the two men's weights)
  recipe(k, p) {
    const m = p.r.kg / 100, H = (v) => v.clone().setY(0);
    const away = k.fromAt ? k.at.clone().sub(k.fromAt).setY(0) : H(k.vel);
    if (away.lengthSq() < 1e-4) away.copy(k.dir);
    away.normalize();
    const own = H(k.vel), sp = own.length(), fwd = sp > 0.5 ? own.clone().normalize() : k.dir.clone();
    const ratio = k.from ? THREE.MathUtils.clamp(Math.sqrt(k.from.r.kg / p.r.kg), 0.75, 1.4) : 1;
    const S = PHYS.SILLY, silly = (v, y) => v.multiplyScalar(S.LAUNCH).setY(y * S.LIFT); // (Snack League: hits are silly)
    switch (k.kind) {
      case "truck": { // the fling: the sim's own shove (up to 24 yd/s behind a big back at full speed), and up he goes
        const f = k.force, push = k.fromVel ? H(k.fromVel).normalize() : away;
        return { velocity: push.clone().multiplyScalar(1.5 + f * 0.5).setY(Math.min(7.5, (1.2 + f * 0.24) * S.LIFT)), drive: push.multiplyScalar((2.6 + f * 0.4) * S.DRIVE), planted: 0.6, drop: 0.5, mass: m };
      }
      case "pancake": return { velocity: silly(away.clone().multiplyScalar(2.6 * ratio), 1.3), drive: away.clone().multiplyScalar(3.8 * ratio * S.DRIVE), planted: 0.7, drop: 0.7, mass: m };
      case "stiff": return { velocity: silly(away.clone().multiplyScalar(3 * ratio), 1.1), drive: away.clone().multiplyScalar(3.6 * ratio * S.DRIVE), planted: 0.65, drop: 1, mass: m };
      case "ankles": { // juked out of his shoes: he keeps lunging where the runner was and goes down on his face
        const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(Math.random() < 0.5 ? -1 : 1);
        return { velocity: own.clone().multiplyScalar(0.85).setY(0.3), drive: fwd.clone().multiplyScalar(2).addScaledVector(side, 1.4), planted: 0.9, drop: 2, mass: m };
      }
      case "bounce": return { velocity: away.clone().multiplyScalar(1.6 * ratio * S.LAUNCH).addScaledVector(own, 0.3).setY(0.4 * S.LIFT), drive: away.clone().multiplyScalar(2.2), planted: 0.7, drop: 1.2, mass: m };
      case "dive": // a superman dive on his own momentum: the sim's launch (out and up), the body laid out flat along it
        return { velocity: k.vel.clone(), drive: k.dir.clone().multiplyScalar(4 + sp * 0.25), planted: 0.12, drop: 2.6, mass: m, speed: 1 };
      case "domino": { // bowled over by a flying body: along that body's line, harder the faster it was going
        const push = k.fromVel && H(k.fromVel).lengthSq() > 0.01 ? H(k.fromVel).normalize() : away, f = k.force;
        return { velocity: push.clone().multiplyScalar(f * 0.75).setY(Math.min(7, (0.6 + f * 0.12) * S.LIFT)), drive: push.multiplyScalar((2 + f * 0.35) * S.DRIVE), planted: 0.6, drop: 0.7, mass: m };
      }
      case "slide": return { velocity: fwd.clone().multiplyScalar(Math.max(sp * 0.9, 3)).setY(0.2), drive: fwd.clone().multiplyScalar(-2.8), planted: 0, drop: 1.4, mass: m, speed: 0.95 };
      default: return { velocity: own.clone().multiplyScalar(0.7).setY(0.3), drive: fwd.clone().multiplyScalar(2.6), planted: 0.6, drop: 1.6, mass: m }; // a trip / a whiff
    }
  }
  syncFlops(w, tackle) {
    const onField = w.phase === "live" || w.phase === "dead";
    if (!onField || w.playNo !== this.flopPlay) { for (const p of [...this.flops.keys()]) this.endFlop(p, false); this.flopPlay = w.playNo; }
    const knocks = this.knocks; this.knocks = [];
    const busy = (p) => p === tackle?.carrier || p === tackle?.tackler || this.flops.has(p);
    for (const k of knocks) {
      const p = k.player, inTackle = p === tackle?.carrier || p === tackle?.tackler;
      if (!onField || k.play !== w.playNo || !w.players.includes(p) || inTackle || (this.flops.has(p) && !BIG.has(k.kind))) continue;
      this.startFlop(k.player, k.kind, this.recipe(k, k.player));
    }
    // anybody else the sim put on the ground (a whiffed dive or hit stick, a fumble with no tackle): he trips
    for (const p of w.players) {
      const was = this.wasDown.get(p) || 0;
      this.wasDown.set(p, p.down);
      if (w.phase === "live" && p.down > 0 && !(was > 0) && !busy(p)) this.startFlop(p, "trip", this.recipe({ vel: this.vel3(w, p), at: this.pos3(w, p), dir: this.dir3(w, p), kind: "trip" }, p));
    }
  }

  syncTackle(w) {
    const onField = w.phase === "live" || w.phase === "dead";
    const pending = this.pendingTackle;
    this.pendingTackle = null;
    if (this.tackle && (!onField || w.playNo !== this.tackle.play || pending)) {
      this.tackle.physics.restore();
      this.tackle = null;
    }
    if (pending && onField && w.playNo === pending.play && w.players.includes(pending.carrier) && w.players.includes(pending.tackler)) {
      const { carrier, tackler, impact } = pending;
      for (const p of [carrier, tackler]) this.endFlop(p, false);
      if (impact.hit) {
        // a hit stick lands: nobody holds on. The runner is blown backwards (and up, with enough behind it); the
        // hitter follows through onto the turf
        const n = impact.carrierAt.clone().sub(impact.tacklerAt).setY(0);
        if (n.lengthSq() < 1e-4) n.copy(impact.tacklerSpeed).setY(0);
        if (n.lengthSq() < 1e-4) n.set(1, 0, 0);
        n.normalize();
        const f = THREE.MathUtils.clamp((pending.power || 40) / 50, 0.5, 1.8) * Math.sqrt(impact.tacklerMass / impact.carrierMass);
        this.startFlop(carrier, "hit", {
          velocity: n.clone().multiplyScalar((2.5 + 4.2 * f) * PHYS.SILLY.LAUNCH).addScaledVector(impact.carrierSpeed.clone().setY(0), 0.25).setY(Math.min(11, (1.6 + 2.8 * f) * PHYS.SILLY.LIFT)),
          drive: n.clone().multiplyScalar((3 + 3.2 * f) * PHYS.SILLY.DRIVE), planted: 0.4, drop: 0.3, mass: impact.carrierMass, speed: 0.8,
        });
        this.startFlop(tackler, "follow", {
          velocity: impact.tacklerSpeed.clone().setY(0).multiplyScalar(0.5).setY(0.5),
          drive: n.clone().multiplyScalar(3.4), planted: 0.35, drop: 2.2, mass: impact.tacklerMass, speed: 0.8,
        });
      } else this.tackle = { ...pending, physics: new Tackle3D(this.athleteFor(carrier), this.athleteFor(tackler), impact) };
    }

    const tackle = this.tackle;
    if (tackle?.fumble) {
      for (const role of ["carrier", "tackler"]) {
        const player = tackle[role];
        // A player can get back up or recover the ball before the fumble is whistled dead.
        if (player === w.ball.carrier || (w.phase === "live" && player.canAct && player.move !== "dive")) tackle.physics.release(role);
      }
      if (!tackle.physics.carrier && !tackle.physics.tackler) this.tackle = null;
    }
  }

  drawThrowRelease(w) {
    const shot = this.throwMotion;
    if (!shot || shot.qb.down > 0 || shot.qb.anim !== "throw") return false;
    const b = w.ball;
    const isPass = b.state === "air" && !b.tipped && b.thrower === shot.qb && (b.kind === "pass" || b.kind === "lob");
    if (!isPass && !(shot.spike && w.result?.spike && b.state === "dead")) return false;
    const athlete = this.athletes.get(shot.qb);
    if (!athlete) return false;
    const ball = this.ballMesh;
    const afterRelease = shot.qb.animT - throwReleaseTime(shot);
    if (afterRelease < 0) {
      athlete.gripWorld(ball.position, ball.quaternion);
      return true;
    }
    const duration = shot.spike ? 0.09 : 0.18;
    if (afterRelease >= duration) return false;
    if (!shot.offset) {
      shot.rotation = new THREE.Quaternion();
      shot.offset = athlete.gripWorld(new THREE.Vector3(), shot.rotation).sub(ball.position);
      shot.offsetStart = afterRelease;
    }
    const fade = 1 - THREE.MathUtils.smoothstep(afterRelease, shot.offsetStart, duration);
    ball.position.addScaledVector(shot.offset, fade);
    ball.quaternion.slerp(shot.rotation, fade);
    return false;
  }

  // the World → the scene, once per frame
  sync(w, dt, opts) {
    this.stadiumT = (this.stadiumT || 0) + dt;
    this.pixel?.update(dt, this.stadiumT, w.phase === "init" ? null : jumboInfo(w, this.kits));
    const flipC = w.possession !== "home";
    const bc = w.ball.carrier;
    const scrim = w.playType === "normal" || w.playType === "two";
    const ballAir = w.ball.state === "air" && (w.ball.kind === "pass" || w.ball.kind === "lob");
    const pre = w.phase === "live" && scrim && !w.passThrown && !w.handedOff && !w.losCrossed && !ballAir && (!bc || bc === w.qb);
    const stKick = (w.playType === "kickoff" || w.playType === "punt") && (w.phase === "live" || w.phase === "presnap") && !bc;
    const seen = new Set();
    const a = this.abs || (this.abs = { X: 0, Y: 0, fX: 1, fY: 0, vx: 0, vy: 0, moveX: 0, moveY: 0 });
    const ex = this.ex || (this.ex = { stance: false, throw: null });
    if (this.throwMotion && (this.throwMotion.play !== w.playNo || (w.phase !== "live" && w.phase !== "dead") ||
      this.throwMotion.qb.animT >= THROW_END)) this.throwMotion = null;
    const shot = this.throwMotion;
    this.syncTackle(w);
    const tackle = this.tackle;
    this.syncFlops(w, tackle);
    for (const p of w.players) {
      seen.add(p);
      const ath = this.athleteFor(p);
      ath.root.visible = true;
      if ((p === tackle?.carrier && tackle.physics.carrier) || (p === tackle?.tackler && tackle.physics.tackler)) continue;
      const fl = this.flops.get(p);
      if (fl) {
        // he gets up once the sim has him back on his feet (after the whistle: a moment later)
        const up = fl.elapsed > 0.45 && p.down <= 0 && p.stun <= 0 && p !== w.ball.carrier;
        if (up && (w.phase === "live" || (w.phase === "dead" && w.phaseT > 1.2))) this.endFlop(p, true);
        else continue;
      }
      a.X = flipC ? 100 - p.x : p.x; a.Y = flipC ? FIELD_W - p.y : p.y;
      a.vx = flipC ? -p.vx : p.vx; a.vy = flipC ? -p.vy : p.vy;
      a.moveX = flipC ? -p.moveDX : p.moveDX; a.moveY = flipC ? -p.moveDY : p.moveDY;
      // facing (render.js): the QB's eyes downfield in his drop, pass protectors face the rush, DBs backpedal facing the QB
      let fX = p.faceX, fY = p.faceY;
      if (pre) {
        const vx = p.vx, avy = Math.abs(p.vy), as = p.as, sp2 = vx * vx + avy * avy;
        if (p.side === "O") { if (p === w.qb ? vx < 0.8 && avy < 4.5 : as && as.kind === "block" && as.block === "pass" && vx < 0.5 && sp2 < 16) { fX = 1; fY = 0; } }
        else if (as && (as.kind === "zone" || as.kind === "man" || as.kind === "spy") && !p.move && vx > -0.5 && sp2 < 42 && (avy < 4.5 || vx > avy * 0.5)) { fX = -1; fY = 0; }
      } else if (p === w.qb && scrim && w.phase === "live" && w.passThrown && ballAir && p.vx * p.vx + p.vy * p.vy < 16) { fX = 1; fY = 0; }
      else if (stKick && !p.down) { fX = p.side === "D" ? (w.ball.x >= p.x ? 1 : -1) : 1; fY = 0; }
      if (w.phase === "presnap" && !p.down) { fX = p.side === "O" ? 1 : -1; fY = 0; }
      a.fX = flipC ? -fX : fX; a.fY = flipC ? -fY : fY;
      ex.stance = w.phase === "presnap" && /^(LT|LG|C|RG|RT|DE1|DE2|NT|ILB2)$/.test(p.slot) && w.phaseT > 0.6;
      ex.throw = p === shot?.qb ? shot : null;
      // the receiver of a pass in the air reaches for it as it comes in (and, for a beat after the catch, holds it out)
      ex.catchAt = null; ex.catchW = 0; ex.lurch = null;
      // a tackler closing on the runner squares up and reaches for him (so contact always reads as a tackle)
      if (bc && bc !== p && bc.side !== p.side && w.phase === "live" && w.ball.state === "held" && p.canAct && !p.move && !p.engaged) {
        const dx = bc.x - p.x, dy = bc.y - p.y, d = Math.hypot(dx, dy), closing = (p.vx - bc.vx) * dx + (p.vy - bc.vy) * dy;
        if (d < 2.3 && closing > 0) {
          const them = this.athletes.get(bc);
          if (them) { ex.catchAt = them.chestWorld(this.catchSpot2 || (this.catchSpot2 = new THREE.Vector3())); ex.catchAt.y -= 0.25; ex.catchW = THREE.MathUtils.smoothstep(2.3 - d, 0, 1.2); ex.lunge = ex.catchW; }
        }
      }
      if (!ex.catchAt) ex.lunge = 0;
      const lu = this.lurches.get(p);
      if (lu) { lu.t += dt; if (lu.t > 0.32 || p.down > 0) this.lurches.delete(p); else ex.lurch = lu; }
      if (ballAir && w.ball.target === p) {
        const b = w.ball, d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < 4.5) {
          ex.catchAt = this.catchSpot || (this.catchSpot = new THREE.Vector3());
          ex.catchAt.set(flipC ? 100 - b.x : b.x, Math.max(0.6, b.z || 0), flipC ? b.y - FIELD_W : -b.y);
          ex.catchW = THREE.MathUtils.smoothstep(4.5 - d, 0, 3);
        }
      } else if (p.hasBall && p.anim === "catch" && p.animT < 0.4 && w.phase === "live") {
        const ath0 = this.athleteFor(p);
        ex.catchAt = this.catchSpot || (this.catchSpot = new THREE.Vector3());
        ath0.chestWorld(ex.catchAt); ex.catchAt.y -= 0.12;
        const fwd = Math.sin(ath0.heading), fwz = Math.cos(ath0.heading);
        ex.catchAt.x += fwd * 0.45; ex.catchAt.z += fwz * 0.45;
        ex.catchW = 1 - THREE.MathUtils.smoothstep(p.animT, 0.22, 0.4);
      }
      p.animT = (p.animT || 0) + dt;
      ath.sync(p, a, w, dt, ex);
    }
    tackle?.physics.update(dt);
    for (const fl of this.flops.values()) fl.update(dt);
    this.crumbs?.update(dt);
    if (this.coaches && w.phase !== "init") {
      // your coach keeps up with the play down his sideline, always somewhere the camera can see him
      const live = w.phase === "live", home = w.possession === "home", ahead = home ? 1 : -1;
      const action = live || w.phase === "dead" ? (home ? w.ball.x : 100 - w.ball.x) : home ? w.los : 100 - w.los;
      for (const c of Object.values(this.coaches)) {
        const spot = this.coachSpot(c, action, ahead, live);
        if (!this.coachSeen(c.X, c.Y) && Math.abs(spot - c.X) > 3) c.X = spot - Math.sign(spot - c.X) * 3; // (off camera, he catches up)
        // drawn big enough to read from the broadcast camera however far off he is
        const d = this.camera.position.distanceTo(this.coachV.set(c.X, 1.5, -c.Y)), span = 2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
        c.size(THREE.MathUtils.clamp(span * 0.11, 3.3, 8));
        c.update(dt, spot, live);
      }
    }
    for (const [p, ath] of this.athletes) if (!seen.has(p)) ath.root.visible = false;
    // the ball: in the carrier's hand, in flight, or on the turf
    const b = w.ball, B = this.ballMesh;
    const bX = flipC ? 100 - b.x : b.x, bY = flipC ? FIELD_W - b.y : b.y;
    let windingUp = false;
    if (b.state === "held" && b.carrier && this.athletes.get(b.carrier)) {
      const ath = this.athletes.get(b.carrier);
      const ragdoll = (b.carrier === tackle?.carrier && tackle.physics.carrier) || this.flops.has(b.carrier);
      const caught = !ragdoll && b.carrier.anim === "catch" && b.carrier.animT < 0.3 && w.phase === "live";
      if (caught) { ath.palmsWorld(B.position); B.rotation.set(0, ath.heading + Math.PI / 2, 0); }
      else if (ragdoll || ath.ballGripped) ath.gripWorld(B.position, B.quaternion);
      else {
        ath.handWorld(B.position);
        B.rotation.set(0, ath.heading, 0); B.rotateX(-0.5);
      }
    } else {
      B.position.set(bX, Math.max(0.12, b.z || 0), -bY);
      const vx = flipC ? -b.vx : b.vx, vy = flipC ? -b.vy : b.vy;
      if (b.state === "loose" && Math.hypot(vx, vy) > 0.4) { // a loose ball tumbles end over end, faster the faster it goes
        this.tumble = (this.tumble || 0) + Math.hypot(vx, vy) * dt * 2.2;
        B.rotation.set(0, Math.atan2(vx, -vy), 0); B.rotateX(this.tumble); B.rotateZ(this.tumble * 0.37);
      } else if (b.state === "air" && Math.hypot(vx, vy) > 1) { B.rotation.set(0, Math.atan2(vx, -vy), 0); B.rotateX(-Math.atan2(b.vz || 0, Math.hypot(vx, vy)) * 0.8); if (b.kind === "pass" || b.kind === "lob") B.rotateZ(performance.now() * 0.03); else B.rotateX(performance.now() * 0.02); }
      windingUp = this.drawThrowRelease(w);
    }
    this.ballShadow.position.set(B.position.x, 0.02, B.position.z);
    this.ballShadow.visible = (b.state === "air" || (b.state === "loose" && b.z > 0.05)) && !windingUp;
    // lines
    const showLines = opts.showLines;
    this.losLine.visible = showLines && opts.losX != null; this.fdLine.visible = showLines && opts.fdX != null;
    if (opts.losX != null) this.losLine.position.x = opts.losX;
    if (opts.fdX != null) this.fdLine.position.x = opts.fdX;
    // controlled player's ring
    const c = w.control && !w.autopilot ? w.control : null;
    this.ring.visible = Boolean(c) && opts.showRing;
    if (c) { const ath = this.athletes.get(c); if (ath) this.ring.position.set(ath.root.position.x, 0.04, ath.root.position.z); }
    // key light follows the play (keeps the shadow map's detail where the action is)
    const fx = B.position.x;
    this.key.position.set(fx, 70, 40); this.key.target.position.set(fx, 0, -MID_Y);
    // play art
    this.drawArt(opts.playArt);
  }

  drawArt(segs) {
    const g = this.art.geometry;
    if (!segs || !segs.length) { this.art.visible = false; return; }
    this.art.visible = true;
    const rev = segs.reveal == null ? 1 : segs.reveal;
    const pos = [], col = [], c = new THREE.Color(), HW = 0.16;
    // each segment a flat ribbon on the turf (lines are one pixel wide in WebGL); an arrowhead on a route's last one
    const quad = (ax, ay, bx, by, hw) => {
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * hw, ny = (dx / L) * hw;
      const P = [[ax + nx, ay + ny], [ax - nx, ay - ny], [bx - nx, by - ny], [ax + nx, ay + ny], [bx - nx, by - ny], [bx + nx, by + ny]];
      for (const [x, y] of P) { pos.push(x, 0.05, -y); col.push(c.r, c.g, c.b); }
    };
    for (const s of segs) {
      const [x0, y0, x1, y1, u32, head, f0 = 0, f1 = 1] = s;
      if (f0 >= rev) continue;
      const t = f1 <= rev ? 1 : (rev - f0) / Math.max(1e-6, f1 - f0);
      const ex = x0 + (x1 - x0) * t, ey = y0 + (y1 - y0) * t;
      c.setRGB((u32 & 255) / 255, ((u32 >>> 8) & 255) / 255, ((u32 >>> 16) & 255) / 255, THREE.SRGBColorSpace);
      quad(x0, y0, ex, ey, HW);
      if (head && t >= 1) {
        const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
        const bx = x1 - ux * 1.1, by = y1 - uy * 1.1;
        for (const [x, y] of [[x1 + ux * 0.3, y1 + uy * 0.3], [bx - uy * 0.7, by + ux * 0.7], [bx + uy * 0.7, by - ux * 0.7]]) { pos.push(x, 0.05, -y); col.push(c.r, c.g, c.b); }
      }
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    
  }

  // the sim's camera rig → the three.js camera (a level camera with the original's shifted lens)
  applyCamera(cam) {
    const C = this.camera, W = this.W, H = this.H;
    C.position.set(cam.x, cam.h, -cam.y);
    v3.set(cam.x + Math.cos(cam.ang), cam.h, -(cam.y + Math.sin(cam.ang)));
    C.up.set(0, 1, 0); C.lookAt(v3);
    C.aspect = W / H;
    C.fov = (2 * Math.atan(H / 2 / cam.F) * 180) / Math.PI;
    C.setViewOffset(W, H, -(cam.shakeX || 0), H / 2 - cam.hy - (cam.shakeY || 0), W, H);
    C.updateProjectionMatrix();
  }
  render() { this.gl.render(this.scene, this.camera); }

  // stadium point → CSS px on screen (or null behind the camera)
  toScreen(X, Y, Z, out) {
    v3.set(X, Z, -Y).project(this.camera);
    if (v3.z > 1) return null;
    out.x = (v3.x * 0.5 + 0.5) * this.cssW; out.y = (-v3.y * 0.5 + 0.5) * this.cssH;
    return out;
  }
  // an athlete's head on screen (for the pass icons)
  headScreen(p, out) {
    const a = this.athletes.get(p);
    if (!a) return null;
    a.headWorld(v3); v3.y += 0.75; v3.project(this.camera);
    if (v3.z > 1) return null;
    out.x = (v3.x * 0.5 + 0.5) * this.cssW; out.y = (-v3.y * 0.5 + 0.5) * this.cssH;
    return out;
  }
  // the player whose body is nearest a screen point (CSS px), among those ok(p) accepts, within reach px
  pick(px, py, ok, reach = 40) {
    let best = null, bd = reach;
    const o = { x: 0, y: 0 };
    for (const [p, a] of this.athletes) {
      if (!a.root.visible || !ok(p)) continue;
      a.chestWorld(v3); v3.project(this.camera);
      if (v3.z > 1) continue;
      o.x = (v3.x * 0.5 + 0.5) * this.cssW; o.y = (-v3.y * 0.5 + 0.5) * this.cssH;
      const d = Math.hypot(o.x - px, o.y - py);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}
