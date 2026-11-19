// The head coaches, drawn (coach-art.js): one on each team's sideline as a sprite, walking the line of scrimmage with his
// clipboard and reacting to the game (he celebrates his team's big plays and sulks at the other team's), and his
// talking head beside the COACH'S PICK in the play call.
import * as THREE from "three";
import { FIELD_W } from "./sim/config.js";
import { coachSVG } from "./coach-art.js";

const H = 3.3; // his height on the field (yd: a big man, drawn bigger than life so you can see him from the broadcast camera)
const ASPECT = 220 / 360; // the art's viewBox
// frame name: [pose, mouth open, mood]
const FRAMES = {
  idle: ["idle", false, "calm"], talk: ["talk", true, "calm"], talk2: ["talk", false, "calm"], run1: ["run1", true, "calm"], run2: ["run2", true, "calm"],
  cheer: ["cheer", true, "happy"], pump: ["pump", true, "happy"], wild1: ["flail1", true, "happy"], wild2: ["flail2", true, "happy"],
  rage1: ["flail1", true, "angry"], rage2: ["flail2", true, "angry"], slam: ["slam", false, "angry"], stew: ["idle", false, "angry"],
  facepalm: ["facepalm", false, "sad"], sulk: ["sulk", false, "sad"], aghast: ["head", true, "shock"],
};
const texCache = new Map();
// each pose rasterized once per team kit (an SVG drawn into a canvas)
function frames(kit) {
  const key = kit.jersey + kit.accent + kit.helmet;
  if (texCache.has(key)) return texCache.get(key);
  const out = {};
  const make = (pose, mouth, mirror, mood) => {
    const c = document.createElement("canvas"); c.width = 330; c.height = 540;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const img = new Image();
    img.onload = () => { const g = c.getContext("2d"); if (mirror) { g.translate(c.width, 0); g.scale(-1, 1); } g.drawImage(img, 0, 0, c.width, c.height); t.needsUpdate = true; };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(coachSVG(kit, pose, { mouth, mood }));
    return t;
  };
  for (const [name, [pose, mouth, mood]] of Object.entries(FRAMES)) {
    out[name] = make(pose, mouth, false, mood);
    if (name.startsWith("run")) out[name + "L"] = make(pose, mouth, true, mood); // running the other way
  }
  texCache.set(key, out);
  return out;
}

// reactions: [frame, seconds] in turn, n times; hop: how high he bounces while it plays (yd)
const CHEER = [
  { seq: [["cheer", 0.22], ["pump", 0.22]], n: 6, hop: 0.55 }, // jumping up and down
  { seq: [["wild1", 0.13], ["wild2", 0.13]], n: 10, hop: 0.4 }, // arms everywhere
  { seq: [["pump", 0.9], ["cheer", 0.25], ["pump", 0.25], ["cheer", 0.25]], n: 1, hop: 0.6 },
];
const SULK = [
  { seq: [["rage1", 0.15], ["rage2", 0.15]], n: 8, hop: 0.18 }, // flailing mad, stomping
  { seq: [["aghast", 0.9], ["slam", 1.5]], n: 1, hop: 0 }, // can't believe it, spikes the clipboard
  { seq: [["facepalm", 2.2]], n: 1, hop: 0 },
  { seq: [["aghast", 0.7], ["sulk", 1.6]], n: 1, hop: 0 },
  { seq: [["stew", 0.3], ["rage1", 0.2], ["stew", 0.3], ["rage2", 0.2]], n: 3, hop: 0.12 },
];

export class SidelineCoach {
  constructor(parent, kit, side) {
    this.tex = frames(kit);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.idle, transparent: true, alphaTest: 0.08, toneMapped: false }));
    this.sprite.center.set(0.5, 0.02); this.sprite.scale.set(H * ASPECT, H, 1);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.28, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.scale.set(1.3, 0.6, 1);
    parent.add(this.sprite, this.shadow);
    this.side = side; // "home" on the near sideline (Y < 0), "away" on the far one
    this.Y = side === "home" ? -4.2 : FIELD_W + 4.2;
    this.X = 50; this.t = 0; this.act = null; this.gab = 0;
  }
  // a big play: his team's (good) or the other team's
  react(good) {
    const set = good ? CHEER : SULK, r = set[Math.floor(Math.random() * set.length)];
    const steps = Array.from({ length: r.n }, () => r.seq).flat();
    this.act = { steps, i: 0, left: steps[0][1], hop: r.hop, t: 0 };
  }
  show(name) { const m = this.sprite.material; if (m.map !== this.tex[name]) { m.map = this.tex[name]; m.needsUpdate = true; } }
  dispose() { this.sprite.material.dispose(); this.shadow.geometry.dispose(); this.shadow.material.dispose(); }
  // targetX: where the action is in stadium yards (the line of scrimmage, or the ball during a play): he walks the
  // coaching box to stay with the line, and during a play he runs down the sideline after the ball
  update(dt, targetX, live) {
    this.t += dt;
    const want = THREE.MathUtils.clamp(targetX, live ? 2 : 22, live ? 98 : 78), dx = want - this.X;
    let lift = 0, frame = "idle";
    // chasing the play: up to 8 yd/s, arms pumping (he can't outrun a fast break, but he tries)
    const chase = live && Math.abs(dx) > 1.5 && !this.act;
    if (chase) {
      const sp = Math.min(8, 2 + Math.abs(dx) * 1.4);
      this.X += Math.sign(dx) * Math.min(Math.abs(dx), dt * sp);
      this.stride = (this.stride || 0) + dt * sp * 0.9;
      this.sprite.position.set(this.X, Math.abs(Math.sin(this.stride * Math.PI)) * 0.22, -this.Y);
      this.show((Math.floor(this.stride) % 2 ? "run2" : "run1") + (dx < 0 ? "L" : ""));
      this.shadow.position.set(this.X, 0.02, -this.Y);
      return;
    }
    if (this.act) {
      const A = this.act; A.t += dt; A.left -= dt;
      while (A.left <= 0 && A.i < A.steps.length - 1) { A.i++; A.left += A.steps[A.i][1]; }
      frame = A.steps[A.i][0];
      if (A.hop) lift = Math.abs(Math.sin(A.t * 11)) * A.hop;
      if (A.left <= 0) this.act = null;
    } else if (Math.abs(dx) > 1.2) {
      this.X += Math.sign(dx) * Math.min(Math.abs(dx), dt * 2.4);
      lift = Math.abs(Math.sin(this.t * 9)) * 0.08; // a waddle
    } else if (!live) {
      // between plays he barks at somebody now and then
      this.gab -= dt;
      if (this.gab < -2.5 - Math.random() * 3) this.gab = 1.4;
      if (this.gab > 0) frame = Math.floor(this.t * 6) % 2 ? "talk" : "talk2";
    }
    this.show(frame);
    this.sprite.position.set(this.X, lift, -this.Y);
    this.shadow.position.set(this.X, 0.02, -this.Y);
    this.shadow.material.opacity = Math.max(0.08, 0.28 - lift * 0.3);
  }
}

// his talking head in the play call: the drawn portrait, mouth flapping while he says his piece, blinking
export class CoachFace {
  constructor() {
    this.el = document.createElement("div"); this.el.className = "cface";
    this.talk = 0; this.t = 0; this.key = "";
  }
  get canvas() { return this.el; } // (the play call appends this)
  show(kit) {
    const id = kit.jersey + kit.accent + kit.helmet;
    if (id !== this.key) {
      this.el.innerHTML = `<div class="shut">${coachSVG(kit, "idle", { crop: true })}</div><div class="open">${coachSVG(kit, "idle", { crop: true, mouth: true })}</div>`;
      this.key = id;
    }
    this.talk = 2.4; // he says his piece when the play call opens
  }
  update(dt) {
    if (!this.el.isConnected) return;
    this.t += dt;
    if (this.talk > 0) this.talk -= dt;
    const open = this.talk > 0 && Math.sin(this.t * 22) * Math.sin(this.t * 6.1 + 1) > -0.1;
    this.el.classList.toggle("talking", open);
  }
}

// what he says about his pick
const LINES = {
  RUN: ["Pound it right up the gut.", "Run it till they stop it.", "Lean on 'em, big fella.", "Ground and pound, baby."],
  PASS: ["Air it out!", "Find the open snack.", "Sling it, kid.", "They can't cover that."],
  "PLAY ACTION": ["Sell the fake.", "Fool 'em, then burn 'em.", "Hand fake, then let it rip."],
  BLITZ: ["Send everybody!", "Get after the QB!", "Pin your ears back."],
  MAN: ["Stick to your man like sauce.", "Lock 'em up.", "Nobody gets open."],
  ZONE: ["Keep it all in front.", "Read the QB's eyes.", "Bend, don't break."],
};
export function coachLine(tag, seed = 0) {
  const k = Object.keys(LINES).find((x) => String(tag).toUpperCase().includes(x));
  const list = LINES[k] || ["Trust me on this one.", "This one's money.", "Run it, I've got a feeling."];
  return list[Math.abs(seed) % list.length];
}
