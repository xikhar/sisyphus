export const START_X = 7;
export const LEDGE_START_X = 244;
export const SUMMIT_X = LEDGE_START_X + 3.6;
export const LOOKOUT_X = 253;
export const ROCK_RADIUS = 1.6;
export const CONTACT_DISTANCE = 2.6;

// A single continuous path. The last scramble belongs to the player alone.
export function heightAt(x) {
  if (x < 0) return -0.3 + x * 0.1;
  if (x > LEDGE_START_X) {
    const base = hill(LEDGE_START_X);
    const fall = Math.max(0, x - LOOKOUT_X - 4);
    if (fall > 0) return base + 3.4 - fall * 0.58 - fall * fall * 0.035;
    const t = Math.min(1, (x - LEDGE_START_X) / (SUMMIT_X - LEDGE_START_X));
    return base + 3.4 * (t * t * (3 - 2 * t));
  }
  return hill(x);
}

function hill(x) {
  return x * 0.375 + 1.6 * Math.sin(x * 0.034)
    + 0.65 * Math.sin(x * 0.16) + 0.15 * Math.sin(x * 0.65)
    + 0.03 * Math.sin(x * 1.7) - 0.3;
}

export function slopeAt(x) {
  return (heightAt(x + 0.08) - heightAt(x - 0.08)) / 0.16;
}

// Find the support point of a circle on the actual curved ground, rather than
// approximating the entire footprint with the tangent under its centre.
export function rockSupportAt(x) {
  const supportHeight = u => heightAt(u) + Math.sqrt(Math.max(0, ROCK_RADIUS ** 2 - (u - x) ** 2));
  const spacing = ROCK_RADIUS * 2 / 32;
  let contactX = x, y = -Infinity;
  for (let i = 0; i <= 32; i++) {
    const u = x - ROCK_RADIUS + i * spacing;
    const h = supportHeight(u);
    if (h > y) { y = h; contactX = u; }
  }
  let lo = Math.max(x - ROCK_RADIUS, contactX - spacing);
  let hi = Math.min(x + ROCK_RADIUS, contactX + spacing);
  for (let i = 0; i < 16; i++) {
    const a = (lo * 2 + hi) / 3, b = (lo + hi * 2) / 3;
    if (supportHeight(a) < supportHeight(b)) lo = a; else hi = b;
  }
  contactX = (lo + hi) / 2;
  return { x, y: supportHeight(contactX), contactX, contactY: heightAt(contactX) };
}

export function characterGroundAt(x, phase) {
  const ground = heightAt(x);
  if (phase !== 'climb') return ground;
  // The top of the parked stone is a real foothold, joining the rising ridge.
  const dx = x - SUMMIT_X;
  const centerY = rockSupportAt(SUMMIT_X).y;
  if (Math.abs(dx) <= ROCK_RADIUS) return Math.max(ground, centerY + Math.sqrt(ROCK_RADIUS ** 2 - dx ** 2));
  return ground;
}

export const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
