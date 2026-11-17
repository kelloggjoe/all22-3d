import { Matrix4, Quaternion, Vector3 } from "three";

const STEP = 1 / 120;
const GRAVITY = 10.73; // yards/s²
const SETTLE_TIME = 1.15;
const PLAYBACK_SPEED = 0.76;
const TORSO = ["pelvis", "spine_03", "thigh_l", "thigh_r", "upperarm_l", "upperarm_r"];
const SIDES = ["l", "r"];
const SAMPLES = {
  pelvis: [0.19, 3], spine_03: [0.23, 3], Head: [0.105, 1], helmet: [0.166, 1],
};
for (const side of SIDES) {
  Object.assign(SAMPLES, {
    ["thigh_" + side]: [0.115, 2], ["calf_" + side]: [0.10, 1.4],
    ["foot_" + side]: [0.094, 1], ["ball_" + side]: [0.07, 0.8],
    ["upperarm_" + side]: [0.12, 1.6], ["lowerarm_" + side]: [0.095, 0.8],
    ["hand_" + side]: [0.082, 0.65],
  });
}

const delta = new Vector3();
const next = new Vector3();
const target = new Vector3();
const axisX = new Vector3();
const axisY = new Vector3();
const axisZ = new Vector3();
const basis = new Matrix4();
const swing = new Quaternion();

function pelvisBasis(parent, points, out) {
  parent.worldToLocal(axisX.copy(points.thigh_l.position));
  parent.worldToLocal(delta.copy(points.thigh_r.position));
  axisX.sub(delta).normalize();
  parent.worldToLocal(axisY.copy(points.spine_03.position));
  parent.worldToLocal(delta.copy(points.pelvis.position));
  axisY.sub(delta).normalize();
  axisZ.crossVectors(axisX, axisY).normalize();
  axisY.crossVectors(axisZ, axisX);
  return out.setFromRotationMatrix(basis.makeBasis(axisX, axisY, axisZ));
}

function distance(a, b, length, stiffness) {
  delta.subVectors(b.position, a.position);
  const gap = delta.length();
  if (gap < 1e-6) return;
  const correction = stiffness * (gap - length) / (gap * (a.invMass + b.invMass));
  a.position.addScaledVector(delta, correction * a.invMass);
  b.position.addScaledVector(delta, -correction * b.invMass);
}

function keepApart(a, b, padding = 1) {
  const radius = (a.radius + b.radius) * padding;
  if (a.position.distanceToSquared(b.position) < radius * radius) distance(a, b, radius, 1);
}

class TackleBody {
  constructor(athlete, rootPosition, mass, velocity, drive, planted, drop) {
    this.athlete = athlete;
    this.points = {};
    this.links = [];
    this.limbs = [];
    this.aims = [];
    const { root, bones, headGear } = athlete;
    root.position.copy(rootPosition);
    root.updateMatrixWorld(true);
    const height = athlete.model.scale.y;
    const width = athlete.model.scale.x;
    const pelvis = bones.pelvis;
    const hipHeight = pelvis.getWorldPosition(new Vector3()).y - root.position.y;
    for (const [name, [radius, weight]] of Object.entries(SAMPLES)) {
      const bone = name === "helmet" ? headGear : bones[name];
      const position = bone.getWorldPosition(new Vector3());
      const heightFromHip = (position.y - root.position.y - hipHeight) / height;
      const previous = position.clone().addScaledVector(velocity, -STEP)
        .addScaledVector(drive, -STEP * heightFromHip);
      if (heightFromHip < -0.28) previous.addScaledVector(velocity, STEP * planted);
      previous.y += STEP * drop * Math.max(0, heightFromHip + 0.12);
      this.points[name] = { position, previous, radius: radius * width, invMass: 1 / (weight * mass) };
    }
    this.samples = Object.values(this.points);

    // Brace the hips and shoulders so the solver can turn the torso without collapsing it.
    for (let i = 0; i < TORSO.length; i++) {
      for (let j = i + 1; j < TORSO.length; j++) this.link(TORSO[i], TORSO[j], 1);
    }
    for (const parent of ["spine_03", "upperarm_l", "upperarm_r"]) this.link(parent, "Head", 0.85);
    this.link("Head", "helmet", 1);
    this.link("spine_03", "helmet", 0.68);
    for (const side of SIDES) {
      const [hip, knee, ankle, toe, shoulder, elbow, wrist] =
        ["thigh", "calf", "foot", "ball", "upperarm", "lowerarm", "hand"].map((part) => part + "_" + side);
      this.limb(hip, knee, ankle, 0.38, 0.998);
      this.limb(shoulder, elbow, wrist, 0.35, 0.99);
      this.link(ankle, toe, 1);
      this.aim(bones[hip], bones[knee]);
      this.aim(bones[knee], bones[ankle]);
      this.aim(bones[ankle], bones[toe]);
      this.aim(bones[shoulder], bones[elbow]);
      this.aim(bones[elbow], bones[wrist]);
    }
    this.aim(bones.neck_01, bones.Head);
    this.aim(bones.Head, headGear, "helmet");
    this.pelvisPosition = pelvis.position.clone();
    this.pelvisRotation = pelvis.quaternion.clone();
    this.inverseHipBasis = pelvisBasis(pelvis.parent, this.points, new Quaternion()).invert();
  }

  link(first, second, stiffness) {
    const a = this.points[first];
    const b = this.points[second];
    const length = a.position.distanceTo(b.position);
    this.links.push({ a, b, length, stiffness });
    return length;
  }

  limb(start, joint, end, minBend, maxBend) {
    const length = this.link(start, joint, 1) + this.link(joint, end, 1);
    this.limbs.push({ a: this.points[start], b: this.points[end], min: length * minBend, max: length * maxBend });
  }

  aim(bone, child, sample = child.name) {
    this.aims.push({ bone, point: this.points[sample], rotation: bone.quaternion.clone(), direction: child.position.clone().normalize() });
  }

  integrate() {
    for (const { position, previous } of this.samples) {
      next.subVectors(position, previous).multiplyScalar(0.984).add(position);
      next.y -= GRAVITY * STEP * STEP;
      previous.copy(position);
      position.copy(next);
    }
  }

  constrain() {
    for (const { a, b, length, stiffness } of this.links) distance(a, b, length, stiffness);
    for (const { a, b, min, max } of this.limbs) {
      const length = a.position.distanceTo(b.position);
      if (length < min || length > max) distance(a, b, Math.min(max, Math.max(min, length)), 0.85);
    }
    for (const side of SIDES) {
      keepApart(this.points.helmet, this.points["hand_" + side]);
      keepApart(this.points.spine_03, this.points["lowerarm_" + side]);
      keepApart(this.points.pelvis, this.points["calf_" + side]);
    }
  }

  floor() {
    for (const { position, previous, radius } of this.samples) {
      if (position.y >= radius) continue;
      position.y = radius;
      previous.y = radius;
      previous.x += (position.x - previous.x) * 0.24;
      previous.z += (position.z - previous.z) * 0.24;
    }
  }

  pose() {
    const { pelvis } = this.athlete.bones;
    pelvis.position.copy(pelvis.parent.worldToLocal(target.copy(this.points.pelvis.position)));
    pelvisBasis(pelvis.parent, this.points, pelvis.quaternion).multiply(this.inverseHipBasis).multiply(this.pelvisRotation);
    for (const { bone, point, rotation, direction } of this.aims) {
      bone.parent.worldToLocal(target.copy(point.position)).sub(bone.position).normalize();
      delta.copy(direction).applyQuaternion(rotation);
      bone.quaternion.copy(swing.setFromUnitVectors(delta, target)).multiply(rotation);
    }
    this.athlete.root.updateMatrixWorld(true);
  }

  restore() {
    const { pelvis } = this.athlete.bones;
    pelvis.position.copy(this.pelvisPosition);
    pelvis.quaternion.copy(this.pelvisRotation);
    for (const { bone, rotation } of this.aims) bone.quaternion.copy(rotation);
  }
}

export class Tackle3D {
  constructor(carrier, tackler, impact) {
    const { carrierAt, tacklerAt, carrierSpeed, tacklerSpeed, carrierMass, tacklerMass, hit, dive, arm } = impact;
    const normal = carrierAt.clone().sub(tacklerAt).setY(0);
    if (normal.lengthSq() < 0.0001) normal.copy(tacklerSpeed).setY(0);
    if (normal.lengthSq() < 0.0001) normal.set(1, 0, 0);
    normal.normalize();

    const closing = Math.max(0, delta.subVectors(tacklerSpeed, carrierSpeed).dot(normal));
    const impulse = Math.min(9, closing) / (1 / carrierMass + 1 / tacklerMass);
    const runnerVelocity = carrierSpeed.clone().multiplyScalar(0.66).addScaledVector(normal, impulse / carrierMass * 0.58);
    const defenderVelocity = tacklerSpeed.clone().multiplyScalar(0.66).addScaledVector(normal, -impulse / tacklerMass * 0.58);
    // Upper-body contact and planted cleats start the rotation before gravity takes over.
    const drive = normal.clone().multiplyScalar(1.6 + closing * 0.25 + (hit ? 0.7 : 0));
    this.carrier = new TackleBody(carrier, carrierAt, carrierMass, runnerVelocity, drive, 0.65, 1.25);
    if (dive) defenderVelocity.addScaledVector(normal, 1.2);
    this.tackler = new TackleBody(tackler, tacklerAt, tacklerMass, defenderVelocity,
      normal.clone().multiplyScalar(dive ? 4.3 : 3.5), dive ? 0.30 : 0.55, dive ? 2.8 : 2.4);
    this.normal = normal;
    this.elapsed = 0;
    this.accumulator = 0;

    const r = this.carrier.points;
    const d = this.tackler.points;
    const sameSide = d.hand_l.position.distanceToSquared(r.thigh_l.position) + d.hand_r.position.distanceToSquared(r.thigh_r.position);
    const crossSide = d.hand_l.position.distanceToSquared(r.thigh_r.position) + d.hand_r.position.distanceToSquared(r.thigh_l.position);
    this.grips = sameSide < crossSide ? [[d.hand_l, r.thigh_l], [d.hand_r, r.thigh_r]] : [[d.hand_l, r.thigh_r], [d.hand_r, r.thigh_l]];
    if (arm) {
      this.grips.sort(([a, hipA], [b, hipB]) => a.position.distanceToSquared(hipA.position) - b.position.distanceToSquared(hipB.position));
      this.grips.pop();
    }
    this.arm = arm;
    this.contactPoints = ["pelvis", "spine_03", "helmet", "upperarm_l", "upperarm_r"];
  }

  step() {
    const { carrier, tackler } = this;
    carrier?.integrate();
    tackler?.integrate();
    const r = carrier?.points;
    const d = tackler?.points;
    const grip = Math.min(1, this.elapsed / 0.10) * Math.min(1, Math.max(0, (0.46 - this.elapsed) / 0.16));
    for (let i = 0; i < 8; i++) {
      carrier?.constrain();
      tackler?.constrain();
      if (r && d) {
        if (grip > 0) {
          // The tackler reaches around the hips while the shoulder follows through.
          for (const [hand, hip] of this.grips) {
            target.copy(hip.position).addScaledVector(this.normal, 0.19);
            target.y += 0.10;
            hand.position.lerp(target, grip * 0.16);
          }
          const gap = d.spine_03.position.distanceTo(r.pelvis.position);
          if (gap > 0.44) distance(d.spine_03, r.pelvis, 0.44, grip * (this.arm ? 0.075 : 0.15));
        }
        for (const a of this.contactPoints) {
          for (const b of this.contactPoints) keepApart(r[a], d[b]);
        }
      }
      carrier?.floor();
      tackler?.floor();
    }
  }

  update(dt) {
    this.accumulator += dt * PLAYBACK_SPEED;
    while (this.accumulator >= STEP && this.elapsed < SETTLE_TIME) {
      this.step();
      this.elapsed += STEP;
      this.accumulator -= STEP;
    }
    this.carrier?.pose();
    this.tackler?.pose();
  }

  release(role) {
    this[role]?.restore();
    this[role] = null;
  }

  restore() {
    this.release("carrier");
    this.release("tackler");
  }
}
