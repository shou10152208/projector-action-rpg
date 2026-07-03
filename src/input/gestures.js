// =============================================================
//  PlayerTracker — 生の姿勢/カーソルを「勇者」状態へ変換
//  位置の平滑化・速度算出・ジェスチャー検出を担当
//  （両手上げ / 拍手 / ガード / 体中心の速度=ジャスト回避 / 足=蹴り /
//    手の軌跡バッファ=図形詠唱）
// =============================================================

import { CONFIG } from '../config.js';
import { clamp, dist, ema, hexToRgb } from '../util.js';

// BlazePose ランドマーク番号
const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_ANKLE: 27, R_ANKLE: 28,
};

function makeHand() {
  return { x: 0, y: 0, vx: 0, vy: 0, speed: 0, present: false, radius: 46, hitCd: 0, init: false };
}

export class PlayerTracker {
  constructor(id, color) {
    this.id = id;
    this.color = color;
    this.scale = 220;
    this.player = {
      id, color, colorRgb: hexToRgb(color), active: false,
      hands: { left: makeHand(), right: makeHand() },
      feet: { left: makeHand(), right: makeHand() },
      head: { x: 0, y: 0, present: false },
      center: { x: 0, y: 0, vx: 0, vy: 0, speed: 0 },
      scale: 220,
      gestures: { armsRaised: false, armsRaisedEdge: false, clapEdge: false, guard: false },
      // 図形詠唱用の手の軌跡（各点 {x,y,t}）。ロール側が読み取り・クリアする。
      paths: { left: [], right: [] },
    };
    this._prevArmsRaised = false;
    this._clapCd = 0;
    this._prevHandDist = 9999;
    this._centerInit = false;
    this._now = 0;
  }

  _updateHand(hand, sx, sy, present, dt, smooth) {
    hand.hitCd = Math.max(0, hand.hitCd - dt);
    hand.present = present;
    if (!present) { hand.speed = 0; hand.vx = 0; hand.vy = 0; hand.init = false; return; }

    if (!hand.init) {
      hand.x = sx; hand.y = sy; hand.init = true;
      hand.vx = 0; hand.vy = 0; hand.speed = 0;
      return;
    }
    const px = hand.x, py = hand.y;
    hand.x = ema(hand.x, sx, smooth);
    hand.y = ema(hand.y, sy, smooth);
    if (dt > 0) {
      const nvx = (hand.x - px) / dt;
      const nvy = (hand.y - py) / dt;
      const vs = CONFIG.input.velSmoothing;
      hand.vx = ema(hand.vx, nvx, vs);
      hand.vy = ema(hand.vy, nvy, vs);
      hand.speed = Math.hypot(hand.vx, hand.vy);
    }
  }

  _updateCenter(cx, cy, dt) {
    const c = this.player.center;
    if (!this._centerInit) { c.x = cx; c.y = cy; this._centerInit = true; return; }
    const px = c.x, py = c.y;
    c.x = ema(c.x, cx, 0.5);
    c.y = ema(c.y, cy, 0.5);
    if (dt > 0) {
      c.vx = ema(c.vx, (c.x - px) / dt, 0.5);
      c.vy = ema(c.vy, (c.y - py) / dt, 0.5);
      c.speed = Math.hypot(c.vx, c.vy);
    }
  }

  _pushPath(key, hand, dt) {
    const cfg = CONFIG.input;
    const path = this.player.paths[key];
    this._now += 0; // _now は updateFrom* で加算済み
    if (hand.present) {
      path.push({ x: hand.x, y: hand.y, t: this._now });
      if (path.length > cfg.pathMax) path.shift();
    }
    // 古い点を破棄
    while (path.length && this._now - path[0].t > cfg.pathLife) path.shift();
  }

  // --- カメラ（MediaPipeランドマーク）から更新 ---
  updateFromLandmarks(lm, w, h, dt) {
    const cfg = CONFIG.input;
    const p = this.player;
    this._now += dt;
    const sx = (i) => (1 - lm[i].x) * w; // 鏡映（自分が見たまま動く）
    const sy = (i) => lm[i].y * h;
    const vis = (i) => (lm[i].visibility ?? 1);

    // 体の大きさ（肩幅）→ 手のオーラ半径
    const shouldersVisible = vis(LM.L_SHOULDER) > 0.3 && vis(LM.R_SHOULDER) > 0.3;
    if (shouldersVisible) {
      const sw = dist(sx(LM.L_SHOULDER), sy(LM.L_SHOULDER), sx(LM.R_SHOULDER), sy(LM.R_SHOULDER));
      this.scale = ema(this.scale, clamp(sw, 80, 600), 0.2);
    }
    p.scale = this.scale;
    const radius = clamp(this.scale * CONFIG.hero.handScale,
      CONFIG.hero.handRadiusMin, CONFIG.hero.handRadiusMax);
    p.hands.left.radius = radius;
    p.hands.right.radius = radius;
    p.feet.left.radius = radius * 1.1;
    p.feet.right.radius = radius * 1.1;

    // 手
    const lPresent = vis(LM.L_WRIST) > cfg.handVisibility;
    const rPresent = vis(LM.R_WRIST) > cfg.handVisibility;
    this._updateHand(p.hands.left, sx(LM.L_WRIST), sy(LM.L_WRIST), lPresent, dt, cfg.posSmoothing);
    this._updateHand(p.hands.right, sx(LM.R_WRIST), sy(LM.R_WRIST), rPresent, dt, cfg.posSmoothing);
    this._pushPath('left', p.hands.left, dt);
    this._pushPath('right', p.hands.right, dt);

    // 足（蹴り判定用。拳闘士だけが攻撃に使う）
    this._updateHand(p.feet.left, sx(LM.L_ANKLE), sy(LM.L_ANKLE), vis(LM.L_ANKLE) > cfg.footVisibility, dt, cfg.posSmoothing);
    this._updateHand(p.feet.right, sx(LM.R_ANKLE), sy(LM.R_ANKLE), vis(LM.R_ANKLE) > cfg.footVisibility, dt, cfg.posSmoothing);

    // 頭
    const headPresent = vis(LM.NOSE) > 0.3;
    p.head.present = headPresent;
    if (headPresent) { p.head.x = ema(p.head.x || sx(LM.NOSE), sx(LM.NOSE), 0.4); p.head.y = ema(p.head.y || sy(LM.NOSE), sy(LM.NOSE), 0.4); }

    // 体の中心（肩と腰の中点）
    let cx = 0, cy = 0, cn = 0;
    for (const i of [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP]) {
      if (vis(i) > 0.3) { cx += sx(i); cy += sy(i); cn++; }
    }
    if (cn > 0) this._updateCenter(cx / cn, cy / cn, dt);
    else if (headPresent) this._updateCenter(p.head.x, p.head.y + this.scale * 0.5, dt);

    this._detectGestures(p, dt, headPresent);
    p.active = true;
    return p;
  }

  // --- フォールバック（マウス/キー）から更新 ---
  updateFromFallback(hand, dt, w, h) {
    const p = this.player;
    this._now += dt;
    const sx = hand.nx * w;
    const sy = hand.ny * h;
    p.scale = 240;
    const r = CONFIG.hero.fallbackHandRadius;
    p.hands.right.radius = r;
    p.hands.left.radius = r;
    this._updateHand(p.hands.right, sx, sy, true, dt, 0.7);
    p.hands.left.present = false;
    p.feet.left.present = false;
    p.feet.right.present = false;
    this._pushPath('right', p.hands.right, dt);

    // ボタン長押し/キー移動中は最低速度を底上げ（必ず斬撃になる）
    if (hand.power) {
      p.hands.right.speed = Math.max(p.hands.right.speed, CONFIG.combat.slashSpeed * 1.25);
    }

    p.head.present = false;
    this._updateCenter(sx, sy, dt);
    p.gestures.armsRaised = false;
    p.gestures.armsRaisedEdge = false;
    p.gestures.clapEdge = false;   // 拍手/必殺は main がキー入力から直接発火
    p.gestures.guard = !!hand.guard;
    p.active = true;
    return p;
  }

  _detectGestures(p, dt, headPresent) {
    const g = p.gestures;
    this._clapCd = Math.max(0, this._clapCd - dt);
    const L = p.hands.left, R = p.hands.right;

    // 両手上げ（頭より上に両手）
    let armsRaised = false;
    if (headPresent && L.present && R.present) {
      const margin = this.scale * 0.12;
      armsRaised = (L.y < p.head.y - margin) && (R.y < p.head.y - margin);
    }
    g.armsRaised = armsRaised;
    g.armsRaisedEdge = armsRaised && !this._prevArmsRaised;
    this._prevArmsRaised = armsRaised;

    // 拍手（両手が素早く近づいて閉じた瞬間）
    let clapEdge = false;
    let handDist = 9999;
    if (L.present && R.present) {
      handDist = dist(L.x, L.y, R.x, R.y);
      const closeThresh = Math.max(this.scale * 0.5, 70);
      if (this._clapCd <= 0 && handDist < closeThresh && this._prevHandDist >= closeThresh) {
        clapEdge = true;
        this._clapCd = 0.6;
      }
      this._prevHandDist = handDist;
    } else {
      this._prevHandDist = 9999;
    }
    g.clapEdge = clapEdge;

    // ガード（両手を胸の前で合わせて静止 = 拍手後もそのまま構えると成立）
    let guard = false;
    if (L.present && R.present && headPresent) {
      const c = p.center;
      const maxV = CONFIG.hero.guardMaxSpeed;
      const near = handDist < this.scale * 0.55;
      const inFront =
        Math.abs((L.x + R.x) / 2 - c.x) < this.scale * 0.6 &&
        L.y > p.head.y && R.y > p.head.y &&
        L.y < c.y + this.scale * 0.6 && R.y < c.y + this.scale * 0.6;
      guard = near && inFront && L.speed < maxV && R.speed < maxV;
    }
    g.guard = guard;
  }
}
