import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sfx } from './audio.js';

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const Z = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// GATHER: delikten çıkıp tavanın altında sürü halinde döner
// DIVE: salonun ortasına doğru alçalır, SEEK: hedefe gider, ATTACK: hedefi söker
const DEAD = 0, DIVE = 1, SEEK = 2, ATTACK = 3, GATHER = 4;
const SCALE = 1.25;

function sentinelGeometry() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.8, 18, 12);
  body.scale(1, 0.78, 1.15);
  parts.push(body);
  const ring = new THREE.TorusGeometry(0.72, 0.09, 6, 20);
  ring.rotateY(Math.PI / 2);
  ring.scale(1, 0.8, 1.1);
  ring.translate(0, 0, -0.15);
  parts.push(ring);
  for (const s of [-1, 1]) {
    const claw = new THREE.ConeGeometry(0.1, 0.9, 5);
    claw.rotateX(Math.PI / 2 + 0.5);
    claw.translate(s * 0.35, -0.45, 0.95);
    parts.push(claw);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const len = 3.2 + (i % 3) * 0.5;
    const t = new THREE.CylinderGeometry(0.095, 0.012, len, 5, 10);
    t.translate(0, -len / 2, 0);
    t.rotateX(Math.PI / 2 - 0.22 * Math.sin(a));
    t.rotateY(0.22 * Math.cos(a));
    t.translate(Math.cos(a) * 0.42, Math.sin(a) * 0.32, -0.6);
    parts.push(t);
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

function eyeGeometry() {
  const parts = [];
  const pts = [[-0.3, 0.12], [0, 0.2], [0.3, 0.12], [-0.17, -0.06], [0.17, -0.06], [0, 0.0]];
  for (const [x, y] of pts) {
    const e = new THREE.SphereGeometry(x === 0 && y === 0 ? 0.13 : 0.085, 8, 6);
    const z = Math.sqrt(Math.max(0, 1 - (x * x) / 0.64 - (y * y) / 0.39)) * 0.92 + 0.02;
    e.translate(x, y, z);
    parts.push(e);
  }
  return mergeGeometries(parts);
}

// Makine sürüsü: tek InstancedMesh, veri dizileri üzerinde basit yönlendirme
export class Swarm {
  constructor(game, max = 320) {
    this.game = game;
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.goal = new Float32Array(max * 3);
    this.off = new Float32Array(max * 3);
    this.home = new Float32Array(max * 4); // toplanma merkezi + yarıçap
    this.hp = new Float32Array(max);
    this.speed = new Float32Array(max);
    this.timer = new Float32Array(max);
    this.state = new Uint8Array(max);
    this.tick = new Float32Array(max);
    this.target = new Array(max).fill(null);
    this.alive = 0;
    this.uTime = { value: 0 };

    // Krom gövde; dokunaçlar vertex shader ile kıpırdar
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c1a19, metalness: 0.95, roughness: 0.28 });
    bodyMat.onBeforeCompile = (s) => {
      s.uniforms.uTime = this.uTime;
      s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float tz = max(0.0, -position.z - 0.7);
        float ph = float(gl_InstanceID) * 1.73;
        transformed.x += sin(uTime * 6.0 + tz * 1.7 + ph + position.x * 5.0) * tz * 0.16;
        transformed.y += cos(uTime * 5.0 + tz * 1.5 + ph + position.y * 5.0) * tz * 0.16;`);
    };
    this.body = new THREE.InstancedMesh(sentinelGeometry(), bodyMat, max);
    this.eyes = new THREE.InstancedMesh(eyeGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.45, 0.12) }), max);
    for (const m of [this.body, this.eyes]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      for (let i = 0; i < max; i++) m.setMatrixAt(i, ZERO);
      game.scene.add(m);
    }
  }

  spawn(breach) {
    for (let i = 0; i < this.max; i++) {
      if (this.state[i] !== DEAD) continue;
      const j = i * 3;
      const b = breach.pos;
      this.pos[j] = b.x + (Math.random() - 0.5) * 2;
      this.pos[j + 1] = b.y - 1;
      this.pos[j + 2] = b.z + (Math.random() - 0.5) * 2;
      this.vel[j] = (Math.random() - 0.5) * 3;
      this.vel[j + 1] = -5;
      this.vel[j + 2] = (Math.random() - 0.5) * 3;
      // Tavanın altında dönme merkezi
      const k = i * 4;
      this.home[k] = b.x + (Math.random() - 0.5) * 10;
      this.home[k + 1] = b.y - 8 - Math.random() * 10;
      this.home[k + 2] = b.z + (Math.random() - 0.5) * 10;
      this.home[k + 3] = 6 + Math.random() * 14;
      this.goal[j] = b.x + (Math.random() - 0.5) * 60;
      this.goal[j + 1] = 18 + Math.random() * 12;
      this.goal[j + 2] = b.z + 20 + Math.random() * 30;
      _d.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      this.off[j] = _d.x; this.off[j + 1] = _d.y; this.off[j + 2] = _d.z;
      this.hp[i] = 40;
      this.speed[i] = 6 + Math.random() * 3;
      this.timer[i] = 4 + Math.random() * 6;
      this.state[i] = GATHER;
      this.tick[i] = Math.random();
      this.target[i] = null;
      this.alive++;
      return true;
    }
    return false;
  }

  pickTarget() {
    const g = this.game;
    const list = g.targets.filter((t) => t.targetable);
    if (!list.length) return null;
    if (g.pawn.targetable && Math.random() < 0.35) return g.pawn;
    return list[(Math.random() * list.length) | 0];
  }

  update(dt, time) {
    this.uTime.value = time;
    const dps = 2.5;
    for (let i = 0; i < this.max; i++) {
      const st = this.state[i];
      if (st === DEAD) continue;
      const j = i * 3;
      _p.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      let tgt = this.target[i];
      let sp;

      if (st === GATHER) {
        const k = i * 4;
        const a = time * (0.5 + (i % 7) * 0.08) * (i % 2 ? 1 : -1) + i;
        const r = this.home[k + 3];
        _t.set(this.home[k] + Math.cos(a) * r, this.home[k + 1] + Math.sin(time * 1.3 + i) * 2.5, this.home[k + 2] + Math.sin(a) * r);
        sp = 7;
        this.timer[i] -= dt;
        if (this.timer[i] <= 0) this.state[i] = DIVE;
      } else if (st === DIVE) {
        _t.set(this.goal[j], this.goal[j + 1], this.goal[j + 2]);
        sp = 10;
        if (_p.distanceToSquared(_t) < 36) { this.state[i] = SEEK; tgt = this.target[i] = this.pickTarget(); }
      } else {
        if (!tgt || !tgt.targetable) { tgt = this.target[i] = this.pickTarget(); this.state[i] = SEEK; }
        if (!tgt) { _t.set(this.goal[j], 20, this.goal[j + 2]); }
        else {
          tgt.targetPos(_t);
          const ring = tgt.radius + (this.state[i] === ATTACK ? 0.8 : 2.5);
          _t.x += this.off[j] * ring; _t.y += this.off[j + 1] * ring * 0.6; _t.z += this.off[j + 2] * ring;
          _t.y = Math.max(1, _t.y);
          const dist = _p.distanceTo(_t);
          if (this.state[i] === SEEK && dist < 2.5) this.state[i] = ATTACK;
          else if (this.state[i] === ATTACK && dist > 6) this.state[i] = SEEK;
        }
        sp = this.state[i] === ATTACK ? 4 : this.speed[i];
      }

      // Yönlendirme
      _d.subVectors(_t, _p);
      const dist = _d.length();
      if (this.state[i] === ATTACK) sp = Math.min(sp, dist * 3);
      if (dist > 0.001) _d.multiplyScalar(sp / dist);
      const w = time * 2 + i * 1.7;
      _d.x += Math.sin(w) * 1.5; _d.y += Math.cos(w * 1.3) * 1; _d.z += Math.sin(w * 0.7) * 1.5;
      const k = Math.min(1, dt * (this.state[i] === ATTACK ? 5 : 1.6));
      this.vel[j] += (_d.x - this.vel[j]) * k;
      this.vel[j + 1] += (_d.y - this.vel[j + 1]) * k;
      this.vel[j + 2] += (_d.z - this.vel[j + 2]) * k;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] = Math.max(0.8, this.pos[j + 1] + this.vel[j + 1] * dt);
      this.pos[j + 2] += this.vel[j + 2] * dt;

      if (this.state[i] === ATTACK && tgt) {
        this.tick[i] -= dt;
        if (this.tick[i] <= 0) {
          this.tick[i] = 0.5;
          tgt.damage(dps * 0.5);
          if (Math.random() < 0.3) this.game.effects.sparks(_p.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]), 3, new THREE.Color(1, 0.4, 0.1), 4);
        }
      }

      // Matris
      _p.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      if (this.state[i] === ATTACK && tgt) tgt.targetPos(_d).sub(_p).normalize();
      else _d.set(this.vel[j], this.vel[j + 1], this.vel[j + 2]).normalize();
      _q.setFromUnitVectors(Z, _d);
      _m.compose(_p, _q, _s.set(SCALE, SCALE, SCALE));
      this.body.setMatrixAt(i, _m);
      this.eyes.setMatrixAt(i, _m);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.eyes.instanceMatrix.needsUpdate = true;
  }

  raycast(o, d, maxT, r = 1.3) {
    let best = maxT, hit = -1;
    for (let i = 0; i < this.max; i++) {
      if (this.state[i] === DEAD) continue;
      const j = i * 3;
      const ox = this.pos[j] - o.x, oy = this.pos[j + 1] - o.y, oz = this.pos[j + 2] - o.z;
      const t = ox * d.x + oy * d.y + oz * d.z;
      if (t < 0 || t > best + r) continue;
      const d2 = ox * ox + oy * oy + oz * oz - t * t;
      if (d2 > r * r) continue;
      const th = t - Math.sqrt(r * r - d2);
      if (th < best) { best = th; hit = i; }
    }
    return hit >= 0 ? { i: hit, t: best } : null;
  }

  // Işının en çok yaklaştığı düşmanın yanında patlayan atış (uçaksavar)
  nearMiss(o, d, maxT, r) {
    let best = maxT, hit = -1;
    for (let i = 0; i < this.max; i++) {
      if (this.state[i] === DEAD) continue;
      const j = i * 3;
      const ox = this.pos[j] - o.x, oy = this.pos[j + 1] - o.y, oz = this.pos[j + 2] - o.z;
      const t = ox * d.x + oy * d.y + oz * d.z;
      if (t < 0 || t > best) continue;
      const d2 = ox * ox + oy * oy + oz * oz - t * t;
      if (d2 < r * r) { best = t; hit = i; }
    }
    return hit >= 0 ? best : null;
  }

  isAlive(i) { return i >= 0 && this.state[i] !== DEAD; }
  posOf(i, out) { const j = i * 3; return out.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]); }

  // Yapay zekâ nişancılar için en yakın düşman
  nearest(c, maxDist) {
    let best = maxDist * maxDist, hit = -1;
    for (let i = 0; i < this.max; i++) {
      if (this.state[i] === DEAD) continue;
      const j = i * 3;
      const dx = this.pos[j] - c.x, dy = this.pos[j + 1] - c.y, dz = this.pos[j + 2] - c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) { best = d2; hit = i; }
    }
    return hit;
  }

  damage(i, amount) {
    if (this.state[i] === DEAD) return false;
    this.hp[i] -= amount;
    if (this.hp[i] > 0) return false;
    const j = i * 3;
    this.state[i] = DEAD;
    this.alive--;
    this.body.setMatrixAt(i, ZERO);
    this.eyes.setMatrixAt(i, ZERO);
    this.game.effects.explosion(_p.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]), 0.6);
    sfx.pop();
    this.game.onKill();
    return true;
  }

  damageRadius(c, r, amount, skip = -1) {
    for (let i = 0; i < this.max; i++) {
      if (i === skip || this.state[i] === DEAD) continue;
      const j = i * 3;
      const dx = this.pos[j] - c.x, dy = this.pos[j + 1] - c.y, dz = this.pos[j + 2] - c.z;
      if (dx * dx + dy * dy + dz * dz < r * r) this.damage(i, amount);
    }
  }
}