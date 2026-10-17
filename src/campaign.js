import * as THREE from 'three';
import { buildHammerModel } from './hammer.js';
import { Digger, buildLower, buildDockHole, LOWER, LOWER_HOLE, LOWER_BOUNDS, DOCK_HOLE } from './digger.js';
import { setBounds } from './world.js';
import { sfx } from './audio.js';

// Oyunun akışı:
//  dock (4 dalga, aralarda dükkân) → digger (Kazıcı iner, zemini deler) → hole (APU ile atla)
//  → descent (iticilerle iniş) → lower (alt katta Kazıcı'yı yok et)
//  → hammer (tünelde topçu) → finalPrep (dükkân) → final (kapının kilidini vur)
//  → arrive (kapı patlar, Hammer girer) → emp → zafer
const DOCK_WAVES = 4;
const GATE_POS = new THREE.Vector3(109, 0, 42);
const _v = new THREE.Vector3();

export class Campaign {
  constructor(game, world, hammer, ui) {
    this.game = game;
    this.world = world;
    this.hammer = hammer;
    this.ui = ui;
    this.digger = new Digger(game);
    this.lower = buildLower(game.scene);
    this.dockHole = buildDockHole(game.scene);
    this.prompt = '';
    this.inLower = false;
    this.phase = 'dock';
    this.n = 0;
    this.state = 'prep';
    this.timer = 25;
    this.toSpawn = 0;
    this.rate = 0;
    this.acc = 0;
    this.wt = 0;
    this.t = 0;
    this.busy = false;

    // Finalde kapıdan giren Hammer ve EMP küresi
    this.arrival = buildHammerModel();
    this.arrival.group.visible = false;
    this.arrival.group.rotation.y = Math.PI / 2;
    game.scene.add(this.arrival.group);
    this.empSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.2, 3.2), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.empSphere.visible = false;
    game.scene.add(this.empSphere);
  }

  get shopOpen() { return this.state === 'prep' && (this.phase === 'dock' || this.phase === 'finalPrep'); }

  update(dt, input) {
    const g = this.game;
    g.shop.setOpen(this.shopOpen && !this.busy);
    if (this.shopOpen) {
      g.shop.handleKeys(input);
      if (input.hit('Enter')) this.timer = 0;
    }
    this.prompt = '';
    if (this.busy) return;
    switch (this.phase) {
      case 'dock': return this.updateDock(dt);
      case 'digger': return this.updateDigger(dt);
      case 'hole': return this.updateHole(dt, input);
      case 'descent': {
        // Karartma inişin kendi zaman çizelgesine bağlı (düşerken kararır, iticiler açılınca aydınlanır)
        const d = this.descentApu && this.descentApu.descent;
        if (d && d.stage === 'fall' && d.t > 0.75) this.ui.fade(true);
        if (d && d.stage === 'thrust' && d.t > 0.35) this.ui.fade(false);
        this.digger.update(dt, 0);
        return;
      }
      case 'lower': return this.updateLower(dt);
      case 'diggerDeath': return this.updateDiggerDeath(dt);
      case 'hammer': return this.updateHammer(dt);
      case 'finalPrep':
        this.timer -= dt;
        if (this.timer <= 0) this.startFinal();
        return;
      case 'final': return this.updateFinal(dt);
      case 'arrive': return this.updateArrive(dt);
      case 'emp': return this.updateEmp(dt);
      default:
    }
  }

  // ---------- Dock dalgaları
  updateDock(dt) {
    if (this.state === 'prep') {
      this.timer -= dt;
      if (this.timer <= 0) this.startWave();
      return;
    }
    // Filmdeki gibi: önce tek tük, sonra gruplar, sonra kesintisiz sürü
    this.wt += dt;
    const rate = this.wt < 10 ? 0.6 : this.wt < 22 ? 2.2 : this.rate;
    this.spawnFromBreaches(rate, dt);
    if (this.toSpawn <= 0 && this.game.swarm.alive === 0) this.clearWave();
  }

  spawnFromBreaches(rate, dt) {
    this.acc += rate * dt;
    const active = this.world.breaches.filter((b) => b.active && b.open > 0.6);
    while (this.acc >= 1 && this.toSpawn > 0 && active.length) {
      this.acc -= 1;
      if (!this.game.swarm.spawn(active[(Math.random() * active.length) | 0])) break;
      this.toSpawn--;
    }
  }

  openBreaches(count) {
    const order = [1, 0, 2, 3];
    this.world.breaches.forEach((b) => (b.active = false));
    for (let k = 0; k < count; k++) this.world.breaches[order[k]].active = true;
  }

  startWave() {
    this.n++;
    this.state = 'wave';
    this.toSpawn = Math.min(400, 30 + this.n * 25);
    this.rate = 5 + this.n * 2;
    this.acc = 0;
    this.wt = 0;
    this.openBreaches(Math.min(4, this.n));
    this.game.message('DALGA ' + this.n + ' / ' + DOCK_WAVES + '\nTavan delindi!', 3);
    sfx.drill();
  }

  clearWave() {
    const g = this.game;
    this.world.breaches.forEach((b) => (b.active = false));
    for (const a of g.apus) if (a.alive) { a.ammo = [a.ammoMax, a.ammoMax]; a.hp = Math.min(a.maxHp, a.hp + 250); }
    for (const t of g.turrets) if (t.alive) t.hp = Math.min(t.maxHp, t.hp + 200);
    const bonus = 100 * this.n;
    g.shop.earn(bonus);
    if (this.n >= DOCK_WAVES) {
      this.state = 'done';
      this.startDigger();
      return;
    }
    this.state = 'prep';
    this.timer = 25;
    g.message('DALGA ' + this.n + ' TEMİZLENDİ\n+' + bonus + ' kredi · Dükkân açık', 3);
  }

  // Ekranı karartıp ortada bir işlem yapar
  transition(delay, fn) {
    this.busy = true;
    setTimeout(() => {
      this.ui.fade(true);
      setTimeout(() => {
        fn();
        this.ui.fade(false);
        this.busy = false;
      }, 900);
    }, delay * 1000);
  }

  // ---------- Kazıcı: tavandan iner, zemini deler
  startDigger() {
    const d = this.digger;
    this.phase = 'digger';
    this.state = 'descend';
    this.t = 0;
    d.hp = d.maxHp;
    d.alive = true;
    d.minHp = d.maxHp * 0.45;      // Dock'ta yok edilemez: zırhı yarıya inince delmeyi hızlandırır
    d.show(DOCK_HOLE.x, 100, DOCK_HOLE.z);
    this.openBreaches(2);
    this.toSpawn = Infinity;
    this.game.message('KAZICI İNİYOR!\nAteş et — zırhı çok sağlam', 4);
    sfx.drill();
  }

  updateDigger(dt) {
    const d = this.digger;
    const g = this.game;
    this.t += dt;
    d.update(dt, 1.4);
    this.spawnFromBreaches(1, dt);
    if (this.state === 'descend') {
      const fast = d.hp <= d.minHp + 1;
      d.pos.y = Math.max(15, d.pos.y - (fast ? 7 : 3) * dt);
      if (d.pos.y <= 15) { this.state = 'drill'; this.t = 0; g.message('KAZICI ZEMİNİ DELİYOR!', 3); }
    } else if (this.state === 'drill') {
      d.pos.x = DOCK_HOLE.x + (Math.random() - 0.5) * 0.3;
      if (Math.random() < 0.6) g.effects.sparks(_v.set(DOCK_HOLE.x + (Math.random() - 0.5) * 10, 0.3, DOCK_HOLE.z + (Math.random() - 0.5) * 10), 6, undefined, 10);
      if (Math.random() < 0.3) g.effects.smoke(_v.set(DOCK_HOLE.x + (Math.random() - 0.5) * 12, 1, DOCK_HOLE.z + (Math.random() - 0.5) * 12), 3, 2.5, 0.4, 0x4a3a2c);
      g.addShake(0.04);
      if (Math.random() < dt) sfx.drill();
      if (this.t > 6) {
        this.state = 'sink';
        this.dockHole.visible = true;
        g.colliders.push(this.holeCollider = { x: DOCK_HOLE.x, z: DOCK_HOLE.z, r: 9.6 });
        g.effects.bigExplosion(_v.set(DOCK_HOLE.x, 1, DOCK_HOLE.z), 1.5);
        sfx.boom();
      }
    } else if (this.state === 'sink') {
      d.pos.y -= 8 * dt;
      if (d.pos.y < -14) {
        d.hide();
        this.phase = 'hole';
        g.message('KAZICI ALT KATA GEÇTİ!\nBir APU’ya bin ve delikten atla', 5);
      }
    }
  }

  // ---------- Delik: APU ile atla
  updateHole(dt, input) {
    const g = this.game;
    this.spawnFromBreaches(2, dt);
    const p = g.pawn;
    const pos = p.kind === 'infantry' ? p.pos : p.pos;
    const dist = Math.hypot(pos.x - DOCK_HOLE.x, pos.z - DOCK_HOLE.z);
    if (dist < 15) {
      if (p.kind === 'apu' && p.alive) {
        this.prompt = (this.game.isTouch ? 'ZIPLA' : 'SPACE') + ' — delikten atla';
        if (input.hit('Space')) this.startDescent(p);
      } else if (p.kind === 'infantry') {
        this.prompt = 'Delikten yalnız APU ile inilir — bir APU’ya bin';
      }
    }
  }

  startDescent(apu) {
    this.phase = 'descent';
    this.descentApu = apu;
    if (this.onUnlock) this.onUnlock(2);
    apu.descend(_v.set(LOWER_HOLE.x, 0, LOWER_HOLE.z), () => this.enterLower(apu), () => this.onLanded(), DOCK_HOLE);
  }

  // Alt kata geçiş (ekran kararmışken)
  enterLower(apu) {
    const g = this.game;
    this.inLower = true;
    this.lower.root.visible = true;
    setBounds(LOWER_BOUNDS);
    g.colliders = this.lower.colliders;
    g.targets = [g.infantry, apu];
    g.swarm.clearAll();
    this.world.breaches.forEach((b) => (b.active = false));
    const d = this.digger;
    d.minHp = 0;
    d.show(LOWER.x, -1.5, -16);
  }

  onLanded() {
    this.phase = 'lower';
    this.acc = 0;
    this.game.message('ALT KAT\nKazıcı’yı yok et!', 4);
  }

  updateLower(dt) {
    const g = this.game;
    const d = this.digger;
    d.update(dt, 1.2);
    // Tavandaki delikten de sentinel iner
    this.acc += 0.9 * dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      _v.set(LOWER_HOLE.x + (Math.random() - 0.5) * 10, 44, LOWER_HOLE.z + (Math.random() - 0.5) * 10);
      g.swarm.spawnAt(_v, new THREE.Vector3(0, -8, 0));
    }
    // Kazıcı'ya çok yaklaşmak yakar
    const p = g.pawn;
    if (p.alive !== false && p.pos && Math.hypot(p.pos.x - d.pos.x, p.pos.z - d.pos.z) < 17) {
      p.damage(35 * dt);
      if (Math.random() < 0.3) g.effects.sparks(_v.set(p.pos.x, 2, p.pos.z), 3, undefined, 5);
    }
    if (!d.alive) { this.phase = 'diggerDeath'; this.t = 0; this.boomT = 0; g.message('KAZICI ÇÖKÜYOR!', 3); }
  }

  updateDiggerDeath(dt) {
    const g = this.game;
    const d = this.digger;
    this.t += dt;
    d.update(dt, 0);
    this.boomT -= dt;
    if (this.t < 2.6 && this.boomT <= 0) {
      this.boomT = 0.22;
      g.effects.explosion(_v.set(d.pos.x + (Math.random() - 0.5) * 12, d.pos.y + 2 + Math.random() * 14, d.pos.z + (Math.random() - 0.5) * 12), 2);
      g.addShake(0.2);
      sfx.boom();
    }
    if (this.t >= 2.6 && d.active) {
      for (let k = 0; k < 3; k++) g.effects.bigExplosion(_v.set(d.pos.x + (k - 1) * 4, d.pos.y + 6 + k * 3, d.pos.z), 2);
      d.hide();
      g.swarm.killAll();
      g.addShake(1);
      g.shop.earn(800);
      g.message('KAZICI YOK EDİLDİ\n+800 kredi · Hammer geliyor!', 4);
      this.transition(3.5, () => { this.leaveLower(); this.startHammer(); });
    }
  }

  // Alt kattan çık: APU Dock'taki yerine döner
  leaveLower() {
    const g = this.game;
    this.inLower = false;
    this.lower.root.visible = false;
    setBounds(null);
    g.colliders = this.world.colliders;
    g.targets = [g.infantry, ...g.apus, ...g.turrets];
    const a = this.descentApu;
    if (a && a.home) { a.pos.copy(a.home); a.lift = 0; }
    if (g.infantry.inVehicle === null && !g.infantry.alive) { g.infantry.alive = true; g.infantry.hp = g.infantry.maxHp; }
  }

  respawnPoint(out) {
    if (this.inLower) return out.set(LOWER_HOLE.x - 8, 0, LOWER_HOLE.z);
    return null;
  }

  // Bölüm seçiminden doğrudan alt kata başla (iniş animasyonuyla)
  startLowerDirect() {
    const g = this.game;
    const apu = g.apus[2];
    this.n = DOCK_WAVES;
    g.possess(apu);
    apu.view = 'inside';
    this.phase = 'descent';
    this.descentApu = apu;
    this.enterLower(apu);
    apu.pos.set(LOWER_HOLE.x, 0, LOWER_HOLE.z);
    apu.descent = { t: 0, stage: 'thrust', landing: apu.pos.clone(), onDone: () => this.onLanded(), thr: 0 };
    apu.lift = 40;
  }

  // ---------- Hammer
  startHammer() {
    this.phase = 'hammer';
    this.state = 'run';
    this.hammer.start();
    this.game.message('HAMMER\nGemiyi Zion’a kadar koru!', 3.5);
  }

  updateHammer(dt) {
    const r = this.hammer.update(dt);
    if (r === 'lose') this.gameOver('HAMMER DÜŞTÜ', 'Sürü gemiyi parçaladı. Zion kapısına ulaşılamadı.');
    else if (r === 'win') {
      this.state = 'done';
      this.game.message('HAMMER ZION’A ULAŞTI\nAma kapı kapalı!', 3.5);
      this.transition(2.5, () => this.backToDock());
    }
  }

  backToDock() {
    const g = this.game;
    this.hammer.stop();
    g.swarm.clearAll();
    g.targets = [g.infantry, ...g.apus, ...g.turrets];
    const inf = g.infantry;
    inf.pos.set(40, 0, 36);
    inf.yaw = -Math.PI / 2 + 0.3;
    inf.pitch = 0;
    if (!inf.alive) { inf.alive = true; inf.hp = inf.maxHp; }
    g.possess(inf);
    for (const v of [...g.apus, ...g.turrets]) if (v.alive) v.hp = Math.min(v.maxHp, v.hp + v.maxHp * 0.5);
    for (const a of g.apus) if (a.alive) a.ammo = [a.ammoMax, a.ammoMax];
    this.phase = 'finalPrep';
    this.state = 'prep';
    this.timer = 25;
    g.message('SON GÖREV\nKapıyı açmak için kilidini vur — önce hazırlan', 4);
  }

  // ---------- Final: kapı
  startFinal() {
    this.phase = 'final';
    this.state = 'wave';
    this.toSpawn = Infinity;
    this.acc = 0;
    this.openBreaches(4);
    this.game.message('KAPININ KİLİDİNİ VUR!\nDoğu duvarı, kırmızı ışıklı kilit', 4);
    sfx.drill();
  }

  updateFinal(dt) {
    this.spawnFromBreaches(5.5, dt);
    const gate = this.world.gate;
    if (!gate.lockAlive && !this.lockDown) {
      this.lockDown = true;
      this.game.message('KİLİT PARÇALANDI\nKAPI PATLADI — Hammer geliyor!', 4);
      gate.blowUp(this.game.effects);
      this.game.addShake(0.8);
      sfx.boom();
      setTimeout(() => sfx.boom(), 250);
    }
    if (gate.isOpen) this.startArrival();
  }

  startArrival() {
    this.phase = 'arrive';
    this.t = 0;
    this.arrival.group.visible = true;
    this.game.message('HAMMER GİRİYOR!', 3);
  }

  updateArrive(dt) {
    this.t += dt;
    this.spawnFromBreaches(4, dt);
    const k = Math.min(1, this.t / 5);
    const e = 1 - Math.pow(1 - k, 3);
    this.arrival.group.position.set(THREE.MathUtils.lerp(260, 35, e), 9 + Math.sin(this.t * 2) * 0.3, GATE_POS.z);
    if (k >= 1) this.startEmp();
  }

  startEmp() {
    const g = this.game;
    this.phase = 'emp';
    this.t = 0;
    this.empSphere.position.copy(this.arrival.group.position);
    this.empSphere.visible = true;
    this.toSpawn = 0;
    this.world.breaches.forEach((b) => (b.active = false));
    g.flashT = 1.2;
    g.addShake(1);
    sfx.emp();
    g.message('EMP!', 3);
  }

  updateEmp(dt) {
    const g = this.game;
    this.t += dt;
    const s = Math.min(1, this.t / 1.6);
    this.empSphere.scale.setScalar(5 + s * 260);
    this.empSphere.material.opacity = 0.6 * (1 - s);
    if (this.t > 0.4 && !this.empDone) { this.empDone = true; g.swarm.killAll(); }
    if (s >= 1) this.empSphere.visible = false;
    if (this.t > 7) this.victory();
  }

  // ---------- Bitiş
  victory() {
    this.phase = 'end';
    this.ui.end(true, 'ZION KURTARILDI', 'Hammer’ın EMP’si sürüyü durdurdu. Dock ayakta.');
  }

  gameOver(title, text) {
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.ui.end(false, title, text);
  }

  // HUD metinleri
  hud() {
    const g = this.game;
    switch (this.phase) {
      case 'dock':
        return {
          wave: 'DALGA ' + this.n + ' / ' + DOCK_WAVES,
          info: this.state === 'prep' ? 'Hazırlık ' + Math.ceil(Math.max(0, this.timer)) + ' sn · Enter: hazırım' : 'Sürü saldırıyor',
          enemies: g.swarm.alive + (this.state === 'wave' ? this.toSpawn : 0),
          objective: this.state === 'prep' ? 'Dükkândan geliştirme al (1–7)' : 'Dock’u tut',
        };
      case 'hammer':
        return { wave: 'HAMMER', info: 'Zion’a ' + Math.ceil(this.hammer.timeLeft) + ' sn', enemies: g.swarm.alive, objective: 'Gemiyi koru · gövde ' + Math.ceil(this.hammer.hull / this.hammer.hullMax * 100) + '%' };
      case 'finalPrep':
        return { wave: 'SON GÖREV', info: 'Hazırlık ' + Math.ceil(Math.max(0, this.timer)) + ' sn · Enter: hazırım', enemies: 0, objective: 'Dükkândan geliştirme al (1–7)' };
      case 'final': {
        const gate = this.world.gate;
        return {
          wave: 'SON GÖREV', info: gate.lockAlive ? 'Kilit ' + Math.ceil(gate.lockHp / gate.lockMax * 100) + '%' : 'Kapı açılıyor', enemies: g.swarm.alive,
          objective: gate.lockAlive ? 'Doğu kapısının kırmızı kilidini vur' : 'Kapı açılana kadar dayan',
        };
      }
      case 'digger':
        return { wave: 'KAZICI', info: 'Zırh ' + Math.ceil(this.digger.pct * 100) + '%', enemies: g.swarm.alive, objective: this.state === 'descend' ? 'Kazıcı iniyor — ateş et!' : 'Kazıcı zemini deliyor!' };
      case 'hole':
        return { wave: 'KAZICI', info: 'Delik açıldı', enemies: g.swarm.alive, objective: 'APU ile delikten atla (' + (g.isTouch ? 'ZIPLA' : 'SPACE') + ')' };
      case 'descent':
        return { wave: 'ALT KAT', info: 'İniş', enemies: g.swarm.alive, objective: 'İticiler devrede…' };
      case 'lower':
      case 'diggerDeath':
        return { wave: 'ALT KAT', info: 'Kazıcı ' + Math.ceil(this.digger.pct * 100) + '%', enemies: g.swarm.alive, objective: 'Kazıcı’yı yok et — çok yaklaşma, yakar' };
      default:
        return { wave: 'SON GÖREV', info: this.phase === 'emp' ? 'EMP' : 'Hammer giriyor', enemies: g.swarm.alive, objective: '' };
    }
  }
}
