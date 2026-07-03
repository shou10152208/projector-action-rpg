#!/usr/bin/env python3
"""CI 用のヘッドレス統合テスト（あやかしとドラゴン）。

やること:
  1. server.py を起動
  2. Playwright + ヘッドレス Chromium で:
     - index.html を起動し window.__dbg が出る（＝メインループが回っている）か
     - タイトル → ロール選択 → 世界選択 → マップ → 戦闘 と実UIで進むか
     - ゲームロジックを直接 import してフル進行をシミュレートし、
       和 → 洋 → 混沌 / 大天狗 → リッチ王 → 妖竜 → 勝利 まで到達するか
     - 単体検証（鬼の接触耐性 / スライム分裂 / 図形認識 / 魂回収 /
       ガード / ジャスト回避 / 戦闘不能と蘇生・途中参加）
  失敗があれば終了コード 1。

ローカル実行:
    pip install playwright && python -m playwright install --with-deps chromium
    python3 test/ci_test.py
"""
import asyncio
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("CI_PORT", "8000"))
BASE = f"http://localhost:{PORT}"

# ページ内でモジュールを import して進行を検証する（ブラウザのJSエンジン上で実行）
SIM_JS = r"""
async () => {
  const { World } = await import('/src/game/world.js');
  const { Oni, Slime, Pickup, spawnEnemyByType } = await import('/src/game/entities.js');
  const { detectCircle, detectVStroke } = await import('/src/game/roles.js');
  const particles = new Proxy({ list: [] }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const audio = new Proxy({}, { get: () => () => {} });
  const out = { checks: [] };
  const check = (name, ok, detail = '') => out.checks.push({ name, ok: !!ok, detail: String(detail) });
  const hs = (w, prefix) => w.hotspots.find((h) => h.enabled && h.id.startsWith(prefix));

  // ============ 単体検証 ============
  {
    const w = new World(particles, audio);
    w.resize(1280, 720);
    w.debugStartRun(['kenshi'], 'wa');
    w.phase = 'battle';

    // 鬼: 接触ダメージ軽減（斬撃は等倍）
    const oni = new Oni(400, 200, w);
    oni.telegraph = 0;
    const hp0 = oni.hp;
    oni.takeDamage(10, w, { silent: true });
    const contact = hp0 - oni.hp;
    const mid = oni.hp;
    oni.takeDamage(10, w, {});
    check('oni: 接触ダメージ軽減', Math.abs(contact - 2) < 1e-6, `contact=${contact}`);
    check('oni: 斬撃は等倍', Math.abs((mid - oni.hp) - 10) < 1e-6, `slash=${mid - oni.hp}`);

    // スライム: 分裂
    const sl = new Slime(600, 300, w);
    sl.telegraph = 0;
    w.enemies.push(sl);
    const n0 = w.enemies.length;
    sl.takeDamage(99999, w, {});
    const kids = w.enemies.filter((e) => e.type === 'slime' && e.gen === 1 && e.alive).length;
    check('slime: 倒すと分裂', kids === 2, `kids=${kids} n0=${n0}`);

    // 図形認識: 円
    const circle = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      circle.push({ x: 500 + Math.cos(a) * 120, y: 400 + Math.sin(a) * 120, t: i * 0.04 });
    }
    check('roles: 円を認識', !!detectCircle(circle, 220));
    // 図形認識: 縦一線
    const stroke = [];
    for (let i = 0; i <= 10; i++) stroke.push({ x: 300 + (Math.random() - 0.5) * 8, y: 200 + i * 30, t: i * 0.05 });
    check('roles: 縦一線を認識', !!detectVStroke(stroke, 220));
    // 誤検出しない: 横振り
    const swipe = [];
    for (let i = 0; i <= 10; i++) swipe.push({ x: 200 + i * 40, y: 400, t: i * 0.05 });
    check('roles: 横振りは詠唱にならない', !detectCircle(swipe, 220) && !detectVStroke(swipe, 220));

    // 魂の回収
    const pk = new Pickup('soul', 500, 400, 3);
    w.pickups.push(pk);
    const hero = w.run.hero(0);
    const player = { active: true, id: 0, color: '#fff', colorRgb: '255,255,255',
      hands: { left: { present: false }, right: { present: true, x: 500, y: 400, radius: 46 } } };
    const souls0 = w.run.souls;
    w._collectPickups([player]);
    check('pickup: 魂を回収できる', !pk.alive && w.run.souls === souls0 + 3, `souls=${w.run.souls}`);

    // ガード: 被ダメージ軽減
    hero.x = 640; hero.y = 400; hero.seen = true;
    hero.guarding = true; hero.invuln = 0; hero.centerSpeed = 0;
    const hpA = hero.hp;
    w.damageHero(0, 20, {});
    const guarded = hpA - hero.hp;
    check('hero: ガードで被ダメ軽減', Math.abs(guarded - 5) < 1e-6, `dmg=${guarded}`);

    // ジャスト回避: 素早く動いていればノーダメージ
    hero.guarding = false; hero.invuln = 0; hero.centerSpeed = 9999;
    const hpB = hero.hp;
    w.damageHero(0, 30, {});
    check('hero: ジャスト回避', hero.hp === hpB && w.timeScale < 1, `hp=${hero.hp} ts=${w.timeScale}`);

    // 戦闘不能 → 仲間の手かざしで蘇生（+途中参加）
    w.timeScale = 1; w._slowmoT = 0;
    hero.invuln = 0; hero.centerSpeed = 0; hero.hp = 1;
    w.damageHero(0, 999, {});
    check('hero: 戦闘不能になる', hero.downed && w.phase === 'gameover' === false ? hero.downed : hero.downed, `downed=${hero.downed} phase=${w.phase}`);
    // 全滅で gameover になっているはず（1人パーティ）
    check('hero: 全滅でゲームオーバー', w.phase === 'gameover', `phase=${w.phase}`);

    // 蘇生テスト用に2人パーティで作り直す
    const w2 = new World(particles, audio);
    w2.resize(1280, 720);
    w2.debugStartRun(['kenshi', 'mage'], 'wa');
    w2.phase = 'battle';
    const h0 = w2.run.hero(0);
    h0.x = 400; h0.y = 400; h0.seen = true;
    h0.invuln = 0; h0.centerSpeed = 0; h0.hp = 1;
    w2.damageHero(0, 999, {});
    check('hero: 仲間が残れば続行', h0.downed && w2.phase === 'battle', `phase=${w2.phase}`);
    const helper = {
      active: true, id: 1, color: '#ff5cc8', colorRgb: '255,92,200', scale: 220,
      center: { x: 420, y: 420, speed: 0 }, gestures: { guard: false },
      hands: { left: { present: true, x: 400, y: 400 }, right: { present: false } },
      feet: { left: { present: false }, right: { present: false } },
    };
    for (let i = 0; i < 60 && h0.downed; i++) w2._syncHeroes(0.1, [helper]);
    check('hero: 手かざしで蘇生', !h0.downed && h0.hp > 0, `hp=${h0.hp}`);

    // 宝箱: 開けると遺物がもらえてチーム補正に反映される
    const atk0 = w2.run.team.atk;
    w2._enterTreasure();
    w2._openTreasure();
    check('treasure: 遺物を入手', w2.run.relics.length === 1, w2.run.relics.join(','));
    check('treasure: 補正が反映される',
      JSON.stringify(w2.run.team) !== JSON.stringify({ atk: atk0, def: 1, magnet: 1, gaugeRate: 1, dodgeWindow: 1, reviveSpeed: 1, dropRate: 1 })
      || w2.run.team.atk !== atk0, '');
  }

  // ============ フル進行シミュレーション ============
  const w = new World(particles, audio);
  w.resize(1280, 720);
  w.debugStartRun(['kenshi', 'mage', 'monk', 'onmyoji'], 'wa');

  const dt = 1 / 30;
  let t = 0;
  const themes = new Set();
  const bosses = new Set();
  const nodeTypes = new Set();
  let boughtItem = false, gotRelic = false, levelups = 0, soulsSeen = false;

  while (!['victory', 'gameover'].includes(w.phase) && t < 1200) {
    // ヒーローは無敵化して進行だけを確認する
    for (const h of w.run.heroList) { h.invuln = 99; if (h.downed) { h.downed = false; h.hp = h.maxHp; } }

    w.update(dt, []);
    t += dt;

    if (w.phase === 'map') {
      themes.add(w.areaTheme);
      // ボスノードを優先しつつ未踏のタイプも踏む
      const nodes = w.hotspots.filter((h) => h.enabled && h.kind === 'node');
      if (nodes.length) {
        const fresh = nodes.find((n) => !nodeTypes.has(n.node.type));
        (fresh || nodes[0]).action();
      }
    } else if (w.phase === 'battle') {
      const node = w.run.currentNode;
      if (node) nodeTypes.add(node.type);
      if (w.boss && w.boss.alive) {
        bosses.add(w.boss.kind);
        if (!w.boss.entering) w.boss.takeDamage(900 * dt * 30, w, { x: w.boss.x, y: w.boss.y, heroKey: 0 });
      }
      for (const e of [...w.enemies]) {
        if (e.alive && e.telegraph <= 0) e.takeDamage(99999, w, { heroKey: 0 });
      }
      if (w.run.souls > 0) soulsSeen = true;
      for (const pk of w.pickups) pk.alive = false; // 回収の代わりに消す
    } else if (w.phase === 'levelup') {
      levelups++;
      for (const h of w.hotspots) {
        if (h.kind === 'skill') h.action();
      }
    } else if (w.phase === 'shop') {
      if (!boughtItem) {
        w.run.souls += 200;
        const item = hs(w, 'shop_potion') || w.hotspots.find((h) => h.enabled && h.kind === 'shopItem');
        if (item) { item.action(); boughtItem = !item.stock || item.stock.sold; }
      }
      const leave = hs(w, 'shop_leave');
      if (leave) leave.action();
    } else if (w.phase === 'rest') {
      const leave = hs(w, 'rest_leave');
      if (leave && w.restT > 0.3) leave.action();
    } else if (w.phase === 'treasure') {
      const chest = hs(w, 'chest');
      if (chest && chest.kind === 'chest') { chest.action(); gotRelic = w.run.relics.length > 0 || w.treasureOpened === 'souls'; }
      const leave = hs(w, 'chest_leave');
      if (leave) leave.action();
    } else if (w.phase === 'gate') {
      const gate = hs(w, 'gate_peril') || hs(w, 'gate_');
      if (gate) gate.action();
    }
  }

  check('sim: 勝利までフル進行', w.phase === 'victory', `phase=${w.phase} t=${t.toFixed(0)}s area=${w.areaIndex}`);
  check('sim: 3エリアを踏破 (和→洋→混沌)', themes.has('wa') && themes.has('west') && themes.has('chaos'),
    [...themes].join(','));
  check('sim: 3ボスと交戦', bosses.has('tengu') && bosses.has('lich') && bosses.has('dragon'),
    [...bosses].join(','));
  check('sim: レベルアップでスキル取得', levelups > 0 && w.run.level > 1, `levelups=${levelups} lv=${w.run.level}`);
  check('sim: 魂がドロップ', soulsSeen);
  check('sim: ショップで購入', boughtItem);
  check('sim: スコア加算', w.run.score > 0, `score=${w.run.score}`);
  return out;
}
"""


def wait_for_server(url, timeout=20):
    for _ in range(int(timeout * 5)):
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False


async def run():
    from playwright.async_api import async_playwright

    failures = []
    exe = os.environ.get("PLAYWRIGHT_CHROMIUM_PATH")
    launch_kwargs = dict(
        args=[
            "--no-sandbox",
            "--disable-gpu",
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
        ]
    )
    if exe:
        launch_kwargs["executable_path"] = exe

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(**launch_kwargs)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 720})

        # 1) 実アプリ起動 → 実UI（キー/クリック）で戦闘まで進む
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(f"{BASE}/index.html")
        await page.wait_for_function("window.__dbg !== undefined", timeout=30000)
        dbg = await page.evaluate("window.__dbg")
        print(f"[boot] phase={dbg['phase']} mode={dbg['mode']}")
        if dbg["phase"] != "title":
            failures.append(f"boot: phase={dbg['phase']}")

        # ヘッドレス環境では姿勢認識が重く低fpsになるため、
        # 固定待ちではなく状態遷移を条件で待つ。
        async def wait_phase(cond, label, timeout=60000):
            try:
                await page.wait_for_function(f"window.__dbg && ({cond})", timeout=timeout)
                dbg2 = await page.evaluate("window.__dbg")
                print(f"[flow] {label}: phase={dbg2['phase']}")
                return True
            except Exception:
                dbg2 = await page.evaluate("window.__dbg")
                failures.append(f"flow: {label} に到達しない ({dbg2})")
                print(f"[flow] FAIL {label}: {dbg2}")
                return False

        await page.keyboard.press("Space")   # タイトル → ロール選択
        ok = await wait_phase("__dbg.phase === 'roleSelect'", "roleSelect")
        if ok:
            await page.keyboard.press("Space")   # おまかせ開始 → 世界選択
            ok = await wait_phase("__dbg.phase === 'gateStart'", "gateStart")
        if ok:
            await page.mouse.click(int(1280 * 0.32), int(720 * 0.52))  # 和の霊峰の門
            ok = await wait_phase("__dbg.phase === 'map'", "map")
        if ok:
            await page.mouse.click(int(1280 * 0.14), int(720 * 0.5))   # 最初のノード
            ok = await wait_phase("__dbg.phase === 'battle' && __dbg.enemies > 0", "battle+敵出現", 90000)
        dbg = await page.evaluate("window.__dbg")
        print(f"[flow] phase={dbg['phase']} enemies={dbg['enemies']} heroes={len(dbg['heroes'])}")
        if not dbg["heroes"]:
            failures.append("flow: ヒーローが作成されていない")
        if errs:
            failures.append(f"app pageerror: {errs}")
        await page.close()

        # 2) モジュール直 import のシミュレーション
        page = await ctx.new_page()
        serrs = []
        page.on("pageerror", lambda e: serrs.append(str(e)))
        await page.goto(f"{BASE}/index.html")
        result = await page.evaluate(SIM_JS)
        for c in result["checks"]:
            print(f"  {'✓' if c['ok'] else '✗'} {c['name']}  {c['detail']}")
            if not c["ok"]:
                failures.append(f"check: {c['name']} ({c['detail']})")
        if serrs:
            failures.append(f"sim pageerror: {serrs}")
        await page.close()

        await browser.close()

    print()
    if failures:
        print("=== FAILURES ===")
        for f in failures:
            print(" -", f)
        return 1
    print("=== ALL PASS ===")
    return 0


def main():
    env = dict(os.environ, PORT=str(PORT))
    srv = subprocess.Popen(
        [sys.executable, "server.py"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    try:
        if not wait_for_server(f"{BASE}/index.html"):
            print("サーバーが起動しませんでした", file=sys.stderr)
            return 1
        return asyncio.run(run())
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except subprocess.TimeoutExpired:
            srv.kill()


if __name__ == "__main__":
    sys.exit(main())
