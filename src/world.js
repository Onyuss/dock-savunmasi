import * as THREE from 'three';
import { metalMaterial, pbrMaterial, radialTexture } from './textures.js';

export const HALL = { minX: -78, maxX: 78, minZ: -58, maxZ: 58, wallH: 26 };
export const DOME = { y: 26, rx: 115, ry: 36, rz: 88 };

export function domeHeight(x, z) {
  const k = 1 - (x * x) / (DOME.rx * DOME.rx) - (z * z) / (DOME.rz * DOME.rz);
  return DOME.y + DOME.ry * Math.sqrt(Math.max(0, k));
}

// Kubbe yüzeyinde (açı, yükseklik oranı) → nokta
function domePoint(a, t, inset = 0) {
  const r = Math.cos(t * Math.PI / 2), h = Math.sin(t * Math.PI / 2);
  return new THREE.Vector3(Math.cos(a) * r * (DOME.rx - inset), DOME.y + h * (DOME.ry - inset), Math.sin(a) * r * (DOME.rz - inset));
}

let blobTex = null;
// Nesnelerin altına yumuşak temas gölgesi
export function makeBlob(scene, r, opacity = 0.75) {
  blobTex ||= radialTexture('rgba(0,0,0,1)', 'rgba(0,0,0,0)');
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({
    map: blobTex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.renderOrder = 1;
  scene.add(m);
  return m;
}

// Yukarıdan aşağı inen hacimsel ışık hüzmesi (sahte, ucuz)
function shaftMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: `
      varying vec2 vUv; varying float vFacing;
      void main() {
        vUv = uv;
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vUv; varying float vFacing;
      void main() {
        float a = pow(vUv.y, 1.6) * pow(vFacing, 2.5) * uOpacity;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
function shaft(scene, x, yTop, z, height, rTop, rBottom, color, opacity) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, height, 24, 1, true), shaftMaterial(color, opacity));
  m.position.set(x, yTop - height / 2, z);
  scene.add(m);
  return m;
}

// Kubbe ve duvarları yansıtan karanlık ortam haritası (metallerin yansıması için)
export function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x030504);
  const room = new THREE.Mesh(new THREE.BoxGeometry(100, 50, 100), new THREE.MeshBasicMaterial({ color: 0x0b120e, side: THREE.BackSide }));
  env.add(room);
  const glow = (color, w, h, x, y, z, ry = 0, rx = 0) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    p.position.set(x, y, z);
    p.rotation.set(rx, ry, 0);
    env.add(p);
  };
  glow(new THREE.Color(2.2, 2.6, 2.3), 30, 30, 0, 24, 0, 0, Math.PI / 2);        // tavan lambaları
  glow(new THREE.Color(0.2, 1.2, 0.45), 100, 0.8, 0, -8, -49);                  // yeşil şeritler
  glow(new THREE.Color(0.2, 1.2, 0.45), 100, 0.8, 0, -8, 49);
  glow(new THREE.Color(0.2, 1.2, 0.45), 0.8, 100, -49, -8, 0, Math.PI / 2, Math.PI / 2);
  glow(new THREE.Color(3.0, 1.2, 0.3), 14, 14, 20, 22, -25, 0, Math.PI / 2);   // delik ışığı
  glow(new THREE.Color(0.6, 0.9, 1.6), 20, 8, 49, 0, 20, -Math.PI / 2);         // kapı
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

export function buildWorld(scene) {
  const colliders = [];
  const M = {
    wall: pbrMaterial('rusty_metal_sheet', { repeat: [20, 3.2], metalness: 0.55, color: 0x82928a }),
    floor: pbrMaterial('metal_plate', { repeat: [57, 43], metalness: 0.6, color: 0xa8b0aa }),
    dome: pbrMaterial('rusty_metal_sheet', { repeat: [30, 6], metalness: 0.5, color: 0x9aa59e, side: THREE.BackSide }),
    pillar: metalMaterial({ cols: 1, rows: 4, color: [52, 58, 55], grime: 0.7, rust: 0.3, stripes: true, seed: 6, size: 256 }, { repeat: [1, 1], metalness: 0.65 }),
    rib: pbrMaterial('rusty_metal_02', { repeat: [12, 1], metalness: 0.7, color: 0x6a7068 }),
    pipe: metalMaterial({ cols: 1, rows: 1, color: [72, 64, 50], rivets: false, grime: 0.6, rust: 0.6, seed: 8, size: 256 }, { repeat: [30, 1], metalness: 0.6 }),
    crate: metalMaterial({ cols: 1, rows: 2, color: [70, 76, 60], grime: 0.6, rust: 0.3, stripes: true, seed: 9, size: 256 }, { repeat: [1, 1], metalness: 0.5 }),
    hull: metalMaterial({ cols: 4, rows: 2, color: [58, 62, 60], grime: 0.5, rust: 0.3, seed: 10 }, { repeat: [3, 2], metalness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15191a, roughness: 0.7, metalness: 0.6 }),
    green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 0.8) }),
    greenDim: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.5, 0.18) }),
    orange: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.0, 0.25) }),
    blue: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.1, 2.4) }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 3.3, 3.0) }),
    paint: new THREE.MeshStandardMaterial({ color: 0x8a7a2a, roughness: 0.8, metalness: 0.1 }),
    puddle: new THREE.MeshStandardMaterial({ color: 0x2a332e, roughness: 0.06, metalness: 0.7, transparent: true, opacity: 0.45, depthWrite: false }),
  };

  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  const cyl = (rt, rb, h, mat, x, y, z, seg = 12) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  const tube = (points, r, mat, seg = 24) => {
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), seg, r, 8), mat);
    scene.add(m);
    return m;
  };

  // --- Zemin + su birikintileri + boya çizgileri
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(170, 130), M.floor);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  for (const [x, z, sx, sz, r] of [[-18, 26, 6, 3.5, 0.4], [24, -12, 4, 7, 1.1], [-46, -18, 7, 3, 2], [52, 14, 3, 5, 0.3], [6, -30, 5, 4, 0.8], [-8, 40, 9, 3, 0]]) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(1, 20), M.puddle);
    p.rotation.set(-Math.PI / 2, 0, r);
    p.scale.set(sx, sz, 1);
    p.position.set(x, 0.015, z);
    scene.add(p);
  }
  for (const z of [1.5, 14]) box(116, 0.02, 0.35, M.paint, 0, 0.012, z);

  // --- Duvarlar, sütunlar, borular, ışık şeritleri
  const H = HALL.wallH;
  box(164, H, 2, M.wall, 0, H / 2, -60);
  box(164, H, 2, M.wall, 0, H / 2, 60);
  box(2, H, 124, M.wall, -80, H / 2, 0);
  box(2, H, 124, M.wall, 80, H / 2, 0);
  for (const y of [2.6, 12.5]) {
    const mat = y < 5 ? M.green : M.greenDim;
    box(158, 0.14, 0.2, mat, 0, y, -58.9);
    box(158, 0.14, 0.2, mat, 0, y, 58.9);
    box(0.2, 0.14, 118, mat, -78.9, y, 0);
    box(0.2, 0.14, 118, mat, 78.9, y, 0);
  }
  for (const [y, r] of [[4.6, 0.42], [5.6, 0.28], [6.3, 0.2]]) {
    for (const z of [-58.3, 58.3]) {
      const p = cyl(r, r, 156, M.pipe, 0, y, z, 10);
      p.rotation.z = Math.PI / 2;
    }
    for (const x of [-78.3, 78.3]) {
      const p = cyl(r, r, 116, M.pipe, x, y, 0, 10);
      p.rotation.x = Math.PI / 2;
    }
  }
  for (let x = -72; x <= 72; x += 16) {
    box(2.8, H, 2.8, M.pillar, x, H / 2, -57.8);
    box(2.8, H, 2.8, M.pillar, x, H / 2, 57.8);
    colliders.push({ x, z: -57.8, r: 2 }, { x, z: 57.8, r: 2 });
  }
  for (let z = -48; z <= 48; z += 16) {
    box(2.8, H, 2.8, M.pillar, -77.8, H / 2, z);
    box(2.8, H, 2.8, M.pillar, 77.8, H / 2, z);
  }

  // --- Kubbe, taşıyıcı kemerler, halkalar, kablolar
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 18, 0, Math.PI * 2, 0, Math.PI / 2), M.dome);
  dome.scale.set(DOME.rx, DOME.ry, DOME.rz);
  dome.position.y = DOME.y;
  scene.add(dome);
  const ribs = 16;
  for (let k = 0; k < ribs; k++) {
    const a = (k / ribs) * Math.PI * 2;
    const pts = [];
    for (let i = 0; i <= 12; i++) pts.push(domePoint(a, i / 12 * 0.98, 1.2));
    tube(pts, 0.9, M.rib, 30);
  }
  for (const t of [0.12, 0.45, 0.75]) {
    const pts = [];
    for (let i = 0; i < 48; i++) pts.push(domePoint((i / 48) * Math.PI * 2, t, 1.2));
    const c = new THREE.CatmullRomCurve3(pts, true);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(c, 96, 0.6, 6, true), M.rib));
  }
  for (let k = 0; k < 9; k++) {
    const a = k * 0.83 + 0.3;
    const p1 = domePoint(a, 0.62, 2), p2 = domePoint(a + 0.35, 0.68, 2);
    const mid = p1.clone().lerp(p2, 0.5);
    mid.y -= 9 + (k % 3) * 4;
    tube([p1, mid, p2], 0.13, M.dark, 20);
  }

  // Kubbeden sarkan endüstriyel lambalar + küçük ışık hüzmeleri
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * 52, z = Math.sin(a) * 38;
    const top = domeHeight(x, z);
    const y = top - 8;
    cyl(0.06, 0.06, 8, M.dark, x, y + 4, z, 5);
    cyl(0.5, 1.4, 1.0, M.dark, x, y, z, 14);
    const face = new THREE.Mesh(new THREE.CircleGeometry(1.2, 16), M.lamp);
    face.rotation.x = Math.PI / 2;
    face.position.set(x, y - 0.52, z);
    scene.add(face);
    shaft(scene, x, y - 0.5, z, 22, 1.1, 6, 0xbfe8cc, 0.07);
  }

  // Büyük salon ışıkları (gerçek ışık kaynakları) ve geniş hüzmeler
  const hallLights = [];
  for (const [x, z] of [[-36, 4], [36, 4], [0, -26]]) {
    const y = domeHeight(x, z) - 6;
    cyl(1.2, 2.6, 1.6, M.dark, x, y, z, 16);
    const face = new THREE.Mesh(new THREE.CircleGeometry(2.3, 20), M.lamp);
    face.rotation.x = Math.PI / 2;
    face.position.set(x, y - 0.82, z);
    scene.add(face);
    cyl(0.08, 0.08, 6, M.dark, x, y + 3.5, z, 5);
    shaft(scene, x, y - 0.8, z, y - 1, 2.2, 16, 0xcff5dd, 0.06);
    const l = new THREE.PointLight(0xd6f5e2, 9000, 0, 2);
    l.position.set(x, y - 2, z);
    scene.add(l);
    hallLights.push(l);
  }

  // --- Kuzey duvarında geçit (catwalk)
  box(150, 0.4, 4, M.wall, 0, 12, -55.5);
  box(150, 0.08, 0.08, M.dark, 0, 13.1, -53.6);
  box(150, 0.08, 0.08, M.dark, 0, 12.6, -53.6);
  for (let x = -72; x <= 72; x += 6) box(0.08, 1.1, 0.08, M.dark, x, 12.6, -53.6);

  // --- APU platformları
  const apuSpots = [];
  for (const x of [-50, -30, -10, 10, 30, 50]) {
    const z = 6 + Math.abs(x) * 0.08;
    cyl(3.4, 3.7, 0.3, M.wall, x, 0.15, z, 32);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.06, 6, 48), M.green);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.31, z);
    scene.add(ring);
    apuSpots.push(new THREE.Vector3(x, 0, z));
  }

  // Siperler ve kasalar
  for (const [x, z, w, rot] of [[-40, 18, 8, 0], [-20, 20, 6, 0.2], [0, 18, 8, 0], [20, 20, 6, -0.2], [40, 18, 8, 0], [-60, 25, 6, 1.2], [60, 25, 6, -1.2]]) {
    const s = box(w, 1.3, 1.1, M.crate, x, 0.65, z);
    s.rotation.y = rot;
    makeBlob(scene, w * 0.6, 0.5).position.set(x, 0.03, z);
    for (let k = -w / 2 + 1; k <= w / 2 - 1; k += 2) {
      colliders.push({ x: x + Math.cos(rot) * k, z: z - Math.sin(rot) * k, r: 1 });
    }
  }
  for (const [x, z, s, r] of [[-70, -10, 2.2, 0.3], [-67.6, -7.5, 1.8, 0.9], [70, -12, 2.4, 0.1], [66, 0, 2, 0.6], [-30, -35, 2.2, 0.4], [25, -40, 2.6, 0.2], [-5, 32, 1.8, 0.7], [48, 30, 2.2, 0.5], [-48, 34, 2.4, 0.1]]) {
    const c = box(s, s, s, M.crate, x, s / 2, z);
    c.rotation.y = r;
    makeBlob(scene, s * 1.1, 0.6).position.set(x, 0.03, z);
    colliders.push({ x, z, r: s * 0.75 });
  }

  // --- Cephane deposu (sıcak ışıklı köşe)
  const depotPos = new THREE.Vector3(-62, 0, 46);
  for (let i = 0; i < 6; i++) {
    const b = box(2.4, 1.4, 1.6, M.crate, depotPos.x - 3 + (i % 3) * 2.6, 0.7 + Math.floor(i / 3) * 1.45, depotPos.z);
    b.rotation.y = (i % 2) * 0.05;
  }
  makeBlob(scene, 6, 0.6).position.set(depotPos.x, 0.03, depotPos.z);
  colliders.push({ x: depotPos.x, z: depotPos.z, r: 4 });
  const depotLight = new THREE.PointLight(0xffa860, 600, 0, 2);
  depotLight.position.set(depotPos.x, 7, depotPos.z - 3);
  scene.add(depotLight);
  cyl(0.4, 0.7, 0.5, M.dark, depotPos.x, 7.4, depotPos.z - 3, 10);

  // --- Gemi rıhtımları
  for (const x of [-22, 8, 38]) {
    const ship = new THREE.Mesh(new THREE.CapsuleGeometry(3.6, 15, 8, 20), M.hull);
    ship.rotation.x = Math.PI / 2;
    ship.scale.set(1.3, 1, 0.75);
    ship.position.set(x, 3.4, 47);
    scene.add(ship);
    box(9.6, 0.5, 6, M.hull, x, 5.4, 49);
    const eng = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.22, 8, 24), M.blue);
    eng.position.set(x, 3.4, 37.4);
    scene.add(eng);
    for (const s of [-1, 1]) {
      const pod = cyl(0.9, 0.9, 6, M.hull, x + s * 5.4, 2.6, 44, 12);
      pod.rotation.x = Math.PI / 2;
      const e = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), M.blue);
      e.position.set(x + s * 5.4, 2.6, 40.9);
      e.rotation.y = Math.PI;
      scene.add(e);
    }
    makeBlob(scene, 9, 0.8).position.set(x, 0.03, 47);
    for (let z = 38; z <= 56; z += 4.5) colliders.push({ x, z, r: 4.6 });
  }

  // --- Doğu kapısı
  box(1, 18, 22, M.hull, 79, 9, 32);
  box(1.2, 0.3, 23, M.blue, 78.8, 18.1, 32);
  box(1.2, 18, 0.3, M.blue, 78.8, 9, 20.8);
  box(1.2, 18, 0.3, M.blue, 78.8, 9, 43.2);

  // --- Delme noktaları
  const breaches = [[-35, -30], [0, -42], [38, -18]].map(([x, z]) => {
    const y = domeHeight(x, z);
    const pos = new THREE.Vector3(x, y - 2, z);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(5, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.3), transparent: true, opacity: 0 }));
    glow.rotation.x = Math.PI / 2;
    glow.position.set(x, y - 0.5, z);
    scene.add(glow);
    const drill = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.4, 9, 14), M.pipe);
    cone.rotation.x = Math.PI;
    drill.add(cone);
    for (let k = -2; k <= 2; k++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(3.4 * (0.5 - k * 0.11), 0.14, 4, 20), M.orange);
      band.rotation.x = Math.PI / 2;
      band.position.y = k * 1.6;
      drill.add(band);
    }
    drill.position.set(x, y + 9, z);
    scene.add(drill);
    const light = new THREE.PointLight(0xff8a30, 0, 0, 2);
    light.position.set(x, y - 5, z);
    scene.add(light);
    const beam = shaft(scene, x, y - 1, z, y - 2, 3, 14, 0xff9a40, 0);
    return { pos, glow, drill, light, beam, active: false, open: 0, homeY: y + 9 };
  });

  // --- Havada süzülen toz
  const DUST = 900;
  const dPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dPos[i * 3] = (Math.random() - 0.5) * 150;
    dPos[i * 3 + 1] = Math.random() * 40;
    dPos[i * 3 + 2] = (Math.random() - 0.5) * 110;
  }
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage));
  const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({
    size: 0.09, color: 0x9fbfaa, transparent: true, opacity: 0.55, depthWrite: false,
    blending: THREE.AdditiveBlending, map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
  }));
  dust.frustumCulled = false;
  scene.add(dust);

  const update = (dt, time) => {
    for (const b of breaches) {
      b.open = THREE.MathUtils.damp(b.open, b.active ? 1 : 0, 1.5, dt);
      b.drill.position.y = b.homeY - b.open * 12;
      b.drill.rotation.y += dt * (1 + b.open * 6);
      b.glow.visible = b.open > 0.02;
      b.glow.material.opacity = b.open * (0.75 + Math.sin(time * 9) * 0.15);
      b.light.intensity = b.open * (14000 + Math.sin(time * 13) * 3000 + Math.random() * 2000);
      b.beam.material.uniforms.uOpacity.value = b.open * (0.09 + Math.sin(time * 7) * 0.02);
    }
    for (let i = 0; i < DUST; i++) {
      const j = i * 3;
      dPos[j] += Math.sin(time * 0.2 + i) * 0.15 * dt;
      dPos[j + 1] += (Math.sin(time * 0.3 + i * 0.7) * 0.1 - 0.05) * dt;
      dPos[j + 2] += Math.cos(time * 0.25 + i) * 0.15 * dt;
      if (dPos[j + 1] < 0) dPos[j + 1] = 40;
    }
    dGeo.attributes.position.needsUpdate = true;
  };

  return { colliders, apuSpots, depotPos, breaches, update };
}

// Daire çarpıştırıcılardan ve salon sınırından itme
export function collide(pos, radius, colliders) {
  for (const c of colliders) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const min = radius + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      pos.x = c.x + (dx / d) * min;
      pos.z = c.z + (dz / d) * min;
    }
  }
  pos.x = THREE.MathUtils.clamp(pos.x, HALL.minX + radius, HALL.maxX - radius);
  pos.z = THREE.MathUtils.clamp(pos.z, HALL.minZ + radius, HALL.maxZ - radius);
}
