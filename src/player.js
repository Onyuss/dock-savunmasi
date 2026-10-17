import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { collide } from './world.js';
import { metalMaterial } from './textures.js';
import { sfx } from './audio.js';

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Vector3();

// Yaya asker: birinci şahıs, tüfek
export class Infantry {
  constructor(game, spawn) {
    this.game = game;
    this.kind = 'infantry';
    this.label = 'PİYADE';
    this.pos = spawn.clone();
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.onGround = true;
    this.maxHp = 100;
    this.hp = 100;
    this.alive = true;
    this.radius = 0.45;
    this.eye = 1.7;
    this.mag = 30;
    this.ammo = 30;
    this.reload = 0;
    this.cd = 0;
    this.bob = 0;
    this.sinceHurt = 10;
    this.inVehicle = null;

    // Kameraya bağlı tüfek modeli
    const metal = metalMaterial({ cols: 1, rows: 1, color: [46, 50, 48], rivets: false, grime: 0.4, scratches: 1, seed: 31, size: 256, roughness: 0.4 }, { metalness: 0.8, bump: 0.6 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x23261f, roughness: 0.8, metalness: 0.05 });
    const RB = (w, h, d) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.25);
    this.gun = new THREE.Group();
    const part = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      this.gun.add(m);
      return m;
    };
    part(RB(0.075, 0.1, 0.42), metal, 0, 0, -0.05);                                  // gövde
    part(RB(0.07, 0.08, 0.26), polymer, 0, -0.005, -0.36);                          // el kundağı
    part(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 10), metal, 0, 0.012, -0.6, Math.PI / 2);   // namlu
    part(new THREE.CylinderGeometry(0.024, 0.024, 0.07, 8), metal, 0, 0.012, -0.76, Math.PI / 2);  // namlu freni
    part(RB(0.055, 0.17, 0.075), polymer, 0, -0.12, -0.08, 0.18);                   // şarjör
    part(RB(0.05, 0.12, 0.05), polymer, 0, -0.1, 0.1, -0.35);                       // kabza
    part(RB(0.06, 0.09, 0.24), polymer, 0, -0.02, 0.27);                            // dipçik
    part(RB(0.02, 0.012, 0.36), metal, 0, 0.058, -0.12);                            // ray
    part(RB(0.05, 0.05, 0.11), metal, 0, 0.09, -0.07);                              // nişangâh gövdesi
    part(new THREE.CircleGeometry(0.018, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 0.8) }), 0, 0.093, -0.126);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.012, -0.81);
    this.gun.add(this.muzzle);
    this.gunHome = new THREE.Vector3(0.17, -0.17, -0.3);
    this.gun.position.copy(this.gunHome);
    this.gun.scale.setScalar(0.75);
    this.gunAds = new THREE.Vector3(0, -0.085, -0.25);
    game.camera.add(this.gun);
  }

  get targetable() { return this.alive && !this.inVehicle; }
  targetPos(out) { return out.set(this.pos.x, this.pos.y + 1.1, this.pos.z); }

  damage(a) {
    if (!this.alive) return;
    this.hp -= a;
    this.sinceHurt = 0;
    if (this.game.pawn === this) this.game.hurt();
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.game.onInfantryDown(); }
  }

  update(dt, input) {
    const look = input.look();
    this.yaw += look.yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.pitch, -1.5, 1.5);

    const ax = input.axis();
    const sprint = input.sprint() && ax.z > 0;
    const speed = sprint ? 10 : 6;
    _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _m.set(0, 0, 0).addScaledVector(_f, ax.z).addScaledVector(_r, ax.x);
    if (_m.lengthSq() > 0) _m.normalize().multiplyScalar(speed * dt);
    this.pos.add(_m);
    if (_m.lengthSq() > 0 && this.onGround) this.bob += dt * (sprint ? 14 : 10);

    if (this.onGround && input.hit('Space')) { this.vy = 6; this.onGround = false; }
    this.vy -= 18 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.onGround = true; }
    collide(this.pos, this.radius, this.game.colliders);

    // Can yenilenmesi
    this.sinceHurt += dt;
    if (this.sinceHurt > 4) this.hp = Math.min(this.maxHp, this.hp + 8 * dt);

    // Şarjör
    this.cd -= dt;
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) this.ammo = this.mag;
    } else if ((input.hit('KeyR') && this.ammo < this.mag) || this.ammo === 0) {
      this.reload = 1.4;
    }

    if (input.fire && this.cd <= 0 && this.ammo > 0 && this.reload <= 0) {
      this.cd = 0.09;
      this.ammo--;
      const cam = this.game.camera;
      cam.getWorldDirection(_d);
      _d.x += (Math.random() - 0.5) * 0.012;
      _d.y += (Math.random() - 0.5) * 0.012;
      _d.normalize();
      const from = this.muzzle.getWorldPosition(new THREE.Vector3());
      this.game.shoot(cam.position, _d, { damage: 12, from, width: 0.035 });
      this.game.effects.flash(from, 0.45, 0.035);
      this.pitch += 0.005;
      this.gun.position.z += 0.05;
      sfx.rifle();
    }
    this.gun.position.lerp(input.aim ? this.gunAds : this.gunHome, Math.min(1, dt * 14));
    this.gun.visible = this.game.camera.fov > 45;
    this.gun.rotation.x = this.reload > 0 ? -0.6 : 0;
  }

  applyCamera(cam) {
    const b = Math.sin(this.bob) * 0.04;
    cam.position.set(this.pos.x, this.pos.y + this.eye + b, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
