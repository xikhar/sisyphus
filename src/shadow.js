import * as THREE from 'three';
import { heightAt } from './terrain.js';

// A soft strip draped just inside the mountain silhouette. Every vertex follows
// the terrain; rotating a flat ellipse would leave its ends hovering on bumps.
export class GroundShadow extends THREE.Mesh {
  constructor() {
    const segments = 40;
    const geometry = new THREE.PlaneGeometry(2, 1, segments, 1);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { opacity: { value: .3 } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float opacity;
        void main() {
          float edge = pow(max(0.0, sin(vUv.x * 3.14159265)), 1.6);
          float falloff = smoothstep(0.0, 0.85, vUv.y);
          gl_FragColor = vec4(0.075, 0.085, 0.06, opacity * edge * falloff);
        }`,
    });
    super(geometry, material);
    this.renderOrder = 20;
    this.frustumCulled = false;
  }

  update(x, radius, depth, opacity) {
    const y = heightAt(x);
    this.position.set(x, y, 3);
    const positions = this.geometry.attributes.position, uv = this.geometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) {
      const dx = (uv.getX(i) * 2 - 1) * radius;
      positions.setXYZ(i, dx, heightAt(x + dx) - y - .008 - (1 - uv.getY(i)) * depth, 0);
    }
    positions.needsUpdate = true;
    this.material.uniforms.opacity.value = opacity;
  }
}
