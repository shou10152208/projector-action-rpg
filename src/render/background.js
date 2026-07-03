// =============================================================
//  背景 — エリアテーマ別の夜景
//  wa: 和の霊峰（山なみ・鳥居・桜） / west: 洋の魔城（古城・尖塔）
//  chaos: 混沌の狭間（渦巻く異界） / title: 両世界のミックス
//  静的レイヤーはオフスクリーンに事前描画して毎フレームは転写のみ。
// =============================================================

import { TAU, range, mulberry32 } from '../util.js';

export class Background {
  constructor() {
    this.w = 0; this.h = 0;
    this.theme = null;
    this.canvas = null;   // 事前描画した静的レイヤー
    this.t = 0;
    this.petals = [];     // 桜吹雪 / 灰 / 火の粉
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.theme = null; // 再描画を促す
  }

  update(dt) {
    this.t += dt;
    for (const p of this.petals) {
      p.x += p.vx * dt + Math.sin(this.t * p.k) * 20 * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.y > this.h + 20 || p.x < -30 || p.x > this.w + 30) {
        p.x = range(0, this.w); p.y = -20;
      }
    }
  }

  _ensure(theme) {
    if (this.theme === theme && this.canvas) return;
    this.theme = theme;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const ctx = this.canvas.getContext('2d');
    const rng = mulberry32(theme.length * 1000 + 7);
    const w = this.w, h = this.h;

    // 空のグラデーション
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    if (theme === 'wa') {
      sky.addColorStop(0, '#0a0a20'); sky.addColorStop(0.7, '#1a1030'); sky.addColorStop(1, '#241435');
    } else if (theme === 'west') {
      sky.addColorStop(0, '#0a0e1e'); sky.addColorStop(0.7, '#101a2e'); sky.addColorStop(1, '#16223a');
    } else if (theme === 'chaos') {
      sky.addColorStop(0, '#140a24'); sky.addColorStop(0.5, '#2a1038'); sky.addColorStop(1, '#3a1430');
    } else {
      sky.addColorStop(0, '#0a0a1e'); sky.addColorStop(0.7, '#181030'); sky.addColorStop(1, '#221838');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 星
    for (let i = 0; i < 140; i++) {
      const x = rng() * w, y = rng() * h * 0.75;
      const s = rng() * 1.6 + 0.4;
      ctx.fillStyle = `rgba(255,255,${200 + Math.floor(rng() * 55)},${0.25 + rng() * 0.6})`;
      ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
    }

    // 月（テーマで色が変わる）
    const mx = w * 0.8, my = h * 0.18, mr = Math.min(w, h) * 0.07;
    const moonColor = theme === 'chaos' ? '255,120,140' : theme === 'west' ? '200,210,255' : '255,236,180';
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 2.6);
    mg.addColorStop(0, `rgba(${moonColor},0.9)`);
    mg.addColorStop(0.4, `rgba(${moonColor},0.25)`);
    mg.addColorStop(1, `rgba(${moonColor},0)`);
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.arc(mx, my, mr * 2.6, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(${moonColor},0.95)`;
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();

    if (theme === 'wa' || theme === 'title') this._drawWa(ctx, w, h, rng, theme === 'title');
    if (theme === 'west' || theme === 'title') this._drawWest(ctx, w, h, rng, theme === 'title');
    if (theme === 'chaos') this._drawChaos(ctx, w, h, rng);

    // 舞うもの（テーマ別）
    this.petals = [];
    const petalColor = theme === 'wa' ? '255,190,210' : theme === 'west' ? '180,190,220' : '255,150,120';
    const n = theme === 'chaos' ? 26 : 18;
    for (let i = 0; i < n; i++) {
      this.petals.push({
        x: range(0, w), y: range(0, h),
        vx: range(-25, 25), vy: range(18, 55),
        rot: range(0, TAU), spin: range(-3, 3), k: range(0.5, 1.6),
        size: range(3, 7), rgb: petalColor,
      });
    }
  }

  _drawWa(ctx, w, h, rng, half) {
    const x0 = 0, x1 = half ? w * 0.5 : w;
    // 山なみ2層
    for (const [yBase, col] of [[0.62, 'rgba(26,20,48,0.9)'], [0.72, 'rgba(16,12,34,0.95)']]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x0, h);
      let x = x0;
      let y = h * yBase;
      ctx.lineTo(x, y);
      while (x < x1) {
        x += range(60, 140);
        y = h * (yBase + (rng() - 0.5) * 0.12);
        ctx.lineTo(Math.min(x, x1), y);
      }
      ctx.lineTo(x1, h);
      ctx.closePath(); ctx.fill();
    }
    // 鳥居のシルエット
    const tx = x0 + (x1 - x0) * 0.22, ty = h * 0.86, ts = Math.min(w, h) * 0.11;
    ctx.strokeStyle = 'rgba(200,60,60,0.85)';
    ctx.lineWidth = ts * 0.12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tx - ts * 0.5, ty); ctx.lineTo(tx - ts * 0.42, ty - ts);
    ctx.moveTo(tx + ts * 0.5, ty); ctx.lineTo(tx + ts * 0.42, ty - ts);
    ctx.moveTo(tx - ts * 0.72, ty - ts * 0.95); ctx.lineTo(tx + ts * 0.72, ty - ts * 0.95);
    ctx.moveTo(tx - ts * 0.55, ty - ts * 0.72); ctx.lineTo(tx + ts * 0.55, ty - ts * 0.72);
    ctx.stroke();
    // 五重塔風シルエット
    const px = x0 + (x1 - x0) * 0.72, py = h * 0.72, ps = Math.min(w, h) * 0.05;
    ctx.fillStyle = 'rgba(10,8,24,0.95)';
    for (let i = 0; i < 4; i++) {
      const ww = ps * (2.2 - i * 0.4);
      const yy = py - i * ps * 0.9;
      ctx.fillRect(px - ww / 2, yy - ps * 0.6, ww, ps * 0.6);
      ctx.beginPath();
      ctx.moveTo(px - ww / 2 - ps * 0.3, yy - ps * 0.6);
      ctx.lineTo(px + ww / 2 + ps * 0.3, yy - ps * 0.6);
      ctx.lineTo(px, yy - ps * 1.05);
      ctx.closePath(); ctx.fill();
    }
  }

  _drawWest(ctx, w, h, rng, half) {
    const x0 = half ? w * 0.5 : 0, x1 = w;
    // 丘
    ctx.fillStyle = 'rgba(14,18,34,0.95)';
    ctx.beginPath();
    ctx.moveTo(x0, h);
    ctx.lineTo(x0, h * 0.78);
    ctx.quadraticCurveTo((x0 + x1) / 2, h * 0.66, x1, h * 0.8);
    ctx.lineTo(x1, h);
    ctx.closePath(); ctx.fill();
    // 城（塔群）
    const cx = x0 + (x1 - x0) * 0.62, cy = h * 0.78, cs = Math.min(w, h) * 0.085;
    ctx.fillStyle = 'rgba(8,10,26,0.98)';
    const towers = [
      [-1.6, 1.0, 0.5], [-0.6, 1.7, 0.6], [0.5, 1.35, 0.55], [1.5, 0.9, 0.45], [0, 2.3, 0.7],
    ];
    for (const [ox, th, tw] of towers) {
      const x = cx + ox * cs, ww = tw * cs, hh = th * cs;
      ctx.fillRect(x - ww / 2, cy - hh, ww, hh);
      // とんがり屋根
      ctx.beginPath();
      ctx.moveTo(x - ww / 2 - ww * 0.2, cy - hh);
      ctx.lineTo(x + ww / 2 + ww * 0.2, cy - hh);
      ctx.lineTo(x, cy - hh - ww * 1.5);
      ctx.closePath(); ctx.fill();
      // 窓明かり
      if (rng() < 0.8) {
        ctx.fillStyle = 'rgba(255,200,90,0.65)';
        ctx.fillRect(x - ww * 0.12, cy - hh * range(0.4, 0.8), ww * 0.24, ww * 0.3);
        ctx.fillStyle = 'rgba(8,10,26,0.98)';
      }
    }
    // 城壁
    ctx.fillStyle = 'rgba(8,10,26,0.98)';
    ctx.fillRect(cx - cs * 2.2, cy - cs * 0.5, cs * 4.4, cs * 0.5);
    for (let i = 0; i < 9; i++) {
      ctx.fillRect(cx - cs * 2.2 + i * cs * 0.52, cy - cs * 0.68, cs * 0.26, cs * 0.2);
    }
  }

  _drawChaos(ctx, w, h, rng) {
    // 異界の渦（両世界の破片が漂う）
    for (let i = 0; i < 5; i++) {
      const x = rng() * w, y = rng() * h * 0.7;
      const r = (0.08 + rng() * 0.1) * Math.min(w, h);
      const hue = rng() < 0.5 ? '255,80,160' : '120,80,255';
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${hue},0.16)`);
      g.addColorStop(1, `rgba(${hue},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    // 浮遊する島
    for (let i = 0; i < 4; i++) {
      const x = w * (0.15 + i * 0.24), y = h * (0.5 + (rng() - 0.5) * 0.2);
      const s = Math.min(w, h) * (0.05 + rng() * 0.04);
      ctx.fillStyle = 'rgba(20,10,32,0.95)';
      ctx.beginPath();
      ctx.moveTo(x - s, y);
      ctx.quadraticCurveTo(x, y - s * 0.5, x + s, y);
      ctx.lineTo(x + s * 0.4, y + s * 1.1);
      ctx.lineTo(x - s * 0.3, y + s * 0.8);
      ctx.closePath(); ctx.fill();
      // 島の上の残骸（鳥居 or 塔）
      ctx.strokeStyle = i % 2 ? 'rgba(200,60,60,0.7)' : 'rgba(120,130,180,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (i % 2) {
        ctx.moveTo(x - s * 0.3, y); ctx.lineTo(x - s * 0.26, y - s * 0.55);
        ctx.moveTo(x + s * 0.3, y); ctx.lineTo(x + s * 0.26, y - s * 0.55);
        ctx.moveTo(x - s * 0.42, y - s * 0.5); ctx.lineTo(x + s * 0.42, y - s * 0.5);
      } else {
        ctx.moveTo(x - s * 0.2, y); ctx.lineTo(x - s * 0.2, y - s * 0.6);
        ctx.lineTo(x, y - s * 0.85); ctx.lineTo(x + s * 0.2, y - s * 0.6);
        ctx.lineTo(x + s * 0.2, y);
      }
      ctx.stroke();
    }
    // 地面（ひび割れた大地）
    ctx.fillStyle = 'rgba(16,8,26,0.98)';
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
    ctx.strokeStyle = 'rgba(255,90,140,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const x = rng() * w;
      ctx.beginPath();
      ctx.moveTo(x, h * 0.86);
      ctx.lineTo(x + range(-40, 40), h * (0.9 + rng() * 0.08));
      ctx.stroke();
    }
  }

  draw(ctx, theme, dimmed = false) {
    this._ensure(theme);
    ctx.drawImage(this.canvas, 0, 0);
    if (dimmed) {
      ctx.fillStyle = 'rgba(0,0,10,0.45)';
      ctx.fillRect(0, 0, this.w, this.h);
    }
    // 舞う花びら/火の粉
    ctx.save();
    for (const p of this.petals) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = `rgba(${p.rgb},0.8)`;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
