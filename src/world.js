import * as THREE from 'three';
import { metalMaterial, pbrMaterial, radialTexture } from './textures.js';

// Salon 216 x 156 m, duvarlar 30 m, kubbenin tepesi ~90 m
export const HALL = { minX: -108, maxX: 108, minZ: -78, maxZ: 78, wallH: 30 };
export const DOME = { y: 30, rx: 160, ry: 60, rz: 118 };

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

// Kubbe ve duvarları yansıtan karanlık ortam haritası (HDRI yüklenene kadar)
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
  glow(new THREE.Color(2.2, 2.6, 2.3), 30, 30, 0, 24, 0, 0, Math.PI / 2);
  glow(new THREE.Color(0.2, 1.2, 0.45), 100, 0.8, 0, -8, -49);
  glow(new THREE.Color(0.2, 1.2, 0.45), 100, 0.8, 0, -8, 49);
  glow(new THREE.Color(0.2, 1.2, 0.45), 0.8, 100, -49, -8, 0, Math.PI / 2, Math.PI / 2);
  glow(new THREE.Color(3.0, 1.2, 0.3), 14, 14, 20, 22, -25, 0, Math.PI / 2);
  glow(new THREE.Color(0.6, 0.9, 1.6), 20, 8, 49, 0, 20, -Math.PI / 2);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

export function buildWorld(scene) {
  const colliders = [];
  const M = {
    wall: pbrMaterial('rusty_metal_sheet', { repeat: [28, 4], metalness: 0.55, color: 0x82928a }),
    floor: pbrMaterial('metal_plate', { repeat: [77, 57], metalness: 0.6, color: 0xa8b0aa }),
    dome: pbrMaterial('rusty_metal_sheet', { repeat: [40, 9], metalness: 0.5, color: 0x9aa59e, side: THREE.BackSide }),
    pillar: metalMaterial({ cols: 1, rows: 4, color: [52, 58, 55], grime: 0.7, rust: 0.3, stripes: true, seed: 6, size: 256 }, { repeat: [1, 1], metalness: 0.65 }),
    rib: pbrMaterial('rusty_metal_02', { repeat: [16, 1], metalness: 0.7, color: 0x6a7068 }),
    pipe: metalMaterial({ cols: 1, rows: 1, color: [72, 64, 50], rivets: false, grime: 0.6, rust: 0.6, seed: 8, size: 256 }, { repeat: [40, 1], metalness: 0.6 }),
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
  const hangingLamp = (x, z, y, r) => {
    const top = domeHeight(x, z);
    cyl(0.08, 0.08, top - y, M.dark, x, (top + y) / 2, z, 5);
    cyl(r * 0.45, r * 1.15, r * 0.7, M.dark, x, y, z, 16);
    const face = new THREE.Mesh(new THREE.CircleGeometry(r, 18), M.lamp);
    face.rotation.x = Math.PI / 2;
    face.position.set(x, y - r * 0.36, z);
    scene.add(face);
  };

  // --- Zemin + su birikintileri + boya çizgileri
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(232, 172), M.floor);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  for (const [x, z, sx, sz, r] of [[-24, 34, 7, 4, 0.4], [32, -16, 5, 9, 1.1], [-62, -24, 9, 4, 2], [70, 18, 4, 6, 0.3], [8, -40, 6, 5, 0.8], [-10, 52, 11, 4, 0], [-86, 10, 6, 3, 0.6], [90, -40, 5, 7, 1.4]]) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(1, 20), M.puddle);
    p.rotation.set(-Math.PI / 2, 0, r);
    p.scale.set(sx, sz, 1);
    p.position.set(x, 0.015, z);
    scene.add(p);
  }
  for (const z of [3, 18]) box(150, 0.02, 0.4, M.paint, 0, 0.012, z);

  // --- Duvarlar, sütunlar, borular, ışık şeritleri
  const H = HALL.wallH;
  box(224, H, 2, M.wall, 0, H / 2, -80);
  box(224, H, 2, M.wall, 0, H / 2, 80);
  box(2, H, 164, M.wall, -110, H / 2, 0);
  box(2, H, 164, M.wall, 110, H / 2, 0);
  for (const y of [2.6, 14]) {
    const mat = y < 5 ? M.green : M.greenDim;
    box(216, 0.14, 0.2, mat, 0, y, -78.9);
    box(216, 0.14, 0.2, mat, 0, y, 78.9);
    box(0.2, 0.14, 156, mat, -108.9, y, 0);
    box(0.2, 0.14, 156, mat, 108.9, y, 0);
  }
  for (const [y, r] of [[4.6, 0.45], [5.7, 0.3], [6.5, 0.22]]) {
    for (const z of [-78.3, 78.3]) cyl(r, r, 214, M.pipe, 0, y, z, 10).rotation.z = Math.PI / 2;
    for (const x of [-108.3, 108.3]) cyl(r, r, 154, M.pipe, x, y, 0, 10).rotation.x = Math.PI / 2;
  }
  for (let x = -96; x <= 96; x += 16) {
    box(3, H, 3, M.pillar, x, H / 2, -77.8);
    box(3, H, 3, M.pillar, x, H / 2, 77.8);
    colliders.push({ x, z: -77.8, r: 2.1 }, { x, z: 77.8, r: 2.1 });
  }
  for (let z = -64; z <= 64; z += 16) {
    box(3, H, 3, M.pillar, -107.8, H / 2, z);
    box(3, H, 3, M.pillar, 107.8, H / 2, z);
    colliders.push({ x: -107.8, z, r: 2.1 }, { x: 107.8, z, r: 2.1 });
  }

  // --- Kubbe, taşıyıcı kemerler, halkalar, kablolar
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 22, 0, Math.PI * 2, 0, Math.PI / 2), M.dome);
  dome.scale.set(DOME.rx, DOME.ry, DOME.rz);
  dome.position.y = DOME.y;
  scene.add(dome);
  const ribs = 20;
  for (let k = 0; k < ribs; k++) {
    const a = (k / ribs) * Math.PI * 2;
    const pts = [];
    for (let i = 0; i <= 14; i++) pts.push(domePoint(a, i / 14 * 0.98, 1.6));
    tube(pts, 1.2, M.rib, 36);
  }
  for (const t of [0.1, 0.4, 0.7]) {
    const pts = [];
    for (let i = 0; i < 56; i++) pts.push(domePoint((i / 56) * Math.PI * 2, t, 1.6));
    const c = new THREE.CatmullRomCurve3(pts, true);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(c, 112, 0.8, 6, true), M.rib));
  }
  for (let k = 0; k < 12; k++) {
    const a = k * 0.83 + 0.3;
    const p1 = domePoint(a, 0.6, 2.5), p2 = domePoint(a + 0.3, 0.66, 2.5);
    const mid = p1.clone().lerp(p2, 0.5);
    mid.y -= 14 + (k % 3) * 6;
    tube([p1, mid, p2], 0.16, M.dark, 20);
  }

  // Kubbeden sarkan endüstriyel lambalar + küçük ışık hüzmeleri
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * 74, z = Math.sin(a) * 54;
    const y = domeHeight(x, z) - 14;
    hangingLamp(x, z, y, 1.3);
    shaft(scene, x, y - 0.5, z, 28, 1.2, 7, 0xbfe8cc, 0.06);
  }

  // Büyük salon ışıkları (gerçek ışık kaynakları) uzun kablolarla sarkar
  for (const [x, z] of [[-55, 6], [55, 6], [0, -38]]) {
    const y = 46;
    hangingLamp(x, z, y, 2.6);
    shaft(scene, x, y - 0.9, z, y - 1, 2.4, 22, 0xcff5dd, 0.055);
    const l = new THREE.PointLight(0xd6f5e2, 14000, 0, 2);
    l.position.set(x, y - 2, z);
    scene.add(l);
  }

  // --- Kuzey duvarında geçit (catwalk)
  box(210, 0.4, 4, M.wall, 0, 14, -75.5);
  box(210, 0.08, 0.08, M.dark, 0, 15.1, -73.6);
  box(210, 0.08, 0.08, M.dark, 0, 14.6, -73.6);
  for (let x = -102; x <= 102; x += 6) box(0.08, 1.1, 0.08, M.dark, x, 14.6, -73.6);

  // --- APU platformları
  const apuSpots = [];
  for (const x of [-60, -36, -12, 12, 36, 60]) {
    const z = 10 + Math.abs(x) * 0.08;
    cyl(3.8, 4.1, 0.3, M.wall, x, 0.15, z, 32);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.06, 6, 48), M.green);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.31, z);
    scene.add(ring);
    apuSpots.push(new THREE.Vector3(x, 0, z));
  }

  // Siperler ve kasalar
  for (const [x, z, w, rot] of [[-52, 26, 9, 0], [-26, 28, 7, 0.2], [0, 25, 9, 0], [26, 28, 7, -0.2], [52, 26, 9, 0], [-80, 34, 7, 1.2], [80, 34, 7, -1.2]]) {
    const s = box(w, 1.3, 1.1, M.crate, x, 0.65, z);
    s.rotation.y = rot;
    makeBlob(scene, w * 0.6, 0.5).position.set(x, 0.03, z);
    for (let k = -w / 2 + 1; k <= w / 2 - 1; k += 2) {
      colliders.push({ x: x + Math.cos(rot) * k, z: z - Math.sin(rot) * k, r: 1 });
    }
  }
  for (const [x, z, s, r] of [[-94, -14, 2.4, 0.3], [-91, -10, 2, 0.9], [94, -16, 2.6, 0.1], [88, 0, 2.2, 0.6], [-40, -48, 2.4, 0.4], [34, -54, 2.8, 0.2], [-6, 44, 2, 0.7], [64, 40, 2.4, 0.5], [-64, 46, 2.6, 0.1], [20, -22, 2.2, 0.3], [-24, -14, 2, 0.8]]) {
    const c = box(s, s, s, M.crate, x, s / 2, z);
    c.rotation.y = r;
    makeBlob(scene, s * 1.1, 0.6).position.set(x, 0.03, z);
    colliders.push({ x, z, r: s * 0.75 });
  }

  // --- Cephane deposu (sıcak ışıklı köşe)
  const depotPos = new THREE.Vector3(-85, 0, 62);
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
  for (const x of [-30, 10, 50]) {
    const zc = 64;
    const ship = new THREE.Mesh(new THREE.CapsuleGeometry(3.6, 15, 8, 20), M.hull);
    ship.rotation.x = Math.PI / 2;
    ship.scale.set(1.3, 1, 0.75);
    ship.position.set(x, 3.4, zc);
    scene.add(ship);
    box(9.6, 0.5, 6, M.hull, x, 5.4, zc + 2);
    const eng = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.22, 8, 24), M.blue);
    eng.position.set(x, 3.4, zc - 9.6);
    scene.add(eng);
    for (const s of [-1, 1]) {
      cyl(0.9, 0.9, 6, M.hull, x + s * 5.4, 2.6, zc - 3, 12).rotation.x = Math.PI / 2;
      const e = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), M.blue);
      e.position.set(x + s * 5.4, 2.6, zc - 6.1);
      e.rotation.y = Math.PI;
      scene.add(e);
    }
    box(12, 0.1, 24, M.greenDim, x, 0.02, zc);
    makeBlob(scene, 9, 0.8).position.set(x, 0.03, zc);
    for (let z = zc - 9; z <= zc + 9; z += 4.5) colliders.push({ x, z, r: 4.6 });
  }

  // --- Doğu kapısı: finalde kilidi vurulup açılır, Hammer buradan girer
  const door = box(1.2, 20, 26, M.hull, 109, 10, 42);
  box(1.4, 0.3, 27, M.blue, 108.7, 20.1, 42);
  box(1.4, 20, 0.3, M.blue, 108.7, 10, 29);
  box(1.4, 20, 0.3, M.blue, 108.7, 10, 55);
  for (let k = 0; k < 4; k++) box(1.3, 0.5, 26, M.dark, 108.9, 3 + k * 4.5, 42);
  // Kapının arkasındaki geçiş koridoru (Hammer buradan gelir)
  const corridorMat = M.wall.clone();
  corridorMat.side = THREE.BackSide;
  box(160, 22, 28, corridorMat, 190, 11, 42);
  for (let x = 120; x < 270; x += 12) {
    box(0.6, 0.3, 26, M.greenDim, x, 21.6, 42);
    box(8, 0.12, 0.25, M.green, x, 0.1, 30);
    box(8, 0.12, 0.25, M.green, x, 0.1, 54);
  }
  const lockMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.5, 0.15) });
  const lock = new THREE.Group();
  const lockBody = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 2.6), M.hull);
  const lockGlow = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.7), lockMat);
  const lockRing = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.12, 6, 20), lockMat);
  lockRing.rotation.y = Math.PI / 2;
  lockRing.position.x = -0.9;
  lock.add(lockBody, lockGlow, lockRing);
  lock.position.set(107.6, 8, 42);
  scene.add(lock);
  const gate = {
    lockPos: lock.position, lockHp: 450, lockMax: 450, lockAlive: true, opening: 0, isOpen: false,
    // Kilide isabet testi (ışın)
    rayHit(o, d, maxT) {
      if (!this.lockAlive) return null;
      const ox = this.lockPos.x - o.x, oy = this.lockPos.y - o.y, oz = this.lockPos.z - o.z;
      const t = ox * d.x + oy * d.y + oz * d.z;
      if (t < 0 || t > maxT) return null;
      const d2 = ox * ox + oy * oy + oz * oz - t * t;
      return d2 < 2.2 * 2.2 ? t - Math.sqrt(2.2 * 2.2 - d2) : null;
    },
    damage(a) {
      if (!this.lockAlive) return false;
      this.lockHp -= a;
      lockGlow.material.color.setRGB(2.6, 0.5 + Math.random(), 0.15);
      if (this.lockHp <= 0) {
        this.lockHp = 0;
        this.lockAlive = false;
        lock.visible = false;
        return true;
      }
      return false;
    },
    update(dt, time) {
      if (this.lockAlive) lockMat.color.setRGB(1.5 + Math.sin(time * 6) * 1.1, 0.4, 0.12);
      if (!this.lockAlive && this.opening < 1) {
        this.opening = Math.min(1, this.opening + dt / 6);
        door.position.y = 10 + this.opening * 19;
        if (this.opening >= 1) this.isOpen = true;
      }
    },
  };

  // --- Delme noktaları (kubbenin yüksek kısımlarında)
  const breaches = [[-55, -42], [0, -62], [58, -28], [-18, -8]].map(([x, z]) => {
    const y = domeHeight(x, z);
    const pos = new THREE.Vector3(x, y - 2, z);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(6, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.3), transparent: true, opacity: 0 }));
    glow.rotation.x = Math.PI / 2;
    glow.position.set(x, y - 0.6, z);
    scene.add(glow);
    const drill = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 11, 14), M.pipe);
    cone.rotation.x = Math.PI;
    drill.add(cone);
    for (let k = -2; k <= 2; k++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(4 * (0.5 - k * 0.11), 0.16, 4, 20), M.orange);
      band.rotation.x = Math.PI / 2;
      band.position.y = k * 2;
      drill.add(band);
    }
    drill.position.set(x, y + 11, z);
    scene.add(drill);
    const light = new THREE.PointLight(0xff8a30, 0, 0, 2);
    light.position.set(x, y - 6, z);
    scene.add(light);
    const beam = shaft(scene, x, y - 1, z, y - 2, 3.5, 18, 0xff9a40, 0);
    return { pos, glow, drill, light, beam, active: false, open: 0, homeY: y + 11 };
  });

  // --- Havada süzülen toz
  const DUST = 1200;
  const dPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dPos[i * 3] = (Math.random() - 0.5) * 210;
    dPos[i * 3 + 1] = Math.random() * 60;
    dPos[i * 3 + 2] = (Math.random() - 0.5) * 150;
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
    gate.update(dt, time);
    for (const b of breaches) {
      b.open = THREE.MathUtils.damp(b.open, b.active ? 1 : 0, 1.5, dt);
      b.drill.position.y = b.homeY - b.open * 14;
      b.drill.rotation.y += dt * (1 + b.open * 6);
      b.glow.visible = b.open > 0.02;
      b.glow.material.opacity = b.open * (0.75 + Math.sin(time * 9) * 0.15);
      b.light.intensity = b.open * (40000 + Math.sin(time * 13) * 8000 + Math.random() * 5000);
      b.beam.material.uniforms.uOpacity.value = b.open * (0.08 + Math.sin(time * 7) * 0.02);
    }
    for (let i = 0; i < DUST; i++) {
      const j = i * 3;
      dPos[j] += Math.sin(time * 0.2 + i) * 0.15 * dt;
      dPos[j + 1] += (Math.sin(time * 0.3 + i * 0.7) * 0.1 - 0.05) * dt;
      dPos[j + 2] += Math.cos(time * 0.25 + i) * 0.15 * dt;
      if (dPos[j + 1] < 0) dPos[j + 1] = 60;
    }
    dGeo.attributes.position.needsUpdate = true;
  };

  return { colliders, apuSpots, depotPos, breaches, gate, update };
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
