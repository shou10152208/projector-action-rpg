// =============================================================
//  フォールバック入力 — マウス / キーボード
//  カメラが使えない時に自動で有効化されます。
//  [マウス移動] 手  [左クリック/Space] 決定・必殺
//  [C] 拍手  [X] ロール固有技  [右クリック長押し/Shift] ガード
// =============================================================

import { clamp } from '../util.js';

export class FallbackInput {
  constructor() {
    this.px = 0.5;          // 正規化カーソル位置 (0..1)
    this.py = 0.5;
    this.mouseDown = false; // マウス/タッチ長押し中
    this.rightDown = false; // 右ボタン長押し = ガード
    this.keyMoving = false; // 矢印/WASD移動中
    this.keys = new Set();
    this._clap = false;     // 消費型エッジ
    this._primary = false;  // 決定/必殺（スペース・クリック）
    this._special = false;  // ロール固有技（X）
    this._attached = false;
    this.canvas = null;
  }

  attach(canvas) {
    if (this._attached) return;
    this.canvas = canvas;
    this._attached = true;

    const setFromEvent = (e) => {
      const r = canvas.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        this.px = clamp((e.clientX - r.left) / r.width, 0, 1);
        this.py = clamp((e.clientY - r.top) / r.height, 0, 1);
      }
    };

    window.addEventListener('mousemove', setFromEvent, { passive: true });

    window.addEventListener('mousedown', (e) => {
      setFromEvent(e);
      if (e.button === 0) { this.mouseDown = true; this._primary = true; }
      if (e.button === 2) { this.rightDown = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // タッチ簡易対応
    window.addEventListener('touchstart', (e) => {
      if (e.touches[0]) { setFromEvent(e.touches[0]); this.mouseDown = true; this._primary = true; }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (e.touches[0]) setFromEvent(e.touches[0]);
    }, { passive: true });
    window.addEventListener('touchend', () => { this.mouseDown = false; });

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') { this._primary = true; e.preventDefault(); }
      if (e.code === 'KeyC') { this._clap = true; }
      if (e.code === 'KeyX') { this._special = true; }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  update(dt) {
    // 矢印 / WASD でカーソル移動（マウスが無い環境向け）
    let mx = 0, my = 0;
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyA')) mx -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) mx += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) my -= 1;
    if (k.has('ArrowDown') || k.has('KeyS')) my += 1;
    if (mx || my) {
      const l = Math.hypot(mx, my) || 1;
      const sp = 1.15; // 画面/秒
      this.px = clamp(this.px + (mx / l) * sp * dt, 0, 1);
      this.py = clamp(this.py + (my / l) * sp * dt, 0, 1);
      this.keyMoving = true;  // キー移動中は常に強化（はじける）
    } else {
      this.keyMoving = false;
    }
  }

  getHand() {
    return {
      nx: this.px, ny: this.py, present: true,
      power: this.mouseDown || this.keyMoving,
      guard: this.rightDown || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
    };
  }

  consumeClap() { const c = this._clap; this._clap = false; return c; }
  consumePrimary() { const p = this._primary; this._primary = false; return p; }
  consumeSpecial() { const s = this._special; this._special = false; return s; }
}
