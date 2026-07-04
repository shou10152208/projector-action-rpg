// =============================================================
//  HUD / 画面描画 — タイトル / ロール選択 / マップ / 戦闘HUD /
//  レベルアップ / ショップ / 休憩 / 宝箱 / 門 / 結果
//  手かざしUI（ホットスポット）の描画もここで行う。
// =============================================================

import { CONFIG } from '../config.js';
import { T } from '../i18n.js';
import { TAU, clamp } from '../util.js';
import { roleCfg } from '../game/roles.js';

const FONT = '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif';

export class Hud {
  draw(ctx, world, info, dt) {
    const w = world.w, h = world.h;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    switch (world.phase) {
      case 'title': this._title(ctx, world, info); break;
      case 'roleSelect': this._roleSelect(ctx, world); break;
      case 'gateStart': this._gateScreen(ctx, world, T.gateStart); break;
      case 'gate': this._gateScreen(ctx, world, T.gateTitle); break;
      case 'map': this._map(ctx, world); break;
      case 'battle': this._battleHud(ctx, world); break;
      case 'levelup': this._levelup(ctx, world); break;
      case 'shop': this._shop(ctx, world); break;
      case 'rest': this._rest(ctx, world); break;
      case 'treasure': this._treasure(ctx, world); break;
      case 'gameover': this._result(ctx, world, false); break;
      case 'victory': this._result(ctx, world, true); break;
      default: break;
    }

    // ラン共通HUD（マップ系画面でも魂とLvは見せる）
    if (world.run && ['map', 'battle', 'shop', 'rest', 'treasure', 'gate', 'levelup'].includes(world.phase)) {
      this._runHud(ctx, world);
    }

    // ホットスポット（フェーズ画面の上に重ねる）
    for (const hs of world.hotspots) this._hotspot(ctx, hs, world);

    // フロートテキスト
    for (const f of world.floaters) {
      const a = clamp(f.life / f.maxLife, 0, 1);
      ctx.font = `bold ${f.size}px ${FONT}`;
      ctx.fillStyle = this._alpha(f.color, a);
      ctx.strokeStyle = `rgba(0,0,0,${a * 0.7})`;
      ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }

    // バナー
    if (world.banner) this._banner(ctx, world);

    // モード表示・キー操作ヘルプ
    if (info.mode !== 'camera') {
      ctx.font = `12px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(T.keysHelp, w / 2, h - 14);
    }

    // デバッグ
    if (info.debug) {
      ctx.textAlign = 'left';
      ctx.font = `12px monospace`;
      ctx.fillStyle = 'rgba(120,255,160,0.9)';
      ctx.fillText(`fps:${info.fps} mode:${info.mode} phase:${world.phase} enemies:${world.enemies.length} particles:${info.particles}`, 12, h - 30);
    }
    ctx.restore();
  }

  _alpha(color, a) {
    if (color.startsWith('#')) {
      const h = color.slice(1);
      const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    return color;
  }

  // ----- 汎用: ホットスポット描画 -----
  _hotspot(ctx, hs, world) {
    if (!hs.enabled) return;
    const p = clamp(hs.progress, 0, 1);
    const active = p > 0.02;

    if (hs.r != null) {
      // 円形
      const r = hs.r;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = active ? 'rgba(255,230,140,0.95)' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(hs.x, hs.y, r, 0, TAU); ctx.stroke();
      if (p > 0) {
        ctx.strokeStyle = 'rgba(255,220,100,0.95)';
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.arc(hs.x, hs.y, r + 8, -Math.PI / 2, -Math.PI / 2 + p * TAU); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(10,10,26,0.5)';
      ctx.beginPath(); ctx.arc(hs.x, hs.y, r - 2, 0, TAU); ctx.fill();
      // ノードアイコン
      if (hs.kind === 'node') this._nodeIcon(ctx, hs.node.type, hs.x, hs.y - 12, 26);
      if (hs.kind === 'chest') this._chestIcon(ctx, hs.x, hs.y - 8, 40, false);
      ctx.font = `bold ${hs.kind === 'node' ? 20 : 18}px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      const ly = hs.kind === 'node' || hs.kind === 'chest' ? hs.y + (hs.r * 0.45) : hs.y;
      this._wrapText(ctx, hs.label, hs.x, ly, r * 1.8, 22);
      ctx.restore();
    } else {
      // カード型
      const x = hs.x - hs.rw, y = hs.y - hs.rh, ww = hs.rw * 2, hh = hs.rh * 2;
      ctx.save();
      ctx.fillStyle = active ? 'rgba(40,36,80,0.85)' : 'rgba(16,14,40,0.75)';
      this._round(ctx, x, y, ww, hh, 14); ctx.fill();
      ctx.strokeStyle = active ? 'rgba(255,230,140,0.95)' : 'rgba(160,160,220,0.5)';
      ctx.lineWidth = active ? 3 : 2;
      this._round(ctx, x, y, ww, hh, 14); ctx.stroke();
      // 進行バー
      if (p > 0) {
        ctx.fillStyle = 'rgba(255,220,100,0.85)';
        this._round(ctx, x + 6, y + hh - 14, (ww - 12) * p, 8, 4); ctx.fill();
      }
      ctx.restore();
    }
  }

  _round(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _wrapText(ctx, text, x, y, maxW, lineH) {
    const chars = [...String(text)];
    let line = '', ly = y;
    const lines = [];
    for (const ch of chars) {
      if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; }
      else line += ch;
    }
    lines.push(line);
    ly = y - ((lines.length - 1) * lineH) / 2;
    for (const l of lines) { ctx.fillText(l, x, ly); ly += lineH; }
  }

  // ----- タイトル -----
  _title(ctx, world, info) {
    const w = world.w, h = world.h;
    ctx.save();
    // タイトルロゴ
    ctx.font = `bold ${Math.min(w * 0.085, 92)}px ${FONT}`;
    const grad = ctx.createLinearGradient(0, h * 0.24, 0, h * 0.4);
    grad.addColorStop(0, '#ffd9a0');
    grad.addColorStop(0.5, '#ff8bb0');
    grad.addColorStop(1, '#9a7cff');
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(255,140,180,0.6)';
    ctx.shadowBlur = 30;
    ctx.fillText(T.title, w / 2, h * 0.3);
    ctx.shadowBlur = 0;
    ctx.font = `${Math.min(w * 0.022, 24)}px ${FONT}`;
    ctx.fillStyle = 'rgba(220,220,255,0.85)';
    ctx.fillText(T.subtitle, w / 2, h * 0.3 + Math.min(w * 0.06, 64));

    // 状態表示
    ctx.font = `16px ${FONT}`;
    if (info.modelLoading) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(T.loadingModel, w / 2, h * 0.5);
    } else if (info.mode !== 'camera') {
      ctx.fillStyle = 'rgba(255,200,120,0.9)';
      const err = info.visionError;
      const code = err && (err.code || err.name);
      const msg = (code && T.camErr[code]) || (err ? T.camErr.default : '');
      ctx.fillText(`${T.cameraOff}${msg ? ' — ' + msg : ''}`, w / 2, h * 0.5);
    }
    ctx.restore();
  }

  // ----- ロール選択 -----
  _roleSelect(ctx, world) {
    const w = world.w, h = world.h;
    ctx.font = `bold ${Math.min(w * 0.038, 40)}px ${FONT}`;
    ctx.fillStyle = '#ffe9c0';
    ctx.fillText(T.roleSelect, w / 2, h * 0.14);
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(T.roleSelectSub, w / 2, h * 0.14 + 40);

    // 各カードの中身（ロール名・説明・選択者マーク）
    for (const hs of world.hotspots) {
      if (hs.kind !== 'role') continue;
      const rc = roleCfg(hs.roleId);
      ctx.font = `bold 26px ${FONT}`;
      ctx.fillStyle = rc.accent;
      ctx.fillText(T.roles[hs.roleId].name, hs.x, hs.y - hs.rh * 0.55);
      this._roleIcon(ctx, hs.roleId, hs.x, hs.y - hs.rh * 0.05, Math.min(46, hs.rw * 0.42));
      ctx.font = `13px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      this._wrapText(ctx, T.roles[hs.roleId].desc, hs.x, hs.y + hs.rh * 0.5, hs.rw * 1.7, 17);
      // 選択済みプレイヤーの色玉
      let i = 0;
      for (const [key, roleId] of world.roleClaims) {
        if (roleId !== hs.roleId) continue;
        const idx = typeof key === 'number' ? key : 0;
        const color = CONFIG.hero.colors[idx % CONFIG.hero.colors.length];
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(hs.x - hs.rw + 22 + i * 26, hs.y - hs.rh + 20, 9, 0, TAU);
        ctx.fill();
        i++;
      }
    }

    // カウントダウン
    if (world.roleCountdown > 0) {
      ctx.font = `bold 42px ${FONT}`;
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`${T.roleReady} ${Math.ceil(world.roleCountdown)}`, w / 2, h * 0.86);
    }
  }

  _roleIcon(ctx, roleId, x, y, s) {
    const rc = roleCfg(roleId);
    ctx.save();
    ctx.strokeStyle = rc.accent;
    ctx.fillStyle = rc.accent;
    ctx.lineWidth = Math.max(3, s * 0.09);
    ctx.lineCap = 'round';
    if (roleId === 'kenshi') {
      // 刀
      ctx.beginPath();
      ctx.moveTo(x - s * 0.6, y + s * 0.6);
      ctx.quadraticCurveTo(x, y - s * 0.1, x + s * 0.55, y - s * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.5, y + s * 0.35); ctx.lineTo(x - s * 0.28, y + s * 0.62);
      ctx.stroke();
    } else if (roleId === 'monk') {
      // 拳
      ctx.beginPath(); ctx.arc(x, y, s * 0.42, 0, TAU); ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(x - s * 0.3 + i * s * 0.2, y - s * 0.38, s * 0.11, 0, TAU);
        ctx.fill();
      }
    } else if (roleId === 'mage') {
      // 魔法の円と星
      ctx.beginPath(); ctx.arc(x, y, s * 0.5, 0, TAU); ctx.stroke();
      this._star(ctx, x, y, s * 0.26, 5);
      ctx.fill();
    } else {
      // お札
      ctx.fillRect(x - s * 0.25, y - s * 0.55, s * 0.5, s * 1.1);
      ctx.fillStyle = 'rgba(20,20,40,0.9)';
      ctx.fillRect(x - s * 0.14, y - s * 0.36, s * 0.28, s * 0.1);
      ctx.fillRect(x - s * 0.14, y - s * 0.1, s * 0.28, s * 0.08);
      ctx.fillRect(x - s * 0.14, y + s * 0.14, s * 0.28, s * 0.08);
    }
    ctx.restore();
  }

  _star(ctx, x, y, r, n) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const rr = i % 2 === 0 ? r : r * 0.45;
      const a = (i / (n * 2)) * TAU - Math.PI / 2;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // ----- 門（エリア/ルート選択） -----
  _gateScreen(ctx, world, title) {
    const w = world.w, h = world.h;
    ctx.font = `bold ${Math.min(w * 0.036, 38)}px ${FONT}`;
    ctx.fillStyle = '#ffe9c0';
    ctx.fillText(title, w / 2, h * 0.15);
    for (const hs of world.hotspots) {
      if (hs.kind !== 'gate') continue;
      // 鳥居 or アーチの門
      ctx.save();
      const gx = hs.x, gy = hs.y - hs.rh * 0.15, gs = Math.min(hs.rw, hs.rh) * 0.8;
      ctx.strokeStyle = hs.theme === 'wa' ? 'rgba(230,90,90,0.9)'
        : hs.theme === 'west' ? 'rgba(150,160,220,0.9)' : 'rgba(255,200,120,0.9)';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      if (hs.theme === 'wa') {
        ctx.beginPath();
        ctx.moveTo(gx - gs * 0.6, gy + gs * 0.8); ctx.lineTo(gx - gs * 0.5, gy - gs * 0.55);
        ctx.moveTo(gx + gs * 0.6, gy + gs * 0.8); ctx.lineTo(gx + gs * 0.5, gy - gs * 0.55);
        ctx.moveTo(gx - gs * 0.8, gy - gs * 0.5); ctx.lineTo(gx + gs * 0.8, gy - gs * 0.5);
        ctx.moveTo(gx - gs * 0.6, gy - gs * 0.25); ctx.lineTo(gx + gs * 0.6, gy - gs * 0.25);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(gx - gs * 0.55, gy + gs * 0.8);
        ctx.lineTo(gx - gs * 0.55, gy - gs * 0.1);
        ctx.arc(gx, gy - gs * 0.1, gs * 0.55, Math.PI, 0);
        ctx.lineTo(gx + gs * 0.55, gy + gs * 0.8);
        ctx.stroke();
      }
      ctx.restore();
      ctx.font = `bold 24px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(hs.label, hs.x, hs.y + hs.rh * 0.55);
      if (hs.sub) {
        ctx.font = `14px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(hs.sub, hs.x, hs.y + hs.rh * 0.55 + 26);
      }
    }
  }

  // ----- マップ -----
  _map(ctx, world) {
    const w = world.w, h = world.h;
    const run = world.run;
    const map = run.area.map;
    const layout = world._mapLayout();

    ctx.font = `bold ${Math.min(w * 0.03, 32)}px ${FONT}`;
    ctx.fillStyle = '#ffe9c0';
    ctx.fillText(`${T.areas[run.area.theme].name} — ${T.mapTitle}`, w / 2, h * 0.12);

    // エッジ
    ctx.strokeStyle = 'rgba(180,180,230,0.3)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 8]);
    for (let li = 0; li < map.layers.length - 1; li++) {
      for (const node of map.layers[li]) {
        const a = layout(li, node.index, map.layers[li].length);
        for (const ti of node.links) {
          const b = layout(li + 1, ti, map.layers[li + 1].length);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    ctx.setLineDash([]);

    // 全ノード（進めるノードはホットスポット描画に任せて小さく描く）
    const reachable = new Set(run.reachableNodes());
    for (let li = 0; li < map.layers.length; li++) {
      for (const node of map.layers[li]) {
        if (reachable.has(node)) continue;
        const pos = layout(li, node.index, map.layers[li].length);
        const isCurrent = run.layerIndex === li && run.nodeIndex === node.index;
        ctx.fillStyle = node.cleared ? 'rgba(120,255,140,0.25)'
          : isCurrent ? 'rgba(255,220,120,0.5)' : 'rgba(120,120,170,0.3)';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 26, 0, TAU); ctx.fill();
        this._nodeIcon(ctx, node.type, pos.x, pos.y, 15);
        if (isCurrent) {
          // 現在地マーカー
          ctx.strokeStyle = '#ffd23f';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(pos.x, pos.y, 32, 0, TAU); ctx.stroke();
        }
      }
    }
  }

  _nodeIcon(ctx, type, x, y, s) {
    ctx.save();
    ctx.lineWidth = Math.max(2, s * 0.14);
    ctx.lineCap = 'round';
    if (type === 'battle' || type === 'elite') {
      ctx.strokeStyle = type === 'elite' ? '#ffb04d' : '#ff8080';
      // 交差した剣
      ctx.beginPath();
      ctx.moveTo(x - s, y + s); ctx.lineTo(x + s, y - s);
      ctx.moveTo(x + s, y + s); ctx.lineTo(x - s, y - s);
      ctx.stroke();
      if (type === 'elite') {
        ctx.fillStyle = '#ffb04d';
        this._star(ctx, x, y - s * 1.5, s * 0.5, 5); ctx.fill();
      }
    } else if (type === 'treasure') {
      this._chestIcon(ctx, x, y, s * 1.6, false);
    } else if (type === 'shop') {
      ctx.strokeStyle = '#9adcff';
      ctx.fillStyle = '#9adcff';
      // のれん風
      ctx.strokeRect(x - s, y - s * 0.8, s * 2, s * 1.4);
      ctx.font = `bold ${s * 1.1}px ${FONT}`;
      ctx.fillText('魂', x, y);
    } else if (type === 'rest') {
      // 焚き火
      ctx.fillStyle = '#ffb04d';
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.quadraticCurveTo(x + s * 0.9, y, x, y + s * 0.8);
      ctx.quadraticCurveTo(x - s * 0.9, y, x, y - s);
      ctx.fill();
    } else if (type === 'boss') {
      ctx.strokeStyle = '#ff5c8a';
      ctx.fillStyle = '#ff5c8a';
      // 角付きドクロ
      ctx.beginPath(); ctx.arc(x, y, s * 0.8, 0, TAU); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.7, y - s * 0.5); ctx.lineTo(x - s * 1.1, y - s * 1.2);
      ctx.moveTo(x + s * 0.7, y - s * 0.5); ctx.lineTo(x + s * 1.1, y - s * 1.2);
      ctx.stroke();
      ctx.fillStyle = '#1a1030';
      ctx.beginPath(); ctx.arc(x - s * 0.3, y - s * 0.1, s * 0.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + s * 0.3, y - s * 0.1, s * 0.2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  _chestIcon(ctx, x, y, s, open) {
    ctx.save();
    ctx.fillStyle = '#b07030';
    ctx.fillRect(x - s * 0.5, y - s * 0.15, s, s * 0.45);
    ctx.fillStyle = '#c88840';
    ctx.fillRect(x - s * 0.5, y - s * (open ? 0.6 : 0.4), s, s * 0.28);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(x - s * 0.08, y - s * 0.18, s * 0.16, s * 0.25);
    ctx.restore();
  }

  // ----- ラン共通HUD -----
  _runHud(ctx, world) {
    const run = world.run;
    const w = world.w;
    ctx.save();
    ctx.textAlign = 'left';
    // 魂
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillStyle = '#9adcff';
    ctx.fillText(`◈ ${run.souls}`, 18, 30);
    // レベルとXPバー
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`${T.hudLevel}${run.level}`, 18, 62);
    const bx = 90, bw = 160;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx, 54, bw, 10);
    ctx.fillStyle = 'rgba(255,210,63,0.9)';
    ctx.fillRect(bx, 54, bw * clamp(run.xp / run.xpNeed, 0, 1), 10);
    // エリア表示
    ctx.textAlign = 'right';
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`${T.hudArea} ${run.areaIndex + 1}/${CONFIG.run.areas} — ${T.areas[world.areaTheme].name}`, w - 18, 28);
    // スコア
    ctx.fillText(`${T.resultScore} ${run.score}`, w - 18, 52);
    ctx.restore();
  }

  // ----- 戦闘HUD -----
  _battleHud(ctx, world) {
    const run = world.run;
    const w = world.w, h = world.h;
    ctx.save();

    // ヒーローHPバー（左下に人数分）
    const heroes = run.heroList;
    heroes.forEach((hero, i) => {
      const x = 18, y = h - 30 - (heroes.length - 1 - i) * 34;
      const bw = 190;
      ctx.textAlign = 'left';
      ctx.font = `bold 14px ${FONT}`;
      ctx.fillStyle = hero.color;
      ctx.fillText(T.roles[hero.roleId].name, x, y - 12);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, y - 4, bw, 12);
      const r = clamp(hero.hp / hero.maxHp, 0, 1);
      ctx.fillStyle = hero.downed ? 'rgba(120,120,140,0.8)'
        : r > 0.35 ? this._alpha(hero.color, 0.9) : 'rgba(255,90,90,0.95)';
      ctx.fillRect(x, y - 4, bw * (hero.downed ? hero.reviveProgress : r), 12);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y - 4, bw, 12);
      if (hero.downed) {
        ctx.fillStyle = '#ff9090';
        ctx.fillText(T.downed, x + bw + 10, y + 4);
      }
    });

    // 必殺ゲージ（下中央）
    const gw = Math.min(420, w * 0.4);
    const gx = w / 2 - gw / 2, gy = h - 26;
    const gr = clamp(world.gauge / world.gaugeMax, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(gx, gy, gw, 14);
    const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
    grad.addColorStop(0, '#7ce8ff'); grad.addColorStop(1, '#ff8bb0');
    ctx.fillStyle = gr >= 1 ? '#ffe36b' : grad;
    ctx.fillRect(gx, gy, gw * gr, 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.strokeRect(gx, gy, gw, 14);
    if (gr >= 1) {
      ctx.textAlign = 'center';
      ctx.font = `bold 16px ${FONT}`;
      ctx.fillStyle = `rgba(255,227,107,${0.6 + Math.sin(performance.now() / 150) * 0.4})`;
      ctx.fillText(T.ultReady, w / 2, gy - 14);
    }

    // コンボ
    if (world.combo >= 3) {
      ctx.textAlign = 'right';
      ctx.font = `bold 30px ${FONT}`;
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`${world.combo} COMBO x${world.comboMult}`, w - 18, h - 40);
    }

    // ボスHPバー（上中央）
    const boss = world.boss;
    if (boss && boss.alive) {
      const bw = Math.min(560, w * 0.55);
      const bx = w / 2 - bw / 2, by = 68;
      ctx.textAlign = 'center';
      ctx.font = `bold 20px ${FONT}`;
      ctx.fillStyle = '#ff9aae';
      ctx.fillText(T.bossNames[boss.kind], w / 2, by - 12);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, bw, 16);
      ctx.fillStyle = 'rgba(255,90,120,0.9)';
      ctx.fillRect(bx, by, bw * clamp(boss.hp / boss.maxHp, 0, 1), 16);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.strokeRect(bx, by, bw, 16);
      // フェーズ刻み
      for (let i = 1; i < boss.phases; i++) {
        const px = bx + bw * (1 - i / boss.phases);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.moveTo(px, by); ctx.lineTo(px, by + 16); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ----- レベルアップ -----
  _levelup(ctx, world) {
    const w = world.w, h = world.h;
    ctx.fillStyle = 'rgba(4,4,16,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = `bold ${Math.min(w * 0.045, 46)}px ${FONT}`;
    ctx.fillStyle = '#ffe36b';
    ctx.fillText(`${T.levelUp}  Lv${world.run.level}`, w / 2, h * 0.11);
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(T.levelUpSub, w / 2, h * 0.11 + 38);
    if (world.levelup) {
      ctx.font = `bold 22px ${FONT}`;
      ctx.fillStyle = '#ff9a9a';
      ctx.fillText(`${T.autoPickIn} ${Math.max(0, Math.ceil(world.levelup.timer))}`, w / 2, h * 0.92);
    }

    // 列見出し（ヒーロー名）とカード中身
    const heroes = world.run.heroList;
    const cols = heroes.length;
    heroes.forEach((hero, hi) => {
      const colW = w / Math.max(1, cols);
      const cx = colW * (hi + 0.5);
      ctx.font = `bold 22px ${FONT}`;
      ctx.fillStyle = hero.color;
      const picked = world.levelup && world.levelup.picked.has(hero.key);
      ctx.fillText(`${T.roles[hero.roleId].name}${picked ? ' ✓' : ''}`, cx, h * 0.2);
    });
    for (const hs of world.hotspots) {
      if (hs.kind !== 'skill') continue;
      const picked = world.levelup && world.levelup.picked.has(hs.hero.key);
      ctx.save();
      if (picked) ctx.globalAlpha = 0.35;
      ctx.font = `bold 19px ${FONT}`;
      ctx.fillStyle = '#ffe9c0';
      ctx.fillText(hs.label, hs.x, hs.y - 14);
      ctx.font = `13px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      this._wrapText(ctx, hs.sub, hs.x, hs.y + 12, hs.rw * 1.8, 16);
      ctx.restore();
    }
  }

  // ----- ショップ -----
  _shop(ctx, world) {
    const w = world.w, h = world.h;
    ctx.font = `bold ${Math.min(w * 0.04, 40)}px ${FONT}`;
    ctx.fillStyle = '#ffd9a0';
    ctx.fillText(T.shopTitle, w / 2, h * 0.14);
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(T.shopSub, w / 2, h * 0.14 + 36);
    for (const hs of world.hotspots) {
      if (hs.kind !== 'shopItem') continue;
      const st = hs.stock;
      ctx.save();
      if (st.sold) ctx.globalAlpha = 0.35;
      ctx.font = `bold 20px ${FONT}`;
      ctx.fillStyle = '#ffe9c0';
      ctx.fillText(hs.label, hs.x, hs.y - hs.rh * 0.55);
      ctx.font = `13px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      this._wrapText(ctx, hs.sub, hs.x, hs.y - hs.rh * 0.05, hs.rw * 1.7, 16);
      ctx.font = `bold 22px ${FONT}`;
      ctx.fillStyle = st.sold ? '#999' : (world.run.souls >= st.price ? '#9adcff' : '#ff9090');
      ctx.fillText(st.sold ? T.soldOut : `◈ ${st.price}`, hs.x, hs.y + hs.rh * 0.6);
      ctx.restore();
    }
  }

  // ----- 休憩 -----
  _rest(ctx, world) {
    const w = world.w, h = world.h;
    ctx.font = `bold ${Math.min(w * 0.036, 38)}px ${FONT}`;
    ctx.fillStyle = '#ffd9a0';
    ctx.fillText(T.restTitle, w / 2, h * 0.18);
    // 焚き火
    const fx = w / 2, fy = h * 0.55, fs = Math.min(w, h) * 0.09;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const k = 1 - i * 0.25;
      const g = ctx.createRadialGradient(fx, fy - fs * 0.3 * i, 0, fx, fy - fs * 0.3 * i, fs * k);
      g.addColorStop(0, `rgba(255,${180 - i * 40},80,${0.5 + Math.sin(t * (5 + i)) * 0.15})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(fx, fy - fs * 0.3 * i, fs * k, 0, TAU); ctx.fill();
    }
    ctx.restore();
    // 薪
    ctx.strokeStyle = '#8a5a30';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx - fs * 0.7, fy + fs * 0.5); ctx.lineTo(fx + fs * 0.7, fy + fs * 0.25);
    ctx.moveTo(fx + fs * 0.7, fy + fs * 0.5); ctx.lineTo(fx - fs * 0.7, fy + fs * 0.25);
    ctx.stroke();
    if (world.restT > 0.4) {
      ctx.font = `18px ${FONT}`;
      ctx.fillStyle = '#7CFF6B';
      ctx.fillText(T.restHealed, w / 2, fy + fs * 1.3);
    }
  }

  // ----- 宝箱 -----
  _treasure(ctx, world) {
    const w = world.w, h = world.h;
    ctx.font = `bold ${Math.min(w * 0.04, 40)}px ${FONT}`;
    ctx.fillStyle = '#ffd9a0';
    ctx.fillText(T.treasureTitle, w / 2, h * 0.16);
    if (world.treasureOpened) {
      this._chestIcon(ctx, w / 2, h * 0.5, Math.min(w, h) * 0.16, true);
      const id = world.treasureOpened;
      if (id !== 'souls' && T.relics[id]) {
        ctx.font = `bold 30px ${FONT}`;
        ctx.fillStyle = '#ffe36b';
        ctx.fillText(T.relics[id].name, w / 2, h * 0.66);
        ctx.font = `17px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(T.relics[id].desc, w / 2, h * 0.66 + 32);
      }
    }
  }

  // ----- 結果 -----
  _result(ctx, world, won) {
    const w = world.w, h = world.h;
    ctx.fillStyle = 'rgba(4,4,16,0.6)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = `bold ${Math.min(w * 0.07, 72)}px ${FONT}`;
    ctx.fillStyle = won ? '#ffe36b' : '#ff8a8a';
    ctx.fillText(won ? T.victory : T.gameover, w / 2, h * 0.3);
    if (won) {
      ctx.font = `22px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(T.victorySub, w / 2, h * 0.3 + 60);
    }
    if (world.run) {
      ctx.font = `bold 24px ${FONT}`;
      ctx.fillStyle = '#fff';
      const rows = [
        [T.resultScore, world.run.score],
        [T.resultLevel, `Lv${world.run.level}`],
        [T.resultSouls, `◈ ${world.run.souls}`],
      ];
      rows.forEach(([k, v], i) => {
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(String(k), w / 2 - 20, h * 0.5 + i * 40);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffe9c0';
        ctx.fillText(String(v), w / 2 + 20, h * 0.5 + i * 40);
      });
      ctx.textAlign = 'center';
    }
  }

  // ----- バナー -----
  _banner(ctx, world) {
    const b = world.banner;
    const w = world.w, h = world.h;
    const a = clamp(b.life / b.maxLife, 0, 1);
    const ease = a > 0.85 ? (1 - a) / 0.15 : a < 0.25 ? a / 0.25 : 1;
    ctx.save();
    ctx.globalAlpha = ease;
    ctx.fillStyle = 'rgba(4,4,18,0.55)';
    ctx.fillRect(0, h * 0.36, w, h * 0.16);
    ctx.font = `bold ${Math.min(w * 0.05, 52)}px ${FONT}`;
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 24;
    ctx.fillText(b.text, w / 2, h * 0.435);
    ctx.shadowBlur = 0;
    if (b.sub) {
      ctx.font = `18px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(b.sub, w / 2, h * 0.435 + 44);
    }
    ctx.restore();
  }
}
