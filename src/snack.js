// SNACK LEAGUE: every player is one of the 25 snacks (snacks.js), built on the same skeleton as the toon blobs, so
// the animations, football moves and ragdoll all still drive him. Big hits knock the toppings off (Crumbs).
import * as THREE from "three";
import { KookyBody, part, mount, wp, along, V, ID, reshape, toon, SPHERE, SPHERE_LO, BOX, TORUS } from "./kooky.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const DOME = new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI / 2);
const DONUT = new THREE.TorusGeometry(1, 0.5, 12, 28);
const ICING = new THREE.TorusGeometry(1, 0.53, 10, 28);
const TACO = new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2); // a half disc, round side down
const SLICE = (() => {
  const s = new THREE.Shape([new THREE.Vector2(-1, 0.7), new THREE.Vector2(1, 0.7), new THREE.Vector2(0, -1.2)]);
  return new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: false }).translate(0, 0, -0.125);
})();
const CARTON = new THREE.CylinderGeometry(1, 0.72, 1, 4, 1).rotateY(Math.PI / 4);
const STICK = new THREE.BoxGeometry(2, 2, 2);
const DISC = new THREE.CylinderGeometry(1, 1, 1, 24).rotateX(Math.PI / 2); // faces +Z
const CYL = new THREE.CylinderGeometry(1, 1, 2, 22);
const CYL8 = new THREE.CylinderGeometry(1, 1, 2, 8);
const WRAP = new THREE.CylinderGeometry(1, 0.78, 2, 16);
const CONE_UP = new THREE.ConeGeometry(1, 2, 8);
const CONE_DOWN = new THREE.ConeGeometry(1, 2, 18).rotateZ(Math.PI);
const PLATE = new THREE.PlaneGeometry(1, 1);
const SIZE = 1.38, MID = 0.28; // every snack drawn this much bigger, about this height above the hips (yd)
const SPRINKLES = ["#ff5f8f", "#ffd23e", "#5ec1f2", "#7be07b", "#ffffff", "#b07cff"];
const PICKLE = "#4f8f2e";
const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const eul = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const hashS = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

// Each build places its parts (at: bone, geometry, color, offset from the pelvis in yd, radii, turn, ink) and says
// where the face goes, where the little helmet sits (top), where the number goes on the back, and what flies off.
const BUILD = {
  burger({ at, R }) {
    const W = 0.34;
    at("pelvis", SPHERE, "#d48a3a", 0, -0.02, 0, V(W, 0.1, W * 0.95));
    at("spine_02", SPHERE, "#5b2f18", 0, 0.12, 0, V(W * 1.05, 0.075, W));
    at("spine_02", BOX, "#ffc83a", 0, 0.19, 0, V(W * 0.78, 0.018, W * 0.78), eul(0, Math.PI / 4, 0));
    at("spine_02", SPHERE, "#6cc04a", 0, 0.23, 0, V(W * 1.12, 0.03, W * 1.05));
    at("spine_02", SPHERE, "#e2442b", 0, 0.26, 0, V(W * 0.95, 0.03, W * 0.9));
    at("spine_03", DOME, "#e09a45", 0, 0.27, 0, V(W * 1.02, 0.3, W * 0.97));
    for (let i = 0; i < 9; i++) {
      const a = (R() - 0.5) * 2.6, e = 0.75 + R() * 0.6;
      at("spine_03", SPHERE_LO, "#fff3d0", Math.sin(a) * Math.cos(e) * W, 0.27 + Math.sin(e) * 0.3, Math.cos(a) * Math.cos(e) * W * 0.97, V(0.016, 0.01, 0.028), eul(0, a, 0), false);
    }
    return { face: { y: 0.4, z: W * 0.86, sep: 0.09, r: 0.055 }, top: 0.57, back: { y: 0.12, z: -W - 0.01, s: 0.2 }, crumbs: ["#6cc04a", "#6cc04a", "#e2442b", "#ffc83a", "#fff3d0", "#5b2f18", PICKLE] };
  },
  watermelon({ at }) {
    const rx = 0.38, rz = 0.34;
    at("spine_02", SPHERE, "#2f7d32", 0, 0.26, 0, V(rx, 0.42, rz));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI, r = 1 / Math.hypot(Math.sin(a) / rx, Math.cos(a) / rz);
      at("spine_02", SPHERE, "#7cc35a", 0, 0.26, 0, V(0.035, 0.425, r * 1.015), eul(0, a, 0), false);
    }
    return { face: { y: 0.38, z: 0.31, sep: 0.1, r: 0.065 }, top: 0.68, back: { y: 0.24, z: -0.355, s: 0.22 }, crumbs: ["#e8434f", "#e8434f", "#e8434f", "#1b1b1b", "#2f7d32"] };
  },
  burrito({ at }) {
    at("spine_02", SPHERE, "#f1d9a0", 0, 0.3, 0, V(0.22, 0.42, 0.21));
    at("pelvis", SPHERE, "#c9ccd1", 0, 0.1, 0, V(0.226, 0.22, 0.216));
    for (const [x, z, hex] of [[-0.08, 0.02, "#f7f3e8"], [0.06, 0.04, "#6b3b23"], [0, -0.06, "#6cc04a"], [0.09, -0.04, "#e2442b"], [-0.05, -0.05, "#ffd257"]]) at("spine_03", SPHERE, hex, x, 0.68, z, V(0.07, 0.06, 0.07));
    for (const [x, y] of [[-0.08, 0.28], [0.07, 0.36], [-0.02, 0.2]]) at("spine_02", SPHERE_LO, "#c79a55", x, y, 0.2, V(0.06, 0.01, 0.01), eul(0, 0, 0.4), false);
    return { face: { y: 0.46, z: 0.19, sep: 0.07, r: 0.045 }, top: 0.74, back: { y: 0.3, z: -0.215, s: 0.16 }, crumbs: ["#f7f3e8", "#6b3b23", "#6cc04a", "#e2442b", "#f1d9a0"] };
  },
  pineapple({ at }) {
    at("spine_02", SPHERE, "#e6b422", 0, 0.27, 0, V(0.28, 0.36, 0.27));
    for (let row = -2; row <= 2; row++) for (let col = -3; col <= 3; col++) {
      if (row === 1 && Math.abs(col) <= 1) continue;
      const yy = 0.27 + row * 0.1, e = Math.asin((yy - 0.27) / 0.37), a = col * 0.32 + (row % 2 ? 0.16 : 0);
      at("spine_02", SPHERE_LO, "#a8741a", Math.sin(a) * 0.28 * Math.cos(e), yy, Math.cos(a) * 0.27 * Math.cos(e), V(0.022, 0.022, 0.012), eul(0, a, 0), false);
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU, k = i === 0 ? 0 : 1;
      at("spine_03", CONE_UP, "#3e9b3a", Math.sin(a) * 0.05 * k, 0.72, Math.cos(a) * 0.05 * k, V(0.045, 0.14, 0.025), eul(0.55 * Math.cos(a) * k, a, -0.55 * Math.sin(a) * k));
    }
    return { face: { y: 0.37, z: 0.25, sep: 0.08, r: 0.05 }, top: 0.84, back: { y: 0.27, z: -0.28, s: 0.18 }, crumbs: ["#e6b422", "#ffe27a", "#ffe27a", "#3e9b3a"] };
  },
  cake({ at }) {
    for (const [bone, y] of [["pelvis", 0.04], ["spine_02", 0.22], ["spine_03", 0.4]]) at(bone, BOX, "#f3d9a4", 0, y, 0, V(0.27, 0.065, 0.22));
    for (const y of [0.13, 0.31]) at("spine_02", BOX, "#ff9ec4", 0, y, 0, V(0.28, 0.025, 0.23));
    at("spine_03", BOX, "#fff4f8", 0, 0.49, 0, V(0.28, 0.035, 0.23));
    at("spine_03", SPHERE, "#d81b3c", 0.13, 0.57, 0.05, V(0.055, 0.055, 0.055));
    return { face: { y: 0.4, z: 0.26, sep: 0.1, r: 0.05 }, top: 0.56, back: { y: 0.22, z: -0.27, s: 0.18 }, crumbs: ["#f3d9a4", "#ff9ec4", "#fff4f8", "#d81b3c"] };
  },
  turkeyleg({ at }) {
    at("spine_02", SPHERE, "#a8562a", 0, 0.24, 0, V(0.27, 0.33, 0.25));
    for (const [x, y] of [[-0.15, 0.1], [0.16, 0.2], [0.05, 0.02], [-0.18, 0.32]]) at("spine_02", SPHERE_LO, "#7d3b18", x, y, 0.2, V(0.05, 0.035, 0.02), ID, false);
    at("spine_03", CYL, "#f4ecd8", 0, 0.64, 0, V(0.05, 0.1, 0.05));
    for (const s of [-1, 1]) at("spine_03", SPHERE, "#f4ecd8", s * 0.05, 0.75, 0, V(0.06, 0.055, 0.06));
    return { face: { y: 0.36, z: 0.22, sep: 0.09, r: 0.055 }, top: 0.82, back: { y: 0.24, z: -0.26, s: 0.18 }, crumbs: ["#a8562a", "#7d3b18", "#7d3b18", "#f4ecd8"] };
  },
  hotdog({ at }) {
    for (const s of [-1, 1]) at("spine_02", SPHERE, "#e3a857", s * 0.1, 0.22, 0, V(0.1, 0.3, 0.15));
    at("spine_02", SPHERE, "#b4432a", 0, 0.26, 0.02, V(0.085, 0.4, 0.085));
    for (let i = 0; i < 8; i++) at("spine_02", SPHERE_LO, "#ffd21f", (i % 2 ? 1 : -1) * 0.035, 0.03 + i * 0.05, 0.1, V(0.04, 0.016, 0.018), eul(0, 0, (i % 2 ? -1 : 1) * 0.7), false);
    return { face: { y: 0.54, z: 0.08, sep: 0.05, r: 0.04 }, top: 0.66, back: { y: 0.25, z: -0.16, s: 0.15 }, crumbs: ["#ffd21f", "#ffd21f", "#e3a857", "#6cc04a", PICKLE] };
  },
  fries({ at, R, kit, numberMat, plate }) {
    at("spine_02", CARTON, kit.jersey, 0, 0.18, 0, V(0.24, 0.4, 0.17));
    for (let i = 0; i < 11; i++) {
      const x = (R() - 0.5) * 0.24, z = (R() - 0.5) * 0.12, h = 0.14 + R() * 0.1;
      at("spine_03", STICK, "#f6c445", x, 0.38 + h * 0.6, z, V(0.022, h, 0.022), eul((R() - 0.5) * 0.4, R() * 3, (R() - 0.5) * 0.5));
    }
    plate("spine_02", 0, 0.11, 0.142, 0.17, 0);
    return { face: { y: 0.28, z: 0.135, sep: 0.07, r: 0.045 }, top: 0.68, back: { y: 0.18, z: -0.14, s: 0.17 }, crumbs: ["#f6c445", "#f6c445", "#f6c445", kit.jersey] };
  },
  banana({ at }) {
    at("spine_02", SPHERE, "#ffe14d", 0.05, 0.08, 0, V(0.12, 0.2, 0.12), eul(0, 0, 0.25));
    at("spine_02", SPHERE, "#ffe14d", 0, 0.3, 0.01, V(0.13, 0.22, 0.13));
    at("spine_03", SPHERE, "#ffe14d", 0.06, 0.53, 0, V(0.11, 0.2, 0.11), eul(0, 0, -0.3));
    at("pelvis", SPHERE, "#5a3a1a", 0.1, -0.11, 0, V(0.03, 0.03, 0.03));
    at("spine_03", SPHERE, "#5a3a1a", 0.12, 0.72, 0, V(0.03, 0.04, 0.03));
    return { face: { y: 0.36, z: 0.12, sep: 0.05, r: 0.04 }, top: 0.74, back: { y: 0.3, z: -0.135, s: 0.13 }, crumbs: ["#ffe14d", "#fff3b0", "#5a3a1a"] };
  },
  popsicle({ at }) {
    at("spine_02", BOX, "#ff4d6d", 0, 0.42, 0, V(0.15, 0.15, 0.06));
    at("spine_02", BOX, "#ff9f43", 0, 0.17, 0, V(0.15, 0.12, 0.06));
    at("pelvis", STICK, "#e8c48a", 0, -0.08, 0, V(0.025, 0.08, 0.012));
    return { face: { y: 0.42, z: 0.075, sep: 0.06, r: 0.04 }, top: 0.6, back: { y: 0.3, z: -0.076, s: 0.14 }, crumbs: ["#ff4d6d", "#ff9f43", "#ffffff"] };
  },
  churro({ at, R }) {
    at("spine_02", CYL8, "#c98a3e", 0, 0.33, 0, V(0.08, 0.36, 0.08));
    for (const y of [-0.03, 0.69]) at(y < 0 ? "pelvis" : "spine_03", SPHERE, "#c98a3e", 0, y, 0, V(0.075, 0.05, 0.075));
    for (let i = 0; i < 16; i++) { const a = R() * TAU; at("spine_02", SPHERE_LO, "#ffffff", Math.sin(a) * 0.082, 0.02 + R() * 0.64, Math.cos(a) * 0.082, V(0.01, 0.01, 0.01), ID, false); }
    return { face: { y: 0.5, z: 0.09, sep: 0.05, r: 0.042 }, top: 0.76, back: { y: 0.3, z: -0.085, s: 0.12 }, crumbs: ["#c98a3e", "#ffffff", "#7a4a1a"] };
  },
  corndog({ at }) {
    at("spine_02", SPHERE, "#d99a3c", 0, 0.3, 0, V(0.14, 0.34, 0.14));
    at("spine_03", STICK, "#e8c48a", 0, 0.72, 0, V(0.018, 0.12, 0.018));
    for (let i = 0; i < 7; i++) at("spine_02", SPHERE_LO, i % 2 ? "#e2442b" : "#ffd21f", (i % 2 ? 1 : -1) * 0.04, 0.08 + i * 0.045, 0.135, V(0.045, 0.016, 0.016), eul(0, 0, (i % 2 ? -1 : 1) * 0.6), false);
    return { face: { y: 0.47, z: 0.12, sep: 0.05, r: 0.04 }, top: 0.86, back: { y: 0.3, z: -0.15, s: 0.13 }, crumbs: ["#d99a3c", "#ffd21f", "#e2442b"] };
  },
  taco({ at, R }) {
    const ty = 0.42;
    at("spine_02", TACO, "#eab54c", 0, ty, 0, V(0.36, 0.42, 0.22));
    for (let i = 0; i < 9; i++) {
      const x = -0.3 + i * 0.075, hex = ["#6cc04a", "#e2442b", "#6cc04a", "#7a4a2a", "#ffd257"][i % 5];
      at("spine_03", SPHERE, hex, x, ty + 0.03 + R() * 0.03, (R() - 0.5) * 0.12, V(0.055, 0.035 + R() * 0.02, 0.06), ID, i % 2 === 0);
    }
    return { face: { y: ty - 0.13, z: 0.115, sep: 0.09, r: 0.055 }, top: ty + 0.09, back: { y: ty - 0.16, z: -0.115, s: 0.18 }, crumbs: ["#6cc04a", "#6cc04a", "#e2442b", "#7a4a2a", "#ffd257", "#eab54c"] };
  },
  sushi({ at }) {
    at("spine_02", CYL, "#1f3d2b", 0, 0.25, 0, V(0.22, 0.2, 0.22));
    at("spine_03", CYL, "#f8f6ee", 0, 0.455, 0, V(0.2, 0.012, 0.2));
    at("spine_03", CYL, "#ff8a5c", 0, 0.47, 0, V(0.08, 0.012, 0.08));
    for (const [x, z] of [[0.11, 0.04], [-0.1, -0.06]]) at("spine_03", CYL, "#7cc35a", x, 0.468, z, V(0.03, 0.01, 0.03));
    return { face: { y: 0.3, z: 0.21, sep: 0.08, r: 0.05 }, top: 0.5, back: { y: 0.2, z: -0.225, s: 0.17 }, crumbs: ["#f8f6ee", "#f8f6ee", "#ff8a5c", "#1f3d2b"] };
  },
  pretzel({ at, R }) {
    for (const s of [-1, 1]) at("spine_02", DONUT, "#9b5a24", s * 0.11, 0.4, 0, V(0.11, 0.11, 0.1), eul(0, 0, s * 0.3));
    at("spine_02", TORUS, "#9b5a24", 0, 0.32, 0, V(0.22, 0.22, 0.3), eul(0, 0, Math.PI));
    for (const s of [-1, 1]) at("spine_02", SPHERE, "#9b5a24", 0, 0.28, 0.02 * s, V(0.04, 0.12, 0.04), eul(0, 0, s * 0.6));
    for (let i = 0; i < 12; i++) at("spine_02", BOX, "#ffffff", (R() - 0.5) * 0.4, 0.15 + R() * 0.35, 0.06, V(0.01, 0.01, 0.01), eul(R(), R(), R()), false);
    return { face: { y: 0.42, z: 0.06, sep: 0.11, r: 0.04 }, top: 0.56, back: { y: 0.3, z: -0.06, s: 0.13 }, crumbs: ["#9b5a24", "#ffffff", "#ffffff"] };
  },
  icecream({ at }) {
    at("spine_02", CONE_DOWN, "#d9a35a", 0, 0.18, 0, V(0.17, 0.24, 0.17));
    at("spine_02", SPHERE, "#ff9ec4", 0, 0.45, 0, V(0.2, 0.16, 0.2));
    at("spine_03", SPHERE, "#a8e6c9", 0, 0.62, 0, V(0.16, 0.14, 0.16));
    at("spine_03", SPHERE, "#d81b3c", 0.06, 0.77, 0, V(0.04, 0.04, 0.04));
    return { face: { y: 0.47, z: 0.18, sep: 0.07, r: 0.045 }, top: 0.78, back: { y: 0.25, z: -0.12, s: 0.12 }, crumbs: ["#ff9ec4", "#a8e6c9", "#d9a35a"] };
  },
  cupcake({ at, R, kit }) {
    at("spine_02", WRAP, kit.jersey, 0, 0.14, 0, V(0.2, 0.15, 0.2));
    at("spine_02", SPHERE, "#ffd1e6", 0, 0.34, 0, V(0.23, 0.11, 0.23));
    at("spine_03", SPHERE, "#ffd1e6", 0, 0.45, 0, V(0.17, 0.09, 0.17));
    at("spine_03", SPHERE, "#ffd1e6", 0, 0.54, 0, V(0.1, 0.07, 0.1));
    for (let i = 0; i < 12; i++) { const a = R() * TAU; at("spine_02", SPHERE_LO, SPRINKLES[i % 6], Math.sin(a) * 0.2, 0.38 + R() * 0.06, Math.cos(a) * 0.2, V(0.008, 0.022, 0.008), eul(0, 0, R() * 3), false); }
    return { face: { y: 0.33, z: 0.21, sep: 0.08, r: 0.045 }, top: 0.6, back: { y: 0.14, z: -0.2, s: 0.15 }, crumbs: ["#ffd1e6", "#ffd1e6", ...SPRINKLES.slice(0, 3), kit.jersey] };
  },
  egg({ at }) {
    at("spine_02", SPHERE, "#fbfbf3", 0, 0.3, 0, V(0.3, 0.33, 0.05));
    at("spine_02", SPHERE, "#fbfbf3", 0.18, 0.12, 0, V(0.16, 0.14, 0.048));
    at("spine_02", SPHERE, "#fbfbf3", -0.17, 0.48, 0, V(0.14, 0.12, 0.048));
    at("spine_02", SPHERE, "#ffc21a", 0.02, 0.34, 0.03, V(0.13, 0.13, 0.07));
    return { face: { y: 0.36, z: 0.09, sep: 0.05, r: 0.035 }, top: 0.64, back: { y: 0.3, z: -0.055, s: 0.15 }, crumbs: ["#fbfbf3", "#fbfbf3", "#ffc21a"] };
  },
  pizza({ at }) {
    const cy = 0.32;
    at("spine_02", SLICE, "#ffd257", 0, cy, 0, V(0.3, 0.36, 0.3));
    at("spine_03", SPHERE, "#d48a3a", 0, cy + 0.255, 0, V(0.34, 0.055, 0.06));
    for (const [x, y] of [[-0.12, 0.12], [0.1, 0.05], [-0.02, -0.12], [0.05, -0.27]]) at("spine_02", DISC, "#c8352a", x, cy + y - 0.06, 0.04, V(0.045, 0.045, 0.012));
    return { face: { y: cy + 0.12, z: 0.045, sep: 0.08, r: 0.05 }, top: cy + 0.32, back: { y: cy, z: -0.045, s: 0.15 }, crumbs: ["#c8352a", "#c8352a", "#ffd257", "#d48a3a"] };
  },
  donut({ at, R, kit }) {
    const cy = 0.28, r = 0.24;
    at("spine_02", DONUT, "#d9a066", 0, cy, 0, V(r, r, r * 0.9));
    at("spine_02", ICING, kit.jersey, 0, cy, 0.035, V(r * 1.02, r * 1.02, r * 0.75));
    for (let i = 0; i < 16; i++) {
      const a = R() * TAU, rr = r * (0.75 + R() * 0.5);
      at("spine_02", SPHERE_LO, SPRINKLES[i % SPRINKLES.length], Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.035 + r * 0.42, V(0.008, 0.024, 0.008), eul(0, 0, R() * 3), false);
    }
    return { face: { y: cy + r * 0.95, z: r * 0.5, sep: 0.07, r: 0.045 }, top: cy + r * 1.5, back: { y: cy - r, z: -r * 0.5, s: 0.16 }, crumbs: [...SPRINKLES, kit.jersey] };
  },
  sandwich({ at }) {
    for (const z of [0.075, -0.075]) at("spine_02", BOX, "#f0d49a", 0, 0.28, z, V(0.26, 0.28, 0.025));
    at("spine_02", BOX, "#6cc04a", 0.01, 0.27, 0.035, V(0.28, 0.29, 0.015), eul(0, 0, -0.05));
    at("spine_02", BOX, "#f59ab0", 0, 0.28, 0, V(0.27, 0.28, 0.02));
    at("spine_02", BOX, "#ffc83a", 0, 0.29, -0.035, V(0.25, 0.3, 0.015), eul(0, 0, 0.08));
    return { face: { y: 0.36, z: 0.105, sep: 0.08, r: 0.05 }, top: 0.6, back: { y: 0.25, z: -0.105, s: 0.17 }, crumbs: ["#f0d49a", "#6cc04a", "#f59ab0", "#ffc83a", PICKLE] };
  },
  waffle({ at }) {
    at("spine_02", BOX, "#e0a64a", 0, 0.28, 0, V(0.24, 0.26, 0.055));
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) at("spine_02", BOX, "#b97a2f", (i - 1.5) * 0.11, 0.28 + (j - 1.5) * 0.11, 0.058, V(0.035, 0.035, 0.01), ID, false);
    at("spine_03", BOX, "#ffe680", 0, 0.555, 0, V(0.07, 0.02, 0.045));
    for (const [x, h] of [[-0.12, 0.07], [0.06, 0.1]]) at("spine_02", SPHERE, "#a0521b", x, 0.53 - h, 0.06, V(0.025, h, 0.012), ID, false);
    return { face: { y: 0.39, z: 0.075, sep: 0.11, r: 0.05 }, top: 0.6, back: { y: 0.28, z: -0.068, s: 0.17 }, crumbs: ["#e0a64a", "#b97a2f", "#a0521b", "#ffe680"] };
  },
  cookie({ at, R }) {
    at("spine_02", DISC, "#d9a35a", 0, 0.3, 0, V(0.3, 0.3, 0.05));
    for (let n = 0; n < 9;) {
      const a = R() * TAU, rr = R() * 0.24, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (y > -0.04 && Math.abs(x) < 0.16) continue;
      at("spine_02", SPHERE_LO, "#3b2314", x, 0.3 + y, 0.026, V(0.03, 0.026, 0.015), ID, false); n++;
    }
    return { face: { y: 0.38, z: 0.03, sep: 0.08, r: 0.05 }, top: 0.62, back: { y: 0.28, z: -0.028, s: 0.17 }, crumbs: ["#d9a35a", "#d9a35a", "#3b2314"] };
  },
  apple({ at }) {
    at("spine_02", SPHERE, "#e23b3b", 0, 0.28, 0, V(0.3, 0.29, 0.28));
    at("spine_02", SPHERE, "#ff9a8a", -0.13, 0.38, 0.2, V(0.04, 0.06, 0.02), eul(0, -0.5, 0.3), false);
    at("spine_03", CYL, "#5a3a1a", 0, 0.62, 0, V(0.015, 0.06, 0.015));
    at("spine_03", SPHERE, "#4caf50", 0.07, 0.64, 0, V(0.07, 0.02, 0.035), eul(0, 0, -0.4));
    return { face: { y: 0.34, z: 0.26, sep: 0.09, r: 0.055 }, top: 0.58, back: { y: 0.28, z: -0.29, s: 0.18 }, crumbs: ["#e23b3b", "#fff3d6", "#fff3d6", "#4caf50"] };
  },
  pancakes({ at }) {
    for (let i = 0; i < 4; i++) at(i < 2 ? "pelvis" : "spine_02", CYL, "#e8b363", 0, 0.0 + i * 0.1, 0, V(0.3, 0.045, 0.3));
    at("spine_03", CYL, "#a0521b", 0, 0.35, 0, V(0.27, 0.012, 0.27));
    at("spine_03", BOX, "#ffe680", 0, 0.38, 0, V(0.07, 0.025, 0.06));
    for (const x of [-0.16, 0.12]) at("spine_02", SPHERE, "#a0521b", x, 0.29, 0.25, V(0.03, 0.07, 0.02), ID, false);
    return { face: { y: 0.2, z: 0.29, sep: 0.09, r: 0.05 }, top: 0.41, back: { y: 0.15, z: -0.31, s: 0.18 }, crumbs: ["#e8b363", "#e8b363", "#a0521b", "#ffe680"] };
  },
};

export class SnackBody {
  // body: the snack's build (height, legs, arms, girth); key: which snack
  constructor(athlete, kit, num, body, numberMat, key) {
    this.kind = BUILD[key] ? key : "pizza";
    const d = (this.d = { torso: 1, neck: 1, girth: body.girth || 1, legs: body.legs || 0.9, arms: body.arms || 1 });
    const B = athlete.bones;
    reshape(B, d);
    athlete.root.updateMatrixWorld(true);
    const P = (n) => wp(B[n]);
    const pel = P("pelvis");
    // the snack is drawn SIZE× bigger than its build numbers, about its middle: it swallows more of the player
    const P0 = (x, y, z) => V(pel.x + x * SIZE, pel.y + MID + (y - MID) * SIZE, pel.z + z * SIZE);
    const at = (bone, geo, hex, x, y, z, radii, q = ID, ink = true) => mount(B[bone], part(geo, hex, ink, true), P0(x, y, z), q, radii.multiplyScalar(SIZE));
    const plate = (bone, x, y, z, s, turn) => { const m = new THREE.Mesh(PLATE, numberMat); m.renderOrder = 2; mount(B[bone], m, P0(x, y, z), eul(0, turn, 0), V(s * SIZE, s * SIZE, 1)); };
    this.pupils = []; this.toppers = [];

    // limbs: team sleeves on stick arms with big cartoon gloves, team pants, socks, cleats
    for (const side of ["l", "r"]) {
      const sh = P(`upperarm_${side}`), el = P(`lowerarm_${side}`), wr = P(`hand_${side}`);
      mount(B[`upperarm_${side}`], part(SPHERE, kit.jersey), sh.clone().lerp(el, 0.5), along(sh, el), V(0.055, sh.distanceTo(el) * 0.58, 0.055));
      mount(B[`lowerarm_${side}`], part(SPHERE, "#4a2f1c"), el.clone().lerp(wr, 0.5), along(el, wr), V(0.03, el.distanceTo(wr) * 0.56, 0.03));
      mount(B[`hand_${side}`], part(SPHERE, "#f7f5ee", true, true), wr.clone().addScaledVector(new THREE.Vector3().subVectors(wr, el).normalize(), 0.04), along(el, wr), V(0.06, 0.065, 0.05));
      const hip = P(`thigh_${side}`), kn = P(`calf_${side}`), an = P(`foot_${side}`), toe = P(`ball_${side}`);
      mount(B[`thigh_${side}`], part(SPHERE, kit.pants, true, true), hip.clone().lerp(kn, 0.5), along(hip, kn), V(0.065, hip.distanceTo(kn) * 0.6, 0.065));
      mount(B[`calf_${side}`], part(SPHERE, kit.sock || kit.jersey, true, true), kn.clone().lerp(an, 0.5), along(kn, an), V(0.045, kn.distanceTo(an) * 0.58, 0.045));
      const fwd = new THREE.Vector3().subVectors(toe, an).setY(0).normalize();
      mount(B[`foot_${side}`], part(SPHERE, kit.cleat || "#1b1b1d", true, true), V(an.x + fwd.x * 0.05, Math.max(0.05, an.y - 0.04), an.z + fwd.z * 0.05), ID, V(0.065, 0.05, 0.12));
    }
    const { face, top, back, crumbs } = BUILD[this.kind]({ at, R: rnd(hashS(this.kind) + (num || 0)), kit, numberMat, plate });
    this.crumbs = crumbs;
    // googly eyes and a grin (on the bone nearest their height)
    const fb = face.y > 0.4 ? "spine_03" : "spine_02";
    for (const s of [-1, 1]) {
      const eye = part(SPHERE, "#fbfbf6", true);
      mount(B[fb], eye, P0(s * face.sep, face.y, face.z), ID, V(face.r, face.r * 1.1, face.r * 0.7).multiplyScalar(SIZE));
      const pupil = new THREE.Mesh(SPHERE_LO, toon("#15110d")); pupil.scale.set(0.5, 0.5, 0.5); pupil.position.set(0, 0, 0.62); eye.add(pupil);
      this.pupils.push({ m: pupil });
    }
    mount(B[fb], new THREE.Mesh(TORUS, toon("#2a1f1a")), P0(0, face.y - face.r * 1.9, face.z), eul(0, 0, Math.PI), V(face.r * 1.1, face.r * 0.8, face.r * 0.6).multiplyScalar(SIZE));
    // a little helmet perched on top, and the number on the back
    const hm = at("spine_03", DOME, kit.helmet, 0, top - 0.02, 0, V(0.11, 0.09, 0.11), eul(0, 0, 0.15));
    hm.add(new THREE.Mesh(new THREE.SphereGeometry(1.02, 4, 10, Math.PI / 2 - 0.15, 0.3, 0, Math.PI / 2), toon(kit.accent)));
    plate(back.y > 0.4 ? "spine_03" : "spine_02", 0, back.y, back.z - 0.003, back.s, Math.PI);
    this.spring = { x: 0, y: 0, vx: 0, vy: 0 }; this.lastV = new THREE.Vector3(); this.t = 0;
  }
}
SnackBody.prototype.update = KookyBody.prototype.update; // legs set the hip height; the pupils wobble

// toppings knocked loose: little toon chunks that fly, bounce, settle and shrink away
const CRUMB = new THREE.BoxGeometry(0.07, 0.03, 0.07);
export class Crumbs {
  constructor(scene, n = 500) {
    this.m = new THREE.InstancedMesh(CRUMB, new THREE.MeshLambertMaterial(), n);
    this.m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.m.frustumCulled = false; this.m.castShadow = true;
    this.items = Array.from({ length: n }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, size: 1 }));
    this.next = 0; this.o = new THREE.Object3D(); this.c = new THREE.Color();
    for (let i = 0; i < n; i++) { this.m.setColorAt(i, this.c.set("#fff")); this.hide(i); }
    scene.add(this.m);
  }
  hide(i) { this.o.scale.setScalar(0); this.o.updateMatrix(); this.m.setMatrixAt(i, this.o.matrix); }
  burst(at, vel, colors, power = 1) {
    if (!colors) return;
    const n = Math.round(clamp(power, 0.2, 2) * 14);
    for (let k = 0; k < n; k++) {
      const i = this.next, it = this.items[i]; this.next = (this.next + 1) % this.items.length;
      const a = Math.random() * Math.PI * 2, sp = (1.5 + Math.random() * 3) * power;
      it.pos.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.4, (Math.random() - 0.5) * 0.3));
      it.vel.copy(vel).multiplyScalar(0.5).add(new THREE.Vector3(Math.cos(a) * sp, (2.5 + Math.random() * 3.5) * Math.min(power, 1.4), Math.sin(a) * sp));
      it.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(18);
      it.life = 2.5 + Math.random() * 1.5;
      const hex = colors[Math.floor(Math.random() * colors.length)];
      it.size = hex === "#4f8f2e" ? 1.8 : 0.7 + Math.random() * 0.7; // pickles are big
      this.m.setColorAt(i, this.c.set(hex));
    }
    this.m.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const o = this.o;
    this.items.forEach((it, i) => {
      if (it.life <= 0) return;
      it.life -= dt;
      if (it.life <= 0) { this.hide(i); return; }
      it.vel.y -= 14 * dt; it.pos.addScaledVector(it.vel, dt);
      if (it.pos.y < 0.02) { it.pos.y = 0.02; it.vel.y *= -0.35; it.vel.x *= 0.6; it.vel.z *= 0.6; it.spin.multiplyScalar(0.5); }
      it.rot.x += it.spin.x * dt; it.rot.y += it.spin.y * dt; it.rot.z += it.spin.z * dt;
      o.position.copy(it.pos); o.rotation.copy(it.rot); o.scale.setScalar(it.size * Math.min(1, it.life / 0.6));
      o.updateMatrix(); this.m.setMatrixAt(i, o.matrix);
    });
    this.m.instanceMatrix.needsUpdate = true;
  }
}
