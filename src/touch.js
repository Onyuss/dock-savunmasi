// Telefon ve tablet için dokunmatik kontroller.
// Sol tarafta beliren sanal joystick, sağ yarıda kaydırarak nişan, ekran düğmeleri.
// Hepsi aynı Input nesnesini doldurur; oyun mantığı farkı bilmez.

export const isTouch = (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0)
  || new URLSearchParams(location.search).has('touch');

const LOOK_GAIN = 2.2;   // parmak kaydırma → fare hareketi çarpanı
const R = 60;            // joystick yarıçapı (px)

export function setupTouch(input, { onPause }) {
  document.body.classList.add('touch');
  const $ = (id) => document.getElementById(id);
  const base = $('joyBase'), knob = $('joyKnob');
  let joyId = null, lookId = null, ox = 0, oy = 0, lx = 0, ly = 0;

  const resetJoy = () => {
    joyId = null;
    input.joy.active = false;
    input.joy.x = input.joy.z = 0;
    base.classList.remove('on');
    knob.style.transform = 'translate(-50%, -50%)';
  };

  addEventListener('touchstart', (e) => {
    if (!input.touchActive) return;
    for (const t of e.changedTouches) {
      if (t.target.closest && t.target.closest('.tbtn')) continue;
      if (t.clientX < innerWidth * 0.42 && joyId === null) {
        joyId = t.identifier;
        ox = t.clientX; oy = t.clientY;
        base.style.left = ox + 'px';
        base.style.top = oy + 'px';
        base.classList.add('on');
        input.joy.active = true;
      } else if (lookId === null) {
        lookId = t.identifier;
        lx = t.clientX; ly = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });

  addEventListener('touchmove', (e) => {
    if (!input.touchActive) return;
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        let dx = t.clientX - ox, dy = t.clientY - oy;
        const len = Math.hypot(dx, dy);
        if (len > R) { dx *= R / len; dy *= R / len; }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        input.joy.x = dx / R;
        input.joy.z = -dy / R;
      } else if (t.identifier === lookId) {
        input.dx += (t.clientX - lx) * LOOK_GAIN;
        input.dy += (t.clientY - ly) * LOOK_GAIN;
        lx = t.clientX; ly = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });

  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) resetJoy();
      if (t.identifier === lookId) lookId = null;
    }
  };
  addEventListener('touchend', end);
  addEventListener('touchcancel', end);

  // Düğmeler
  const hold = (id, down, up) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); down(); }, { passive: false });
    const release = (e) => { e.preventDefault(); el.classList.remove('down'); if (up) up(); };
    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('touchcancel', release, { passive: false });
  };
  const tap = (id, code) => hold(id, () => input.pressed.add(code));

  hold('tFire', () => { input.fire = true; }, () => { input.fire = false; });
  hold('tAim', () => {
    input.aim = !input.aim;
    $('tAim').classList.toggle('active', input.aim);
  });
  tap('tUse', 'KeyE');
  tap('tView', 'KeyV');
  tap('tJump', 'Space');
  tap('tReload', 'KeyR');
  hold('tPause', () => {
    input.fire = false;
    input.aim = false;
    $('tAim').classList.remove('active');
    resetJoy();
    lookId = null;
    onPause();
  });
}

// Tam ekran + yatay yön kilidi (destekleyen tarayıcılarda)
export async function enterFullscreen() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch { /* iOS Safari desteklemez; sorun değil */ }
}
