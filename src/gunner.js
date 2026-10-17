import * as THREE from 'three';
import { sfx } from './audio.js';

// Hammer nişancı koltuğu. Filmdeki gibi nişancı dışarıyı doğrudan görmez:
// önündeki monitörde topun kamerasının görüntüsü yeşil CRT olarak akar.
// Fare monitördeki imleci yönetir; imleç kenara gelince top o yöne döner.
// Ateş, topun kamerasından imlecin üzerinden geçen ışına gider.
//
// Ana kamera bu modda yalnızca 1. katmanı (kokpit) çizer; dünya, topun kamerasıyla
// ayrı bir dokuya (render target) çizilir ve monitör yüzeyinde gösterilir.

const LAYER = 1;
const BELT_N = 34;
const FEED_W = 768, FEED_H = 480;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler();

function add(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

// CRT monitör yüzeyi: görüntü + çizim katmanı, fıçı bozulması, yeşil fosfor, tarama çizgileri
const MonitorShader = {
  uniforms: { tFeed: { value: null }, tOverlay: { value: null }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tFeed; uniform sampler2D tOverlay; uniform float uTime;
    varying vec2 vUv;
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 uv = 0.5 + c * (1.0 + 0.16 * r2);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.01, 0.0, 1.0); return; }
      vec3 f = texture2D(tFeed, uv).rgb;
      f = f / (1.0 + f);
      float l = dot(f, vec3(0.3, 0.59, 0.11));
      l = pow(l, 0.7) * 1.7;
      vec3 col = vec3(0.22, 1.0, 0.42) * l + vec3(0.0, 0.025, 0.01);
      vec4 o = texture2D(tOverlay, uv);
      col = mix(col, o.rgb * 1.5, o.a);
      col *= 0.8 + 0.2 * sin(uv.y * ${FEED_H}.0 * 3.14159);
      col *= 1.0 - r2 * 1.8;
      col *= 0.96 + 0.04 * sin(uTime * 55.0);
      col += (rnd(uv * 700.0 + fract(uTime)) - 0.5) * 0.035;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

class Cockpit {
  constructor(camera) {
    this.group = new THREE.Group();
    this.group.visible = false;
    camera.add(this.group);
    const G = this.group;
    const frame = new THREE.MeshStandardMaterial({ color: 0x1e2120, metalness: 0.6, roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x2c2f2e, metalness: 0.7, roughness: 0.5 });
    const wall = new THREE.MeshStandardMaterial({ color: 0x161918, metalness: 0.4, roughness: 0.85, side: THREE.BackSide });
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.25, 0.05) });
    const box = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) => add(G, new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);

    // Kapalı iç mekân (kokpit kabuğu)
    box(4.2, 3.0, 4.0, wall, 0, 0.1, -0.6);
    // Monitör: kasa + CRT yüzey
    box(1.92, 1.26, 0.35, frame, 0, 0.16, -1.32);
    box(1.82, 0.08, 0.1, metal, 0, 0.76, -1.12);
    this.screen = add(G, new THREE.PlaneGeometry(1.68, 1.05), new THREE.ShaderMaterial(MonitorShader), 0, 0.16, -1.135);
    for (const s of [-1, 1]) {
      box(0.06, 1.1, 0.06, metal, s * 0.93, 0.16, -1.11);
      box(0.12, 0.12, 0.04, lamp, s * 0.82, -0.52, -1.12);
    }
    // Alt konsol, tutamaklar, top kuyruğu
    box(2.6, 0.3, 0.7, frame, 0, -0.86, -0.95, -0.25);
    for (const s of [-1, 1]) {
      add(G, new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10), metal, s * 0.3, -0.72, -0.55).rotation.x = 0.4;
      add(G, new THREE.CylinderGeometry(0.045, 0.045, 0.12, 10), frame, s * 0.3, -0.59, -0.6);
    }
    box(0.9, 0.05, 0.05, metal, 0, -0.78, -0.55);
    box(0.55, 0.3, 0.5, metal, 0, -0.6, -1.08);
    box(0.57, 0.03, 0.52, lamp, 0, -0.44, -1.08);
    this.breech = new THREE.Object3D();
    this.breech.position.set(0, -0.6, -0.92);
    G.add(this.breech);

    // Yanlardan kuyruğa akan mermi bantları
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a40, metalness: 0.9, roughness: 0.3 });
    const link = new THREE.MeshStandardMaterial({ color: 0x1a1b1b, metalness: 0.7, roughness: 0.4 });
    const shell = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 8);
    shell.rotateZ(Math.PI / 2);
    const tip = new THREE.ConeGeometry(0.02, 0.05, 8);
    tip.rotateZ(-Math.PI / 2);
    tip.translate(0.1, 0, 0);
    this.belts = [-1, 1].map((s) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 1.25, -0.95, -0.62), new THREE.Vector3(s * 1.05, -0.66, -0.9),
        new THREE.Vector3(s * 0.7, -0.56, -1.02), new THREE.Vector3(s * 0.3, -0.55, -1.06),
      ]);
      const shells = new THREE.InstancedMesh(shell, brass, BELT_N);
      const tips = new THREE.InstancedMesh(tip, brass, BELT_N);
      const links = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.035, 0.07), link, BELT_N);
      for (const m of [shells, tips, links]) { m.frustumCulled = false; G.add(m); }
      return { s, curve, shells, tips, links, phase: 0, ammo: 2000 };
    });

    // Kokpit ışığı: monitörün yeşil yansıması + sıcak tavan lambası (yalnız 1. katman)
    const glow = new THREE.PointLight(0x7dff9a, 9, 6, 2);
    glow.position.set(0, 0.1, -0.7);
    const top = new THREE.PointLight(0xffc890, 7, 6, 2);
    top.position.set(0, 1.2, 0.2);
    G.add(glow, top);
    G.traverse((o) => o.layers.set(LAYER));
    this.shake = 0;
    this.layout();
  }

  layout() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
    for (const b of this.belts) {
      for (let k = 0; k < BELT_N; k++) {
        const u = ((k + b.phase) / BELT_N) % 1;
        b.curve.getPointAt(u, p);
        b.curve.getTangentAt(u, t);
        side.crossVectors(t, up).normalize();
        q.setFromUnitVectors(X, side.multiplyScalar(b.s));
        m.compose(p, q, one);
        b.shells.setMatrixAt(k, m);
        b.tips.setMatrixAt(k, m);
        b.links.setMatrixAt(k, m);
      }
      b.shells.instanceMatrix.needsUpdate = b.tips.instanceMatrix.needsUpdate = b.links.instanceMatrix.needsUpdate = true;
    }
  }

  feed(i) {
    const b = this.belts[i];
    b.phase = (b.phase + 1) % BELT_N;
    b.ammo = Math.max(0, b.ammo - 1);
    this.shake = 0.025;
  }

  update(dt) {
    this.layout();
    this.shake = Math.max(0, this.shake - dt * 0.4);
    this.group.position.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0);
  }
}

export class HammerGun {
  constructor(level) {
    this.level = level;
    this.game = level.game;
    this.kind = 'hammer';
    this.label = 'HAMMER · ARKA TOP';
    this.aimYaw = Math.PI;      // topun kamerasının baktığı yön (imleç kenara gelince döner)
    this.aimPitch = 0.05;
    this.gunYaw = Math.PI;      // namluların gerçek yönü (imlece bakar)
    this.gunPitch = 0.05;
    this.cx = 0;                // monitördeki imleç (-1..1)
    this.cy = 0;
    this.heat = 0;
    this.overheated = false;
    this.cd = 0;
    this.barrel = 0;
    this.sinceFire = 10;
    this.alive = true;
    this.view = 'cockpit';
    this.cockpit = new Cockpit(this.game.camera);

    this.gunCam = new THREE.PerspectiveCamera(55, FEED_W / FEED_H, 0.1, 600);
    this.rt = new THREE.WebGLRenderTarget(FEED_W, FEED_H);
    this.overlay = document.createElement('canvas');
    this.overlay.width = FEED_W;
    this.overlay.height = FEED_H;
    this.ctx = this.overlay.getContext('2d');
    this.overlayTex = new THREE.CanvasTexture(this.overlay);
    const u = this.cockpit.screen.material.uniforms;
    u.tFeed.value = this.rt.texture;
    u.tOverlay.value = this.overlayTex;
    this.rayO = new THREE.Vector3();
    this.rayD = new THREE.Vector3();
    this.aimPt = new THREE.Vector3();
  }

  get hp() { return this.level.hull; }
  get maxHp() { return this.level.hullMax; }
  get targetable() { return false; }
  get monitor() { return this.view === 'cockpit'; }
  get ammoText() { return 'SOL ' + this.cockpit.belts[0].ammo + ' · SAĞ ' + this.cockpit.belts[1].ammo; }

  setActive(on) {
    const mon = on && this.monitor;
    this.cockpit.group.visible = mon;
    this.game.camera.layers.set(mon ? LAYER : 0);
  }
  toggleView() {
    this.view = this.monitor ? 'outside' : 'cockpit';
    this.setActive(true);
  }
  onPossess() { this.setActive(true); }
  onRelease() { this.setActive(false); }

  // Topun kamerası: kulenin üstünde, aimYaw/aimPitch yönünde
  placeGunCam() {
    const t = this.level.model.turret;
    t.getWorldPosition(_w);
    _e.set(this.aimPitch, this.aimYaw, 0, 'YXZ');
    this.gunCam.position.copy(_w).add(_v.set(0, 2.5, 0.6).applyEuler(_e));
    this.gunCam.rotation.copy(_e);
    this.gunCam.updateMatrixWorld();
  }

  // İmlecin üzerinden geçen ışın ve vurduğu nokta
  computeAim() {
    const g = this.game;
    const cam = this.monitor ? this.gunCam : g.camera;
    const cx = this.monitor ? this.cx : 0, cy = this.monitor ? this.cy : 0;
    this.rayO.copy(cam.position);
    this.rayD.set(cx, cy, 0.5).unproject(cam).sub(cam.position).normalize();
    let t = 400;
    const r = g.swarm.raycast(this.rayO, this.rayD, t);
    if (r) t = r.t;
    if (this.rayD.y < 0) t = Math.min(t, -this.rayO.y / this.rayD.y);
    this.aimPt.copy(this.rayO).addScaledVector(this.rayD, Math.max(t, 8));
  }

  update(dt, input) {
    const g = this.game;
    const look = input.look();
    if (input.hit('KeyV')) this.toggleView();
    if (this.monitor) {
      // Fare imleci gezdirir; kenara (|imleç| > 0.72) gelince top o yöne döner
      const K = 1.6;
      this.cx = THREE.MathUtils.clamp(this.cx - look.yaw * K, -0.97, 0.97);
      this.cy = THREE.MathUtils.clamp(this.cy + look.pitch * K, -0.95, 0.95);
      const ex = Math.sign(this.cx) * Math.max(0, Math.abs(this.cx) - 0.72) / 0.25;
      const ey = Math.sign(this.cy) * Math.max(0, Math.abs(this.cy) - 0.72) / 0.23;
      this.aimYaw -= ex * 1.3 * dt;
      this.aimPitch += ey * 0.9 * dt;
      this.gunCam.fov = THREE.MathUtils.damp(this.gunCam.fov, input.aim ? 24 : 55, 10, dt);
      this.gunCam.updateProjectionMatrix();
    } else {
      this.aimYaw += look.yaw;
      this.aimPitch += look.pitch;
      this.cx = this.cy = 0;
    }
    this.aimYaw = THREE.MathUtils.clamp(this.aimYaw, Math.PI - 1.5, Math.PI + 1.5);
    this.aimPitch = THREE.MathUtils.clamp(this.aimPitch, -0.35, 0.75);
    this.placeGunCam();
    this.computeAim();
    // Namlular imlecin gösterdiği noktaya döner
    this.gunYaw = Math.atan2(-this.rayD.x, -this.rayD.z);
    this.gunPitch = Math.asin(THREE.MathUtils.clamp(this.rayD.y, -1, 1));

    this.cd -= dt;
    this.sinceFire += dt;
    const belts = this.cockpit.belts;
    if (input.fire && !this.overheated && this.cd <= 0 && (belts[0].ammo > 0 || belts[1].ammo > 0)) {
      this.cd = 0.05 * g.shop.rate;
      this.sinceFire = 0;
      let side = this.barrel++ % 2;
      if (belts[side].ammo <= 0) side = 1 - side;
      const from = this.level.model.muzzles[side].getWorldPosition(new THREE.Vector3());
      _v.subVectors(this.aimPt, from).normalize();
      g.shoot(from, _v, { damage: 26, splash: 2, splashDamage: 10, from, width: 0.12, player: true });
      g.effects.flash(from, 1.2, 0.04);
      g.addShake(0.04);
      this.cockpit.feed(side);
      this.heat += 0.4 * g.shop.heat;
      sfx.flak();
      if (this.heat >= 100) { this.heat = 100; this.overheated = true; sfx.overheat(); }
    }
    this.heat = Math.max(0, this.heat - (this.sinceFire > 0.3 ? 30 : 4) * dt);
    if (this.overheated && this.heat < 35) this.overheated = false;
    if (input.hit('KeyQ')) g.fireRocket(this.level.model.muzzles[0].getWorldPosition(new THREE.Vector3()), this.rayO.clone(), this.rayD.clone(), this.aimPt.clone());
    this.cockpit.update(dt);
  }

  applyCamera(cam) {
    if (this.monitor) {
      // Ana kamera kokpitin içinde, monitöre bakar (yalnız 1. katmanı çizer)
      this.level.model.turret.getWorldPosition(cam.position);
      cam.position.y += 1.2;
      cam.rotation.set(0, Math.PI, 0, 'YXZ');
    } else {
      const t = this.level.model.turret;
      t.getWorldPosition(_w);
      _e.set(this.aimPitch * 0.6, this.aimYaw, 0, 'YXZ');
      cam.position.copy(_w).add(_v.set(0, 3.3, 3.0).applyEuler(_e));
      cam.rotation.set(this.aimPitch, this.aimYaw, 0, 'YXZ');
    }
  }

  // Her karede: topun kamerasının görüntüsünü dokuya çiz, monitör katmanını güncelle
  renderFeed(renderer, time) {
    if (!this.monitor) return;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.game.scene, this.gunCam);
    renderer.setRenderTarget(prev);
    this.drawOverlay();
    this.cockpit.screen.material.uniforms.uTime.value = time;
  }

  drawOverlay() {
    const g = this.game;
    const ctx = this.ctx;
    const W = FEED_W, H = FEED_H;
    ctx.clearRect(0, 0, W, H);
    const sw = g.swarm;
    const lock = g.rockets.ready ? g.rockets.pickLock(this.rayO, this.rayD) : -1;
    ctx.lineWidth = 2;
    ctx.font = 'bold 15px Consolas, monospace';
    // Hedef köşeleri
    for (let i = 0, n = 0; i < sw.max && n < 45; i++) {
      if (!sw.isAlive(i)) continue;
      sw.posOf(i, _v);
      const dist = _v.distanceTo(this.gunCam.position);
      if (dist > 280) continue;
      _v.project(this.gunCam);
      if (_v.z > 1 || Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) continue;
      const x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
      const r = Math.max(7, 900 / dist);
      const locked = i === lock;
      ctx.strokeStyle = locked ? '#ff4030' : '#c8ffb0';
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(x + sx * r, y + sy * r * 0.55);
        ctx.lineTo(x + sx * r, y + sy * r);
        ctx.lineTo(x + sx * r * 0.55, y + sy * r);
      }
      ctx.stroke();
      if (locked || dist < 90) {
        ctx.fillStyle = locked ? '#ff4030' : '#c8ffb0';
        ctx.fillText((locked ? 'KİLİT ' : '') + Math.round(dist) + 'm', x + r + 4, y - r + 12);
      }
      n++;
    }
    // İmleç
    const px = (this.cx * 0.5 + 0.5) * W, py = (-this.cy * 0.5 + 0.5) * H;
    ctx.strokeStyle = this.overheated ? '#ff4030' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 18, 0, Math.PI * 2);
    ctx.moveTo(px - 32, py); ctx.lineTo(px - 10, py);
    ctx.moveTo(px + 10, py); ctx.lineTo(px + 32, py);
    ctx.moveTo(px, py - 32); ctx.lineTo(px, py - 10);
    ctx.moveTo(px, py + 10); ctx.lineTo(px, py + 32);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px - 2, py - 2, 4, 4);
    // Kenarda dönüş okları
    ctx.fillStyle = '#c8ffb0';
    if (Math.abs(this.cx) > 0.72) ctx.fillText(this.cx > 0 ? '▶▶' : '◀◀', this.cx > 0 ? W - 46 : 18, H / 2);
    if (Math.abs(this.cy) > 0.72) ctx.fillText(this.cy > 0 ? '▲▲' : '▼▼', W / 2 - 14, this.cy > 0 ? 50 : H - 30);
    // Göstergeler
    ctx.font = 'bold 14px Consolas, monospace';
    ctx.fillStyle = '#c8ffb0';
    ctx.fillText('HAMMER · ARKA TOP', 26, 34);
    ctx.fillText('ZION’A ' + Math.ceil(this.level.timeLeft) + ' SN', 26, 54);
    const right = (s, y) => ctx.fillText(s, W - 26 - ctx.measureText(s).width, y);
    right('BANT ' + this.ammoText, 34);
    right('GÖVDE ' + Math.ceil(this.hp / this.maxHp * 100) + '%', 54);
    right('ROKET ' + (g.rockets.ready ? 'HAZIR' : Math.round(g.rockets.progress * 100) + '%'), 74);
    ctx.strokeStyle = '#c8ffb0';
    ctx.strokeRect(26, H - 40, 200, 12);
    ctx.fillStyle = this.overheated ? '#ff4030' : '#c8ffb0';
    ctx.fillRect(28, H - 38, 196 * this.heat / 100, 8);
    ctx.fillText(this.overheated ? 'ISI KİLİT' : 'ISI', 236, H - 29);
    this.overlayTex.needsUpdate = true;
  }
}
