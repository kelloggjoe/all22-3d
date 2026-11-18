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
