import { LOOKOUT_X, clamp } from './terrain.js';

const smooth = t => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const reached = (time, duration) => time >= duration - 1e-8;

// Direct the ordinary simulation with the same inputs as the player. Contacts,
// catching, climbing and the summit release still come from the game physics.
export class RecordSequence {
  constructor(game) {
    this.game = game;
    this.stage = 'push';
    this.stageTime = 0;
    this.elapsed = 0;
  }

  get done() { return this.stage === 'done'; }

  get fade() {
    if (this.stage === 'fade-out') return smooth(this.stageTime / .7);
    if (this.stage === 'cut' || this.done) return 1;
    if (this.stage === 'fade-in') return 1 - smooth(this.stageTime / .7);
    if (this.stage === 'ending') return smooth(this.stageTime / .8);
    return 0;
  }

  enter(stage) { this.stage = stage; this.stageTime = 0; }

  controls() {
    if (['push', 'push-again', 'summit-push', 'summit-climb'].includes(this.stage)) return { right: true };
    if (['step-back', 'descend', 'ending'].includes(this.stage)) return { left: true };
    if (this.stage === 'reveal' && this.game.playerX < LOOKOUT_X) return { right: true };
    // No brace input during the rollback: the game must catch the stone itself.
    return {};
  }

  update(dt) {
    if (this.done || this.game.paused || !this.game.started) return;
    dt = Math.min(dt, 1 / 30);
    this.game.update(dt, this.controls());
    this.stageTime += dt;
    this.elapsed += dt;
    switch (this.stage) {
      case 'push':
        if (reached(this.stageTime, 4)) this.enter('step-back');
        break;
      case 'step-back':
        if (reached(this.stageTime, .8)) this.enter('catch');
        break;
      case 'catch':
        if (this.game.autoBrace && !this.game.catchMotion) this.enter('hold');
        break;
      case 'hold':
        if (reached(this.stageTime, 1.1)) this.enter('push-again');
        break;
      case 'push-again':
        if (reached(this.stageTime, 2)) this.enter('fade-out');
        break;
      case 'fade-out':
        if (reached(this.stageTime, .7)) {
          // Keep a short opaque beat so the camera and rig can snap unseen,
          // including on a display that renders fewer frames than the simulation.
          this.game.teleportEndpoint();
          this.enter('cut');
        }
        break;
      case 'cut':
        if (reached(this.stageTime, .2)) this.enter('fade-in');
        break;
      case 'fade-in':
        if (reached(this.stageTime, .7)) this.enter('summit-push');
        break;
      case 'summit-push':
        if (this.game.phase === 'climb') this.enter('summit-climb');
        break;
      case 'summit-climb':
        if (this.game.phase === 'summit') this.enter('reveal');
        break;
      case 'reveal':
        if (reached(this.stageTime, 5)) this.enter('descend');
        break;
      case 'descend':
        if (reached(this.stageTime, 2.5)) this.enter('ending');
        break;
      case 'ending':
        if (reached(this.stageTime, .8)) this.enter('done');
        break;
    }
  }
}
