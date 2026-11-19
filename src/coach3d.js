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
  huff1: ["huff", true, "tired"], huff2: ["huff", false, "tired"],
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

// what he yells from the sideline
const YELLS = {
  good: ["THAT'S MY GUY!", "PUT IT ON A T-SHIRT!", "WHO'S HUNGRY NOW?!", "EXTRA CHEESE, BABY!", "SOMEBODY CALL A DENTIST!", "I DREW THAT UP! (I DIDN'T)", "THAT'S HOW MOM MAKES IT!", "FRESH OUT THE OVEN!"],
  bad: ["MY GRANDMA BLOCKS BETTER!", "ARE YOU KIDDING ME?!", "WHO TAUGHT YOU THAT?! ...OH. ME.", "THAT'S GOING IN THE FRYER!", "I NEED A BIGGER CLIPBOARD.", "STALE! STALE! STALE!", "I'M CALLING YOUR MOTHER."],
  chatter: ["HUSTLE, YOU BEAUTIFUL BURRITO!", "STAY CRISPY!", "KEEP YOUR SPRINKLES UP!", "WHO ATE MY PLAYBOOK?", "WE PLAY TO THE LAST CRUMB!", "MORE MUSTARD!", "DON'T GET SOGGY OUT THERE!", "EYES UP, PIZZA!", "THAT'S A FLAG! ...RIGHT?", "I SEE YOU, NUMBER 91."],
  huff: ["*WHEEZE*", "I NEED... A SNACK...", "HOW... IS HE... SO FAST", "NOBODY SAW THAT.", "*HEAVY BREATHING*"],
  run: ["WAIT UP!", "GO GO GO!", "RUN! RUN! RUN!", "THAT WAY! THAT WAY!"],
};
const pickLine = (k, last) => { const a = YELLS[k]; let s; do s = a[Math.floor(Math.random() * a.length)]; while (s === last && a.length > 1); return s; };

export class SidelineCoach {
  constructor(parent, kit, side) {
    this.tex = frames(kit);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.idle, transparent: true, alphaTest: 0.08, toneMapped: false }));
    this.sprite.center.set(0.5, 0.02); this.sprite.scale.set(H * ASPECT, H, 1);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.28, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.scale.set(1.3, 0.6, 1);
    parent.add(this.sprite, this.shadow);
    this.side = side; // "home" on the near sideline (Y < 0), "away" on the far one
    this.Y = side === "home" ? -2.3 : FIELD_W + 2.3; // (right at the edge of the field, in the coaching box)
    this.X = 50; this.t = 0; this.act = null; this.gab = 0;
  }
  // a speech bubble over his head (main.js draws it where he is on screen)
  say(kind, sec = 2.2) { this.line = pickLine(kind, this.line); this.lineT = sec; this.quiet = 7 + Math.random() * 7; }
  // a big play: his team's (good) or the other team's
  react(good) {
    this.say(good ? "good" : "bad", 2.6);
    const set = good ? CHEER : SULK, r = set[Math.floor(Math.random() * set.length)];
    const steps = Array.from({ length: r.n }, () => r.seq).flat();
    this.act = { steps, i: 0, left: steps[0][1], hop: r.hop, t: 0 };
  }
  // his drawn height (yd): render3d grows him with distance so he always reads on screen
  size(h) { this.h = h; this.sprite.scale.set(h * ASPECT, h, 1); this.shadow.scale.set(1.3 * h / H, 0.6 * h / H, 1); }
  show(name) { const m = this.sprite.material; if (m.map !== this.tex[name]) { m.map = this.tex[name]; m.needsUpdate = true; } }
  dispose() { this.sprite.material.dispose(); this.shadow.geometry.dispose(); this.shadow.material.dispose(); }
  // targetX: where he should be (render3d picks a spot on his sideline the camera can see, ahead of the action). He runs
  // there, fast, and when he's run a long way he stops and huffs and puffs, hands on his knees
  update(dt, targetX, live) {
    this.t += dt;
    if (this.lineT > 0) this.lineT -= dt;
    this.quiet = (this.quiet ?? 4) - dt;
    if (!live && this.quiet <= 0 && !(this.lineT > 0)) this.say("chatter"); // between plays he yells something now and then
    const want = THREE.MathUtils.clamp(targetX, 1, 99), dx = want - this.X, far = Math.abs(dx);
    let lift = 0, frame = "idle";
    // speed: a big man at full tilt (he speeds up, he slows down)
    const top = far > 1.2 ? Math.min(17, 4 + far * 2.2) : 0;
    this.speed = (this.speed || 0) + (top - (this.speed || 0)) * Math.min(1, dt * (top > (this.speed || 0) ? 5 : 7));
    const step = Math.sign(dx) * Math.min(far, dt * this.speed);
    this.X += step;
    this.ran = (this.ran || 0) + Math.abs(step);
    const running = this.speed > 1.5 && far > 0.4;
    if (this.act) {
      const A = this.act; A.t += dt; A.left -= dt;
      while (A.left <= 0 && A.i < A.steps.length - 1) { A.i++; A.left += A.steps[A.i][1]; }
      frame = A.steps[A.i][0];
      if (A.hop) lift = Math.abs(Math.sin(A.t * 11)) * A.hop;
      if (A.left <= 0) this.act = null;
    } else if (running) {
      this.stride = (this.stride || 0) + dt * Math.max(3, this.speed) * 0.85;
      lift = Math.abs(Math.sin(this.stride * Math.PI)) * 0.25;
      frame = (Math.floor(this.stride) % 2 ? "run2" : "run1") + (dx < 0 ? "L" : "");
      if (far > 12 && this.speed > 9 && !(this.lineT > 0) && Math.random() < dt * 0.5) this.say("run", 1.4);
    } else if (this.ran > 14) {
      // he made it: about half the time he's out of breath, for longer the farther he ran
      if (Math.random() < 0.5) { this.huff = Math.min(3.2, 1 + this.ran * 0.04); if (!(this.lineT > 0)) this.say("huff", this.huff); }
      this.ran = 0;
    }
    if (!this.act && !running && this.huff > 0) {
      this.huff -= dt;
      frame = Math.floor(this.t * 3.2) % 2 ? "huff1" : "huff2";
      lift = Math.abs(Math.sin(this.t * 3.2 * Math.PI)) * 0.04;
    } else if (!this.act && !running && !live) {
      // between plays he barks at somebody now and then
      this.gab -= dt;
      if (this.gab < -2.5 - Math.random() * 3) this.gab = 1.4;
      if (this.gab > 0) frame = Math.floor(this.t * 6) % 2 ? "talk" : "talk2";
    }
    this.show(frame);
    this.sprite.position.set(this.X, lift * (this.h || H) / H, -this.Y); // (his hops scale with his drawn size)
    this.shadow.position.set(this.X, 0.02, -this.Y);
    this.shadow.material.opacity = Math.max(0.08, 0.28 - lift * 0.3);
  }
}

// a coach in the page (the title, the draft board): his drawn self in a few frames, talking his lines and cheering
export class PageCoach {
  constructor(kit, { crop = false } = {}) {
    this.el = document.createElement("div"); this.el.className = "pcoach" + (crop ? " crop" : "");
    this.svgs = {};
    const add = (name, pose, mouth, mood) => { this.svgs[name] = coachSVG(kit, pose, { mouth, mood, crop }); };
    add("idle", "idle", false, "calm"); add("talk", "talk", true, "calm"); add("talk2", "talk", false, "calm");
    add("cheer", "cheer", true, "happy"); add("pump", "pump", true, "happy"); add("wild1", "flail1", true, "happy"); add("wild2", "flail2", true, "happy");
    add("shock", "head", true, "shock"); add("sulk", "sulk", false, "sad"); add("rage1", "flail1", true, "angry"); add("rage2", "flail2", true, "angry");
    this.frame = ""; this.t = 0; this.talk = 0; this.act = null; this.bubble = null;
    this.show("idle");
  }
  show(name) { if (name !== this.frame) { this.frame = name; this.el.innerHTML = this.svgs[name]; } }
  say(text, sec = 2.4) { this.talk = sec; if (this.bubble) { this.bubble.textContent = text; this.bubble.classList.remove("pop"); void this.bubble.offsetWidth; this.bubble.classList.add("pop"); } }
  react(mood = "good") {
    const seq = mood === "good" ? (Math.random() < 0.5 ? ["cheer", "pump"] : ["wild1", "wild2"]) : mood === "bad" ? (Math.random() < 0.5 ? ["rage1", "rage2"] : ["shock", "sulk"]) : ["shock", "shock"];
    this.act = { seq, t: 0, len: mood === "bad" && seq[0] === "shock" ? 2 : 1.8 };
  }
  // he talks on his own: a line every few seconds
  chatter(lines, every = 5) { this.lines = lines; this.every = every; this.chatT = 0.8; this.li = 0; }
  update(dt) {
    if (!this.el.isConnected) return;
    this.t += dt;
    if (this.lines && !this.act && (this.chatT -= dt) <= 0) { this.say(this.lines[this.li++ % this.lines.length], 2.2); this.chatT = this.every; }
    if (this.act) {
      const A = this.act; A.t += dt;
      const fast = A.seq[0] === "shock" ? 1.2 : 0.18;
      this.show(A.seq[Math.min(A.seq.length - 1, Math.floor(A.t / fast) % A.seq.length)]);
      this.el.style.transform = A.seq[0] === "cheer" || A.seq[0] === "wild1" ? `translateY(${-Math.abs(Math.sin(A.t * 11)) * 14}px)` : "";
      if (A.t > A.len) { this.act = null; this.el.style.transform = ""; }
      return;
    }
    if (this.talk > 0) { this.talk -= dt; this.show(Math.sin(this.t * 22) * Math.sin(this.t * 6.1 + 1) > -0.1 ? "talk" : "talk2"); }
    else this.show("idle");
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
