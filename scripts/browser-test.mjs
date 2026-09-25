import { launchBrowser } from './browser-helpers.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { START_X, SUMMIT_X, CONTACT_DISTANCE } from '../src/terrain.js';
import { CLIMB_START } from '../src/locomotion.js';

const base = process.env.TEST_URL || 'http://localhost:5173/';
const browser = await launchBrowser();
const errors = [], failed = [];
await mkdir('test-results', { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
function watch(p) {
  p.on('pageerror', error => errors.push(error.message));
  p.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  p.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
}
watch(page);
try {
  await page.goto(`${base}?test=1`);
  await page.waitForFunction(() => !!window.__game);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => __game.state.phase), 'ascent', 'opens directly into the game');
  assert.equal(await page.locator('body').innerText(), '', 'no HUD, title, narration, or control overlays');
  await page.screenshot({ path: 'test-results/sisyphus.png' });
  await page.keyboard.down('d');
  await page.waitForFunction(() => __game.state.playerX > 8, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => __game.state.mode), 'push');
  assert.ok(await page.evaluate(() => __game.state.playerX) > 8);
  await page.screenshot({ path: 'test-results/pushing.png' });
  await page.keyboard.up('d');
  await page.keyboard.down('Space');
  const held = await page.evaluate(() => __game.state.rockX);
  await page.waitForTimeout(700);
  assert.ok(Math.abs(await page.evaluate(() => __game.state.rockX) - held) < .15);
  await page.keyboard.up('Space');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pause-dialog').evaluate(el => el.open), true);
  assert.equal((await page.locator('body').innerText()).trim(), 'continue...');
  assert.equal(await page.locator('#pause-dialog button').count(), 1);
  assert.match(await page.locator('#pause-dialog').evaluate(el => getComputedStyle(el, '::backdrop').backdropFilter), /blur/);
  const frozen = await page.evaluate(() => ({ rock: __game.state.rockX, layers: __game.world.atmosphere.layers.map(l => l.offset) }));
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => ({ rock: __game.state.rockX, layers: __game.world.atmosphere.layers.map(l => l.offset) })), frozen);
  await page.screenshot({ path: 'test-results/pause.png' });
  await page.click('#resume-button');
  assert.equal(await page.evaluate(() => __game.state.paused), false);
  assert.equal(await page.locator('body').innerText(), '');
  await page.waitForFunction(() => __game.sound.enabled && __game.sound.music?.loop);
  await page.keyboard.press('m');
  assert.equal(await page.evaluate(() => __game.sound.enabled), false);
  await page.keyboard.press('m');
  assert.equal(await page.evaluate(() => __game.sound.enabled), true);

  // A returning stone yields briefly, then holds without continued downhill travel.
  await page.evaluate(() => __game.step(12, { right: true }));
  const releasedX = await page.evaluate(() => __game.state.playerX);
  await page.evaluate(() => __game.step(5));
  const caught = await page.evaluate(() => ({ player: __game.state.playerX, rock: __game.state.rockX, mode: __game.state.mode }));
  assert.equal(caught.mode, 'brace');
  assert.ok(releasedX - caught.player > 0 && releasedX - caught.player < .5);
  await page.evaluate(() => __game.step(10));
  assert.deepEqual(await page.evaluate(() => ({ player: __game.state.playerX, rock: __game.state.rockX, mode: __game.state.mode })), caught);
  await page.screenshot({ path: 'test-results/caught-stone.png' });

  // Actual parallax responds to travel and each depth moves a different distance.
  const layersBefore = await page.evaluate(() => __game.world.atmosphere.layers.map(l => l.offset));
  await page.keyboard.down('d');
  await page.evaluate(() => __game.step(18, { right: true }));
  await page.waitForTimeout(600);
  const layersAfter = await page.evaluate(() => __game.world.atmosphere.layers.map(l => l.offset));
  const travel = layersAfter.map((x, i) => layersBefore[i] - x);
  assert.ok(travel[0] > .1 && travel[1] > travel[0] * 2.5, 'near forest scrolls faster than distant forest');
  await page.screenshot({ path: 'test-results/parallax-after.png' });
  await page.evaluate(() => __game.step(80, { right: true }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/mid-ascent.png' });
  await page.evaluate(() => {
    for (let i = 0; i < 12000 && __game.state.phase === 'ascent'; i++) __game.state.update(1 / 60, { right: true });
    __game.step(1.2, { right: true });
  });
  assert.equal(await page.evaluate(() => __game.state.phase), 'climb');
  assert.equal(await page.evaluate(() => __game.state.rockX), SUMMIT_X, 'the stone reaches the upper ledge');
  assert.ok(await page.evaluate(async () => {
    const { rockSupportAt, heightAt, LOOKOUT_X } = await import('/src/terrain.js');
    return Math.abs(rockSupportAt(__game.state.rockX).contactY - heightAt(LOOKOUT_X)) < 1e-5;
  }));
  await page.screenshot({ path: 'test-results/climb.png' });
  await page.keyboard.up('d');
  await page.evaluate(() => __game.step(2.4, { right: true }));
  await page.waitForFunction(() => __game.state.walkVelocity === 0);
  const climbing = await page.evaluate(async () => {
    const { heightAt } = await import('/src/terrain.js');
    const { character, footShadow, rockShadow } = __game.world;
    return {
      mode: __game.state.mode,
      footClearance: Math.min(...character.pose.feet.map(f => f.position.y)) - footShadow.position.y,
      shadows: [footShadow, rockShadow].map(shadow => Math.abs(shadow.position.y - heightAt(shadow.position.x))),
      bones: character.pose.legs.map(leg => [leg.root.distanceTo(leg.joint), leg.joint.distanceTo(leg.end)]),
      feet: character.pose.feet.map(f => f.position.toArray()),
    };
  });
  assert.equal(climbing.mode, 'idle');
  assert.ok(climbing.footClearance > 1, 'the shadow stays below Sisyphus while he climbs the stone');
  assert.ok(climbing.shadows.every(error => error < 1e-7), 'both shadows are attached to terrain');
  assert.ok(climbing.bones.every(([a, b]) => Math.abs(a - .73) < 1e-7 && Math.abs(b - .72) < 1e-7));
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => __game.world.character.pose.feet.map(f => f.position.toArray())), climbing.feet, 'stopping retains the footholds');
  await page.screenshot({ path: 'test-results/climb-stopped.png' });
  await page.evaluate(() => __game.step(30));
  assert.equal(await page.evaluate(() => __game.state.rockX), SUMMIT_X, 'waiting on the stone does not release it');
  await page.keyboard.down('a');
  await page.waitForFunction(() => __game.world.character.facing === -1);
  assert.equal(await page.evaluate(() => __game.world.character.facing), -1, 'climbing back faces downhill');
  await page.screenshot({ path: 'test-results/climb-backwards.png' });
  await page.evaluate(() => __game.step(8, { left: true }));
  await page.keyboard.up('a');
  assert.ok(await page.evaluate(() => __game.state.playerX) < CLIMB_START - .5, 'the old climb boundary cannot trap the player');
  assert.equal(await page.evaluate(() => __game.state.rockX), SUMMIT_X);
  await page.screenshot({ path: 'test-results/climb-return.png' });
  await page.evaluate(() => {
    for (let i = 0; i < 3000 && __game.state.phase === 'climb'; i++) __game.state.update(1 / 60, { right: true });
    __game.step(.3, { right: true });
  });
  await page.keyboard.up('d');
  assert.equal(await page.evaluate(() => __game.state.phase), 'summit');
  assert.ok(await page.evaluate(() => __game.state.rockX) < SUMMIT_X, 'crossing the stone starts the fall immediately');
  await page.evaluate(() => __game.step(2, { right: true }));
  await page.waitForTimeout(3500);
  assert.equal(await page.locator('body').innerText(), '', 'the summit is also free of UI');
  await page.screenshot({ path: 'test-results/summit.png' });
  await page.keyboard.down('a');
  await page.waitForFunction(() => __game.state.phase === 'descent');
  assert.equal(await page.evaluate(() => __game.state.phase), 'descent');
  await page.evaluate(() => __game.step(106, { left: true }));
  await page.keyboard.up('a');
  assert.equal(await page.evaluate(() => __game.state.phase), 'ascent');
  assert.equal(await page.evaluate(() => __game.state.cycles), 1);

  // The hidden shortcut works through actual key events, ignores repeats, and
  // resets the camera/rig at the destination rather than flying across the map.
  await page.keyboard.down('k');
  await page.waitForFunction(() => __game.state.phase === 'ascent' && __game.world.camera.position.x > 240);
  const topShortcut = await page.evaluate(() => ({ player: __game.state.playerX, rock: __game.state.rockX, revision: __game.state.teleportRevision }));
  assert.ok(topShortcut.rock < SUMMIT_X - 1 && topShortcut.rock > SUMMIT_X - 6, 'the ledge push is unfinished');
  assert.ok(Math.abs(topShortcut.rock - topShortcut.player - CONTACT_DISTANCE) < 1e-8);
  assert.ok(await page.evaluate(() => Math.abs(__game.world.character.pose.hip.x - __game.state.playerX)) < .5);
  assert.equal(await page.locator('body').innerText(), '');
  await page.keyboard.down('k');
  assert.equal(await page.evaluate(() => __game.state.teleportRevision), topShortcut.revision, 'held K does not repeat');
  await page.keyboard.up('k');
  await page.screenshot({ path: 'test-results/shortcut-top.png' });
  await page.keyboard.down('d');
  await page.waitForFunction(x => __game.state.rockX > x + .25, topShortcut.rock, { timeout: 10000 });
  assert.equal(await page.evaluate(() => __game.state.phase), 'ascent', 'normal pushing resumes near the top');
  await page.keyboard.up('d');
  await page.keyboard.press('k');
  await page.waitForFunction(() => __game.state.phase === 'descent' && __game.world.camera.position.x < 20);
  const bottomShortcut = await page.evaluate(() => ({ player: __game.state.playerX, rock: __game.state.rockX, velocity: __game.state.rockVelocity }));
  assert.equal(bottomShortcut.rock, START_X + CONTACT_DISTANCE);
  assert.ok(bottomShortcut.player > bottomShortcut.rock + CONTACT_DISTANCE, 'the player arrives on the uphill side');
  assert.equal(bottomShortcut.velocity, 0);
  assert.ok(await page.evaluate(() => Math.abs(__game.world.character.pose.hip.x - __game.state.playerX)) < .5);
  assert.equal(await page.evaluate(() => __game.world.character.facing), -1);
  await page.screenshot({ path: 'test-results/shortcut-bottom.png' });
  await page.keyboard.down('a');
  await page.waitForFunction(() => __game.state.mode === 'climb' && __game.world.character.pose.feet.some(foot => foot.stone), null, { timeout: 15000 });
  await page.keyboard.up('a');
  assert.equal(await page.evaluate(() => __game.world.character.facing), -1);
  await page.evaluate(() => __game.step(2));
  await page.screenshot({ path: 'test-results/shortcut-climb-back.png' });
  await page.evaluate(() => __game.step(3, { left: true }));
  assert.ok(await page.evaluate(() => __game.world.character.pose.feet.some(foot => foot.stone)), 'the return follows the boulder surface');
  await page.screenshot({ path: 'test-results/shortcut-over-stone.png' });
  await page.evaluate(() => {
    for (let i = 0; i < 1200 && __game.state.phase === 'descent'; i++) __game.state.update(1 / 60, { left: true });
    __game.step(0);
  });
  assert.equal(await page.evaluate(() => __game.state.phase), 'ascent');
  assert.equal(await page.evaluate(() => __game.state.cycles), 1, 'returning from the shortcut does not award a cycle');
  assert.equal(await page.evaluate(() => __game.state.playerX), START_X);
  assert.equal(await page.evaluate(() => __game.state.rockX), bottomShortcut.rock);
  await page.keyboard.down('d');
  await page.waitForFunction(x => __game.state.rockX > x + .25, bottomShortcut.rock, { timeout: 10000 });
  await page.keyboard.up('d');
  await page.keyboard.press('Escape');
  await page.keyboard.press('k');
  await page.waitForFunction(() => __game.world.camera.position.x > 240);
  assert.equal(await page.evaluate(() => __game.state.paused), true);
  assert.equal(await page.evaluate(() => __game.state.phase), 'ascent');
  await page.click('#resume-button');
  await page.keyboard.down('d');
  await page.waitForFunction(x => __game.state.rockX > x + .25, topShortcut.rock, { timeout: 10000 });
  await page.keyboard.up('d');
  await page.keyboard.press('k');
  await page.waitForFunction(() => __game.state.phase === 'descent' && __game.world.camera.position.x < 20);
  assert.equal(await page.evaluate(() => __game.state.cycles), 1, 'shortcut does not award cycles');
  console.log('Desktop passed: movement, automatic catch and hold, hidden K shortcut, pause, sound, parallax, and complete gameplay cycle.');
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  watch(mobile);
  await mobile.goto(`${base}?test=1`);
  await mobile.waitForFunction(() => !!window.__game);
  const cdp = await mobile.context().newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 335, y: 650 }] });
  await mobile.waitForFunction(() => __game.state.playerX > 8, null, { timeout: 10000 });
  assert.ok(await mobile.evaluate(() => __game.state.playerX) > 8);
  assert.equal(await mobile.locator('body').innerText(), '');
  await mobile.screenshot({ path: 'test-results/mobile-game.png' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(350);
  // Keep the physical gesture interval independent of software WebGL/CDP latency.
  const tapTime = Date.now() / 1000;
  for (let i = 0; i < 2; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: tapTime + i * .12, touchPoints: [{ x: 195, y: 450 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: tapTime + i * .12 + .04, touchPoints: [] });
  }
  await mobile.waitForFunction(() => __game.state.paused);
  await mobile.waitForTimeout(250);
  assert.equal(await mobile.locator('#pause-dialog').evaluate(el => el.open), true, 'double-tap pauses');
  await mobile.tap('#resume-button');
  assert.equal(await mobile.evaluate(() => __game.state.paused), false);
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.waitForTimeout(400);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.screenshot({ path: 'test-results/mobile-landscape.png' });
  console.log('Mobile passed: invisible touch regions, double-tap pause, resume, and orientation change.');
  assert.deepEqual(errors, [], 'No browser or shader exceptions');
  assert.deepEqual(failed, [], 'All assets load');
  console.log('No browser errors, shader failures, or missing assets.');
} finally { await browser.close(); }
