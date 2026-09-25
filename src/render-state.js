import { clamp, lerp } from './terrain.js';

// Rendering may run faster or slower than the fixed 60 Hz simulation. Interpolate
// its continuous values together so the body, boulder, camera and shadows agree.
export function interpolateState(previous, current, alpha) {
  if (previous.teleportRevision !== current.teleportRevision) return current;
  const result = { ...current };
  const t = clamp(alpha, 0, 1);
  for (const key of ['playerX', 'rockX', 'rockRotation', 'playerVelocity', 'rockVelocity', 'effort']) {
    result[key] = lerp(previous[key], current[key], t);
  }
  return result;
}
