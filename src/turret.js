import * as THREE from 'three';
import { makeBlob } from './world.js';
import { metalMaterial, pbrMaterial } from './textures.js';
import { sfx } from './audio.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler();

const MAT = {
  frame: pbrMaterial('green_metal_rust', { metalness: 0.7, repeat: [2, 2], color: 0xb4bcae }),
  dark: metalMaterial({ cols: 1, rows: 1, color: [40, 44, 42], rivets: false, grime: 0.5, seed: 22, size: 256 }, { metalness: 0.7 }),
  stripe: metalMaterial({ cols: 1, rows: 1, color: [80, 86, 78], stripes: true, grime: 0.6, seed: 23, size: 256 }, { metalness: 0.6 }),
  green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 0.8) }),
  orange: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.0, 0.25) }),
};

function add(parent, geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Sabit savunma kulesi: ikiz namlulu uçaksavar
export class Turret {
  constructor(game, x, z, yaw, index) {
    this.game = game;
    this.kind = 'turret';
    this.label = 'KULE-' + (index + 1);
    this.base = new THREE.Vector3(x, 0, z);
    this.pos = this.base;
    this.maxHp = 900;
    this.hp = 900;
    this.alive = true;
    this.radius = 2.4;
    this.heat = 0;
    this.overheated = false;
    this.cd = 0;
    this.barrel = 0;
    this.sinceFire = 10;
    this.manned = false;
    this.aimYaw = yaw;
    this.homeYaw = yaw;
    this.aimPitch = 0.35;
    this.idleT = Math.random() * 10;

    const g = new THREE.Group();
    g.position.copy(this.base);
    add(g, new THREE.CylinderGeometry(1.3, 1.9, 8, 10), MAT.frame, 0, 4, 0);
    for (let y = 1; y < 8; y += 0.6) add(g, new THREE.BoxGeometry(0.9, 0.06, 0.06), MAT.dark, 0, y, 1.75);
    add(g, new THREE.CylinderGeometry(2.8, 2.8, 0.4, 16), MAT.dark, 0, 8.2, 0);
    const rail = add(g, new THREE.TorusGeometry(2.8, 0.05, 4, 24), MAT.green, 0, 8.45, 0);
    rail.rotation.x = Math.PI / 2;

    this.head = new THREE.Group();
    this.head.position.y = 8.6;
    g.add(this.head);
    add(this.head, new THREE.CylinderGeometry(1.1, 1.3, 0.8, 12), MAT.frame, 0, 0.4, 0);
    add(this.head, new THREE.BoxGeometry(0.7, 0.6, 0.7), MAT.dark, 0, 0.9, 0.9);
    this.gun = new THREE.Group();
    this.gun.position.set(0, 1.3, 0);
    this.head.add(this.gun);
    add(this.gun, new THREE.BoxGeometry(1.6, 0.7, 1.4), MAT.frame, 0, 0, 0);
    add(this.gun, new THREE.BoxGeometry(2.4, 1.2, 0.12), MAT.stripe, 0, 0.3, -0.8);
    add(this.gun, new THREE.BoxGeometry(0.5, 0.6, 1.0), MAT.dark, -1.1, -0.1, 0.2);
    add(this.gun, new THREE.BoxGeometry(0.5, 0.6, 1.0), MAT.dark, 1.1, -0.1, 0.2);
    add(this.gun, new THREE.BoxGeometry(2.42, 0.06, 0.14), MAT.orange, 0, 0.88, -0.8);
    this.muzzles = [];
    for (const bx of [-0.45, 0.45]) {
      const b = add(this.gun, new THREE.CylinderGeometry(0.1, 0.12, 3.6, 10), MAT.dark, bx, 0, -2.4);
      b.rotation.x = Math.PI / 2;
      const mz = new THREE.Object3D();
      mz.position.set(bx, 0, -4.3);
      this.gun.add(mz);
      this.muzzles.push(mz);
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const strut = add(g, new THREE.BoxGeometry(0.25, 8.6, 0.25), MAT.dark, Math.cos(a) * 2.3, 4, Math.sin(a) * 2.3);
      strut.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
    }
    makeBlob(game.scene, 4, 0.8).position.set(x, 0.03, z);
    this.group = g;
    game.scene.add(g);
    game.colliders.push({ x, z, r: 2.1 });
  }

  get targetable() { return this.alive; }
  targetPos(out) { return out.set(this.base.x, 9.5, this.base.z); }

  damage(a) {
    if (!this.alive) return;
    this.hp -= a;
    if (this.game.pawn === this) this.game.hurt();
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.game.effects.explosion(this.targetPos(_v), 2.5);
      this.head.rotation.z = 0.6;
      this.head.position.y = 7.9;
      this.game.onVehicleDestroyed(this);
    }
  }

  canEnter(p) { return this.alive && !this.manned && _v.set(p.x - this.base.x, 0, p.z - this.base.z).length() < 4.4; }
  exitPos(out) { return out.set(this.base.x + Math.sin(this.homeYaw) * 3.4, 0, this.base.z + Math.cos(this.homeYaw) * 3.4); }
  onPossess() { this.manned = true; }
  onRelease() { this.manned = false; }

  update(dt, input) {
    const look = input.look();
    this.aimYaw += look.yaw;
    this.aimPitch = THREE.MathUtils.clamp(this.aimPitch + look.pitch, -0.2, 1.3);
    this.weapons(dt, input.fire);
  }

  // Pilotsuz kule: yapay zekâ nişancı
  ai(dt) {
    if (this.manned || !this.alive) return;
    const sw = this.game.swarm;
    this.aiT = (this.aiT || 0) - dt;
    if (this.aiT <= 0) {
      this.aiT = 0.5;
      this.aiTarget = sw.nearest(this.targetPos(_v), 130);
    }
    let firing = false;
    if (sw.isAlive(this.aiTarget)) {
      const e = sw.posOf(this.aiTarget, _w);
      const dx = e.x - this.base.x, dy = e.y - 9.9, dz = e.z - this.base.z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.2, 1.3);
      const d = Math.atan2(Math.sin(yaw - this.aimYaw), Math.cos(yaw - this.aimYaw));
      this.aimYaw += THREE.MathUtils.clamp(d, -2.5 * dt, 2.5 * dt);
      this.aimPitch = THREE.MathUtils.damp(this.aimPitch, pitch, 5, dt);
      firing = Math.abs(d) < 0.2;
      e.x += (Math.random() - 0.5) * 6; e.y += (Math.random() - 0.5) * 6; e.z += (Math.random() - 0.5) * 6;
    } else {
      this.idleT += dt;
      this.aimYaw = THREE.MathUtils.damp(this.aimYaw, this.homeYaw + Math.sin(this.idleT * 0.3) * 0.5, 1, dt);
      this.aimPitch = THREE.MathUtils.damp(this.aimPitch, 0.35, 1, dt);
    }
    this.weapons(dt, firing, _w, 0.35);
  }

  weapons(dt, firing, aimAt = null, dmgMul = 1) {
    this.cd -= dt;
    this.sinceFire += dt;
    if (firing && !this.overheated && this.cd <= 0) {
      this.cd = aimAt ? 0.22 : 0.07;
      this.sinceFire = 0;
      const mz = this.muzzles[this.barrel++ % 2];
      const from = mz.getWorldPosition(new THREE.Vector3());
      const aim = aimAt ? aimAt.clone() : this.game.aimPoint();
      _v.subVectors(aim, from).normalize();
      this.game.shoot(from, _v, { damage: 22 * dmgMul, splash: aimAt ? 0 : 2.6, splashDamage: 14, from, width: 0.1, airburst: !aimAt });
      this.game.effects.flash(from, 1.3, 0.04);
      this.heat += aimAt ? 1.0 : 1.5;
      if (this.manned) { this.game.addShake(0.06); sfx.flak(); }
      else if (from.distanceTo(this.game.camera.position) < 45) sfx.flak(0.35);
      if (this.heat >= 100) { this.heat = 100; this.overheated = true; sfx.overheat(); }
    }
    this.heat = Math.max(0, this.heat - (this.sinceFire > 0.3 ? 32 : 5) * dt);
    if (this.overheated && this.heat < 35) this.overheated = false;
  }

  animate(dt) {
    if (!this.alive) return;
    this.head.rotation.y = this.aimYaw;
    this.gun.rotation.x = this.aimPitch;
  }

  applyCamera(cam) {
    _e.set(this.aimPitch, this.aimYaw, 0, 'YXZ');
    _v.set(0, 3.1, 4.6).applyEuler(_e);
    cam.position.set(this.base.x, 9.9, this.base.z).add(_v);
    cam.rotation.set(this.aimPitch, this.aimYaw, 0, 'YXZ');
  }
}
