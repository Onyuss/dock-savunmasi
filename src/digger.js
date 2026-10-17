import * as THREE from 'three';
import { metalMaterial, pbrMaterial, radialTexture } from './textures.js';
import { sfx } from './audio.js';

// Kazıcı (boss) ve Dock'un altındaki alt kat.
// Kazıcı tavanı delip iner, sentinel saçar, zemini delip alt kata geçer.
// Alt kat, tünel gibi uzakta (x = -3000) kurulur; delikten atlayan APU oraya iner.

export const LOWER = new THREE.Vector3(-3000, 0, 0);
export const LOWER_BOUNDS = { minX: LOWER.x - 64, maxX: LOWER.x + 64, minZ: -64, maxZ: 64 };
export const LOWER_HOLE = new THREE.Vector3(LOWER.x + 18, 42, 26);    // alt katın tavanındaki delik
export const DOCK_HOLE = new THREE.Vector3(0, 0, -46);                // Dock zeminindeki delik

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

const M = {
  body: pbrMaterial('rusty_metal_02', { repeat: [3, 2], metalness: 0.7, color: 0x6a5e54 }),
  dark: metalMaterial({ cols: 2, rows: 2, color: [44, 42, 40], grime: 0.9, rust: 0.7, seed: 61, size: 256 }, { metalness: 0.75, repeat: [2, 2] }),
  steel: metalMaterial({ cols: 1, rows: 2, color: [90, 88, 84], grime: 0.6, rust: 0.4, rivets: false, scratches: 1, seed: 62, size: 256 }, { metalness: 0.85 }),
  magma: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.22, 0.04) }),
  eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.3, 0.06) }),
};

function add(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

// ------------------------------------------------------------------ Kazıcı
export class Digger {
  constructor(game) {
    this.game = game;
    this.maxHp = 9000;
    this.hp = this.maxHp;
    this.minHp = 0;           // Dock'ta bu değerin altına inemez (zırh), alt katta 0
    this.active = false;
    this.alive = true;
    this.t = 0;
    this.spawnAcc = 0;
    this.hitFlash = 0;

    const g = new THREE.Group();
    this.group = g;
    // Gövde (davul) ve magma dikişleri
    add(g, new THREE.CylinderGeometry(5.6, 6.2, 12, 28), M.body, 0, 6, 0);
    for (const y of [1.2, 5, 8.8]) add(g, new THREE.TorusGeometry(6.0, 0.22, 6, 40), M.magma, 0, y, 0, Math.PI / 2);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      add(g, new THREE.BoxGeometry(1.0, 11, 0.8), M.dark, Math.cos(a) * 6.1, 6, Math.sin(a) * 6.1, 0, -a, 0);
      add(g, new THREE.BoxGeometry(0.25, 2.5, 0.2), M.magma, Math.cos(a + 0.31) * 6.15, 3.2, Math.sin(a + 0.31) * 6.15, 0, -a, 0);
    }
    // Üst kapak, egzoz bacaları, göz kümesi
    add(g, new THREE.CylinderGeometry(4.5, 5.6, 2.4, 24), M.dark, 0, 13.2, 0);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      add(g, new THREE.CylinderGeometry(0.6, 0.8, 3.5, 12), M.steel, Math.cos(a) * 3, 15.5, Math.sin(a) * 3);
      add(g, new THREE.CylinderGeometry(0.45, 0.45, 0.2, 12), M.magma, Math.cos(a) * 3, 17.3, Math.sin(a) * 3);
    }
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      add(g, new THREE.SphereGeometry(k === 0 ? 0.9 : 0.55, 12, 10), M.eye, Math.cos(a) * 6.3, 9.8 + (k % 2) * 0.8, Math.sin(a) * 6.3);
    }
    // Dönen matkap başı: koni + sarmal dişler
    this.head = new THREE.Group();
    g.add(this.head);
    add(this.head, new THREE.ConeGeometry(5.8, 10, 24), M.steel, 0, -5, 0, Math.PI);
    for (let k = 0; k < 36; k++) {
      const t = k / 36;
      const a = t * Math.PI * 6;
      const r = 5.6 * (1 - t) + 0.4;
      add(this.head, new THREE.BoxGeometry(1.1, 0.5, 0.7), M.dark, Math.cos(a) * r, -t * 9.5, Math.sin(a) * r, 0, -a, 0.5);
    }
    // Pençeli bacaklar (sentinel dokunaçları gibi)
    this.legs = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.25;
      const leg = new THREE.Group();
      leg.position.set(Math.cos(a) * 5.4, 11, Math.sin(a) * 5.4);
      leg.rotation.y = -a;
      add(leg, new THREE.BoxGeometry(6, 0.8, 0.8), M.dark, 3, 1.2, 0, 0, 0, 0.35);
      add(leg, new THREE.BoxGeometry(6, 0.6, 0.6), M.steel, 7.5, -0.8, 0, 0, 0, -0.9);
      add(leg, new THREE.ConeGeometry(0.4, 2.2, 8), M.dark, 9.2, -4.3, 0, 0, 0, Math.PI);
      g.add(leg);
      this.legs.push(leg);
    }
    this.light = new THREE.PointLight(0xc22a08, 0, 0, 2);
    this.light.position.set(0, 4, 0);
    g.add(this.light);
    g.visible = false;
    game.scene.add(g);
  }

  get pos() { return this.group.position; }
  get pct() { return Math.max(0, this.hp / this.maxHp); }

  show(x, y, z) {
    this.group.position.set(x, y, z);
    this.group.visible = true;
    this.active = true;
  }
  hide() {
    this.group.visible = false;
    this.active = false;
    this.light.intensity = 0;
  }

  // Işın – Kazıcı isabeti (dikey eksen üzerinde üç küre ile yaklaşık)
  hitTest(o, d, maxT) {
    if (!this.active || !this.alive) return null;
    let best = null;
    for (const [dy, r] of [[12, 6.2], [5, 6.4], [-4, 4.8]]) {
      _v.copy(this.pos).add(_w.set(0, dy, 0)).sub(o);
      const t = _v.dot(d);
      if (t < 0 || t > maxT) continue;
      const d2 = _v.lengthSq() - t * t;
      if (d2 > r * r) continue;
      const th = t - Math.sqrt(r * r - d2);
      if (best === null || th < best) best = th;
    }
    return best;
  }

  near(p, r) {
    if (!this.active || !this.alive) return false;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    return Math.hypot(dx, dz) < 6.5 + r && p.y > this.pos.y - 10 && p.y < this.pos.y + 18;
  }

  damage(a) {
    if (!this.active || !this.alive) return;
    this.hp = Math.max(this.minHp, this.hp - a);
    this.hitFlash = 0.08;
    if (this.hp <= 0) this.alive = false;
  }

  // Her kare: matkap döner, bacaklar kıpırdar, sentinel saçar
  update(dt, spawnRate = 0) {
    if (!this.active) return;
    this.t += dt;
    this.head.rotation.y += dt * 4;
    this.legs.forEach((l, k) => { l.rotation.z = Math.sin(this.t * 2 + k) * 0.18; });
    M.magma.color.setRGB(1.6 + (this.hitFlash > 0 ? 1.5 : Math.sin(this.t * 4) * 0.4), 0.22, 0.04);
    this.hitFlash -= dt;
    this.light.intensity = 3500 + Math.sin(this.t * 5) * 800;
    if (spawnRate > 0 && this.alive) {
      this.spawnAcc += spawnRate * dt;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        _v.set(this.pos.x + Math.cos(a) * 7, this.pos.y + 8 + Math.random() * 6, this.pos.z + Math.sin(a) * 7);
        this.game.swarm.spawnAt(_v, _w.set(Math.cos(a) * 6, 3, Math.sin(a) * 6));
      }
    }
  }
}

// ------------------------------------------------------------------ Alt kat
export function buildLower(scene) {
  const root = new THREE.Group();
  root.position.copy(LOWER);
  root.visible = false;
  scene.add(root);
  const colliders = [];
  const floorMat = pbrMaterial('metal_plate', { repeat: [44, 44], metalness: 0.6, color: 0x8a8a84 });
  const wallMat = pbrMaterial('rusty_metal_02', { repeat: [24, 6], metalness: 0.55, color: 0x6e6058 });
  const ceilMat = pbrMaterial('rusty_metal_sheet', { repeat: [20, 20], metalness: 0.5, color: 0x5a5a56, side: THREE.DoubleSide });
  const dark = M.dark;
  const box = (w, h, d, mat, x, y, z) => add(root, new THREE.BoxGeometry(w, h, d), mat, x, y, z);

  const floor = add(root, new THREE.PlaneGeometry(132, 132), floorMat, 0, 0, 0, -Math.PI / 2);
  floor.receiveShadow = false;
  box(132, 44, 2, wallMat, 0, 22, -66);
  box(132, 44, 2, wallMat, 0, 22, 66);
  box(2, 44, 132, wallMat, -66, 22, 0);
  box(2, 44, 132, wallMat, 66, 22, 0);
  // Tavan: delikli (Kazıcı'nın açtığı delik)
  const shape = new THREE.Shape();
  shape.moveTo(-66, -66); shape.lineTo(66, -66); shape.lineTo(66, 66); shape.lineTo(-66, 66); shape.lineTo(-66, -66);
  const hole = new THREE.Path();
  hole.absarc(LOWER_HOLE.x - LOWER.x, LOWER_HOLE.z, 9, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  add(root, new THREE.ShapeGeometry(shape, 32), ceilMat, 0, 42, 0, Math.PI / 2);
  add(root, new THREE.TorusGeometry(9.2, 0.6, 8, 32), M.magma, LOWER_HOLE.x - LOWER.x, 41.6, LOWER_HOLE.z, Math.PI / 2);
  // Kirişler, sütunlar, borular
  for (let i = -48; i <= 48; i += 24) {
    box(132, 2, 1.6, dark, 0, 40.5, i);
    for (const s of [-1, 1]) {
      box(3, 40, 3, dark, s * 62, 20, i);
      colliders.push({ x: LOWER.x + s * 62, z: i, r: 2.2 });
    }
  }
  for (const [x, z] of [[-30, -30], [32, -34], [-38, 28], [40, 6], [-8, 44]]) {
    box(4, 40, 4, dark, x, 20, z);
    colliders.push({ x: LOWER.x + x, z, r: 2.8 });
  }
  for (const y of [5, 6.2]) for (const s of [-1, 1]) add(root, new THREE.CylinderGeometry(0.5, 0.5, 128, 10), M.steel, s * 64, y, 0, Math.PI / 2);
  // Kazıcı'nın gömüldüğü krater ve magma çatlakları
  add(root, new THREE.CylinderGeometry(13, 9, 3, 32, 1, true), dark, 0, -0.6, -16);
  add(root, new THREE.CircleGeometry(12.5, 32), M.magma, 0, 0.05, -16, -Math.PI / 2).material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.08, 0.02) });
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const len = 10 + Math.random() * 14;
    const c = add(root, new THREE.PlaneGeometry(len, 0.5), M.magma, Math.cos(a) * (13 + len / 2), 0.04, -16 + Math.sin(a) * (13 + len / 2), -Math.PI / 2, 0, -a);
    c.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.16, 0.03) });
  }
  colliders.push({ x: LOWER.x, z: -16, r: 12 });
  // Kasalar
  for (const [x, z, s] of [[24, 40, 2.4], [28, 37, 1.8], [-44, -8, 2.6], [-20, 30, 2.2], [46, -40, 2.4]]) {
    box(s, s, s, M.steel, x, s / 2, z).rotation.y = Math.random();
    colliders.push({ x: LOWER.x + x, z, r: s * 0.75 });
  }
  // Işıklar (yalnız bu katta görünür): delikten sızan soğuk ışık + magma kızıllığı
  const shaft = new THREE.PointLight(0xbfdcc8, 14000, 0, 2);
  shaft.position.set(LOWER_HOLE.x - LOWER.x, 32, LOWER_HOLE.z);
  const glow = new THREE.PointLight(0xc0300a, 16000, 0, 2);
  glow.position.set(0, 9, -16);
  const top = new THREE.PointLight(0xd6f0e0, 12000, 0, 2);
  top.position.set(-26, 36, 10);
  root.add(shaft, glow, top);
  // Tavan lambaları (görsel)
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.8, 2.6) });
  for (const [x, z] of [[-26, 10], [-40, -40], [36, -30], [40, 40], [-10, -50]]) {
    add(root, new THREE.CylinderGeometry(1.2, 2.2, 1.2, 14), M.dark, x, 41, z);
    add(root, new THREE.CircleGeometry(1.9, 16), lampMat, x, 40.35, z, Math.PI / 2);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 13, 42, 24, 1, true), new THREE.MeshBasicMaterial({
    color: 0x9fbfaa, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  beam.position.set(LOWER_HOLE.x - LOWER.x, 21, LOWER_HOLE.z);
  root.add(beam);
  return { root, colliders, bounds: LOWER_BOUNDS };
}

// ------------------------------------------------------------------ Dock zeminindeki delik
export function buildDockHole(scene) {
  const g = new THREE.Group();
  g.position.copy(DOCK_HOLE);
  g.visible = false;
  scene.add(g);
  // Karanlık kuyu, kırık kenar, magma ışıltısı
  add(g, new THREE.CylinderGeometry(9, 9, 30, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x050302, side: THREE.BackSide }), 0, -15, 0);
  add(g, new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.06, 0.01) }), 0, -29, 0, -Math.PI / 2);
  add(g, new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: 0x020101 }), 0, 0.02, 0, -Math.PI / 2);
  add(g, new THREE.TorusGeometry(9.3, 0.55, 6, 36), M.magma, 0, 0.1, 0, Math.PI / 2);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const s = 0.8 + Math.random() * 1.6;
    add(g, new THREE.BoxGeometry(s * 1.6, s * 0.6, s), M.dark, Math.cos(a) * (10 + Math.random() * 2), s * 0.2, Math.sin(a) * (10 + Math.random() * 2), Math.random(), -a, Math.random() * 0.5);
  }
  const glowTex = radialTexture('rgba(255,90,30,0.9)', 'rgba(255,40,0,0)');
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.set(26, 26, 1);
  glow.position.y = 1;
  g.add(glow);
  return g;
}
