// The 3D athletes: Quaternius's Universal Base Character (CC0) dressed as a football player in code, driven by the
// Universal Animation Library's clips (CC0, same 65-bone rig) and a few procedural layers for the moves the clips
// don't cover. One Athlete per sim Player; sync(p, w, dt) reads the sim's state and never writes it.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

export const YD = 1 / 0.9144; // meters → yards (the model is in meters, the stadium in yards)

// body regions by dominant bone (and height in the bind pose, for the knee line)
const R_SKIN = 0, R_JERSEY = 1, R_PANTS = 2, R_SOCK = 3, R_CLEAT = 4, R_GLOVE = 5;
function regionOf(bone, y) {
  if (/^(spine|clavicle|upperarm)/.test(bone)) return R_JERSEY;
  if (bone === "pelvis" || bone === "root" || /^thigh/.test(bone)) return R_PANTS;
  if (/^calf/.test(bone)) return y > 0.47 ? R_PANTS : R_SOCK;
  if (/^(foot|ball)/.test(bone)) return R_CLEAT;
  if (/^(hand|index|middle|pinky|ring|thumb)/.test(bone)) return R_GLOVE;
  return R_SKIN;
}

let BASE = null; // { scene, clips: Map, bodyGeo }
export async function loadAthleteAssets(base = "assets/models/") {
  const L = new GLTFLoader();
  const [m, a] = await Promise.all([L.loadAsync(base + "player.gltf"), L.loadAsync(base + "anims.glb")]);
  const tex = new THREE.TextureLoader();
  const skins = await Promise.all(["body_dark.jpg", "body_light.jpg"].map((f) => tex.loadAsync(base + f)));
  for (const t of skins) { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; }
  let body = null;
  m.scene.traverse((o) => {
    if (o.isSkinnedMesh && o.material && o.material.name === "MI_Body") body = o;
    if (o.isMesh) o.castShadow = true;
  });
  // tag every vertex with its uniform region (computed once; the clones share the geometry)
  const g = body.geometry, bones = body.skeleton.bones.map((b) => b.name);
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position;
  const reg = new Float32Array(si.count);
  for (let i = 0; i < si.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const wv = sw.getComponent(i, k); if (wv > bw) { bw = wv; best = si.getComponent(i, k); } }
    reg[i] = regionOf(bones[best] || "", pos.getY(i));
  }
  g.setAttribute("region", new THREE.BufferAttribute(reg, 1));
  const clips = new Map(a.animations.map((c) => [c.name, c]));
  // the pelvis's forward travel is baked into a few clips (Roll): strip root motion so the sim owns position
  for (const c of clips.values()) for (const t of c.tracks) if (/^root\.position/.test(t.name)) t.values.fill(0);
  BASE = { scene: m.scene, clips, skins, normal: body.material.normalMap };
  return BASE;
}

// A uniform material: the body's texture for skin, team colors elsewhere (the texture's light and shade kept as folds)
export function uniformMaterial(kit, skinIdx) {
  const mat = new THREE.MeshStandardMaterial({ map: BASE.skins[skinIdx], normalMap: BASE.normal, roughness: 0.6, metalness: 0 });
  const U = {
    cJersey: { value: new THREE.Color(kit.jersey) }, cPants: { value: new THREE.Color(kit.pants) },
    cSock: { value: new THREE.Color(kit.sock || kit.jersey) }, cCleat: { value: new THREE.Color(kit.cleat || "#1b1b1d") },
    cGlove: { value: new THREE.Color(kit.glove || "#f1f1ee") },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float region;\nvarying float vRegion;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRegion = region;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vRegion;\nuniform vec3 cJersey, cPants, cSock, cCleat, cGlove;")
      .replace("#include <map_fragment>", `#include <map_fragment>
      float rg = floor(vRegion + 0.5);
      if (rg > 0.5) {
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float fold = clamp(0.62 + lum * 0.9, 0.55, 1.12);
        vec3 c = rg < 1.5 ? cJersey : rg < 2.5 ? cPants : rg < 3.5 ? cSock : rg < 4.5 ? cCleat : cGlove;
        diffuseColor.rgb = c * fold;
      }`);
  };
  mat.customProgramCacheKey = () => "uniform-v1";
  return mat;
}

// number decal (front and back of the shoulder pads)
const numCache = new Map();
function numberTexture(num, fill, edge) {
  const key = `${num}|${fill}|${edge}`;
  if (numCache.has(key)) return numCache.get(key);
  const c = document.createElement("canvas"); c.width = 128; c.height = 128;
  const g = c.getContext("2d");
  g.font = "700 104px 'Oswald', 'Arial Narrow', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = 10; g.strokeStyle = edge; g.strokeText(String(num), 64, 70);
  g.fillStyle = fill; g.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  numCache.set(key, t);
  return t;
}

// shared gear geometry (meters, in the bone's space; tuned against the rig: bones' +Y runs along the bone)
const FACE = 0.62; // half-width of the face opening (radians around the head; the face looks along +Z)
const GEO = {
  dome: new THREE.SphereGeometry(0.142, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.36),
  band: new THREE.SphereGeometry(0.142, 24, 8, Math.PI / 2 + FACE, Math.PI * 2 - FACE * 2, Math.PI * 0.36, Math.PI * 0.3),
  earHole: new THREE.CircleGeometry(0.03, 12),
  mask: new THREE.TorusGeometry(0.115, 0.007, 6, 18, Math.PI * 0.9),
  bar: new THREE.CylinderGeometry(0.006, 0.006, 0.17, 6),
  pads: new THREE.SphereGeometry(1, 20, 12),
  num: new THREE.PlaneGeometry(0.2, 0.2),
};

// gear offsets in the bone's space (meters): tuned on tools/gear.html
export const HELMET = { y: 0.11, z: 0.0 };
export const PADS = { sx: 0.25, sy: 0.075, sz: 0.15, y: 0.1, z: -0.01 };

const LOOP = new Set(["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop", "Crouch_Idle_Loop", "Crouch_Fwd_Loop", "Push_Loop", "Dance_Loop", "Jump_Loop", "Idle_Talking_Loop"]);
const ONCE_HOLD = new Set(["Death01", "Roll", "Jump_Start", "Hit_Chest"]);

export class Athlete {
  constructor(teamMats, kit, info) {
    this.root = new THREE.Group();
    this.model = cloneSkinned(BASE.scene);
    this.root.add(this.model);
    const hgt = (info.m || 1.85) / 1.82, wide = Math.pow((info.kg || 100) / 100, 0.35);
    this.model.scale.set(YD * wide, YD * hgt, YD * Math.max(1, wide * 0.95));
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) {
        o.frustumCulled = false;
        if (o.material.name === "MI_Body") { o.material = teamMats[info.skin || 0]; this.body = o; }
        else if (o.material.name === "MI_Hair_1") o.visible = false; // under the helmet
      }
    });
    this.dressUp(kit, info.num);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [n, c] of BASE.clips) {
      const a = this.mixer.clipAction(c);
      if (!LOOP.has(n)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[n] = a;
    }
    this.cur = null; this.curKey = ""; this.heading = 0; this.lean = 0; this.pitch = 0; this.roll = 0;
    this.spin = 0; this.wasDown = false; this.oneShotUntil = 0; this.t = 0;
    this.play("Idle_Loop", 0);
  }
  dressUp(kit, num) {
    const B = this.bones;
    const helmetMat = new THREE.MeshStandardMaterial({ color: kit.helmet, roughness: 0.28, metalness: 0.25 });
    const maskMat = new THREE.MeshStandardMaterial({ color: kit.mask || "#c9c9c4", roughness: 0.5, metalness: 0.4 });
    const head = new THREE.Group();
    head.position.set(0, HELMET.y, HELMET.z);
    for (const g of [GEO.dome, GEO.band]) {
      const shell = new THREE.Mesh(g, helmetMat); shell.castShadow = true; shell.scale.set(1, 1.1, 1.14);
      head.add(shell);
    }
    const stripe = new THREE.Mesh(new THREE.SphereGeometry(0.1442, 4, 12, -0.11, 0.22, 0, Math.PI * 0.62), new THREE.MeshStandardMaterial({ color: kit.accent, roughness: 0.3, metalness: 0.2 }));
    stripe.scale.set(1, 1.1, 1.14);
    head.add(stripe);
    // facemask: two horizontal hoops across the face opening and a center bar (the face looks along +Z)
    for (const [yy, rr] of [[-0.025, 1.06], [-0.07, 0.95]]) {
      const hoop = new THREE.Mesh(GEO.mask, maskMat);
      hoop.rotation.set(Math.PI / 2, 0, Math.PI * 0.05); hoop.position.set(0, yy, 0.0); hoop.scale.set(rr * 1.05, rr * 1.15, 1);
      head.add(hoop);
    }
    const bar = new THREE.Mesh(GEO.bar, maskMat); bar.scale.y = 0.45; bar.position.set(0, -0.05, 0.145); head.add(bar);
    this.headGear = head;
    this.attach("Head", head);
    // shoulder pads under the jersey: a broad, flat ellipsoid on the upper spine, in the jersey's color
    const pads = new THREE.Mesh(GEO.pads, new THREE.MeshStandardMaterial({ color: kit.jersey, roughness: 0.75 }));
    pads.scale.set(PADS.sx, PADS.sy, PADS.sz); pads.position.set(0, PADS.y, PADS.z); pads.castShadow = true;
    this.pads = pads;
    this.attach("spine_03", pads);
    const nt = numberTexture(num, kit.number || "#ffffff", kit.numberEdge || "rgba(0,0,0,0.35)");
    const nm = new THREE.MeshBasicMaterial({ map: nt, transparent: true, depthWrite: false, toneMapped: false });
    const front = new THREE.Mesh(GEO.num, nm); front.position.set(0, 0.03, 0.172); front.renderOrder = 2;
    const back = new THREE.Mesh(GEO.num, nm); back.position.set(0, 0.06, -0.175); back.rotation.y = Math.PI; back.renderOrder = 2;
    this.attach("spine_03", front); this.attach("spine_03", back);
    // a small marker ring on the turf under the controlled player (shown by the renderer)
  }
  // attach gear to a bone, undoing the model's non-uniform scale so the gear keeps its own shape
  attach(boneName, obj) {
    const b = this.bones[boneName];
    if (!b) return;
    b.add(obj);
  }
  play(name, fade = 0.18, speed = 1) {
    const a = this.actions[name];
    if (!a) return;
    a.timeScale = speed;
    if (this.curKey === name) return;
    a.reset(); a.enabled = true; a.setEffectiveWeight(1);
    if (this.cur && fade > 0) a.crossFadeFrom(this.cur, fade, false);
    else if (this.cur) this.cur.stop();
    a.play();
    this.cur = a; this.curKey = name;
  }
  // presentation state from the sim player. abs: {X, Y, fX, fY, vx, vy} in stadium coords (the renderer flips them)
  sync(p, a, w, dt, extra) {
    this.t += dt;
    const sp = Math.hypot(a.vx, a.vy);
    const down = p.down > 0 || p.lie > 0;
    // heading: the facing the renderer worked out (eyes downfield for the QB, backpedalling DBs facing the QB)
    let want = Math.atan2(a.fX, -a.fY);
    let dh = want - this.heading; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
    if (!down) this.heading += dh * Math.min(1, dt * (sp > 4 ? 9 : 12));
    // which clip
    let clip = "Idle_Loop", rate = 1, fade = 0.18;
    const mv = p.move, moveT = p.moveT || 0;
    let pitch = 0, roll = 0, lift = 0;
    // moving relative to facing: + forward, − backpedal; lateral for the shuffle lean
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const vxz = a.vx, vzz = -a.vy;
    const fwd = sp > 0.1 ? (vxz * fx + vzz * fz) : 0, side = sp > 0.1 ? (vxz * fz - vzz * fx) : 0;
    if (down) {
      if (!this.wasDown) { this.downAt = this.t; this.fallFwd = fwd >= 0; }
      clip = mv === "dive" || mv === "slide" ? "Roll" : "Death01";
      if (mv === "dive" || mv === "slide") { pitch = Math.min(1, (this.t - this.downAt) * 6) * 1.45; lift = -0.6; clip = "Jump_Loop"; }
      fade = 0.12;
    } else if (p.celebrate > 0 && w.phase === "dead") { clip = "Dance_Loop"; }
    else if (extra.stance) { clip = "Crouch_Idle_Loop"; }
    else if (p.engaged || (p.blocking && sp < 2.4 && w.phase === "live")) { clip = "Push_Loop"; rate = 1.3; pitch = 0.18; }
    else if (mv === "stiff") { clip = "Punch_Cross"; rate = 1.4; }
    else if (mv === "hitstick" || mv === "tackle" || p.anim === "tackle") { clip = "Sprint_Loop"; pitch = 0.75; rate = 1.3; }
    else if (mv === "swat") { clip = "Jump_Start"; rate = 1.6; }
    else if (p.anim === "throw" && p.animT < 0.6) { clip = "Sword_Attack"; rate = 2.1; fade = 0.08; }
    else if (p.anim === "catch" && p.animT < 0.45) { clip = "Jump_Start"; rate = 1.8; fade = 0.08; }
    else if (p.anim === "kick" && p.animT < 0.7) { clip = "Sprint_Loop"; rate = 0.8; }
    else if (sp > 5.2) { clip = "Sprint_Loop"; rate = sp / 7.2; }
    else if (sp > 2.2) { clip = fwd < -1 ? "Walk_Loop" : "Jog_Fwd_Loop"; rate = fwd < -1 ? -sp / 2.2 : sp / 4.6; }
    else if (sp > 0.35) { clip = "Walk_Loop"; rate = (fwd < -0.2 ? -1 : 1) * Math.max(0.6, sp / 1.6); }
    else if (w.phase === "presnap" && (p.side === "D" || p.slot === "QB" || /^WR|TE|HB|FB/.test(p.slot))) { clip = "Crouch_Idle_Loop"; rate = 0.6; }
    // procedural layers on top
    if (mv === "juke") roll = Math.sin(Math.min(1, moveT / 0.35) * Math.PI) * 0.38 * (side >= 0 ? -1 : 1);
    if (mv === "truck") pitch = 0.42;
    if (mv === "spin") this.spin = Math.min(1, moveT / 0.42) * Math.PI * 2; else this.spin = 0;
    if (p.hasBall && sp > 2 && !mv) pitch = Math.max(pitch, 0.1);
    if (!down && sp > 3 && Math.abs(side) > 1.5 && !mv) roll += Math.max(-0.2, Math.min(0.2, -side * 0.04));
    this.play(clip, fade, rate);
    // ease the lean layers so nothing snaps
    const k = Math.min(1, dt * 12);
    this.pitch += (pitch - this.pitch) * k; this.roll += (roll - this.roll) * k; this.lift = (this.lift || 0) + (lift - (this.lift || 0)) * k;
    this.wasDown = down;
    this.mixer.update(dt);
    // place the body: sim position, height (a jump or a dive's z), heading + spin, leans
    this.root.position.set(a.X, Math.max(0, p.z || 0) + this.lift * 0.5, -a.Y);
    this.root.rotation.set(0, 0, 0);
    this.root.rotateY(this.heading + this.spin);
    this.root.rotateX(this.pitch);
    this.root.rotateZ(this.roll);
    // the kicker's leg: swing the right thigh through on a kick
    if (p.anim === "kick" && p.animT < 0.7 && this.bones.thigh_r) {
      const u = p.animT / 0.7, swing = u < 0.35 ? -0.9 * (u / 0.35) : -0.9 + 2.6 * Math.min(1, (u - 0.35) / 0.3);
      this.bones.thigh_r.rotateX(-swing);
    }
  }
  handWorld(out) { const h = this.bones.hand_r || this.bones.lowerarm_r; return h ? h.getWorldPosition(out) : this.root.getWorldPosition(out); }
  chestWorld(out) { const b = this.bones.spine_03 || this.bones.Head; return b ? b.getWorldPosition(out) : this.root.getWorldPosition(out); }
  headWorld(out) { const b = this.bones.Head; return b ? b.getWorldPosition(out) : this.root.getWorldPosition(out); }
}
