// Servis çalışanı: oyunu çevrimdışı oynanabilir yapar.
// Strateji: önce ağ (her zaman en güncel dosya), ağ yoksa önbellek.
const CACHE = 'dock-v8';
const CORE = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'src/main.js', 'src/input.js', 'src/touch.js', 'src/audio.js', 'src/effects.js', 'src/world.js',
  'src/textures.js', 'src/player.js', 'src/apu.js', 'src/turret.js', 'src/enemies.js',
  'src/shop.js', 'src/rockets.js', 'src/hammer.js', 'src/campaign.js', 'src/models.js',
  'assets/models/apu.glb', 'assets/models/turret.glb',
  'vendor/three/build/three.module.js',
  'assets/hdri/industrial_pipe_and_valve_01_1k.hdr',
  ...['metal_plate', 'rusty_metal_02', 'rusty_metal_sheet', 'green_metal_rust']
    .flatMap((n) => ['diff', 'nor', 'rough'].map((m) => `assets/textures/${n}_${m}.jpg`)),
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
