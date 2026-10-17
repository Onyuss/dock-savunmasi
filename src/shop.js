// Kredi ve geliştirmeler. Hazırlık sürelerinde açılır; 1–7 tuşları ya da dokunarak satın alınır.
import { sfx } from './audio.js';

const ITEMS = [
  { id: 'dmg', name: 'Hasar +20%', costs: [150, 300, 500, 750, 1100] },
  { id: 'rate', name: 'Atış hızı +12%', costs: [200, 400, 650, 1000] },
  { id: 'cool', name: 'Soğutma: ısı −20%', costs: [150, 300, 500, 800] },
  { id: 'rocket', name: 'Roket daha sık dolar', costs: [250, 450, 700, 1000] },
  { id: 'repair', name: 'Tüm APU ve kuleleri onar', cost: 300 },
  { id: 'revive', name: 'Düşmüş bir APU’yu ayağa kaldır', cost: 600 },
  { id: 'life', name: '+1 can', cost: 500 },
];
const ROCKET_EVERY = [50, 40, 32, 25, 18];

export class Shop {
  constructor(game) {
    this.game = game;
    this.credits = 0;
    this.lv = { dmg: 0, rate: 0, cool: 0, rocket: 0 };
    this.open = false;
    this.el = document.getElementById('shop');
    this.list = document.getElementById('shopList');
    this.list.innerHTML = ITEMS.map((it, i) => `
      <button class="shop-item" data-i="${i}"><span class="key">${i + 1}</span><span class="name">${it.name}</span><span class="lvl"></span><span class="cost"></span></button>`).join('');
    this.buttons = [...this.list.querySelectorAll('.shop-item')];
    for (const b of this.buttons) {
      const buy = (e) => { e.preventDefault(); e.stopPropagation(); this.buy(+b.dataset.i); };
      b.addEventListener('touchstart', buy, { passive: false });
      b.addEventListener('mousedown', buy);
    }
    const ready = document.getElementById('shopReady');
    const go = (e) => { e.preventDefault(); e.stopPropagation(); if (this.onReady) this.onReady(); };
    ready.addEventListener('touchstart', go, { passive: false });
    ready.addEventListener('mousedown', go);
    this.render();
  }

  // Oyuncu silahlarına uygulanan çarpanlar
  get dmg() { return 1 + this.lv.dmg * 0.2; }
  get rate() { return 1 - this.lv.rate * 0.12; }
  get heat() { return 1 - this.lv.cool * 0.2; }
  get rocketEvery() { return ROCKET_EVERY[this.lv.rocket]; }

  earn(n) { this.credits += n; this.render(); }

  setOpen(v) {
    if (this.open === v) return;
    this.open = v;
    this.el.classList.toggle('on', v);
    this.render();
  }

  // Bir ürünün bu an fiyatı (null = alınamaz)
  price(it) {
    const g = this.game;
    if (it.costs) { const l = this.lv[it.id]; return l < it.costs.length ? it.costs[l] : null; }
    if (it.id === 'revive') return g.apus.some((a) => !a.alive) ? it.cost : null;
    if (it.id === 'repair') return [...g.apus, ...g.turrets].some((v) => v.alive && v.hp < v.maxHp) ? it.cost : null;
    return it.cost;
  }

  buy(i) {
    if (!this.open) return;
    const it = ITEMS[i];
    if (!it) return;
    const p = this.price(it);
    if (p === null || p > this.credits) { sfx.hurt(); return; }
    this.credits -= p;
    const g = this.game;
    if (it.costs) this.lv[it.id]++;
    else if (it.id === 'repair') for (const v of [...g.apus, ...g.turrets]) { if (v.alive) v.hp = Math.min(v.maxHp, v.hp + v.maxHp * 0.6); }
    else if (it.id === 'revive') g.reviveApu(g.apus.find((a) => !a.alive));
    else if (it.id === 'life') g.lives++;
    sfx.enter();
    g.message(it.name, 1.2);
    this.render();
  }

  // Hazırlıkta 1–7 tuşları
  handleKeys(input) {
    if (!this.open) return;
    for (let i = 0; i < ITEMS.length; i++) if (input.hit('Digit' + (i + 1)) || input.hit('Numpad' + (i + 1))) this.buy(i);
  }

  render() {
    document.getElementById('shopCredits').textContent = this.credits;
    document.getElementById('credits').textContent = '◆ ' + this.credits;
    ITEMS.forEach((it, i) => {
      const b = this.buttons[i];
      const p = this.price(it);
      b.querySelector('.lvl').textContent = it.costs ? '▮'.repeat(this.lv[it.id]) + '▯'.repeat(it.costs.length - this.lv[it.id]) : '';
      b.querySelector('.cost').textContent = p === null ? (it.costs ? 'MAKS' : '—') : '◆ ' + p;
      b.disabled = p === null || p > this.credits;
    });
  }
}
