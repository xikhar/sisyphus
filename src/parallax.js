import * as THREE from 'three';
import { clamp, lerp } from './terrain.js';

function paintedPlane(texture, { saturation, contrast, fog, opacity = 1 }) {
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity, depthWrite: false });
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float luminance=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
      diffuseColor.rgb=mix(vec3(luminance),diffuseColor.rgb,${saturation.toFixed(3)});
      diffuseColor.rgb=(diffuseColor.rgb-vec3(.3))*${contrast.toFixed(3)}+vec3(.3);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.49,.60,.63),${fog.toFixed(3)});
    `);
  };
  // Each depth has a distinct shader program, even though the source map is shared.
  material.customProgramCacheKey = () => [saturation, contrast, fog].join('-');
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
}

export class ParallaxBackground {
  constructor(textures, reducedMotion) {
    this.reducedMotion = reducedMotion;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
    this.camera.position.z = 10;
    this.panorama = paintedPlane(textures.panorama, { saturation: 0.61, contrast: 0.79, fog: 0.22 });
    this.panorama.position.z = -6;
    this.scene.add(this.panorama);
    this.layers = [
      { factor: 0.013, scale: 2.8, baseY: -0.40, z: -4, saturation: 0.56, contrast: 0.70, fog: 0.47 },
      { factor: 0.035, scale: 3.2, baseY: -0.52, z: -2, saturation: 0.72, contrast: 0.85, fog: 0.24 },
    ].map(config => {
      const group = new THREE.Group();
      const tiles = [];
      for (let tile = -1; tile <= 3; tile++) {
        const mesh = paintedPlane(textures.ridge, config);
        mesh.userData.tile = tile;
        group.add(mesh); tiles.push(mesh);
      }
      group.position.z = config.z; this.scene.add(group);
      return { ...config, group, tiles, offset: 0 };
    });
    this.haze = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { time: { value: 0 }, reveal: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec2 vUv;uniform float time;uniform float reveal;
        void main(){
          float band=exp(-pow((vUv.y-.31+sin(vUv.x*5.+time*.009)*.05)*6.,2.));
          float wisps=.65+.35*sin(vUv.x*12.+sin(vUv.x*7.+time*.02)*2.+time*.025);
          gl_FragColor=vec4(.70,.79,.78,band*wisps*(.15-reveal*.08));
        }`
    }));
    this.haze.position.z = -0.5; this.scene.add(this.haze);
    this.birds = [];
    for (let i = 0; i < 6; i++) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.012, 0, 0), new THREE.Vector3(0, -.004, 0), new THREE.Vector3(.012, .002, 0)]);
      const bird = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x5e7173, transparent: true, opacity: .42 }));
      this.birds.push(bird); this.scene.add(bird);
    }
  }

  resize(aspect) {
    this.aspect = aspect;
    this.camera.left = -aspect; this.camera.right = aspect; this.camera.updateProjectionMatrix();
    this.panorama.scale.set(aspect * 2, 2, 1);
    this.haze.scale.set(aspect * 2, 2, 1);
  }

  update(cameraX, cameraY, reveal, elapsed) {
    const zoom = lerp(1.45, 1.01, reveal);
    let ru = 1 / zoom, rv = 1 / zoom;
    if (this.aspect > 1.5) rv *= 1.5 / this.aspect; else ru *= this.aspect / 1.5;
    const texture = this.panorama.material.map;
    texture.repeat.set(ru, rv);
    // Follow the camera, not the boulder: the view stays still when the rock falls.
    texture.offset.set((1 - ru) * clamp(.14 + cameraX / 390, .06, .94), (1 - rv) * clamp(.29 + cameraY / 390 + reveal * .15, .08, .94));
    this.layers.forEach((layer, i) => {
      const width = Math.max(this.aspect * layer.scale, 4.8);
      const height = width / (2048 / 768);
      layer.offset = -(cameraX - 7) * layer.factor;
      layer.group.position.x = layer.offset + (i ? .72 : -.48);
      layer.group.position.y = layer.baseY - cameraY * (i ? .0023 : .0015) - reveal * (.42 + i * .13);
      layer.tiles.forEach(mesh => {
        const tile = mesh.userData.tile;
        mesh.position.x = tile * width;
        mesh.scale.set(width * (Math.abs(tile % 2) ? -1 : 1), height, 1);
        mesh.material.side = THREE.DoubleSide;
        mesh.material.opacity = (i ? .86 : .74) * (1 - reveal * .87);
      });
    });
    const t = this.reducedMotion ? 0 : elapsed;
    this.haze.material.uniforms.time.value = t;
    this.haze.material.uniforms.reveal.value = reveal;
    this.birds.forEach((bird, i) => {
      bird.position.x = ((i * .08 + t * .005 + .65) % (this.aspect * 2 + .4)) - this.aspect - cameraX * .0004;
      bird.position.y = .45 + Math.sin(t * .08 + i) * .035 + i * .018;
      bird.scale.y = .55 + Math.sin(t * 3 + i * .7) * .75;
    });
  }
}
