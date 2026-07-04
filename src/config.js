// =============================================================
//  あやかしとドラゴン — 中央チューニング設定
//  ここの数値を変えるだけでゲームバランスを調整できます。
// =============================================================

export const CONFIG = {
  // --- 描画 ---
  render: {
    maxDpr: 2,            // 高DPIの上限（プロジェクター負荷対策）
    targetFps: 60,
    showCameraUnderlay: true, // 背景に薄くカメラ映像を映す（自分の位置確認用）
    cameraUnderlayAlpha: 0.15,
    maxParticles: 1400,
  },

  // --- 入力 / 認識 ---
  input: {
    modelFile: 'pose_landmarker_lite.task',
    maxPlayers: 4,
    delegate: 'GPU',
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    posSmoothing: 0.5,
    velSmoothing: 0.5,
    handVisibility: 0.4,
    footVisibility: 0.5,     // 足首の可視度しきい値（蹴り判定用）
    pathLife: 1.6,           // 図形詠唱用の手の軌跡を保持する秒数
    pathMax: 70,             // 軌跡バッファの最大点数
  },

  // --- プレイヤー（勇者） ---
  hero: {
    colors: ['#34e2ff', '#ff5cc8', '#ffd23f', '#7CFF6B', '#ff8a3d', '#b08bff'],
    handScale: 0.16,
    handRadiusMin: 30,
    handRadiusMax: 78,
    fallbackHandRadius: 46,
    maxHp: 100,
    hurtRadiusScale: 0.38,   // 体の中心の被弾半径 = scale × これ
    hitInvuln: 0.9,          // 被弾後の無敵秒数
    downedBleedout: 45,      // 戦闘不能から消滅までの猶予（実質お情け・全滅判定用）
    reviveTime: 3.0,         // 蘇生に必要な手かざし累計秒数
    reviveRadius: 130,       // 蘇生判定の半径
    reviveHpRatio: 0.4,      // 蘇生時のHP割合
    dodgeSpeed: 520,         // 被弾瞬間に体の中心がこの速度で動いていたらジャスト回避
    dodgeSlowmo: 0.3,        // ジャスト回避のスローモー倍率
    dodgeSlowmoTime: 0.7,
    guardDamageRatio: 0.25,  // ガード中の被ダメージ倍率
    guardMaxSpeed: 260,      // ガード成立の手の最大速度
    joinHpRatio: 0.7,        // 途中参加ヒーローの初期HP割合
  },

  // --- 戦闘 / ダメージ（手・足と敵の当たり） ---
  combat: {
    contactBaseDps: 20,
    speedDamageK: 0.06,
    speedCap: 2000,
    slashSpeed: 560,         // この速度を超えると「斬撃」= 瞬間ダメージ
    slashImpulseK: 0.035,
    slashImpulseMax: 70,
    handHitCooldown: 0.12,
    clapRadius: 230,
    clapDamage: 55,
    clapKnockback: 500,
    kickSpeed: 620,          // 拳闘士の蹴り成立速度
    kickDamageMult: 1.6,     // 蹴りの斬撃ダメージ倍率
    boltSpeed: 760,          // 遠隔ロール（魔弾/お札）の弾速
    boltRadius: 14,
    fusionWindow: 0.3,       // 合体技: 2人の拍手のズレ許容秒数
    fusionDist: 560,         // 合体技: 2人の距離上限
    fusionRadius: 420,
    fusionDamage: 150,
  },

  // --- ロール ---
  roles: {
    kenshi: { // 剣士 — 近接高火力・ジャスト回避でカウンター
      atk: 1.25, boltDamage: 0, counterDamage: 90, counterRadius: 260,
      accent: '#7ce8ff',
    },
    monk: {   // 拳闘士 — 近接・蹴りが武器になる
      atk: 1.1, boltDamage: 0,
      accent: '#ffb04d',
    },
    mage: {   // 魔法使い — 遠隔魔弾・円を描いて大火球
      atk: 0.55, boltDamage: 16,
      circleDamage: 120, circleRadius: 230, circleCooldown: 3.0,
      accent: '#c08bff',
    },
    onmyoji: { // 陰陽師 — 遠隔お札・縦一線で結界
      atk: 0.55, boltDamage: 13, boltCount: 1,
      barrierDuration: 6, barrierRadius: 120, barrierDps: 22, barrierCooldown: 4.0,
      accent: '#8bffb0',
    },
  },

  // --- 必殺技（両手上げ + ゲージ満タン / 発動者のロールで演出が変わる） ---
  ultimate: {
    gaugeMax: 100,
    gainPerDamage: 0.045,
    gainPerKill: 3,
    gainPerDodge: 6,
    damage: 999,             // 通常敵は一掃
    bossDamage: 380,
    duration: 2.2,
    slowmo: 0.25,
  },

  // --- 敵（和洋の妖魔） ---
  enemies: {
    // 和
    chochin: { hp: 26, radius: 26, speed: 60,  atk: 10, atkRange: 60, atkCd: 1.6, score: 90,  xp: 8 },  // 提灯お化け: ふわふわ接近
    kasa:    { hp: 18, radius: 20, speed: 150, atk: 8,  atkRange: 55, atkCd: 1.4, score: 70,  xp: 6, hopEvery: 1.1 }, // からかさ: 跳ねて接近
    oni:     { hp: 90, radius: 34, speed: 45,  atk: 18, atkRange: 75, atkCd: 2.0, score: 300, xp: 22,
               contactResist: 0.2 }, // 鬼: 接触耐性、斬撃・技で割る
    onibi:   { hp: 12, radius: 14, speed: 100, atk: 0,  score: 60,  xp: 5,
               fireEvery: 2.6, shotSpeed: 240, shotDamage: 9 }, // 鬼火: 遠くから火の玉
    // 洋
    slime:   { hp: 30, radius: 26, speed: 70,  atk: 9,  atkRange: 55, atkCd: 1.5, score: 90,  xp: 8, splits: 2 }, // スライム: 分裂
    goblin:  { hp: 22, radius: 20, speed: 165, atk: 10, atkRange: 55, atkCd: 1.2, score: 80,  xp: 7 }, // ゴブリン: 素早い
    gargoyle:{ hp: 55, radius: 28, speed: 55,  atk: 0,  score: 240, xp: 18,
               fireEvery: 3.2, shotSpeed: 280, shotDamage: 12, volley: 3 }, // ガーゴイル: 3連射
    mimic:   { hp: 140, radius: 32, speed: 90, atk: 20, atkRange: 70, atkCd: 1.6, score: 500, xp: 40,
               contactResist: 0.35 }, // ミミック: エリート
    shot:    { radius: 11, score: 15, xp: 1 }, // 敵弾（手ではたき落とせる）
    spawnTelegraph: 0.7,     // 出現予告の秒数
    windup: 0.55,            // 近接攻撃の予備動作（この間に離れる/回避）
    scalePerArea: 0.35,      // エリアが進むごとの HP/攻撃 増加率
    scalePerPlayer: 0.6,     // 追加プレイヤー1人ごとの敵HP倍率加算
  },

  // --- ボス ---
  boss: {
    tengu: {  // 大天狗（和の霊峰）
      hp: 2200, radius: 110, phases: 3, score: 4000, xp: 150,
      featherEvery: [2.8, 2.2, 1.6], featherCount: [4, 6, 8],
      gustEvery: [7, 6, 5], summonEvery: [8, 6.5, 5],
    },
    lich: {   // リッチ王（洋の魔城）
      hp: 2600, radius: 100, phases: 3, score: 5000, xp: 180,
      orbEvery: [2.6, 2.0, 1.5], orbCount: [5, 7, 9],
      ringEvery: [8, 6.5, 5], ringCount: 12, summonEvery: [7, 6, 4.5],
    },
    dragon: { // 妖竜（混沌の狭間・最終ボス）
      hp: 3800, radius: 130, phases: 4, score: 12000, xp: 300,
      breathEvery: [3.0, 2.4, 1.9, 1.5], breathCount: [5, 7, 9, 11],
      sweepEvery: [9, 8, 7, 6], ringEvery: [10, 8, 7, 5.5], ringCount: 14,
      summonEvery: [8, 7, 5.5, 4.5],
    },
    enterTime: 2.6,
  },

  // --- ラン構造（マップ） ---
  run: {
    areas: 3,
    layers: 5,               // 各エリアのノード層数（最終層はボス）
    nodesPerLayer: [1, 3, 3, 3, 1],
    battleWaves: 2,          // 通常戦闘のウェーブ数
    eliteWaves: 2,
    restHealRatio: 0.4,
    xpBase: 60,              // レベルアップ必要XP = base × level^curve
    xpCurve: 1.25,
    levelChoiceTime: 10,     // スキル選択の制限時間（超過でランダム決定）
  },

  // --- 魂（通貨）と回復玉 ---
  pickup: {
    soulChance: 0.55,        // 敵撃破時に魂を落とす確率
    soulValue: [1, 3],
    healChance: 0.06,        // 回復玉のドロップ率
    healAmount: 12,
    radius: 18,
    life: 10,
    magnetRadius: 90,        // 手に吸い寄せられ始める距離
    clearBonus: [6, 12],     // 戦闘クリア時のボーナス魂
  },

  // --- ショップ ---
  shop: {
    items: [
      { id: 'potion',  price: 30 },  // 全員40%回復
      { id: 'power',   price: 45 },  // チーム攻撃+15%
      { id: 'amulet',  price: 45 },  // チーム被ダメ-10%
      { id: 'magnet',  price: 35 },  // 回収範囲+40%
    ],
  },

  // --- 宝箱の遺物（パッシブ） ---
  relics: [
    { id: 'r_atk',    mod: { atk: 0.12 } },
    { id: 'r_gauge',  mod: { gaugeRate: 0.3 } },
    { id: 'r_dodge',  mod: { dodgeWindow: 0.5 } },
    { id: 'r_revive', mod: { reviveSpeed: 0.6 } },
    { id: 'r_drop',   mod: { dropRate: 0.4 } },
    { id: 'r_def',    mod: { def: 0.12 } },
  ],

  // --- UI（手かざし選択） ---
  ui: {
    dwellTime: 1.3,          // ホットスポット選択に必要なかざし秒数
    dwellDecay: 2.0,         // 外した時の減衰速度（倍率）
  },

  // --- コンボ ---
  combo: {
    window: 2.6,
    maxMultiplier: 8,
  },

  // --- 音 ---
  audio: {
    masterVolume: 0.7,
    musicVolume: 0.3,
    sfxVolume: 0.6,
  },
};
