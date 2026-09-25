import './style.css';
import { GameState } from './game-state.js';
import { loadTextures, World } from './scene.js';
import { Soundscape } from './audio.js';
import { interpolateState } from './render-state.js';
import { RecordSequence } from './record-sequence.js';

const canvas = document.getElementById('world');
const pauseDialog = document.getElementById('pause-dialog');
const params = new URLSearchParams(location.search);
const recordMode = params.get('record') === 'true';
const cycleStorageKey = 'sisyphus-cycles';
function savedCycles() {
  try {
    // Keep progress saved before the project was renamed.
    const value = localStorage.getItem(cycleStorageKey) ?? localStorage.getItem('again-cycles');
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n < 100000 ? n : 0;
  } catch { return 0; }
}
const game = new GameState(recordMode ? 0 : savedCycles());
const recording = recordMode ? new RecordSequence(game) : null;
let recordFade;
if (recordMode) {
  document.body.classList.add('record-mode');
  recordFade = document.createElement('div');
  recordFade.className = 'record-fade';
  recordFade.setAttribute('aria-hidden', 'true');
  document.body.append(recordFade);
}
let previousState = { ...game };
const sound = new Soundscape();
const keyboard = new Set();
const pointers = new Map();
const input = { left: false, right: false, brace: false };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let world, lastTime, accumulator = 0, elapsed = 0, lastTap = null, pauseGestureClick = null, needsRender = true;
const fixedDelta = 1 / 60;

function clearInput() { keyboard.clear(); pointers.clear(); input.left = input.right = input.brace = false; lastTap = null; }
function pause() {
  if (!game.started || game.paused || recording?.done) return;
  game.paused = true;
  clearInput();
  pauseDialog.showModal();
}
function resume() {
  pauseDialog.close();
  pauseGestureClick = null;
  game.paused = false;
  clearInput();
  accumulator = 0;
  lastTime = performance.now();
  previousState = { ...game };
  canvas.focus({ preventScroll: true });
}
async function toggleSound() { try { await sound.toggle(); } catch { /* Audio is optional. */ } }
async function fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* Embedded browsers may not allow fullscreen. */ } }
document.getElementById('resume-button').addEventListener('click', resume);
pauseDialog.addEventListener('cancel', e => { e.preventDefault(); resume(); });
// Opening the dialog under a finger must not let that same tap click Continue.
window.addEventListener('click', e => {
  if (pauseGestureClick && performance.now() < pauseGestureClick.until
    && (e.pointerId === pauseGestureClick.id || (e.pointerId === undefined && e.detail > 0))) {
    e.preventDefault(); e.stopImmediatePropagation(); pauseGestureClick = null;
  }
}, true);
window.addEventListener('keydown', e => {
  if (e.code === 'KeyM') {
    if (!e.repeat) toggleSound();
    return;
  }
  sound.init().catch(() => {});
  if (recordMode && ['KeyK', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault(); return;
  }
  if (e.code === 'KeyK' && !e.repeat && game.started) {
    e.preventDefault();
    clearInput();
    game.teleportEndpoint();
    previousState = { ...game };
    accumulator = 0;
    needsRender = true;
    return;
  }
  if (e.code === 'Escape') {
    if (!pauseDialog.open) { e.preventDefault(); pause(); }
    return;
  }
  if (pauseDialog.open) return;
  if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault(); keyboard.add(e.code);
  }
  if (e.repeat) return;
  if (e.code === 'KeyP') pause();
  if (e.code === 'KeyF') fullscreen();
});
window.addEventListener('keyup', e => keyboard.delete(e.code));
window.addEventListener('blur', () => { clearInput(); if (!recordMode) pause(); });
document.addEventListener('visibilitychange', () => {
  sound.setHidden(document.hidden);
  if (recordMode) {
    // Switching capture tools must not put a pause dialog in the take. Hidden
    // tabs suspend the timeline quietly and resume without skipping any action.
    lastTime = undefined; accumulator = 0;
  } else if (document.hidden) { clearInput(); pause(); }
});
window.addEventListener('resize', () => { clearInput(); world?.resize(); needsRender = true; });

// The landscape itself receives touch input: no virtual buttons or overlays.
window.addEventListener('pointerdown', () => sound.init().catch(() => {}), { passive: true });
canvas.addEventListener('pointerdown', e => {
  if (recordMode || game.paused || !game.started || e.button !== 0) return;
  if (e.pointerType === 'mouse') { canvas.focus({ preventScroll: true }); return; }
  e.preventDefault();
  const now = e.timeStamp;
  if (lastTap && now - lastTap.time < 450 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 35) {
    pauseGestureClick = { id: e.pointerId, until: performance.now() + 700 };
    pause(); return;
  }
  lastTap = null;
  canvas.setPointerCapture(e.pointerId);
  const region = e.clientX / innerWidth;
  pointers.set(e.pointerId, { control: region < 0.36 ? 'left' : region > 0.64 ? 'right' : 'brace', time: now, x: e.clientX, y: e.clientY });
});
canvas.addEventListener('pointerup', e => {
  const pointer = pointers.get(e.pointerId);
  if (pointer && e.timeStamp - pointer.time < 350) lastTap = { time: e.timeStamp, x: e.clientX, y: e.clientY };
  pointers.delete(e.pointerId);
});
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); lastTap = null; });
canvas.addEventListener('lostpointercapture', e => pointers.delete(e.pointerId));
function events() {
  for (const event of game.drainEvents()) {
    if (event === 'again' && !recordMode) {
      try { localStorage.setItem(cycleStorageKey, String(game.cycles)); } catch { /* Storage is optional. */ }
    }
  }
}
function render(state, dt) {
  world.update(state, dt, elapsed);
  if (recordFade) recordFade.style.opacity = String(recording.fade);
}
function frame(now) {
  const dt = Math.min((now - (lastTime ?? now)) / 1000, 0.1);
  lastTime = now;
  if (recordMode && document.hidden) { requestAnimationFrame(frame); return; }
  const running = !game.paused && !recording?.done;
  if (running) elapsed += dt;
  const touch = new Set([...pointers.values()].map(p => p.control));
  input.left = keyboard.has('KeyA') || keyboard.has('ArrowLeft') || touch.has('left');
  input.right = keyboard.has('KeyD') || keyboard.has('ArrowRight') || touch.has('right');
  input.brace = keyboard.has('Space') || touch.has('brace');
  accumulator += dt;
  while (accumulator >= fixedDelta) {
    previousState = { ...game };
    if (recording) recording.update(fixedDelta);
    else game.update(fixedDelta, input);
    accumulator -= fixedDelta;
  }
  events(); sound.update(game, recording ? 1 - recording.fade : 1);
  if (running || needsRender) {
    render(interpolateState(previousState, game, game.paused ? 1 : accumulator / fixedDelta), game.paused ? 0 : dt);
    needsRender = false;
  }
  requestAnimationFrame(frame);
}
try {
  const textures = await loadTextures();
  world = new World(canvas, textures, reducedMotion);
  game.start();
  previousState = { ...game };
  render(game, 10);
  document.body.classList.add('ready');
  requestAnimationFrame(frame);
  if (import.meta.env.DEV && params.has('test')) {
    window.__game = {
      state: game, world, sound, recording,
      step(seconds, controls = {}) {
        for (let i = 0; i < Math.ceil(seconds / fixedDelta); i++) {
          if (!game.paused && !recording?.done) elapsed += fixedDelta;
          if (recording) recording.update(fixedDelta);
          else game.update(fixedDelta, controls);
        }
        previousState = { ...game };
        events(); render(game, game.paused || recording?.done ? 0 : 1);
        return { phase: game.phase, playerX: game.playerX, rockX: game.rockX, cycles: game.cycles, progress: game.progress };
      },
      render: () => render(game, game.paused || recording?.done ? 0 : 1),
    };
  }
} catch (error) {
  console.error('Sisyphus could not load:', error);
  const message = document.getElementById('loading-error');
  message.hidden = false;
  message.textContent = 'Sisyphus could not load. Please reload in a browser with WebGL enabled.';
}
