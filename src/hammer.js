import * as THREE from 'three';
import { metalMaterial } from './textures.js';
import { sfx } from './audio.js';
import { HammerGun } from './gunner.js';

// Hammer bölümü: oyuncu geminin arka topçusudur. Gemi tünelde Zion'a doğru hızla ilerler,
// sürü arkadan yetişip gövdeye saldırır. Süre dolana kadar gemi ayakta kalırsa bölüm biter.
// Sahne Dock ile aynı; tünel uzakta (x = 3000) kurulur ve yalnızca bu bölümde görünür.

const O = new THREE.Vector3(3000, 0, 0);
const SPEED = 38;
const SEG = 24, NSEG = 18;
const DURATION = 60;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler();

const M = {
  hull: metalMaterial({ cols: 4, rows: 2, color: [70, 72, 70], grime: 0.6, rust: 0.25, scratches: 1, seed: 51 }, { repeat: [3, 2], metalness: 0.8 }),
  dark: metalMaterial({ cols: 1, rows: 1, color: [40, 42, 42], rivets: false, grime: 0.5, seed: 52, size: 256 }, { metalness: 0.7 }),
  tunnel: metalMaterial({ cols: 2, rows: 2, color: [46, 50, 46], grime: 0.9, rust: 0.5, seed: 53 }, { repeat: [8, 2], metalness: 0.5, side: THREE.BackSide }),
  floor: metalMaterial({ cols: 2, rows: 2, color: [50, 52, 48], grime: 0.9, rust: 0.3, seed: 54, size: 256 }, { repeat: [3, 3], metalness: 0.5 }),
  blue: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.2, 2.8) }),
  window: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.8, 0.9) }),
  green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.8, 0.6) }),
  lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.8, 2.6) }),
  orange: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.0, 0.25) }),
};

function add(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

// Hammer hovercraft modeli (burun -z yönünde). Arka üstte topçu kulesi.
export function buildHammerModel() {
  const g = new THREE.Group();
  const hull = add(g, new THREE.CapsuleGeometry(4, 22, 8, 20), M.hull, 0, 0, 0, Math.PI / 2);
  hull.scale.set(1.45, 1, 0.68);
  add(g, new THREE.BoxGeometry(8, 0.6, 18), M.dark, 0, 2.7, 1);
  add(g, new THREE.BoxGeometry(5, 1.6, 6), M.hull, 0, 3.2, -7);
  for (const s of [-1, 1]) {
    add(g, new THREE.BoxGeometry(1.6, 0.25, 0.5), M.window, s * 1.4, 3.4, -10.05);
    add(g, new THREE.BoxGeometry(1.2, 2.2, 26), M.dark, s * 6.2, -0.6, 0);
    for (const z of [-8, 8]) {
      const pad = add(g, new THREE.CylinderGeometry(1.7, 1.7, 0.3, 18), M.blue, s * 3.3, -2.9, z);
      pad.scale.set(1, 1, 1.4);
    }
    add(g, new THREE.TorusGeometry(1.2, 0.2, 8, 20), M.blue, s * 3, 0.2, 15.6);
  }
  add(g, new THREE.BoxGeometry(3.4, 0.2, 0.3), M.window, 0, 1.6, -15.2);
  // Topçu kulesi (namlular +z'ye, yani geriye bakar)
  const turret = new THREE.Group();
  turret.position.set(0, 3.3, 9);
  g.add(turret);
  add(turret, new THREE.CylinderGeometry(1.4, 1.7, 0.8, 14), M.dark, 0, 0.4, 0);
  const gun = new THREE.Group();
  gun.position.y = 1.2;
  turret.add(gun);
  add(gun, new THREE.BoxGeometry(1.8, 0.8, 1.6), M.hull, 0, 0, 0);
  add(gun, new THREE.BoxGeometry(2.2, 1.1, 0.1), M.dark, 0, 0.2, -0.9);
  const muzzles = [];
  for (const x of [-0.5, 0.5]) {
    add(gun, new THREE.CylinderGeometry(0.11, 0.13, 3, 10), M.dark, x, 0, 2.2, Math.PI / 2);
    add(gun, new THREE.TorusGeometry(0.1, 0.03, 6, 12), M.orange, x, 0, 3.72);
    const mz = new THREE.Object3D();
    mz.position.set(x, 0, 3.8);
    gun.add(mz);
    muzzles.push(mz);
  }
  return { group: g, turret, gun, muzzles };
}

export class HammerLevel {
  constructor(game) {
    this.game = game;
    this.root = new THREE.Group();
    this.root.position.copy(O);
    this.root.visible = false;
    game.scene.add(this.root);

    // Tünel parçaları (gemi ilerledikçe arkada kalanlar öne taşınır)
    const wallGeo = new THREE.CylinderGeometry(15, 15, SEG, 28, 1, true);
    wallGeo.rotateX(Math.PI / 2);
    const ringGeo = new THREE.TorusGeometry(14.6, 0.5, 6, 28);
    const pipeGeo = new THREE.CylinderGeometry(0.35, 0.35, SEG, 8);
    pipeGeo.rotateX(Math.PI / 2);
    this.segs = [];
    for (let i = 0; i < NSEG; i++) {
      const s = new THREE.Group();
      add(s, wallGeo, M.tunnel, 0, 10, 0);
      add(s, new THREE.BoxGeometry(22.4, 0.4, SEG), M.floor, 0, -0.2, 0);
      add(s, ringGeo, M.dark, 0, 10, -SEG / 2);
      for (const sx of [-1, 1]) {
        add(s, pipeGeo, M.dark, sx * 12.5, 4, 0);
        add(s, pipeGeo, M.dark, sx * 13.4, 8, 0);
        add(s, new THREE.BoxGeometry(0.2, 0.2, SEG * 0.8), i % 2 ? M.green : M.lamp, sx * 11, 0.3, 0);
      }
      if (i % 3 === 0) add(s, new THREE.BoxGeometry(6, 0.3, 1.2), M.lamp, 0, 24.6, 0);
      s.position.z = -i * SEG + SEG;
      this.root.add(s);
      this.segs.push(s);
    }

    this.model = buildHammerModel();
    this.root.add(this.model.group);
    this.shipLight = new THREE.PointLight(0xcfe6ff, 2500, 0, 2);
    this.rearLight = new THREE.PointLight(0xffb070, 1800, 0, 2);
    this.root.add(this.shipLight, this.rearLight);

    this.hullMax = 4000;
    this.hull = this.hullMax;
    this.t = 0;
    this.z = 0;
    this.acc = 0;
    this.gun = new HammerGun(this);
    const self = this;
    // Sürünün saldırdığı hedef: geminin gövdesi
    this.target = {
      kind: 'hammerHull',
      radius: 6.5,
      vel: new THREE.Vector3(0, 0, -SPEED),
      get targetable() { return self.hull > 0; },
      targetPos(out) { return out.set(O.x, 4.5, self.z + 4); },
      damage(a) {
        if (self.hull <= 0) return;
        self.hull -= a;
        self.game.hurtT = 0.2;
        if (Math.random() < 0.05) sfx.hurt();
      },
    };
  }

  get timeLeft() { return Math.max(0, DURATION - this.t); }

  start() {
    const g = this.game;
    this.root.visible = true;
    this.hull = this.hullMax;
    this.t = 0;
    this.z = 0;
    this.acc = 0;
    g.swarm.clearAll();
    g.targets = [this.target];
    g.possess(this.gun);
    this.place(0);
    for (let i = 0; i < 12; i++) this.spawn(60 + i * 6);
  }

  stop() { this.root.visible = false; }

  spawn(back) {
    _v.set(O.x + (Math.random() - 0.5) * 18, 3 + Math.random() * 13, this.z + back + Math.random() * 30);
    return this.game.swarm.spawnAt(_v, _w.set(0, 0, -SPEED));
  }

  place(dt) {
    const bob = Math.sin(this.t * 1.7) * 0.25;
    this.model.group.position.set(0, 4.5 + bob, this.z);
    this.model.group.rotation.z = Math.sin(this.t * 0.9) * 0.03;
    this.shipLight.position.set(0, 12, this.z - 6);
    this.rearLight.position.set(0, 9, this.z + 22);
    const gunner = this.gun;
    this.model.turret.rotation.y = gunner.gunYaw - Math.PI;
    this.model.gun.rotation.x = -gunner.gunPitch;
    for (const s of this.segs) {
      if (s.position.z > this.z + 40) s.position.z -= NSEG * SEG;
    }
  }

  // 'win' | 'lose' | null
  update(dt) {
    this.t += dt;
    this.z -= SPEED * dt;
    this.place(dt);
    const rate = this.t < 10 ? 2.5 : this.t < 35 ? 4 : 5.5;
    this.acc += rate * dt;
    while (this.acc >= 1) { this.acc -= 1; this.spawn(70 + Math.random() * 50); }
    if (Math.random() < dt * 0.5) sfx.drill();
    if (this.hull <= 0) return 'lose';
    if (this.t >= DURATION) return 'win';
    return null;
  }
}
