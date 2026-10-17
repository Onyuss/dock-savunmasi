import * as THREE from 'three';
import { collide, makeBlob } from './world.js';
import { models } from './models.js';
import { sfx } from './audio.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _e = new THREE.Euler();

// Yürüyen silah kulesi. Model Blender'da üretilir (tools/build_models.py):
// LegL/LegR kalçadan, ArmL/ArmR omuzdan döner; GunL/GunR bilekten nişan alır;
// BarrelsL/R geri teper; MuzzleXN namlu ağızları; Eye kokpit kamerası.
export class APU {
  constructor(game, spot, index) {
    this.game = game;
    this.kind = 'apu';
    this.label = 'APU-' + (index + 1);
    this.root = models.apu.clone(true);
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
    this.ammoMax = 1500;
    this.ammo = [1500, 1500];
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

    const n = (name) => this.root.getObjectByName(name);
    this.legL = n('LegL');
    this.legR = n('LegR');
    this.pilot = n('Pilot');
    this.pilot.visible = false;
    this.eye = n('Eye');
    this.arms = [{ group: n('ArmL'), side: -1, yaw: 0 }, { group: n('ArmR'), side: 1, yaw: 0 }];
    this.pods = ['L', 'R'].map((s) => ({ pod: n('Gun' + s), spin: n('Spin' + s), barrels: n('Barrels' + s), muzzles: [n('Muzzle' + s + '0'), n('Muzzle' + s + '1')] }));
    this.twirlT = [null, null];   // tabancayı parmakta çevirme (R)
    this.blob = makeBlob(game.scene, 3.2, 0.85);
    game.scene.add(this.root);
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
    this.bodyYaw += THREE.MathUtils.clamp(diff, -0.9 * dt, 0.9 * dt);

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

    if (input.hit('KeyR')) this.twirl();
    this.weapons(dt, input.fire);
  }

  // Filmdeki gibi: iki tabancayı da parmakta fırıldak gibi çevir
  twirl() {
    if (this.twirling) return;
    this.twirlT = [0, -0.18];
    if (this.manned) sfx.twirl();
  }
  get twirling() { return this.twirlT[0] !== null || this.twirlT[1] !== null; }

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
    } else if (Math.random() < dt * 0.04) {
      this.twirl();   // boşta arada bir silahlarını çevirir
    }
    this.weapons(dt, firing, _w, 0.35);
  }

  weapons(dt, firing, aimAt = null, dmgMul = 1) {
    this.cd -= dt;
    this.sinceFire += dt;
    const canFire = firing && !this.overheated && !this.twirling && (this.ammo[0] > 0 || this.ammo[1] > 0);
    if (canFire && this.cd <= 0) {
      this.cd = aimAt ? 0.2 : 0.055 * this.game.shop.rate;
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
      this.game.shoot(from, _v, { damage: 30 * dmgMul, splash: aimAt ? 0 : 1.8, splashDamage: 12, from, width: 0.14, player: !aimAt });
      this.game.effects.flash(from, this.manned && this.view === 'inside' ? 1.1 : 1.7, 0.04);
      this.recoil[s] = 0.22;
      this.heat += aimAt ? 0.35 : 0.45 * this.game.shop.heat;   // ~20 sn kesintisiz ateş
      if (this.manned) {
        this.game.effects.casing(pod.pod.getWorldPosition(_w).add(_v.set(0, -0.9, 0)), s === 0 ? -1 : 1);
        this.game.addShake(0.12);
        sfx.apuGun(s === 0 ? -1 : 1);
      } else if (from.distanceTo(this.game.camera.position) < 45) {
        sfx.apuGun(0, 0.35);
      }
      if (this.heat >= 100) { this.heat = 100; this.overheated = true; sfx.overheat(); }
    }
    const cool = this.sinceFire > 0.35 ? 25 : 3;
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
    // Kollar nişana doğru savrulur: karşı taraftaki kol öne doğru ~57° gelir,
    // kendi tarafındaki kol az döner (yoksa topçu kokpitin arkasına kaçar);
    // kalan açıyı bilekteki topçu tamamlar → iki silah da ±90° hedefi görür
    const rel = THREE.MathUtils.clamp(Math.atan2(Math.sin(this.aimYaw - this.bodyYaw), Math.cos(this.aimYaw - this.bodyYaw)), -1.65, 1.65);
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i];
      const out = THREE.MathUtils.clamp(rel * -arm.side, -1.0, 0.45);
      arm.yaw = THREE.MathUtils.damp(arm.yaw, out * -arm.side, 9, dt);
      arm.group.rotation.y = arm.yaw;
      const wrist = THREE.MathUtils.clamp(rel - arm.yaw, -1.45, 1.45);
      const p = this.pods[i];
      p.pod.rotation.set(this.aimPitch, wrist, 0, 'YXZ');
      this.recoil[i] = THREE.MathUtils.damp(this.recoil[i], 0, 18, dt);
      p.barrels.position.z = this.recoil[i];
      // Parmakta çevirme: iki tam tur, yumuşak başlayıp yumuşak biter
      if (this.twirlT[i] !== null) {
        this.twirlT[i] += dt;
        const k = THREE.MathUtils.clamp(this.twirlT[i] / 0.75, 0, 1);
        p.spin.rotation.x = -(k * k * (3 - 2 * k)) * Math.PI * 4;
        if (k >= 1) { this.twirlT[i] = null; p.spin.rotation.x = 0; }
      }
    }
  }

  applyCamera(cam) {
    if (this.view === 'inside') {
      this.root.updateMatrixWorld(true);
      this.eye.getWorldPosition(cam.position);
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
