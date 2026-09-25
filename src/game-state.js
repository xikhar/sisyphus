import { START_X, SUMMIT_X, LOOKOUT_X, CONTACT_DISTANCE, slopeAt, clamp, damp } from './terrain.js';
import { CLIMB_START, CLIMB_END, RETURN_CLIMB_END, climbRouteFor } from './locomotion.js';

const DOWNHILL_SPEED = 2.8;

export class GameState {
  constructor(cycles = 0) {
    this.phase = 'title';
    this.playerX = START_X;
    this.rockX = START_X + CONTACT_DISTANCE;
    this.rockVelocity = 0;
    this.playerVelocity = 0;
    this.walkVelocity = 0;
    this.rockRotation = 0;
    this.direction = 1;
    this.time = 0;
    this.cycles = cycles;
    this.summits = 0;
    this.effort = 0;
    this.mode = 'idle';
    this.returning = false;
    this.paused = false;
    this.started = false;
    this.events = [];
    this.autoBrace = false;
    this.catchInputAxis = 0;
    this.catchMotion = null;
    this.teleportRevision = 0;
    this.nextTeleportTop = true;
  }

  start() {
    if (this.phase !== 'title') return;
    this.started = true;
    this.setPhase('ascent');
  }

  setPhase(phase) {
    this.phase = phase;
    this.events.push(phase);
  }

  get progress() { return clamp((this.rockX - START_X - CONTACT_DISTANCE) / (SUMMIT_X - START_X - CONTACT_DISTANCE), 0, 1); }

  teleportEndpoint() {
    const top = this.nextTeleportTop;
    this.nextTeleportTop = !top;
    this.teleportRevision++;
    // Leave the final push unfinished at the top. At the bottom, arrive on the
    // uphill side and climb back over the parked stone to reach the pushing side.
    this.playerX = top ? SUMMIT_X - 4 - CONTACT_DISTANCE : RETURN_CLIMB_END + .7;
    this.rockX = top ? SUMMIT_X - 4 : START_X + CONTACT_DISTANCE;
    this.playerVelocity = this.walkVelocity = this.rockVelocity = 0;
    this.rockRotation = 0;
    this.autoBrace = top;
    this.catchInputAxis = 0;
    this.catchMotion = null;
    this.returning = false;
    this.direction = top ? 1 : -1;
    this.effort = top ? .6 : 0;
    this.mode = top ? 'brace' : 'idle';
    this.events.length = 0;
    this.setPhase(top ? 'ascent' : 'descent');
  }

  movePlayer(dt, axis, speed, min, max) {
    this.walkVelocity = damp(this.walkVelocity, axis * speed, 10, dt);
    if (!axis && Math.abs(this.walkVelocity) < .005) this.walkVelocity = 0;
    this.playerX = clamp(this.playerX + this.walkVelocity * dt, min, max);
    if (this.playerX === min || this.playerX === max) this.walkVelocity = 0;
  }

  absorbImpact(dt) {
    const impact = this.catchMotion;
    const previousRock = this.rockX;
    impact.time = Math.min(impact.duration, impact.time + dt);
    const t = impact.time / impact.duration;
    this.playerX = impact.from + (impact.to - impact.from) * (1 - (1 - t) ** 3);
    this.rockX = this.playerX + CONTACT_DISTANCE;
    this.rockVelocity = (this.rockX - previousRock) / dt;
    this.walkVelocity = 0;
    this.mode = 'brace';
    if (t === 1) { this.catchMotion = null; this.rockVelocity = 0; }
  }

  updateAscent(dt, axis, brace) {
    // A key held before impact cannot keep dragging him downhill. A fresh
    // movement command releases the catch; pushing takes over immediately.
    if (this.autoBrace) {
      if (!axis) this.catchInputAxis = 0;
      else if (axis !== this.catchInputAxis) {
        this.autoBrace = false; this.catchMotion = null; this.catchInputAxis = 0;
      } else axis = 0;
    }
    if (this.catchMotion) { this.absorbImpact(dt); return; }
    const touching = this.rockX - this.playerX <= CONTACT_DISTANCE + .13;
    const pushing = touching && axis > 0;
    const holding = touching && (brace || this.autoBrace) && axis >= 0;
    if (holding && this.autoBrace) {
      this.rockVelocity = this.walkVelocity = 0;
      this.mode = 'brace';
      return;
    }
    if (pushing) {
      const speed = (1.58 - slopeAt(this.rockX) * .7) * (.9 + .1 * Math.sin(this.time * 3.3));
      this.rockVelocity = damp(this.rockVelocity, speed, 4, dt);
      this.mode = 'push';
    } else if (holding) {
      this.rockVelocity = damp(this.rockVelocity, 0, 15, dt);
      if (Math.abs(this.rockVelocity) < .005) this.rockVelocity = 0;
      this.mode = 'brace';
    } else {
      this.rockVelocity = Math.max(-8, this.rockVelocity - (slopeAt(this.rockX) * 3.6 + .18) * dt);
    }
    const nextRock = Math.max(START_X + CONTACT_DISTANCE, this.rockX + this.rockVelocity * dt);
    if (pushing || holding) {
      this.rockX = nextRock;
      this.playerX = this.rockX - CONTACT_DISTANCE;
      this.walkVelocity = 0;
    } else {
      this.movePlayer(dt, axis, axis < 0 ? DOWNHILL_SPEED : 2.8, START_X - 3.2, this.rockX - CONTACT_DISTANCE);
      if (Math.abs(this.walkVelocity) > .08) this.mode = 'walk';
      if (this.rockVelocity < 0 && nextRock <= this.playerX + CONTACT_DISTANCE && this.playerX > START_X) {
        const speed = Math.abs(this.rockVelocity);
        this.autoBrace = true;
        this.catchInputAxis = axis < 0 ? -1 : 0;
        this.catchMotion = {
          from: this.playerX, to: Math.max(START_X, this.playerX - clamp(.12 + speed * .055, .12, .45)),
          time: 0, duration: .32 + Math.min(speed, 8) * .01,
        };
        this.absorbImpact(dt);
      } else {
        this.rockX = nextRock;
        this.playerX = Math.min(this.playerX, this.rockX - CONTACT_DISTANCE);
      }
    }
    if (this.rockX <= START_X + CONTACT_DISTANCE && this.rockVelocity < 0) this.rockVelocity = 0;
  }

  update(dt, input = {}) {
    if (this.paused || this.phase === 'title') return;
    dt = Math.min(dt, 1 / 30);
    this.time += dt;
    const right = !!input.right;
    const left = !!input.left;
    const brace = !!input.brace;
    const axis = Number(right) - Number(left);
    const previousPlayer = this.playerX;
    const previousRock = this.rockX;
    this.mode = 'idle';

    if (this.phase === 'ascent') {
      this.updateAscent(dt, axis, brace);
      if (this.rockX >= SUMMIT_X) {
        this.rockX = SUMMIT_X;
        this.rockVelocity = 0;
        this.autoBrace = false;
        this.catchInputAxis = 0;
        this.catchMotion = null;
        this.setPhase('climb');
      }
    } else if (this.phase === 'climb') {
      const onStone = this.playerX >= CLIMB_START && this.playerX < CLIMB_END;
      this.movePlayer(dt, axis, onStone ? .75 : DOWNHILL_SPEED, START_X, LOOKOUT_X);
      if (Math.abs(this.walkVelocity) > .08) this.mode = onStone ? 'climb' : 'walk';
      if (this.playerX >= CLIMB_END) {
        // Both feet have reached the far side. The stone stays parked until
        // this crossing, regardless of how long the player waits or backs down.
        this.summits++;
        this.setPhase('summit');
        this.rollDown(dt);
      }
    } else if (this.phase === 'summit') {
      this.rollDown(dt);
      this.movePlayer(dt, axis, axis < 0 ? DOWNHILL_SPEED : 2, START_X, LOOKOUT_X);
      this.mode = Math.abs(this.walkVelocity) > .08 ? 'walk' : 'breathe';
      if (axis < 0) {
        this.returning = true;
        this.setPhase('descent');
      }
    } else if (this.phase === 'descent') {
      this.rollDown(dt);
      const route = climbRouteFor(this);
      const onStone = route && this.playerX >= route.start && this.playerX < route.end;
      this.movePlayer(dt, axis, onStone ? .75 : axis < 0 ? DOWNHILL_SPEED : 3, START_X, LOOKOUT_X);
      if (Math.abs(this.walkVelocity) > .08) this.mode = onStone || Math.abs(slopeAt(this.playerX)) > 0.55 ? 'climb' : 'walk';
      if (this.playerX <= START_X + 0.05 && this.rockX <= START_X + CONTACT_DISTANCE + 0.05) {
        this.playerX = START_X;
        this.rockX = START_X + CONTACT_DISTANCE;
        this.rockVelocity = 0;
        this.walkVelocity = 0;
        this.autoBrace = false;
        this.catchInputAxis = 0;
        this.catchMotion = null;
        if (this.returning) {
          this.cycles++;
          this.events.push('again');
        }
        this.returning = false;
        this.setPhase('ascent');
      }
    }
    this.playerVelocity = (this.playerX - previousPlayer) / dt;
    if (this.mode === 'brace' || this.mode === 'push') this.direction = 1;
    else if (Math.abs(this.playerVelocity) > .08) this.direction = Math.sign(this.playerVelocity);
    this.rockRotation -= (this.rockX - previousRock) / 1.6;
    this.effort = damp(this.effort, this.mode === 'push' ? 1 : this.mode === 'brace' ? 0.6 : 0, 3, dt);
  }

  rollDown(dt) {
    this.rockVelocity = Math.max(-26, this.rockVelocity - 8 * dt);
    this.rockX = Math.max(START_X + CONTACT_DISTANCE, this.rockX + this.rockVelocity * dt);
    if (this.rockX <= START_X + CONTACT_DISTANCE) this.rockVelocity = 0;
  }

  drainEvents() { return this.events.splice(0); }
}
