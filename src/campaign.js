import * as THREE from 'three';
import { buildHammerModel } from './hammer.js';
import { sfx } from './audio.js';

// Oyunun akışı:
//  dock (4 dalga, aralarda dükkân) → hammer (tünelde topçu) → finalPrep (dükkân)
//  → final (kapının kilidini vur) → arrive (kapı açılır, Hammer girer) → emp → zafer
const DOCK_WAVES = 4;
const GATE_POS = new THREE.Vector3(109, 0, 42);

export class Campaign {
  constructor(game, world, hammer, ui) {
    this.game = game;
    this.world = world;
    this.hammer = hammer;
    this.ui = ui;
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
    if (this.busy) return;
    switch (this.phase) {
      case 'dock': return this.updateDock(dt);
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
      g.message('DOCK TUTULDU\nHammer geliyor — arka topun başına geç!', 4);
      this.state = 'done';
      this.transition(3.5, () => this.startHammer());
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
      this.game.message('KİLİT PARÇALANDI\nKapı açılıyor — dayan!', 4);
      this.game.effects.explosion(gate.lockPos, 3);
      sfx.boom();
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
      default:
        return { wave: 'SON GÖREV', info: this.phase === 'emp' ? 'EMP' : 'Hammer giriyor', enemies: g.swarm.alive, objective: '' };
    }
  }
}
