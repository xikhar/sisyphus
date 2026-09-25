import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../src/game-state.js';
import { RecordSequence } from '../src/record-sequence.js';
import { START_X, SUMMIT_X, LOOKOUT_X, CONTACT_DISTANCE } from '../src/terrain.js';

const snapshot = (game, record) => ({
  time: record.elapsed, player: game.playerX, rock: game.rockX, phase: game.phase,
  autoBrace: game.autoBrace, catching: !!game.catchMotion, fade: record.fade,
});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('record mode performs the timed pushes, genuine rollback and catch, hidden cut, summit crossing and descent', () => {
  const game = new GameState(); game.start();
  const record = new RecordSequence(game);
  const shots = { push: snapshot(game, record) };
  let sawRollback = false, sawRecoil = false, maxGap = 0, cuts = 0;
  for (let frame = 0; frame < 60 * 50 && !record.done; frame++) {
    const stage = record.stage, before = snapshot(game, record), revision = game.teleportRevision;
    const controls = record.controls();
    record.update(1 / 60);
    if (stage === 'catch') {
      assert.deepEqual(controls, {}, 'the director cannot manually brace or manufacture the catch');
      maxGap = Math.max(maxGap, game.rockX - game.playerX);
      sawRollback ||= game.rockVelocity < 0;
      sawRecoil ||= !!game.catchMotion;
    }
    if (stage === 'hold') {
      near(game.playerX, before.player);
      near(game.rockX, before.rock);
      assert.equal(game.autoBrace, true);
    }
    if (revision !== game.teleportRevision) {
      cuts++;
      assert.equal(record.fade, 1, 'the jump occurs only under a fully opaque fade');
      assert.ok(before.rock < START_X + 10 && game.rockX > SUMMIT_X - 6);
    }
    if (stage === 'summit-climb' && game.phase === 'climb') assert.equal(game.rockX, SUMMIT_X);
    if (record.stage !== stage) shots[record.stage] = snapshot(game, record);
  }
  assert.deepEqual(Object.keys(shots), [
    'push', 'step-back', 'catch', 'hold', 'push-again', 'fade-out', 'cut', 'fade-in',
    'summit-push', 'summit-climb', 'reveal', 'descend', 'ending', 'done',
  ]);
  near(shots['step-back'].time, 4);
  assert.ok(shots['step-back'].rock > shots.push.rock + 4);
  assert.ok(shots.catch.player < shots['step-back'].player - 1.5);
  assert.ok(sawRollback && sawRecoil && maxGap > CONTACT_DISTANCE + 2);
  assert.ok(shots.hold.autoBrace && !shots.hold.catching);
  near(shots.hold.rock - shots.hold.player, CONTACT_DISTANCE);
  assert.ok(shots['push-again'].time - shots.hold.time >= 1, 'leave time to see the automatic hold');
  near(shots['fade-out'].time - shots['push-again'].time, 2);
  assert.ok(shots['fade-out'].rock > shots['push-again'].rock + 1.5);
  assert.equal(cuts, 1);
  assert.ok(shots['summit-push'].rock < SUMMIT_X && shots['summit-push'].phase === 'ascent');
  assert.equal(shots['summit-climb'].rock, SUMMIT_X);
  assert.ok(shots.reveal.phase === 'summit' && shots.reveal.rock < SUMMIT_X);
  assert.equal(shots.descend.player, LOOKOUT_X);
  assert.ok(shots.descend.rock < SUMMIT_X - 60, 'the camera can watch the stone fall before returning');
  assert.equal(game.phase, 'descent');
  assert.ok(game.playerX < LOOKOUT_X - 5);
  assert.equal(game.direction, -1);
  assert.equal(game.cycles, 0);
  assert.equal(game.summits, 1);
  assert.ok(record.done && record.elapsed > 30 && record.elapsed < 40);
});

test('record mode pauses its timeline and fades, and finishes once without looping', () => {
  const game = new GameState(), record = new RecordSequence(game);
  record.update(1 / 60);
  assert.equal(record.elapsed, 0, 'wait for the game assets and startup');
  game.start();
  for (let i = 0; i < 720; i++) record.update(1 / 60);
  assert.equal(record.stage, 'fade-in');
  game.paused = true;
  const paused = snapshot(game, record);
  for (let i = 0; i < 180; i++) record.update(1 / 60);
  assert.deepEqual(snapshot(game, record), paused);
  game.paused = false;
  for (let i = 0; i < 2400; i++) record.update(1 / 60);
  assert.equal(record.done, true);
  assert.equal(record.fade, 1);
  const ending = snapshot(game, record), time = game.time;
  for (let i = 0; i < 1200; i++) record.update(1 / 60);
  assert.deepEqual(snapshot(game, record), ending);
  assert.equal(game.time, time, 'physics also stops at the end');
});
