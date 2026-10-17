import * as THREE from 'three';
import { sfx } from './audio.js';

const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const FIRE = new THREE.Color(1, 0.6, 0.2);

function flareTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.3, 'rgba(255,180,90,0.8)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Güdümlü roket: her N atışta dolar (dükkândan geliştirilir), Q / ROKET ile atılır.
// Atıldığı an nişangâha en yakın sentinele (ya da finalde kapı kilidine) kilitlenir,
// onu takip eder; hedef ölürse yakındakine geçer. Mutlaka bir şeye çarpıp patlar.
export class Rockets {
  constructor(game) {
    this.game = game;
    this.charge = 0;
    this.pool = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a4d48, metalness: 0.7, roughness: 0.4 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0x9a7a2a, metalness: 0.4, roughness: 0.6 });
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.6) });
    const flareMat = new THREE.SpriteMaterial({ map: flareTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.6, 12), mat);
      tube.rotation.x = Math.PI / 2;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.18, 12), stripe);
      band.rotation.x = Math.PI / 2;
      band.position.z = 0.4;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.55, 12), mat);
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 1.07;
      for (let k = 0; k < 4; k++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.4), mat);
        fin.position.set(Math.cos(k * Math.PI / 2) * 0.22, Math.sin(k * Math.PI / 2) * 0.22, -0.65);
        fin.rotation.z = k * Math.PI / 2;
        g.add(fin);
      }
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.1, 10), flameMat);
      flame.rotation.x = -Math.PI / 2;
      flame.position.z = -1.35;
      const flare = new THREE.Sprite(flareMat);
      flare.scale.setScalar(2.6);
      flare.position.z = -1.0;
      g.add(tube, band, nose, flame, flare);
      g.visible = false;
      game.scene.add(g);
      this.pool.push({ mesh: g, flame, live: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), goal: new THREE.Vector3(), speed: 0, life: 0, lock: -1, lockGate: false, smoke: 0 });
    }
    // Tek, sabit ışık: en son roketi izler (ışık sayısı değişmesin diye hep sahnede)
    this.light = new THREE.PointLight(0xffa050, 0, 30, 1.6);
    game.scene.add(this.light);
  }

  get ready() { return this.charge >= this.game.shop.rocketEvery; }
  get progress() { return Math.min(1, this.charge / this.game.shop.rocketEvery); }

  // Oyuncunun her atışı şarjı doldurur
  addShot() { if (!this.ready) this.charge++; }

  // Nişangâha en yakın düşmanı seç (en fazla ~9°)
  pickLock(origin, dir) {
    const sw = this.game.swarm;
    let best = 0.16, hit = -1;
    for (let i = 0; i < sw.max; i++) {
      if (!sw.isAlive(i)) continue;
      sw.posOf(i, _v).sub(origin);
      const d = _v.length();
      if (d < 4 || d > 350) continue;
      const a = Math.acos(THREE.MathUtils.clamp(_v.dot(dir) / d, -1, 1));
      if (a < best) { best = a; hit = i; }
    }
    return hit;
  }

  fire(from, aimOrigin, aimDir, aimPoint) {
    if (!this.ready) return null;
    const r = this.pool.find((p) => !p.live);
    if (!r) return null;
    const g = this.game;
    this.charge = 0;
    r.live = true;
    r.life = 0;
    r.smoke = 0;
    r.pos.copy(from);
    r.lock = this.pickLock(aimOrigin, aimDir);
    r.lockGate = false;
    r.goal.copy(aimPoint);
    if (r.lock < 0 && g.gateLockTarget) {
      const lock = g.gateLockTarget();
      if (lock && _v.copy(lock).sub(aimOrigin).normalize().dot(aimDir) > 0.985) { r.lockGate = true; r.goal.copy(lock); }
    }
    // Çıkışta hafifçe yukarı kalkar, sonra hedefe döner
    r.dir.subVectors(r.goal, from).normalize().add(_v.set(0, 0.25, 0)).normalize();
    r.speed = 30;
    r.mesh.visible = true;
    g.effects.flash(from, 2.2, 0.08);
    for (let k = 0; k < 5; k++) g.effects.smoke(from, 0.8 + Math.random() * 0.6, 1.2, 0.5);
    g.addShake(0.25);
    sfx.rocket();
    return r.lock >= 0 ? 'enemy' : r.lockGate ? 'gate' : 'point';
  }

  update(dt) {
    const g = this.game;
    const sw = g.swarm;
    let lit = null;
    for (const r of this.pool) {
      if (!r.live) continue;
      r.life += dt;
      // Hedef: kilitli sentinel (ölürse yakındaki), kapı kilidi ya da nişan noktası
      if (r.lock >= 0) {
        if (sw.isAlive(r.lock)) sw.posOf(r.lock, r.goal);
        else r.lock = sw.nearest(r.goal, 30);
      }
      _t.subVectors(r.goal, r.pos);
      const dist = _t.length();
      _t.divideScalar(dist || 1);
      const turn = r.life < 0.25 ? 2 : 7;
      r.dir.lerp(_t, Math.min(1, dt * turn)).normalize();
      r.speed = Math.min(80, r.speed + 70 * dt);
      r.pos.addScaledVector(r.dir, r.speed * dt);
      r.mesh.position.copy(r.pos);
      r.mesh.quaternion.copy(_q.setFromUnitVectors(Z, r.dir));
      r.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
      // İz: gri duman bulutları + alev kıvılcımları
      r.smoke -= dt;
      if (r.smoke <= 0) {
        r.smoke = 0.025;
        _v.copy(r.pos).addScaledVector(r.dir, -1.4);
        g.effects.smoke(_v, 0.5 + Math.random() * 0.3, 1.6 + Math.random() * 0.8, 0.45, 0x8a8a84, _t.set((Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5));
        g.effects.spawn(_v, _t.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3), FIRE, 0.2, 0);
      }
      lit = r;
      const hitEnemy = sw.nearest(r.pos, 2.4) >= 0;
      if (hitEnemy || dist < 2 || r.pos.y <= 0.4 || r.life > 6 || (g.gateLockHit && g.gateLockHit(r.pos, 2.5))) this.explode(r);
    }
    if (lit) {
      this.light.position.copy(lit.pos);
      this.light.intensity = 60;
    } else this.light.intensity = 0;
  }

  explode(r) {
    const g = this.game;
    r.live = false;
    r.mesh.visible = false;
    r.pos.y = Math.max(0.5, r.pos.y);
    g.effects.bigExplosion(r.pos, 1);
    g.swarm.damageRadius(r.pos, 11, 260 * g.shop.dmg, -1, true);
    if (g.damageGateLock) g.damageGateLock(r.pos, 8, 220 * g.shop.dmg);
    const d = r.pos.distanceTo(g.camera.position);
    g.addShake(Math.max(0, 0.7 - d / 120));
    sfx.boom();
  }
}
