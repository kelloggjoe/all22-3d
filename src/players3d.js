// The 3D athletes: Quaternius's Universal Base Character (CC0) dressed as a football player in code, driven by the
// Universal Animation Library's clips (CC0, same 65-bone rig) and a few procedural layers for the moves the clips
// don't cover. One Athlete per sim Player; sync(p, w, dt) reads the sim's state and never writes it.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { FootballMoves, THROW_END } from "./football-moves.js";
import { SKIN_TONES } from "./player-generator.js";
import { KookyBody } from "./kooky.js";

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
  // KOOKY players stretch their own bones, so their clips carry rotations only (and the hips' motion)
  const kookyClips = new Map([...clips].map(([n, c]) => [n, new THREE.AnimationClip(n, c.duration,
    c.tracks.filter((t) => /\.quaternion$/.test(t.name) || /^(root|pelvis)\.position$/.test(t.name)))]));
  BASE = { scene: m.scene, clips, kookyClips, skins, normal: body.material.normalMap };
  return BASE;
}

// A uniform material: the body's texture for skin, team colors elsewhere (the texture's light and shade kept as folds)
export function uniformMaterial(kit, look = {}) {
  const skin = SKIN_TONES[look.skin ?? 0];
  const glove = ["#f1f1ee", kit.accent, "#242a34"][look.gloves ?? 0];
  const mat = new THREE.MeshStandardMaterial({ map: BASE.skins[skin.map], normalMap: BASE.normal, roughness: 0.6, metalness: 0 });
  const U = {
    cJersey: { value: new THREE.Color(kit.jersey) }, cPants: { value: new THREE.Color(kit.pants) },
    cSock: { value: new THREE.Color(kit.sock || kit.jersey) }, cCleat: { value: new THREE.Color(kit.cleat || "#1b1b1d") },
    cGlove: { value: new THREE.Color(kit.glove || glove) }, cSkin: { value: new THREE.Color(skin.tint) },
    cTrim: { value: new THREE.Color(kit.accent) }, socks: { value: look.socks ?? 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float region;\nvarying float vRegion, vKitHeight;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRegion = region;\nvKitHeight = position.y;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vRegion, vKitHeight;\nuniform vec3 cJersey, cPants, cSock, cCleat, cGlove, cSkin, cTrim;\nuniform float socks;")
      .replace("#include <map_fragment>", `#include <map_fragment>
      float rg = floor(vRegion + 0.5);
      if (rg > 0.5) {
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float fold = clamp(0.62 + lum * 0.9, 0.55, 1.12);
        vec3 c = rg < 1.5 ? cJersey : rg < 2.5 ? cPants : rg < 3.5 ? cSock : rg < 4.5 ? cCleat : cGlove;
        if (rg == 3.0 && socks > 0.5) {
          float stripe = step(0.29, vKitHeight) * (1.0 - step(0.33, vKitHeight));
          if (socks > 1.5) stripe += step(0.36, vKitHeight) * (1.0 - step(0.39, vKitHeight));
          c = mix(c, cTrim, stripe);
        }
        diffuseColor.rgb = c * fold;
      } else diffuseColor.rgb *= cSkin;`);
  };
  mat.customProgramCacheKey = () => "uniform-v2";
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
  stripe: new THREE.SphereGeometry(0.145, 6, 12, Math.PI / 2 - 0.14, 0.28, 0, Math.PI * 0.36),
  visor: new THREE.SphereGeometry(0.135, 12, 6, Math.PI / 2 - 0.57, 1.14, Math.PI * 0.40, Math.PI * 0.16),
};

// gear offsets in the bone's space (meters): tuned on tools/gear.html
export const HELMET = { y: 0.11, z: 0.0 };
export const PADS = { sx: 0.25, sy: 0.075, sz: 0.15, y: 0.1, z: -0.01 };

const LOOP = new Set(["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop", "Crouch_Idle_Loop", "Crouch_Fwd_Loop", "Push_Loop", "Dance_Loop", "Jump_Loop", "Idle_Talking_Loop"]);
const ONCE_HOLD = new Set(["Death01", "Roll", "Jump_Start", "Hit_Chest"]);
const GRIP_ROTATION = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

export class Athlete {
  constructor(bodyMaterial, kit, info) {
    this.root = new THREE.Group();
    this.model = cloneSkinned(BASE.scene);
    this.root.add(this.model);
    const hgt = (info.m || 1.85) / 1.82;
    const wide = THREE.MathUtils.clamp(Math.pow((info.kg || 100) / (100 * hgt * hgt), 0.58), 0.82, 1.36);
    const depth = THREE.MathUtils.clamp(1 + (wide - 1) * 0.69, 0.91, 1.23);
    const kooky = info.kooky || null;
    if (kooky) this.model.scale.setScalar(YD * kooky.height); // (KOOKY: the blobs carry the width)
    else this.model.scale.set(YD * wide, YD * hgt, YD * depth);
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) {
        o.frustumCulled = false;
        if (kooky) o.visible = false;
        else if (o.material.name === "MI_Body") { o.material = bodyMaterial; this.body = o; }
        else if (o.material.name === "MI_Hair_1") o.visible = false; // under the helmet
      }
    });
    if (kooky) {
      this.headGear = new THREE.Group();
      this.attach("Head", this.headGear);
      const nm = new THREE.MeshBasicMaterial({ map: numberTexture(info.num, kit.number || "#ffffff", "rgba(0,0,0,0.55)"), transparent: true, depthWrite: false, toneMapped: false });
      this.gearMaterials = new Set([nm]);
      this.kooky = new KookyBody(this, kit, info.num, kooky, nm);
    } else this.dressUp(kit, info.num, info.look || {});
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [n, c] of (kooky ? BASE.kookyClips : BASE.clips)) {
      const a = this.mixer.clipAction(c);
      if (!LOOP.has(n)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[n] = a;
    }
    this.cur = null; this.curKey = ""; this.heading = 0; this.lean = 0; this.pitch = 0; this.roll = 0;
    this.wasDown = false; this.oneShotUntil = 0; this.t = 0;
    this.moves = new FootballMoves(this);
    this.ballGripped = false;
    this.catchTmp = new THREE.Vector3();
    this.play("Idle_Loop", 0);
  }
  dressUp(kit, num, look) {
    const helmetMat = new THREE.MeshStandardMaterial({ color: kit.helmet, roughness: 0.28, metalness: 0.25 });
    const maskMat = new THREE.MeshStandardMaterial({ color: kit.mask || "#c9c9c4", roughness: 0.5, metalness: 0.4 });
    const head = new THREE.Group();
    head.position.set(0, HELMET.y, HELMET.z);
    head.scale.setScalar(look.helmet || 1.08);
    for (const g of [GEO.dome, GEO.band]) {
      const shell = new THREE.Mesh(g, helmetMat); shell.castShadow = true; shell.scale.set(1, 1.1, 1.14);
      head.add(shell);
    }
    const trim = new THREE.MeshStandardMaterial({ color: kit.accent, roughness: 0.39 });
    for (const angle of (look.stripe === 2 ? [-0.17, 0.17] : [0])) {
      const stripe = new THREE.Mesh(GEO.stripe, trim);
      stripe.rotation.y = angle;
      stripe.scale.set(look.stripe === 1 ? 1.03 : 1, 1.1, 1.14);
      head.add(stripe);
    }
    // facemask: two horizontal hoops across the face opening and a center bar (the face looks along +Z)
    for (const [yy, rr] of [[-0.025, 1.06], [-0.07, 0.95]]) {
      const hoop = new THREE.Mesh(GEO.mask, maskMat);
      hoop.rotation.set(Math.PI / 2, 0, Math.PI * 0.05); hoop.position.set(0, yy, 0.0); hoop.scale.set(rr * 1.05, rr * 1.15, 1);
      head.add(hoop);
    }
    const bar = new THREE.Mesh(GEO.bar, maskMat); bar.scale.y = 0.45; bar.position.set(0, -0.05, 0.145); head.add(bar);
    if (look.visor) {
      const visor = new THREE.Mesh(GEO.visor, new THREE.MeshStandardMaterial({ color: "#253752", roughness: 0.16, metalness: 0.55 }));
      visor.scale.set(1.03, 0.84, 1.19);
      head.add(visor);
    }
    this.headGear = head;
    this.attach("Head", head);
    // shoulder pads under the jersey: a broad, flat ellipsoid on the upper spine, in the jersey's color
    const pads = new THREE.Mesh(GEO.pads, new THREE.MeshStandardMaterial({ color: kit.jersey, roughness: 0.75 }));
    pads.scale.set(PADS.sx * (look.pads || 1), PADS.sy * 1.12, PADS.sz); pads.position.set(0, PADS.y, PADS.z); pads.castShadow = true;
    this.pads = pads;
    this.attach("spine_03", pads);
    for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(GEO.pads, trim);
      cap.position.set(side * pads.scale.x * 0.88, PADS.y + 0.014, 0);
      cap.scale.set(0.060, 0.058, 0.100);
      cap.rotation.z = side * -0.29;
      this.attach("spine_03", cap);
    }
    const nt = numberTexture(num, kit.number || "#ffffff", kit.numberEdge || "rgba(0,0,0,0.35)");
    const nm = new THREE.MeshBasicMaterial({ map: nt, transparent: true, depthWrite: false, toneMapped: false });
    const front = new THREE.Mesh(GEO.num, nm); front.position.set(0, 0.03, 0.172); front.renderOrder = 2;
    const back = new THREE.Mesh(GEO.num, nm); back.position.set(0, 0.06, -0.175); back.rotation.y = Math.PI; back.renderOrder = 2;
    this.attach("spine_03", front); this.attach("spine_03", back);
    this.gearMaterials = new Set([helmetMat, maskMat, trim, pads.material, nm]);
    head.traverse((object) => { if (object.isMesh) this.gearMaterials.add(object.material); });
  }
  dispose() {
    this.mixer.stopAllAction();
    this.model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
    for (const material of this.gearMaterials) material.dispose();
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
    this.moves.resetPose();
    this.ballGripped = false;
    this.t += dt;
    const sp = Math.hypot(a.vx, a.vy);
    const down = p.down > 0 || p.lie > 0;
    // heading: the facing the renderer worked out (eyes downfield for the QB, backpedalling DBs facing the QB)
    const shot = !down && p.anim === "throw" && p.animT < THROW_END ? extra.throw : null;
    const want = shot && !shot.spike ? shot.heading : Math.atan2(a.fX, -a.fY);
    let dh = want - this.heading; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
    if (!down) this.heading += dh * Math.min(1, dt * (shot ? 16 : sp > 4 ? 9 : 12));
    // which clip
    let clip = "Idle_Loop", rate = 1, fade = 0.18;
    const mv = p.move, moveT = p.moveT || 0;
    const carryMove = !down && p.hasBall && w.phase === "live" && (mv === "juke" || mv === "spin" || mv === "truck") ? mv : "";
    const u = this.moves.prepare(carryMove, moveT, a, this.heading);
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
    else if (mv === "hitstick") { clip = "Sprint_Loop"; pitch = 0.75; rate = 1.3; }
    else if (mv === "dive" && !p.hasBall) { clip = "Sprint_Loop"; pitch = 0.47 * Math.min(1, moveT / 0.16); rate = 1.25; }
    else if (mv === "swat") { clip = "Jump_Start"; rate = 1.6; }
    else if (p.anim === "catch" && p.animT < 0.45) { clip = "Jump_Start"; rate = 1.8; fade = 0.08; }
    else if (p.anim === "kick" && p.animT < 0.7) { clip = "Sprint_Loop"; rate = 0.8; }
    else if (sp > 5.2) { clip = "Sprint_Loop"; rate = sp / 7.2; }
    else if (sp > 2.2) { clip = fwd < -1 ? "Walk_Loop" : "Jog_Fwd_Loop"; rate = fwd < -1 ? -sp / 2.2 : sp / 4.6; }
    else if (sp > 0.35) { clip = "Walk_Loop"; rate = (fwd < -0.2 ? -1 : 1) * Math.max(0.6, sp / 1.6); }
    else if (w.phase === "presnap" && (p.side === "D" || p.slot === "QB" || /^WR|TE|HB|FB/.test(p.slot))) { clip = "Crouch_Idle_Loop"; rate = 0.6; }
    // procedural layers on top
    const effort = Math.sin(Math.PI * u);
    const spin = carryMove === "spin" ? Math.PI * 2 * u * u * (3 - 2 * u) : 0;
    if (p.hasBall && sp > 2 && !mv) pitch = Math.max(pitch, 0.1);
    if (!down && sp > 3 && Math.abs(side) > 1.5 && !mv) roll += Math.max(-0.2, Math.min(0.2, -side * 0.04));
    this.play(clip, fade, rate);
    // ease the lean layers so nothing snaps
    const k = Math.min(1, dt * 12);
    this.pitch += (pitch - this.pitch) * k; this.roll += (roll - this.roll) * k; this.lift = (this.lift || 0) + (lift - (this.lift || 0)) * k;
    this.wasDown = down;
    this.mixer.update(dt);
    if (this.kooky) this.kooky.update(this, dt);
    // place the body: sim position, height (a jump or a dive's z), heading + spin, leans
    this.root.position.set(a.X, Math.max(0, p.z || 0) + this.lift * 0.5, -a.Y);
    this.root.rotation.set(0, 0, 0);
    this.root.rotateY(this.heading + spin);
    this.root.rotateX(this.pitch + (carryMove === "truck" ? 0.43 * effort : 0));
    this.root.rotateZ(this.roll + (carryMove === "juke" ? -0.27 * effort * this.moves.cut : 0));
    // the kicker's leg: swing the right thigh through on a kick
    if (p.anim === "kick" && p.animT < 0.7 && this.bones.thigh_r) {
      const u = p.animT / 0.7, swing = u < 0.35 ? -0.9 * (u / 0.35) : -0.9 + 2.6 * Math.min(1, (u - 0.35) / 0.3);
      this.bones.thigh_r.rotateX(-swing);
    }
    if (shot) this.moves.throw(shot, p.animT, sp);
    else if (carryMove) {
      this.moves[carryMove](u);
      this.moves.keepCleatsAboveTurf();
      this.ballGripped = true;
    } else if (!down && p.hasBall && w.phase === "live" && !mv) {
      const pocket = p === w.qb && !w.handedOff && !w.losCrossed && w.call.off?.type === "pass";
      const weight = p.anim === "catch" ? THREE.MathUtils.smoothstep(p.animT, 0.22, 0.4) : 1;
      this.moves.carry(pocket, weight);
      this.ballGripped = weight > 0.4;
    }
    // a pass on its way to him: both hands go to the ball (extra.catchAt: its spot in the stadium, extra.catchW)
    if (extra.catchAt && extra.catchW > 0 && !down) this.moves.catchAt(this.root.worldToLocal(this.catchTmp.copy(extra.catchAt)), extra.catchW);
    if (this.recover) this.applyRecover(dt);
  }
  // the ball between his palms (just after a catch)
  palmsWorld(out) { const l = this.bones.hand_l, r = this.bones.hand_r; l.getWorldPosition(out); r.getWorldPosition(this.catchTmp); return out.add(this.catchTmp).multiplyScalar(0.5); }
  // getting up after a ragdoll: from the pose and spot it left him in, blend back into the animation (the root eases
  // from where he lay to where the sim has him)
  beginRecover(duration = 0.45) {
    const snap = [];
    this.model.traverse((o) => { if (o.isBone) snap.push([o, o.quaternion.clone(), o.position.clone()]); });
    this.recover = { snap, t: 0, duration, root: this.root.position.clone(), quat: this.root.quaternion.clone() };
  }
  applyRecover(dt) {
    const R = this.recover;
    R.t += dt;
    const u = Math.min(1, R.t / R.duration), k = 1 - u * u * (3 - 2 * u); // weight of the ragdoll's pose
    for (const [bone, q, pos] of R.snap) { bone.quaternion.slerp(q, k); bone.position.lerp(pos, k); }
    this.root.position.lerp(R.root, k);
    this.root.quaternion.slerp(R.quat, k);
    if (u >= 1) this.recover = null;
  }
  gripWorld(position, rotation) {
    const hand = this.bones.hand_r;
    hand.localToWorld(position.set(0, 0.07, 0));
    if (rotation) {
      hand.getWorldQuaternion(rotation);
      rotation.multiply(GRIP_ROTATION);
    }
    return position;
  }
  handWorld(out) { const h = this.bones.hand_r || this.bones.lowerarm_r; return h ? h.getWorldPosition(out) : this.root.getWorldPosition(out); }
  chestWorld(out) { const b = this.bones.spine_03 || this.bones.Head; return b ? b.getWorldPosition(out) : this.root.getWorldPosition(out); }
  headWorld(out) { const b = this.bones.Head; return b ? b.getWorldPosition(out) : this.root.getWorldPosition(out); }
}
