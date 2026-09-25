import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { preview } from 'vite';
import { launchBrowser } from './browser-helpers.mjs';

// Check built files at user-site and repository-site paths, without relying on
// the development server to resolve asset URLs or expose simulation controls.
const browser = await launchBrowser();
await mkdir('test-results', { recursive: true });
try {
  const files = await readdir('dist/assets', { recursive: true });
  assert.ok(!files.some(file => /(?:atlas|font-\d|\.md$|\.json$)/.test(file)), 'source artwork and metadata must stay out of the deployment');
  assert.ok(!files.some(file => /^(panorama|forest-ridge|limestone)\.png$/.test(file)), 'only runtime scenery encodings are deployed');

  for (const base of ['/', '/sisyphus/']) {
    const server = await preview({ base, preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [], loaded = new Set();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      const url = new URL(response.url());
      if (/\.(?:png|webp|ttf|js|css|mp3)$/.test(url.pathname)) {
        if (!url.pathname.startsWith(`${base}assets/`)) errors.push(`Asset escaped the deployment path: ${url.pathname}`);
        loaded.add(url.pathname);
      }
    });
    try {
      await page.goto(`${origin}${base}?test=1`);
      await page.waitForFunction(() => document.body.classList.contains('ready'));
      assert.equal(await page.locator('#loading-error').isVisible(), false);
      assert.equal(await page.evaluate(() => typeof window.__game), 'undefined', 'development controls are stripped from production');
      assert.equal(await page.locator('body').innerText(), '');
      const pianoResponse = page.waitForResponse(response => response.url().endsWith('/audio/sisyphus-piano.mp3'));
      await page.keyboard.press('Escape');
      assert.equal((await pianoResponse).status(), 200, 'bundled piano loads from the deployed path');
      assert.equal(await page.locator('#pause-dialog').evaluate(el => el.open), true);
      assert.equal((await page.locator('body').innerText()).trim(), 'continue...');
      assert.ok(await page.evaluate(async () => (await document.fonts.load('italic 400 40px "Cormorant Garamond"')).length > 0), 'the pause font loads at the deployed path');
      await page.click('#resume-button');
      assert.ok(loaded.has(`${base}assets/panorama.webp`));
      assert.ok(loaded.has(`${base}assets/fonts/cormorant-garamond-italic.ttf`));
      assert.ok(loaded.has(`${base}assets/audio/sisyphus-piano.mp3`));
      assert.equal([...loaded].filter(path => path.includes('/sisyphus/') && path.endsWith('.png')).length, 9);
      await page.screenshot({ path: `test-results/production-${base === '/' ? 'root' : 'repository'}.png` });

      await page.goto(`${origin}${base}?record=true`);
      await page.waitForFunction(() => document.body.classList.contains('ready'));
      assert.equal(await page.locator('.record-fade').count(), 1);
      assert.equal(await page.locator('#world').evaluate(el => getComputedStyle(el).cursor), 'none');
      assert.equal(await page.evaluate(() => typeof window.__game), 'undefined');
      await page.waitForTimeout(500);
      assert.equal(await page.locator('body').innerText(), '');
      assert.deepEqual(errors, [], `production errors at ${base}`);
      console.log(`Production passed at ${base}: textures, fonts, piano, pause, record mode, and absent debug hooks.`);
    } finally {
      await page.close();
      await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    }
  }
} finally { await browser.close(); }
