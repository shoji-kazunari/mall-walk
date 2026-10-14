// 歩く・見回す・商品を手に取るの入力。
// PC: クリックでマウス固定（できない環境ではドラッグで見回す）、WASD/矢印で歩く、Shiftで早歩き
// スマホ: 画面左側をなぞると歩く（その場に出るスティック）、右側をなぞると見回す、タップで手に取る

export class Controls {
  constructor(dom, { onPick }) {
    this.dom = dom;
    this.onPick = onPick;
    this.yaw = 0;
    this.pitch = -0.04;
    this.enabled = false;
    this.keys = new Set();
    this.move = { x: 0, y: 0 }; // スティック入力（-1〜1）
    this.joy = null;
    this.look = null;
    this.drag = null;
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.joyBase = document.getElementById('joy');
    this.joyKnob = document.getElementById('joy-knob');

    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        // Chromeはマウス固定の直後に、ありえない大きさの移動量を1回送ってくることがある
        if (Math.abs(e.movementX) > 150 || Math.abs(e.movementY) > 150) return;
        this.turn(e.movementX * 0.0022, e.movementY * 0.0022);
      }
      else if (this.drag) {
        this.turn((e.clientX - this.drag.x) * 0.004, (e.clientY - this.drag.y) * 0.004);
        this.drag.moved += Math.abs(e.clientX - this.drag.x) + Math.abs(e.clientY - this.drag.y);
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
      }
    });
    dom.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.isTouch || e.button !== 0) return;
      if (this.locked) {
        this.onPick(null);
        return;
      }
      this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
    });
    addEventListener('mouseup', (e) => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      if (d.moved < 6 && this.enabled) this.onPick({ x: e.clientX, y: e.clientY });
    });

    dom.addEventListener('touchstart', (e) => this.touchStart(e), { passive: false });
    dom.addEventListener('touchmove', (e) => this.touchMove(e), { passive: false });
    dom.addEventListener('touchend', (e) => this.touchEnd(e), { passive: false });
    dom.addEventListener('touchcancel', (e) => this.touchEnd(e), { passive: false });
  }

  get locked() {
    return document.pointerLockElement === this.dom;
  }

  lock() {
    if (this.isTouch || !this.dom.requestPointerLock) return;
    try {
      const r = this.dom.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch {
      // 埋め込み表示などでマウス固定が許されないときはドラッグ操作のまま使う
    }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  turn(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - dy));
  }

  touchStart(e) {
    e.preventDefault();
    if (!this.enabled) return;
    for (const t of e.changedTouches) {
      if (!this.joy && t.clientX < innerWidth * 0.45) {
        this.joy = { id: t.identifier, x: t.clientX, y: t.clientY };
        this.joyBase.style.left = `${t.clientX}px`;
        this.joyBase.style.top = `${t.clientY}px`;
        this.joyBase.classList.add('on');
        this.joyKnob.style.transform = 'translate(-50%, -50%)';
      } else if (!this.look) {
        this.look = { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now() };
      }
    }
  }

  touchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this.joy && t.identifier === this.joy.id) {
        const R = 56;
        let dx = t.clientX - this.joy.x, dy = t.clientY - this.joy.y;
        const len = Math.hypot(dx, dy);
        if (len > R) { dx *= R / len; dy *= R / len; }
        this.move.x = dx / R;
        this.move.y = -dy / R;
        this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (this.look && t.identifier === this.look.id) {
        this.turn((t.clientX - this.look.x) * 0.006, (t.clientY - this.look.y) * 0.006);
        this.look.x = t.clientX;
        this.look.y = t.clientY;
      }
    }
  }

  touchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this.joy && t.identifier === this.joy.id) {
        this.joy = null;
        this.move.x = this.move.y = 0;
        this.joyBase.classList.remove('on');
      } else if (this.look && t.identifier === this.look.id) {
        const l = this.look;
        this.look = null;
        const moved = Math.hypot(t.clientX - l.sx, t.clientY - l.sy);
        if (this.enabled && moved < 12 && performance.now() - l.t < 600) this.onPick({ x: t.clientX, y: t.clientY });
      }
    }
  }

  // 前後・左右の入力（-1〜1）と、早歩きかどうか
  input() {
    const k = this.keys;
    let f = this.move.y, s = this.move.x;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD')) s += 1;
    if (k.has('KeyA')) s -= 1;
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    return { f, s, run: k.has('ShiftLeft') || k.has('ShiftRight'), turn: (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0) };
  }

  reset() {
    this.keys.clear();
    this.move.x = this.move.y = 0;
    this.joy = this.look = this.drag = null;
    this.joyBase.classList.remove('on');
  }
}
