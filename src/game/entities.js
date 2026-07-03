// =============================================================
//  エンティティ — 和洋の妖魔 / ボス / 弾 / 魂 / 結界 / 衝撃波
//  各エンティティが自分で update(dt, world) と draw(ctx, world) を持つ。
//  ダメージは takeDamage(amount, world, info)。info.silent で
//  接触ダメージの演出を抑制（鬼・ミミックは接触耐性の判定にも使う）。
// =============================================================

import { CONFIG } from '../config.js';
import { TAU, clamp, dist, range, chance } from '../util.js';

let _eid = 1;

// -------------------------------------------------------------
//  敵基底クラス
// -------------------------------------------------------------
export class Enemy {
  constructor(type, x, y, world) {
    const c = CONFIG.enemies[type];
    this.id = _eid++;
    this.type = type;
    this.cfg = c;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    const scale = world ? world.enemyScale : 1;
    this.maxHp = c.hp * scale;
    this.hp = this.maxHp;
    this.radius = c.radius;
    this.atk = (c.atk || 0) * (world ? world.enemyAtkScale : 1);
    this.alive = true;
    this.telegraph = CONFIG.enemies.spawnTelegraph; // 出現予告
    this.windup = 0;        // 近接攻撃の予備動作残り
    this.windupTarget = null;
    this.atkCd = range(0.3, (c.atkCd || 1.5));
    this.fireCd = c.fireEvery ? range(1.0, c.fireEvery) : 0;
    this.hitFlash = 0;
    this.t = range(0, 10);  // 揺らぎ用
    this.kbx = 0; this.kby = 0; // ノックバック速度
    this.gen = 0;           // スライム分裂世代
  }

  get active() { return this.alive && this.telegraph <= 0; }

  // 最も近い生存ヒーローの座標
  _nearestTarget(world) {
    let best = null, bd = 1e18;
    for (const t of world.heroTargets) {
      if (t.downed) continue;
      const d = dist(this.x, this.y, t.x, t.y);
      if (d < bd) { bd = d; best = t; }
    }
    return best ? { t: best, d: bd } : null;
  }

  update(dt, world) {
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    if (this.telegraph > 0) { this.telegraph -= dt; return; }

    // ノックバック減衰
    this.x += this.kbx * dt; this.y += this.kby * dt;
    this.kbx *= Math.max(0, 1 - 6 * dt);
    this.kby *= Math.max(0, 1 - 6 * dt);

    this._behave(dt, world);

    // 画面内にゆるく留める
    this.x = clamp(this.x, -60, world.w + 60);
    this.y = clamp(this.y, -60, world.h + 60);
  }

  // 標準行動: ターゲットへ接近して近接攻撃
  _behave(dt, world) {
    const near = this._nearestTarget(world);
    if (!near) return;
    const { t, d } = near;
    this.atkCd = Math.max(0, this.atkCd - dt);

    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0 && this.windupTarget) {
        // 攻撃発動（範囲内に残っていれば命中）
        const tt = world.heroTargets.find((h) => h.key === this.windupTarget);
        if (tt && !tt.downed && dist(this.x, this.y, tt.x, tt.y) < (this.cfg.atkRange || 60) + this.radius + 40) {
          world.damageHero(tt.key, this.atk, { x: this.x, y: this.y });
        }
        this.windupTarget = null;
        this.atkCd = this.cfg.atkCd || 1.5;
      }
      return; // 予備動作中は動かない
    }

    this._move(dt, world, t, d);

    if (this.atk > 0 && d < (this.cfg.atkRange || 60) + this.radius && this.atkCd <= 0) {
      this.windup = CONFIG.enemies.windup;
      this.windupTarget = t.key;
    }
  }

  _move(dt, world, t, d) {
    const sp = this.cfg.speed || 60;
    if (d > 1) {
      this.x += ((t.x - this.x) / d) * sp * dt;
      this.y += ((t.y - this.y) / d) * sp * dt;
    }
  }

  takeDamage(amount, world, info = {}) {
    if (!this.alive || this.telegraph > 0) return;
    let dmg = amount;
    // 接触耐性（鬼・ミミック）: 触れているだけのダメージを軽減
    if (this.cfg.contactResist && info.silent) dmg *= this.cfg.contactResist;
    this.hp -= dmg;
    this.hitFlash = 1;
    if (!info.silent) {
      world.particles.spark(info.x ?? this.x, info.y ?? this.y, info.rgb || '255,220,140',
        { vx: range(-90, 90), vy: range(-90, 90) });
    }
    world.onEnemyDamaged(this, dmg, info);
    if (this.hp <= 0) this._die(world, info);
  }

  _die(world, info) {
    this.alive = false;
    world.onEnemyKilled(this, info);
    this._onDeath(world, info);
  }

  _onDeath(world, info) {}

  get rgb() { return '255,120,120'; }

  draw(ctx, world) {
    if (this.telegraph > 0) {
      // 出現予告の魔法陣
      const a = 1 - this.telegraph / CONFIG.enemies.spawnTelegraph;
      ctx.save();
      ctx.globalAlpha = 0.25 + a * 0.5;
      ctx.strokeStyle = `rgba(${this.rgb},0.9)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * (1.6 - a * 0.6), 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * a, 0, TAU); ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.save();
    this._drawBody(ctx, world);
    // 予備動作の警告
    if (this.windup > 0) {
      const k = 1 - this.windup / CONFIG.enemies.windup;
      ctx.strokeStyle = `rgba(255,80,80,${0.4 + k * 0.6})`;
      ctx.lineWidth = 3 + k * 3;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius + 10 + k * 8, 0, TAU); ctx.stroke();
    }
    // HPバー（減っている時だけ）
    if (this.hp < this.maxHp) {
      const w = this.radius * 1.8;
      const r = clamp(this.hp / this.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(this.x - w / 2, this.y - this.radius - 14, w, 5);
      ctx.fillStyle = r > 0.4 ? 'rgba(120,255,140,0.9)' : 'rgba(255,120,90,0.9)';
      ctx.fillRect(this.x - w / 2, this.y - this.radius - 14, w * r, 5);
    }
    ctx.restore();
  }

  _drawBody(ctx) {
    ctx.fillStyle = `rgba(${this.rgb},0.9)`;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, TAU); ctx.fill();
  }

  _flash(ctx) {
    if (this.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.hitFlash * 0.55})`;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius + 3, 0, TAU); ctx.fill();
    }
  }
}

// -------------------------------------------------------------
//  和の妖怪
// -------------------------------------------------------------

// 提灯お化け: ふわふわ漂って接近
export class Chochin extends Enemy {
  constructor(x, y, world) { super('chochin', x, y, world); }
  get rgb() { return '255,170,80'; }
  _move(dt, world, t, d) {
    super._move(dt, world, t, d);
    this.y += Math.sin(this.t * 2.2) * 26 * dt;
  }
  _drawBody(ctx) {
    const r = this.radius;
    // 提灯本体
    const g = ctx.createRadialGradient(this.x, this.y, 2, this.x, this.y, r * 1.4);
    g.addColorStop(0, 'rgba(255,220,140,0.9)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(this.x, this.y, r * 1.4, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(230,90,40,0.95)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y, r * 0.75, r, 0, 0, TAU); ctx.fill();
    // 横縞
    ctx.strokeStyle = 'rgba(120,30,10,0.6)';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.ellipse(this.x, this.y + i * r * 0.3, r * 0.7 * Math.sqrt(1 - (i * 0.3) ** 2 * 0.8), r * 0.12, 0, 0, TAU); ctx.stroke();
    }
    // 一つ目と舌
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(this.x, this.y - r * 0.2, r * 0.26, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(this.x, this.y - r * 0.2, r * 0.12, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,90,110,0.9)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + r * 0.55, r * 0.16, r * 0.4, 0, 0, TAU); ctx.fill();
    this._flash(ctx);
  }
}

// からかさ小僧: ぴょんぴょん跳ねて接近
export class Kasa extends Enemy {
  constructor(x, y, world) {
    super('kasa', x, y, world);
    this.hopT = range(0, this.cfg.hopEvery);
  }
  get rgb() { return '170,120,255'; }
  _move(dt, world, t, d) {
    this.hopT -= dt;
    if (this.hopT <= 0) {
      this.hopT = this.cfg.hopEvery;
      if (d > 1) {
        this.kbx += ((t.x - this.x) / d) * this.cfg.speed * 1.6;
        this.kby += ((t.y - this.y) / d) * this.cfg.speed * 1.6 - 60;
      }
    }
    this.kby += 140 * dt; // 軽い重力感
  }
  _drawBody(ctx) {
    const r = this.radius;
    const hop = Math.max(0, Math.sin((this.cfg.hopEvery - this.hopT) / this.cfg.hopEvery * Math.PI)) * 6;
    const y = this.y - hop;
    // 傘
    ctx.fillStyle = 'rgba(150,90,220,0.95)';
    ctx.beginPath(); ctx.moveTo(this.x - r, y);
    ctx.quadraticCurveTo(this.x, y - r * 1.5, this.x + r, y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(90,40,140,0.8)';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(this.x, y - r * 1.15); ctx.lineTo(this.x + i * r * 0.45, y); ctx.stroke();
    }
    // 一本足
    ctx.strokeStyle = 'rgba(240,220,200,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(this.x, y); ctx.lineTo(this.x, y + r * 0.9); ctx.stroke();
    // 目と舌
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(this.x - r * 0.2, y - r * 0.35, r * 0.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(this.x - r * 0.2, y - r * 0.35, r * 0.09, 0, TAU); ctx.fill();
    this._flash(ctx);
  }
}

// 鬼: 接触耐性のある重量級（斬撃・技で割る）
export class Oni extends Enemy {
  constructor(x, y, world) { super('oni', x, y, world); }
  get rgb() { return '255,80,80'; }
  _drawBody(ctx) {
    const r = this.radius;
    // 体
    ctx.fillStyle = 'rgba(210,60,60,0.95)';
    ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, TAU); ctx.fill();
    // 角
    ctx.fillStyle = 'rgba(255,240,210,0.95)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(this.x + s * r * 0.4, this.y - r * 0.7);
      ctx.lineTo(this.x + s * r * 0.62, this.y - r * 1.25);
      ctx.lineTo(this.x + s * r * 0.75, this.y - r * 0.6);
      ctx.closePath(); ctx.fill();
    }
    // 目・牙
    ctx.fillStyle = 'rgba(255,230,60,0.95)';
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(this.x + s * r * 0.35, this.y - r * 0.15, r * 0.14, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#fff';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(this.x + s * r * 0.3, this.y + r * 0.4);
      ctx.lineTo(this.x + s * r * 0.42, this.y + r * 0.62);
      ctx.lineTo(this.x + s * r * 0.18, this.y + r * 0.5);
      ctx.closePath(); ctx.fill();
    }
    // 金棒っぽい模様
    ctx.strokeStyle = 'rgba(120,20,20,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.72, 0.3, 1.4); ctx.stroke();
    this._flash(ctx);
  }
}

// 鬼火: 距離を保って火の玉を撃つ
export class Onibi extends Enemy {
  constructor(x, y, world) { super('onibi', x, y, world); }
  get rgb() { return '110,190,255'; }
  _behave(dt, world) {
    const near = this._nearestTarget(world);
    if (!near) return;
    const { t, d } = near;
    const keep = 300;
    const sp = this.cfg.speed;
    if (d > keep + 40) {
      this.x += ((t.x - this.x) / d) * sp * dt;
      this.y += ((t.y - this.y) / d) * sp * dt;
    } else if (d < keep - 40) {
      this.x -= ((t.x - this.x) / d) * sp * dt;
      this.y -= ((t.y - this.y) / d) * sp * dt;
    }
    this.x += Math.cos(this.t * 1.7) * 40 * dt;
    this.fireCd -= dt;
    if (this.fireCd <= 0) {
      this.fireCd = this.cfg.fireEvery;
      world.spawnShotAt(this.x, this.y, t.x, t.y, this.cfg.shotSpeed, this.cfg.shotDamage, '110,190,255');
      world.audio.bolt();
    }
  }
  _drawBody(ctx) {
    const r = this.radius;
    const g = ctx.createRadialGradient(this.x, this.y, 1, this.x, this.y, r * 1.6);
    g.addColorStop(0, 'rgba(210,240,255,0.95)');
    g.addColorStop(0.4, 'rgba(110,190,255,0.7)');
    g.addColorStop(1, 'rgba(60,120,255,0)');
    ctx.fillStyle = g;
    // ゆらめく炎形
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 1.4, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(180,230,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(this.x - r * 0.6, this.y + r * 0.3);
    ctx.quadraticCurveTo(this.x - r * 0.3, this.y - r * (1.1 + Math.sin(this.t * 6) * 0.2), this.x, this.y - r * 0.4);
    ctx.quadraticCurveTo(this.x + r * 0.4, this.y - r * (1.3 + Math.cos(this.t * 5) * 0.2), this.x + r * 0.6, this.y + r * 0.3);
    ctx.closePath(); ctx.fill();
    this._flash(ctx);
  }
}

// -------------------------------------------------------------
//  洋の魔物
// -------------------------------------------------------------

// スライム: 倒すと分裂
export class Slime extends Enemy {
  constructor(x, y, world, gen = 0) {
    super('slime', x, y, world);
    this.gen = gen;
    if (gen > 0) {
      this.maxHp *= 0.45; this.hp = this.maxHp;
      this.radius *= 0.68; this.atk *= 0.6;
    }
  }
  get rgb() { return '110,255,140'; }
  _onDeath(world) {
    if (this.gen >= 1) return;
    for (let i = 0; i < this.cfg.splits; i++) {
      const s = new Slime(this.x + range(-24, 24), this.y + range(-24, 24), world, this.gen + 1);
      s.telegraph = 0.25;
      world.enemies.push(s);
    }
  }
  _drawBody(ctx) {
    const r = this.radius;
    const squish = 1 + Math.sin(this.t * 5) * 0.08;
    ctx.fillStyle = 'rgba(90,230,120,0.85)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + r * 0.15, r * squish, r / squish, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(200,255,210,0.5)';
    ctx.beginPath(); ctx.ellipse(this.x - r * 0.3, this.y - r * 0.2, r * 0.28, r * 0.2, -0.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1c4';
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(this.x + s * r * 0.3, this.y, r * 0.11, 0, TAU); ctx.fill();
    }
    this._flash(ctx);
  }
}

// ゴブリン: 素早くジグザグに寄ってくる
export class Goblin extends Enemy {
  constructor(x, y, world) { super('goblin', x, y, world); }
  get rgb() { return '150,220,90'; }
  _move(dt, world, t, d) {
    const sp = this.cfg.speed;
    if (d > 1) {
      const zig = Math.sin(this.t * 5) * 0.7;
      const dx = (t.x - this.x) / d, dy = (t.y - this.y) / d;
      this.x += (dx + -dy * zig) * sp * dt;
      this.y += (dy + dx * zig) * sp * dt;
    }
  }
  _drawBody(ctx) {
    const r = this.radius;
    ctx.fillStyle = 'rgba(110,180,70,0.95)';
    ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.85, 0, TAU); ctx.fill();
    // 耳
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(this.x + s * r * 0.5, this.y - r * 0.2);
      ctx.lineTo(this.x + s * r * 1.3, this.y - r * 0.55);
      ctx.lineTo(this.x + s * r * 0.6, this.y + r * 0.15);
      ctx.closePath(); ctx.fill();
    }
    // 目
    ctx.fillStyle = 'rgba(255,230,80,0.95)';
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(this.x + s * r * 0.3, this.y - r * 0.15, r * 0.13, 0, TAU); ctx.fill();
    }
    // 短剣
    ctx.strokeStyle = 'rgba(220,220,230,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.x + r * 0.8, this.y + r * 0.3);
    ctx.lineTo(this.x + r * 1.4, this.y - r * 0.1);
    ctx.stroke();
    this._flash(ctx);
  }
}

// ガーゴイル: 上空に留まり3連射
export class Gargoyle extends Enemy {
  constructor(x, y, world) {
    super('gargoyle', x, y, world);
    this.homeY = range(90, 200);
    this.volleyLeft = 0;
    this.volleyCd = 0;
  }
  get rgb() { return '190,190,220'; }
  _behave(dt, world) {
    const near = this._nearestTarget(world);
    // 上空の定位置へ
    this.y += (this.homeY - this.y) * 0.8 * dt;
    if (near) this.x += clamp(near.t.x - this.x, -1, 1) * this.cfg.speed * dt;
    this.x += Math.sin(this.t * 1.3) * 30 * dt;

    this.fireCd -= dt;
    if (this.volleyLeft > 0) {
      this.volleyCd -= dt;
      if (this.volleyCd <= 0 && near) {
        this.volleyCd = 0.22;
        this.volleyLeft--;
        world.spawnShotAt(this.x, this.y + this.radius, near.t.x, near.t.y,
          this.cfg.shotSpeed, this.cfg.shotDamage, '200,180,255');
        world.audio.bolt();
      }
    } else if (this.fireCd <= 0 && near) {
      this.fireCd = this.cfg.fireEvery;
      this.volleyLeft = this.cfg.volley;
      this.volleyCd = 0;
    }
  }
  _drawBody(ctx) {
    const r = this.radius;
    const flap = Math.sin(this.t * 7) * 0.5;
    // 翼
    ctx.fillStyle = 'rgba(130,130,160,0.9)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(this.x + s * r * 0.4, this.y - r * 0.1);
      ctx.quadraticCurveTo(this.x + s * r * 1.8, this.y - r * (0.9 + flap), this.x + s * r * 1.5, this.y + r * 0.4);
      ctx.closePath(); ctx.fill();
    }
    // 体
    ctx.fillStyle = 'rgba(160,160,190,0.95)';
    ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.7, 0, TAU); ctx.fill();
    // 角と目
    ctx.fillStyle = 'rgba(210,210,235,0.9)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(this.x + s * r * 0.25, this.y - r * 0.5);
      ctx.lineTo(this.x + s * r * 0.45, this.y - r * 0.95);
      ctx.lineTo(this.x + s * r * 0.5, this.y - r * 0.45);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,90,90,0.95)';
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(this.x + s * r * 0.25, this.y - r * 0.15, r * 0.1, 0, TAU); ctx.fill();
    }
    this._flash(ctx);
  }
}

// ミミック: エリート。宝箱に化けた高耐久の追跡者
export class Mimic extends Enemy {
  constructor(x, y, world) { super('mimic', x, y, world); }
  get rgb() { return '255,200,90'; }
  _move(dt, world, t, d) {
    // 開閉しながら突進
    const sp = this.cfg.speed * (0.6 + Math.max(0, Math.sin(this.t * 3)) * 0.9);
    if (d > 1) {
      this.x += ((t.x - this.x) / d) * sp * dt;
      this.y += ((t.y - this.y) / d) * sp * dt;
    }
  }
  _drawBody(ctx) {
    const r = this.radius;
    const open = Math.max(0, Math.sin(this.t * 3)) * r * 0.5;
    // 下箱
    ctx.fillStyle = 'rgba(150,90,40,0.95)';
    ctx.fillRect(this.x - r, this.y - r * 0.2, r * 2, r * 1.0);
    // 蓋
    ctx.fillStyle = 'rgba(170,110,50,0.95)';
    ctx.save();
    ctx.translate(this.x - r, this.y - r * 0.2);
    ctx.rotate(-open / r * 0.8);
    ctx.fillRect(0, -r * 0.7, r * 2, r * 0.7);
    ctx.restore();
    // 金具
    ctx.fillStyle = 'rgba(255,215,120,0.9)';
    ctx.fillRect(this.x - r * 0.12, this.y - r * 0.2, r * 0.24, r * 0.5);
    // 牙と舌
    ctx.fillStyle = '#fff';
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(this.x + i * r * 0.26 - r * 0.08, this.y - r * 0.18);
      ctx.lineTo(this.x + i * r * 0.26, this.y + r * 0.08);
      ctx.lineTo(this.x + i * r * 0.26 + r * 0.08, this.y - r * 0.18);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,90,120,0.9)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + r * 0.35, r * 0.3, r * 0.18, 0, 0, TAU); ctx.fill();
    this._flash(ctx);
  }
}

// 敵弾（手ではたき落とせる）
export class EnemyShot extends Enemy {
  constructor(x, y, vx, vy, damage, rgb) {
    super('shot', x, y, null);
    this.maxHp = 1; this.hp = 1;
    this.vx = vx; this.vy = vy;
    this.atk = 0;
    this.damage = damage;
    this._rgb = rgb || '255,140,90';
    this.telegraph = 0;
    this.life = 7;
  }
  get rgb() { return this._rgb; }
  update(dt, world) {
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0 || this.x < -80 || this.x > world.w + 80 || this.y < -80 || this.y > world.h + 80) {
      this.alive = false;
      return;
    }
    // 結界に当たると消える
    for (const b of world.barriers) {
      if (b.alive && dist(this.x, this.y, b.x, b.y) < b.radius + this.radius) {
        this.alive = false;
        world.particles.spark(this.x, this.y, '140,255,190', {});
        return;
      }
    }
    // ヒーローに命中
    for (const t of world.heroTargets) {
      if (t.downed) continue;
      if (dist(this.x, this.y, t.x, t.y) < t.hurtRadius + this.radius) {
        this.alive = false;
        world.damageHero(t.key, this.damage, { x: this.x, y: this.y, shot: true });
        return;
      }
    }
  }
  takeDamage(amount, world, info = {}) {
    if (!this.alive) return;
    this.alive = false;
    world.onEnemyKilled(this, info);
    world.particles.spark(this.x, this.y, this._rgb, {});
  }
  draw(ctx) {
    const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius * 1.6);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, `rgba(${this._rgb},0.8)`);
    g.addColorStop(1, `rgba(${this._rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * 1.6, 0, TAU); ctx.fill();
  }
}

// -------------------------------------------------------------
//  味方の弾（魔法使いの魔弾 / 陰陽師のお札）
// -------------------------------------------------------------
export class FriendlyBolt {
  constructor(x, y, tx, ty, damage, rgb, heroKey, kind = 'bolt') {
    const sp = CONFIG.combat.boltSpeed;
    const d = Math.max(1, dist(x, y, tx, ty));
    this.x = x; this.y = y;
    this.vx = ((tx - x) / d) * sp;
    this.vy = ((ty - y) / d) * sp;
    this.damage = damage;
    this.rgb = rgb;
    this.heroKey = heroKey;
    this.kind = kind; // 'bolt' | 'fuda'
    this.alive = true;
    this.life = 2.2;
    this.t = 0;
  }
  update(dt, world) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    // 軽いホーミング
    let best = null, bd = 340;
    for (const e of world.enemies) {
      if (!e.alive || e.telegraph > 0 || e.type === 'shot') continue;
      const d = dist(this.x, this.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    const boss = world.boss;
    if (!best && boss && boss.alive && !boss.entering) best = boss;
    if (best) {
      const d = Math.max(1, dist(this.x, this.y, best.x, best.y));
      const sp = CONFIG.combat.boltSpeed;
      this.vx += (((best.x - this.x) / d) * sp - this.vx) * 3.2 * dt;
      this.vy += (((best.y - this.y) / d) * sp - this.vy) * 3.2 * dt;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // 命中判定
    const r = CONFIG.combat.boltRadius;
    for (const e of world.enemies) {
      if (!e.alive || e.telegraph > 0) continue;
      if (dist(this.x, this.y, e.x, e.y) < e.radius + r) {
        e.takeDamage(this.damage, world, { x: this.x, y: this.y, rgb: this.rgb, heroKey: this.heroKey });
        this.alive = false;
        return;
      }
    }
    if (boss && boss.alive && !boss.entering &&
        dist(this.x, this.y, boss.x, boss.y) < boss.radius + r) {
      boss.takeDamage(this.damage, world, { x: this.x, y: this.y, rgb: this.rgb, heroKey: this.heroKey });
      this.alive = false;
    }
  }
  draw(ctx) {
    ctx.save();
    if (this.kind === 'fuda') {
      // お札: 回転する白い短冊
      ctx.translate(this.x, this.y);
      ctx.rotate(Math.atan2(this.vy, this.vx) + Math.PI / 2);
      ctx.fillStyle = 'rgba(250,250,240,0.95)';
      ctx.fillRect(-7, -14, 14, 28);
      ctx.fillStyle = `rgba(${this.rgb},0.9)`;
      ctx.fillRect(-4, -10, 8, 3);
      ctx.fillRect(-4, -4, 8, 2);
      ctx.fillRect(-4, 1, 8, 2);
    } else {
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, 18);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.4, `rgba(${this.rgb},0.85)`);
      g.addColorStop(1, `rgba(${this.rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.x, this.y, 18, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

// -------------------------------------------------------------
//  衝撃波（拍手 / 合体技 / 震脚）
// -------------------------------------------------------------
export class Shockwave {
  constructor(x, y, maxR, damage, rgb, heroKey) {
    this.x = x; this.y = y;
    this.r = 20; this.maxR = maxR;
    this.damage = damage;
    this.rgb = rgb;
    this.heroKey = heroKey;
    this.alive = true;
    this.hit = new Set();
  }
  update(dt, world) {
    this.r += (this.maxR * 3.2) * dt;
    if (this.r >= this.maxR) { this.alive = false; }
    const band = 60;
    for (const e of world.enemies) {
      if (!e.alive || e.telegraph > 0 || this.hit.has(e.id)) continue;
      const d = dist(this.x, this.y, e.x, e.y);
      if (Math.abs(d - this.r) < band + e.radius) {
        this.hit.add(e.id);
        e.takeDamage(this.damage, world, { x: e.x, y: e.y, rgb: this.rgb, heroKey: this.heroKey });
        if (e.alive) {
          const k = CONFIG.combat.clapKnockback;
          const dd = Math.max(1, d);
          e.kbx += ((e.x - this.x) / dd) * k;
          e.kby += ((e.y - this.y) / dd) * k;
        }
      }
    }
    const boss = world.boss;
    if (boss && boss.alive && !boss.entering && !this.hit.has('boss')) {
      const d = dist(this.x, this.y, boss.x, boss.y);
      if (Math.abs(d - this.r) < band + boss.radius) {
        this.hit.add('boss');
        boss.takeDamage(this.damage * 0.8, world, { x: boss.x, y: boss.y, rgb: this.rgb, heroKey: this.heroKey });
      }
    }
  }
  draw(ctx) {
    const a = clamp(1 - this.r / this.maxR, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(${this.rgb},${a * 0.8})`;
    ctx.lineWidth = 14 * a + 3;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

// -------------------------------------------------------------
//  結界（陰陽師）— 弾を防ぎ、中の敵にスリップダメージ
// -------------------------------------------------------------
export class Barrier {
  constructor(x, y, radius, duration, dps, rgb, heroKey) {
    this.x = x; this.y = y;
    this.radius = radius;
    this.life = duration;
    this.maxLife = duration;
    this.dps = dps;
    this.rgb = rgb;
    this.heroKey = heroKey;
    this.alive = true;
    this.t = 0;
  }
  update(dt, world) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    for (const e of world.enemies) {
      if (!e.alive || e.telegraph > 0 || e.type === 'shot') continue;
      if (dist(this.x, this.y, e.x, e.y) < this.radius + e.radius) {
        e.takeDamage(this.dps * dt, world, { silent: true, heroKey: this.heroKey });
      }
    }
  }
  draw(ctx) {
    const a = clamp(this.life / this.maxLife, 0, 1) * 0.9 + 0.1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 光の柱
    const g = ctx.createLinearGradient(this.x, this.y - 400, this.x, this.y);
    g.addColorStop(0, `rgba(${this.rgb},0)`);
    g.addColorStop(1, `rgba(${this.rgb},${0.18 * a})`);
    ctx.fillStyle = g;
    ctx.fillRect(this.x - this.radius * 0.8, this.y - 400, this.radius * 1.6, 400);
    // 六角形の結界円
    ctx.strokeStyle = `rgba(${this.rgb},${0.7 * a})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const ang = (i / 6) * TAU + this.t * 0.7;
      const px = this.x + Math.cos(ang) * this.radius;
      const py = this.y + Math.sin(ang) * this.radius;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.strokeStyle = `rgba(${this.rgb},${0.35 * a})`;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

// -------------------------------------------------------------
//  魂 / 回復玉（手で触れて回収）
// -------------------------------------------------------------
export class Pickup {
  constructor(kind, x, y, value) {
    this.kind = kind; // 'soul' | 'heal'
    this.x = x; this.y = y;
    this.vx = range(-40, 40);
    this.vy = range(-90, -30);
    this.value = value;
    this.life = CONFIG.pickup.life;
    this.alive = true;
    this.t = range(0, 5);
  }
  update(dt, world) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    this.vy += 60 * dt;
    this.vy = Math.min(this.vy, 40);
    this.vx *= Math.max(0, 1 - 1.5 * dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y > world.h - 30) { this.y = world.h - 30; this.vy = 0; }
  }
  draw(ctx) {
    const blink = this.life < 2 ? (Math.sin(this.t * 12) > 0 ? 1 : 0.25) : 1;
    const r = CONFIG.pickup.radius;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = blink;
    if (this.kind === 'soul') {
      // 青白い人魂
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 1.5);
      g.addColorStop(0, 'rgba(220,255,255,0.95)');
      g.addColorStop(0.5, 'rgba(120,220,255,0.6)');
      g.addColorStop(1, 'rgba(80,160,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.x, this.y, r * 1.5, 0, TAU); ctx.fill();
      // 尾
      ctx.fillStyle = 'rgba(150,230,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(this.x - r * 0.4, this.y + r * 0.2);
      ctx.quadraticCurveTo(this.x - r * (1.2 + Math.sin(this.t * 7) * 0.3), this.y + r * 0.9, this.x - r * 0.2, this.y + r * 0.6);
      ctx.closePath(); ctx.fill();
    } else {
      // 緑のハート型の光
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 1.4);
      g.addColorStop(0, 'rgba(220,255,230,0.95)');
      g.addColorStop(0.5, 'rgba(120,255,160,0.6)');
      g.addColorStop(1, 'rgba(60,220,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.x, this.y, r * 1.4, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(120,255,160,0.9)';
      const s = r * 0.5;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y + s * 0.9);
      ctx.bezierCurveTo(this.x - s * 1.4, this.y - s * 0.4, this.x - s * 0.5, this.y - s * 1.1, this.x, this.y - s * 0.3);
      ctx.bezierCurveTo(this.x + s * 0.5, this.y - s * 1.1, this.x + s * 1.4, this.y - s * 0.4, this.x, this.y + s * 0.9);
      ctx.fill();
    }
    ctx.restore();
  }
}

// -------------------------------------------------------------
//  ボス — 大天狗 / リッチ王 / 妖竜
//  攻撃パターンは kind と CONFIG.boss[kind] で決まる。
// -------------------------------------------------------------
export class Boss {
  constructor(kind, world) {
    const c = CONFIG.boss[kind];
    this.kind = kind;
    this.cfg = c;
    this.x = world.w / 2;
    this.y = -180;
    this.homeY = Math.min(world.h * 0.28, 240);
    this.radius = c.radius;
    this.maxHp = c.hp * world.enemyScale;
    this.hp = this.maxHp;
    this.phases = c.phases;
    this.phase = 1;
    this.alive = true;
    this.entering = true;
    this.enterT = CONFIG.boss.enterTime;
    this.t = 0;
    this.attackT = 2.0;
    this.specialT = 5.0;   // gust / ring / sweep
    this.summonT = 4.0;
    this.hitFlash = 0;
    this.sweepDir = 1;
  }

  get rgb() {
    return this.kind === 'tengu' ? '255,120,80'
      : this.kind === 'lich' ? '170,120,255'
      : '255,90,140';
  }

  _phaseIdx() { return Math.min(this.phase - 1, this.phases - 1); }

  update(dt, world) {
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    if (this.entering) {
      this.enterT -= dt;
      this.y += (this.homeY - this.y) * 1.6 * dt;
      if (this.enterT <= 0) { this.entering = false; this.y = this.homeY; }
      return;
    }

    // 漂う
    this.x = world.w / 2 + Math.sin(this.t * 0.5) * world.w * 0.26;
    this.y = this.homeY + Math.sin(this.t * 0.8) * 26;

    const pi = this._phaseIdx();
    const c = this.cfg;

    // 通常弾幕（狙い撃ち扇状）
    this.attackT -= dt;
    if (this.attackT <= 0) {
      const every = (c.featherEvery || c.orbEvery || c.breathEvery)[pi];
      const count = (c.featherCount || c.orbCount || c.breathCount)[pi];
      this.attackT = every;
      const target = world.randomHeroTarget();
      if (target) {
        const base = Math.atan2(target.y - this.y, target.x - this.x);
        const spread = 0.7;
        for (let i = 0; i < count; i++) {
          const a = base + (i / Math.max(1, count - 1) - 0.5) * spread;
          const sp = 230 + world.areaIndex * 30;
          world.spawnShot(this.x, this.y + this.radius * 0.4,
            Math.cos(a) * sp, Math.sin(a) * sp, 10 + world.areaIndex * 2, this.rgb);
        }
        world.audio.bolt();
      }
    }

    // 特殊攻撃
    this.specialT -= dt;
    if (this.specialT <= 0) {
      if (this.kind === 'tengu') {
        this.specialT = c.gustEvery[pi];
        this._gust(world);
      } else if (this.kind === 'lich') {
        this.specialT = c.ringEvery[pi];
        this._ring(world, c.ringCount);
      } else {
        // 妖竜: 薙ぎ払いとリングを交互に
        if (this._lastSweep) {
          this.specialT = c.ringEvery[pi];
          this._ring(world, c.ringCount);
        } else {
          this.specialT = c.sweepEvery[pi];
          this._sweep(world);
        }
        this._lastSweep = !this._lastSweep;
      }
    }

    // 召喚
    this.summonT -= dt;
    if (this.summonT <= 0) {
      this.summonT = c.summonEvery[pi];
      world.bossSummon(this.kind);
    }
  }

  _gust(world) {
    // 大天狗: 横一列の風の刃が吹き抜ける
    const y0 = range(world.h * 0.35, world.h * 0.8);
    const dir = chance(0.5) ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      const x = dir > 0 ? -40 - i * 70 : world.w + 40 + i * 70;
      world.spawnShot(x, y0 + range(-70, 70), dir * 330, 0, 12, '160,255,190');
    }
    world.audio.bossRoar();
    world.addShake(8);
  }

  _ring(world, count) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + this.t;
      world.spawnShot(this.x, this.y, Math.cos(a) * 220, Math.sin(a) * 220, 11, this.rgb);
    }
    world.audio.bolt();
  }

  _sweep(world) {
    // 妖竜: 画面を横切る炎のブレス列
    const dir = this.sweepDir;
    this.sweepDir *= -1;
    for (let i = 0; i < 9; i++) {
      const x = dir > 0 ? -50 - i * 90 : world.w + 50 + i * 90;
      const y = world.h * 0.3 + i * (world.h * 0.06);
      world.spawnShot(x, y, dir * 380, 20, 14, '255,150,60');
    }
    world.audio.bossRoar();
    world.addShake(12);
  }

  takeDamage(amount, world, info = {}) {
    if (!this.alive || this.entering) return;
    this.hp -= amount;
    this.hitFlash = 1;
    world.onEnemyDamaged(this, amount, info);
    const phaseHp = this.maxHp * (1 - this.phase / this.phases);
    if (this.hp <= phaseHp && this.phase < this.phases) {
      this.phase++;
      world.onBossPhase(this);
    }
    if (this.hp <= 0) {
      this.alive = false;
      world.onBossKilled(this, info);
    }
  }

  coreY() { return this.y; }

  draw(ctx, world) {
    const r = this.radius;
    ctx.save();
    if (this.entering) ctx.globalAlpha = clamp(1 - this.enterT / CONFIG.boss.enterTime + 0.3, 0, 1);

    if (this.kind === 'tengu') this._drawTengu(ctx, r);
    else if (this.kind === 'lich') this._drawLich(ctx, r);
    else this._drawDragon(ctx, r);

    if (this.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.hitFlash * 0.4})`;
      ctx.beginPath(); ctx.arc(this.x, this.y, r * 1.05, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  _drawTengu(ctx, r) {
    const { x, y } = this;
    // 翼
    const flap = Math.sin(this.t * 3) * 0.3;
    ctx.fillStyle = 'rgba(60,40,40,0.9)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * r * 0.3, y - r * 0.2);
      ctx.quadraticCurveTo(x + s * r * 2.0, y - r * (1.0 + flap), x + s * r * 1.7, y + r * 0.5);
      ctx.quadraticCurveTo(x + s * r * 1.0, y + r * 0.4, x + s * r * 0.3, y + r * 0.3);
      ctx.closePath(); ctx.fill();
    }
    // 顔（赤ら顔）
    ctx.fillStyle = 'rgba(220,80,60,0.95)';
    ctx.beginPath(); ctx.arc(x, y, r * 0.75, 0, TAU); ctx.fill();
    // 長い鼻
    ctx.fillStyle = 'rgba(240,110,80,0.95)';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.12, y - r * 0.05);
    ctx.lineTo(x, y + r * 0.75);
    ctx.lineTo(x + r * 0.12, y - r * 0.05);
    ctx.closePath(); ctx.fill();
    // 目と眉
    ctx.fillStyle = 'rgba(255,230,120,0.95)';
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(x + s * r * 0.32, y - r * 0.22, r * 0.1, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(40,20,20,0.9)';
    ctx.lineWidth = 5;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * r * 0.15, y - r * 0.42);
      ctx.lineTo(x + s * r * 0.5, y - r * 0.32);
      ctx.stroke();
    }
    // 山伏の頭巾
    ctx.fillStyle = 'rgba(30,30,50,0.9)';
    ctx.beginPath(); ctx.arc(x, y - r * 0.55, r * 0.34, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,215,120,0.9)';
    ctx.beginPath(); ctx.arc(x, y - r * 0.68, r * 0.1, 0, TAU); ctx.fill();
    // 羽団扇
    ctx.fillStyle = 'rgba(120,200,140,0.85)';
    const fx = x + r * 1.15, fy = y + r * 0.15 + Math.sin(this.t * 3) * 8;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(fx + i * 6, fy - Math.abs(i) * 4, 9, 30, i * 0.25, 0, TAU);
      ctx.fill();
    }
  }

  _drawLich(ctx, r) {
    const { x, y } = this;
    // ローブ
    ctx.fillStyle = 'rgba(60,40,110,0.95)';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.9, y + r * 0.9);
    ctx.quadraticCurveTo(x, y - r * 1.1, x + r * 0.9, y + r * 0.9);
    ctx.quadraticCurveTo(x, y + r * 0.6, x - r * 0.9, y + r * 0.9);
    ctx.fill();
    // 骸骨の頭
    ctx.fillStyle = 'rgba(230,225,210,0.95)';
    ctx.beginPath(); ctx.arc(x, y - r * 0.35, r * 0.42, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(230,225,210,0.95)';
    ctx.fillRect(x - r * 0.22, y - r * 0.1, r * 0.44, r * 0.22);
    // 眼窩（光る）
    for (const s of [-1, 1]) {
      const g = ctx.createRadialGradient(x + s * r * 0.16, y - r * 0.4, 0, x + s * r * 0.16, y - r * 0.4, r * 0.14);
      g.addColorStop(0, 'rgba(170,120,255,1)');
      g.addColorStop(1, 'rgba(170,120,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x + s * r * 0.16, y - r * 0.4, r * 0.14, 0, TAU); ctx.fill();
      ctx.fillStyle = '#201040';
      ctx.beginPath(); ctx.arc(x + s * r * 0.16, y - r * 0.4, r * 0.08, 0, TAU); ctx.fill();
    }
    // 王冠
    ctx.fillStyle = 'rgba(255,215,120,0.95)';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.34, y - r * 0.66);
    for (let i = 0; i < 4; i++) {
      const px = x - r * 0.34 + (i + 0.5) * r * 0.17;
      ctx.lineTo(px, y - r * (0.9 + (i % 2) * 0.06));
      ctx.lineTo(x - r * 0.34 + (i + 1) * r * 0.17, y - r * 0.66);
    }
    ctx.closePath(); ctx.fill();
    // 杖と魔法陣
    ctx.strokeStyle = 'rgba(200,180,255,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x + r * 0.75, y + r * 0.8); ctx.lineTo(x + r * 0.75, y - r * 0.5); ctx.stroke();
    const og = ctx.createRadialGradient(x + r * 0.75, y - r * 0.6, 0, x + r * 0.75, y - r * 0.6, r * 0.22);
    og.addColorStop(0, 'rgba(220,180,255,1)');
    og.addColorStop(1, 'rgba(170,120,255,0)');
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(x + r * 0.75, y - r * 0.6, r * 0.22, 0, TAU); ctx.fill();
    // 周回する魔法の環
    ctx.strokeStyle = 'rgba(170,120,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.15, r * 0.4, this.t * 0.5, 0, TAU); ctx.stroke();
  }

  _drawDragon(ctx, r) {
    const { x, y } = this;
    // 翼（和洋折衷: 雲のような和柄入り）
    const flap = Math.sin(this.t * 2.4) * 0.35;
    for (const s of [-1, 1]) {
      ctx.fillStyle = 'rgba(120,30,70,0.9)';
      ctx.beginPath();
      ctx.moveTo(x + s * r * 0.35, y - r * 0.1);
      ctx.quadraticCurveTo(x + s * r * 2.3, y - r * (1.3 + flap), x + s * r * 2.0, y + r * 0.4);
      ctx.quadraticCurveTo(x + s * r * 1.2, y + r * 0.65, x + s * r * 0.35, y + r * 0.35);
      ctx.closePath(); ctx.fill();
      // 翼膜の骨
      ctx.strokeStyle = 'rgba(255,120,160,0.5)';
      ctx.lineWidth = 3;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x + s * r * 0.4, y);
        ctx.quadraticCurveTo(x + s * r * (0.8 + i * 0.4), y - r * (0.5 + flap) * (i / 3), x + s * r * (1.0 + i * 0.35), y + r * 0.35);
        ctx.stroke();
      }
    }
    // 蛇状の胴（和竜の意匠）
    ctx.strokeStyle = 'rgba(180,50,100,0.9)';
    ctx.lineWidth = r * 0.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const px = x + Math.sin(this.t * 1.2 + i * 0.8) * r * 0.5;
      const py = y + r * 0.3 + i * r * 0.16;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // 頭
    ctx.fillStyle = 'rgba(200,60,110,0.95)';
    ctx.beginPath(); ctx.arc(x, y - r * 0.15, r * 0.6, 0, TAU); ctx.fill();
    // 口先
    ctx.fillStyle = 'rgba(220,80,120,0.95)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.15, r * 0.42, r * 0.28, 0, 0, TAU); ctx.fill();
    // 角（鹿角風）
    ctx.strokeStyle = 'rgba(255,230,190,0.95)';
    ctx.lineWidth = 6;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * r * 0.3, y - r * 0.6);
      ctx.lineTo(x + s * r * 0.55, y - r * 1.05);
      ctx.moveTo(x + s * r * 0.44, y - r * 0.85);
      ctx.lineTo(x + s * r * 0.7, y - r * 0.95);
      ctx.stroke();
    }
    // 目（フェーズで光が強まる）
    const glow = 0.5 + this.phase * 0.15;
    for (const s of [-1, 1]) {
      const g = ctx.createRadialGradient(x + s * r * 0.25, y - r * 0.25, 0, x + s * r * 0.25, y - r * 0.25, r * 0.16);
      g.addColorStop(0, `rgba(255,240,120,${glow})`);
      g.addColorStop(1, 'rgba(255,240,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x + s * r * 0.25, y - r * 0.25, r * 0.16, 0, TAU); ctx.fill();
      ctx.fillStyle = '#401020';
      ctx.beginPath(); ctx.arc(x + s * r * 0.25, y - r * 0.25, r * 0.07, 0, TAU); ctx.fill();
    }
    // ひげ
    ctx.strokeStyle = 'rgba(255,220,180,0.8)';
    ctx.lineWidth = 3;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * r * 0.35, y + r * 0.1);
      ctx.quadraticCurveTo(x + s * r * 0.9, y + r * (0.2 + Math.sin(this.t * 2 + s) * 0.1), x + s * r * 1.1, y - r * 0.1);
      ctx.stroke();
    }
  }
}

// 通常敵のファクトリ
export function spawnEnemyByType(type, x, y, world) {
  switch (type) {
    case 'chochin': return new Chochin(x, y, world);
    case 'kasa': return new Kasa(x, y, world);
    case 'oni': return new Oni(x, y, world);
    case 'onibi': return new Onibi(x, y, world);
    case 'slime': return new Slime(x, y, world);
    case 'goblin': return new Goblin(x, y, world);
    case 'gargoyle': return new Gargoyle(x, y, world);
    case 'mimic': return new Mimic(x, y, world);
    default: return new Chochin(x, y, world);
  }
}
