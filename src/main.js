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
scene.fog = new THREE.FogExp2(0x0a120e, 0.0045);
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
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) }, uHurt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uHurt;
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

  addShake(a) { this.shake = Math.min(1, this.shake + a); },
  hurt() { this.hurtT = 0.35; sfx.hurt(); },
  message(text, dur = 2.5) { $('msg').textContent = text; this.msgT = dur; },

  // Kameranın baktığı noktayı bulur (silahlar oraya yakınsar)
  aimPoint() {
    const o = camera.position;
    const d = camera.getWorldDirection(_aimDir);
    let t = 250;
    const r = this.swarm.raycast(o, d, t);
    if (r) t = r.t;
    if (d.y < 0) t = Math.min(t, -o.y / d.y);
    return _aimPt.copy(o).addScaledVector(d, Math.max(t, 6));
  },

  shoot(origin, dir, opt) {
    let t = 250;
    let hit = -1;
    const r = this.swarm.raycast(origin, dir, t);
    if (r) { t = r.t; hit = r.i; }
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
      this.swarm.damage(hit, opt.damage);
      this.effects.sparks(p, 5);
      showHit();
    } else if (floor) {
      this.effects.sparks(p, 3, _dimSpark, 4);
    }
    if (opt.splash && (hit >= 0 || floor || opt.airburst)) {
      this.swarm.damageRadius(p, opt.splash, opt.splashDamage, hit);
      if (opt.airburst && hit < 0 && !floor && t < 250) this.effects.explosion(p, 0.4);
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

  onKill() { this.kills++; },

  onInfantryDown() {
    this.respawnT = 5;
    this.message('YARALANDIN\nDepoda yeniden doğacaksın…', 5);
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

game.swarm = new Swarm(game, 320);
game.infantry = new Infantry(game, new THREE.Vector3(0, 0, 28));
world.apuSpots.forEach((s, i) => game.apus.push(new APU(game, s, i)));
[[-66, -46, -2.4], [66, -46, 2.4], [-66, 40, -0.8], [66, 40, 0.8]].forEach(([x, z, yaw], i) =>
  game.turrets.push(new Turret(game, x, z, yaw, i)));
game.targets.push(game.infantry, ...game.apus, ...game.turrets);
game.possess(game.infantry);

// --- Dalgalar
const waves = {
  n: 0, state: 'prep', timer: 20, toSpawn: 0, rate: 0, acc: 0,
  update(dt) {
    if (this.state === 'prep') {
      this.timer -= dt;
      if (this.timer <= 0) this.start();
    } else {
      this.acc += this.rate * dt;
      const active = world.breaches.filter((b) => b.active && b.open > 0.6);
      while (this.acc >= 1 && this.toSpawn > 0 && active.length) {
        this.acc -= 1;
        if (!game.swarm.spawn(active[(Math.random() * active.length) | 0])) break;
        this.toSpawn--;
      }
      if (this.toSpawn <= 0 && game.swarm.alive === 0) this.clear();
    }
  },
  start() {
    this.n++;
    this.state = 'wave';
    this.toSpawn = Math.min(400, 30 + this.n * 25);
    this.rate = 3 + this.n * 1.5;
    this.acc = 0;
    const open = Math.min(3, this.n);
    const order = [1, 0, 2];
    world.breaches.forEach((b) => (b.active = false));
    for (let k = 0; k < open; k++) world.breaches[order[k]].active = true;
    game.message('DALGA ' + this.n + '\nTavan delindi!', 3);
    sfx.drill();
  },
  clear() {
    this.state = 'prep';
    this.timer = 15;
    world.breaches.forEach((b) => (b.active = false));
    for (const a of game.apus) if (a.alive) { a.ammo = [a.ammoMax, a.ammoMax]; a.hp = Math.min(a.maxHp, a.hp + 250); }
    for (const t of game.turrets) if (t.alive) t.hp = Math.min(t.maxHp, t.hp + 200);
    game.message('DALGA ' + this.n + ' TEMİZLENDİ\nMühimmat yenilendi', 3);
  },
};

// --- Etkileşim (bin / in / kamera)
function interactions() {
  const p = game.pawn;
  let prompt = '';
  if (p === game.infantry && p.alive) {
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
    prompt = p.kind === 'apu' ? kE + ' — in · ' + kV + ' — ' + (p.view === 'inside' ? 'dış' : 'iç') + ' kamera' : kE + ' — kuleden in';
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
  setText('wave', 'DALGA ' + waves.n);
  setText('waveInfo', waves.state === 'prep' ? 'Hazırlık ' + Math.ceil(waves.timer) + ' sn' : 'Sürü saldırıyor');
  setText('enemies', 'Düşman ' + (game.swarm.alive + (waves.state === 'wave' ? waves.toSpawn : 0)) + ' · Leş ' + game.kills);
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
    : p.kind === 'apu' ? 'SOL ' + p.ammo[0] + ' · SAĞ ' + p.ammo[1] : 'Sınırsız');
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
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
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
  window.waves = waves;
  if (isTouch) { input.touchActive = true; document.body.classList.add('playing'); }
}

const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, slowT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const running = input.locked || input.touchActive || testMode;

  if (running) {
    game.time += dt;
    if (input.hit('KeyB')) bloomOn = !bloomOn;
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
    for (const a of game.apus) { a.ai(dt); a.animate(dt); }
    for (const t of game.turrets) { t.ai(dt); t.animate(dt); }
    game.swarm.update(dt, game.time);
    waves.update(dt);
    world.update(dt, game.time);
    game.effects.update(dt);
    updateHud(dt);
  }

  // Dürbün (sağ tık)
  const zoomFov = { infantry: 30, apu: 36, turret: 24 }[game.pawn.kind];
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
