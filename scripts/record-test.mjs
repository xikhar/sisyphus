import { launchBrowser } from './browser-helpers.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { START_X, SUMMIT_X, LOOKOUT_X } from '../src/terrain.js';

const base = process.env.TEST_URL || 'http://localhost:5173/';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
await mkdir('test-results', { recursive: true });
try {
  await page.addInitScript(() => localStorage.setItem('sisyphus-cycles', '5'));
  await page.goto(`${base}?record=true&test=1`);
  await page.waitForFunction(() => window.__game?.recording?.stage === 'push');
  // Decode audio before measuring the short opening shot, so asset-loading
  // latency cannot make the test miss the first push and wait for the second.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => __game.sound.music?.loop && __game.sound.ctx.state === 'running');
  await page.keyboard.press('m');
  assert.equal(await page.evaluate(() => __game.sound.enabled), false, 'mute works while paused');
  await page.keyboard.press('m');
  assert.equal(await page.evaluate(() => __game.sound.enabled), true);
  await page.click('#resume-button');
  assert.equal(await page.locator('body').innerText(), '');
  assert.equal(await page.locator('#world').evaluate(el => getComputedStyle(el).cursor), 'none');
  assert.equal(await page.locator('#world').evaluate(el => getComputedStyle(el).opacity), '1', 'the opening push is immediately visible');
  await page.evaluate(() => {
    window.__recordShots = [];
    const track = () => {
      const { state, recording, world } = __game;
      if (__recordShots.at(-1)?.stage !== recording.stage) {
        __recordShots.push({ stage: recording.stage, time: recording.elapsed, phase: state.phase,
          rock: state.rockX, player: state.playerX, camera: world.camera.position.x,
          fade: Number(getComputedStyle(document.querySelector('.record-fade')).opacity) });
      }
      if (!recording.done) requestAnimationFrame(track);
    };
    track();
  });
  // Capture-tool focus changes and stray movement keys cannot disrupt the take.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.press('k');
  await page.keyboard.press('a');
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => __game.state.paused), false);
  assert.equal(await page.evaluate(() => __game.state.teleportRevision), 0);
  await page.waitForFunction(() => __game.recording.elapsed > 1 && __game.state.mode === 'push');
  await page.screenshot({ path: 'test-results/record-push.png' });

  await page.waitForFunction(() => __game.recording.stage === 'catch' && __game.recording.stageTime > .6, null, { timeout: 30000 });
  assert.ok(await page.evaluate(() => __game.state.rockVelocity) < 0);
  await page.screenshot({ path: 'test-results/record-rollback.png' });
  await page.waitForFunction(() => __game.recording.stage === 'hold', null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => __game.state.autoBrace && !__game.state.catchMotion), true);
  await page.screenshot({ path: 'test-results/record-hold.png' });

  await page.waitForFunction(() => __game.recording.stage === 'summit-push' && __game.recording.stageTime > .4, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => __game.state.phase), 'ascent');
  assert.ok(await page.evaluate(() => __game.state.rockX) < SUMMIT_X);
  assert.ok(await page.evaluate(() => __game.world.camera.position.x) > 240);
  assert.equal(await page.locator('.record-fade').evaluate(el => getComputedStyle(el).opacity), '0');
  await page.screenshot({ path: 'test-results/record-final-push.png' });
  await page.waitForFunction(() => __game.recording.stage === 'summit-climb' && __game.recording.stageTime > 3.8, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => __game.state.rockX), SUMMIT_X);
  await page.screenshot({ path: 'test-results/record-climb.png' });
  await page.waitForFunction(() => __game.recording.stage === 'reveal' && __game.recording.stageTime > 3.8, null, { timeout: 30000 });
  assert.ok(await page.evaluate(() => __game.state.rockX) < SUMMIT_X - 30);
  assert.ok(await page.evaluate(() => __game.world.viewHeight) > 30);
  await page.screenshot({ path: 'test-results/record-panorama.png' });
  await page.waitForFunction(() => __game.recording.stage === 'descend' && __game.recording.stageTime > .7, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => __game.state.direction), -1);
  assert.ok(await page.evaluate(() => __game.state.playerX) < LOOKOUT_X);
  await page.screenshot({ path: 'test-results/record-descent.png' });
  await page.waitForFunction(() => __game.recording.done && __recordShots.at(-1)?.stage === 'done', null, { timeout: 15000 });
  assert.equal(await page.locator('.record-fade').evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('body').innerText(), '');
  assert.equal(await page.locator('#pause-dialog').evaluate(el => el.open), false);
  const shots = await page.evaluate(() => __recordShots);
  const cut = shots.find(shot => shot.stage === 'cut');
  assert.ok(cut && cut.fade === 1 && cut.camera > 240, 'the camera cut is covered by the fade');
  assert.ok(Math.abs(shots.find(shot => shot.stage === 'step-back').time - 4) < .11, 'the opening push lasts four seconds, within one rendered frame');
  const endTime = await page.evaluate(() => __game.state.time);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => __game.state.time), endTime, 'the sequence ends without continuing or looping');
  await page.waitForFunction(() => __game.sound.master.gain.value < .001, null, { timeout: 2000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('sisyphus-cycles')), '5');
  console.log(`Record mode passed: complete autoplay in ${shots.at(-1).time.toFixed(2)} simulation seconds, automatic catch, hidden cut, panorama, descent, and clean ending.`);

  await page.reload();
  await page.waitForFunction(() => window.__game?.recording?.stage === 'push');
  assert.ok(await page.evaluate(() => __game.state.playerX) < START_X + .5, 'reloading starts a new take');
  await page.goto(`${base}?record=false&test=1`);
  await page.waitForFunction(() => !!window.__game);
  assert.equal(await page.evaluate(() => __game.recording), null);
  assert.equal(await page.locator('.record-fade').count(), 0);
  assert.equal(await page.evaluate(() => __game.state.cycles), 5);
  await page.keyboard.down('d');
  await page.waitForFunction(() => __game.state.playerX > 7.5, null, { timeout: 10000 });
  await page.keyboard.up('d');
  assert.deepEqual(errors, [], 'no browser, shader, or asset failures');
  console.log('Reload and opt-in checks passed; normal controls and saved progress remain available.');
} finally { await browser.close(); }
