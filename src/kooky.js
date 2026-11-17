// KOOKY characters: each player is a toon blob built from fused ellipsoids on the same skeleton the CLASSIC players
// use, so every animation, football move and ragdoll tackle still drives him. A player's DNA comes from his ratings
// (heavy men come out round, fast men noodly) plus seeded nonsense: googly eyes, giant heads, stubby legs, horns.
import * as THREE from "three";
import { createRng } from "./sim/rng.js";

// ---------- DNA ----------
const SKINS = [
  "#8fd694", "#b8a1f0", "#ffb36b", "#7cc6fe", "#ff9ec7", "#c7e84f", "#6fd6c2", "#f4d35e", "#a3b8ff", "#ff8f70",
  "#d9a7e8", "#9be7a8", "#ffd6a5", "#e8b492", "#bc8b67", "#8d5f43",
];
const BODIES = ["potato", "pear", "bean", "barrel", "egg"];
const HEADS = ["round", "round", "bean", "box", "tall", "wide"];
const TOPPERS = ["none", "none", "antenna", "antennae", "horns", "sprout", "mohawk", "ears", "floppy", "tuft"];
const MOUTHS = ["grin", "grin", "o", "teeth", "tongue", "flat"];
const NOSES = ["none", "button", "button", "big", "snout"];
const HELMETS = ["full", "full", "tiny", "none"];
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) || 7; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// a player's DNA: deterministic for his id and name (its own random stream, so rosters stay as they were)
export function kookyDNA(player) {
  const rng = createRng(hash(`kooky|${player.id}|${player.full || player.name}`));
  const sp = player.sp || { kg: 100, m: 1.85 }, r = player.r || {};
  const fat = clamp((sp.kg / (sp.m * sp.m) - 26) / 14, 0, 1); // how round: linemen near 1, receivers near 0
  const quick = clamp(((r.speed || 7) - 6.1) / 2.2, 0, 1);
  const g = () => rng.gauss() * 0.5;
  const pickW = (list, w) => { let t = rng.next() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < list.length; i++) { t -= w[i]; if (t <= 0) return list[i]; } return list[0]; };
  const noodle = rng.chance(0.18 + quick * 0.2);
  const body = fat > 0.6 ? pickW(BODIES, [3, 2, 0, 3, 1]) : quick > 0.6 ? pickW(BODIES, [1, 1, 4, 0, 2]) : rng.pick(BODIES);
  const eyes = pickW([1, 2, 3, 4], [16, 60, 14, 10]);
  return {
    skin: rng.chance(0.82) ? rng.pick(SKINS.slice(0, 13)) : rng.pick(SKINS.slice(13)),
    body,
    girth: clamp(0.62 + fat * 0.75 + g() * 0.25, 0.5, 1.55), // torso width multiplier
    belly: clamp(0.3 + fat * 0.9 + g() * 0.3, 0, 1.3), // how far the belly sticks out
    torso: clamp(1 + g() * 0.25 + (body === "bean" ? 0.15 : 0), 0.75, 1.35), // spine length
    head: clamp(1.15 + g() * 0.55 + (player.slot === "QB" ? 0.2 : 0) + (rng.chance(0.12) ? 0.55 : 0), 0.75, 2.1),
    headShape: rng.pick(HEADS),
    neck: rng.chance(0.12) ? 1.9 + rng.next() * 0.8 : clamp(0.6 + rng.next() * 0.6, 0.35, 1.2),
    legs: clamp(0.68 + quick * 0.4 - fat * 0.2 + g() * 0.2, 0.42, 1.3),
    legFat: clamp((noodle ? 0.55 : 0.85) + fat * 0.7 + g() * 0.15, 0.45, 1.6),
    arms: clamp((noodle ? 1.25 : 0.95) + g() * 0.2 + (player.slot === "QB" ? 0.1 : 0), 0.7, 1.55),
    armFat: clamp((noodle ? 0.55 : 0.9) + fat * 0.5 + g() * 0.15, 0.45, 1.5),
    hands: clamp(1 + rng.next() * 0.9 + (/^WR|TE/.test(player.slot || "") ? 0.3 : 0), 0.9, 2.2),
    feet: clamp(1 + rng.next() * 0.9, 0.9, 2),
    eyes, eyeSize: clamp(0.3 + rng.next() * 0.22 - eyes * 0.03, 0.18, 0.5), eyeOdd: rng.chance(0.3),
    lids: rng.chance(0.22), pupils: rng.chance(0.15) ? "tiny" : "big",
    mouth: rng.pick(MOUTHS), nose: rng.pick(NOSES),
    topper: rng.pick(TOPPERS), helmet: rng.pick(HELMETS), mask: rng.chance(0.6),
    pads: clamp(0.8 + fat * 0.6 + g() * 0.3 + (rng.chance(0.15) ? 0.6 : 0), 0.6, 1.9),
    spots: rng.chance(0.25), height: clamp(0.92 + (sp.m - 1.85) * 0.9 + g() * 0.08, 0.78, 1.12),
  };
}

// ---------- toon look ----------
let GRAD = null;
function gradient() {
  if (GRAD) return GRAD;
  const d = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  GRAD = new THREE.DataTexture(d, 3, 1); GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter; GRAD.needsUpdate = true;
  return GRAD;
}
const MATS = new Map();
export function toon(hex) {
  if (!MATS.has(hex)) MATS.set(hex, new THREE.MeshToonMaterial({ color: hex, gradientMap: gradient() }));
  return MATS.get(hex);
}
// ink outline: the back faces pushed out along the normal in view space (a constant width whatever the part's size)
const INK = new THREE.ShaderMaterial({
  uniforms: { width: { value: 0.022 }, color: { value: new THREE.Color("#1d1712") } },
  vertexShader: "uniform float width; void main(){ vec4 p = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal); p.xyz += n * width * clamp(-p.z * 0.06, 1.0, 3.0); gl_Position = projectionMatrix * p; }",
  fragmentShader: "uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }",
  side: THREE.BackSide,
});
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const SPHERE_LO = new THREE.SphereGeometry(1, 10, 8);
const CONE = new THREE.ConeGeometry(1, 1, 12); CONE.translate(0, 0.5, 0);
const BOX = (() => { const g = new THREE.BoxGeometry(2, 2, 2, 4, 4, 4), p = g.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.lerp(v.clone().normalize().multiplyScalar(1.25), 0.45); p.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); return g; })();
const TORUS = new THREE.TorusGeometry(1, 0.18, 6, 16, Math.PI);
const MASK = new THREE.TorusGeometry(1, 0.035, 5, 18, Math.PI * 0.75); MASK.rotateZ(Math.PI * 0.125);

function part(geo, hex, ink = true, shadow = false) {
  const m = new THREE.Mesh(geo, toon(hex));
  m.castShadow = shadow;
  if (ink) m.add(new THREE.Mesh(geo, INK));
  return m;
}

// ---------- the body ----------
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
// put a part on a bone at a world position / orientation / world radii (taken in the bind pose)
function mount(bone, mesh, center, quat, radii) {
  bone.updateWorldMatrix(true, false);
  bone.matrixWorld.decompose(_p, _q, _s);
  mesh.position.copy(center); bone.worldToLocal(mesh.position);
  mesh.quaternion.copy(_q).invert().multiply(quat);
  mesh.scale.set(radii.x / _s.x, radii.y / _s.y, radii.z / _s.z);
  bone.add(mesh);
  return mesh;
}
const wp = (bone) => bone.getWorldPosition(new THREE.Vector3());
const along = (a, b) => new THREE.Quaternion().setFromUnitVectors(UP, _a.subVectors(b, a).normalize());
const ID = new THREE.Quaternion();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// stretch the skeleton for this DNA (bone offsets: the KOOKY clips carry rotations only, so these stay)
function reshape(bones, d) {
  const s = (name, k) => { const b = bones[name]; if (b) b.position.multiplyScalar(k); };
  for (const n of ["spine_02", "spine_03"]) s(n, d.torso);
  s("neck_01", d.torso); s("Head", d.neck);
  for (const side of ["l", "r"]) {
    s(`lowerarm_${side}`, d.arms); s(`hand_${side}`, d.arms);
    s(`calf_${side}`, d.legs); s(`foot_${side}`, d.legs);
    s(`thigh_${side}`, 1 + (d.girth - 1) * 0.35); // hips as wide as the body
    s(`clavicle_${side}`, 1 + (d.girth - 1) * 0.45);
  }
}

export class KookyBody {
  // athlete: the Athlete (bones in its bind pose, root at the origin facing +Z); kit: team colors
  constructor(athlete, kit, num, d, numberMat) {
    this.d = d;
    const B = athlete.bones;
    this.pelvisRest = B.pelvis.position.clone();
    reshape(B, d);
    athlete.root.updateMatrixWorld(true);
    const P = (n) => wp(B[n]);
    const sock = kit.sock || kit.jersey, cleat = kit.cleat || "#1b1b1d", glove = kit.glove || (d.hands > 1.5 ? kit.accent : "#f4f4ee");
    const W = 0.2 * d.girth; // torso half-width (yd)
    // torso: pants blob on the pelvis, a jersey blob on the spine, a belly
    const pel = P("pelvis"), chest = P("spine_03"), neck = P("neck_01");
    const shape = { potato: [1, 1, 0.95], pear: [0.85, 1, 0.9], bean: [0.72, 1.18, 0.75], barrel: [1.08, 0.95, 1], egg: [0.9, 1.08, 0.92] }[d.body];
    const TW = W * shape[0] * 1.2, TD = W * shape[2] * 0.95, TH = (neck.y - pel.y) * 0.62 * shape[1]; // the jersey blob's radii
    const TY = pel.y + (neck.y - pel.y) * 0.55;
    mount(B.pelvis, part(SPHERE, kit.pants, true, true), V(pel.x, pel.y - 0.06, pel.z), ID, V(W * (d.body === "pear" ? 1.2 : 0.95), 0.15, TD * 0.82));
    mount(B.spine_02, part(SPHERE, kit.jersey, true, true), V(pel.x, TY, pel.z), ID, V(TW, TH, TD));
    if (d.belly > 0.35) mount(B.spine_01, part(SPHERE, kit.jersey, false), V(pel.x, TY - TH * 0.35, pel.z + TD * 0.28 * d.belly), ID, V(TW * 0.8, TH * 0.62, TD * (0.75 + d.belly * 0.2)));
    if (d.spots) for (const [sx, sy] of [[-0.35, 0.2], [0.4, -0.1], [-0.1, -0.35]]) mount(B.spine_02, part(SPHERE_LO, kit.accent, false), V(pel.x + sx * TW, TY + sy * TH, pel.z - TD * 0.93), ID, V(W * 0.16, W * 0.16, W * 0.06));
    // shoulder pads: one flat yoke across the shoulders (wider than the body: the football silhouette), and the number
    mount(B.spine_03, part(SPHERE, kit.jersey, true, true), V(chest.x, neck.y - 0.05, chest.z - TD * 0.05), ID, V(Math.min(TW * 1.3, Math.max(TW * 1.05, 0.22) * (1 + (d.pads - 1) * 0.5)), 0.08, TD * 0.92));
    const nz = TD + 0.012;
    for (const [z, ry] of [[nz, 0], [-nz, Math.PI]]) {
      const plate = new THREE.Mesh(NUM_PLANE, numberMat); plate.renderOrder = 2;
      mount(B.spine_02, plate, V(pel.x, TY + TH * 0.12, pel.z + z), new THREE.Quaternion().setFromAxisAngle(UP, ry), V(TW * 0.5, TW * 0.5, 1));
    }
    // arms: sleeve, forearm, mitt
    for (const side of ["l", "r"]) {
      const sh = P(`upperarm_${side}`), el = P(`lowerarm_${side}`), wr = P(`hand_${side}`);
      const ar = 0.055 * d.armFat;
      mount(B[`upperarm_${side}`], part(SPHERE, kit.jersey), sh.clone().lerp(el, 0.5), along(sh, el), V(ar * 1.15, sh.distanceTo(el) * 0.58, ar * 1.15));
      mount(B[`lowerarm_${side}`], part(SPHERE, d.skin), el.clone().lerp(wr, 0.5), along(el, wr), V(ar, el.distanceTo(wr) * 0.56, ar));
      mount(B[`hand_${side}`], part(SPHERE, glove, true, true), wr.clone().addScaledVector(_b.subVectors(wr, el).normalize(), 0.035 * d.hands), along(el, wr), V(0.05 * d.hands, 0.06 * d.hands, 0.045 * d.hands));
      // legs: pants thigh, sock shin, clown cleat
      const hip = P(`thigh_${side}`), kn = P(`calf_${side}`), an = P(`foot_${side}`), toe = P(`ball_${side}`);
      const lr = 0.075 * d.legFat;
      mount(B[`thigh_${side}`], part(SPHERE, kit.pants, true, true), hip.clone().lerp(kn, 0.5), along(hip, kn), V(lr * 1.15, hip.distanceTo(kn) * 0.6, lr * 1.15));
      mount(B[`calf_${side}`], part(SPHERE, sock, true, true), kn.clone().lerp(an, 0.5), along(kn, an), V(lr * 0.85, kn.distanceTo(an) * 0.58, lr * 0.85));
      const fwd = _a.subVectors(toe, an).setY(0).normalize();
      mount(B[`foot_${side}`], part(SPHERE, cleat, true, true), V(an.x + fwd.x * 0.05 * d.feet, Math.max(0.05, an.y - 0.04), an.z + fwd.z * 0.05 * d.feet), ID, V(0.06 * d.feet, 0.05, 0.11 * d.feet));
    }
    // neck (only when there is one to see)
    const head = P("Head");
    if (d.neck > 1.3) mount(B.neck_01, part(SPHERE, d.skin), neck.clone().lerp(head, 0.5), along(neck, head), V(0.05, neck.distanceTo(head) * 0.6, 0.05));
    this.buildHead(athlete, kit, d, head);
    this.spring = { x: 0, y: 0, vx: 0, vy: 0 }; this.lastV = new THREE.Vector3(); this.t = 0;
  }
  // the head lives in the athlete's headGear group (the ragdoll's head point): face looks along +Z
  buildHead(athlete, kit, d, headPos) {
    const g = athlete.headGear, R = 0.13 * d.head;
    g.position.set(0, 0.09 + (R - 0.13) * 0.5, 0); g.scale.setScalar(1);
    const hs = { round: [1, 1, 1], bean: [0.85, 1.25, 0.9], box: [1, 0.95, 0.95], tall: [0.8, 1.45, 0.85], wide: [1.3, 0.85, 1] }[d.headShape];
    const skull = part(d.headShape === "box" ? BOX : SPHERE, d.skin, true, true);
    skull.scale.set(R * hs[0] * (d.headShape === "box" ? 0.8 : 1), R * hs[1] * (d.headShape === "box" ? 0.8 : 1), R * hs[2] * (d.headShape === "box" ? 0.8 : 1));
    g.add(skull);
    const top = R * hs[1], front = R * hs[2];
    // eyes: whites with googly pupils (a spring wobbles them)
    this.pupils = [];
    const n = d.eyes, es = R * d.eyeSize;
    const spots = n === 1 ? [[0, 0.25]] : n === 2 ? [[-0.38, 0.22], [0.38, 0.22]] : n === 3 ? [[-0.42, 0.12], [0.42, 0.12], [0, 0.5]] : [[-0.4, 0.32], [0.4, 0.32], [-0.3, -0.02], [0.3, -0.02]];
    spots.forEach(([x, y], i) => {
      const s = es * (d.eyeOdd && i === 1 ? 1.45 : 1) * (n === 1 ? 1.5 : 1) * (n === 4 && i > 1 ? 0.7 : 1);
      const eye = part(SPHERE, "#fbfbf6", true);
      const ex = x * R * hs[0], ey = y * top;
      eye.position.set(ex, ey, Math.sqrt(Math.max(0, 1 - x * x - y * y * 0.6)) * front * 0.92); eye.scale.set(s, s * 1.08, s * 0.7);
      g.add(eye);
      const pupil = new THREE.Mesh(SPHERE_LO, toon("#15110d"));
      const pr = d.pupils === "tiny" ? 0.3 : 0.52;
      pupil.scale.set(pr, pr, 0.5); pupil.position.set(0, 0, 0.62);
      eye.add(pupil);
      this.pupils.push({ m: pupil, pr });
      if (d.lids) { const lid = new THREE.Mesh(SPHERE, toon(d.skin)); lid.scale.set(1.08, 0.62, 1.08); lid.position.set(0, 0.45, 0.05); eye.add(lid); }
    });
    // nose and mouth
    const fz = front * 0.98;
    if (d.nose === "button") { const m = part(SPHERE_LO, "#2a1f1a", false); m.position.set(0, -0.08 * top, fz); m.scale.setScalar(R * 0.12); g.add(m); }
    else if (d.nose === "big") { const m = part(SPHERE, d.skin); m.position.set(0, -0.1 * top, fz * 0.95); m.scale.set(R * 0.3, R * 0.26, R * 0.32); g.add(m); }
    else if (d.nose === "snout") { const m = part(SPHERE, d.skin); m.position.set(0, -0.22 * top, fz * 0.85); m.scale.set(R * 0.42, R * 0.3, R * 0.45); g.add(m); for (const s of [-1, 1]) { const h = new THREE.Mesh(SPHERE_LO, toon("#2a1f1a")); h.position.set(s * R * 0.12, -0.2 * top, fz * 0.85 + R * 0.44); h.scale.setScalar(R * 0.06); g.add(h); } }
    const my = -0.5 * top, mz = Math.sqrt(0.7) * front * 0.95;
    if (d.mouth === "grin" || d.mouth === "teeth" || d.mouth === "tongue") {
      const m = new THREE.Mesh(TORUS, toon("#2a1f1a")); m.rotation.set(0, 0, Math.PI); m.position.set(0, my + R * 0.18, mz); m.scale.set(R * 0.42, R * 0.32, R * 0.3); g.add(m);
      if (d.mouth === "teeth") for (const s of [-1, 1]) { const t = new THREE.Mesh(BOX, toon("#fbfbf6")); t.position.set(s * R * 0.07, my - R * 0.05, mz + R * 0.02); t.scale.set(R * 0.055, R * 0.08, R * 0.03); g.add(t); }
      if (d.mouth === "tongue") { const t = part(SPHERE, "#ff6f91"); t.position.set(R * 0.08, my - R * 0.12, mz + R * 0.02); t.scale.set(R * 0.12, R * 0.16, R * 0.08); g.add(t); }
    } else if (d.mouth === "o") { const m = new THREE.Mesh(SPHERE_LO, toon("#2a1f1a")); m.position.set(0, my, mz); m.scale.set(R * 0.13, R * 0.17, R * 0.06); g.add(m); }
    else { const m = new THREE.Mesh(BOX, toon("#2a1f1a")); m.position.set(0, my, mz); m.scale.set(R * 0.2, R * 0.02, R * 0.02); g.add(m); }
    // helmet: a shell over the top, a tiny one perched up there, or none
    this.toppers = [];
    if (d.helmet !== "none") {
      const tiny = d.helmet === "tiny", k = tiny ? 0.5 : 1.08;
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), toon(kit.helmet));
      shell.add(new THREE.Mesh(shell.geometry, INK));
      shell.castShadow = true;
      shell.scale.set(R * hs[0] * k, R * hs[1] * k * (tiny ? 0.85 : 0.98), R * hs[2] * k);
      shell.position.set(0, tiny ? top * 0.95 : top * 0.12, tiny ? 0 : -R * 0.04);
      if (tiny) shell.rotation.z = 0.18;
      g.add(shell);
      const stripe = new THREE.Mesh(new THREE.SphereGeometry(1.012, 4, 12, Math.PI / 2 - 0.12, 0.24, 0, Math.PI * 0.5), toon(kit.accent));
      shell.add(stripe);
      if (d.mask && !tiny) for (const yy of [-0.25, -0.5]) { const bar = new THREE.Mesh(MASK, toon("#d7d7d0")); bar.rotation.set(Math.PI / 2, 0, 0); bar.position.set(0, yy * top, 0); bar.scale.set(R * hs[0] * 1.08, R * hs[2] * 1.16, R); g.add(bar); }
    }
    // the topper pokes out wherever the helmet allows (a spring gives it some wobble)
    const pivot = new THREE.Group(); pivot.position.set(0, top * (d.helmet === "tiny" ? 0.75 : 0.92), 0); g.add(pivot);
    const add = (m) => { pivot.add(m); return m; };
    const hue = d.helmet === "full" ? kit.accent : d.skin;
    if (d.topper === "antenna" || d.topper === "antennae") {
      for (const s of d.topper === "antenna" ? [0] : [-1, 1]) {
        const stalk = add(part(SPHERE_LO, "#2a1f1a", false)); stalk.position.set(s * R * 0.35, R * 0.35, 0); stalk.scale.set(R * 0.04, R * 0.38, R * 0.04); stalk.rotation.z = -s * 0.35;
        const bulb = add(part(SPHERE, kit.accent)); bulb.position.set(s * R * 0.6, R * 0.75, 0); bulb.scale.setScalar(R * 0.15);
      }
    } else if (d.topper === "horns") {
      for (const s of [-1, 1]) { const h = add(part(CONE, "#f2e8cf")); h.position.set(s * R * 0.55, -R * 0.1, 0); h.scale.set(R * 0.16, R * 0.55, R * 0.16); h.rotation.z = -s * 0.6; }
    } else if (d.topper === "sprout") {
      const st = add(part(SPHERE_LO, "#3c8d2f", false)); st.position.y = R * 0.2; st.scale.set(R * 0.04, R * 0.22, R * 0.04);
      for (const s of [-1, 1]) { const l = add(part(SPHERE, "#6ccf4a")); l.position.set(s * R * 0.18, R * 0.42, 0); l.scale.set(R * 0.22, R * 0.06, R * 0.12); l.rotation.z = s * 0.4; }
    } else if (d.topper === "mohawk") {
      for (let i = 0; i < 5; i++) { const c = add(part(CONE, kit.accent)); c.position.set(0, -R * 0.05, R * (0.45 - i * 0.22)); c.scale.set(R * 0.1, R * (0.38 - Math.abs(i - 2) * 0.06), R * 0.12); c.rotation.x = -0.3 + i * 0.15; }
    } else if (d.topper === "ears" || d.topper === "floppy") {
      for (const s of [-1, 1]) { const e = add(part(SPHERE, hue)); e.position.set(s * R * 0.75, d.topper === "floppy" ? -R * 0.35 : R * 0.05, 0); e.scale.set(R * 0.3, d.topper === "floppy" ? R * 0.42 : R * 0.3, R * 0.1); e.rotation.z = s * (d.topper === "floppy" ? 0.9 : -0.25); }
    } else if (d.topper === "tuft") {
      for (let i = -1; i <= 1; i++) { const c = add(part(CONE, "#3a2a20")); c.position.set(i * R * 0.12, -R * 0.05, 0); c.scale.set(R * 0.08, R * 0.32, R * 0.08); c.rotation.z = -i * 0.4; }
    }
    this.toppers.push(pivot);
  }
  // per frame after the animation: the legs' length moves the hips, googly pupils and toppers wobble
  update(athlete, dt) {
    const pel = athlete.bones.pelvis;
    pel.position.y *= this.d.legs; // (the clip just set it for full-length legs: shorter legs, lower hips)
    this.t += dt;
    if (dt <= 0) return;
    const v = athlete.root.position, S = this.spring;
    const ax = (v.x - this.lastV.x) / dt, ay = (v.y - this.lastV.y) / dt;
    this.lastV.copy(v);
    S.vx += (-S.x * 160 - S.vx * 9 - Math.sin(athlete.heading) * ax * 0.6) * dt;
    S.vy += (-S.y * 160 - S.vy * 9 - ay * 0.6 - 2) * dt;
    S.x += S.vx * dt; S.y += S.vy * dt;
    S.x = clamp(S.x, -0.35, 0.35); S.y = clamp(S.y, -0.35, 0.35);
    for (const { m } of this.pupils) m.position.set(S.x, 0.05 + S.y, 0.62);
    for (const t of this.toppers) { t.rotation.z = S.x * 0.9; t.rotation.x = -S.y * 0.6; }
  }
}
const NUM_PLANE = new THREE.PlaneGeometry(1.6, 1.6);
