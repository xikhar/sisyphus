import { Vector2 } from 'three';
import { heightAt, slopeAt, rockSupportAt, START_X, SUMMIT_X, CONTACT_DISTANCE, ROCK_RADIUS, clamp, lerp } from './terrain.js';

const v = (x, y) => new Vector2(x, y);
const smooth = t => t * t * (3 - 2 * t);
const stone = rockSupportAt(SUMMIT_X);
export const CLIMB_START = SUMMIT_X - CONTACT_DISTANCE;
// Longer planted steps keep the ground gait from churning at walking speed.
const STRIDE = .96;
export const CLIMB_ENTRY_X = pushingStanceAt(stone);
export const CLIMB_END = CLIMB_ENTRY_X + STRIDE * 6;
// Match the ordinary gait's planted feet and parity at both ends of the return
// climb, so stepping off the stone joins the path without swapping the legs.
export const RETURN_CLIMB_START = CLIMB_ENTRY_X + Math.ceil((START_X - CLIMB_ENTRY_X) / (STRIDE * 2)) * STRIDE * 2;
export const RETURN_CLIMB_END = RETURN_CLIMB_START + STRIDE * 6;

function groundContact(x) {
  return { position: v(x, heightAt(x)), normal: v(-slopeAt(x), 1).normalize(), stone: false };
}

function stoneContact(angle, support) {
  const normal = v(Math.cos(angle), Math.sin(angle));
  return { position: v(support.x, support.y).addScaledVector(normal, ROCK_RADIUS), normal, stone: true };
}

// These are contacts on the stone, including its near face. No invisible ramp:
// the first high step is a swing from the ground to a real foothold.
function makeClimbRoute(support, start, entry, end) {
  const contacts = [groundContact(entry - STRIDE / 2), groundContact(entry + STRIDE / 2), groundContact(entry + .55)];
  // Follow both faces and land both feet on the path before leaving the route.
  if (support === stone) {
    for (let angle = 3.9; angle >= -.85; angle -= .42) contacts.push(stoneContact(angle, support));
    contacts.push(stoneContact(-1.05, support));
  } else {
    // The lower slope meets the uphill face higher than the summit plateau.
    // Finish above that contact so a planted ankle never sits inside the hill.
    const exitAngle = Math.atan2(support.contactY - support.y, support.contactX - support.x) + .5;
    for (let i = 0; i <= 12; i++) contacts.push(stoneContact(lerp(3.9, exitAngle, i / 12), support));
  }
  contacts.push(groundContact(support.x + 1.85), groundContact(support.x + 2.35), groundContact(end - STRIDE / 2), groundContact(end + STRIDE / 2));
  const timings = [0];
  for (let i = 0; i < contacts.length - 2; i++) {
    timings.push(timings.at(-1) + Math.max(.4, contacts[i].position.distanceTo(contacts[i + 2].position) / 2));
  }
  return { support, start, entry, end, contacts, timings };
}

const summitRoute = makeClimbRoute(stone, CLIMB_START, CLIMB_ENTRY_X, CLIMB_END);
const returnRoute = makeClimbRoute(rockSupportAt(START_X + CONTACT_DISTANCE), RETURN_CLIMB_START, RETURN_CLIMB_START, RETURN_CLIMB_END);

export function climbRouteFor(state) {
  if (state.phase === 'climb') return summitRoute;
  if (state.phase === 'descent' && Math.abs(state.rockX - returnRoute.support.x) < .001) return returnRoute;
  return null;
}

function footPose(contact) {
  // Bare toes can brace against a steep face, but the ankle cannot rotate through
  // the underside of the stone. Keep the sole at a plausible articulated angle.
  const angle = clamp(Math.atan2(-contact.normal.x, contact.normal.y), -1.1, 1.2);
  const normal = v(-Math.sin(angle), Math.cos(angle));
  return { position: contact.position.clone().addScaledVector(normal, .15), contact: contact.position.clone(), angle, planted: true, stone: contact.stone };
}

function stepPose(from, support, to, t, index, onStone, liftScale = 1, supportStone = stone) {
  // Both feet are down during weight transfer. A quintic swing has zero velocity
  // and acceleration at lift-off and landing, while the support foot stays fixed.
  const swing = clamp((t - .12) / .76, 0, 1);
  const u = swing ** 3 * (10 - 15 * swing + 6 * swing ** 2);
  const moving = footPose(from), target = footPose(to), fixed = footPose(support);
  const center = v(supportStone.x, supportStone.y);
  const startClearance = Math.min(.15, moving.position.distanceTo(center) - ROCK_RADIUS);
  const endClearance = Math.min(.15, target.position.distanceTo(center) - ROCK_RADIUS);
  moving.position.lerp(target.position, u);
  moving.contact.lerp(target.contact, u);
  moving.angle = lerp(moving.angle, target.angle, u);
  const lift = Math.sin(Math.PI * swing) ** 2;
  moving.position.y += lift * (onStone ? .32 : .14) * liftScale;
  moving.planted = swing === 0 || swing === 1;
  moving.stone = swing < .5 ? from.stone : to.stone;
  if (onStone && !moving.planted) {
    const delta = moving.position.clone().sub(center);
    // Swing around the outside of the boulder, never through its interior.
    // Match each planted ankle's radial clearance at the endpoints, so the
    // collision envelope does not pop the foot outward the instant it lifts.
    const clearance = ROCK_RADIUS + lerp(startClearance, endClearance, u) + lift * .12;
    if (delta.length() < clearance) moving.position.copy(center).add(delta.setLength(clearance));
  }
  if (!moving.planted) moving.position.y = Math.max(moving.position.y, heightAt(moving.position.x) + .15 * Math.cos(moving.angle));
  if (swing === 1) moving.contact.copy(target.contact);
  const feet = index % 2 === 0 ? [moving, fixed] : [fixed, moving];
  const mean = feet[0].position.clone().add(feet[1].position).multiplyScalar(.5);
  const wallNormal = contact => contact.stone ? contact.normal.x : 0;
  const normalX = lerp((wallNormal(from) + wallNormal(support)) / 2, (wallNormal(to) + wallNormal(support)) / 2, smooth(t));
  const scramble = onStone ? clamp(-normalX, 0, 1) : 0;
  return { feet, hip: mean.add(v(-scramble * .9, 1.12 - scramble * .12)), scramble, step: index + t };
}

export function contactPoseAt(x, phase, liftScale = 1, route = phase === 'climb' ? summitRoute : null) {
  if (route && x >= route.start && x < route.end) {
    const { contacts, timings } = route;
    const distance = clamp((x - route.start) / (route.end - route.start), 0, 1) * timings.at(-1);
    let i = 0;
    while (i < timings.length - 2 && distance > timings[i + 1]) i++;
    const t = clamp((distance - timings[i]) / (timings[i + 1] - timings[i]), 0, 1);
    return stepPose(contacts[i], contacts[i + 1], contacts[i + 2], t, i, true, 1, route.support);
  }
  // Join the grounded approach to the first climbing footholds in both
  // directions, including when the player abandons the climb and walks away.
  const approach = route && x < route.start ? smooth(clamp((x - route.start + 2) / 2, 0, 1)) : 0;
  const groundX = x + (route ? route.entry - route.start : 0) * approach;
  const progress = (groundX - CLIMB_ENTRY_X) / STRIDE;
  const index = Math.floor(progress), t = progress - index;
  const contact = i => groundContact(CLIMB_ENTRY_X + (i + .5) * STRIDE);
  return stepPose(contact(index - 1), contact(index), contact(index + 1), t, index, false, liftScale);
}

// Project the pelvis into the intersection of the two reach discs. Targets stay
// on their contacts; the body crouches/changes weight instead of lengthening a leg.
export function fitPelvis(hip, feet, reach = 1.40) {
  const fitted = hip.clone();
  for (let i = 0; i < 20; i++) {
    for (const foot of feet) {
      const delta = fitted.clone().sub(foot.position);
      if (delta.length() > reach) fitted.copy(foot.position).add(delta.setLength(reach));
    }
  }
  return fitted;
}

export function stoneGripAt(shoulder, offset = 0, support = stone) {
  const angle = Math.atan2(shoulder.y - support.y, shoulder.x - support.x) + offset;
  return v(support.x + Math.cos(angle) * ROCK_RADIUS, support.y + Math.sin(angle) * ROCK_RADIUS);
}

export function pushingStanceAt(support) {
  // Plan the feet from the shoulder's reach to the stone, accounting for the
  // slope. A fixed horizontal stance leaves the hands short on steep ground.
  let lo = support.x - 4, hi = support.x - 1;
  for (let i = 0; i < 18; i++) {
    const x = (lo + hi) / 2;
    const crouch = Math.max(0, slopeAt(x) - .65) * .45;
    const reach = Math.hypot(x + .14 - support.x, heightAt(x) + 1.85 - crouch - support.y);
    if (reach > ROCK_RADIUS + .93) lo = x;
    else hi = x;
  }
  return (lo + hi) / 2;
}

export function pushingHandsAt(shoulders, support, previousAngle, dt, stroke = 0) {
  const center = v(support.x, support.y);
  const offsets = [.025 + stroke, -.025 - stroke];
  const direction = shoulder => {
    const angle = Math.atan2(shoulder.y - center.y, shoulder.x - center.x);
    return angle < 0 ? angle + Math.PI * 2 : angle;
  };
  const opening = (distance, reach) => Math.acos(clamp(
    (distance * distance + ROCK_RADIUS ** 2 - reach * reach) / (2 * distance * ROCK_RADIUS), -1, 1));
  const middle = shoulders[0].clone().add(shoulders[1]).multiplyScalar(.5);
  // The near hand leads slightly above the other. On a shallow slope, place
  // the palms higher on the stone so the elbows do not fold against the ribs.
  const nearDistance = shoulders[1].distanceTo(center);
  const preferred = Math.min(direction(middle),
    direction(shoulders[1]) - opening(nearDistance, .72) + .025);
  let low = Math.PI / 2, high = Math.PI * 1.5;
  shoulders.forEach((shoulder, i) => {
    const distance = shoulder.distanceTo(center);
    const angle = direction(shoulder), arc = opening(distance, 1.13);
    low = Math.max(low, angle - arc - offsets[i]);
    high = Math.min(high, angle + arc - offsets[i]);
  });
  let angle = previousAngle == null ? preferred : lerp(previousAngle, preferred, 1 - Math.exp(-8 * dt));
  if (low <= high) angle = clamp(angle, low, high);
  return { angle, points: offsets.map(offset => center.clone().add(v(Math.cos(angle + offset), Math.sin(angle + offset)).multiplyScalar(ROCK_RADIUS))) };
}
