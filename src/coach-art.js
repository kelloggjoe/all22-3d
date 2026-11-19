// The head coach, drawn: a big, rosy, veteran coach with a white walrus mustache, wire glasses, a team visor and
// windbreaker, a headset and a clipboard. One SVG in a few poses; the play call shows his head, the sideline shows
// him whole (coach3d.js rasterizes the poses into sprite frames). Pure strings, no DOM.
const INK = "#1d1712", SKIN = "#f1c3a4", SKIN_D = "#e2a588", HAIR = "#d9d5ce", HAIR_D = "#b9b4ac", STACHE = "#eeeae2", KHAKI = "#c9b48a";
const S = `stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"`;

// pose: "idle" | "talk" | "cheer" | "pump" | "sulk" | "run1" | "run2" (a running stride) | "flail1" | "flail2" (arms
// everywhere) | "facepalm" | "head" (hands on his head) | "slam" (the clipboard spiked at his feet)
// mood: "calm" | "happy" (squinting grin) | "angry" (red, gritted teeth, steam) | "shock" (wide eyes, O mouth) | "sad"
// mouth: true = open (for talking)
export function coachSVG(kit, pose = "idle", { mouth = false, crop = false, mood = pose === "sulk" ? "sad" : "calm" } = {}) {
  const J = kit.jersey, A = kit.accent || "#ffffff", V = kit.helmet || J;
  const tilt = pose === "sulk" || pose === "facepalm" ? 7 : pose === "cheer" ? -4 : pose === "flail1" ? -6 : pose === "flail2" ? 6 : pose === "slam" ? 10 : 0;
  const sad = mood === "sad", angry = mood === "angry", happy = mood === "happy", shock = mood === "shock";
  const skin = angry ? "#ee9c84" : SKIN;
  const arms = {
    idle: `${arm(52, 152, 40, 236, J)}${clipboard(122, 168, -8)}${arm(168, 152, 156, 214, J)}`,
    talk: `${arm(52, 152, 14, 128, J)}${clipboard(122, 168, -8)}${arm(168, 152, 156, 214, J)}`,
    cheer: `${arm(52, 152, 26, 44, J, true)}${arm(168, 152, 192, 50, J)}${clipboard(166, -6, 14)}`,
    pump: `${arm(52, 152, 30, 96, J, true)}${arm(168, 152, 192, 96, J, true)}`,
    sulk: `${arm(52, 156, 48, 240, J)}${arm(168, 156, 170, 236, J)}${clipboard(150, 232, 70)}`,
    run1: `${arm(52, 152, 22, 112, J, true)}${arm(168, 152, 186, 222, J)}${clipboard(166, 196, 30)}`,
    run2: `${arm(52, 152, 34, 226, J, true)}${arm(168, 152, 196, 112, J)}${clipboard(176, 66, -20)}`,
    flail1: `${arm(52, 152, 4, 66, J, true)}${arm(168, 152, 214, 196, J)}${clipboard(188, 170, 48)}`,
    flail2: `${arm(52, 152, 4, 200, J, true)}${arm(168, 152, 212, 58, J)}${clipboard(184, 0, -32)}`,
    facepalm: `${arm(168, 152, 160, 230, J)}${clipboard(146, 222, 58)}${arm(52, 152, 92, 100, J)}`,
    head: `${arm(52, 152, 72, 36, J)}${arm(168, 152, 148, 36, J)}`,
    slam: `${arm(52, 156, 44, 238, J, true)}${arm(168, 156, 176, 238, J, true)}${clipboard(118, 270, 84)}`,
  }[pose] || "";
  const over = ["cheer", "pump", "flail1", "flail2", "facepalm", "head"].includes(pose); // arms in front of his head
  const head = `
    <g transform="rotate(${tilt} 110 150)">
      <circle cx="57" cy="97" r="12" fill="${skin}" ${S}/><circle cx="163" cy="97" r="12" fill="${skin}" ${S}/>
      <ellipse cx="110" cy="92" rx="54" ry="55" fill="${skin}" ${S}/>
      ${angry ? `<path d="M64 30 q-8 -10 0 -18 q8 -8 0 -16 M156 30 q8 -10 0 -18 q-8 -8 0 -16 M110 22 q-6 -8 0 -14 q6 -6 0 -12" fill="none" stroke="#f4f4f0" stroke-width="5" stroke-linecap="round" opacity=".9"/>` : ""}
      <path d="M70 128 Q110 162 150 128" fill="none" stroke="${SKIN_D}" stroke-width="3"/>
      <ellipse cx="65" cy="80" rx="13" ry="17" fill="${HAIR}" ${S}/><ellipse cx="155" cy="80" rx="13" ry="17" fill="${HAIR}" ${S}/>
      <path d="M56 56 Q110 38 164 56 L164 66 Q110 48 56 66 Z" fill="${V}" ${S}/>
      <path d="M58 64 Q110 52 162 64 Q150 80 110 78 Q70 80 58 64 Z" fill="${V}" ${S}/>
      <path d="M70 66 Q110 56 150 66" fill="none" stroke="${A}" stroke-width="3" opacity=".9"/>
      <path d="M58 80 Q60 22 110 20 Q160 22 162 80" fill="none" stroke="#26262c" stroke-width="7" stroke-linecap="round"/>
      <circle cx="56" cy="98" r="14" fill="#2c2c33" ${S}/><circle cx="164" cy="98" r="14" fill="#2c2c33" ${S}/>
      ${brows(sad, angry, shock)}
      <g class="eyes">${happy ? `<path d="M84 99 Q91 90 98 99 M122 99 Q129 90 136 99" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`
        : shock ? `<circle cx="91" cy="96" r="7.5" fill="#fff" ${S}/><circle cx="129" cy="96" r="7.5" fill="#fff" ${S}/><circle cx="91" cy="96" r="3" fill="${INK}"/><circle cx="129" cy="96" r="3" fill="${INK}"/>`
        : `<circle cx="91" cy="96" r="${angry ? 3.8 : 4.6}" fill="${INK}"/><circle cx="129" cy="96" r="${angry ? 3.8 : 4.6}" fill="${INK}"/>
        <circle cx="92.6" cy="94.4" r="1.5" fill="#fff"/><circle cx="130.6" cy="94.4" r="1.5" fill="#fff"/>`}</g>
      <circle cx="91" cy="96" r="15" fill="#cfe6ff" fill-opacity=".22" stroke="#2b2b2b" stroke-width="3.5"/>
      <circle cx="129" cy="96" r="15" fill="#cfe6ff" fill-opacity=".22" stroke="#2b2b2b" stroke-width="3.5"/>
      <path d="M106 95 Q110 92 114 95 M76 94 L62 92 M144 94 L158 92" fill="none" stroke="#2b2b2b" stroke-width="3"/>
      <ellipse cx="73" cy="116" rx="12" ry="8" fill="${angry ? "#e0574e" : "#ef8a80"}" opacity="${happy || angry ? 0.8 : 0.55}"/><ellipse cx="147" cy="116" rx="12" ry="8" fill="${angry ? "#e0574e" : "#ef8a80"}" opacity="${happy || angry ? 0.8 : 0.55}"/>
      ${mouthOf(mouth, happy, angry, shock, sad)}
      <path d="M68 120 Q110 100 152 120 Q160 134 148 142 Q141 133 134 143 Q126 134 119 144 Q110 135 101 144 Q94 134 86 143 Q79 133 72 142 Q60 134 68 120 Z" fill="${STACHE}" ${S}/>
      <ellipse cx="110" cy="110" rx="12" ry="10" fill="${SKIN_D}" ${S}/>
      <path d="M64 108 Q76 128 98 138" fill="none" stroke="#26262c" stroke-width="4" stroke-linecap="round"/><circle cx="99" cy="139" r="5" fill="#26262c"/>
    </g>`;
  const body = `
    ${legs(pose)}
    <path d="M110 120 C30 120 22 200 40 236 Q110 268 180 236 C198 200 190 120 110 120 Z" fill="${J}" ${S}/>
    <path d="M110 140 L110 254" stroke="${A}" stroke-width="3"/>
    <path d="M44 172 Q110 150 176 172" fill="none" stroke="${A}" stroke-width="5" opacity=".85"/>
    <path d="M86 136 L110 156 L134 136" fill="none" stroke="${A}" stroke-width="4"/>`;
  const vb = crop ? "36 14 148 150" : "0 -40 220 360";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="coach-art">${body}${over ? head + arms : arms + head}</svg>`;
}
function brows(sad, angry, shock) {
  const b = (d) => `<path d="${d}" fill="none" stroke="${HAIR_D}" stroke-width="7" stroke-linecap="round"/>`;
  if (angry) return b("M76 74 Q90 78 104 86") + b("M116 86 Q130 78 144 74");
  if (sad) return b("M78 84 Q90 78 102 77") + b("M118 77 Q130 78 142 84");
  if (shock) return b("M78 72 Q90 62 102 70") + b("M118 70 Q130 62 142 72");
  return b("M78 80 Q90 73 102 79") + b("M118 79 Q130 73 142 80");
}
// under the mustache: talking, grinning, gritting his teeth, gasping, or a frown
function mouthOf(open, happy, angry, shock, sad) {
  if (happy) return `<g class="mouth"><path d="M92 140 Q110 168 128 140 Z" fill="#5a1f22" ${S}/><path d="M100 152 Q110 160 120 152" fill="#e66b78"/></g>`;
  if (angry) return `<g class="mouth"><rect x="94" y="139" width="32" height="14" rx="4" fill="#fbfaf4" ${S}/><path d="M102 139 v14 M110 139 v14 M118 139 v14 M94 146 h32" stroke="${INK}" stroke-width="2"/></g>`;
  if (shock) return `<ellipse class="mouth" cx="110" cy="148" rx="8" ry="12" fill="#5a1f22" ${S}/>`;
  if (open) return `<g class="mouth"><ellipse cx="110" cy="146" rx="13" ry="10" fill="#5a1f22" ${S}/><ellipse cx="110" cy="151" rx="7" ry="4" fill="#e66b78"/></g>`;
  return `<path class="mouth" d="${sad ? "M100 149 Q110 141 120 149" : "M100 145 Q110 149 120 145"}" fill="none" ${S}/>`;
}
// legs: planted, or mid-stride (one knee up, the other foot pushing off)
function legs(pose) {
  const leg = (hx, kx, ky, fx, fy) => `<path d="M${hx} 236 Q${kx} ${ky} ${fx} ${fy}" fill="none" stroke="${INK}" stroke-width="33" stroke-linecap="round"/>
    <path d="M${hx} 236 Q${kx} ${ky} ${fx} ${fy}" fill="none" stroke="${KHAKI}" stroke-width="26" stroke-linecap="round"/>
    <ellipse cx="${fx}" cy="${fy + 8}" rx="22" ry="9" fill="#2b211a" ${S}/>`;
  if (pose === "run1") return leg(88, 70, 262, 64, 284) + leg(132, 150, 280, 160, 298);
  if (pose === "run2") return leg(88, 70, 280, 58, 298) + leg(132, 150, 262, 156, 284);
  return `<ellipse cx="82" cy="306" rx="24" ry="9" fill="#2b211a" ${S}/><ellipse cx="138" cy="306" rx="24" ry="9" fill="#2b211a" ${S}/>
    <path d="M70 236 L72 300 L96 300 L100 240 Z" fill="${KHAKI}" ${S}/><path d="M150 236 L148 300 L124 300 L120 240 Z" fill="${KHAKI}" ${S}/>`;
}
function arm(x0, y0, x1, y1, J, fist = false) {
  const mx = (x0 + x1) / 2 + (x1 < x0 ? -10 : 10), my = (y0 + y1) / 2;
  return `<path d="M${x0} ${y0} Q${mx} ${my} ${x1} ${y1}" fill="none" stroke="${INK}" stroke-width="27" stroke-linecap="round"/>
    <path d="M${x0} ${y0} Q${mx} ${my} ${x1} ${y1}" fill="none" stroke="${J}" stroke-width="20" stroke-linecap="round"/>
    <circle cx="${x1}" cy="${y1}" r="${fist ? 13 : 11}" fill="${SKIN}" ${S}/>`;
}
function clipboard(x, y, rot) {
  return `<g transform="rotate(${rot} ${x + 27} ${y + 36})"><rect x="${x}" y="${y}" width="54" height="72" rx="5" fill="#a0703c" ${S}/>
    <rect x="${x + 6}" y="${y + 10}" width="42" height="56" fill="#f6f4ec" stroke="${INK}" stroke-width="2"/>
    <path d="M${x + 12} ${y + 22} h28 M${x + 12} ${y + 32} h22 M${x + 12} ${y + 42} h26 M${x + 12} ${y + 52} h18" stroke="#3b4a6b" stroke-width="2.5"/>
    <path d="M${x + 16} ${y + 26} l6 6 M${x + 22} ${y + 26} l-6 6" stroke="#d23b3b" stroke-width="2.5"/>
    <rect x="${x + 17}" y="${y - 4}" width="20" height="10" rx="3" fill="#9aa0a8" ${S}/></g>`;
}
