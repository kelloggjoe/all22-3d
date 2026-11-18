// Draft-board portraits: each snack rendered once in a team's kit (a small offscreen renderer, cached per kit).
import * as THREE from "three";
import { Athlete } from "./players3d.js";
import { SNACKS } from "./snacks.js";

let R = null;
const cache = new Map();
export function snackPortraits(kit, size = 168) {
  const key = JSON.stringify(kit);
  if (cache.has(key)) return cache.get(key);
  if (!R) {
    R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    R.setPixelRatio(1); R.setSize(size, size, false); R.outputColorSpace = THREE.SRGBColorSpace;
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#5b6b7a", 2.2));
  const sun = new THREE.DirectionalLight("#fff4e0", 2.4); sun.position.set(2, 4, 5); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  const out = {}, box = new THREE.Box3(), c = new THREE.Vector3(), sz = new THREE.Vector3();
  for (const s of SNACKS) {
    const a = new Athlete(null, kit, { num: "", snack: s.key, kooky: s.body, m: s.sp.m, kg: s.sp.kg });
    a.mixer.update(0.4); a.kooky.update(a, 0);
    a.root.rotation.y = -0.4; scene.add(a.root); a.root.updateMatrixWorld(true);
    box.makeEmpty();
    a.root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh && o.visible && o.material.type !== "ShaderMaterial") box.expandByObject(o); });
    box.getCenter(c); box.getSize(sz);
    const h = sz.y * 0.62; c.y = box.max.y - h / 2; // the snack and its face, not the legs
    const d = (Math.max(h, sz.x * 0.9) / 2) / Math.tan(THREE.MathUtils.degToRad(12)) * 1.08;
    cam.position.set(c.x + d * 0.08, c.y + d * 0.1, c.z + d); cam.lookAt(c);
    R.render(scene, cam);
    out[s.key] = R.domElement.toDataURL("image/png");
    scene.remove(a.root);
  }
  cache.set(key, out);
  return out;
}

// The draft card's live stage: the snack under the cursor, full size, turning slowly and running through football
// moves (stance, sprint, throw, stiff arm, leap, block, celebrate). Its own small renderer, updated from the app loop.
const ROUTINE = [
  ["Crouch_Idle_Loop", 1.8], ["Sprint_Loop", 1.6], ["Spell_Simple_Shoot", 0], ["Punch_Jab", 0], ["Jump_Start", 0, "Jump_Loop", 0.5, "Jump_Land"],
  ["Push_Loop", 1.8], ["Dance_Loop", 2.6], ["Idle_Talking_Loop", 1.8], ["Sword_Attack", 0], ["Hit_Chest", 0],
];
export class SnackStage {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "dstage";
    this.r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.r.setPixelRatio(Math.min(devicePixelRatio, 2)); this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#4a5868", 2.1));
    const sun = new THREE.DirectionalLight("#fff4e0", 2.6); sun.position.set(2, 4, 5); this.scene.add(sun);
    const rim = new THREE.DirectionalLight("#9fc4ff", 1.6); rim.position.set(-3, 3, -4); this.scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.28 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.005; this.scene.add(disc);
    this.cam = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    this.a = null; this.key = ""; this.spin = 0.5; this.left = 0; this.queue = [];
  }
  show(key, kit, num = "") {
    const id = `${key}|${num}|${kit.jersey}`;
    if (id === this.key) return;
    this.key = id;
    if (this.a) { this.scene.remove(this.a.root); this.a.dispose(); }
    const s = SNACKS.find((x) => x.key === key);
    this.a = new Athlete(null, kit, { num, snack: key, kooky: s.body, m: s.sp.m, kg: s.sp.kg });
    this.scene.add(this.a.root);
    this.queue = []; this.left = 0; this.last = -1;
    this.a.play("Idle_Loop", 0); this.left = 0.5;
  }
  // the next move: a random routine, played through clip by clip (a hold of 0 = the clip's own length)
  next() {
    if (!this.queue.length) {
      let k; do k = Math.floor(Math.random() * ROUTINE.length); while (k === this.last);
      this.last = k; const r = ROUTINE[k];
      for (let i = 0; i < r.length; i += 2) this.queue.push([r[i], r[i + 1] ?? 0]);
      this.queue.push(["Idle_Loop", 0.7]);
    }
    const [clip, hold] = this.queue.shift(), act = this.a.actions[clip];
    this.a.play(clip, 0.2);
    this.left = hold || (act ? act.getClip().duration * 0.95 : 1);
  }
  update(dt) {
    const a = this.a, c = this.canvas;
    if (!a || !c.isConnected) return;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * this.r.getPixelRatio())) { this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }
    this.left -= dt;
    if (this.left <= 0) this.next();
    a.mixer.update(dt); a.kooky.update(a, dt);
    a.root.position.set(0, 0, 0); a.root.rotation.y += dt * this.spin;
    const top = 2.15 * (SNACKS.find((x) => this.key.startsWith(x.key + "|"))?.body.height || 1);
    const d = (top * 0.54) / Math.tan(THREE.MathUtils.degToRad(14)) / Math.min(1, this.cam.aspect * 1.25);
    this.cam.position.set(0, top * 0.55, d); this.cam.lookAt(0, top * 0.47, 0);
    this.r.render(this.scene, this.cam);
  }
}
