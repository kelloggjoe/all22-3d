// Keeps only the named animation clips of a GLB (no meshes, skins or materials) → a small animations-only GLB.
// node tools/trim-anims.mjs <in.glb> <out.glb> Clip1,Clip2,...
import fs from "fs";

const [, , inp, out, list] = process.argv;
const keep = new Set(list.split(","));
const b = fs.readFileSync(inp);
const jlen = b.readUInt32LE(12);
const j = JSON.parse(b.slice(20, 20 + jlen).toString());
const binStart = 20 + jlen + 8;
const bin = b.slice(binStart, binStart + b.readUInt32LE(20 + jlen));

const anims = j.animations.filter((a) => keep.has(a.name));
const missing = [...keep].filter((n) => !anims.some((a) => a.name === n));
if (missing.length) throw new Error("missing clips: " + missing.join(", "));

const parts = [], accessors = [], views = [], remap = new Map();
let off = 0;
const useAcc = (i) => {
  if (remap.has(i)) return remap.get(i);
  const a = j.accessors[i], v = j.bufferViews[a.bufferView];
  const comp = { 5126: 4, 5123: 2, 5125: 4, 5121: 1 }[a.componentType];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const start = (v.byteOffset || 0) + (a.byteOffset || 0), len = a.count * comp * n;
  if (v.byteStride && v.byteStride !== comp * n) throw new Error("strided accessor");
  const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
  parts.push(bin.slice(start, start + len));
  views.push({ buffer: 0, byteOffset: off, byteLength: len });
  off += len;
  const na = { ...a, bufferView: views.length - 1 }; delete na.byteOffset;
  accessors.push(na);
  remap.set(i, accessors.length - 1);
  return accessors.length - 1;
};
// finger bones stay in their bind pose (a loose fist): their channels are most of the file
const FINGER = /^(index|middle|pinky|ring|thumb)_/;
const newAnims = anims.map((a) => {
  const ch = a.channels.filter((c) => !FINGER.test(j.nodes[c.target.node].name || ""));
  const used = [...new Set(ch.map((c) => c.sampler))];
  return {
    name: a.name,
    channels: ch.map((c) => ({ ...c, sampler: used.indexOf(c.sampler) })),
    samplers: used.map((i) => { const s = a.samplers[i]; return { ...s, input: useAcc(s.input), output: useAcc(s.output) }; }),
  };
});
const nodes = j.nodes.map((n) => { const c = { ...n }; delete c.mesh; delete c.skin; return c; });
const outJ = { asset: j.asset, scene: j.scene || 0, scenes: j.scenes, nodes, animations: newAnims, accessors, bufferViews: views, buffers: [{ byteLength: off }] };
let js = Buffer.from(JSON.stringify(outJ));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
let bb = Buffer.concat(parts); bb = Buffer.concat([bb, Buffer.alloc((4 - (bb.length % 4)) % 4)]);
const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + bb.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bb.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(out, Buffer.concat([h, jh, js, bh, bb]));
console.log(`${anims.length} clips, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
