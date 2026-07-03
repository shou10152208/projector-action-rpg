// =============================================================
//  汎用ユーティリティ（数学 + 乱数）
// =============================================================

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const len = (x, y) => Math.hypot(x, y);
export const ema = (prev, next, a) => prev + (next - prev) * a;
export const approach = (v, target, step) =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);
export const wrap = (v, max) => ((v % max) + max) % max;

// --- 乱数（mulberry32: 高速で十分にランダム）---
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
export const rand = () => _rng();
export const range = (a, b) => a + (b - a) * _rng();
export const irange = (a, b) => Math.floor(a + (b - a + 1) * _rng());
export const pick = (arr) => arr[Math.floor(_rng() * arr.length)];
export const chance = (p) => _rng() < p;
export const coin = () => (_rng() < 0.5 ? -1 : 1);

// HSL から CSS 文字列
export const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

// #rrggbb -> "r,g,b"
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
