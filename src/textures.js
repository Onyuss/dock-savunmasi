import * as THREE from 'three';

// Dosya indirmeden, kod ile üretilen PBR dokular (renk + kabartma + pürüzlülük).
// Hepsi döşenebilir (kenarları birbirine uyar).

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Periyodik değer gürültüsü
function vnoise(x, y, p, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
  const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, p, s, oct = 4) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, y * f, p * f, s + i * 17) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / 0.9375;
}

const cache = new Map();

/**
 * Metal panel dokusu.
 * opts: size, cols, rows (panel sayısı), color [r,g,b] 0-255, tint (panel renk farkı),
 * rivets, grime (kir), rust (pas), scratches, stripes (sarı-siyah uyarı bandı), seed, roughness, repeat
 */
export function metalSet(opts) {
  const key = JSON.stringify(opts);
  if (cache.has(key)) return cache.get(key);
  const o = {
    size: 512, cols: 2, rows: 2, color: [70, 78, 72], tint: 0.12, rivets: true, grime: 0.6,
    rust: 0.0, scratches: 0.4, stripes: false, seed: 1, roughness: 0.55, seam: 3, ...opts,
  };
  const N = o.size;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const cC = mk(), cB = mk(), cR = mk();
  const gC = cC.getContext('2d'), gB = cB.getContext('2d'), gR = cR.getContext('2d');
  const iC = gC.createImageData(N, N), iB = gB.createImageData(N, N), iR = gR.createImageData(N, N);
  const pw = N / o.cols, ph = N / o.rows;
  const P = 8;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const n = fbm(u * P, v * P, P, o.seed);
      const fine = vnoise(u * 64, v * 64, 64, o.seed + 5);
      const big = fbm(u * 2, v * 2, 2, o.seed + 9, 3);
      const px = Math.floor(x / pw), py = Math.floor(y / ph);
      const lx = x - px * pw, ly = y - py * ph;
      const panelTint = (hash(px, py, o.seed) - 0.5) * o.tint;
      const edge = Math.min(lx, ly, pw - lx, ph - ly);
      const seam = edge < o.seam;
      const bevel = !seam && edge < o.seam + 3;

      // Kir panelin altında toplanır, büyük ölçekli lekelerle karışır
      const g = Math.min(1, Math.pow(ly / ph, 3) * 0.8 + Math.max(0, big - 0.45) * 1.6) * o.grime * (0.6 + n * 0.8);
      const rustAmt = o.rust * Math.max(0, fbm(u * 4, v * 4, 4, o.seed + 3) - 0.52) * 4;

      let r = o.color[0], gg = o.color[1], b = o.color[2];
      const shade = (0.82 + n * 0.3 + fine * 0.06) * (1 + panelTint);
      r *= shade; gg *= shade; b *= shade;
      r = r * (1 - g * 0.55); gg = gg * (1 - g * 0.5); b = b * (1 - g * 0.55);
      if (rustAmt > 0) {
        const k = Math.min(1, rustAmt);
        r = r * (1 - k) + (95 + n * 40) * k; gg = gg * (1 - k) + (55 + n * 20) * k; b = b * (1 - k) + (30 + n * 10) * k;
      }
      let bump = 0.55 + n * 0.08 + fine * 0.03;
      let rough = o.roughness + n * 0.18 + g * 0.3 + rustAmt * 0.3;

      if (o.stripes && py === o.rows - 1 && ly > ph * 0.7) {
        const st = Math.floor((x + y) / 24) % 2 === 0;
        const wear = n > 0.62 ? 0.5 : 1;
        if (st) { r = 200 * wear; gg = 160 * wear; b = 30 * wear; } else { r = 25; gg = 25; b = 22; }
        rough = 0.6 + n * 0.2;
      }
      if (seam) { r *= 0.35; gg *= 0.35; b *= 0.35; bump = 0.15; rough = 0.9; }
      else if (bevel) { r *= 1.12; gg *= 1.12; b *= 1.12; bump = 0.75; }

      // Perçinler
      if (o.rivets && !seam) {
        for (const [cx, cy] of [[10, 10], [pw - 10, 10], [10, ph - 10], [pw - 10, ph - 10], [pw / 2, 10], [pw / 2, ph - 10]]) {
          const dx = lx - cx, dy = ly - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < 9) {
            const k = 1 - d2 / 9;
            bump = 0.6 + k * 0.4;
            r = r * 0.8 + 140 * k * 0.4; gg = gg * 0.8 + 145 * k * 0.4; b = b * 0.8 + 140 * k * 0.4;
            rough = 0.35;
          }
        }
      }

      const i = (y * N + x) * 4;
      iC.data[i] = Math.min(255, r); iC.data[i + 1] = Math.min(255, gg); iC.data[i + 2] = Math.min(255, b); iC.data[i + 3] = 255;
      const bb = Math.max(0, Math.min(255, bump * 255));
      iB.data[i] = iB.data[i + 1] = iB.data[i + 2] = bb; iB.data[i + 3] = 255;
      const rr = Math.max(0, Math.min(255, rough * 255));
      iR.data[i] = iR.data[i + 1] = iR.data[i + 2] = rr; iR.data[i + 3] = 255;
    }
  }
  gC.putImageData(iC, 0, 0);
  gB.putImageData(iB, 0, 0);
  gR.putImageData(iR, 0, 0);

  // Çizikler: parlak ince çizgiler, pürüzlülükte daha düz
  if (o.scratches > 0) {
    const count = Math.round(140 * o.scratches);
    for (let k = 0; k < count; k++) {
      const x = hash(k, 1, o.seed) * N, y = hash(k, 2, o.seed) * N;
      const a = hash(k, 3, o.seed) * Math.PI * 2, len = 6 + hash(k, 4, o.seed) * 40;
      gC.strokeStyle = `rgba(200,210,200,${0.08 + hash(k, 5, o.seed) * 0.15})`;
      gR.strokeStyle = 'rgba(60,60,60,0.5)';
      for (const g of [gC, gR]) {
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
      }
    }
  }

  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const set = { map: tex(cC, true), bumpMap: tex(cB), roughnessMap: tex(cR) };
  cache.set(key, set);
  return set;
}

// Doku setinden malzeme; repeat her malzeme için ayrı kopyalanır
export function metalMaterial(opts, { repeat = [1, 1], metalness = 0.7, bump = 1.2, color = 0xffffff, side } = {}) {
  const s = metalSet(opts);
  const clone = (t) => { const c = t.clone(); c.repeat.set(repeat[0], repeat[1]); c.needsUpdate = true; return c; };
  return new THREE.MeshStandardMaterial({
    map: clone(s.map), bumpMap: clone(s.bumpMap), roughnessMap: clone(s.roughnessMap),
    bumpScale: bump, metalness, roughness: 1, color, side,
  });
}

// Poly Haven'dan indirilen (CC0) fotogerçekçi doku setleri: assets/textures/<ad>_diff|nor|rough.jpg
const loader = new THREE.TextureLoader();
export function pbrMaterial(name, { repeat = [1, 1], metalness = 0.6, normalScale = 1, color = 0xffffff, side, roughness = 1 } = {}) {
  const load = (map, srgb) => {
    const t = loader.load(`assets/textures/${name}_${map}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return new THREE.MeshStandardMaterial({
    map: load('diff', true), normalMap: load('nor'), roughnessMap: load('rough'),
    normalScale: new THREE.Vector2(normalScale, normalScale), metalness, roughness, color, side,
  });
}

// Yumuşak radyal gradyan (gölge lekesi, ışık hüzmesi vb.)
export function radialTexture(inner = 'rgba(0,0,0,0.85)', outer = 'rgba(0,0,0,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
