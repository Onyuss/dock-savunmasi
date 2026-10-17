import * as THREE from 'three';
import { metalMaterial } from './textures.js';
import { sfx } from './audio.js';

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

// Nişancı koltuğu: kameraya bağlı iç mekân. Çerçeve, tutamaklar, top kuyruğu ve
// iki yandan kuyruğa akan mermi bantları (her atışta bir mermi ilerler).
const BELT_N = 34;
class GunnerCockpit {
  constructor(camera) {
    this.group = new THREE.Group();
    this.group.visible = false;
    camera.add(this.group);
    const G = this.group;
    const box = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) => add(G, new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
    // İç mekân koyu, mat malzemeler (gemi ışığında parlamasın diye)
    const frame = new THREE.MeshStandardMaterial({ color: 0x1e2120, metalness: 0.6, roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x2c2f2e, metalness: 0.7, roughness: 0.5 });
    const screen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.04, 0.32, 0.12) });
    const amber = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.25, 0.05) });
    // Pencere çerçevesi
    box(3.0, 0.16, 0.14, frame, 0, 0.7, -0.95);
    box(0.16, 1.7, 0.16, frame, -1.4, -0.05, -0.95, 0, 0, 0.14);
    box(0.16, 1.7, 0.16, frame, 1.4, -0.05, -0.95, 0, 0, -0.14);
    box(2.6, 0.3, 0.7, frame, 0, -0.8, -0.95, -0.25);
    box(2.4, 0.03, 0.04, screen, 0, -0.64, -0.62);
    for (const s of [-1, 1]) {
      box(0.46, 0.26, 0.03, screen, s * 0.78, -0.62, -0.7, -0.5, s * 0.25);
      add(G, new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10), metal, s * 0.3, -0.62, -0.55).rotation.x = 0.4;
      add(G, new THREE.CylinderGeometry(0.045, 0.045, 0.12, 10), frame, s * 0.3, -0.49, -0.6);
    }
    box(0.9, 0.05, 0.05, metal, 0, -0.68, -0.55);
    // Top kuyruğu (bantların girdiği yer)
    box(0.55, 0.3, 0.6, metal, 0, -0.56, -1.25);
    box(0.57, 0.03, 0.62, amber, 0, -0.4, -1.25);
    this.breech = new THREE.Object3D();
    this.breech.position.set(0, -0.52, -1.1);
    G.add(this.breech);

    // Mermi bantları: pirinç fişekler + koyu halkalar (InstancedMesh)
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a40, metalness: 0.9, roughness: 0.3 });
    const link = new THREE.MeshStandardMaterial({ color: 0x1a1b1b, metalness: 0.7, roughness: 0.4 });
    const shell = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 8);
    shell.rotateZ(Math.PI / 2);
    const tip = new THREE.ConeGeometry(0.02, 0.05, 8);
    tip.rotateZ(-Math.PI / 2);
    tip.translate(0.1, 0, 0);
    this.belts = [-1, 1].map((s) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 1.35, -1.05, -0.65), new THREE.Vector3(s * 1.1, -0.75, -0.95),
        new THREE.Vector3(s * 0.7, -0.6, -1.15), new THREE.Vector3(s * 0.3, -0.53, -1.22),
      ]);
      const shells = new THREE.InstancedMesh(shell, brass, BELT_N);
      const tips = new THREE.InstancedMesh(tip, brass, BELT_N);
      const links = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.035, 0.07), link, BELT_N);
      for (const m of [shells, tips, links]) { m.frustumCulled = false; G.add(m); }
      return { s, curve, shells, tips, links, phase: 0, ammo: 2000 };
    });
    this.shake = 0;
    this.layout();
  }

  layout() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
    for (const b of this.belts) {
      for (let k = 0; k < BELT_N; k++) {
        const u = ((k + b.phase) / BELT_N) % 1;
        b.curve.getPointAt(u, p);
        b.curve.getTangentAt(u, t);
        side.crossVectors(t, up).normalize();
        q.setFromUnitVectors(X, side.multiplyScalar(b.s));
        m.compose(p, q, one);
        b.shells.setMatrixAt(k, m);
        b.tips.setMatrixAt(k, m);
        b.links.setMatrixAt(k, m);
      }
      b.shells.instanceMatrix.needsUpdate = b.tips.instanceMatrix.needsUpdate = b.links.instanceMatrix.needsUpdate = true;
    }
  }

  // Bir atış: o taraftaki bant bir mermi ilerler
  feed(i) {
    const b = this.belts[i];
    b.phase = (b.phase + 1) % BELT_N;
    b.ammo = Math.max(0, b.ammo - 1);
    this.shake = 0.03;
  }

  update(dt) {
    this.layout();
    this.shake = Math.max(0, this.shake - dt * 0.4);
    this.group.position.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0);
  }
}

// Topçu koltuğu: oyuncunun bu bölümdeki gövdesi
class HammerGun {
  constructor(level) {
    this.level = level;
    this.kind = 'hammer';
    this.label = 'HAMMER · ARKA TOP';
    this.aimYaw = Math.PI;
    this.aimPitch = 0.05;
    this.heat = 0;
    this.overheated = false;
    this.cd = 0;
    this.barrel = 0;
    this.sinceFire = 10;
    this.alive = true;
    this.view = 'cockpit';
    this.cockpit = new GunnerCockpit(level.game.camera);
  }

  get ammoText() { return 'SOL ' + this.cockpit.belts[0].ammo + ' · SAĞ ' + this.cockpit.belts[1].ammo; }

  setActive(on) {
    this.cockpit.group.visible = on && this.view === 'cockpit';
    this.level.model.gun.visible = !(on && this.view === 'cockpit');
  }
  toggleView() {
    this.view = this.view === 'cockpit' ? 'outside' : 'cockpit';
    this.setActive(true);
  }
  onPossess() { this.setActive(true); }
  onRelease() { this.setActive(false); }

  get hp() { return this.level.hull; }
  get maxHp() { return this.level.hullMax; }
  get targetable() { return false; }

  update(dt, input) {
    const g = this.level.game;
    const look = input.look();
    this.aimYaw = THREE.MathUtils.clamp(this.aimYaw + look.yaw, Math.PI - 1.5, Math.PI + 1.5);
    this.aimPitch = THREE.MathUtils.clamp(this.aimPitch + look.pitch, -0.35, 0.75);
    this.cd -= dt;
    this.sinceFire += dt;
    if (input.hit('KeyV')) this.toggleView();
    const belts = this.cockpit.belts;
    if (input.fire && !this.overheated && this.cd <= 0 && (belts[0].ammo > 0 || belts[1].ammo > 0)) {
      this.cd = 0.05 * g.shop.rate;
      this.sinceFire = 0;
      let side = this.barrel++ % 2;
      if (belts[side].ammo <= 0) side = 1 - side;
      const mz = this.level.model.muzzles[side];
      const from = mz.getWorldPosition(new THREE.Vector3());
      _v.subVectors(g.aimPoint(), from).normalize();
      g.shoot(from, _v, { damage: 26, splash: 2, splashDamage: 10, from, width: 0.12, player: true });
      g.effects.flash(from, this.view === 'cockpit' ? 0.9 : 1.2, 0.04);
      g.addShake(0.05);
      this.cockpit.feed(side);
      if (this.view === 'cockpit') g.effects.casing(this.cockpit.breech.getWorldPosition(_w), side ? 1 : -1);
      this.heat += 0.4 * g.shop.heat;
      sfx.flak();
      if (this.heat >= 100) { this.heat = 100; this.overheated = true; sfx.overheat(); }
    }
    this.heat = Math.max(0, this.heat - (this.sinceFire > 0.3 ? 30 : 4) * dt);
    if (this.overheated && this.heat < 35) this.overheated = false;
    if (input.hit('KeyQ')) g.fireRocket(this.level.model.muzzles[0].getWorldPosition(new THREE.Vector3()));
    this.cockpit.update(dt);
  }

  applyCamera(cam) {
    const t = this.level.model.turret;
    t.getWorldPosition(_w);
    _e.set(this.view === 'cockpit' ? this.aimPitch : this.aimPitch * 0.6, this.aimYaw, 0, 'YXZ');
    if (this.view === 'cockpit') _v.set(0, 1.55, 0.9).applyEuler(_e);   // topun içinde, kuyruğun arkası
    else _v.set(0, 3.3, 3.0).applyEuler(_e);
    cam.position.copy(_w).add(_v);
    cam.rotation.set(this.aimPitch, this.aimYaw, 0, 'YXZ');
  }

  // CRT nişan ekranı: sentinellerin etrafına hedef köşeleri ve uzaklık çizer
  drawTargets(ctx, w, h) {
    const g = this.level.game;
    const sw = g.swarm;
    const cam = g.camera;
    ctx.clearRect(0, 0, w, h);
    const dir = cam.getWorldDirection(_w);
    const lock = g.rockets.ready ? g.rockets.pickLock(cam.position, dir) : -1;
    ctx.lineWidth = 2;
    ctx.font = '12px Consolas, monospace';
    let drawn = 0;
    for (let i = 0; i < sw.max && drawn < 40; i++) {
      if (!sw.isAlive(i)) continue;
      sw.posOf(i, _v);
      const dist = _v.distanceTo(cam.position);
      if (dist > 260) continue;
      _v.project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) continue;
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      const r = Math.max(8, 900 / dist);
      const c = i === lock ? '#ff4a3a' : '#9dff7a';
      ctx.strokeStyle = c;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(x + sx * r, y + sy * r * 0.6);
        ctx.lineTo(x + sx * r, y + sy * r);
        ctx.lineTo(x + sx * r * 0.6, y + sy * r);
      }
      ctx.stroke();
      if (dist < 120 || i === lock) {
        ctx.fillStyle = c;
        ctx.fillText(i === lock ? 'KİLİT ' + Math.round(dist) + 'm' : Math.round(dist) + 'm', x + r + 4, y - r + 10);
      }
      drawn++;
    }
  }
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
    this.model.turret.rotation.y = gunner.aimYaw - Math.PI;
    this.model.gun.rotation.x = -gunner.aimPitch;
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
