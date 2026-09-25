import * as THREE from 'three';
import { heightAt, LOOKOUT_X } from './terrain.js';

const rand = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function makeMountain(scene, texture) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  const positions = [], uvs = [], colors = [], depths = [], indices = [];
  const strata = [0, 0.25, 0.8, 1.65, 2.9, 4.7, 7.3, 11, 17, 26, 40, 65, 105, 185];
  const start = -70, end = LOOKOUT_X + 65, columns = Math.ceil((end - start) / 0.55);
  for (let col = 0; col <= columns; col++) {
    const x = start + col * (end - start) / columns;
    for (let row = 0; row < strata.length; row++) {
      const depth = strata[row] * (1 + (rand(col * 11 + row * 17) - 0.5) * (row ? 0.2 : 0));
      const px = x + (row ? (rand(col * 7 + row) - 0.5) * 0.42 : 0);
      const py = heightAt(x) - depth;
      positions.push(px, py, 1);
      depths.push(depth);
      uvs.push(px / 13, py / 13);
      const variation = 0.77 + rand(Math.floor(col / 3) * 19 + row * 71) * 0.28;
      colors.push(variation, variation * 0.985, variation * 0.91);
    }
  }
  for (let col = 0; col < columns; col++) for (let row = 0; row < strata.length - 1; row++) {
    const a = col * strata.length + row, b = a + strata.length;
    if ((col + row) % 2) indices.push(a, a + 1, b, b, a + 1, b + 1);
    else indices.push(a, a + 1, b + 1, a, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('rockDepth', new THREE.Float32BufferAttribute(depths, 1));
  geo.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({ map: texture, color: 0xbac1b4, vertexColors: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float rockDepth; varying vec2 cliffPosition; varying float cliffDepth;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncliffPosition = position.xy; cliffDepth = rockDepth;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 cliffPosition;
      varying float cliffDepth;
      float cliffHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float cliffNoise(vec2 p) {
        vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(cliffHash(i),cliffHash(i+vec2(1.,0.)),f.x),mix(cliffHash(i+vec2(0.,1.)),cliffHash(i+vec2(1.)),f.x),f.y);
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec2 p=cliffPosition;
      float broad=cliffNoise(p*.16);
      float detail=cliffNoise(p*.7)+cliffNoise(p*2.1)*.3;
      vec2 warp=vec2(broad*.13, cliffNoise(p*.09+13.)*.19);
      vec3 a=texture2D(map,p/13.+warp).rgb;
      vec3 b=texture2D(map,mat2(.94,-.34,.34,.94)*p/7.3+vec2(.37,.61)).rgb;
      vec3 stone=mix(a,b,.25+cliffNoise(p*.3)*.3);
      stone=mix(vec3(dot(stone,vec3(.2126,.7152,.0722))),stone,.66);
      float bedding=abs(sin(p.y*1.4+p.x*.21+detail*1.7));
      float seams=mix(.61,1.,smoothstep(.012,.10,bedding));
      float fissure=abs(sin(p.x*.91-p.y*.36+cliffNoise(p*.24)*3.));
      seams*=mix(.74,1.,smoothstep(.018,.09,fissure));
      float shade=mix(1.20,.59,smoothstep(.3,27.,cliffDepth));
      shade*=.78+broad*.46;
      float earth=(1.-smoothstep(.08,.85,cliffDepth))*(.6+detail*.2);
      stone*=mix(vec3(1.),vec3(1.24,1.13,.87),earth);
      diffuseColor.rgb*=stone*seams*shade;
    `);
  };
  scene.add(new THREE.Mesh(geo, material));

  // Broken ledges have their own lit facets, occlusion, and irregular silhouettes.
  const rocks = { vertices: [], uvs: [], colors: [] };
  function shard(x, y, width, height, seed, edge = false) {
    const sides = 5 + Math.floor(rand(seed + 391) * 4);
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const angle = (j + (rand(seed + j * 7) - .5) * .45) / sides * Math.PI * 2 + rand(seed + 902) * .4;
      const radius = 0.7 + rand(seed + j * 13) * 0.3;
      const px = x + Math.cos(angle) * width * radius;
      let py = y + Math.sin(angle) * height * radius;
      if (!edge) py = Math.min(py, heightAt(px) - 0.10);
      ring.push([px, py]);
    }
    for (let j = 0; j < sides; j++) {
      const a = ring[j], b = ring[(j + 1) % sides];
      const center = [x + width * 0.16, y + height * 0.14];
      const light = j < sides / 2 ? 0.93 + rand(seed + j) * 0.16 : 0.62 + rand(seed + j) * 0.18;
      const color = new THREE.Color(0xbcc0b7).multiplyScalar(light);
      for (const [px, py] of [center, a, b]) {
        rocks.vertices.push(px, py, edge ? 2.8 : 2);
        rocks.uvs.push(px / 6.5 + rand(seed) * 4, py / 6.5);
        rocks.colors.push(color.r, color.g, color.b);
      }
    }
  }
  for (let i = 0; i < 280; i++) {
    const x = -45 + rand(i * 13) * 360;
    const size = 0.25 + Math.pow(rand(i + 234), 4) * 2.2;
    const depth = 0.25 + Math.pow(rand(i + 913), 1.4) * 13;
    shard(x, heightAt(x) - depth - size * 0.5, size * (1 + rand(i + 89) * .8), size * (0.35 + rand(i + 19) * 0.65), i * 101);
  }
  for (let i = 0; i < 1350; i++) {
    const x = -50 + rand(i * 7 + 542) * 365;
    const size = 0.025 + Math.pow(rand(i + 773), 2) * 0.20;
    shard(x, heightAt(x) - 0.055 - rand(i + 312) * 0.09, size, size * 0.55, i * 71 + 302, true);
  }
  const rockGeo = new THREE.BufferGeometry();
  rockGeo.setAttribute('position', new THREE.Float32BufferAttribute(rocks.vertices, 3));
  rockGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rocks.uvs, 2));
  rockGeo.setAttribute('color', new THREE.Float32BufferAttribute(rocks.colors, 3));
  scene.add(new THREE.Mesh(rockGeo, new THREE.MeshBasicMaterial({ map: texture, vertexColors: true })));

  const grass = [], grassColors = [];
  for (let i = 0; i < 390; i++) {
    const x = -40 + rand(i * 31) * 340;
    if (Math.sin(x * 0.51) < -0.05) continue;
    const y = heightAt(x), h = 0.08 + rand(i + 53) * 0.32;
    const color = new THREE.Color(i % 3 ? 0x858e66 : 0xc0ac77);
    for (let j = 0; j < 4; j++) {
      grass.push(x, y - 0.06, 2.7, x + (j - 1.7) * 0.075, y + h * (0.5 + rand(j + i * 7) * 0.5), 2.7);
      grassColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
  }
  const grassGeo = new THREE.BufferGeometry();
  grassGeo.setAttribute('position', new THREE.Float32BufferAttribute(grass, 3));
  grassGeo.setAttribute('color', new THREE.Float32BufferAttribute(grassColors, 3));
  scene.add(new THREE.LineSegments(grassGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 })));
}
