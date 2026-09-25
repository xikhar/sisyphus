import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateState } from '../src/render-state.js';
import { GameState } from '../src/game-state.js';
import { Sisyphus } from '../src/character.js';
import { Vector3 } from 'three';
import { CONTACT_DISTANCE } from '../src/terrain.js';

const textures = Object.fromEntries(['thigh', 'shin', 'foot', 'upper-arm', 'forearm', 'torso', 'head', 'cloth'].map(name => [name, null]));

test('rendered movement fills the intervals between physics updates and skips interpolation on teleport', () => {
  const previous = new GameState(), current = new GameState();
  current.playerX += .1; current.rockX += .1; current.rockRotation -= .1 / 1.6;
  const frames = [0, .25, .5, .75, 1].map(alpha => interpolateState(previous, current, alpha));
  for (let i = 1; i < frames.length; i++) {
    assert.ok(Math.abs(frames[i].playerX - frames[i - 1].playerX - .025) < 1e-8);
    assert.ok(Math.abs(frames[i].rockX - frames[i].playerX - CONTACT_DISTANCE) < 1e-8);
  }
  current.teleportEndpoint();
  assert.equal(interpolateState(previous, current, .01).playerX, current.playerX);
});

test('body and arm transitions stay continuous while easing between walking, pushing and bracing', () => {
  const rig = new Sisyphus(textures), game = new GameState();
  game.start(); game.playerX = 70; game.rockX = game.playerX + CONTACT_DISTANCE;
  let previous = { ...game }, previousHip, previousParts, maxHip = 0, maxPart = 0;
  for (let frame = 0; frame < 1200; frame++) {
    const t = frame / 120;
    const controls = t < 3 ? { right: true } : t < 4 ? {} : t < 5.5 ? { left: true } : t < 6.5 ? {} : { right: true };
    if (frame % 2 === 0) { previous = { ...game }; game.update(1 / 60, controls); }
    const state = interpolateState(previous, game, (frame % 2) / 2);
    rig.update(state, 1 / 120, t);
    rig.group.updateMatrixWorld(true);
    const parts = Object.values(rig.parts).map(part => part.getWorldPosition(new Vector3()));
    if (previousHip) maxHip = Math.max(maxHip, rig.pose.hip.distanceTo(previousHip));
    if (previousParts) parts.forEach((part, i) => { maxPart = Math.max(maxPart, part.distanceTo(previousParts[i])); });
    for (const leg of rig.pose.legs) {
      assert.ok(Math.abs(leg.root.distanceTo(leg.joint) - .73) < 1e-7);
      assert.ok(Math.abs(leg.joint.distanceTo(leg.end) - .72) < 1e-7);
    }
    previousHip = rig.pose.hip.clone(); previousParts = parts;
  }
  assert.ok(maxHip < .12, `body jumps ${maxHip} in one 120 Hz frame`);
  assert.ok(maxPart < .20, `a body part jumps ${maxPart} in one 120 Hz frame`);
});

test('the render pose resets immediately at deliberate endpoint teleports', () => {
  const rig = new Sisyphus(textures), game = new GameState(); game.start();
  rig.update(game, 1 / 60, 0);
  game.teleportEndpoint(); rig.update(game, 1 / 60, 1);
  assert.ok(Math.abs(rig.pose.hip.x - game.playerX) < .5);
  game.teleportEndpoint(); rig.update(game, 1 / 60, 2);
  assert.ok(Math.abs(rig.pose.hip.x - game.playerX) < .5);
});
