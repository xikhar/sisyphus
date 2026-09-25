import * as THREE from 'three';
import { Sisyphus } from './character.js';
import { makeMountain } from './mountain.js';
import { ParallaxBackground } from './parallax.js';
import { heightAt, rockSupportAt, damp, lerp, ROCK_RADIUS } from './terrain.js';
import { GroundShadow } from './shadow.js';

function random(seed) { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }
function quad(texture, width, height, color = 0xffffff, opacity = 1) {
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, color, transparent: true, opacity, depthWrite: false }));
}

export class World {
  constructor(canvas, textures, reducedMotion = false) {
    this.reducedMotion = reducedMotion;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-20, 20, 12, -12, 0.1, 200);
    this.camera.position.set(1.8, 9.8, 60);
    this.viewHeight = 25;
    this.reveal = 0;
    this.elapsed = 0;
    this.textures = textures;

    this.atmosphere = new ParallaxBackground(textures, reducedMotion);
    makeMountain(this.scene, textures.limestone);
    this.character = new Sisyphus(textures);
    this.scene.add(this.character.group);
    this.boulder = quad(textures.boulder, ROCK_RADIUS * 2.04, ROCK_RADIUS * 2.04, 0xe8dcc6);
    this.boulder.position.z = 5;
    this.boulder.renderOrder = 32;
    this.scene.add(this.boulder);
    this.rockShadow = new GroundShadow();
    this.scene.add(this.rockShadow);
    this.footShadow = new GroundShadow();
    this.scene.add(this.footShadow);
    this.makeParticles();
    this.resize();
  }

  makeParticles() {
    const count = 90;
    this.particleArray = new Float32Array(count * 3);
    this.particleGeo = new THREE.BufferGeometry();
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particleArray, 3));
    const mat = new THREE.PointsMaterial({ color: 0xf2deb0, size: 0.025, transparent: true, opacity: 0.42, depthWrite: false });
    this.particles = new THREE.Points(this.particleGeo, mat); this.particles.renderOrder = 50;
    this.scene.add(this.particles);
    const dustGeo = new THREE.BufferGeometry();
    this.dustArray = new Float32Array(26 * 3); dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustArray, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xd2bc8f, size: 0.07, transparent: true, opacity: 0, depthWrite: false }));
    this.dust.renderOrder = 51; this.scene.add(this.dust);
  }

  resize() {
    this.width = window.innerWidth; this.height = window.innerHeight; this.aspect = this.width / this.height;
    this.renderer.setSize(this.width, this.height);
    this.atmosphere.resize(this.aspect);
  }

  update(state, dt, elapsed) {
    this.elapsed = elapsed;
    const teleported = this.teleportRevision !== undefined && this.teleportRevision !== state.teleportRevision;
    this.teleportRevision = state.teleportRevision;
    const cameraDt = teleported ? 100 : dt;
    const atSummit = state.phase === 'summit';
    this.reveal = damp(this.reveal, atSummit ? 1 : 0, atSummit ? 0.34 : 1.2, cameraDt);
    const isMobile = this.aspect < 0.85;
    const normalHeight = isMobile ? 21 : 22;
    this.viewHeight = damp(this.viewHeight, lerp(normalHeight, isMobile ? 41 : 39, this.reveal), 1.8, cameraDt);
    let cx = state.playerX + (isMobile ? 1.9 : 4.5);
    let cy = heightAt(state.playerX) + 5.5;
    if (atSummit) { cx = lerp(cx, state.playerX - (isMobile ? 1 : 8), this.reveal); cy = lerp(cy, heightAt(state.playerX) + 12, this.reveal); }
    this.camera.position.x = damp(this.camera.position.x, cx, 3.2, cameraDt);
    this.camera.position.y = damp(this.camera.position.y, cy, 3.2, cameraDt);
    this.camera.left = -this.viewHeight * this.aspect / 2; this.camera.right = -this.camera.left;
    this.camera.top = this.viewHeight / 2; this.camera.bottom = -this.camera.top; this.camera.updateProjectionMatrix();

    this.atmosphere.update(this.camera.position.x, this.camera.position.y, this.reveal, elapsed);

    this.character.update(state, dt, elapsed);
    const support = rockSupportAt(state.rockX);
    this.boulder.position.set(state.rockX, support.y, 5);
    this.boulder.rotation.z = state.rockRotation;
    this.rockShadow.update(support.contactX, 1.35, .22, .38);
    const groundX = this.character.group.position.x;
    const footHeight = Math.min(...this.character.pose.feet.map(foot => foot.position.y));
    const clearance = Math.max(0, footHeight - heightAt(groundX) - .15);
    this.footShadow.update(groundX, .62 + clearance * .06, .14, .3 / (1 + clearance * .25));

    const w = this.viewHeight * this.aspect;
    for (let i = 0; i < this.particleArray.length / 3; i++) {
      const t = this.reducedMotion ? 0 : elapsed;
      this.particleArray[i * 3] = this.camera.position.x - w / 2 + ((random(i * 7) * w + t * (0.15 + random(i + 7) * 0.2)) % w);
      this.particleArray[i * 3 + 1] = this.camera.position.y - this.viewHeight / 2 + random(i + 200) * this.viewHeight + Math.sin(t * 0.2 + i) * 0.3;
      this.particleArray[i * 3 + 2] = 9;
    }
    this.particleGeo.attributes.position.needsUpdate = true;
    this.dust.material.opacity = this.reducedMotion ? 0 : Math.min(0.45, Math.abs(state.rockVelocity) * 0.15);
    for (let i = 0; i < 26; i++) {
      const age = (elapsed * 0.7 + random(i + 666)) % 1;
      this.dustArray[i * 3] = state.rockX - age * 1.8 + random(i) * 0.3;
      this.dustArray[i * 3 + 1] = heightAt(state.rockX) + age * (0.5 + random(i + 4)) - age * age * 0.4;
      this.dustArray[i * 3 + 2] = 7;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.renderer.clear();
    this.renderer.render(this.atmosphere.scene, this.atmosphere.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }

}

export async function loadTextures() {
  const loader = new THREE.TextureLoader();
  const urls = { panorama: 'panorama.webp', ridge: 'forest-ridge.webp', limestone: 'limestone.webp' };
  for (const name of ['head', 'torso', 'cloth', 'upper-arm', 'forearm', 'thigh', 'shin', 'foot', 'boulder']) urls[name] = `sisyphus/${name}.png`;
  const textures = {};
  await Promise.all(Object.entries(urls).map(async ([name, url]) => {
    const tex = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/${url}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    textures[name] = tex;
  }));
  return textures;
}
