// =============================================================
//  パーティクルシステム — 火花 / 爆発 / 軌跡 / 衝撃リング / 星屑
//  加算合成(lighter)で発光感を出します。上限で古いものから破棄。
// =============================================================

import { TAU, range, irange, clamp } from '../util.js';
import { CONFIG } from '../config.js';

export class ParticleSystem {
  constructor() {
    this.list = [];
    this.max = CONFIG.render.maxParticles;
  }

  clear() { this.list.length = 0; }

  _add(p) {
    p.maxLife = p.life; // 生成時の寿命を保持（alpha算出用）
    if (this.list.length >= this.max) this.list.splice(0, this.list.length - this.max + 1);
    this.list.push(p);
    return p;
  }

  spark(x, y, rgb, opts = {}) {
    return this._add({
      type: 'spark', x, y,
      vx: opts.vx ?? 0, vy: opts.vy ?? 0,
      life: opts.life ?? range(0.25, 0.6), maxLife: 0,
      size: opts.size ?? range(1.5, 3.5),
      rgb, gravity: opts.gravity ?? 0, drag: opts.drag ?? 2.2,
      fade: opts.fade ?? 1.2,
    });
  }

  glow(x, y, rgb, opts = {}) {
    return this._add({
      type: 'glow', x, y,
      vx: opts.vx ?? 0, vy: opts.vy ?? 0,
      life: opts.life ?? range(0.3, 0.7), maxLife: 0,
      size: opts.size ?? range(8, 18),
      rgb, gravity: opts.gravity ?? 0, drag: opts.drag ?? 1.6,
      fade: opts.fade ?? 1.5,
    });
  }

  streak(x, y, vx, vy, rgb, opts = {}) {
    return this._add({
      type: 'streak', x, y, vx, vy,
      life: opts.life ?? range(0.18, 0.4), maxLife: 0,
      size: opts.size ?? range(2, 4),
      rgb, gravity: 0, drag: opts.drag ?? 3.5,
      fade: 1.4, klen: opts.klen ?? 0.04,
    });
  }

  ring(x, y, rgb, opts = {}) {
    return this._add({
      type: 'ring', x, y, vx: 0, vy: 0,
      life: opts.life ?? 0.5, maxLife: 0,
      r: opts.r ?? 6, growth: opts.growth ?? 600,
      width: opts.width ?? 4, rgb, fade: opts.fade ?? 1,
    });
  }

  debris(x, y, rgb, opts = {}) {
    return this._add({
      type: 'debris', x, y,
      vx: opts.vx ?? range(-120, 120), vy: opts.vy ?? range(-180, -40),
      life: opts.life ?? range(0.6, 1.2), maxLife: 0,
      size: opts.size ?? range(2, 5),
      rgb, gravity: opts.gravity ?? 520, drag: 0.4, fade: 0.8,
      rot: range(0, TAU), spin: range(-8, 8),
    });
  }

  // 爆発（複合）
  explosion(x, y, rgb, size = 1) {
    this.glow(x, y, '255,240,200', { size: 24 * size, life: 0.35, drag: 0.5 });
    this.ring(x, y, rgb, { r: 8 * size, growth: 420 * size, life: 0.45, width: 4 });
    const n = irange(10, 16) * Math.ceil(size);
    for (let i = 0; i < n; i++) {
      const a = range(0, TAU); const sp = range(80, 360) * size;
      this.spark(x, y, rgb, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: range(0.3, 0.7), size: range(1.5, 3.5) });
    }
    for (let i = 0; i < irange(3, 6); i++) {
      const a = range(0, TAU); const sp = range(60, 200) * size;
      this.debris(x, y, rgb, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60 });
    }
  }

  // 手の斬撃軌跡
  slashTrail(x, y, vx, vy, rgb) {
    this.streak(x, y, vx, vy, rgb, { life: range(0.18, 0.32), size: range(2, 5) });
    if (Math.random() < 0.5) this.spark(x, y, rgb, { vx: range(-60, 60), vy: range(-60, 60), life: 0.3 });
  }

  // 星屑（必殺技演出）
  starfall(x, y, rgb) {
    this.glow(x, y, rgb, { size: range(6, 14), life: range(0.5, 1.0), vy: range(60, 200), drag: 0.2 });
  }

  update(dt) {
    const a = this.list;
    for (let i = a.length - 1; i >= 0; i--) {
      const p = a[i];
      p.life -= dt;
      if (p.life <= 0) { a.splice(i, 1); continue; }
      if (p.type === 'ring') {
        p.r += p.growth * dt;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.gravity) p.vy += p.gravity * dt;
      if (p.drag) {
        const d = clamp(1 - p.drag * dt, 0, 1);
        p.vx *= d; p.vy *= d;
      }
      if (p.spin) p.rot += p.spin * dt;
    }
  }

  draw(ctx) {
    const a = this.list;
    // 加算合成パス（発光系）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      if (p.type === 'debris') continue;
      const alpha = this._alpha(p);
      if (p.type === 'spark') {
        ctx.fillStyle = `rgba(${p.rgb},${alpha})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
      } else if (p.type === 'glow') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, `rgba(${p.rgb},${alpha})`);
        g.addColorStop(1, `rgba(${p.rgb},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
      } else if (p.type === 'streak') {
        ctx.strokeStyle = `rgba(${p.rgb},${alpha})`;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * p.klen, p.y - p.vy * p.klen);
        ctx.stroke();
      } else if (p.type === 'ring') {
        ctx.strokeStyle = `rgba(${p.rgb},${alpha})`;
        ctx.lineWidth = p.width;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
      }
    }
    ctx.restore();

    // 通常合成（破片）
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      if (p.type !== 'debris') continue;
      const alpha = this._alpha(p);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot || 0);
      ctx.fillStyle = `rgba(${p.rgb},${alpha})`;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }

  _alpha(p) {
    const r = clamp(p.life / p.maxLife, 0, 1);
    return Math.pow(r, p.fade ?? 1);
  }
}
