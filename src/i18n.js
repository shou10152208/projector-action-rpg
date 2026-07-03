// =============================================================
//  プレイヤー向け文言（日本語）
//  新規UI文字列は必ずここへ追加する。
// =============================================================

export const T = {
  title: 'あやかしとドラゴン',
  subtitle: 'AYAKASHI & DRAGONS',
  pressStart: '手をかざして冒険をはじめる',
  pressStartFallback: 'クリック / スペースで冒険をはじめる',
  loadingModel: 'からだ認識を準備中…',
  cameraOff: 'カメラなしモード（マウス/タッチで遊べます）',

  camErr: {
    INSECURE_CONTEXT: 'この接続ではカメラを使えません（https か localhost で開いてください）',
    NO_CAMERA_API: 'このブラウザはカメラに対応していません',
    NotAllowedError: 'カメラの使用が許可されませんでした',
    NotFoundError: 'カメラが見つかりませんでした',
    default: 'カメラを起動できませんでした',
  },

  // ロール
  roles: {
    kenshi:  { name: '剣士',   desc: '腕を振って斬撃。ジャスト回避で反撃の一閃', ult: '奥義・大一閃' },
    monk:    { name: '拳闘士', desc: '拳と蹴りで戦う。足も武器になる',           ult: '昇竜百裂撃' },
    mage:    { name: '魔法使い', desc: '魔弾を放つ。手で円を描くと大火球',       ult: 'メテオスウォーム' },
    onmyoji: { name: '陰陽師', desc: 'お札を飛ばす。縦に一線で結界を張る',       ult: '大祓・八百万' },
  },
  roleSelect: '手をかざしてロールを選ぼう',
  roleSelectSub: '全員が選ぶと出発！（スペースでおまかせ開始）',
  roleReady: '出発まで',

  // エリア / マップ
  areas: {
    wa:    { name: '和の霊峰',   sub: 'あやかしの棲む霊山' },
    west:  { name: '洋の魔城',   sub: '魔物のはびこる古城' },
    chaos: { name: '混沌の狭間', sub: '和と洋の交わる異界' },
  },
  gateTitle: 'ゆく道を選ぼう',
  gateStart: 'どちらの世界から冒険する？',
  routes: {
    bounty: { name: '豊穣の道', desc: '宝箱が多い' },
    peril:  { name: '修羅の道', desc: '強敵が多いが報酬も多い' },
    calm:   { name: '安息の道', desc: '休憩所が多い' },
  },
  mapTitle: '進む先に手をかざそう',
  nodes: {
    battle:   '戦闘',
    elite:    '強敵',
    treasure: '宝箱',
    shop:     '店',
    rest:     '休憩',
    boss:     'ボス',
  },

  // 戦闘
  waveStart: '敵襲！',
  battleClear: '勝利！',
  eliteAppear: '強敵出現！',
  bossAppear: {
    tengu:  '大天狗 見参',
    lich:   'リッチ王 降臨',
    dragon: '最終決戦 — 妖竜',
  },
  bossNames: { tengu: '大天狗', lich: 'リッチ王', dragon: '妖竜' },
  downed: '戦闘不能！',
  reviveHint: '仲間が手をかざすと復活',
  revived: '復活！',
  dodge: 'ジャスト回避！',
  counter: 'カウンター！',
  fusion: '合体技！',
  guard: 'ガード',
  ultReady: '必殺技 準備完了！ 両手を高く上げろ！',

  // レベルアップ
  levelUp: 'レベルアップ！',
  levelUpSub: '自分の列のスキルに手をかざして選ぼう',
  autoPickIn: '自動決定まで',

  // スキル（レベルアップ3択）
  skills: {
    s_atk:     { name: '攻撃強化',     desc: '与ダメージ +20%' },
    s_radius:  { name: 'オーラ拡大',   desc: '手の判定 +15%' },
    s_clap:    { name: '衝撃波強化',   desc: '拍手の威力と範囲アップ' },
    s_hp:      { name: '命の器',       desc: '最大HP +25 / その場で回復' },
    s_leech:   { name: '吸魂',         desc: '与ダメージの一部でHP回復' },
    s_swift:   { name: '疾風の腕',     desc: '斬撃が出やすくなる' },
    s_magnet:  { name: '魂の磁力',     desc: '魂の回収範囲 +40%' },
    s_gauge:   { name: '闘気の心得',   desc: '必殺ゲージが溜まりやすくなる' },
    // ロール固有
    s_counter: { name: '燕返し',       desc: '【剣士】カウンター威力 +50%' },
    s_mikiri:  { name: '見切り',       desc: '【剣士】ジャスト回避が出やすくなる' },
    s_kick:    { name: '剛脚',         desc: '【拳闘士】蹴りの威力 +40%' },
    s_stomp:   { name: '震脚',         desc: '【拳闘士】蹴りが衝撃波を生む' },
    s_fire:    { name: '大火球',       desc: '【魔法使い】円詠唱の爆発 +35%' },
    s_haste:   { name: '詠唱短縮',     desc: '【魔法使い】円詠唱の間隔 -30%' },
    s_kekkai:  { name: '結界延長',     desc: '【陰陽師】結界の持続 +50%' },
    s_fuda:    { name: '呪符連撃',     desc: '【陰陽師】お札が1枚増える' },
  },

  // ショップ / 宝箱 / 休憩
  shopTitle: 'あやかし堂',
  shopSub: '欲しい品に手をかざす（魂で購入）',
  shopItems: {
    potion: { name: '霊薬',      desc: '全員のHPを40%回復' },
    power:  { name: '力の宝珠',  desc: 'チーム攻撃 +15%' },
    amulet: { name: '守りの勾玉', desc: '被ダメージ -10%' },
    magnet: { name: '魂寄せの鈴', desc: '回収範囲 +40%' },
  },
  shopLeave: '店を出る',
  soldOut: '売り切れ',
  notEnough: '魂が足りない',
  treasureTitle: '宝箱だ！',
  treasureOpen: '手をかざして開ける',
  relics: {
    r_atk:    { name: '鬼の金棒の欠片', desc: 'チーム攻撃 +12%' },
    r_gauge:  { name: '竜の逆鱗',       desc: '必殺ゲージ効率 +30%' },
    r_dodge:  { name: '天狗の羽団扇',   desc: 'ジャスト回避の猶予 +50%' },
    r_revive: { name: '不死鳥の羽',     desc: '蘇生速度アップ' },
    r_drop:   { name: '招き猫',         desc: '魂のドロップ率 +40%' },
    r_def:    { name: '亀の甲羅',       desc: '被ダメージ -12%' },
  },
  restTitle: '焚き火にあたって ひとやすみ',
  restHealed: 'HPが回復した',
  continueHint: '手をかざして先へ進む',

  // 結果
  victory: '世界に平和が戻った！',
  victorySub: '妖竜討伐 おめでとう！',
  gameover: '全滅…',
  gameoverSub: '手をかざして再挑戦',
  resultScore: 'スコア',
  resultLevel: '到達レベル',
  resultSouls: '集めた魂',

  // HUD
  hudSouls: '魂',
  hudLevel: 'Lv',
  hudArea: 'エリア',
  keysHelp: '[マウス]手 [クリック]決定/攻撃 [C]拍手 [X]固有技 [右クリック長押し]ガード [Space]必殺技',
};
