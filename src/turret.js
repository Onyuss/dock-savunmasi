import * as THREE from 'three';
import { makeBlob } from './world.js';
import { models } from './models.js';
import { sfx } from './audio.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler();

// Sabit savunma kulesi: ikiz namlulu uçaksavar. Model Blender'da üretilir:
// Head yatayda döner, Gun dikeyde nişan alır, Muzzle0/1 namlu ağızları.
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

    const g = models.turret.clone(true);
    g.position.copy(this.base);
    this.head = g.getObjectByName('Head');
    this.gun = g.getObjectByName('Gun');
    this.muzzles = [g.getObjectByName('Muzzle0'), g.getObjectByName('Muzzle1')];
    makeBlob(game.scene, 4.5, 0.8).position.set(x, 0.03, z);
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
      this.cd = aimAt ? 0.22 : 0.07 * this.game.shop.rate;
      this.sinceFire = 0;
      const mz = this.muzzles[this.barrel++ % 2];
      const from = mz.getWorldPosition(new THREE.Vector3());
      const aim = aimAt ? aimAt.clone() : this.game.aimPoint();
      _v.subVectors(aim, from).normalize();
      this.game.shoot(from, _v, { damage: 22 * dmgMul, splash: aimAt ? 0 : 2.6, splashDamage: 14, from, width: 0.1, airburst: !aimAt, player: !aimAt });
      this.game.effects.flash(from, 1.3, 0.04);
      this.heat += aimAt ? 0.3 : 0.45 * this.game.shop.heat;
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
