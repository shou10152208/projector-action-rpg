// =============================================================
//  スキル（レベルアップ3択）の定義と適用
//  hero.mods に乗算/加算で効く。apply(hero) が実体。
// =============================================================

import { pick } from '../util.js';

// 汎用スキル（全ロール）
const GENERIC = [
  { id: 's_atk',    apply: (h) => { h.mods.atk *= 1.2; } },
  { id: 's_radius', apply: (h) => { h.mods.radius *= 1.15; } },
  { id: 's_clap',   apply: (h) => { h.mods.clap *= 1.35; h.mods.clapRadius *= 1.2; } },
  { id: 's_hp',     apply: (h) => { h.maxHp += 25; h.hp = Math.min(h.maxHp, h.hp + 25); } },
  { id: 's_leech',  apply: (h) => { h.mods.leech += 0.02; } },
  { id: 's_swift',  apply: (h) => { h.mods.slashEase *= 0.85; } },
  { id: 's_magnet', apply: (h) => { h.mods.magnet *= 1.4; } },
  { id: 's_gauge',  apply: (h) => { h.mods.gauge *= 1.3; } },
];

// ロール固有スキル
const ROLE_SKILLS = {
  kenshi: [
    { id: 's_counter', apply: (h) => { h.mods.counter *= 1.5; } },
    { id: 's_mikiri',  apply: (h) => { h.mods.dodgeWindow *= 1.4; } },
  ],
  monk: [
    { id: 's_kick',  apply: (h) => { h.mods.kick *= 1.4; } },
    { id: 's_stomp', apply: (h) => { h.mods.kickWave = true; } },
  ],
  mage: [
    { id: 's_fire',  apply: (h) => { h.mods.special *= 1.35; h.mods.specialRadius *= 1.15; } },
    { id: 's_haste', apply: (h) => { h.mods.specialCd *= 0.7; } },
  ],
  onmyoji: [
    { id: 's_kekkai', apply: (h) => { h.mods.barrierDur *= 1.5; } },
    { id: 's_fuda',   apply: (h) => { h.mods.boltCount += 1; } },
  ],
};

const ALL = [...GENERIC, ...Object.values(ROLE_SKILLS).flat()];
export function skillById(id) { return ALL.find((s) => s.id === id) || null; }

// そのヒーロー用の3択を作る（汎用2 + ロール固有1 が基本。被りなし）
export function rollChoices(hero, rng = Math.random) {
  const pool = [...GENERIC];
  const roleSkills = ROLE_SKILLS[hero.roleId] || [];
  const out = [];
  // ロール固有を1枠（確率高め）
  if (roleSkills.length && rng() < 0.8) {
    out.push(roleSkills[Math.floor(rng() * roleSkills.length)]);
  }
  while (out.length < 3 && pool.length) {
    const i = Math.floor(rng() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

// ヒーローの初期 mods
export function makeMods() {
  return {
    atk: 1,          // 与ダメージ倍率
    radius: 1,       // 手のオーラ倍率
    clap: 1,         // 拍手ダメージ倍率
    clapRadius: 1,
    leech: 0,        // 与ダメージ→回復率
    slashEase: 1,    // 斬撃成立速度の倍率（小さいほど出やすい）
    magnet: 1,       // 回収範囲倍率
    gauge: 1,        // ゲージ獲得倍率
    counter: 1,      // 剣士: カウンター倍率
    dodgeWindow: 1,  // ジャスト回避猶予倍率
    kick: 1,         // 拳闘士: 蹴り倍率
    kickWave: false, // 拳闘士: 蹴りで衝撃波
    special: 1,      // 固有技ダメージ倍率
    specialRadius: 1,
    specialCd: 1,    // 固有技クールダウン倍率
    barrierDur: 1,   // 陰陽師: 結界持続倍率
    boltCount: 0,    // 陰陽師: お札の追加枚数
  };
}
