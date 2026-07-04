// =============================================================
//  ロール定義と図形詠唱の認識
//  剣士 / 拳闘士 / 魔法使い / 陰陽師
//  同じ体の動きでもロールによって出る技が変わる。
// =============================================================

import { CONFIG } from '../config.js';
import { dist } from '../util.js';

export const ROLE_IDS = ['kenshi', 'monk', 'mage', 'onmyoji'];

export function roleCfg(roleId) {
  return CONFIG.roles[roleId] || CONFIG.roles.kenshi;
}

// 遠隔ロール（斬撃の代わりに弾を放つ）か
export function isRanged(roleId) {
  return roleId === 'mage' || roleId === 'onmyoji';
}

// -------------------------------------------------------------
// 図形認識 — 手の軌跡バッファ（{x,y,t}[]）から単純図形を検出する。
// 認識に成功したらバッファを消費（クリア）するのは呼び出し側の責務。
// -------------------------------------------------------------

// 円: 累積回転角が300°以上 + 始点と終点が近い + 十分な大きさ
export function detectCircle(path, scale) {
  if (path.length < 12) return null;
  const dur = path[path.length - 1].t - path[0].t;
  if (dur > 1.5 || dur < 0.15) return null;

  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of path) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX, h = maxY - minY;
  const size = Math.max(w, h);
  if (size < scale * 0.5) return null;             // 小さすぎ（手ブレ）
  if (Math.min(w, h) < size * 0.45) return null;   // 細長い＝円ではない

  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let total = 0;
  let prev = Math.atan2(path[0].y - cy, path[0].x - cx);
  for (let i = 1; i < path.length; i++) {
    const a = Math.atan2(path[i].y - cy, path[i].x - cx);
    let d = a - prev;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    total += d;
    prev = a;
  }
  if (Math.abs(total) < Math.PI * 1.65) return null; // 300°未満

  const closeDist = dist(path[0].x, path[0].y, path[path.length - 1].x, path[path.length - 1].y);
  if (closeDist > size * 0.6) return null;

  return { x: cx, y: cy, size };
}

// 縦一線: 上から下へまっすぐな速い一筆
export function detectVStroke(path, scale) {
  if (path.length < 6) return null;
  // 直近0.7秒だけを見る
  const tEnd = path[path.length - 1].t;
  let start = path.length - 1;
  while (start > 0 && tEnd - path[start - 1].t <= 0.7) start--;
  const seg = path.slice(start);
  if (seg.length < 6) return null;

  const x0 = seg[0].x, y0 = seg[0].y;
  const x1 = seg[seg.length - 1].x, y1 = seg[seg.length - 1].y;
  const dy = y1 - y0;
  if (dy < scale * 0.7) return null;              // 下向きに十分長く
  let maxDevX = 0, monotonic = true;
  let prevY = y0;
  for (const p of seg) {
    maxDevX = Math.max(maxDevX, Math.abs(p.x - x0));
    if (p.y < prevY - scale * 0.12) monotonic = false; // 大きく戻ったら不成立
    prevY = p.y;
  }
  if (!monotonic) return null;
  if (maxDevX > dy * 0.35) return null;           // 横ブレが大きい＝縦線ではない

  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}
