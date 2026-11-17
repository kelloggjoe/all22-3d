import { Quaternion, Vector3 } from "three";
import { moveDur } from "./sim/physics.js";

const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);
const ACROSS = new Vector3(1, 0, 0);
const FORWARD = new Vector3(0, 0, 1);
const ARM_R = ["upperarm_r", "lowerarm_r", "hand_r"];
const ARM_L = ["upperarm_l", "lowerarm_l", "hand_l"];
const LEG_R = ["thigh_r", "calf_r", "foot_r"];
const LEG_L = ["thigh_l", "calf_l", "foot_l"];
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { const u = clamp(v); return u * u * (3 - 2 * u); };
const pulse = (u) => Math.sin(Math.PI * clamp(u));

const start = new Vector3(), joint = new Vector3(), end = new Vector3();
const direction = new Vector3(), bend = new Vector3(), goal = new Vector3(), hint = new Vector3();
const localAim = new Vector3(), restAim = new Vector3(), axis = new Vector3();
const parentRotation = new Quaternion(), turn = new Quaternion();

const PASS = [
  // time, throwing wrist, elbow guide, off hand, torso twist
  [0,    [-0.27, 1.42,  0.26], [-0.59, 1.24, 0.01], [ 0.06, 1.42, 0.28], -0.03],
  [0.31, [-0.43, 1.84, -0.34], [-0.88, 1.63, 0.08], [ 0.10, 1.53, 0.45], -0.46],
  [0.53, [-0.19, 2.04,  0.39], [-0.62, 1.82, 0.38], [ 0.15, 1.30, 0.30],  0.28],
  [0.75, [ 0.19, 1.43,  0.42], [-0.26, 1.40, 0.54], [ 0.31, 1.22, 0.10],  0.51],
  [1,    [ 0.11, 1.04,  0.09], [-0.48, 1.22, 0.05], [ 0.29, 1.10, 0.04],  0.12],
];
const SPIKE = [
  [0,    [-0.27, 1.42, 0.26], [-0.59, 1.24, 0.01], [0.06, 1.42, 0.28], 0],
  [0.31, [-0.37, 1.71, 0.14], [-0.66, 1.58, 0.01], [0.29, 1.27, 0.23], -0.17],
  [0.53, [-0.19, 1.24, 0.44], [-0.52, 1.39, 0.41], [0.35, 1.22, 0.11], 0.16],
  [0.75, [-0.09, 0.99, 0.31], [-0.39, 1.17, 0.33], [0.35, 1.16, 0.06], 0.22],
  [1,    [-0.21, 1.07, 0.11], [-0.39, 1.18, 0.02], [0.30, 1.09, 0.03], 0.03],
];

export function throwReleaseTime({ lob, spike }) {
  return spike ? 0.10 : lob ? 0.16 : 0.115;
}

export const THROW_END = 0.49;

export class FootballMoves {
  constructor(athlete) {
    this.athlete = athlete;
    this.root = athlete.root;
    this.bones = athlete.bones;
    this.scale = athlete.model.scale.y * 0.9144;
    this.saved = new Map();
    this.edited = [];
    this.plant = new Vector3();
    this.move = "";
    this.age = 0;
    this.cut = 1;
  }

  resetPose() {
    for (const bone of this.edited) {
      const state = this.saved.get(bone);
      bone.position.copy(state.position);
      bone.quaternion.copy(state.quaternion);
      state.edited = false;
    }
    this.edited.length = 0;
  }

  remember(bone) {
    if (!this.saved.has(bone)) this.saved.set(bone, { position: new Vector3(), quaternion: new Quaternion() });
    const state = this.saved.get(bone);
    if (state.edited) return;
    state.position.copy(bone.position);
    state.quaternion.copy(bone.quaternion);
    state.edited = true;
    this.edited.push(bone);
  }

  prepare(move, time, abs, heading) {
    this.started = move !== this.move || time < this.age;
    this.move = move;
    this.age = time;
    if (this.started && move === "juke") {
      const lateral = abs.moveX * Math.cos(heading) + abs.moveY * Math.sin(heading);
      this.cut = lateral < 0 ? -1 : 1;
    }
    this.phase = move ? clamp(time / moveDur(move)) : 0;
    return this.phase;
  }

  jointPosition(bone, out) {
    return this.root.worldToLocal(bone.getWorldPosition(out));
  }

  rotate(bone, rootAxis, radians) {
    this.remember(bone);
    this.root.getWorldQuaternion(turn);
    axis.copy(rootAxis).applyQuaternion(turn);
    bone.parent.getWorldQuaternion(parentRotation).invert();
    axis.applyQuaternion(parentRotation).normalize();
    bone.quaternion.premultiply(turn.setFromAxisAngle(axis, radians));
  }

  lowerHips(amount) {
    const pelvis = this.bones.pelvis;
    this.remember(pelvis);
    this.jointPosition(pelvis, goal).y -= amount * this.scale;
    pelvis.position.copy(pelvis.parent.worldToLocal(this.root.localToWorld(goal)));
  }

  aim(bone, child, desired, weight) {
    this.remember(bone);
    bone.parent.worldToLocal(this.root.localToWorld(localAim.copy(desired))).sub(bone.position).normalize();
    restAim.copy(child.position).normalize().applyQuaternion(bone.quaternion);
    turn.setFromUnitVectors(restAim, localAim).multiply(bone.quaternion);
    bone.quaternion.slerp(turn, weight);
  }

  solve(chain, at, pole, weight) {
    if (weight <= 0) return;
    const [upper, lower, tip] = chain.map((name) => this.bones[name]);
    this.jointPosition(upper, start);
    this.jointPosition(lower, joint);
    this.jointPosition(tip, end);
    const a = start.distanceTo(joint), b = joint.distanceTo(end);
    direction.subVectors(at, start);
    const length = Math.max(Math.abs(a - b) + 0.001, Math.min(a + b - 0.001, direction.length()));
    direction.normalize();
    bend.subVectors(pole, start).addScaledVector(direction, -bend.dot(direction)).normalize();
    const center = (a * a - b * b + length * length) / (2 * length);
    joint.copy(start).addScaledVector(direction, center).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - center * center)));
    end.copy(start).addScaledVector(direction, length);
    this.aim(upper, lower, joint, weight);
    this.aim(lower, tip, end, weight);
  }

  hand(chain, x, y, z, px, py, pz, weight) {
    this.solve(chain, goal.set(x, y, z).multiplyScalar(this.scale), hint.set(px, py, pz).multiplyScalar(this.scale), weight);
  }

  foot(chain, x, y, z, weight, plant = 0) {
    if (weight <= 0) return;
    goal.set(x, y, z).multiplyScalar(this.scale);
    if (plant > 0) {
      this.root.worldToLocal(hint.copy(this.plant));
      goal.lerp(hint, plant);
    }
    this.solve(chain, goal, hint.set(x * 0.7, 0.55, z + 0.70).multiplyScalar(this.scale), weight);
    const ankle = this.bones[chain[2]];
    const toe = this.bones[chain === LEG_R ? "ball_r" : "ball_l"];
    this.jointPosition(ankle, goal);
    goal.y -= 0.075 * this.scale;
    goal.z += 0.17 * this.scale;
    this.aim(ankle, toe, goal, weight);
  }

  keepCleatsAboveTurf() {
    for (const chain of [LEG_R, LEG_L]) {
      const ankle = this.bones[chain[2]];
      const toe = this.bones[chain === LEG_R ? "ball_r" : "ball_l"];
      ankle.getWorldPosition(goal);
      if (toe.getWorldPosition(hint).y >= 0.01 && goal.y >= 0.10 * this.scale) continue;
      goal.y = Math.max(goal.y, 0.10 * this.scale);
      this.root.worldToLocal(goal);
      this.jointPosition(this.bones[chain[1]], hint);
      this.solve(chain, goal, hint, 1);

      this.root.getWorldQuaternion(turn);
      hint.copy(FORWARD).applyQuaternion(turn).setY(0).normalize().multiplyScalar(0.17 * this.scale);
      ankle.getWorldPosition(goal).add(hint);
      goal.y = Math.max(0.02, goal.y - 0.075 * this.scale);
      this.aim(ankle, toe, this.root.worldToLocal(goal), 1);
    }
  }

  carry(pocket, weight = 1) {
    if (pocket) {
      this.hand(ARM_R, -0.27, 1.42, 0.26, -0.59, 1.24, 0.01, weight);
      this.hand(ARM_L, 0.06, 1.42, 0.28, 0.57, 1.20, 0.22, weight * 0.93);
    } else {
      this.hand(ARM_R, -0.21, 1.30, 0.27, -0.60, 0.98, -0.04, weight);
    }
  }

  throw(shot, time, speed) {
    const release = throwReleaseTime(shot);
    const u = time <= release ? 0.53 * time / release : 0.53 + 0.47 * clamp((time - release) / (THROW_END - release));
    const keys = shot.spike ? SPIKE : PASS;
    const i = keys.findIndex(([time], index) => index > 0 && time >= u);
    const from = keys[i - 1], to = keys[i];
    const blend = smooth((u - from[0]) / (to[0] - from[0]));
    const weight = 1 - smooth((u - 0.78) / 0.22);
    const mix = (a, b) => a + (b - a) * blend;
    this.rotate(this.bones.spine_01, UP, mix(from[4], to[4]) * weight);
    this.rotate(this.bones.spine_03, ACROSS, (shot.spike ? 0.30 : 0.10) * pulse(u) * u);
    const wrist = from[1].map((x, k) => mix(x, to[1][k]));
    const elbow = from[2].map((x, k) => mix(x, to[2][k]));
    const guide = from[3].map((x, k) => mix(x, to[3][k]));
    if (shot.lob) wrist[1] += 0.065 * pulse(u);
    this.hand(ARM_R, ...wrist, ...elbow, weight);
    this.hand(ARM_L, ...guide, 0.58, 1.21, 0.11, weight);
    const setFeet = clamp(1 - (speed - 0.45) / 2.2) * weight;
    this.foot(LEG_R, -0.22, 0.125, -0.22, setFeet);
    this.foot(LEG_L, 0.20, 0.125 + 0.10 * pulse(u / 0.55), 0.12 + 0.28 * smooth(u / 0.60), setFeet);
  }

  juke(u) {
    const cut = this.cut;
    const plantLeg = cut > 0 ? LEG_R : LEG_L;
    const stepLeg = cut > 0 ? LEG_L : LEG_R;
    if (this.started) {
      this.bones[plantLeg[2]].getWorldPosition(this.plant);
      this.plant.y = this.root.position.y + 0.115 * this.scale;
    }
    const weight = smooth(u / 0.13) * (1 - smooth((u - 0.69) / 0.31));
    const drive = smooth((u - 0.22) / 0.52);
    this.lowerHips(0.16 * weight);
    this.rotate(this.bones.spine_01, UP, cut * (0.25 - 0.46 * drive) * weight);
    this.foot(plantLeg, -cut * 0.30, 0.11, 0.22 - 0.57 * drive, weight, 1 - smooth((u - 0.23) / 0.35));
    this.foot(stepLeg, cut * (0.15 + 0.28 * drive), 0.11 + 0.22 * pulse(drive), -0.14 + 0.53 * drive, weight);
    this.carry(false);
    this.hand(ARM_L, 0.38 + 0.33 * weight, 1.18 + 0.18 * weight, 0.08 - 0.12 * cut, 0.57, 1.04, -0.20, weight);
  }

  spin(u) {
    const weight = pulse(u);
    this.lowerHips(0.12 * weight);
    this.rotate(this.bones.spine_01, UP, -0.38 * Math.sin(TAU * u));
    this.rotate(this.bones.neck_01, UP, 0.34 * Math.sin(TAU * u));
    this.foot(LEG_R, -0.15, 0.11, 0.13 - 0.32 * u, weight);
    this.foot(LEG_L, 0.24 + 0.11 * weight, 0.12 + 0.19 * weight, 0.28 * Math.cos(Math.PI * u), weight);
    this.hand(ARM_R, -0.13, 1.30, 0.26, -0.50, 1.03, -0.08, 1);
    this.hand(ARM_L, 0.08, 1.34, 0.24, 0.53, 1.02, 0.05, weight);
  }

  truck(u) {
    const weight = smooth(u / 0.20) * (1 - smooth((u - 0.65) / 0.35));
    this.lowerHips(0.13 * weight);
    this.rotate(this.bones.spine_01, UP, 0.35 * weight);
    this.rotate(this.bones.spine_03, FORWARD, 0.17 * weight);
    this.hand(ARM_R, -0.14, 1.26, 0.23, -0.49, 1.03, -0.02, 1);
    this.hand(ARM_L, 0.30, 1.32, 0.43, 0.63, 1.03, 0.16, weight);
    this.foot(LEG_R, -0.25, 0.13 + 0.20 * pulse(u / 0.64), -0.19 + 0.58 * smooth(u / 0.64), weight * 0.81);
    this.foot(LEG_L, 0.23, 0.12, 0.20 - 0.65 * u, weight * 0.81);
  }
}
