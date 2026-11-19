// The title screen's highlight reel: the CPU-vs-CPU game behind the menu, shot like a highlight package. The camera cuts
// between a low sideline tracking shot, a chase cam behind the ball carrier, a hero angle in front of him and a high
// wide shot, every few seconds; big moments (a truck, a big hit, a pick, a touchdown) get a cut and slow motion.
import * as THREE from "three";
import { FIELD_W } from "./sim/config.js";

const SHOTS = ["track", "chase", "hero", "track", "chase", "sky"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class HighlightReel {
  constructor() {
    this.pos = new THREE.Vector3(50, 14, 10); this.look = new THREE.Vector3(50, 0, -FIELD_W / 2); this.fov = 42;
    this.shot = "sky"; this.shotT = 0; this.cut = 3; this.slow = 0; this.side = 1; this.snap = true; this.timeScale = 1;
    this.dir = new THREE.Vector3(1, 0, 0);
  }
  // a big moment: slow motion and a dramatic angle
  event(kind) {
    this.slow = kind === "touchdown" ? 2.4 : 1.5;
    this.next(kind === "touchdown" ? "hero" : pick(["hero", "track"]));
  }
  next(name) { this.shot = name || pick(SHOTS.filter((s) => s !== this.shot)); this.shotT = 0; this.cut = 2.6 + Math.random() * 2.6; this.side = Math.random() < 0.5 ? -1 : 1; this.snap = true; }
  // the subject in three.js space: the ball carrier, else the ball
  subject(w, out) {
    const flip = w.possession !== "home", c = w.ball.carrier, p = c || w.ball;
    const X = flip ? 100 - p.x : p.x, Y = flip ? FIELD_W - p.y : p.y, vx = (flip ? -1 : 1) * (p.vx || 0), vy = (flip ? -1 : 1) * (p.vy || 0);
    out.set(X, c ? 1.0 : Math.max(0.5, p.z || 0), -Y);
    if (Math.hypot(vx, vy) > 1.5) this.dir.lerp(new THREE.Vector3(vx, 0, -vy).normalize(), 0.08).normalize();
    else if (!c) this.dir.set(flip ? -1 : 1, 0, 0);
    return out;
  }
  update(dt, w) {
    if (this.slow > 0) this.slow -= dt;
    this.timeScale = this.slow > 0 ? 0.3 : 1;
    this.shotT += dt;
    const live = w.phase === "live";
    if (this.shotT > this.cut) this.next(live ? null : "sky");
    else if (!live && this.shot !== "sky" && this.shotT > 1.4 && this.slow <= 0) this.next("sky");
    const T = this.subject(w, this.tmp || (this.tmp = new THREE.Vector3())), d = this.dir, s = this.side;
    const side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(s);
    let pos, look, fov;
    if (this.shot === "track") { pos = T.clone().addScaledVector(d, -2.5).addScaledVector(side, 8.5).setY(1.3); look = T.clone().addScaledVector(d, 1.5).setY(1.1); fov = 34; }
    else if (this.shot === "chase") { pos = T.clone().addScaledVector(d, -6.5).addScaledVector(side, 1.2).setY(2.6); look = T.clone().addScaledVector(d, 5).setY(0.9); fov = 52; }
    else if (this.shot === "hero") { pos = T.clone().addScaledVector(d, 6.5).addScaledVector(side, 2.6).setY(0.55); look = T.clone().setY(1.3); fov = 38; }
    else { const a = this.shotT * 0.12; pos = T.clone().add(new THREE.Vector3(Math.cos(a) * 14 * s, 17, Math.sin(a) * 14 + 14)); look = T.clone(); fov = 44; }
    pos.y = Math.max(0.35, pos.y);
    const k = this.snap ? 1 : 1 - Math.exp(-dt * (this.shot === "sky" ? 2 : 5));
    this.pos.lerp(pos, k); this.look.lerp(look, k); this.fov += (fov - this.fov) * k; this.snap = false;
  }
  apply(C, W, H) {
    C.position.copy(this.pos); C.up.set(0, 1, 0); C.lookAt(this.look);
    C.aspect = W / H; C.fov = this.fov; C.clearViewOffset(); C.updateProjectionMatrix();
  }
}
