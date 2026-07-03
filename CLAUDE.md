# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要 / What this is

『あやかしとドラゴン — AYAKASHI & DRAGONS』: プロジェクター投影 + Webカメラで全身を動かして遊ぶ**協力型ローグライト・アクションRPG**（最大4人）。
**ビルド不要のバニラ JavaScript (ES Modules)**。MediaPipe 一式を `vendor/` に同梱し、**完全オフライン**で動作する。
姉妹リポジトリ `projector-adventure`（星守の夜）と同じ基盤（server.py / 入力抽象化 / CIハーネス）を共有している。

## 実行 / Run

- 起動: `./start.sh`（Unix/WSL）/ `start.bat`（Windows）/ `python3 server.py`。ブラウザが自動で `http://localhost:8000/` を開く。
- **ビルド・lint のステップは無い**（バンドラ無し）。コードを編集したらブラウザを再読込するだけ。
- 環境変数: `PORT=8080`、`HTTPS=1`（自己署名TLS）、`HOST=...`（既定 `0.0.0.0`）。
- `index.html` を `file://` で直接開いてはいけない。getUserMedia と ES Modules がローカルサーバーを要求する。
- `server.py` は MIME（`.mjs`/`.js`/`.wasm`）と COOP/COEP ヘッダ（WASMスレッド有効化）を担う。単純な `python -m http.server` では動かない。
- GitHub Pages 配信ではヘッダを設定できないため `coi-serviceworker.js` が COOP/COEP を付与する（server.py 経由では何もしない）。

### テスト / CI
- ローカル/CI 共通: `pip install playwright && python -m playwright install --with-deps chromium && python3 test/ci_test.py`
- `test/ci_test.py` は server.py を起動し、(1) フェイクカメラで実アプリを起動して実UI（キー/クリック）で戦闘まで進行、(2) `world.js` を直接 import して**勝利までフル進行**（和→洋→混沌 / 3ボス / レベルアップ / ショップ）、(3) 単体検証（鬼の接触耐性・スライム分裂・図形認識・魂回収・ガード・ジャスト回避・蘇生・宝箱）。
- **ヘッドレス環境では姿勢認識が重く実質数fps**になるため、実UIテストは固定待ちではなく `wait_for_function` で状態遷移を待つこと。
- `.github/workflows/ci.yml`: `syntax`（node --check）→ `browser`（ci_test.py）→ `deploy`（main のみ、GitHub Pages）。
- ランタイム状態は `window.__dbg`（phase/heroes/enemies/area/level/souls/hotspots...）と `window.__world`（World インスタンスそのもの、デバッグ用フック）から読める。

## アーキテクチャ / Big picture

データの流れは **入力 → ワールド更新 → 描画** の一方向。`src/main.js` がループを所有:

1. `InputManager.update()` → `players[]`（統一フォーマットの「勇者」配列）
2. `World.update(dt, players)` → 状態機械 + 戦闘 + 手かざしUI
3. `Renderer.render(world, players, video, info, dt)` → Canvas 描画

`processFallbackEdges` は**カメラモード中も毎フレーム呼ばれる**（操作者がマウスでメニューを進められる）。

### 入力の抽象化（`src/input/`）
- `vision.js` — MediaPipe PoseLandmarker（複数人）。vendorバンドルは動的 `import()`、失敗時は自動フォールバック。
- `fallback.js` — マウス/キー/タッチ。`consumePrimary/consumeClap/consumeSpecial` の消費型エッジ + `guard` 状態。
- `gestures.js` (`PlayerTracker`) — 平滑化・速度・ジェスチャー検出。`player` は adventure の形に加え **`feet`（蹴り用）/ `center.speed`（ジャスト回避用）/ `gestures.guard` / `paths`（図形詠唱用の手の軌跡 {x,y,t}[]）** を持つ。位置オブジェクトはフレーム間で再利用される（`hitCd` を World が書き戻す）。
- `inputManager.js` — モード切替、人物ごとの `PlayerTracker`。

### ゲームロジック（`src/game/`）
- `world.js` — 中心。状態機械 `title/roleSelect/gateStart/map/battle/levelup/shop/rest/treasure/gate/gameover/victory`。**手かざしUI = `hotspots`**（`_buildHotspots()` がフェーズごとに構築、手のかざし続け or クリックで `action()` 発火。`owner` でプレイヤー限定、レベルアップの3択に使用）。戦闘は接触=継続ダメージ / 高速=斬撃、拍手=衝撃波（2人同時=合体技）、ガード、ジャスト回避（`center.speed` で判定、剣士はカウンター）、図形詠唱（魔法使い=円、陰陽師=縦一線 → `roles.js` の `detectCircle/detectVStroke`）、必殺技（両手上げ+ゲージ満タン）。ヒーローは個別HP、戦闘不能→仲間の手かざしで蘇生、全滅でゲームオーバー。途中参加は `_syncHeroes` が自動でヒーロー化。
- `run.js` (`RunState`) — ラン状態: 分岐マップ生成（Slay the Spire型、ルート補正 bounty/peril/calm）、エリア進行（和→洋→混沌、開始領域は選択制）、チームXP/レベル、魂（通貨）、遺物、`team` 補正、`heroes` Map（key = player.id）。
- `entities.js` — 敵は `Enemy` 基底（出現テレグラフ→接近→予備動作→攻撃）。和: 提灯お化け/からかさ/鬼（接触耐性）/鬼火、洋: スライム（分裂）/ゴブリン/ガーゴイル/ミミック（エリート）。`Boss`（tengu/lich/dragon、フェーズ制）、`EnemyShot`（手で消せる・結界で防げる）、`FriendlyBolt`（遠隔ロールの弾）、`Shockwave`、`Barrier`、`Pickup`（魂/回復）。
- `roles.js` — ロール定義と図形認識。`skills.js` — レベルアップ3択（汎用+ロール固有）と `hero.mods`。
- `config.js` — **全チューニング値の集約点**。`i18n.js` — 日本語文言（新規UI文字列はここへ）。

### 描画（`src/render/`）
- `renderer.js` — レイヤー統括 + 勇者オーラ（ダウン時は蘇生リング、ガード時は盾、詠唱ロールは軌跡表示）。
- `background.js` — テーマ別夜景（オフスクリーン事前描画）。`hud.js` — 全フェーズのUI + ホットスポット描画。`particles.js` — 加算合成（adventure と同一）。

## 改修時の注意 / Conventions
- **座標系**: スクリーンpx、原点左上、鏡映済み（プレイヤーが見たまま）。
- **時間**: `World.update` はスローモー中 `sdt = dt * timeScale` でゲームを進め、UI/演出は実時間 `dt`。新規ゲーム要素は `sdt` 側に。
- **新しい敵**: `entities.js` にクラス追加 → `config.enemies` に数値 → `spawnEnemyByType` と `run.js` の `AREA_ENEMIES` に組込む。
- **新スキル**: `skills.js` に定義 + `i18n.js` の `skills` に文言。`hero.mods` を増やす場合は `makeMods()` に初期値。
- **新フェーズ/画面**: world の `_buildHotspots()` と hud の `draw` switch の両方に追加。
- **音**: `audio.js` のプロシージャル合成で（外部音源を足さない方針）。
- **CSSの落とし穴**: `#error-overlay[hidden]{display:none}` を消さない（UAの `[hidden]` と ID セレクタの優先度問題）。
- ヒーローの同一性は `player.id`（= 認識インデックス）。人が入れ替わるとビルドも入れ替わるが仕様として許容。
