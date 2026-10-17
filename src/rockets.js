import * as THREE from 'three';
import { sfx } from './audio.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const SMOKE = new THREE.Color(0.32, 0.3, 0.28);
const FIRE = new THREE.Color(1, 0.6, 0.2);

// Roket: her N atışta bir dolar (dükkândan geliştirilir), Q / ROKET düğmesiyle atılır,
// patladığı yerde geniş alana büyük hasar verir.
export class Rockets {
  constructor(game) {
    this.game = game;
    this.charge = 0;
    this.pool = [];
    const body = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d3a, metalness: 0.7, roughness: 0.4 });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 10), mat);
    tube.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 10), mat);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.72;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.7, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.5) }));
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -0.85;
    body.add(tube, nose, flame);
    for (let i = 0; i < 8; i++) {
      const m = body.clone();
      m.visible = false;
      game.scene.add(m);
      this.pool.push({ mesh: m, live: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, max: 0, player: true, smoke: 0 });
    }
  }

  get ready() { return this.charge >= this.game.shop.rocketEvery; }
  get progress() { return Math.min(1, this.charge / this.game.shop.rocketEvery); }

  // Oyuncunun her atışı şarjı doldurur
  addShot() { if (!this.ready) this.charge++; }

  fire(from, target) {
    if (!this.ready) return false;
    const r = this.pool.find((p) => !p.live);
    if (!r) return false;
    this.charge = 0;
    r.live = true;
    r.pos.copy(from);
    r.dir.subVectors(target, from).normalize();
    r.max = Math.min(400, from.distanceTo(target) + 2);
    r.dist = 0;
    r.mesh.visible = true;
    this.game.effects.flash(from, 1.8, 0.06);
    this.game.addShake(0.2);
    sfx.rocket();
    return true;
  }

  update(dt) {
    const g = this.game;
    for (const r of this.pool) {
      if (!r.live) continue;
      const step = 95 * dt;
      r.pos.addScaledVector(r.dir, step);
      r.dist += step;
      r.mesh.position.copy(r.pos);
      r.mesh.quaternion.copy(_q.setFromUnitVectors(Z, r.dir));
      r.smoke -= dt;
      if (r.smoke <= 0) {
        r.smoke = 0.015;
        g.effects.spawn(r.pos, _v.set((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8 + 0.4, (Math.random() - 0.5) * 0.8), SMOKE, 1.1, -0.05);
        g.effects.spawn(r.pos, _v.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2), FIRE, 0.15, 0);
      }
      const near = g.swarm.nearest(r.pos, 3);
      const lock = g.gateLockHit && g.gateLockHit(r.pos, 2.5);
      if (near >= 0 || lock || r.pos.y <= 0.3 || r.dist >= r.max) this.explode(r);
    }
  }

  explode(r) {
    const g = this.game;
    r.live = false;
    r.mesh.visible = false;
    g.effects.explosion(r.pos, 3.2);
    g.swarm.damageRadius(r.pos, 11, 260 * g.shop.dmg, -1, true);
    if (g.damageGateLock) g.damageGateLock(r.pos, 8, 220 * g.shop.dmg);
    const d = r.pos.distanceTo(g.camera.position);
    g.addShake(Math.max(0, 0.6 - d / 120));
    sfx.boom();
  }
}
