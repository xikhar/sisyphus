import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector2, Vector3 } from 'three';
import { Sisyphus, solveLimb } from '../src/character.js';
import { CLIMB_START, CLIMB_END, RETURN_CLIMB_START, RETURN_CLIMB_END } from '../src/locomotion.js';
import { heightAt, rockSupportAt, ROCK_RADIUS, START_X, CONTACT_DISTANCE, SUMMIT_X, LEDGE_START_X } from '../src/terrain.js';
import { GroundShadow } from '../src/shadow.js';
import { GameState } from '../src/game-state.js';

const textures = Object.fromEntries(['thigh', 'shin', 'foot', 'upper-arm', 'forearm', 'torso', 'head', 'cloth'].map(name => [name, null]));
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
function checkLimbs(character) {
  for (const [limbs, a, b] of [[character.pose.legs, .73, .72], [character.pose.arms, .56, .62]]) {
    for (const limb of limbs) {
      near(limb.root.distanceTo(limb.joint), a);
      near(limb.joint.distanceTo(limb.end), b);
    }
  }
  for (let i = 0; i < 2; i++) near(character.pose.legs[i].end.distanceTo(character.pose.feet[i].position), 0);
  // Turning limbs foreshorten through depth, but never stretch. In profile the
  // rendered lengths must match the bones exactly.
  for (const side of ['front', 'back']) {
    for (const [part, length] of [['Thigh', .81], ['Shin', .80], ['Arm', .64], ['Forearm', .76]]) {
      const rendered = character.parts[`${side}${part}`].scale.y;
      assert.ok(rendered > 0 && rendered <= length + 1e-7);
      if (Math.abs(character.group.scale.x) === 1) near(rendered, length);
    }
  }
}

test('arm roots stay in the painted shoulder area through walking, reaching, and turns', () => {
  const character = new Sisyphus(textures);
  const states = [
    { phase: 'ascent', mode: 'push', playerX: 12, rockX: 14.6, playerVelocity: 1, direction: 1 },
    { phase: 'ascent', mode: 'brace', playerX: 12, rockX: 14.6, playerVelocity: 0, direction: 1 },
    { phase: 'ascent', mode: 'walk', playerX: 12, rockX: 14.6, playerVelocity: 2.8, direction: 1 },
    { phase: 'descent', mode: 'walk', playerX: 12, rockX: 9.6, playerVelocity: -2.8, direction: -1 },
    { phase: 'climb', mode: 'climb', playerX: CLIMB_START + 1.6, rockX: SUMMIT_X, playerVelocity: .75, direction: 1 },
    { phase: 'climb', mode: 'idle', playerX: CLIMB_START + 1.6, rockX: SUMMIT_X, playerVelocity: 0, direction: 1 },
  ];
  for (const state of states) {
    for (let frame = 0; frame < 90; frame++) {
      character.update(state, 1 / 60, frame / 60);
      const torso = character.parts.torso;
      for (const side of ['front', 'back']) {
        const arm = character.parts[`${side}Arm`];
        // Locate the rendered upper-arm root, then measure it in the artwork's
        // coordinates. The shoulder is below the neck, at the outer deltoid.
        const socket = new Vector2(0, (arm.scale.y - .08) / 2)
          .rotateAround(new Vector2(), arm.rotation.z)
          .add(new Vector2(arm.position.x - torso.position.x, arm.position.y - torso.position.y))
          .rotateAround(new Vector2(), -torso.rotation.z);
        socket.set(socket.x / torso.scale.x, socket.y / torso.scale.y);
        const [minX, maxX] = side === 'front' ? [-.30, -.12] : [.01, .15];
        assert.ok(socket.x >= minX && socket.x <= maxX && socket.y >= .13 && socket.y <= .27,
          `${side} arm is outside the shoulder in ${state.mode}: ${socket.x}, ${socket.y}`);
      }
    }
  }
});

test('pushing keeps both palms on the stone with bent elbows and a continuous handoff to climbing', () => {
  const game = new GameState(), character = new Sisyphus(textures);
  game.start();
  let previousParts, previousContacts, contactsChecked = 0;
  for (let frame = 0; frame < 14500 && game.phase !== 'summit'; frame++) {
    game.update(1 / 60, { right: true });
    character.update(game, 1 / 60, frame / 60);
    checkLimbs(character);
    character.group.updateMatrixWorld(true);
    const parts = Object.values(character.parts).map(part => part.getWorldPosition(new Vector3()));
    if (previousParts) parts.forEach((part, i) => assert.ok(part.distanceTo(previousParts[i]) < .23,
      `${Object.keys(character.parts)[i]} jumps during ${game.phase} at ${game.playerX}`));
    previousParts = parts;
    if (game.phase !== 'ascent' || character.pushBlend < .999) continue;
    const rock = rockSupportAt(game.rockX), center = new Vector2(rock.x, rock.y);
    const contacts = character.pose.arms.map(arm => arm.end.clone().sub(center));
    character.pose.arms.forEach((arm, i) => {
      near(contacts[i].length(), ROCK_RADIUS, .002);
      const reach = arm.root.distanceTo(arm.end);
      // The final steep lip needs a tighter bracing bend than the main hill.
      const minimumReach = game.rockX > LEDGE_START_X ? .5 : .65;
      assert.ok(reach > minimumReach && reach < 1.14, 'the elbow must neither collapse nor lock straight');
      if (previousContacts) assert.ok(contacts[i].distanceTo(previousContacts[i]) < .05, 'the palm jerks across the stone');
    });
    previousContacts = contacts;
    contactsChecked++;
  }
  assert.equal(game.phase, 'summit');
  assert.ok(contactsChecked > 10000, 'check the whole hill, including its steep sections');
});

test('downhill walking has a measured cadence and holds each planted foot on the terrain', () => {
  const game = new GameState(), character = new Sisyphus(textures);
  game.start(); game.phase = 'descent'; game.playerX = 180;
  let firstStep, previousFeet;
  for (let frame = 0; frame <= 420; frame++) {
    game.update(1 / 60, { left: true });
    character.update(game, 1 / 60, frame / 60);
    checkLimbs(character);
    if (frame === 60) firstStep = character.pose.step;
    character.pose.feet.forEach((foot, i) => {
      if (foot.planted) near(foot.contact.y, heightAt(foot.contact.x));
      if (foot.planted && previousFeet?.[i].planted) near(foot.position.distanceTo(previousFeet[i].position), 0);
    });
    previousFeet = character.pose.feet.map(foot => ({ planted: foot.planted, position: foot.position.clone() }));
  }
  const stepsPerSecond = Math.abs(character.pose.step - firstStep) / 6;
  assert.ok(stepsPerSecond >= 2.7 && stepsPerSecond <= 3.1, `downhill cadence is ${stepsPerSecond} footfalls/sec`);
});

test('IK clamps its endpoint as well as its joint for unreachable and folded targets', () => {
  for (const [a, b] of [[.73, .72], [.56, .62], [1, 1]]) {
    for (const target of [new Vector2(), new Vector2(.00001, 0), new Vector2(.3, -.8), new Vector2(5, -4)]) {
      for (const bend of [-1, 1]) {
        const limb = solveLimb(new Vector2(), target, a, b, bend);
        near(limb.root.distanceTo(limb.joint), a);
        near(limb.joint.distanceTo(limb.end), b);
      }
    }
  }
});

test('both summit and return climbs keep real footholds and fixed limbs in both directions', () => {
  for (const [phase, rockX, start, end] of [
    ['climb', SUMMIT_X, CLIMB_START, CLIMB_END],
    ['descent', START_X + CONTACT_DISTANCE, RETURN_CLIMB_START, RETURN_CLIMB_END],
  ]) {
    const rock = rockSupportAt(rockX);
    for (const direction of [1, -1]) {
      const character = new Sisyphus(textures);
      let previous, previousFeet;
      for (let i = 0; i <= 1500; i++) {
        const t = direction === 1 ? i / 1500 : 1 - i / 1500;
        const x = start - .01 + t * (end - start + .02);
        character.update({ playerX: x, rockX, phase, mode: 'climb', playerVelocity: direction * .75, direction }, 1 / 240, i / 240);
        checkLimbs(character);
        assert.ok(character.pose.feet.some(foot => foot.planted), 'one foot always supports the climb');
        for (const foot of character.pose.feet.filter(f => f.planted)) {
          if (foot.stone) near(foot.contact.distanceTo(new Vector2(rock.x, rock.y)), ROCK_RADIUS);
          else near(foot.contact.y, heightAt(foot.contact.x));
        }
        if (previous) assert.ok(character.pose.hip.distanceTo(previous) < .06, `hip snapped at ${x}`);
        if (previousFeet) character.pose.feet.forEach((foot, index) => assert.ok(foot.position.distanceTo(previousFeet[index]) < .07, `ankle popped during lift-off/landing at ${x}`));
        previous = character.pose.hip.clone();
        previousFeet = character.pose.feet.map(foot => foot.position.clone());
      }
    }
  }
});

test('the bottom shortcut faces downhill and climbs over the stone before rejoining the pushing stance', () => {
  const game = new GameState(), character = new Sisyphus(textures);
  game.start(); game.teleportEndpoint(); game.teleportEndpoint();
  let previousParts, stoneFrames = 0, highStep = false;
  for (let frame = 0; frame < 1000; frame++) {
    game.update(1 / 60, game.phase === 'descent' ? { left: true } : { right: true });
    character.update(game, 1 / 60, frame / 60);
    checkLimbs(character);
    character.group.updateMatrixWorld(true);
    const parts = Object.values(character.parts).map(part => part.getWorldPosition(new Vector3()));
    if (previousParts && game.phase === 'descent') parts.forEach((part, i) => assert.ok(part.distanceTo(previousParts[i]) < .25,
      `${Object.keys(character.parts)[i]} jumps on the return at ${game.playerX}`));
    previousParts = parts;
    if (game.phase !== 'descent') continue;
    assert.equal(character.facing, -1);
    if (character.pose.feet.some(foot => foot.stone)) {
      stoneFrames++;
      assert.ok(character.parts.head.renderOrder > 32, 'the climber remains visible in front of the stone');
      if (character.pose.feet.some(foot => foot.position.y > rockSupportAt(game.rockX).y + 1)) highStep = true;
    }
  }
  assert.ok(stoneFrames > 120 && highStep, 'the player actually traverses the upper surface');
  assert.equal(game.phase, 'ascent');
  assert.ok(game.rockX > START_X + CONTACT_DISTANCE + 1);
  assert.equal(game.cycles, 0);
});

test('stopping keeps the footholds and climbing back turns the character downhill smoothly', () => {
  for (const x of [.7, 1.3, 2.2, 2.9, 4.0].map(offset => CLIMB_START + offset)) {
    const character = new Sisyphus(textures);
    const state = { playerX: x, phase: 'climb', mode: 'climb', playerVelocity: .75, direction: 1 };
    character.update(state, 1 / 60, 0);
    const contacts = character.pose.feet.map(f => f.position.clone());
    state.mode = 'idle'; state.playerVelocity = 0;
    for (let i = 1; i < 120; i++) {
      character.update(state, 1 / 60, i / 60); checkLimbs(character);
      character.pose.feet.forEach((f, index) => near(f.position.distanceTo(contacts[index]), 0));
    }
    state.direction = -1; state.playerVelocity = -.75;
    for (let i = 0; i < 30; i++) {
      character.update(state, 1 / 60, 2 + i / 60); checkLimbs(character);
      character.pose.feet.forEach((f, index) => near(f.position.distanceTo(contacts[index]), 0));
    }
    assert.equal(character.facing, -1);
  }
});

test('walking and pushing up uneven ground and descending the steep ridge keep both legs within reach', () => {
  for (const direction of [1, -1]) {
    const character = new Sisyphus(textures);
    for (let x = 5; x <= 254; x += .065) {
      character.update({ playerX: x, phase: direction === 1 ? 'ascent' : 'descent', mode: direction === 1 ? 'push' : 'walk', playerVelocity: direction * 3, direction }, 1 / 60, x);
      checkLimbs(character);
    }
  }
});

test('the boulder is supported by the curved ground including the summit ledge', () => {
  for (const x of [9.6, 70, 153, 213, 243, 244]) {
    const support = rockSupportAt(x);
    near(Math.hypot(support.contactX - x, support.contactY - support.y), ROCK_RADIUS);
    for (let i = 0; i <= 256; i++) {
      const u = x - ROCK_RADIUS + ROCK_RADIUS * 2 * i / 256;
      const bottom = support.y - Math.sqrt(Math.max(0, ROCK_RADIUS ** 2 - (u - x) ** 2));
      assert.ok(bottom >= heightAt(u) - .00001);
    }
  }
});

test('every shadow vertex stays on or inside the terrain, even on convex bumps and the ledge', () => {
  const shadow = new GroundShadow();
  for (const x of [9.6, 70, 153, 213, 242, 244, 245.2, 247]) {
    shadow.update(x, 1.35, .22, .3);
    near(shadow.position.y, heightAt(x));
    const positions = shadow.geometry.attributes.position, uv = shadow.geometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) {
      const px = shadow.position.x + positions.getX(i), py = shadow.position.y + positions.getY(i);
      assert.ok(py < heightAt(px), 'shadow floats above the silhouette');
      if (uv.getY(i) === 1) near(py, heightAt(px) - .008, .000001);
    }
  }
});
