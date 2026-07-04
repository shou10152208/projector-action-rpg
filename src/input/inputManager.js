// =============================================================
//  InputManager — Vision と フォールバックを統合し
//  毎フレーム「守護者(players)」配列を生成する
// =============================================================

import { CONFIG } from '../config.js';
import { VisionInput } from './vision.js';
import { FallbackInput } from './fallback.js';
import { PlayerTracker } from './gestures.js';

export class InputManager {
  constructor(videoEl) {
    this.vision = new VisionInput(videoEl);
    this.fallback = new FallbackInput();
    this.mode = 'fallback';       // 'camera' | 'fallback'
    this.visionError = null;
    this.trackers = new Map();    // id -> PlayerTracker
    this.players = [];
  }

  attachFallback(canvas) { this.fallback.attach(canvas); }

  async tryVision() {
    try {
      await this.vision.init();
      this.mode = 'camera';
      this.visionError = null;
      return true;
    } catch (e) {
      console.warn('[input] vision unavailable -> fallback', e);
      this.visionError = e;
      this.vision.stop();
      this.mode = 'fallback';
      return false;
    }
  }

  forceFallback() {
    if (this.mode === 'fallback') return;
    this.vision.stop();
    this.mode = 'fallback';
    this.trackers.clear();
  }

  _tracker(id) {
    let t = this.trackers.get(id);
    if (!t) {
      const colors = CONFIG.hero.colors;
      const idx = typeof id === 'number' ? id : 0; // 'solo' などの文字列IDは0番色
      const color = colors[idx % colors.length];
      t = new PlayerTracker(id, color);
      this.trackers.set(id, t);
    }
    return t;
  }

  update(dt, w, h, nowMs) {
    if (this.mode === 'camera') return this._updateCamera(dt, w, h, nowMs);
    return this._updateFallback(dt, w, h);
  }

  _updateCamera(dt, w, h, nowMs) {
    const poses = this.vision.detect(nowMs); // 配列 or null
    const out = [];
    if (poses && poses.length) {
      const n = Math.min(poses.length, CONFIG.input.maxPlayers);
      for (let i = 0; i < n; i++) {
        const lm = poses[i];
        if (!lm || lm.length < 25) continue;
        const t = this._tracker(i);
        out.push(t.updateFromLandmarks(lm, w, h, dt));
      }
    }
    // 認識されなかったトラッカーは非アクティブ化
    for (const [id, t] of this.trackers) {
      if (!out.includes(t.player)) t.player.active = false;
    }
    this.players = out;
    return out;
  }

  _updateFallback(dt, w, h) {
    this.fallback.update(dt);
    const t = this._tracker('solo');
    const p = t.updateFromFallback(this.fallback.getHand(), dt, w, h);
    this.players = [p];
    return this.players;
  }

  getVideo() {
    return this.mode === 'camera' ? this.vision.video : null;
  }
}
