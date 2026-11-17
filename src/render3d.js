// The 3D stadium, field and everything drawn from the World each frame. Stadium coordinates (yards): X 0..100 goal
// line to goal line (end zones to -10 / 110), Y 0..53.33 across, Z up. three.js: x = X, y = Z, z = -Y, which keeps the
// original camera's screen left and right (camera3d.js: looking along +X, +Y is on the left).
import * as THREE from "three";
import { FIELD_W, MID_Y } from "./sim/config.js";
import { Athlete, uniformMaterial } from "./players3d.js";

const v3 = new THREE.Vector3();
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- field texture ----------
function fieldTexture(home, away, kits) {
  const PX = 24, W = 120 * PX, H = Math.round(FIELD_W * PX), c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const x = (X) => (X + 10) * PX, y = (Y) => H - Y * PX; // canvas y down = stadium Y up (texture flips it back)
  // mowed grass: alternating 5-yard bands, subtle noise
  for (let i = 0; i < 24; i++) { g.fillStyle = i % 2 ? "#2f7a3a" : "#2a7034"; g.fillRect(x(-10 + i * 5), 0, 5 * PX + 1, H); }
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.6; }
  g.putImageData(img, 0, 0);
  // end zones in the teams' colors, with their names
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
  const ez = (X0, kit0, name) => {
    // a light jersey (white, ice) paints the end zone in its accent instead, so the white lettering reads
    const kit = lum(kit0.jersey) > 185 ? { jersey: kit0.accent, accent: kit0.jersey } : kit0;
    g.fillStyle = kit.jersey; g.globalAlpha = 0.86; g.fillRect(x(X0), 0, 10 * PX, H); g.globalAlpha = 1;
    g.save(); g.translate(x(X0 + 5), H / 2); g.rotate(X0 < 0 ? -Math.PI / 2 : Math.PI / 2);
    g.font = `700 ${Math.round(PX * 6.4)}px Oswald, 'Arial Narrow', sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = PX * 0.45; g.strokeStyle = kit.accent; g.strokeText(name.toUpperCase(), 0, PX * 0.4);
    g.fillStyle = "#ffffff"; g.fillText(name.toUpperCase(), 0, PX * 0.4); g.restore();
  };
  ez(-10, kits.home, home.short); ez(100, kits.away, away.short);
  g.strokeStyle = "#f4f4f0"; g.fillStyle = "#f4f4f0";
  // sidelines and end lines
  g.lineWidth = PX * 0.3; g.strokeRect(x(-10) + PX * 0.15, PX * 0.15, 120 * PX - PX * 0.3, H - PX * 0.3);
  // yard lines every 5, goal lines thicker
  for (let X = 0; X <= 100; X += 5) { g.fillRect(x(X) - PX * (X % 100 === 0 ? 0.18 : 0.1), 0, PX * (X % 100 === 0 ? 0.36 : 0.2), H); }
  // hash marks (every yard) along the sidelines and the hashes
  for (let X = 1; X < 100; X++) {
    if (X % 5 === 0) continue;
    for (const Y of [0.5, FIELD_W - 0.5 - 0.67, 23.58, 29.75 - 0.67]) g.fillRect(x(X) - PX * 0.05, y(Y + 0.67), PX * 0.1, PX * 0.67);
  }
  // numbers every 10, both sides, the ones on the far side read from across the field
  g.font = `600 ${Math.round(PX * 2)}px Oswald, 'Arial Narrow', sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  for (let X = 10; X <= 90; X += 10) {
    const n = String(X <= 50 ? X : 100 - X);
    for (const [Y, rot] of [[9, 0], [FIELD_W - 9, Math.PI]]) {
      g.save(); g.translate(x(X), y(Y)); g.rotate(rot);
      g.fillText(n[0], -PX * 0.95, 0); g.fillText(n[1], PX * 0.95, 0);
      g.restore();
    }
  }
  // midfield: the home team's mark
  g.save(); g.translate(x(50), H / 2);
  g.fillStyle = kits.home.jersey; g.beginPath(); g.arc(0, 0, PX * 4.6, 0, Math.PI * 2); g.fill();
  g.lineWidth = PX * 0.35; g.strokeStyle = kits.home.accent; g.stroke();
  g.fillStyle = "#ffffff"; g.font = `700 ${Math.round(PX * 3.1)}px Oswald, 'Arial Narrow', sans-serif`; g.fillText(home.abbr, 0, PX * 0.2);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// a crowd: rows of seated fans on the bowl's tiers (one instanced mesh; team colors mixed with the general public)
function crowdMesh(kits, count = 9000) {
  const geo = new THREE.BoxGeometry(0.5, 0.75, 0.42);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const m = new THREE.InstancedMesh(geo, mat, count);
  const cols = [kits.home.jersey, kits.home.jersey, kits.home.accent, kits.away.jersey, "#e8e2d4", "#2b2b30", "#7a5a44", "#c9c2b4", "#3f4a5a", "#9b2f2f"].map((h) => new THREE.Color(h));
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let i = 0;
  const seat = (X, Y, Z, face) => {
    if (i >= count) return;
    p.set(X + (Math.random() - 0.5) * 0.25, Z, -Y); q.setFromAxisAngle(up, face);
    s.set(1, 0.85 + Math.random() * 0.35, 1);
    M.compose(p, q, s); m.setMatrixAt(i, M); m.setColorAt(i, cols[(Math.random() * cols.length) | 0]); i++;
  };
  // sideline stands (both sides), 22 rows rising away from the field
  for (let row = 0; row < 22; row++) {
    const off = 11 + row * 1.25, z = 2.2 + row * 0.82;
    for (let X = -12; X <= 112; X += 0.7) { if (Math.random() < 0.08) continue; seat(X, -off, z, 0); seat(X, FIELD_W + off, z, Math.PI); }
  }
  // end stands
  for (let row = 0; row < 16; row++) {
    const off = 18 + row * 1.25, z = 2.2 + row * 0.82;
    for (let Y = -6; Y <= FIELD_W + 6; Y += 0.7) { if (Math.random() < 0.1) continue; seat(-10 - off, Y, z, -Math.PI / 2); seat(110 + off, Y, z, Math.PI / 2); }
  }
  m.count = i; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  return m;
}

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

function lightTower(X, Y, faceX, faceY) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 34, 8), new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.8 }));
  pole.position.y = 17; g.add(pole);
  const bank = new THREE.Mesh(new THREE.BoxGeometry(7, 4.5, 0.6), new THREE.MeshStandardMaterial({ color: 0x22262c, emissive: 0xfff6dc, emissiveIntensity: 2.2 }));
  bank.position.y = 34.5; bank.lookAt(new THREE.Vector3(faceX - X, -20, -(faceY - Y))); g.add(bank);
  g.position.set(X, 0, -Y);
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
    if (this.stadium) { this.scene.remove(this.stadium); this.stadium.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    for (const a of this.athletes.values()) this.scene.remove(a.root);
    this.athletes.clear();
    const S = this.stadium = new THREE.Group();
    this.kits = kits; this.teams = { home, away };
    // sky: a deep evening gradient
    const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color("#060b1a") }, mid: { value: new THREE.Color("#1a2a4a") }, low: { value: new THREE.Color("#3d3a4a") } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top, mid, low; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.5, h)) : mix(low, mid, smoothstep(-0.05, 0.08, h)); gl_FragColor = vec4(c, 1.0); }",
    }));
    S.add(sky);
    // field + surrounding turf
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(170, 110), new THREE.MeshStandardMaterial({ color: 0x245c2c, roughness: 0.95 }));
    surround.rotation.x = -Math.PI / 2; surround.position.set(50, -0.02, -MID_Y); surround.receiveShadow = true; S.add(surround);
    const field = new THREE.Mesh(new THREE.PlaneGeometry(120, FIELD_W), new THREE.MeshStandardMaterial({ map: fieldTexture(home, away, kits), roughness: 0.88 }));
    field.rotation.x = -Math.PI / 2; field.position.set(50, 0, -MID_Y); field.receiveShadow = true; S.add(field);
    // the bowl: tiers under the crowd, a facade wall, the crowd itself
    const tierMat = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.9 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.8 });
    const tier = (w, d, h, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), tierMat); m.position.set(x, y, z); m.rotation.y = ry; S.add(m); };
    for (let row = 0; row < 22; row++) {
      const off = 11 + row * 1.25, z = 1.8 + row * 0.82;
      tier(128, 1.3, 0.6, 50, z - 0.3, off, 0); tier(128, 1.3, 0.6, 50, z - 0.3, -(FIELD_W + off), 0);
    }
    for (let row = 0; row < 16; row++) {
      const off = 18 + row * 1.25, z = 1.8 + row * 0.82;
      tier(FIELD_W + 16, 1.3, 0.6, -10 - off, z - 0.3, -MID_Y, Math.PI / 2); tier(FIELD_W + 16, 1.3, 0.6, 110 + off, z - 0.3, -MID_Y, Math.PI / 2);
    }
    // padded wall around the field with the home color band
    const band = new THREE.MeshStandardMaterial({ color: kits.home.jersey, roughness: 0.6 });
    const wall = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, 0.4), band); m.position.set(x, 0.8, z); m.rotation.y = ry; S.add(m); };
    wall(132, 50, 10.2, 0); wall(132, 50, -(FIELD_W + 10.2), 0); wall(FIELD_W + 20, -27.5, -MID_Y, Math.PI / 2); wall(FIELD_W + 20, 127.5, -MID_Y, Math.PI / 2);
    S.add(crowdMesh(kits));
    // upper facade ring
    for (const [w, x, z, ry] of [[160, 50, 40, 0], [160, 50, -(FIELD_W + 40), 0], [FIELD_W + 80, -50, -MID_Y, Math.PI / 2], [FIELD_W + 80, 150, -MID_Y, Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 6, 1), wallMat); m.position.set(x, 21, z); m.rotation.y = ry; S.add(m);
    }
    S.add(goalPost(-10, -1), goalPost(110, 1));
    // pylons
    const pyl = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 });
    for (const X of [0, -10, 100, 110]) for (const Y of [0, FIELD_W]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), pyl); m.position.set(X, 0.3, -Y); S.add(m); }
    // benches on the sidelines (the home side near the main camera's left)
    for (const [Y, kit] of [[-6, kits.home], [FIELD_W + 6, kits.away]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(30, 0.9, 1.2), new THREE.MeshStandardMaterial({ color: kit.jersey, roughness: 0.7 }));
      m.position.set(50, 0.45, -Y); S.add(m);
    }
    // lights: stadium banks (key light with shadows from above the near sideline), fill, and the towers' look
    S.add(new THREE.HemisphereLight(0xc8d4ff, 0x1d3a1f, 0.9));
    const key = new THREE.DirectionalLight(0xfff3e0, 2.6);
    key.position.set(50, 70, 40); key.target.position.set(50, 0, -MID_Y);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 10; sc.far = 200;
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    this.key = key;
    S.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.9); fill.position.set(50, 60, -(FIELD_W + 40)); fill.target.position.set(50, 0, -MID_Y); S.add(fill, fill.target);
    for (const [X, Y] of [[-14, -16], [114, -16], [-14, FIELD_W + 16], [114, FIELD_W + 16], [50, -22], [50, FIELD_W + 22]]) S.add(lightTower(X, Y, 50, MID_Y));
    this.scene.add(S);
    // line of scrimmage (blue) and first down (yellow) lines laid on the turf, TV style
    const lineGeo = new THREE.PlaneGeometry(0.22, FIELD_W);
    this.losLine = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.85, depthWrite: false }));
    this.fdLine = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.9, depthWrite: false }));
    for (const l of [this.losLine, this.fdLine]) { l.rotation.x = -Math.PI / 2; l.position.set(0, 0.03, -MID_Y); l.renderOrder = 1; this.scene.add(l); }
    // the controlled player's ring
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.92, 32), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.renderOrder = 1; this.scene.add(this.ring);
    // team materials (two skin tones each)
    this.mats = { home: [uniformMaterial(kits.home, 0), uniformMaterial(kits.home, 1)], away: [uniformMaterial(kits.away, 0), uniformMaterial(kits.away, 1)] };
    // play art (route lines on the turf before the snap)
    this.art = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.art.renderOrder = 2; this.scene.add(this.art);
  }

  athleteFor(p) {
    let a = this.athletes.get(p);
    if (!a) {
      const info = p.team.players[p.slot] || {};
      const kit = this.kits[p.teamKey];
      a = new Athlete(this.mats[p.teamKey], kit, { num: p.num, skin: info.skin || 0, m: info.sp ? info.sp.m : 1.88, kg: p.r.kg });
      this.athletes.set(p, a);
      this.scene.add(a.root);
    }
    return a;
  }

  // the World → the scene, once per frame
  sync(w, dt, opts) {
    const flipC = w.possession !== "home";
    const bc = w.ball.carrier;
    const scrim = w.playType === "normal" || w.playType === "two";
    const ballAir = w.ball.state === "air" && (w.ball.kind === "pass" || w.ball.kind === "lob");
    const pre = w.phase === "live" && scrim && !w.passThrown && !w.handedOff && !w.losCrossed && !ballAir && (!bc || bc === w.qb);
    const stKick = (w.playType === "kickoff" || w.playType === "punt") && (w.phase === "live" || w.phase === "presnap") && !bc;
    const seen = new Set();
    const a = this.abs || (this.abs = { X: 0, Y: 0, fX: 1, fY: 0, vx: 0, vy: 0 });
    const ex = this.ex || (this.ex = { stance: false });
    for (const p of w.players) {
      seen.add(p);
      const ath = this.athleteFor(p);
      ath.root.visible = true;
      a.X = flipC ? 100 - p.x : p.x; a.Y = flipC ? FIELD_W - p.y : p.y;
      a.vx = flipC ? -p.vx : p.vx; a.vy = flipC ? -p.vy : p.vy;
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
      p.animT = (p.animT || 0) + dt;
      ath.sync(p, a, w, dt, ex);
    }
    for (const [p, ath] of this.athletes) if (!seen.has(p)) ath.root.visible = false;
    // the ball: in the carrier's hand, in flight, or on the turf
    const b = w.ball, B = this.ballMesh;
    const bX = flipC ? 100 - b.x : b.x, bY = flipC ? FIELD_W - b.y : b.y;
    if (b.state === "held" && b.carrier && this.athletes.get(b.carrier)) {
      const ath = this.athletes.get(b.carrier);
      ath.handWorld(B.position);
      B.rotation.set(0, ath.heading, 0); B.rotateX(-0.5);
    } else {
      B.position.set(bX, Math.max(0.12, b.z || 0), -bY);
      const vx = flipC ? -b.vx : b.vx, vy = flipC ? -b.vy : b.vy;
      if (b.state === "air" && Math.hypot(vx, vy) > 1) { B.rotation.set(0, Math.atan2(vx, -vy), 0); B.rotateX(-Math.atan2(b.vz || 0, Math.hypot(vx, vy)) * 0.8); if (b.kind === "pass" || b.kind === "lob") B.rotateZ(performance.now() * 0.03); else B.rotateX(performance.now() * 0.02); }
    }
    this.ballShadow.position.set(B.position.x, 0.02, B.position.z);
    this.ballShadow.visible = b.state === "air";
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
