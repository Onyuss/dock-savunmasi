import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { collide, makeBlob } from './world.js';
import { metalMaterial, pbrMaterial } from './textures.js';
import { sfx } from './audio.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _e = new THREE.Euler();

const MAT = {
  frame: pbrMaterial('green_metal_rust', { metalness: 0.7, color: 0xc4ccbe }),
  dark: metalMaterial({ cols: 1, rows: 1, color: [42, 46, 44], rivets: false, grime: 0.5, rust: 0.2, seed: 12, size: 256 }, { metalness: 0.7 }),
  stripe: metalMaterial({ cols: 1, rows: 1, color: [96, 100, 88], stripes: true, grime: 0.6, seed: 13, size: 256 }, { metalness: 0.6 }),
  pilot: new THREE.MeshStandardMaterial({ color: 0x3d4238, roughness: 0.95 }),
  brass: new THREE.MeshStandardMaterial({ color: 0x9a7438, metalness: 0.9, roughness: 0.35 }),
  hose: new THREE.MeshStandardMaterial({ color: 0x141614, roughness: 0.6, metalness: 0.1 }),
  green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 0.8) }),
  orange: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.0, 0.25) }),
  red: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.2, 0.1) }),
  head: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 3.6, 3.2) }),
  screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.0, 0.45), transparent: true, opacity: 0.85 }),
};

function add(parent, geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const B = (w, h, d) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.18);

function buildLeg(side) {
  const leg = new THREE.Group();
  leg.position.set(side * 0.72, 2.9, 0);
  add(leg, B(0.42, 1.4, 0.5), MAT.frame, 0, -0.7, 0);
  const knee = add(leg, new THREE.CylinderGeometry(0.22, 0.22, 0.56, 12), MAT.dark, 0, -1.4, 0);
  knee.rotation.z = Math.PI / 2;
  add(leg, B(0.48, 1.35, 0.55), MAT.frame, 0, -2.1, 0.08);
  add(leg, B(1.0, 0.28, 1.7), MAT.dark, 0, -2.76, -0.15);
  const piston = add(leg, new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8), MAT.brass, side * 0.3, -1.3, -0.3);
  piston.rotation.x = 0.15;
  add(leg, new THREE.CylinderGeometry(0.11, 0.11, 0.7, 8), MAT.dark, side * 0.3, -0.75, -0.38);
  add(leg, B(0.5, 0.5, 0.12), MAT.stripe, 0, -0.55, -0.28);
  const hose = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-side * 0.15, -0.1, 0.28), new THREE.Vector3(-side * 0.32, -1.2, 0.42), new THREE.Vector3(-side * 0.2, -2.0, 0.36),
  ]);
  leg.add(new THREE.Mesh(new THREE.TubeGeometry(hose, 10, 0.045, 6), MAT.hose));
  return leg;
}

function buildPod(side) {
  const pod = new THREE.Group();
  pod.position.set(side * 1.45, 4.3, 0);
  add(pod, B(0.8, 1.1, 1.5), MAT.frame, 0, -0.35, 0.1);
  add(pod, B(0.5, 0.55, 0.7), MAT.stripe, side * 0.55, -0.2, 0.4);
  add(pod, B(0.86, 0.3, 0.5), MAT.dark, 0, 0.3, 0.35);
  add(pod, new THREE.BoxGeometry(0.82, 0.04, 0.04), MAT.green, 0, 0.21, -0.66);
  add(pod, new THREE.SphereGeometry(0.05, 6, 4), MAT.red, side * 0.42, 0.15, -0.6);
  const barrels = new THREE.Group();
  pod.add(barrels);
  const muzzles = [];
  for (const bx of [-0.17, 0.17]) {
    const b = add(barrels, new THREE.CylinderGeometry(0.09, 0.09, 2.2, 10), MAT.dark, bx, -0.55, -1.6);
    b.rotation.x = Math.PI / 2;
    const brake = add(barrels, new THREE.CylinderGeometry(0.14, 0.14, 0.32, 10), MAT.frame, bx, -0.55, -2.7);
    brake.rotation.x = Math.PI / 2;
    const ring = add(barrels, new THREE.TorusGeometry(0.1, 0.025, 6, 12), MAT.orange, bx, -0.55, -2.87);
    ring.rotation.y = 0;
    const mz = new THREE.Object3D();
    mz.position.set(bx, -0.55, -3.0);
    barrels.add(mz);
    muzzles.push(mz);
  }
  return { pod, barrels, muzzles };
}

function bar(parent, a, b, t = 0.07) {
  const len = a.distanceTo(b);
  const m = add(parent, B(t, t, len), MAT.frame, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  m.lookAt(parent.localToWorld(b.clone()));
  return m;
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
    this.radius = 2.2;
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

    this.legL = buildLeg(-1);
    this.legR = buildLeg(1);
    this.root.add(this.legL, this.legR);
    add(this.root, B(1.8, 0.4, 1.0), MAT.dark, 0, 3.0, 0);

    // Kokpit kafesi
    const cage = new THREE.Group();
    cage.position.y = 3.2;
    this.root.add(cage);
    this.cage = cage;
    this.root.updateMatrixWorld(true);
    add(cage, B(1.4, 0.08, 1.1), MAT.dark, 0, 0, 0);
    add(cage, B(1.36, 1.2, 0.06), MAT.dark, 0, 0.6, 0.5);
    for (const x of [-0.68, 0.68]) for (const z of [-0.5, 0.5]) add(cage, B(0.07, 1.75, 0.07), MAT.frame, x, 0.875, z);
    for (const z of [-0.5, 0.5]) add(cage, B(1.36, 0.07, 0.07), MAT.frame, 0, 1.75, z);
    for (const x of [-0.68, 0.68]) add(cage, B(0.07, 0.07, 1.0), MAT.frame, x, 1.75, 0);
    add(cage, B(1.36, 0.06, 0.06), MAT.frame, 0, 0.9, -0.5);
    cage.updateMatrixWorld(true);
    bar(cage, new THREE.Vector3(-0.68, 1.75, -0.5), new THREE.Vector3(-0.3, 2.0, -0.2));
    bar(cage, new THREE.Vector3(0.68, 1.75, -0.5), new THREE.Vector3(0.3, 2.0, -0.2));
    add(cage, B(0.6, 0.07, 0.6), MAT.frame, 0, 2.0, 0.05);
    add(cage, B(0.6, 0.12, 0.5), MAT.dark, 0, 0.55, 0.2);
    add(cage, B(0.6, 0.7, 0.1), MAT.dark, 0, 0.9, 0.45);
    for (const x of [-0.25, 0.25]) {
      const s = add(cage, new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6), MAT.dark, x, 0.75, -0.12);
      s.rotation.x = -0.4;
    }
    for (const x of [-0.38, 0.38]) {
      const scr = add(cage, new THREE.PlaneGeometry(0.28, 0.16), MAT.screen, x, 1.15, -0.42);
      scr.rotation.x = -0.3;
    }
    this.pilot = new THREE.Group();
    add(this.pilot, B(0.42, 0.55, 0.3), MAT.pilot, 0, 0.95, 0.2);
    add(this.pilot, new THREE.SphereGeometry(0.15, 10, 8), MAT.pilot, 0, 1.4, 0.15);
    this.pilot.visible = false;
    cage.add(this.pilot);

    for (const s of [-1, 1]) add(this.root, B(0.4, 0.55, 0.6), MAT.frame, s * 0.95, 4.45, 0.05);
    const L = buildPod(-1), R = buildPod(1);
    this.pods = [L, R];
    this.root.add(L.pod, R.pod);
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 0.3, 4.0, 0.6), new THREE.Vector3(s * 0.9, 4.95, 0.55), new THREE.Vector3(s * 1.5, 4.4, 0.45),
      ]);
      this.root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.08, 6), MAT.brass));
    }

    for (const x of [-0.45, 0.45]) {
      add(cage, new THREE.BoxGeometry(0.2, 0.12, 0.08), MAT.dark, x, 1.86, -0.5);
      add(cage, new THREE.BoxGeometry(0.16, 0.08, 0.02), MAT.head, x, 1.86, -0.545);
    }
    this.head = new THREE.Vector3(0, 4.6, 0.05);
    this.blob = makeBlob(game.scene, 2.8, 0.85);
    game.scene.add(this.root);
  }

  get targetable() { return this.alive; }
  targetPos(out) { return out.set(this.pos.x, this.pos.y + 3.6, this.pos.z); }

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

  canEnter(p) { return this.alive && !this.manned && _v.set(p.x - this.pos.x, 0, p.z - this.pos.z).length() < 4.2; }
  exitPos(out) {
    return out.set(this.pos.x + Math.cos(this.bodyYaw) * 2.8, 0, this.pos.z - Math.sin(this.bodyYaw) * 2.8);
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
    this.aimPitch = THREE.MathUtils.clamp(this.aimPitch + look.pitch, -0.5, 0.75);

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
    collide(this.pos, 1.6, this.game.colliders);

    this.weapons(dt, input.fire);
  }

  // Pilotsuz APU: en yakın düşmana kısa seriler
  ai(dt) {
    if (this.manned || !this.alive) return;
    const sw = this.game.swarm;
    this.aiT = (this.aiT || 0) - dt;
    if (this.aiT <= 0) {
      this.aiT = 0.5;
      this.aiTarget = sw.nearest(this.targetPos(_v), 75);
    }
    let firing = false;
    if (sw.isAlive(this.aiTarget)) {
      const e = sw.posOf(this.aiTarget, _w);
      this.targetPos(_v);
      const dx = e.x - _v.x, dy = e.y - _v.y, dz = e.z - _v.z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.5, 0.75);
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
      this.game.effects.flash(from, this.manned && this.view === 'inside' ? 1.0 : 1.6, 0.04);
      this.recoil[s] = 0.22;
      this.heat += aimAt ? 1.2 : 1.9;
      if (this.manned) {
        this.game.effects.casing(pod.pod.getWorldPosition(_w), s === 0 ? -1 : 1);
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
    this.legL.rotation.x = s * 0.38 * k;
    this.legR.rotation.x = -s * 0.38 * k;
    this.root.position.y = Math.abs(s) * 0.12 * k;
    if (k > 0.3 && Math.sign(s) !== Math.sign(this.lastSin)) {
      const foot = (s > 0 ? this.legR : this.legL).getWorldPosition(_w);
      foot.y = 0.1;
      this.game.effects.dust(foot, 8);
      if (this.manned) { this.game.addShake(0.3); sfx.step(); }
    }
    this.lastSin = s;
    this.root.rotation.y = this.bodyYaw;
    const rel = THREE.MathUtils.clamp(Math.atan2(Math.sin(this.aimYaw - this.bodyYaw), Math.cos(this.aimYaw - this.bodyYaw)), -0.7, 0.7);
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
      _v.set(2.2, 1.2, 9.5).applyEuler(_e);
      cam.position.set(this.pos.x, 5.2, this.pos.z).add(_v);
      cam.position.y = Math.max(1, cam.position.y);
      cam.rotation.set(this.aimPitch, this.aimYaw, 0, 'YXZ');
    }
  }
}
