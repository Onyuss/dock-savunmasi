// Klavye + fare girişi. Oyun mantığı yalnızca bu nesneyi okur;
// co-op aşamasında aynı yapı ağ üzerinden gelen komutlarla da doldurulabilir.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // bu karede yeni basılan tuşlar
    this.dx = 0;
    this.dy = 0;
    this.fire = false;
    this.aim = false;           // sağ tık: dürbün
    this.locked = false;
    this.sensitivity = 0.0022;
    this.zoom = 1;              // dürbünde fare hassasiyeti çarpanı
    this.joy = { active: false, x: 0, z: 0 };  // dokunmatik joystick
    this.touchActive = false;   // dokunmatik modda oyun sürüyor mu

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.aim = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.aim = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('blur', () => { this.keys.clear(); this.fire = false; this.aim = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.fire = false; this.aim = false; }
    });
  }

  lock() {
    const p = this.canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  // Fare hareketini radyan olarak döndürür ve sıfırlar
  look() {
    const s = this.sensitivity * this.zoom;
    const r = { yaw: -this.dx * s, pitch: -this.dy * s };
    this.dx = this.dy = 0;
    return r;
  }

  // WASD → { x: sağ/sol, z: ileri/geri }
  axis() {
    if (this.joy.active) return { x: this.joy.x, z: this.joy.z };
    return {
      x: (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0),
      z: (this.down('KeyW') ? 1 : 0) - (this.down('KeyS') ? 1 : 0),
    };
  }

  // Shift ya da joystick sonuna kadar itilmiş
  sprint() {
    return this.down('ShiftLeft') || (this.joy.active && Math.hypot(this.joy.x, this.joy.z) > 0.92);
  }

  endFrame() { this.pressed.clear(); }
}
