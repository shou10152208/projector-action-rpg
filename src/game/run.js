// =============================================================
//  RunState — 1回の冒険（ラン）の状態
//  分岐マップ生成 / ヒーロー(ロール・HP・スキル) / XP・レベル /
//  魂(通貨) / 遺物 / チーム補正
// =============================================================

import { CONFIG } from '../config.js';
import { mulberry32 } from '../util.js';
import { makeMods } from './skills.js';

// エリアごとの敵プール（テーマで顔ぶれが変わる）
export const AREA_ENEMIES = {
  wa:    { basic: ['chochin', 'kasa'], ranged: 'onibi', heavy: 'oni',   boss: 'tengu' },
  west:  { basic: ['slime', 'goblin'], ranged: 'gargoyle', heavy: 'oni', boss: 'lich' },
  chaos: { basic: ['chochin', 'kasa', 'slime', 'goblin'], ranged: 'gargoyle', heavy: 'oni', boss: 'dragon' },
};

export class RunState {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.seed = seed;
    this.rng = mulberry32(seed);

    this.areaIndex = 0;          // 0..2
    this.areas = [];             // { theme, route, map }
    this.layerIndex = 0;         // 現在の層（-1=未開始）
    this.nodeIndex = 0;          // 現在の層内のノード位置
    this.clearedNode = null;

    this.souls = 0;
    this.score = 0;
    this.level = 1;
    this.xp = 0;
    this.pendingLevelUps = 0;

    this.relics = [];            // 取得済み遺物ID
    this.team = {                // チーム補正（遺物・ショップで加算）
      atk: 1, def: 1, magnet: 1, gaugeRate: 1,
      dodgeWindow: 1, reviveSpeed: 1, dropRate: 1,
    };

    this.heroes = new Map();     // player.id -> hero
  }

  get xpNeed() {
    return Math.round(CONFIG.run.xpBase * Math.pow(this.level, CONFIG.run.xpCurve));
  }

  addXp(amount) {
    this.xp += amount;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.pendingLevelUps++;
    }
  }

  // --- ヒーロー ---
  addHero(key, roleId, color, colorRgb) {
    const maxHp = CONFIG.hero.maxHp;
    const hero = {
      key, roleId, color, colorRgb,
      maxHp, hp: maxHp,
      downed: false,
      reviveProgress: 0,
      bleedout: 0,
      invuln: 0,
      specialCd: 0,
      mods: makeMods(),
      // 直近のプレイヤー位置（プレイヤーが映っていない間も保持）
      x: 0, y: 0, scale: 220, seen: false,
      kills: 0,
    };
    this.heroes.set(key, hero);
    return hero;
  }

  hero(key) { return this.heroes.get(key) || null; }
  get heroList() { return [...this.heroes.values()]; }
  get aliveHeroes() { return this.heroList.filter((h) => !h.downed); }

  // --- エリア進行 ---
  // 最初のエリアを生成（realm = 'wa' | 'west'）
  startFirstArea(realm) {
    this.areaIndex = 0;
    this.areas = [{ theme: realm, route: 'bounty', map: this._genMap('bounty') }];
    this.layerIndex = -1;
    this.nodeIndex = 0;
  }

  // 次のエリアへ（route = 'bounty' | 'peril' | 'calm'）
  advanceArea(route) {
    this.areaIndex++;
    const prev = this.areas[this.areaIndex - 1].theme;
    const theme = this.areaIndex >= 2 ? 'chaos' : (prev === 'wa' ? 'west' : 'wa');
    this.areas.push({ theme, route, map: this._genMap(route) });
    this.layerIndex = -1;
    this.nodeIndex = 0;
  }

  get area() { return this.areas[this.areaIndex]; }
  get isFinalArea() { return this.areaIndex >= CONFIG.run.areas - 1; }

  // 今いる層から進めるノード一覧
  reachableNodes() {
    const map = this.area.map;
    const next = this.layerIndex + 1;
    if (next >= map.layers.length) return [];
    const nodes = map.layers[next];
    if (this.layerIndex < 0) return nodes; // エリア開始時はどこからでも
    const cur = map.layers[this.layerIndex][this.nodeIndex];
    return nodes.filter((n, i) => cur.links.includes(i));
  }

  moveTo(node) {
    this.layerIndex = node.layer;
    this.nodeIndex = node.index;
  }

  get currentNode() {
    if (this.layerIndex < 0) return null;
    return this.area.map.layers[this.layerIndex][this.nodeIndex];
  }

  // --- マップ生成 ---
  _genMap(route) {
    const rng = this.rng;
    const layerCount = CONFIG.run.layers;
    const perLayer = CONFIG.run.nodesPerLayer;
    const layers = [];

    // ルートによるノード出現の重み
    const weights = route === 'bounty'
      ? { battle: 4, elite: 1, treasure: 3, shop: 1.5, rest: 1 }
      : route === 'peril'
      ? { battle: 4, elite: 3, treasure: 1.5, shop: 1, rest: 0.7 }
      : { battle: 4, elite: 1, treasure: 1, shop: 1.5, rest: 3 };

    const pickType = (layer) => {
      if (layer === 0) return 'battle';
      const entries = Object.entries(weights);
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = rng() * total;
      for (const [type, w] of entries) {
        r -= w;
        if (r <= 0) return type;
      }
      return 'battle';
    };

    for (let li = 0; li < layerCount; li++) {
      const count = perLayer[li] ?? 3;
      const nodes = [];
      const isLast = li === layerCount - 1;
      for (let ni = 0; ni < count; ni++) {
        nodes.push({
          layer: li, index: ni,
          type: isLast ? 'boss' : pickType(li),
          links: [],           // 次層のどのノードへ進めるか
          cleared: false,
        });
      }
      // 同じ層に店・休憩が2個以上並んだら片方を戦闘に
      const seen = new Set();
      for (const n of nodes) {
        if ((n.type === 'shop' || n.type === 'rest' || n.type === 'treasure') && seen.has(n.type)) {
          n.type = 'battle';
        }
        seen.add(n.type);
      }
      layers.push(nodes);
    }

    // リンク生成（隣接層のインデックスが近いノードへ 1〜2 本）
    for (let li = 0; li < layerCount - 1; li++) {
      const cur = layers[li];
      const next = layers[li + 1];
      for (const n of cur) {
        const ratio = cur.length <= 1 ? 0.5 : n.index / (cur.length - 1);
        const target = Math.round(ratio * (next.length - 1));
        n.links.push(target);
        // 隣にも伸ばす
        const alt = target + (rng() < 0.5 ? -1 : 1);
        if (alt >= 0 && alt < next.length && rng() < 0.8) n.links.push(alt);
      }
      // 次層の全ノードに少なくとも1本入るよう補正
      for (let ti = 0; ti < next.length; ti++) {
        if (!cur.some((n) => n.links.includes(ti))) {
          const nearest = cur.reduce((a, b) =>
            Math.abs((a.index / Math.max(1, cur.length - 1)) * (next.length - 1) - ti) <
            Math.abs((b.index / Math.max(1, cur.length - 1)) * (next.length - 1) - ti) ? a : b);
          nearest.links.push(ti);
        }
      }
    }
    return { layers };
  }
}
