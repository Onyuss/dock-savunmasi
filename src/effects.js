import * as THREE from 'three';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  g.fillStyle = 'rgba(255,220,150,1)';
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, -8); g.lineTo(60, 0); g.lineTo(0, 8);
    g.fill();
  }
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 40);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(c);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

// Kıvılcım, kovan, toz parçacıkları + mermi izleri + namlu alevleri
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;

    // --- Parçacıklar (tek Points nesnesi, havuzlu)
    this.max = 2500;
    this.pPos = new Float32Array(this.max * 3);
    this.pCol = new Float32Array(this.max * 3);
    this.pVel = new Float32Array(this.max * 3);
    this.pBase = new Float32Array(this.max * 3);
    this.pLife = new Float32Array(this.max);
    this.pMaxLife = new Float32Array(this.max);
    this.pGrav = new Float32Array(this.max);
    this.pNext = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.35, map: glowTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    // --- Mermi izleri (uzatılmış ince kutular)
    this.tMax = 160;
    this.tracers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      this.tMax,
    );
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.frustumCulled = false;
    this.tData = Array.from({ length: this.tMax }, () => ({ life: 0, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, w: 0.06 }));
    this.tNext = 0;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < this.tMax; i++) this.tracers.setMatrixAt(i, _m);
    scene.add(this.tracers);

    // --- Namlu alevleri (sprite havuzu) + tek paylaşımlı ışık
    const fm = new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.flashes = Array.from({ length: 12 }, () => {
      const s = new THREE.Sprite(fm.clone());
      s.visible = false;
      s.userData.life = 0;
      scene.add(s);
      return s;
    });
    this.fNext = 0;
    this.light = new THREE.PointLight(0xffb060, 0, 18, 1.6);
    scene.add(this.light);
    this.lightLife = 0;
  }

  spawn(pos, vel, color, life, grav = 1) {
    const i = this.pNext;
    this.pNext = (this.pNext + 1) % this.max;
    this.pPos.set([pos.x, pos.y, pos.z], i * 3);
    this.pVel.set([vel.x, vel.y, vel.z], i * 3);
    this.pBase.set([color.r, color.g, color.b], i * 3);
    this.pLife[i] = life;
    this.pMaxLife[i] = life;
    this.pGrav[i] = grav;
  }

  sparks(pos, n = 10, color = new THREE.Color(1, 0.6, 0.2), speed = 8) {
    for (let k = 0; k < n; k++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      this.spawn(pos, _v, color, 0.25 + Math.random() * 0.35, 1);
    }
  }

  explosion(pos, scale = 1) {
    this.sparks(pos, Math.round(18 * scale), new THREE.Color(1, 0.55, 0.15), 12 * scale);
    this.sparks(pos, Math.round(8 * scale), new THREE.Color(1, 0.9, 0.6), 5 * scale);
    for (let k = 0; k < 6 * scale; k++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.5, Math.random() - 0.5).multiplyScalar(4);
      this.spawn(pos, _v, new THREE.Color(0.25, 0.22, 0.2), 0.8 + Math.random() * 0.6, 0.3);
    }
    this.flash(pos, 3 * scale, 0.08);
  }

  dust(pos, n = 14) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      _v.set(Math.cos(a) * 3, 0.4 + Math.random(), Math.sin(a) * 3);
      this.spawn(pos, _v, new THREE.Color(0.18, 0.22, 0.19), 0.6 + Math.random() * 0.4, 0.15);
    }
  }

  casing(pos, side) {
    _v.set(side * (2 + Math.random() * 2), 2 + Math.random() * 2, Math.random() - 0.5);
    this.spawn(pos, _v, new THREE.Color(0.9, 0.65, 0.25), 0.9, 2.2);
  }

  tracer(from, to, width = 0.06) {
    const t = this.tData[this.tNext];
    this.tNext = (this.tNext + 1) % this.tMax;
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.len = t.dir.length();
    t.dir.divideScalar(t.len || 1);
    t.life = 0.06;
    t.w = width;
  }

  flash(pos, size = 1.2, life = 0.045) {
    const s = this.flashes[this.fNext];
    this.fNext = (this.fNext + 1) % this.flashes.length;
    s.position.copy(pos);
    s.scale.setScalar(size * (0.8 + Math.random() * 0.4));
    s.material.rotation = Math.random() * Math.PI;
    s.visible = true;
    s.userData.life = life;
    this.light.position.copy(pos);
    this.light.intensity = 40 * size;
    this.lightLife = life;
  }

  update(dt) {
    this.time += dt;
    for (let i = 0; i < this.max; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const j = i * 3;
      if (this.pLife[i] <= 0) {
        this.pCol[j] = this.pCol[j + 1] = this.pCol[j + 2] = 0;
        this.pPos[j + 1] = -999;
        continue;
      }
      this.pVel[j + 1] -= 9.8 * this.pGrav[i] * dt;
      this.pPos[j] += this.pVel[j] * dt;
      this.pPos[j + 1] += this.pVel[j + 1] * dt;
      this.pPos[j + 2] += this.pVel[j + 2] * dt;
      if (this.pPos[j + 1] < 0.05) { this.pPos[j + 1] = 0.05; this.pVel[j + 1] *= -0.3; this.pVel[j] *= 0.6; this.pVel[j + 2] *= 0.6; }
      const f = this.pLife[i] / this.pMaxLife[i];
      this.pCol[j] = this.pBase[j] * f;
      this.pCol[j + 1] = this.pBase[j + 1] * f;
      this.pCol[j + 2] = this.pBase[j + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    for (let i = 0; i < this.tMax; i++) {
      const t = this.tData[i];
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) {
        _m.makeScale(0, 0, 0);
      } else {
        const w = t.w * (t.life / 0.06 + 0.3);
        _q.setFromUnitVectors(Z, t.dir);
        _m.compose(t.from, _q, _s.set(w, w, t.len));
      }
      this.tracers.setMatrixAt(i, _m);
    }
    this.tracers.instanceMatrix.needsUpdate = true;

    for (const s of this.flashes) {
      if (!s.visible) continue;
      s.userData.life -= dt;
      if (s.userData.life <= 0) s.visible = false;
    }
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      if (this.lightLife <= 0) this.light.intensity = 0;
    }
  }
}
