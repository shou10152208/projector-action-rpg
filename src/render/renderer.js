// =============================================================
//  Renderer — 全レイヤーの統括描画
//  背景 → カメラ薄映し → 結界/敵/ボス/弾 → 勇者オーラ → 粒子 → HUD
// =============================================================

import { CONFIG } from '../config.js';
import { TAU, clamp, hexToRgb } from '../util.js';
import { Background } from './background.js';
import { Hud } from './hud.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = new Background();
    this.hud = new Hud();
    this.dpr = 1;
    this.w = 0; this.h = 0;
    this._rgbCache = new Map();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.render.maxDpr);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dpr = dpr; this.w = w; this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.bg.resize(w, h);
    return { w, h };
  }

  _rgb(hex) {
    let v = this._rgbCache.get(hex);
    if (!v) { v = hexToRgb(hex); this._rgbCache.set(hex, v); }
    return v;
  }

  render(world, players, video, info, dt) {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 画面シェイク
    if (world.shake > 0.1) {
      const s = world.shake;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    ctx.clearRect(-40, -40, w + 80, h + 80);

    // 背景（タイトル/結果はミックス、それ以外はエリアテーマ）
    const theme = (world.phase === 'title' || !world.run) ? 'title' : world.areaTheme;
    const dimmed = ['levelup', 'gameover', 'victory'].includes(world.phase);
    this.bg.update(dt);
    this.bg.draw(ctx, theme, dimmed);

    // カメラ薄映し（自分の位置確認）
    if (CONFIG.render.showCameraUnderlay && video && video.readyState >= 2 &&
        !['gameover', 'victory'].includes(world.phase)) {
      ctx.save();
      ctx.globalAlpha = CONFIG.render.cameraUnderlayAlpha;
      ctx.translate(w, 0); ctx.scale(-1, 1); // 鏡映
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    }

    // 戦闘エンティティ（各エンティティが自前で描画）
    for (const b of world.barriers) b.draw(ctx, world);
    for (const e of world.enemies) if (e.draw) e.draw(ctx, world);
    if (world.boss && world.boss.alive) world.boss.draw(ctx, world);
    for (const s of world.shockwaves) if (s.draw) s.draw(ctx, world);
    for (const bl of world.bolts) bl.draw(ctx, world);
    for (const pk of world.pickups) if (pk.alive) pk.draw(ctx, world);

    // 勇者オーラ
    for (const p of players) if (p.active) this._drawHero(ctx, p, world);

    // 粒子
    world.particles.draw(ctx);

    // ビネット
    this._vignette(ctx, w, h);

    // 画面フラッシュ
    if (world.screenFlash) {
      const f = world.screenFlash;
      const a = clamp(f.life / f.maxLife, 0, 1) * 0.55;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // HUD
    this.hud.draw(ctx, world, info, dt);
  }

  _drawHero(ctx, p, world) {
    const rgb = this._rgb(p.color);
    const hero = world.run ? world.run.hero(p.id) : null;
    const ready = world.gauge >= world.gaugeMax;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const c = p.center;

    // 戦闘不能: 魂の輪と蘇生ゲージ
    if (hero && hero.downed) {
      ctx.strokeStyle = `rgba(${rgb},0.55)`;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 10]);
      ctx.beginPath(); ctx.arc(c.x, c.y, CONFIG.hero.reviveRadius, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      if (hero.reviveProgress > 0) {
        ctx.strokeStyle = 'rgba(140,255,190,0.95)';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(c.x, c.y, CONFIG.hero.reviveRadius * 0.7,
          -Math.PI / 2, -Math.PI / 2 + hero.reviveProgress * TAU);
        ctx.stroke();
      }
      // 人魂
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 46);
      g.addColorStop(0, `rgba(${rgb},0.6)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.x, c.y, 46, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }

    // 体のエネルギー・テザー（中心 → 各手）
    for (const key of ['left', 'right']) {
      const hand = p.hands[key];
      if (!hand.present) continue;
      const grad = ctx.createLinearGradient(c.x, c.y, hand.x, hand.y);
      grad.addColorStop(0, `rgba(${rgb},0)`);
      grad.addColorStop(1, `rgba(${rgb},0.5)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(hand.x, hand.y); ctx.stroke();
    }

    // 頭の光
    if (p.head.present) {
      this._softCircle(ctx, p.head.x, p.head.y, p.scale * 0.16, rgb, 0.5);
    }

    // ガード: 体の前に光の盾
    if (p.gestures.guard) {
      ctx.strokeStyle = 'rgba(154,220,255,0.85)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, p.scale * 0.55, -Math.PI * 0.85, -Math.PI * 0.15);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(154,220,255,0.35)';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(c.x, c.y, p.scale * 0.55, -Math.PI * 0.85, -Math.PI * 0.15);
      ctx.stroke();
    }

    // 手のオーラ
    for (const key of ['left', 'right']) {
      const hand = p.hands[key];
      if (!hand.present) continue;
      this._drawHand(ctx, hand, rgb, ready);
    }

    // 拳闘士: 足のオーラも
    if (hero && hero.roleId === 'monk') {
      for (const key of ['left', 'right']) {
        const foot = p.feet[key];
        if (!foot.present) continue;
        this._drawHand(ctx, foot, '255,176,77', false);
      }
    }

    // 図形詠唱ロール: 手の軌跡を描く
    if (hero && (hero.roleId === 'mage' || hero.roleId === 'onmyoji')) {
      const accent = this._rgb(hero.roleId === 'mage' ? '#c08bff' : '#8bffb0');
      for (const key of ['left', 'right']) {
        const path = p.paths[key];
        if (path.length < 3) continue;
        ctx.strokeStyle = `rgba(${accent},0.35)`;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
    }

    // 両手上げ時の上昇オーラ
    if (p.gestures.armsRaised) {
      for (const key of ['left', 'right']) {
        const hand = p.hands[key];
        if (!hand.present) continue;
        const colA = ready ? '255,224,107' : rgb;
        const g = ctx.createLinearGradient(hand.x, hand.y, hand.x, hand.y - p.scale);
        g.addColorStop(0, `rgba(${colA},0.5)`);
        g.addColorStop(1, `rgba(${colA},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(hand.x - 10, hand.y - p.scale, 20, p.scale);
      }
    }
    ctx.restore();
  }

  _drawHand(ctx, hand, rgb, ready) {
    const r = hand.radius;
    // 速度に応じた軌跡
    const speed = hand.speed;
    if (speed > 200) {
      const k = clamp(speed / 3000, 0, 0.06);
      ctx.strokeStyle = `rgba(${rgb},0.5)`;
      ctx.lineWidth = r * 0.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hand.x, hand.y);
      ctx.lineTo(hand.x - hand.vx * k, hand.y - hand.vy * k);
      ctx.stroke();
    }
    // コア
    const core = ready ? '255,236,150' : rgb;
    const g = ctx.createRadialGradient(hand.x, hand.y, 0, hand.x, hand.y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, `rgba(${core},0.85)`);
    g.addColorStop(1, `rgba(${core},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(hand.x, hand.y, r, 0, TAU); ctx.fill();
    // リング
    ctx.strokeStyle = `rgba(${core},0.8)`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hand.x, hand.y, r * 0.7, 0, TAU); ctx.stroke();
  }

  _softCircle(ctx, x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  _vignette(ctx, w, h) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
