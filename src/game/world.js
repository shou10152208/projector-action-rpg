// =============================================================
//  World — ゲームの中心
//  状態機械: title / roleSelect / gateStart / map / battle /
//            levelup / shop / rest / treasure / gate /
//            gameover / victory
//  戦闘（手・足と敵の当たり判定 / HP・蘇生 / ジャスト回避 / ガード /
//  図形詠唱 / 合体技 / 必殺技）と、手かざしUI（ホットスポット）を持つ。
//  particles と audio はコンストラクタで受け取る。
// =============================================================

import { CONFIG } from '../config.js';
import { T } from '../i18n.js';
import { clamp, dist, range, irange, chance, pick } from '../util.js';
import { RunState, AREA_ENEMIES } from './run.js';
import { rollChoices } from './skills.js';
import { ROLE_IDS, roleCfg, isRanged, detectCircle, detectVStroke } from './roles.js';
import {
  spawnEnemyByType, EnemyShot, FriendlyBolt, Shockwave, Barrier, Pickup, Boss,
} from './entities.js';

export class World {
  constructor(particles, audio) {
    this.particles = particles;
    this.audio = audio;
    this.w = 1280; this.h = 720;

    this.phase = 'title';
    this.run = null;

    // 戦闘中のエンティティ
    this.enemies = [];
    this.bolts = [];
    this.shockwaves = [];
    this.barriers = [];
    this.pickups = [];
    this.boss = null;

    // チーム資源
    this.gauge = 0;
    this.gaugeMax = CONFIG.ultimate.gaugeMax;

    // コンボ
    this.combo = 0;
    this.comboTimer = 0;

    // 演出
    this.shake = 0;
    this.screenFlash = null;   // {color, life, maxLife}
    this.timeScale = 1;
    this._slowmoT = 0;
    this.floaters = [];        // {x,y,text,color,life,maxLife,size}
    this.banner = null;        // {text, sub, life, maxLife, color}

    // 手かざしUI
    this.hotspots = [];

    // フェーズごとの一時データ
    this.roleClaims = new Map();     // playerKey -> roleId
    this.roleCountdown = -1;
    this.levelup = null;             // { choices: Map(key->[skill]), picked: Map, timer }
    this.shopStock = [];
    this.treasureOpened = null;      // 開けた遺物ID
    this.battle = null;              // { kind, waves, waveIndex, spawnQueue, state, clearT }
    this.restT = 0;

    // 戦闘で毎フレーム作るターゲット表
    this.heroTargets = [];

    // 合体技の判定用
    this._lastClap = null;           // {key, x, y, t}
    this._clock = 0;

    // 必殺演出
    this._ultT = 0;
    this._ultHero = null;
  }

  resize(w, h) { this.w = w; this.h = h; }

  // ===========================================================
  //  外部トリガー（main から）
  // ===========================================================

  requestStart() {
    if (this.phase === 'title') this._enterRoleSelect();
    else if (this.phase === 'roleSelect') this._autoAssignRoles();
    else if (this.phase === 'gameover' || this.phase === 'victory') this._reset();
  }

  // フォールバック: Space = 必殺技
  triggerUltimate() {
    if (this._inBattle() && this.gauge >= this.gaugeMax) {
      const h = this.run.aliveHeroes[0];
      if (h) this._ultimate(h);
    } else {
      this.requestStart();
    }
  }

  // フォールバック: C = 拍手
  triggerClapAt(playerKey, x, y) {
    if (!this._inBattle()) return;
    const hero = this.run && this.run.hero(playerKey);
    if (hero && !hero.downed) this._clap(hero, x, y);
  }

  // フォールバック: X = ロール固有技
  triggerSpecialAt(playerKey, x, y) {
    if (!this._inBattle()) return;
    const hero = this.run && this.run.hero(playerKey);
    if (!hero || hero.downed || hero.specialCd > 0) return;
    const rc = roleCfg(hero.roleId);
    if (hero.roleId === 'mage') this._castFireball(hero, x, y);
    else if (hero.roleId === 'onmyoji') this._castBarrier(hero, x, y);
    else if (hero.roleId === 'monk') {
      this._spawnShockwave(hero, x, y, CONFIG.combat.clapRadius * 0.8,
        CONFIG.combat.clapDamage * hero.mods.kick * this._atkOf(hero));
      this.audio.kick();
      hero.specialCd = 1.2;
    } else {
      // 剣士: 小範囲の居合
      this._spawnShockwave(hero, x, y, rc.counterRadius * 0.7,
        rc.counterDamage * 0.6 * this._atkOf(hero));
      this.audio.slash();
      hero.specialCd = 1.5;
    }
  }

  // フォールバック: クリックで手かざしUIを即決定
  clickAt(x, y) {
    for (const hs of this.hotspots) {
      if (!hs.enabled) continue;
      if (this._insideHotspot(hs, x, y)) { this._fireHotspot(hs); return true; }
    }
    return false;
  }

  // ===========================================================
  //  メイン更新
  // ===========================================================

  update(dt, players) {
    this._clock += dt;

    // スローモー
    if (this._slowmoT > 0) {
      this._slowmoT -= dt;
      if (this._slowmoT <= 0) this.timeScale = 1;
    }
    const sdt = dt * this.timeScale;

    // 実時間の演出減衰
    this.shake = Math.max(0, this.shake - dt * 30);
    if (this.screenFlash) {
      this.screenFlash.life -= dt;
      if (this.screenFlash.life <= 0) this.screenFlash = null;
    }
    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt; f.y -= 34 * dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
    this.particles.update(dt);

    // ヒーローの位置をプレイヤーから同期 + 途中参加
    this._syncHeroes(dt, players);

    // 手かざしUI
    this._updateHotspots(dt, players);

    // フェーズ別
    switch (this.phase) {
      case 'roleSelect': this._updateRoleSelect(dt, players); break;
      case 'battle': this._updateBattle(sdt, dt, players); break;
      case 'levelup': this._updateLevelup(dt, players); break;
      case 'rest': this._updateRest(dt); break;
      default: break;
    }

    // 拾い物はマップ画面でも残さない（戦闘中のみ）
    if (this._inBattle()) {
      this._collectPickups(players);
    }
  }

  _inBattle() { return this.phase === 'battle'; }

  get activeHeroCount() { return this.run ? this.run.heroList.length : 0; }
  get areaIndex() { return this.run ? this.run.areaIndex : 0; }
  get areaTheme() { return this.run && this.run.area ? this.run.area.theme : 'wa'; }

  // 敵のスケーリング
  get enemyScale() {
    const players = Math.max(1, this.activeHeroCount);
    return 1 + this.areaIndex * CONFIG.enemies.scalePerArea +
      (players - 1) * CONFIG.enemies.scalePerPlayer;
  }
  get enemyAtkScale() { return 1 + this.areaIndex * 0.25; }

  // ===========================================================
  //  ヒーロー同期・被弾・蘇生
  // ===========================================================

  _syncHeroes(dt, players) {
    if (!this.run) { this.heroTargets = []; return; }

    for (const p of players) {
      if (!p.active) continue;
      let hero = this.run.hero(p.id);
      // ラン中の途中参加: 空いているロールで自動参加
      if (!hero && this.phase !== 'roleSelect' && this.phase !== 'title') {
        const used = new Set(this.run.heroList.map((h) => h.roleId));
        const free = ROLE_IDS.filter((r) => !used.has(r));
        hero = this.run.addHero(p.id, free.length ? free[0] : pick(ROLE_IDS), p.color, p.colorRgb);
        hero.hp = hero.maxHp * CONFIG.hero.joinHpRatio;
        this.addFloat(p.center.x, p.center.y, `${T.roles[hero.roleId].name} 参戦！`, p.color, 1.6, 22);
      }
      if (hero) {
        hero.x = p.center.x; hero.y = p.center.y;
        hero.scale = p.scale; hero.seen = true;
        hero.centerSpeed = p.center.speed || 0;
        hero.guarding = !!p.gestures.guard && !hero.downed;
      }
    }

    for (const hero of this.run.heroList) {
      hero.invuln = Math.max(0, hero.invuln - dt);
      hero.specialCd = Math.max(0, hero.specialCd - dt);
      if (hero.downed) {
        hero.bleedout += dt;
        // 蘇生判定: 他プレイヤーの手が近くにあるか
        let reviving = false;
        for (const p of players) {
          if (!p.active || p.id === hero.key) continue;
          const other = this.run.hero(p.id);
          if (other && other.downed) continue;
          for (const key of ['left', 'right']) {
            const hand = p.hands[key];
            if (hand.present && dist(hand.x, hand.y, hero.x, hero.y) < CONFIG.hero.reviveRadius) {
              reviving = true;
            }
          }
        }
        if (reviving) {
          hero.reviveProgress += dt * this.run.team.reviveSpeed / CONFIG.hero.reviveTime;
          if (chance(0.3)) this.particles.glow(hero.x + range(-40, 40), hero.y + range(-40, 40), '140,255,190', {});
          if (hero.reviveProgress >= 1) this._revive(hero);
        } else {
          hero.reviveProgress = Math.max(0, hero.reviveProgress - dt * 0.4);
        }
      }
    }

    // ターゲット表（敵AI用）
    this.heroTargets = this.run.heroList
      .filter((h) => h.seen)
      .map((h) => ({
        key: h.key, x: h.x, y: h.y, downed: h.downed,
        hurtRadius: clamp(h.scale * CONFIG.hero.hurtRadiusScale, 50, 150),
      }));
  }

  randomHeroTarget() {
    const list = this.heroTargets.filter((t) => !t.downed);
    return list.length ? pick(list) : null;
  }

  damageHero(key, amount, src = {}) {
    if (!this.run || !this._inBattle()) return;
    const hero = this.run.hero(key);
    if (!hero || hero.downed || hero.invuln > 0) return;

    // ジャスト回避: 被弾の瞬間に体が素早く動いていた
    const dodgeNeed = CONFIG.hero.dodgeSpeed /
      (hero.mods.dodgeWindow * this.run.team.dodgeWindow);
    if ((hero.centerSpeed || 0) > dodgeNeed) {
      this._onDodge(hero, src);
      return;
    }

    let dmg = amount / this.run.team.def;
    if (hero.guarding) {
      dmg *= CONFIG.hero.guardDamageRatio;
      this.audio.guard();
      this.addFloat(hero.x, hero.y - 40, T.guard, '#9adcff', 0.7, 18);
    } else {
      this.audio.playerHit();
      this.addShake(10);
      this.screenFlash = { color: 'rgba(255,60,60,0.6)', life: 0.18, maxLife: 0.18 };
    }
    hero.hp -= dmg;
    hero.invuln = CONFIG.hero.hitInvuln;
    this.particles.explosion(src.x ?? hero.x, src.y ?? hero.y, '255,90,90', 0.5);

    if (hero.hp <= 0) {
      hero.hp = 0;
      hero.downed = true;
      hero.bleedout = 0;
      hero.reviveProgress = 0;
      hero.guarding = false;
      this.audio.downed();
      this.addBanner(T.downed, T.reviveHint, 2.2, '#ff8080');
      // 全滅チェック
      if (this.run.aliveHeroes.length === 0) this._gameover();
    }
  }

  _onDodge(hero, src) {
    hero.invuln = 0.8;
    this.timeScale = CONFIG.hero.dodgeSlowmo;
    this._slowmoT = CONFIG.hero.dodgeSlowmoTime;
    this.audio.dodge();
    this.addFloat(hero.x, hero.y - 50, T.dodge, '#7CFF6B', 1.0, 26);
    this.gauge = Math.min(this.gaugeMax,
      this.gauge + CONFIG.ultimate.gainPerDodge * hero.mods.gauge * this.run.team.gaugeRate);
    // 剣士: カウンターの一閃
    if (hero.roleId === 'kenshi') {
      const rc = roleCfg('kenshi');
      this._spawnShockwave(hero, hero.x, hero.y,
        rc.counterRadius, rc.counterDamage * hero.mods.counter * this._atkOf(hero));
      this.addFloat(hero.x, hero.y - 80, T.counter, hero.color, 1.0, 24);
      this.audio.slash();
    }
  }

  _revive(hero) {
    hero.downed = false;
    hero.hp = hero.maxHp * CONFIG.hero.reviveHpRatio;
    hero.reviveProgress = 0;
    hero.invuln = 1.5;
    this.audio.revive();
    this.addFloat(hero.x, hero.y - 60, T.revived, hero.color, 1.4, 28);
    this.particles.explosion(hero.x, hero.y, hero.colorRgb, 1);
  }

  healHero(hero, amount) {
    if (hero.downed) return;
    hero.hp = Math.min(hero.maxHp, hero.hp + amount);
    this.addFloat(hero.x, hero.y - 40, `+${Math.round(amount)}`, '#7CFF6B', 0.9, 20);
  }

  _atkOf(hero) {
    return roleCfg(hero.roleId).atk * hero.mods.atk * this.run.team.atk;
  }

  // ===========================================================
  //  フェーズ遷移
  // ===========================================================

  _reset() {
    this.phase = 'title';
    this.run = null;
    this._clearBattlefield();
    this.gauge = 0;
    this.combo = 0;
    this.roleClaims.clear();
    this.roleCountdown = -1;
    this._buildHotspots();
  }

  _clearBattlefield() {
    this.enemies.length = 0;
    this.bolts.length = 0;
    this.shockwaves.length = 0;
    this.barriers.length = 0;
    this.pickups.length = 0;
    this.boss = null;
    this.battle = null;
    this.timeScale = 1;
    this._slowmoT = 0;
  }

  _enterRoleSelect() {
    this.phase = 'roleSelect';
    this.run = new RunState();
    this.roleClaims.clear();
    this.roleCountdown = -1;
    this.audio.select();
    this._buildHotspots();
  }

  _updateRoleSelect(dt, players) {
    // 全アクティブプレイヤーが選んだらカウントダウン
    const actives = players.filter((p) => p.active);
    const allPicked = actives.length > 0 &&
      actives.every((p) => this.roleClaims.has(p.id));
    if (allPicked) {
      if (this.roleCountdown < 0) this.roleCountdown = 3;
      this.roleCountdown -= dt;
      if (this.roleCountdown <= 0) this._confirmRoles(players);
    } else {
      this.roleCountdown = -1;
    }
  }

  _autoAssignRoles() {
    // Space でおまかせ開始（誰も選んでいなくても始められる）
    this.roleCountdown = -1;
    this._confirmRoles(null);
  }

  _confirmRoles(players) {
    const claims = this.roleClaims;
    if (claims.size === 0) claims.set('solo', pick(ROLE_IDS));
    for (const [key, roleId] of claims) {
      const idx = typeof key === 'number' ? key : 0;
      const color = CONFIG.hero.colors[idx % CONFIG.hero.colors.length];
      const hero = this.run.addHero(key, roleId, color, hexRgbCached(color));
      if (players) {
        const p = players.find((pp) => pp.id === key);
        if (p) { hero.x = p.center.x; hero.y = p.center.y; hero.seen = true; }
      }
    }
    this.phase = 'gateStart';
    this.audio.waveStart();
    this._buildHotspots();
  }

  _startFirstArea(realm) {
    this.run.startFirstArea(realm);
    this.phase = 'map';
    this.audio.door();
    this._buildHotspots();
  }

  _enterNode(node) {
    this.run.moveTo(node);
    this.audio.select();
    switch (node.type) {
      case 'battle':
      case 'elite':
      case 'boss':
        this._startBattle(node.type);
        break;
      case 'shop': this._enterShop(); break;
      case 'rest': this._enterRest(); break;
      case 'treasure': this._enterTreasure(); break;
      default: this._startBattle('battle');
    }
  }

  _nodeCleared() {
    const node = this.run.currentNode;
    if (node) node.cleared = true;
    if (node && node.type === 'boss') {
      if (this.run.isFinalArea) { this._victory(); return; }
      this.phase = 'gate';
      this._buildHotspots();
      return;
    }
    this.phase = 'map';
    this._buildHotspots();
  }

  // レベルアップ待ちがあれば挟む
  _maybeLevelupThen() {
    if (this.run.pendingLevelUps > 0) {
      this._enterLevelup();
    } else {
      this._nodeCleared();
    }
  }

  _enterLevelup() {
    this.run.pendingLevelUps--;
    const choices = new Map();
    const picked = new Map();
    for (const hero of this.run.heroList) {
      choices.set(hero.key, rollChoices(hero, this.run.rng));
    }
    this.levelup = { choices, picked, timer: CONFIG.run.levelChoiceTime };
    this.phase = 'levelup';
    this.audio.levelUp();
    this._buildHotspots();
  }

  _updateLevelup(dt) {
    const lu = this.levelup;
    if (!lu) return;
    lu.timer -= dt;
    const heroes = this.run.heroList;
    const allPicked = heroes.every((h) => lu.picked.has(h.key));
    if (allPicked || lu.timer <= 0) {
      // 未選択はランダム決定
      for (const h of heroes) {
        if (!lu.picked.has(h.key)) {
          const cs = lu.choices.get(h.key);
          this._applySkill(h, pick(cs));
        }
      }
      this.levelup = null;
      this._maybeLevelupThen();
    }
  }

  _applySkill(hero, skill) {
    if (!skill) return;
    skill.apply(hero);
    if (this.levelup) this.levelup.picked.set(hero.key, skill.id);
    this.addFloat(hero.x || this.w / 2, (hero.y || this.h / 2) - 60,
      T.skills[skill.id].name, hero.color, 1.6, 24);
    this.audio.buy();
  }

  _enterShop() {
    this.shopStock = CONFIG.shop.items.map((it) => ({ ...it, sold: false }));
    this.phase = 'shop';
    this.audio.coin();
    this._buildHotspots();
  }

  _buyItem(stock) {
    if (stock.sold) return;
    if (this.run.souls < stock.price) {
      this.audio.deny();
      this.addBanner(T.notEnough, '', 1.0, '#ff9090');
      return;
    }
    this.run.souls -= stock.price;
    stock.sold = true;
    this.audio.buy();
    switch (stock.id) {
      case 'potion':
        for (const h of this.run.heroList) this.healHero(h, h.maxHp * 0.4);
        break;
      case 'power': this.run.team.atk += 0.15; break;
      case 'amulet': this.run.team.def += 0.1; break;
      case 'magnet': this.run.team.magnet += 0.4; break;
    }
    this.addBanner(T.shopItems[stock.id].name, T.shopItems[stock.id].desc, 1.6, '#ffd23f');
    this._buildHotspots();
  }

  _enterRest() {
    this.phase = 'rest';
    this.restT = 0;
    this._buildHotspots();
  }

  _updateRest(dt) {
    // 2.5秒かけてじんわり回復
    if (this.restT < 2.5) {
      const prev = this.restT;
      this.restT += dt;
      const ratio = CONFIG.run.restHealRatio / 2.5;
      for (const h of this.run.heroList) {
        if (!h.downed) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * ratio * dt);
        else { h.downed = false; h.hp = h.maxHp * 0.35; } // 焚き火は倒れた仲間も起こす
      }
      if (prev === 0) this.audio.heal();
    }
  }

  _enterTreasure() {
    this.treasureOpened = null;
    this.phase = 'treasure';
    this._buildHotspots();
  }

  _openTreasure() {
    if (this.treasureOpened) return;
    const owned = new Set(this.run.relics);
    const cands = CONFIG.relics.filter((r) => !owned.has(r.id));
    const relic = cands.length ? cands[Math.floor(this.run.rng() * cands.length)] : null;
    if (relic) {
      this.run.relics.push(relic.id);
      for (const [k, v] of Object.entries(relic.mod)) {
        if (k === 'def' || k === 'atk') this.run.team[k] += v;
        else this.run.team[k] += v;
      }
      this.treasureOpened = relic.id;
      this.addBanner(T.relics[relic.id].name, T.relics[relic.id].desc, 2.4, '#ffd23f');
    } else {
      // 遺物が尽きていたら魂
      this.run.souls += 30;
      this.treasureOpened = 'souls';
      this.addBanner(`${T.hudSouls} +30`, '', 1.6, '#9adcff');
    }
    this.audio.chest();
    this.particles.explosion(this.w / 2, this.h / 2, '255,215,120', 1.2);
    this._buildHotspots();
  }

  _chooseGate(route) {
    this.run.advanceArea(route);
    this.phase = 'map';
    this.audio.door();
    this.addBanner(T.areas[this.run.area.theme].name, T.areas[this.run.area.theme].sub, 2.4, '#9adcff');
    this._buildHotspots();
  }

  _gameover() {
    this.phase = 'gameover';
    this._clearBattlefield();
    this.audio.defeat();
    this._buildHotspots();
  }

  _victory() {
    this.phase = 'victory';
    this._clearBattlefield();
    this.audio.victory();
    this._buildHotspots();
  }

  // ===========================================================
  //  戦闘
  // ===========================================================

  _startBattle(kind) {
    this._clearBattlefield();
    const node = this.run.currentNode;
    this.battle = {
      kind,
      waveIndex: 0,
      waves: this._buildWaves(kind),
      spawnQueue: [],
      state: 'intro',
      stateT: kind === 'boss' ? 1.6 : 1.1,
      clearT: 0,
    };
    this.phase = 'battle';
    if (kind === 'boss') {
      const bossKind = AREA_ENEMIES[this.areaTheme].boss;
      this.addBanner(T.bossAppear[bossKind], '', 2.6, '#ff8080');
      this.audio.bossRoar();
    } else if (kind === 'elite') {
      this.addBanner(T.eliteAppear, '', 1.8, '#ffb04d');
      this.audio.waveStart();
    } else {
      this.addBanner(T.waveStart, '', 1.4, '#9adcff');
      this.audio.waveStart();
    }
    this._buildHotspots();
  }

  _buildWaves(kind) {
    const pool = AREA_ENEMIES[this.areaTheme];
    const players = Math.max(1, this.activeHeroCount);
    const depth = Math.max(0, this.run.layerIndex + 1);
    const base = 3 + depth + Math.round(players * 1.5);
    const waves = [];
    const waveCount = kind === 'boss' ? 0 : CONFIG.run.battleWaves;

    for (let wi = 0; wi < waveCount; wi++) {
      const list = [];
      const n = base + wi * 2;
      for (let i = 0; i < n; i++) list.push(pick(pool.basic));
      // 遠隔と重量級を混ぜる
      const rangedN = Math.min(3, 1 + Math.floor((depth + wi) / 2));
      for (let i = 0; i < rangedN; i++) list.push(pool.ranged);
      if (depth >= 2 || wi === waveCount - 1) list.push(pool.heavy);
      if (kind === 'elite' && wi === waveCount - 1) list.push('mimic');
      waves.push(list);
    }
    return waves;
  }

  _updateBattle(sdt, dt, players) {
    const b = this.battle;
    if (!b) return;

    // 進行
    if (b.state === 'intro') {
      b.stateT -= dt;
      if (b.stateT <= 0) {
        if (b.kind === 'boss') this._spawnBoss();
        else this._spawnWave();
        b.state = 'fighting';
      }
    } else if (b.state === 'fighting') {
      // スポーンキュー
      for (let i = b.spawnQueue.length - 1; i >= 0; i--) {
        const s = b.spawnQueue[i];
        s.delay -= sdt;
        if (s.delay <= 0) {
          this.spawnEnemy(s.type, s.x, s.y);
          b.spawnQueue.splice(i, 1);
        }
      }
      const remaining = this.enemies.filter((e) => e.alive && e.type !== 'shot').length +
        b.spawnQueue.length;
      const bossAlive = this.boss && this.boss.alive;
      if (!bossAlive && remaining === 0) {
        if (b.kind !== 'boss' && b.waveIndex < b.waves.length - 1) {
          b.waveIndex++;
          this._spawnWave();
        } else if (!this.enemies.some((e) => e.alive)) {
          b.state = 'clear';
          b.clearT = 1.6;
          this._onBattleClear();
        }
      }
    } else if (b.state === 'clear') {
      b.clearT -= dt;
      if (b.clearT <= 0 && !this.pickups.some((p) => p.alive)) {
        this._maybeLevelupThen();
        return;
      }
    }

    // エンティティ更新（スローモー時間）
    for (const e of this.enemies) e.update(sdt, this);
    this.enemies = this.enemies.filter((e) => e.alive);
    if (this.boss) this.boss.update(sdt, this);
    for (const bl of this.bolts) bl.update(sdt, this);
    this.bolts = this.bolts.filter((x) => x.alive);
    for (const s of this.shockwaves) s.update(sdt, this);
    this.shockwaves = this.shockwaves.filter((x) => x.alive);
    for (const br of this.barriers) br.update(sdt, this);
    this.barriers = this.barriers.filter((x) => x.alive);
    for (const pk of this.pickups) pk.update(sdt, this);
    this.pickups = this.pickups.filter((x) => x.alive);

    // コンボ
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // プレイヤーの攻撃
    this._updatePlayerCombat(sdt, dt, players);
  }

  get comboMult() {
    return clamp(1 + Math.floor(this.combo / 5), 1, CONFIG.combo.maxMultiplier);
  }

  _spawnWave() {
    const b = this.battle;
    const list = b.waves[b.waveIndex] || [];
    list.forEach((type, i) => {
      const { x, y } = this._spawnPos();
      b.spawnQueue.push({ type, x, y, delay: i * 0.18 });
    });
    if (b.waveIndex > 0) this.audio.waveStart();
  }

  _spawnPos() {
    // 端から出現（下端は避ける）
    const side = irange(0, 2);
    if (side === 0) return { x: range(60, this.w - 60), y: range(40, 130) };
    if (side === 1) return { x: range(30, 110), y: range(80, this.h * 0.7) };
    return { x: range(this.w - 110, this.w - 30), y: range(80, this.h * 0.7) };
  }

  spawnEnemy(type, x, y) {
    const e = spawnEnemyByType(type, x, y, this);
    this.enemies.push(e);
    return e;
  }

  _spawnBoss() {
    const bossKind = AREA_ENEMIES[this.areaTheme].boss;
    this.boss = new Boss(bossKind, this);
    this.addShake(14);
  }

  bossSummon(kind) {
    const pool = AREA_ENEMIES[this.areaTheme];
    const n = 2 + this.areaIndex;
    for (let i = 0; i < n; i++) {
      const { x, y } = this._spawnPos();
      this.spawnEnemy(pick(pool.basic), x, y);
    }
  }

  spawnShot(x, y, vx, vy, damage, rgb) {
    this.enemies.push(new EnemyShot(x, y, vx, vy, damage, rgb));
  }

  spawnShotAt(x, y, tx, ty, speed, damage, rgb) {
    const d = Math.max(1, dist(x, y, tx, ty));
    this.spawnShot(x, y, ((tx - x) / d) * speed, ((ty - y) / d) * speed, damage, rgb);
  }

  // --- プレイヤー攻撃 ---
  _updatePlayerCombat(sdt, dt, players) {
    for (const p of players) {
      if (!p.active) continue;
      const hero = this.run.hero(p.id);
      if (!hero || hero.downed) continue;

      const weapons = [
        { part: p.hands.left, kind: 'hand' },
        { part: p.hands.right, kind: 'hand' },
      ];
      if (hero.roleId === 'monk') {
        weapons.push({ part: p.feet.left, kind: 'foot' });
        weapons.push({ part: p.feet.right, kind: 'foot' });
      }

      for (const { part, kind } of weapons) {
        if (!part.present) continue;
        this._weaponVsEnemies(hero, p, part, kind, sdt);
      }

      // 拍手 → 衝撃波（+ 合体技判定）
      if (p.gestures.clapEdge) {
        this._clap(hero, p.center.x, p.center.y);
      }

      // 両手上げ → 必殺技
      if (p.gestures.armsRaisedEdge && this.gauge >= this.gaugeMax) {
        this._ultimate(hero);
      }

      // 図形詠唱（魔法使い: 円 / 陰陽師: 縦一線）
      if (hero.specialCd <= 0) {
        if (hero.roleId === 'mage') {
          for (const key of ['left', 'right']) {
            const c = detectCircle(p.paths[key], p.scale);
            if (c) {
              this._castFireball(hero, c.x, c.y, c.size);
              p.paths.left.length = 0; p.paths.right.length = 0;
              break;
            }
          }
        } else if (hero.roleId === 'onmyoji') {
          for (const key of ['left', 'right']) {
            const v = detectVStroke(p.paths[key], p.scale);
            if (v) {
              this._castBarrier(hero, v.x, v.y);
              p.paths.left.length = 0; p.paths.right.length = 0;
              break;
            }
          }
        }
      }
    }
  }

  _weaponVsEnemies(hero, player, part, kind, sdt) {
    const cfg = CONFIG.combat;
    const atk = this._atkOf(hero);
    const radius = part.radius * hero.mods.radius;
    const speed = Math.min(part.speed, cfg.speedCap);
    const slashNeed = (kind === 'foot' ? cfg.kickSpeed : cfg.slashSpeed) * hero.mods.slashEase;
    const ranged = isRanged(hero.roleId);

    const targets = this.boss && this.boss.alive && !this.boss.entering
      ? [...this.enemies, this.boss] : this.enemies;

    let slashed = false;
    for (const e of targets) {
      if (!e.alive || (e.telegraph ?? 0) > 0) continue;
      const d = dist(part.x, part.y, e.x, e.y);
      if (d > radius + e.radius) continue;

      // 接触 = 継続ダメージ
      const contact = (cfg.contactBaseDps + speed * cfg.speedDamageK) * atk * sdt;
      e.takeDamage(contact, this, { silent: true, heroKey: hero.key });

      // 斬撃 = 瞬間ダメージ（クールダウン付き）
      if (speed > slashNeed && part.hitCd <= 0) {
        let impulse = Math.min(speed * cfg.slashImpulseK, cfg.slashImpulseMax) * atk;
        if (kind === 'foot') impulse *= cfg.kickDamageMult * hero.mods.kick;
        e.takeDamage(impulse, this, {
          x: part.x, y: part.y, rgb: hero.colorRgb, heroKey: hero.key,
        });
        part.hitCd = cfg.handHitCooldown;
        slashed = true;
        this.particles.slashTrail(part.x, part.y, part.vx, part.vy, hero.colorRgb);
        if (kind === 'foot') {
          this.audio.kick();
          if (hero.mods.kickWave) {
            this._spawnShockwave(hero, part.x, part.y, cfg.clapRadius * 0.55,
              cfg.clapDamage * 0.5 * hero.mods.kick * atk);
          }
        } else {
          this.audio.slash();
        }
      }
    }

    // 遠隔ロール: 空振りの斬撃でも弾を放つ
    if (ranged && kind === 'hand' && speed > slashNeed && part.hitCd <= 0) {
      part.hitCd = cfg.handHitCooldown * 2.2;
      this._fireBolts(hero, part);
    } else if (slashed) {
      // 近接が命中した時は軌跡を強調
      this.particles.slashTrail(part.x, part.y, part.vx, part.vy, hero.colorRgb);
    }
  }

  _fireBolts(hero, part) {
    const rc = roleCfg(hero.roleId);
    const atk = hero.mods.atk * this.run.team.atk;
    const count = 1 + (hero.roleId === 'onmyoji' ? hero.mods.boltCount : 0);
    const kind = hero.roleId === 'onmyoji' ? 'fuda' : 'bolt';
    for (let i = 0; i < count; i++) {
      const tx = part.x + part.vx * 0.4 + range(-40, 40) * i;
      const ty = part.y + part.vy * 0.4 + range(-40, 40) * i;
      this.bolts.push(new FriendlyBolt(part.x, part.y, tx, ty,
        rc.boltDamage * atk, hero.colorRgb, hero.key, kind));
    }
    this.audio.bolt();
  }

  _clap(hero, x, y) {
    const cfg = CONFIG.combat;
    const dmg = cfg.clapDamage * hero.mods.clap * this._atkOf(hero);
    const radius = cfg.clapRadius * hero.mods.clapRadius;
    this._spawnShockwave(hero, x, y, radius, dmg);
    this.audio.clap();
    this.addShake(6);

    // 巫女なし構成なので、拍手に小さな回復はつけない（バランス用フック）

    // 合体技: 直前に別プレイヤーが近くで拍手していたら発動
    const lc = this._lastClap;
    if (lc && lc.key !== hero.key &&
        this._clock - lc.t < cfg.fusionWindow &&
        dist(lc.x, lc.y, x, y) < cfg.fusionDist) {
      const fx = (lc.x + x) / 2, fy = (lc.y + y) / 2;
      this._spawnShockwave(hero, fx, fy, cfg.fusionRadius,
        cfg.fusionDamage * this.run.team.atk);
      this.addBanner(T.fusion, '', 1.4, '#ffd23f');
      this.audio.fusion();
      this.addShake(16);
      this.screenFlash = { color: 'rgba(255,220,120,0.5)', life: 0.25, maxLife: 0.25 };
      this.gauge = Math.min(this.gaugeMax, this.gauge + 8);
      this._lastClap = null;
    } else {
      this._lastClap = { key: hero.key, x, y, t: this._clock };
    }
  }

  _spawnShockwave(hero, x, y, radius, damage) {
    this.shockwaves.push(new Shockwave(x, y, radius, damage, hero.colorRgb, hero.key));
    this.particles.ring(x, y, hero.colorRgb, { r: 10, growth: radius * 2.4, life: 0.5 });
  }

  _castFireball(hero, x, y, size = 0) {
    const rc = roleCfg('mage');
    const radius = rc.circleRadius * hero.mods.specialRadius * (size ? clamp(size / 260, 0.8, 1.5) : 1);
    const dmg = rc.circleDamage * hero.mods.special * hero.mods.atk * this.run.team.atk;
    hero.specialCd = rc.circleCooldown * hero.mods.specialCd;
    this.audio.sigil();
    this.audio.explosion(0.9);
    this.addShake(10);
    this.particles.explosion(x, y, '255,150,60', 1.6);
    this.particles.ring(x, y, '255,180,80', { r: 20, growth: radius * 2.2, life: 0.5, width: 6 });
    const targets = this.boss && this.boss.alive && !this.boss.entering
      ? [...this.enemies, this.boss] : this.enemies;
    for (const e of targets) {
      if (!e.alive || (e.telegraph ?? 0) > 0) continue;
      if (dist(x, y, e.x, e.y) < radius + e.radius) {
        e.takeDamage(dmg, this, { x: e.x, y: e.y, rgb: '255,150,60', heroKey: hero.key });
      }
    }
    this.addFloat(x, y - 40, T.skills.s_fire.name, '#ffb04d', 1.2, 24);
  }

  _castBarrier(hero, x, y) {
    const rc = roleCfg('onmyoji');
    hero.specialCd = rc.barrierCooldown * hero.mods.specialCd;
    this.barriers.push(new Barrier(x, y, rc.barrierRadius,
      rc.barrierDuration * hero.mods.barrierDur, rc.barrierDps * hero.mods.atk * this.run.team.atk,
      '140,255,190', hero.key));
    this.audio.sigil();
    this.audio.barrier();
    this.addFloat(x, y - 40, T.skills.s_kekkai.name.replace('延長', ''), '#8bffb0', 1.2, 24);
  }

  _ultimate(hero) {
    if (this.gauge < this.gaugeMax) return;
    this.gauge = 0;
    const cfg = CONFIG.ultimate;
    this.timeScale = cfg.slowmo;
    this._slowmoT = cfg.duration;
    this._ultT = cfg.duration;
    this._ultHero = hero.key;
    this.audio.ultimate();
    this.addShake(20);
    this.screenFlash = { color: `rgba(${hero.colorRgb},0.5)`, life: 0.4, maxLife: 0.4 };
    this.addBanner(T.roles[hero.roleId].ult, '', 2.0, hero.color);

    for (const e of [...this.enemies]) {
      if (!e.alive) continue;
      this.particles.explosion(e.x, e.y, hero.colorRgb, 0.8);
      e.takeDamage(cfg.damage, this, { x: e.x, y: e.y, rgb: hero.colorRgb, heroKey: hero.key });
    }
    if (this.boss && this.boss.alive && !this.boss.entering) {
      this.boss.takeDamage(cfg.bossDamage, this, { x: this.boss.x, y: this.boss.y, rgb: hero.colorRgb, heroKey: hero.key });
      this.particles.explosion(this.boss.x, this.boss.y, hero.colorRgb, 1.6);
    }
    // 星が降り注ぐ演出
    for (let i = 0; i < 40; i++) {
      this.particles.starfall(range(0, this.w), range(-100, this.h * 0.4), hero.colorRgb);
    }
  }

  // --- 敵側からのコールバック ---
  onEnemyDamaged(e, dmg, info) {
    const heroGain = info.heroKey != null;
    if (heroGain) {
      const hero = this.run.hero(info.heroKey);
      if (hero) {
        // ゲージ・吸魂
        this.gauge = Math.min(this.gaugeMax,
          this.gauge + dmg * CONFIG.ultimate.gainPerDamage * hero.mods.gauge * this.run.team.gaugeRate);
        if (hero.mods.leech > 0) this.healHero(hero, dmg * hero.mods.leech);
      }
    }
  }

  onEnemyKilled(e, info = {}) {
    const c = e.cfg || CONFIG.enemies.shot;
    // スコア・コンボ
    this.combo++;
    this.comboTimer = CONFIG.combo.window;
    const score = Math.round((c.score || 0) * this.comboMult);
    this.run.score += score;
    if (e.type !== 'shot') {
      this.run.addXp(c.xp || 0);
      this.gauge = Math.min(this.gaugeMax, this.gauge + CONFIG.ultimate.gainPerKill);
      this.particles.explosion(e.x, e.y, e.rgb, e.radius / 26);
      this.audio.explosion(clamp(e.radius / 40, 0.3, 1));
      this.addFloat(e.x, e.y - 20, `+${score}`, '#fff', 0.8, 16);
      if (info.heroKey != null) {
        const hero = this.run.hero(info.heroKey);
        if (hero) hero.kills++;
      }
      // ドロップ
      const dropRate = CONFIG.pickup.soulChance * this.run.team.dropRate;
      if (chance(Math.min(0.95, dropRate))) {
        this.pickups.push(new Pickup('soul', e.x, e.y, irange(...CONFIG.pickup.soulValue)));
      }
      if (chance(CONFIG.pickup.healChance)) {
        this.pickups.push(new Pickup('heal', e.x, e.y, CONFIG.pickup.healAmount));
      }
    }
  }

  onBossPhase(boss) {
    this.addShake(12);
    this.audio.bossRoar();
    this.screenFlash = { color: 'rgba(255,120,120,0.4)', life: 0.3, maxLife: 0.3 };
    this.addBanner(`${T.bossNames[boss.kind]}が怒っている…！`, '', 1.6, '#ff8080');
  }

  onBossKilled(boss) {
    const c = boss.cfg;
    this.run.score += c.score;
    this.run.addXp(c.xp);
    this.audio.explosion(1);
    this.audio.victory();
    this.addShake(24);
    this.screenFlash = { color: 'rgba(255,255,255,0.7)', life: 0.5, maxLife: 0.5 };
    for (let i = 0; i < 5; i++) {
      setTimeout(() => this.particles.explosion(
        boss.x + range(-boss.radius, boss.radius),
        boss.y + range(-boss.radius, boss.radius), boss.rgb, 1.5), i * 120);
    }
    // 魂を大放出
    const n = 8 + this.areaIndex * 4;
    for (let i = 0; i < n; i++) {
      this.pickups.push(new Pickup('soul', boss.x + range(-80, 80), boss.y + range(-40, 40),
        irange(...CONFIG.pickup.soulValue)));
    }
    this.addBanner(T.battleClear, '', 2.0, '#ffd23f');
  }

  _onBattleClear() {
    const [a, b] = CONFIG.pickup.clearBonus;
    this.run.souls += irange(a, b);
    if (this.battle.kind !== 'boss') this.addBanner(T.battleClear, '', 1.4, '#7CFF6B');
    this.audio.waveStart();
    // 生き残った弾は消す
    for (const e of this.enemies) if (e.type === 'shot') e.alive = false;
  }

  // --- 魂・回復玉の回収 ---
  _collectPickups(players) {
    const cfg = CONFIG.pickup;
    for (const pk of this.pickups) {
      if (!pk.alive) continue;
      for (const p of players) {
        if (!p.active) continue;
        const hero = this.run ? this.run.hero(p.id) : null;
        if (!hero || hero.downed) continue;
        const magnet = cfg.magnetRadius * hero.mods.magnet * this.run.team.magnet;
        for (const key of ['left', 'right']) {
          const hand = p.hands[key];
          if (!hand.present) continue;
          const d = dist(hand.x, hand.y, pk.x, pk.y);
          if (d < hand.radius + cfg.radius) {
            pk.alive = false;
            if (pk.kind === 'soul') {
              this.run.souls += pk.value;
              this.audio.coin();
              this.addFloat(pk.x, pk.y, `+${pk.value}`, '#9adcff', 0.8, 16);
            } else {
              this.healHero(hero, pk.value);
              this.audio.heal();
            }
            this.particles.glow(pk.x, pk.y, pk.kind === 'soul' ? '120,220,255' : '120,255,160', {});
            break;
          } else if (d < magnet + cfg.radius) {
            // 吸い寄せ
            pk.x += (hand.x - pk.x) * 6 * 0.016;
            pk.y += (hand.y - pk.y) * 6 * 0.016;
          }
        }
        if (!pk.alive) break;
      }
    }
  }

  // ===========================================================
  //  手かざしUI（ホットスポット）
  // ===========================================================

  _buildHotspots() {
    const hs = [];
    const w = this.w, h = this.h;
    const add = (o) => { hs.push({ progress: 0, enabled: true, owner: null, ...o }); };

    switch (this.phase) {
      case 'title': {
        add({
          id: 'start', kind: 'start',
          x: w / 2, y: h * 0.72, r: 110,
          label: T.pressStart,
          action: () => this._enterRoleSelect(),
        });
        break;
      }
      case 'roleSelect': {
        const n = ROLE_IDS.length;
        ROLE_IDS.forEach((roleId, i) => {
          const cw = Math.min(300, (w - 120) / n);
          const x = w / 2 + (i - (n - 1) / 2) * (cw + 24);
          add({
            id: `role_${roleId}`, kind: 'role', roleId,
            x, y: h * 0.5, rw: cw / 2, rh: h * 0.21,
            label: T.roles[roleId].name,
            perPlayer: true, // プレイヤーごとに選択できる
            action: (playerKey) => {
              this.roleClaims.set(playerKey ?? 'solo', roleId);
              this.audio.select();
            },
          });
        });
        break;
      }
      case 'gateStart': {
        ['wa', 'west'].forEach((realm, i) => {
          add({
            id: `realm_${realm}`, kind: 'gate', theme: realm,
            x: w * (0.32 + i * 0.36), y: h * 0.52, rw: w * 0.14, rh: h * 0.26,
            label: T.areas[realm].name, sub: T.areas[realm].sub,
            action: () => this._startFirstArea(realm),
          });
        });
        break;
      }
      case 'map': {
        const nodes = this.run.reachableNodes();
        const layout = this._mapLayout();
        for (const node of nodes) {
          const pos = layout(node.layer, node.index, this.run.area.map.layers[node.layer].length);
          add({
            id: `node_${node.layer}_${node.index}`, kind: 'node', node,
            x: pos.x, y: pos.y, r: 64,
            label: T.nodes[node.type],
            action: () => this._enterNode(node),
          });
        }
        break;
      }
      case 'levelup': {
        const heroes = this.run.heroList;
        const cols = heroes.length;
        heroes.forEach((hero, hi) => {
          const colW = w / Math.max(1, cols);
          const cx = colW * (hi + 0.5);
          const choices = this.levelup.choices.get(hero.key) || [];
          choices.forEach((skill, si) => {
            add({
              id: `lv_${hero.key}_${si}`, kind: 'skill', hero, skill,
              x: cx, y: h * (0.34 + si * 0.2), rw: Math.min(210, colW * 0.44), rh: h * 0.085,
              label: T.skills[skill.id].name, sub: T.skills[skill.id].desc,
              owner: hero.key,
              action: () => {
                if (this.levelup && !this.levelup.picked.has(hero.key)) {
                  this._applySkill(hero, skill);
                }
              },
            });
          });
        });
        break;
      }
      case 'shop': {
        this.shopStock.forEach((stock, i) => {
          add({
            id: `shop_${stock.id}`, kind: 'shopItem', stock,
            x: w * (0.2 + i * 0.2), y: h * 0.48, rw: w * 0.085, rh: h * 0.17,
            label: T.shopItems[stock.id].name, sub: T.shopItems[stock.id].desc,
            enabled: !stock.sold,
            action: () => this._buyItem(stock),
          });
        });
        add({
          id: 'shop_leave', kind: 'leave',
          x: w / 2, y: h * 0.84, r: 80,
          label: T.shopLeave,
          action: () => this._nodeCleared(),
        });
        break;
      }
      case 'rest': {
        add({
          id: 'rest_leave', kind: 'leave',
          x: w / 2, y: h * 0.82, r: 80,
          label: T.continueHint,
          action: () => this._nodeCleared(),
        });
        break;
      }
      case 'treasure': {
        if (!this.treasureOpened) {
          add({
            id: 'chest', kind: 'chest',
            x: w / 2, y: h * 0.55, r: 110,
            label: T.treasureOpen,
            action: () => this._openTreasure(),
          });
        } else {
          add({
            id: 'chest_leave', kind: 'leave',
            x: w / 2, y: h * 0.84, r: 80,
            label: T.continueHint,
            action: () => this._nodeCleared(),
          });
        }
        break;
      }
      case 'gate': {
        const routes = ['bounty', 'peril', 'calm'];
        routes.forEach((route, i) => {
          add({
            id: `gate_${route}`, kind: 'gate', route,
            x: w * (0.22 + i * 0.28), y: h * 0.52, rw: w * 0.11, rh: h * 0.24,
            label: T.routes[route].name, sub: T.routes[route].desc,
            action: () => this._chooseGate(route),
          });
        });
        break;
      }
      case 'gameover':
      case 'victory': {
        add({
          id: 'retry', kind: 'start',
          x: w / 2, y: h * 0.82, r: 100,
          label: this.phase === 'victory' ? T.pressStart : T.gameoverSub,
          action: () => this._reset(),
        });
        break;
      }
      default: break;
    }
    this.hotspots = hs;
  }

  // マップノードの画面配置（hud も同じ計算を使う）
  _mapLayout() {
    const w = this.w, h = this.h;
    const layers = this.run.area.map.layers.length;
    return (layer, index, count) => ({
      x: w * (0.14 + (layer / Math.max(1, layers - 1)) * 0.72),
      y: h * (count <= 1 ? 0.5 : 0.3 + (index / (count - 1)) * 0.4),
    });
  }

  _insideHotspot(hs, x, y) {
    if (hs.r != null) return dist(x, y, hs.x, hs.y) < hs.r;
    return Math.abs(x - hs.x) < hs.rw && Math.abs(y - hs.y) < hs.rh;
  }

  _fireHotspot(hs, playerKey = null) {
    hs.progress = 0;
    hs.action(playerKey);
  }

  _updateHotspots(dt, players) {
    if (!this.hotspots.length) return;
    const dwell = CONFIG.ui.dwellTime;
    for (const hs of this.hotspots) {
      if (!hs.enabled) { hs.progress = 0; continue; }
      let hovered = false;
      let hoverKey = null;
      for (const p of players) {
        if (!p.active) continue;
        if (hs.owner != null && p.id !== hs.owner) continue;
        for (const key of ['left', 'right']) {
          const hand = p.hands[key];
          if (hand.present && this._insideHotspot(hs, hand.x, hand.y)) {
            hovered = true; hoverKey = p.id;
          }
        }
      }
      if (hovered) {
        hs.progress += dt / dwell;
        hs.hoverKey = hoverKey;
        if (hs.progress >= 1) {
          if (hs.perPlayer) {
            // ロール選択: プレイヤーごとに選ばせて、選び直しも可能
            hs.action(hoverKey);
            hs.progress = 0;
          } else {
            this._fireHotspot(hs, hoverKey);
          }
        }
      } else {
        hs.progress = Math.max(0, hs.progress - dt * CONFIG.ui.dwellDecay / dwell);
        hs.hoverKey = null;
      }
    }
  }

  // ===========================================================
  //  演出ヘルパ
  // ===========================================================

  addShake(amount) { this.shake = Math.min(30, this.shake + amount); }

  addFloat(x, y, text, color, life = 1, size = 18) {
    this.floaters.push({ x, y, text, color, life, maxLife: life, size });
    if (this.floaters.length > 40) this.floaters.shift();
  }

  addBanner(text, sub, life, color = '#fff') {
    this.banner = { text, sub, life, maxLife: life, color };
  }

  // ===========================================================
  //  デバッグ / CI 用ヘルパ
  // ===========================================================

  // ロール選択などを飛ばしてランを開始する（CIシミュレーション用）
  debugStartRun(roles = ['kenshi'], realm = 'wa') {
    this.run = new RunState(12345);
    roles.forEach((roleId, i) => {
      const color = CONFIG.hero.colors[i % CONFIG.hero.colors.length];
      const hero = this.run.addHero(i, roleId, color, hexRgbCached(color));
      hero.x = this.w * (0.3 + i * 0.2); hero.y = this.h * 0.6; hero.seen = true;
    });
    this.run.startFirstArea(realm);
    this.phase = 'map';
    this._buildHotspots();
  }

  debugHotspot(idPrefix) {
    return this.hotspots.find((hs) => hs.enabled && hs.id.startsWith(idPrefix)) || null;
  }
}

// 色変換の小さなキャッシュ（World 内専用）
const _rgbCache = new Map();
function hexRgbCached(hex) {
  let v = _rgbCache.get(hex);
  if (!v) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
    v = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    _rgbCache.set(hex, v);
  }
  return v;
}
