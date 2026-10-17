import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Input } from './input.js';
import { initAudio, sfx } from './audio.js';
import { Effects } from './effects.js';
import { buildWorld, buildEnvironment } from './world.js';
import { Infantry } from './player.js';
import { APU } from './apu.js';
import { Turret } from './turret.js';
import { Swarm } from './enemies.js';
import { isTouch, setupTouch, enterFullscreen } from './touch.js';
import { Shop } from './shop.js';
import { Rockets } from './rockets.js';
import { HammerLevel } from './hammer.js';
import { Campaign } from './campaign.js';
import { loadModels } from './models.js';

// --- Görüntüleyici (dahili ekran kartları için hafif ayarlar)
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio, 1);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060a08);
scene.fog = new THREE.FogExp2(0x0a120e, 0.0032);
scene.environment = buildEnvironment(renderer);
scene.environmentIntensity = 0.9;
// Gerçek bir endüstriyel mekândan çekilmiş HDRI (Poly Haven, CC0): metallere gerçekçi yansıma
new RGBELoader().load('assets/hdri/industrial_pipe_and_valve_01_1k.hdr', (hdr) => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 0.45;
  scene.environmentRotation.y = 1.2;
  hdr.dispose();
  pmrem.dispose();
});
scene.add(new THREE.HemisphereLight(0x6f8f7a, 0x070908, 0.35));
const moon = new THREE.DirectionalLight(0xbfdccb, 0.45);
moon.position.set(20, 60, 30);
scene.add(moon);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 600);
scene.add(camera);

// Son işleme: parlama → ton eşleme → kenar yumuşatma → sinematik renk, vinyet, gren
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) }, uHurt: { value: 0 }, uFlash: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uHurt; uniform float uFlash;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      float ca = 0.0012 + d * 0.006;
      vec3 col = vec3(texture2D(tDiffuse, vUv + c * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ca).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.82, 1.04, 0.9), 0.45 * (1.0 - l));      // gölgeler yeşile
      col = mix(col, col * vec3(1.06, 1.0, 0.92), 0.3 * l);               // ışıklar sıcağa
      col = (col - 0.5) * 1.1 + 0.5;
      col *= 1.0 - d * 1.25;
      col = mix(col, col * vec3(1.4, 0.5, 0.45), uHurt * smoothstep(0.05, 0.3, d));
      float n = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.04;
      col = mix(col, vec3(0.85, 0.95, 1.0), clamp(uFlash, 0.0, 1.0));   // EMP beyaz flaş
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.6, 0.5, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const fxaa = new ShaderPass(FXAAShader);
composer.addPass(fxaa);
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);
let bloomOn = true;

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  const pr = renderer.getPixelRatio();
  fxaa.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
  grade.uniforms.uRes.value.set(innerWidth * pr, innerHeight * pr);
}
addEventListener('resize', resize);
resize();

// --- Oyun durumu
const input = new Input(canvas);
const world = buildWorld(scene);
const $ = (id) => document.getElementById(id);

const game = {
  scene, camera, input,
  colliders: world.colliders,
  effects: new Effects(scene),
  targets: [],
  apus: [],
  turrets: [],
  pawn: null,
  time: 0,
  shake: 0,
  kills: 0,
  hurtT: 0,
  respawnT: 0,
  msgT: 0,
  flashT: 0,
  lives: 3,
  defensesDown: false,

  addShake(a) { this.shake = Math.min(1, this.shake + a); },
  hurt() { this.hurtT = 0.35; sfx.hurt(); },
  message(text, dur = 2.5) { $('msg').textContent = text; this.msgT = dur; },

  // Kameranın baktığı noktayı bulur (silahlar oraya yakınsar)
  aimPoint() {
    const o = camera.position;
    const d = camera.getWorldDirection(_aimDir);
    let t = 400;
    const r = this.swarm.raycast(o, d, t);
    if (r) t = r.t;
    if (d.y < 0) t = Math.min(t, -o.y / d.y);
    return _aimPt.copy(o).addScaledVector(d, Math.max(t, 6));
  },

  shoot(origin, dir, opt) {
    let t = 400;
    let hit = -1;
    const mul = opt.player ? this.shop.dmg : 1;
    if (opt.player) this.rockets.addShot();
    const r = this.swarm.raycast(origin, dir, t);
    if (r) { t = r.t; hit = r.i; }
    // Finalde kapının kilidi de vurulabilir
    if (campaign.phase === 'final') {
      const lt = world.gate.rayHit(origin, dir, t);
      if (lt !== null) {
        t = lt;
        hit = -1;
        world.gate.damage(opt.damage * mul);
        this.effects.sparks(_shotPt.copy(origin).addScaledVector(dir, t), 6);
        showHit();
      }
    }
    if (opt.airburst && hit < 0) {
      const near = this.swarm.nearMiss(origin, dir, t, 2.2);
      if (near !== null) t = near;
    }
    let floor = false;
    if (dir.y < 0) {
      const tf = -origin.y / dir.y;
      if (tf < t) { t = tf; hit = -1; floor = true; }
    }
    const p = _shotPt.copy(origin).addScaledVector(dir, t);
    if (hit >= 0) {
      this.swarm.damage(hit, opt.damage * mul, opt.player);
      this.effects.sparks(p, 5);
      showHit();
    } else if (floor) {
      this.effects.sparks(p, 3, _dimSpark, 4);
    }
    if (opt.splash && (hit >= 0 || floor || opt.airburst)) {
      this.swarm.damageRadius(p, opt.splash, opt.splashDamage * mul, hit, opt.player);
      if (opt.airburst && hit < 0 && !floor && t < 400) this.effects.explosion(p, 0.4);
    }
    this.effects.tracer(opt.from || origin, p, opt.width);
    return p;
  },

  possess(pawn) {
    if (this.pawn && this.pawn !== pawn && this.pawn.onRelease) this.pawn.onRelease();
    this.pawn = pawn;
    this.infantry.inVehicle = pawn === this.infantry ? null : pawn;
    this.infantry.gun.visible = pawn === this.infantry;
    if (pawn.onPossess) pawn.onPossess();
    input.look();
    sfx.enter();
  },

  onKill(byPlayer) {
    this.kills++;
    this.shop.earn(byPlayer ? 15 : 5);
  },

  // Roket: atılan yer silahın ağzı ya da kameranın biraz önü
  fireRocket(from) {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    if (!from) from = camera.position.clone().addScaledVector(dir, 2.5).add(_v.set(0, -0.5, 0));
    const res = this.rockets.fire(from, camera.position.clone(), dir, this.aimPoint().clone());
    if (res === 'enemy') this.message('HEDEFE KİLİTLENDİ', 0.7);
    else if (res === 'gate') this.message('KİLİDE KİLİTLENDİ', 0.7);
    else if (!res && !this.rockets.ready) this.message('Roket doluyor', 0.8);
  },
  gateLockTarget() {
    return campaign.phase === 'final' && world.gate.lockAlive ? world.gate.lockPos : null;
  },
  gateLockHit(p, r) {
    return campaign.phase === 'final' && world.gate.lockAlive && p.distanceTo(world.gate.lockPos) < r;
  },
  damageGateLock(p, r, amount) {
    if (campaign.phase === 'final' && world.gate.lockAlive && p.distanceTo(world.gate.lockPos) < r) world.gate.damage(amount);
  },

  reviveApu(a) {
    if (!a) return;
    a.alive = true;
    a.hp = a.maxHp;
    a.fall = 0;
    a.root.rotation.z = 0;
    a.root.position.y = 0;
    a.ammo = [a.ammoMax, a.ammoMax];
    this.defensesDown = false;
  },

  onInfantryDown() {
    const defenses = [...this.apus, ...this.turrets].some((v) => v.alive);
    if (this.lives > 0 && defenses) {
      this.lives--;
      this.respawnT = 5;
      this.message('YARALANDIN\nKalan can: ' + this.lives + ' · depoda yeniden doğacaksın', 5);
    } else {
      this.respawnT = Infinity;
      setTimeout(() => campaign.gameOver('DOCK DÜŞTÜ', defenses ? 'Canların tükendi.' : 'APU’lar ve kuleler yok edildi, son asker de düştü.'), 2500);
    }
  },

  onVehicleDestroyed(v) {
    if (this.pawn === v) {
      const inf = this.infantry;
      v.exitPos(inf.pos);
      inf.yaw = v.aimYaw;
      inf.pitch = 0;
      inf.damage(35);
      this.possess(inf);
      this.message(v.label + ' YOK EDİLDİ', 2.5);
    } else {
      this.message(v.label + ' DÜŞTÜ', 2);
    }
  },
};
const _aimDir = new THREE.Vector3();
const _aimPt = new THREE.Vector3();
const _shotPt = new THREE.Vector3();
const _dimSpark = new THREE.Color(0.7, 0.65, 0.5);
const _v = new THREE.Vector3();

await loadModels();
game.swarm = new Swarm(game, 320);
game.infantry = new Infantry(game, new THREE.Vector3(0, 0, 36));
world.apuSpots.forEach((s, i) => game.apus.push(new APU(game, s, i)));
[[-90, -62, -2.4], [90, -62, 2.4], [-90, 50, -0.8], [90, 50, 0.8]].forEach(([x, z, yaw], i) =>
  game.turrets.push(new Turret(game, x, z, yaw, i)));
game.targets.push(game.infantry, ...game.apus, ...game.turrets);
game.possess(game.infantry);

game.shop = new Shop(game);
game.rockets = new Rockets(game);
const hammer = new HammerLevel(game);

// --- Ekran geçişleri ve bitiş ekranı
const ui = {
  fade(on) { $('fade').classList.toggle('on', on); },
  end(win, title, text) {
    if (win) unlockChapter(4);
    $('endTitle').textContent = title;
    $('endTitle').className = win ? 'win' : 'lose';
    $('endText').textContent = text;
    const m = Math.floor(game.time / 60), s = Math.floor(game.time % 60);
    $('endStats').textContent = `Leş ${game.kills} · Kredi ${game.shop.credits} · Süre ${m}:${String(s).padStart(2, '0')}`;
    $('end').classList.add('on');
    document.body.classList.remove('playing');
    input.touchActive = false;
    if (document.pointerLockElement) document.exitPointerLock();
  },
};
$('againBtn').addEventListener('click', () => location.reload());

const campaign = new Campaign(game, world, hammer, ui);
game.campaign = campaign;

// --- Bölümler: ulaşılan bölümlerin kilidi açılır, menüden doğrudan başlanabilir
function unlocked() { try { return +localStorage.getItem('dock.chapter') || 1; } catch { return 1; } }
function unlockChapter(n) { try { if (n > unlocked()) localStorage.setItem('dock.chapter', String(n)); } catch { /* gizli sekme */ } }
let startChapter = 1;
function renderChapters() {
  const u = unlocked();
  document.querySelectorAll('.chapter').forEach((b) => {
    const n = +b.dataset.ch;
    b.disabled = n > u;
    b.classList.toggle('sel', n === startChapter);
  });
}
document.querySelectorAll('.chapter').forEach((b) => b.addEventListener('click', () => {
  if (b.disabled || game.time > 0) return;
  startChapter = +b.dataset.ch;
  renderChapters();
}));
renderChapters();
function beginChapter(n) {
  if (n === 2) {
    game.shop.earn(400);
    campaign.n = 4;
    campaign.phase = 'hammer';
    campaign.startHammer();
  } else if (n === 3) {
    game.shop.earn(800);
    campaign.n = 4;
    campaign.backToDock();
  }
}
const _origStartHammer = campaign.startHammer.bind(campaign);
campaign.startHammer = () => { unlockChapter(2); _origStartHammer(); };
const _origBack = campaign.backToDock.bind(campaign);
campaign.backToDock = () => { unlockChapter(3); _origBack(); };

// --- Etkileşim (bin / in / kamera)
function interactions() {
  const p = game.pawn;
  let prompt = '';
  if (p.kind === 'hammer') {
    // Hammer topçusu koltuktan inemez; yalnızca görünüm değiştirir
    prompt = (isTouch ? 'KAM' : 'V') + ' — ' + (p.view === 'cockpit' ? 'dış görünüm' : 'nişancı ekranı');
  } else if (p === game.infantry && p.alive) {
    const near = [...game.apus, ...game.turrets].find((v) => v.canEnter(p.pos));
    if (near) {
      prompt = (isTouch ? 'BİN — ' : 'E — ') + near.label + ' (' + (near.kind === 'apu' ? 'APU' : 'kule') + ') bin';
      if (input.hit('KeyE')) {
        game.possess(near);
        if (near.kind === 'apu') near.aimYaw = near.bodyYaw;
      }
    }
  } else if (p !== game.infantry) {
    const [kE, kV] = isTouch ? ['BİN', 'KAM'] : ['E', 'V'];
    const kR = isTouch ? 'ŞARJÖR' : 'R';
    prompt = p.kind === 'apu' ? kE + ' — in · ' + kV + ' — ' + (p.view === 'inside' ? 'dış' : 'iç') + ' kamera · ' + kR + ' — silahları çevir' : kE + ' — kuleden in';
    if (input.hit('KeyE')) {
      const inf = game.infantry;
      p.exitPos(inf.pos);
      inf.yaw = p.aimYaw;
      inf.pitch = 0;
      game.possess(inf);
    } else if (input.hit('KeyV') && p.kind === 'apu') p.toggleView();
  }
  const el = $('prompt');
  el.style.display = prompt ? 'block' : 'none';
  if (prompt) el.textContent = prompt;
}

// --- HUD
let hitT = 0;
function showHit() { hitT = 0.1; }
const hud = { last: {} };
function setText(id, text) {
  if (hud.last[id] === text) return;
  hud.last[id] = text;
  $(id).textContent = text;
}
function updateHud(dt) {
  const p = game.pawn;
  setText('mode', p.label + (p.kind === 'apu' ? (p.view === 'inside' ? ' · KOKPİT' : ' · DIŞ KAMERA') : ''));
  const h = campaign.hud();
  setText('wave', h.wave);
  setText('waveInfo', h.info);
  setText('enemies', 'Düşman ' + (h.enemies === Infinity ? '∞' : h.enemies) + ' · Leş ' + game.kills);
  setText('objective', h.objective ? '▸ ' + h.objective : '');
  setText('livesTxt', p.kind === 'hammer' ? '—' : '♥'.repeat(Math.max(0, game.lives)) || '0');
  const rk = game.rockets;
  $('rocketFill').style.width = (rk.progress * 100).toFixed(0) + '%';
  $('rocketFill').className = 'fill rocket' + (rk.ready ? ' ready' : '');
  setText('rocketTxt', rk.ready ? (isTouch ? 'HAZIR' : 'HAZIR · Q') : rk.charge + '/' + game.shop.rocketEvery);
  const hp = Math.max(0, p.hp / p.maxHp);
  $('hpFill').style.width = (hp * 100).toFixed(1) + '%';
  setText('hpTxt', Math.ceil(p.hp) + '');
  const heated = p.kind !== 'infantry';
  $('heatRow').style.visibility = heated ? 'visible' : 'hidden';
  if (heated) {
    $('heatFill').style.width = p.heat.toFixed(1) + '%';
    $('heatFill').className = 'fill heat' + (p.overheated ? ' over' : '');
    setText('heatTxt', p.overheated ? 'KİLİT' : Math.round(p.heat) + '%');
  }
  setText('ammoTxt', p.kind === 'infantry'
    ? (p.reload > 0 ? 'Şarjör değişiyor…' : p.ammo + ' / ∞')
    : p.kind === 'apu' ? 'SOL ' + p.ammo[0] + ' · SAĞ ' + p.ammo[1] : p.kind === 'hammer' ? p.ammoText : 'Sınırsız');
  // Hammer nişancı ekranı
  const gunner = p.kind === 'hammer' && p.view === 'cockpit';
  document.body.classList.toggle('gunner', gunner);
  if (gunner) {
    const cv = $('gunnerCanvas');
    if (cv.width !== innerWidth || cv.height !== innerHeight) { cv.width = innerWidth; cv.height = innerHeight; }
    p.drawTargets(cv.getContext('2d'), cv.width, cv.height);
    setText('gunnerRead', 'BANT ' + p.ammoText + '\nISI ' + Math.round(p.heat) + '%' + (p.overheated ? ' KİLİT' : '') +
      '\nGÖVDE ' + Math.ceil(p.hp / p.maxHp * 100) + '%\nROKET ' + (game.rockets.ready ? 'HAZIR' : Math.round(game.rockets.progress * 100) + '%'));
  }
  setText('hpLbl', p.kind === 'hammer' ? 'GÖVDE' : 'ZIRH');
  hitT -= dt;
  $('hitmarker').className = hitT > 0 ? 'on' : '';
  game.hurtT -= dt;
  $('damage').style.opacity = game.hurtT > 0 ? '0.55' : '0';
  if (game.msgT > 0) { game.msgT -= dt; if (game.msgT <= 0) setText('msg', ''); else hud.last.msg = null; }
}

// --- Başlat / duraklat
const overlay = $('overlay');
const startBtn = $('startBtn');
startBtn.disabled = false;
$('loadHint').textContent = 'Dahili ekran kartında yavaşsa B ile parlamayı kapat.';
if (isTouch) {
  $('loadHint').textContent = 'En iyi deneyim için telefonu yatay tut.';
  setupTouch(input, {
    onPause: () => {
      input.touchActive = false;
      document.body.classList.remove('playing');
      overlay.classList.remove('hidden');
      startBtn.textContent = 'DEVAM';
    },
  });
  startBtn.addEventListener('click', () => {
    initAudio();
    enterFullscreen();
    input.touchActive = true;
    document.body.classList.add('playing');
    overlay.classList.add('hidden');
  });
} else {
  startBtn.addEventListener('click', () => { initAudio(); input.lock(); });
  canvas.addEventListener('click', () => { if (!input.locked) input.lock(); });
  document.addEventListener('pointerlockchange', () => {
    overlay.classList.toggle('hidden', input.locked);
    if (!input.locked && game.time > 0) startBtn.textContent = 'DEVAM';
  });
}

// --- Uygulama olarak yükleme (PWA)
// Geliştirirken (localhost) önbellek eski dosyaları vermesin diye servis çalışanı yalnızca yayında açılır
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
if ('serviceWorker' in navigator && location.protocol === 'https:' && !isLocal) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
} else if ('serviceWorker' in navigator && isLocal && !new URLSearchParams(location.search).has('sw')) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
}
let installEvent = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('installBtn').hidden = false;
});
$('installBtn').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('installBtn').hidden = true;
});
const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !standalone) $('iosHint').hidden = false;

// --- Döngü
// ?test adresinde fare kilidi olmadan çalışır (geliştirme ve test için)
const testMode = new URLSearchParams(location.search).has('test');
if (testMode) {
  overlay.classList.add('hidden');
  window.game = game;
  window.campaign = campaign;
  window.hammer = hammer;
  // Arka plandaki sekmede elle bir kare çizdirmek için
  window.renderFrame = () => { game.pawn.applyCamera(camera); composer.render(); };
  if (isTouch) { input.touchActive = true; document.body.classList.add('playing'); }
}

const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, slowT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const running = (input.locked || input.touchActive || testMode) && campaign.phase !== 'end';

  if (running) {
    if (game.time === 0 && startChapter > 1) beginChapter(startChapter);
    game.time += dt;
    if (input.hit('KeyB')) bloomOn = !bloomOn;
    if (input.hit('KeyQ') && game.pawn.kind !== 'hammer' && game.pawn.alive !== false) game.fireRocket();
    if (!game.defensesDown && campaign.phase !== 'hammer' && ![...game.apus, ...game.turrets].some((v) => v.alive)) {
      game.defensesDown = true;
      game.message('SAVUNMA ÇÖKTÜ\nArtık yeniden doğamazsın!', 4);
    }
    const p = game.pawn;
    if (p === game.infantry && !p.alive) {
      input.look();
      game.respawnT -= dt;
      if (game.respawnT <= 0) {
        p.pos.copy(world.depotPos).add(_v.set(6, 0, -6));
        p.hp = p.maxHp;
        p.alive = true;
        p.ammo = p.mag;
        game.message('Yeniden sahadasın', 1.5);
      }
    } else {
      p.update(dt, input);
    }
    interactions();
    if (campaign.phase !== 'hammer') {
      for (const a of game.apus) { a.ai(dt); a.animate(dt); }
      for (const t of game.turrets) { t.ai(dt); t.animate(dt); }
    }
    game.swarm.update(dt, game.time);
    campaign.update(dt, input);
    game.rockets.update(dt);
    world.update(dt, game.time);
    game.effects.update(dt);
    updateHud(dt);
  }
  game.flashT = Math.max(0, game.flashT - dt);

  // Dürbün (sağ tık)
  const zoomFov = { infantry: 30, apu: 36, turret: 24, hammer: 30 }[game.pawn.kind] || 30;
  const aiming = running && input.aim && !(game.pawn === game.infantry && !game.infantry.alive);
  camera.fov = THREE.MathUtils.damp(camera.fov, aiming ? zoomFov : 75, 12, dt);
  camera.updateProjectionMatrix();
  input.zoom = camera.fov / 75;
  document.body.classList.toggle('scoped', camera.fov < 50);

  game.pawn.applyCamera(camera);
  if (!game.infantry.alive && game.pawn === game.infantry) {
    camera.position.y = 0.4;
    camera.rotation.z = 0.5;
  }
  game.shake = Math.max(0, game.shake - dt * 2.5);
  if (game.shake > 0) {
    const s = game.shake * game.shake * 0.35;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.rotation.z += (Math.random() - 0.5) * s * 0.1;
  }

  bloom.enabled = bloomOn;
  grade.uniforms.uTime.value = game.time;
  grade.uniforms.uHurt.value = Math.max(0, game.hurtT) * 2;
  grade.uniforms.uFlash.value = Math.min(1, game.flashT * 1.2);
  composer.render();
  input.endFrame();

  // FPS ve otomatik kalite düşürme
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) {
    const fps = fpsN / fpsAcc;
    $('fps').textContent = Math.round(fps) + ' FPS · ' + (bloomOn ? 'parlama açık' : 'parlama kapalı') + ' · ölçek ' + pixelRatio.toFixed(2);
    if (running && fps < 30) slowT += fpsAcc; else slowT = 0;
    if (slowT > 3 && pixelRatio > 0.6) {
      pixelRatio = Math.max(0.6, pixelRatio - 0.15);
      renderer.setPixelRatio(pixelRatio);
      composer.setPixelRatio(pixelRatio);
      resize();
      slowT = 0;
    }
    fpsAcc = 0; fpsN = 0;
  }
}
frame();
