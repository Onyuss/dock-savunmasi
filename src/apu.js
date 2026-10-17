import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { collide, makeBlob } from './world.js';
import { metalMaterial } from './textures.js';
import { sfx } from './audio.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);

// Gri, yıpranmış askeri metal
const MAT = {
  frame: metalMaterial({ cols: 2, rows: 2, color: [104, 108, 110], grime: 0.6, rust: 0.12, scratches: 1, seed: 41, size: 256, roughness: 0.45 }, { metalness: 0.75, bump: 1.3 }),
  dark: metalMaterial({ cols: 1, rows: 2, color: [58, 61, 63], grime: 0.5, rust: 0.1, seed: 42, size: 256 }, { metalness: 0.7 }),
  gun: metalMaterial({ cols: 1, rows: 4, color: [84, 87, 89], grime: 0.7, rivets: false, scratches: 1, seed: 43, size: 256, roughness: 0.4 }, { metalness: 0.8, bump: 1.6 }),
  black: new THREE.MeshStandardMaterial({ color: 0x18191a, metalness: 0.5, roughness: 0.55 }),
  chain: new THREE.MeshStandardMaterial({ color: 0x141515, metalness: 0.7, roughness: 0.45 }),
  brass: new THREE.MeshStandardMaterial({ color: 0x9a7438, metalness: 0.9, roughness: 0.35 }),
  cloth: new THREE.MeshStandardMaterial({ color: 0x3a3631, roughness: 0.95 }),
  skin: new THREE.MeshStandardMaterial({ color: 0x8a6650, roughness: 0.8 }),
  orange: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.0, 0.25) }),
  red: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.2, 0.1) }),
  head: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 3.6, 3.2) }),
  screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.0, 0.45), transparent: true, opacity: 0.85 }),
};

function add(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
const B = (w, h, d) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.16);
const C = (r, h, seg = 14) => new THREE.CylinderGeometry(r, r, h, seg);

// a → b arasında kalın parça (yerel koordinatlarda)
function link(parent, a, b, t, mat) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(B(t, t, len), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Z, _v.subVectors(b, a).normalize());
  parent.add(m);
  return m;
}
function joint(parent, p, r, mat, axis = 'x') {
  const j = add(parent, C(r, r * 1.3), mat, p.x, p.y, p.z);
  if (axis === 'x') j.rotation.z = Math.PI / 2;
  else if (axis === 'z') j.rotation.x = Math.PI / 2;
  return j;
}

// Eğri boyunca dizilmiş zincir halkaları (tek geometri, tek çizim)
function chain(points, mat) {
  const curve = new THREE.CatmullRomCurve3(points);
  const n = Math.ceil(curve.getLength() / 0.13);
  const parts = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    _q.setFromUnitVectors(Z, tan);
    const g = new THREE.BoxGeometry(i % 2 ? 0.2 : 0.16, i % 2 ? 0.07 : 0.11, 0.12);
    m.compose(p, _q, _w.set(1, 1, 1));
    g.applyMatrix4(m);
    parts.push(g);
  }
  return new THREE.Mesh(mergeGeometries(parts), mat);
}

function buildLeg(side) {
  const leg = new THREE.Group();
  leg.position.set(side * 0.88, 2.75, 0.1);
  add(leg, B(0.78, 1.25, 0.9), MAT.frame, 0, -0.5, -0.12, 0.22);
  add(leg, B(0.5, 0.5, 0.2), MAT.dark, side * 0.3, -0.45, -0.55, 0.22);
  joint(leg, new THREE.Vector3(0, -1.15, -0.28), 0.4, MAT.dark);
  joint(leg, new THREE.Vector3(side * 0.42, -1.15, -0.28), 0.22, MAT.black);
  add(leg, B(0.72, 1.1, 0.82), MAT.frame, 0, -1.78, -0.12, -0.12);
  add(leg, B(0.6, 0.35, 0.3), MAT.dark, 0, -1.55, -0.58, -0.12);
  joint(leg, new THREE.Vector3(0, -2.33, 0.0), 0.26, MAT.black);
  add(leg, B(1.0, 0.3, 1.25), MAT.dark, 0, -2.6, -0.2);
  add(leg, B(0.44, 0.28, 0.62), MAT.frame, -0.26, -2.61, -1.0);
  add(leg, B(0.44, 0.28, 0.62), MAT.frame, 0.26, -2.61, -1.0);
  add(leg, B(0.62, 0.28, 0.5), MAT.frame, 0, -2.61, 0.6);
  add(leg, C(0.06, 1.5, 8), MAT.brass, side * 0.33, -1.25, 0.42, -0.15);
  add(leg, C(0.11, 0.6, 8), MAT.black, side * 0.33, -0.7, 0.36, -0.15);
  return leg;
}

// Kolun ucunda sarkan kutu biçimli döner topçu
function buildGun(side) {
  const pod = new THREE.Group();
  add(pod, B(0.42, 0.5, 0.42), MAT.dark, 0, -0.15, 0);
  add(pod, B(0.66, 0.66, 2.3), MAT.gun, 0, -0.62, -0.55);
  for (const y of [-0.42, -0.62, -0.82]) {
    add(pod, B(0.06, 0.1, 1.9), MAT.frame, side * 0.34, y, -0.6);
    add(pod, B(0.06, 0.1, 1.9), MAT.frame, -side * 0.34, y, -0.6);
  }
  add(pod, B(0.5, 0.06, 1.9), MAT.frame, 0, -0.27, -0.6);
  add(pod, B(0.56, 0.56, 0.3), MAT.dark, 0, -0.62, 0.72);
  add(pod, new THREE.SphereGeometry(0.05, 6, 4), MAT.red, side * 0.35, -0.3, -1.5);
  const barrels = new THREE.Group();
  pod.add(barrels);
  add(barrels, B(0.76, 0.76, 0.34), MAT.frame, 0, -0.62, -1.82);
  const muzzles = [];
  for (const [bx, by, r] of [[-side * 0.12, -0.7, 0.17], [side * 0.18, -0.48, 0.09]]) {
    add(barrels, C(r, 0.42, 14), MAT.black, bx, by, -2.08, Math.PI / 2);
    add(barrels, new THREE.TorusGeometry(r * 0.75, 0.025, 6, 14), MAT.orange, bx, by, -2.3);
    const mz = new THREE.Object3D();
    mz.position.set(bx, by, -2.4);
    barrels.add(mz);
    muzzles.push(mz);
  }
  return { pod, barrels, muzzles };
}

// Yürüyen silah kulesi
export class APU {
  constructor(game, spot, index) {
    this.game = game;
    this.kind = 'apu';
    this.label = 'APU-' + (index + 1);
    this.root = new THREE.Group();
    this.root.position.copy(spot);
    this.pos = this.root.position;
    this.bodyYaw = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.maxHp = 1200;
    this.hp = 1200;
    this.alive = true;
    this.radius = 2.4;
    this.heat = 0;
    this.overheated = false;
    this.ammoMax = 600;
    this.ammo = [600, 600];
    this.cd = 0;
    this.side = 0;
    this.barrel = 0;
    this.phase = 0;
    this.lastSin = 0;
    this.moveAmt = 0;
    this.view = 'inside';
    this.manned = false;
    this.recoil = [0, 0];
    this.sinceFire = 10;
    this.fall = 0;
    const R = this.root;

    // Bacaklar ve kalça
    this.legL = buildLeg(-1);
    this.legR = buildLeg(1);
    R.add(this.legL, this.legR);
    add(R, B(2.0, 0.55, 1.15), MAT.dark, 0, 2.85, 0.1);
    joint(R, new THREE.Vector3(0, 2.85, 0.1), 0.3, MAT.black);

    // Kokpit küveti
    add(R, B(1.55, 0.12, 1.25), MAT.dark, 0, 3.15, 0.05);
    add(R, B(1.5, 0.8, 0.1), MAT.frame, 0, 3.55, -0.62, -0.25);
    for (const s of [-1, 1]) {
      add(R, B(0.1, 0.95, 1.25), MAT.frame, s * 0.78, 3.6, 0.05);
      add(R, B(0.55, 0.12, 1.0), MAT.black, s * 1.05, 3.45, 0.0, 0, 0, s * 0.55);
      add(R, B(0.12, 0.5, 0.9), MAT.black, s * 1.12, 3.75, 0.05, 0, 0, s * -0.35);
      add(R, B(0.26, 0.5, 0.06), MAT.dark, s * 0.45, 3.42, -0.7, -0.25);
      for (let k = 0; k < 3; k++) add(R, B(0.22, 0.04, 0.05), MAT.black, s * 0.45, 3.28 + k * 0.13, -0.74, -0.25);
    }
    add(R, B(1.5, 1.7, 0.14), MAT.dark, 0, 4.0, 0.64);
    add(R, B(1.2, 0.5, 0.5), MAT.frame, 0, 4.6, 0.85);

    // Kafes çemberleri
    const hoop = (z, h, w) => {
      const c = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-w, 4.05, z), new THREE.Vector3(-w * 0.9, h - 0.3, z), new THREE.Vector3(0, h, z),
        new THREE.Vector3(w * 0.9, h - 0.3, z), new THREE.Vector3(w, 4.05, z),
      ]);
      R.add(new THREE.Mesh(new THREE.TubeGeometry(c, 20, 0.055, 8), MAT.frame));
    };
    hoop(-0.5, 5.15, 0.72);
    hoop(0.55, 5.3, 0.74);
    for (const s of [-1, 1]) link(R, new THREE.Vector3(s * 0.62, 4.95, -0.5), new THREE.Vector3(s * 0.62, 5.08, 0.55), 0.08, MAT.frame);

    // Koltuk, kumanda kolları, ekranlar
    add(R, B(0.6, 0.12, 0.5), MAT.black, 0, 3.72, 0.25);
    add(R, B(0.62, 0.85, 0.12), MAT.black, 0, 4.15, 0.5);
    add(R, B(0.95, 0.12, 0.12), MAT.dark, 0, 3.98, -0.36);
    for (const s of [-1, 1]) {
      add(R, B(0.1, 0.4, 0.1), MAT.dark, s * 0.32, 3.82, -0.36);
      add(R, B(0.08, 0.08, 0.22), MAT.black, s * 0.32, 4.05, -0.42);
      add(R, new THREE.PlaneGeometry(0.26, 0.15), MAT.screen, s * 0.42, 4.2, -0.52, -0.35);
    }

    // Pilot (yalnızca dış kamerada görünür)
    this.pilot = new THREE.Group();
    add(this.pilot, B(0.44, 0.55, 0.3), MAT.cloth, 0, 4.05, 0.32);
    add(this.pilot, new THREE.SphereGeometry(0.14, 12, 10), MAT.skin, 0, 4.5, 0.28);
    for (const s of [-1, 1]) link(this.pilot, new THREE.Vector3(s * 0.24, 4.25, 0.3), new THREE.Vector3(s * 0.32, 4.05, -0.38), 0.1, MAT.cloth);
    this.pilot.visible = false;
    R.add(this.pilot);

    // Sırttan yükselen eklemli kollar → sarkan topçular
    this.pods = [];
    for (const s of [-1, 1]) {
      const S = new THREE.Vector3(s * 0.55, 4.75, 0.72);
      const A = new THREE.Vector3(s * 0.95, 6.05, 0.55);
      const E = new THREE.Vector3(s * 2.15, 6.15, 0.35);
      const W = new THREE.Vector3(s * 2.2, 4.75, 0.2);
      joint(R, S, 0.24, MAT.dark);
      link(R, S, A, 0.24, MAT.dark);
      link(R, S.clone().add(_v.set(0, 0, 0.18)), A.clone().add(_v.set(0, 0, 0.18)), 0.1, MAT.frame);
      joint(R, A, 0.26, MAT.frame, 'z');
      link(R, A, E, 0.26, MAT.dark);
      link(R, A.clone().add(_v.set(0, 0.2, 0)), E.clone().add(_v.set(0, 0.2, 0)), 0.1, MAT.frame);
      for (let k = 1; k < 4; k++) joint(R, A.clone().lerp(E, k / 4).add(_v.set(0, 0, 0.14)), 0.1, MAT.black, 'z');
      joint(R, E, 0.28, MAT.frame, 'z');
      link(R, E, W, 0.3, MAT.dark);
      add(R, B(0.5, 0.75, 0.42), MAT.frame, W.x, (E.y + W.y) / 2 - 0.1, (E.z + W.z) / 2);
      const g = buildGun(s);
      g.pod.position.copy(W);
      R.add(g.pod);
      this.pods.push(g);
      R.add(chain([
        new THREE.Vector3(s * 2.2, 3.95, 0.4), new THREE.Vector3(s * 2.15, 2.7, 0.75),
        new THREE.Vector3(s * 1.7, 2.35, 1.15), new THREE.Vector3(s * 1.05, 2.9, 1.0), new THREE.Vector3(s * 0.7, 3.6, 0.8),
      ], MAT.chain));
    }

    // Farlar
    for (const x of [-0.45, 0.45]) {
      add(R, new THREE.BoxGeometry(0.2, 0.12, 0.08), MAT.dark, x, 5.05, -0.52);
      add(R, new THREE.BoxGeometry(0.16, 0.08, 0.02), MAT.head, x, 5.05, -0.565);
    }
    this.head = new THREE.Vector3(0, 4.55, 0.2);
    this.blob = makeBlob(game.scene, 3.2, 0.85);
    game.scene.add(R);
  }

  get targetable() { return this.alive; }
  targetPos(out) { return out.set(this.pos.x, this.pos.y + 3.8, this.pos.z); }

  damage(a) {
    if (!this.alive) return;
    this.hp -= a;
    if (this.game.pawn === this) this.game.hurt();
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.game.effects.explosion(this.targetPos(_v), 2.5);
      this.game.onVehicleDestroyed(this);
    }
  }

  canEnter(p) { return this.alive && !this.manned && _v.set(p.x - this.pos.x, 0, p.z - this.pos.z).length() < 4.4; }
  exitPos(out) {
    return out.set(this.pos.x + Math.sin(this.bodyYaw) * 3.2, 0, this.pos.z + Math.cos(this.bodyYaw) * 3.2);
  }

  onPossess() {
    this.manned = true;
    this.aimYaw = this.bodyYaw;
    this.aimPitch = 0;
    this.pilot.visible = this.view === 'outside';
  }
  onRelease() { this.manned = false; this.pilot.visible = false; }
  toggleView() {
    this.view = this.view === 'inside' ? 'outside' : 'inside';
    this.pilot.visible = this.view === 'outside';
  }

  update(dt, input) {
    const look = input.look();
    this.aimYaw += look.yaw;
    this.aimPitch = THREE.MathUtils.clamp(this.aimPitch + look.pitch, -0.5, 0.9);

    // Gövde nişana doğru yavaşça döner
    let diff = this.aimYaw - this.bodyYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.bodyYaw += THREE.MathUtils.clamp(diff, -1.5 * dt, 1.5 * dt);

    const ax = input.axis();
    const sp = ax.z > 0 ? 4.2 : 2.6;
    _f.set(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw));
    _r.set(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
    _w.set(0, 0, 0).addScaledVector(_f, ax.z).addScaledVector(_r, ax.x * 0.7);
    const moving = _w.lengthSq() > 0;
    this.moveAmt = THREE.MathUtils.damp(this.moveAmt, moving ? 1 : 0, 4, dt);
    if (moving) this.pos.addScaledVector(_w.normalize(), sp * dt * this.moveAmt);
    this.pos.y = 0;
    collide(this.pos, 1.8, this.game.colliders);

    this.weapons(dt, input.fire);
  }

  // Pilotsuz APU: en yakın düşmana kısa seriler
  ai(dt) {
    if (this.manned || !this.alive) return;
    const sw = this.game.swarm;
    this.aiT = (this.aiT || 0) - dt;
    if (this.aiT <= 0) {
      this.aiT = 0.5;
      this.aiTarget = sw.nearest(this.targetPos(_v), 90);
    }
    let firing = false;
    if (sw.isAlive(this.aiTarget)) {
      const e = sw.posOf(this.aiTarget, _w);
      this.targetPos(_v);
      const dx = e.x - _v.x, dy = e.y - _v.y, dz = e.z - _v.z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.5, 0.9);
      const d = Math.atan2(Math.sin(yaw - this.aimYaw), Math.cos(yaw - this.aimYaw));
      this.aimYaw += THREE.MathUtils.clamp(d, -2 * dt, 2 * dt);
      this.aimPitch = THREE.MathUtils.damp(this.aimPitch, pitch, 4, dt);
      const bd = Math.atan2(Math.sin(this.aimYaw - this.bodyYaw), Math.cos(this.aimYaw - this.bodyYaw));
      this.bodyYaw += THREE.MathUtils.clamp(bd, -1.2 * dt, 1.2 * dt);
      firing = Math.abs(d) < 0.25;
      e.x += (Math.random() - 0.5) * 6; e.y += (Math.random() - 0.5) * 6; e.z += (Math.random() - 0.5) * 6;
    }
    this.weapons(dt, firing, _w, 0.35);
  }

  weapons(dt, firing, aimAt = null, dmgMul = 1) {
    this.cd -= dt;
    this.sinceFire += dt;
    const canFire = firing && !this.overheated && (this.ammo[0] > 0 || this.ammo[1] > 0);
    if (canFire && this.cd <= 0) {
      this.cd = aimAt ? 0.2 : 0.055;
      this.sinceFire = 0;
      let s = this.side;
      if (this.ammo[s] <= 0) s = 1 - s;
      this.side = 1 - this.side;
      this.ammo[s]--;
      const pod = this.pods[s];
      const mz = pod.muzzles[this.barrel % 2];
      if (s === 1) this.barrel++;
      const from = mz.getWorldPosition(new THREE.Vector3());
      const aim = aimAt ? aimAt.clone() : this.game.aimPoint();
      _v.subVectors(aim, from).normalize();
      this.game.shoot(from, _v, { damage: 30 * dmgMul, splash: aimAt ? 0 : 1.8, splashDamage: 12, from, width: 0.14 });
      this.game.effects.flash(from, this.manned && this.view === 'inside' ? 1.1 : 1.7, 0.04);
      this.recoil[s] = 0.22;
      this.heat += aimAt ? 1.2 : 1.9;
      if (this.manned) {
        this.game.effects.casing(pod.pod.getWorldPosition(_w).add(_v.set(0, -0.9, 0)), s === 0 ? -1 : 1);
        this.game.addShake(0.12);
        sfx.apuGun(s === 0 ? -1 : 1);
      } else if (from.distanceTo(this.game.camera.position) < 45) {
        sfx.apuGun(0, 0.35);
      }
      if (this.heat >= 100) { this.heat = 100; this.overheated = true; sfx.overheat(); }
    }
    const cool = this.sinceFire > 0.35 ? 30 : 4;
    this.heat = Math.max(0, this.heat - cool * dt);
    if (this.overheated && this.heat < 35) this.overheated = false;
  }

  // Her karede çalışır (pilotlu ya da değil): animasyon
  animate(dt) {
    this.blob.position.set(this.pos.x, 0.03, this.pos.z);
    if (!this.alive) {
      this.fall = Math.min(1, this.fall + dt * 0.8);
      this.root.rotation.z = this.fall * 0.9;
      this.root.position.y = -this.fall * 1.2;
      return;
    }
    const k = this.moveAmt;
    this.phase += dt * 4.2 * k;
    const s = Math.sin(this.phase);
    this.legL.rotation.x = s * 0.32 * k;
    this.legR.rotation.x = -s * 0.32 * k;
    this.root.position.y = Math.abs(s) * 0.12 * k;
    if (k > 0.3 && Math.sign(s) !== Math.sign(this.lastSin)) {
      const foot = (s > 0 ? this.legR : this.legL).getWorldPosition(_w);
      foot.y = 0.1;
      this.game.effects.dust(foot, 8);
      if (this.manned) { this.game.addShake(0.3); sfx.step(); }
    }
    this.lastSin = s;
    this.root.rotation.y = this.bodyYaw;
    const rel = THREE.MathUtils.clamp(Math.atan2(Math.sin(this.aimYaw - this.bodyYaw), Math.cos(this.aimYaw - this.bodyYaw)), -0.6, 0.6);
    for (let i = 0; i < 2; i++) {
      const p = this.pods[i];
      p.pod.rotation.set(this.aimPitch, rel, 0, 'YXZ');
      this.recoil[i] = THREE.MathUtils.damp(this.recoil[i], 0, 18, dt);
      p.barrels.position.z = this.recoil[i];
    }
  }

  applyCamera(cam) {
    if (this.view === 'inside') {
      this.root.updateMatrixWorld(true);
      this.root.localToWorld(cam.position.copy(this.head));
      cam.rotation.set(this.aimPitch, this.aimYaw, 0, 'YXZ');
    } else {
      _e.set(this.aimPitch * 0.8, this.aimYaw, 0, 'YXZ');
      _v.set(2.6, 1.6, 11).applyEuler(_e);
      cam.position.set(this.pos.x, 5.6, this.pos.z).add(_v);
      cam.position.y = Math.max(1, cam.position.y);
      cam.rotation.set(this.aimPitch, this.aimYaw, 0, 'YXZ');
    }
  }
}
