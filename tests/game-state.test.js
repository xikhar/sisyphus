import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../src/game-state.js';
import { START_X, SUMMIT_X, LOOKOUT_X, CONTACT_DISTANCE, ROCK_RADIUS, heightAt, characterGroundAt, slopeAt, rockSupportAt } from '../src/terrain.js';
import { CLIMB_START, CLIMB_END, RETURN_CLIMB_START, RETURN_CLIMB_END } from '../src/locomotion.js';
import { solveIK } from '../src/character.js';
import { Vector2 } from 'three';

function advance(game, seconds, input = {}) { for (let i = 0; i < seconds * 60; i++) game.update(1 / 60, input); }

test('complete repeated ascent, final climb, panorama, fall, descent, and restart', () => {
  const g = new GameState(); g.start();
  advance(g, 210, { right: true });
  assert.ok(['climb', 'summit'].includes(g.phase), `Reached ${g.phase} at ${g.rockX}`);
  advance(g, 12, { right: true });
  assert.equal(g.phase, 'summit');
  assert.equal(g.playerX, LOOKOUT_X);
  assert.ok(g.rockX < SUMMIT_X);
  advance(g, 8);
  assert.equal(g.phase, 'summit', 'view never dismisses itself');
  advance(g, 1, { left: true });
  assert.equal(g.phase, 'descent');
  advance(g, 106, { left: true });
  assert.equal(g.phase, 'ascent');
  assert.equal(g.cycles, 1);
  assert.equal(g.rockX, START_X + CONTACT_DISTANCE);
  advance(g, 4, { right: true });
  assert.ok(g.rockX > START_X + CONTACT_DISTANCE + 2);
});

test('a released stone causes one small setback and stays held until the player moves', () => {
  const g = new GameState(); g.start();
  advance(g, 20, { right: true });
  const high = g.rockX;
  advance(g, 4, { brace: true });
  assert.ok(Math.abs(g.rockX - high) < 0.15);
  advance(g, 3);
  assert.ok(g.rockX < high && g.rockX > high - .5);
  assert.ok(g.playerX <= g.rockX - CONTACT_DISTANCE + 0.001);
  assert.equal(g.mode, 'brace');
  assert.equal(g.autoBrace, true);
  const low = g.rockX;
  const heldPlayer = g.playerX;
  advance(g, 20);
  assert.equal(g.rockX, low);
  assert.equal(g.playerX, heldPlayer);
  assert.equal(g.rockVelocity, 0);
  advance(g, 10, { right: true });
  assert.ok(g.rockX > low);
  assert.equal(g.autoBrace, false);
});

test('pause freezes simulation, title cannot move, large frame times are bounded', () => {
  const g = new GameState(); advance(g, 1, { right: true });
  assert.equal(g.playerX, START_X);
  g.start(); g.paused = true;
  advance(g, 8, { right: true });
  assert.equal(g.time, 0); assert.equal(g.playerX, START_X);
  g.paused = false; g.update(50, { right: true });
  assert.ok(g.playerX < START_X + 0.1);
});

test('walking cannot pass through the boulder or leave the world', () => {
  const g = new GameState(); g.start();
  advance(g, 20, { left: true });
  assert.equal(g.playerX, START_X - 3.2);
  advance(g, 5, { right: true });
  assert.ok(g.playerX <= g.rockX - CONTACT_DISTANCE + 0.001);
  advance(g, 100);
  assert.ok(g.rockX >= START_X + CONTACT_DISTANCE);
  assert.equal(g.rockVelocity, 0);
  assert.equal(g.playerX, g.rockX - CONTACT_DISTANCE);
  assert.equal(g.mode, 'brace');
});

test('a fast returning stone has bounded recoil, then holds without further downhill drift', () => {
  const g = new GameState(); g.start();
  g.playerX = 110; g.rockX = 119; g.rockVelocity = -8;
  let contactX, catchFrames = 0, last = g.playerX;
  for (let i = 0; i < 300; i++) {
    g.update(1 / 60);
    assert.ok(Math.abs(g.playerX - last) < .07, 'impact must move over frames, not teleport');
    if (g.catchMotion) { contactX ??= g.catchMotion.from; catchFrames++; }
    last = g.playerX;
  }
  assert.ok(catchFrames > 12);
  assert.ok(contactX - g.playerX > .1 && contactX - g.playerX <= .45 + 1e-8);
  assert.equal(g.mode, 'brace');
  const caughtX = g.playerX;
  advance(g, 30);
  assert.equal(g.playerX, caughtX);
  assert.equal(g.rockX, caughtX + CONTACT_DISTANCE);
  advance(g, .8, { left: true });
  assert.equal(g.autoBrace, false);
  assert.ok(g.playerX < caughtX - 1, 'walking away releases the held stone');
  assert.ok(g.rockX - g.playerX > CONTACT_DISTANCE + .2);
  advance(g, 6);
  assert.equal(g.autoBrace, true, 'it can be caught again after stepping away');
});

test('walking and climbing accelerate, decelerate, and reverse without position jumps', () => {
  for (const phase of ['ascent', 'climb', 'descent']) {
    const g = new GameState(); g.start(); g.phase = phase;
    g.playerX = phase === 'climb' ? 248 : 80; g.rockX = phase === 'climb' ? 244 : 100;
    let previousVelocity = 0;
    for (let i = 0; i < 150; i++) {
      g.update(1 / 60, i < 45 ? { right: true } : i < 90 ? { left: true } : {});
      assert.ok(Math.abs(g.playerVelocity - previousVelocity) < 1.4, `${phase}: movement must ease through reversal`);
      previousVelocity = g.playerVelocity;
    }
    assert.equal(g.walkVelocity, 0);
  }
});

test('holding downhill through impact still ends in a stationary brace until a fresh movement command', () => {
  const g = new GameState(); g.start();
  g.playerX = 110; g.rockX = 113.5; g.rockVelocity = -8;
  advance(g, 3, { left: true });
  assert.equal(g.mode, 'brace');
  assert.equal(g.autoBrace, true);
  const held = g.playerX;
  advance(g, 10, { left: true });
  assert.equal(g.playerX, held);
  assert.equal(g.rockX, held + CONTACT_DISTANCE);
  advance(g, .2);
  advance(g, .5, { left: true });
  assert.ok(g.playerX < held - .5, 'releasing and pressing downhill again steps away');
});

test('the hidden shortcut alternates unfinished tasks and clears stale movement without awarding progress', () => {
  const g = new GameState(3); g.start();
  advance(g, 15, { right: true });
  for (let i = 0; i < 4; i++) {
    g.walkVelocity = -2; g.playerVelocity = -2; g.rockVelocity = -8;
    g.catchMotion = { from: g.playerX, to: g.playerX - .4, time: .1, duration: .4 };
    g.catchInputAxis = -1;
    g.teleportEndpoint();
    const top = i % 2 === 0;
    if (top) {
      assert.ok(g.rockX > SUMMIT_X - 6 && g.rockX < SUMMIT_X - 1);
      assert.ok(Math.abs(g.rockX - g.playerX - CONTACT_DISTANCE) < 1e-8);
      assert.equal(g.rockVelocity, 0);
    } else {
      assert.ok(g.playerX > RETURN_CLIMB_END && g.playerX < RETURN_CLIMB_END + 2);
      assert.equal(g.rockX, START_X + CONTACT_DISTANCE);
      assert.ok(g.playerX > g.rockX + CONTACT_DISTANCE);
      assert.equal(g.rockVelocity, 0);
      assert.equal(g.direction, -1);
    }
    assert.equal(g.phase, top ? 'ascent' : 'descent');
    assert.equal(g.playerVelocity, 0);
    assert.equal(g.walkVelocity, 0);
    assert.equal(g.catchMotion, null);
    assert.equal(g.catchInputAxis, 0);
    assert.equal(g.autoBrace, top);
    assert.equal(g.cycles, 3);
    assert.equal(g.summits, 0);
    assert.equal(g.teleportRevision, i + 1);
    advance(g, 1);
  }
  advance(g, 2, { right: true });
  assert.ok(g.playerX > START_X + 1);
});

test('the top shortcut leaves the ledge push and crossing to the player', () => {
  const g = new GameState(); g.start();
  g.teleportEndpoint();
  const checkpoint = g.rockX;
  advance(g, 10);
  assert.equal(g.phase, 'ascent');
  assert.equal(g.rockX, checkpoint, 'the stone waits for the final push');
  advance(g, 1, { right: true });
  assert.ok(g.rockX > checkpoint && g.rockX < SUMMIT_X);
  assert.equal(g.phase, 'ascent');
  for (let i = 0; i < 1200 && g.phase === 'ascent'; i++) g.update(1 / 60, { right: true });
  assert.equal(g.phase, 'climb');
  assert.equal(g.rockX, SUMMIT_X);
  assert.equal(g.summits, 0);
  advance(g, 10);
  assert.equal(g.rockX, SUMMIT_X, 'the final climb is still required to release it');
  advance(g, 12, { right: true });
  assert.equal(g.phase, 'summit');
  assert.equal(g.summits, 1);
  assert.ok(g.rockX < SUMMIT_X);
  advance(g, 1, { left: true });
  assert.equal(g.phase, 'descent', 'the natural crossing remains immediately reversible');
  assert.equal(g.cycles, 0);
});

test('the bottom shortcut requires climbing back over the parked stone before pushing', () => {
  const g = new GameState(); g.start();
  g.teleportEndpoint();
  g.teleportEndpoint();
  const waitingPlayer = g.playerX, parkedRock = g.rockX;
  advance(g, 5);
  assert.equal(g.playerX, waitingPlayer, 'the player waits on the uphill side');
  assert.equal(g.rockX, parkedRock);
  assert.equal(g.autoBrace, false);
  advance(g, 2, { left: true });
  assert.equal(g.phase, 'descent');
  assert.equal(g.mode, 'climb');
  assert.equal(g.direction, -1);
  assert.ok(g.playerX > RETURN_CLIMB_START && g.playerX < RETURN_CLIMB_END);
  assert.equal(g.rockX, parkedRock, 'climbing back does not push the stone from the wrong side');
  advance(g, 2);
  const stopped = g.playerX;
  advance(g, 2);
  assert.equal(g.playerX, stopped, 'the climb can be stopped');
  advance(g, 2, { right: true });
  assert.ok(g.playerX > stopped + 1, 'the climb can be reversed without getting stuck');
  assert.equal(g.rockX, parkedRock);
  for (let i = 0; i < 1200 && g.phase === 'descent'; i++) g.update(1 / 60, { left: true });
  assert.equal(g.phase, 'ascent');
  assert.equal(g.playerX, START_X);
  assert.equal(g.rockX, parkedRock);
  advance(g, 2, { right: true });
  assert.ok(g.rockX > parkedRock + 1, 'pushing resumes after reaching the downhill side');
  assert.equal(g.cycles, 0);
});

test('both shortcut destinations preserve pause until play is resumed', () => {
  const g = new GameState(); g.start(); g.paused = true;
  for (let i = 0; i < 2; i++) {
    g.teleportEndpoint();
    assert.equal(g.paused, true);
    const position = [g.playerX, g.rockX];
    advance(g, 10, { right: true });
    assert.deepEqual([g.playerX, g.rockX], position);
  }
  g.paused = false;
  const uphill = g.playerX;
  advance(g, .5, { left: true });
  assert.ok(g.playerX < uphill);
});

test('the boulder parks on top of the ledge and falls only after the player crosses it', () => {
  const g = new GameState(); g.start();
  g.rockX = SUMMIT_X - .2; g.playerX = g.rockX - CONTACT_DISTANCE;
  advance(g, 1, { right: true });
  assert.equal(g.phase, 'climb');
  assert.equal(g.rockX, SUMMIT_X);
  const support = rockSupportAt(g.rockX);
  assert.ok(Math.abs(support.contactY - heightAt(LOOKOUT_X)) < 1e-5, 'the stone rests on the upper ledge');
  assert.ok(Math.abs(support.y - heightAt(LOOKOUT_X) - ROCK_RADIUS) < 1e-5);
  advance(g, 60);
  assert.equal(g.rockX, SUMMIT_X, 'waiting at the near side cannot release the stone');
  g.playerX = CLIMB_END - .3; g.walkVelocity = 0;
  advance(g, 30);
  assert.equal(g.rockX, SUMMIT_X, 'it stays put until both feet clear the far side');
  advance(g, 1, { right: true });
  assert.equal(g.phase, 'summit');
  assert.ok(g.rockX < SUMMIT_X && g.rockVelocity < 0, 'the crossing releases it immediately');
  advance(g, .5, { left: true });
  assert.equal(g.phase, 'descent');
});

test('backing off the climb passes its starting boundary and can be retried', () => {
  const g = new GameState(); g.start(); g.setPhase('climb');
  g.rockX = SUMMIT_X; g.playerX = CLIMB_START + .7;
  advance(g, 3, { left: true });
  assert.ok(g.playerX < CLIMB_START - 2, 'no invisible wall at the start of the climb');
  assert.equal(g.direction, -1);
  assert.equal(g.rockX, SUMMIT_X);
  advance(g, 4, { right: true });
  assert.ok(g.playerX > CLIMB_START, 'the same parked stone can be climbed again');
  assert.equal(g.phase, 'climb');
  advance(g, 100, { left: true });
  assert.equal(g.playerX, START_X, 'the player can walk all the way back down');
  assert.equal(g.rockX, SUMMIT_X);
});

test('hill is continuous at summit and all terrain slopes are finite', () => {
  assert.ok(Math.abs(heightAt(SUMMIT_X - 0.0001) - heightAt(SUMMIT_X + 0.0001)) < 0.001);
  for (let x = 1; x < LOOKOUT_X + 10; x += 0.2) { assert.ok(Number.isFinite(heightAt(x))); assert.ok(Number.isFinite(slopeAt(x))); }
});

test('final scramble carries Sisyphus over the boulder and rejoins the path', () => {
  assert.ok(Math.abs(characterGroundAt(SUMMIT_X, 'climb') - heightAt(SUMMIT_X) - 3.2) < 1e-7);
  assert.equal(characterGroundAt(SUMMIT_X - CONTACT_DISTANCE, 'climb'), heightAt(SUMMIT_X - CONTACT_DISTANCE));
  assert.equal(characterGroundAt(LOOKOUT_X, 'climb'), heightAt(LOOKOUT_X));
  assert.equal(characterGroundAt(SUMMIT_X, 'descent'), heightAt(SUMMIT_X));
});

test('two-bone IK preserves bone length and handles coincident and distant targets', () => {
  for (const target of [new Vector2(0.1, -1.2), new Vector2(0.9, 0.2), new Vector2(0, 0), new Vector2(5, 3)]) {
    const root = new Vector2(0, 0);
    const joint = solveIK(root, target, 0.73, 0.72);
    assert.ok(Number.isFinite(joint.x) && Number.isFinite(joint.y));
    assert.ok(Math.abs(joint.distanceTo(root) - 0.73) < 1e-8);
    if (target.length() > 0.02 && target.length() < 1.448) assert.ok(Math.abs(joint.distanceTo(target) - 0.72) < 1e-8);
  }
});
