import * as THREE from 'three';
import { heightAt, rockSupportAt, CONTACT_DISTANCE, clamp, damp, lerp } from './terrain.js';
import { contactPoseAt, climbRouteFor, fitPelvis, stoneGripAt, pushingStanceAt, pushingHandsAt, CLIMB_ENTRY_X } from './locomotion.js';

const point = (x, y) => new THREE.Vector2(x, y);

function projectedJoint(limb, turn) {
  // A turning knee/elbow swings through depth instead of switching bend sides
  // in one frame. Project that arc while keeping both rendered segments joined.
  const axis = limb.end.clone().sub(limb.root);
  const along = limb.joint.clone().sub(limb.root).dot(axis) / axis.lengthSq();
  const center = limb.root.clone().addScaledVector(axis, along);
  return center.lerp(limb.joint, Math.abs(turn));
}

function blendArmReach(root, freeHand, contact, weight, throughFront = false) {
  const free = freeHand.clone().sub(root), grip = contact.clone().sub(root);
  const from = Math.atan2(free.y, free.x), to = Math.atan2(grip.y, grip.x);
  // An overhead climbing grip can cross the antipode of the hanging hand.
  // Reach through the front consistently instead of switching rotation arcs.
  const turn = throughFront ? to - from : Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const angle = from + turn * weight, reach = lerp(free.length(), grip.length(), weight);
  // Approach/release around the shoulder. A straight crossfade can pass through
  // the shoulder itself, collapsing the elbow and flipping it in one frame.
  return root.clone().add(point(Math.cos(angle), Math.sin(angle)).multiplyScalar(reach));
}

// Analytic two-bone IK keeps feet on the path and palms on the stone.
export function solveLimb(root, target, lengthA, lengthB, bend = 1) {
  const delta = target.clone().sub(root);
  const distance = clamp(delta.length(), Math.abs(lengthA - lengthB) + .002, lengthA + lengthB - .002);
  const angle = Math.atan2(delta.y, delta.x);
  const offset = Math.acos(THREE.MathUtils.clamp((lengthA * lengthA + distance * distance - lengthB * lengthB) / (2 * lengthA * distance), -1, 1));
  const joint = point(root.x + Math.cos(angle + bend * offset) * lengthA, root.y + Math.sin(angle + bend * offset) * lengthA);
  const end = point(root.x + Math.cos(angle) * distance, root.y + Math.sin(angle) * distance);
  return { root: root.clone(), joint, end };
}

export const solveIK = (root, target, lengthA, lengthB, bend = 1) => solveLimb(root, target, lengthA, lengthB, bend).joint;

export class Sisyphus {
  constructor(textures) {
    this.group = new THREE.Group();
    this.group.position.z = 4;
    this.phase = 0;
    this.walkBlend = 0;
    this.lean = 0;
    this.facing = 1;
    this.turnAngle = 0;
    this.pushBlend = 0;
    this.climbBlend = 0;
    this.filteredHip = null;
    this.handOffsets = [];
    this.pushGripAngle = null;
    this.rollBlend = 0;
    this.parts = {};
    const make = (name, texture, width, height, z, tint = 0xffffff) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: textures[texture], transparent: true, depthWrite: false, color: tint }));
      mesh.scale.set(width, height, 1);
      mesh.position.z = z;
      mesh.renderOrder = 25 + z;
      this.group.add(mesh);
      this.parts[name] = mesh;
      return mesh;
    };
    for (const [side, z, tint] of [['back', 0, 0xafa48c], ['front', 0.3, 0xffffff]]) {
      make(`${side}Thigh`, 'thigh', 0.32, 0.8, z, tint);
      make(`${side}Shin`, 'shin', 0.235, 0.78, z + 0.01, tint);
      make(`${side}Foot`, 'foot', 0.43, 0.25, z + 0.02, tint);
      // The near arm swings in front of the cloth; the legs stay beneath it.
      const armZ = side === 'front' ? 0.40 : z + 0.04;
      make(`${side}Arm`, 'upper-arm', 0.28, 0.66, armZ, tint);
      make(`${side}Forearm`, 'forearm', 0.21, 0.69, armZ + 0.01, tint);
    }
    make('torso', 'torso', 0.73, 1.07, 0.18);
    make('head', 'head', 0.59, 0.69, 0.21);
    make('cloth', 'cloth', 0.78, 0.64, 0.37);
  }

  segment(name, a, b, width, overlap = 0.08) {
    const mesh = this.parts[name];
    mesh.position.x = (a.x + b.x) / 2;
    mesh.position.y = (a.y + b.y) / 2;
    mesh.rotation.z = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    mesh.scale.set(width, a.distanceTo(b) + overlap, 1);
  }

  update(state, dt, elapsed) {
    const pushing = state.mode === 'push' || state.mode === 'brace' || state.phase === 'title';
    const moving = Math.abs(state.playerVelocity) > 0.08;
    const climbRoute = climbRouteFor(state);
    const onStone = climbRoute && state.playerX >= climbRoute.start && state.playerX < climbRoute.end;
    const reset = !this.filteredHip || dt >= .25 || this.teleportRevision !== state.teleportRevision
      || Math.abs(state.playerX - this.lastPlayerX) > 3;
    const travel = state.playerX - (this.lastPlayerX ?? state.playerX);
    this.teleportRevision = state.teleportRevision;
    this.lastPlayerX = state.playerX;
    const ease = (value, target, rate) => reset ? target : damp(value, target, rate, dt);
    this.walkBlend = ease(this.walkBlend, moving ? 1 : 0, 7);
    this.pushBlend = ease(this.pushBlend, pushing ? 1 : 0, 8);
    this.rollBlend = ease(this.rollBlend, state.mode === 'push' && moving ? 1 : 0, 7);
    this.climbBlend = ease(this.climbBlend, onStone ? 1 : 0, 12);
    const pushingStone = this.pushBlend > .001 ? rockSupportAt(state.rockX ?? state.playerX + CONTACT_DISTANCE) : null;
    const stanceX = pushingStone ? pushingStanceAt(pushingStone) : state.playerX;
    let gaitX = lerp(state.playerX, stanceX, this.pushBlend);
    // Plant the final ground step at the scramble's starting footholds. The
    // reaching stance must not advance the feet into the climbing route early.
    if (state.phase === 'ascent') gaitX = Math.min(gaitX, CLIMB_ENTRY_X);
    else if (state.phase === 'climb') gaitX = state.playerX;
    const pose = contactPoseAt(gaitX, state.phase, this.walkBlend, climbRoute);
    // Face the direction of travel on the climb, retaining that facing at rest.
    const direction = pushing ? 1 : state.direction || this.facing;
    this.turnAngle = ease(this.turnAngle, direction > 0 ? 0 : Math.PI, 16);
    const turn = Math.cos(this.turnAngle);
    this.facing = turn >= 0 ? 1 : -1;
    this.lean = ease(this.lean, pushing ? .51 : .04 + pose.scramble * .32, 6);
    this.group.scale.x = turn;
    // The climber is on the visible face of the stone; its sprite must not hide
    // his bent knee or gripping palm during the high step.
    for (const part of Object.values(this.parts)) part.renderOrder = (onStone ? 35 : 25) + part.position.z;
    this.phase = pose.step * Math.PI;
    const breathe = Math.sin(elapsed * (pushing ? 2.8 : 1.8)) * 0.019;
    pose.hip.x -= this.lean * .18 * this.facing;
    // Transfer weight over the planted feet without rocking the upper body
    // away from the stone on every step. Foot contacts and leg lengths stay fixed.
    pose.hip.x = lerp(pose.hip.x, stanceX - .10, this.pushBlend);
    pose.hip.y += breathe;
    if (reset) this.filteredHip = pose.hip.clone();
    else {
      this.filteredHip.x += travel * this.pushBlend;
      this.filteredHip.lerp(pose.hip, 1 - Math.exp(-14 * dt));
    }
    const worldHip = fitPelvis(this.filteredHip, pose.feet);
    this.filteredHip.copy(worldHip);
    this.group.position.set(worldHip.x, heightAt(worldHip.x), 4);
    const local = p => point((p.x - this.group.position.x) * this.facing, p.y - this.group.position.y);
    const worldPoint = p => point(p.x * this.facing + this.group.position.x, p.y + this.group.position.y);
    const hip = local(worldHip);
    const torsoTop = point(hip.x + this.lean, hip.y + 0.86 - this.lean * 0.18);
    const torso = this.parts.torso;
    torso.position.set((hip.x + torsoTop.x) / 2, (hip.y + torsoTop.y) / 2 + 0.01, torso.position.z);
    torso.rotation.z = -Math.atan2(torsoTop.x - hip.x, torsoTop.y - hip.y);
    const torsoPoint = (x, y) => point(torso.scale.x * x, torso.scale.y * y)
      .rotateAround(point(0, 0), torso.rotation.z)
      .add(point(torso.position.x, torso.position.y));
    const shoulders = [.08, -.22].map(x => torsoPoint(x, .20));
    let pushHands;
    if (pushingStone) {
      // Trade a small rolling stroke between the palms, in time with the steps.
      // Angular offsets keep both hands on the surface throughout the motion.
      const stroke = Math.sin(this.phase) * .055 * this.rollBlend;
      const grips = pushingHandsAt(shoulders.map(worldPoint), pushingStone, reset ? null : this.pushGripAngle, dt, stroke);
      this.pushGripAngle = grips.angle;
      pushHands = grips.points.map(local);
    } else this.pushGripAngle = null;
    this.pose = { ...pose, hip: worldHip, legs: [], arms: [] };

    for (const [i, side, phaseOffset] of [[0, 'back', Math.PI], [1, 'front', 0]]) {
      const target = pose.feet[i];
      const leg = solveLimb(hip, local(target.position), .73, .72, 1);
      const knee = projectedJoint(leg, turn);
      this.segment(`${side}Thigh`, hip, knee, .31);
      this.segment(`${side}Shin`, knee, leg.end, .215);
      this.pose.legs.push({ root: worldPoint(hip), joint: worldPoint(leg.joint), end: worldPoint(leg.end) });
      const foot = this.parts[`${side}Foot`];
      const angle = target.angle * this.facing;
      const toe = point(.105, -.055).rotateAround(point(0, 0), angle).add(leg.end);
      foot.position.set(toe.x, toe.y, foot.position.z);
      foot.rotation.z = angle;

      // Pin each arm to the painted deltoid in torso coordinates. Reaching
      // changes the elbow and hand, never the shoulder's attachment point.
      const root = shoulders[i];
      let hand = point(root.x + Math.sin(this.phase + phaseOffset) * .28 * this.walkBlend, root.y - 1.02 + Math.abs(Math.sin(this.phase)) * .06 * this.walkBlend);
      if (this.climbBlend > .001) {
        const grip = local(stoneGripAt(worldPoint(root), i === 0 ? .04 : -.09,
          climbRoute?.support ?? rockSupportAt(state.rockX ?? state.playerX + CONTACT_DISTANCE)));
        const reach = root.distanceTo(grip);
        const forwardGrip = clamp((grip.x - root.x + .12) / .3, 0, 1);
        hand = blendArmReach(root, hand, grip, this.climbBlend * forwardGrip * clamp((1.55 - reach) / .38, 0, 1), true);
      }
      // Ease targets relative to the shoulder, then solve the whole arm. Directly
      // interpolating each sprite would pull the wrist/elbow joints apart.
      const offset = worldPoint(hand).sub(worldPoint(root));
      if (reset || !this.handOffsets[i]) this.handOffsets[i] = offset;
      else this.handOffsets[i].copy(blendArmReach(point(0, 0), this.handOffsets[i], offset, 1 - Math.exp(-18 * dt)));
      hand = local(worldPoint(root).add(this.handOffsets[i]));
      // Smooth the reach into contact, then keep the palms on the moving stone.
      // Filtering a planted hand relative to the shoulder makes it swim in air.
      if (pushHands) hand = blendArmReach(root, hand, pushHands[i], this.pushBlend);
      const arm = solveLimb(root, hand, .56, .62, -1);
      const elbow = projectedJoint(arm, turn);
      this.segment(`${side}Arm`, root, elbow, .27);
      this.segment(`${side}Forearm`, elbow, arm.end, .205, .14);
      this.pose.arms.push({ root: worldPoint(root), joint: worldPoint(arm.joint), end: worldPoint(arm.end) });
    }
    const head = this.parts.head;
    head.rotation.z = -this.lean * 0.15 + Math.sin(elapsed * 1.5) * 0.012;
    // Match the painted neck socket and neck base, accounting for both sprite
    // rotations. Breathing and head tilt pivot at this joint in every pose.
    const neck = torsoPoint(.04, .40);
    const neckBase = point(-head.scale.x * .12, -head.scale.y * .39)
      .rotateAround(point(0, 0), head.rotation.z);
    head.position.set(neck.x - neckBase.x, neck.y - neckBase.y, head.position.z);
    const cloth = this.parts.cloth;
    cloth.rotation.z = -this.lean * 0.12 + Math.sin(this.phase) * 0.045 * this.walkBlend;
    // Attach the waistband to the painted waist on the tilted torso. Let the
    // hem sway around that attachment, without pulling the belt behind the body.
    const waist = torsoPoint(.08, -.34);
    const beltOffset = point(0, cloth.scale.y * .34).rotateAround(point(0, 0), cloth.rotation.z);
    cloth.position.set(waist.x - beltOffset.x, waist.y - beltOffset.y, cloth.position.z);
  }
}
