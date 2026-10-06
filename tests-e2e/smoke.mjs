/**
 * 主要ユーザーフローのスモークテスト（Playwright）。
 *   1. 初期表示（大阪市周辺の地図 + 一覧）
 *   2. 住所検索 → 検索地点マーカー + 距離順一覧
 *   3. 現在地検索（許可あり / 拒否）
 *   4. 一覧カード → 地図フォーカス、地図マーカー → 一覧フォーカス
 *   5. 詳細ページ（出典・更新日）
 *   6. スマートフォン表示（地図/一覧の切替）
 *
 * 使い方: 別ターミナルで `npm run dev` を起動してから
 *   BASE_URL=http://localhost:3000 ADDRESS="大阪市天王寺区上本町6丁目" npm run e2e
 * 地図の内部状態を参照するため dev サーバーで実行してください。
 * Chromium が未導入なら `npx playwright install chromium`（または CHROMIUM_PATH を指定）。
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADDRESS = process.env.ADDRESS ?? "大阪市天王寺区上本町6丁目";
const GEO = { latitude: Number(process.env.GEO_LAT ?? 34.6466), longitude: Number(process.env.GEO_LNG ?? 135.5139) }; // 天王寺駅付近
const OUT = process.env.SCREENSHOT_DIR ?? "tests-e2e/screenshots";
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];

async function newPage(opts) {
  const ctx = await browser.newContext({ locale: "ja-JP", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|tile|AJAXError|cyberjapandata|openstreetmap/i.test(m.text())) errors.push(m.text());
  });
  return { ctx, page };
}

async function cardDistances(page) {
  return page.$$eval("li[id^=station-card-] span[title*=距離]", (els) =>
    els.map((e) => {
      const t = e.textContent.trim();
      return t.endsWith("km") ? parseFloat(t) * 1000 : parseFloat(t);
    }),
  );
}
const sorted = (a) => a.every((v, i) => i === 0 || a[i - 1] <= v);

try {
  // ===== PC =====
  {
    const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 }, permissions: ["geolocation"], geolocation: GEO });
    await page.goto(BASE);
    await page.waitForSelector("li[id^=station-card-]", { timeout: 30_000 });
    const n = await page.locator("li[id^=station-card-]").count();
    const center = await page.evaluate(() => window.__hnmMap?.getCenter());
    check("初期表示: 大阪市周辺の地図と一覧", n > 0 && center && Math.abs(center.lat - 34.65) < 0.2 && Math.abs(center.lng - 135.5) < 0.2, `${n}件, 中心 ${center?.lat?.toFixed(3)},${center?.lng?.toFixed(3)}`);
    const aside = await page.locator("aside").boundingBox();
    check("PCレイアウト: 左に一覧（約35%）", aside && aside.width / 1440 > 0.25 && aside.width / 1440 < 0.4, `${Math.round((aside.width / 1440) * 100)}%`);
    await page.screenshot({ path: `${OUT}/01-pc-initial.png` });

    // 住所検索
    await page.fill("#q", ADDRESS);
    await page.click("button[type=submit]");
    await page.waitForFunction(() => document.querySelector(".hnm-search-marker"), null, { timeout: 15_000 });
    await page.waitForTimeout(1200);
    const d1 = await cardDistances(page);
    const summary = await page.locator("aside [aria-live]").innerText();
    check("住所検索: 検索地点マーカー表示 + 距離順", d1.length > 0 && sorted(d1), `${summary.replace(/\s+/g, " ")} / 先頭 ${d1.slice(0, 3).join(",")}m`);
    await page.screenshot({ path: `${OUT}/02-pc-address-search.png` });

    // 半径変更
    await page.getByRole("button", { name: "500m", exact: true }).click();
    await page.waitForTimeout(1200);
    const d500 = await cardDistances(page);
    const emptyMsg = await page.getByText("この周辺ではステーションを確認できませんでした").count();
    check("検索半径 500m: 500m以内のみ表示", d500.every((d) => d <= 500) && (d500.length > 0 || emptyMsg > 0), `${d500.length}件`);
    await page.getByRole("button", { name: "3km", exact: true }).click();
    await page.waitForTimeout(1200);

    // フィルター
    const totalOf = async () => Number(await page.locator("aside [aria-live] span.text-lg").innerText());
    const before = await totalOf();
    await page.locator("label", { hasText: "土曜日" }).click();
    await page.waitForTimeout(1200);
    const after = await totalOf();
    check("フィルター（土曜日）で絞り込み", after > 0 && after < before, `${before} → ${after}`);
    await page.locator("label", { hasText: "土曜日" }).click();
    await page.waitForTimeout(1200);

    // カード → 地図
    const first = page.locator("li[id^=station-card-]").first();
    const firstId = (await first.getAttribute("id")).replace("station-card-", "");
    await first.locator("button").first().click();
    await page.waitForTimeout(1000);
    const popup = await page.locator(".maplibregl-popup").count();
    const selFilter = await page.evaluate(() => JSON.stringify(window.__hnmMap.getFilter("stations-selected")));
    check("一覧カード → 地図の該当マーカーへフォーカス", popup === 1 && selFilter.includes(firstId), selFilter);

    // 地図マーカー → 一覧
    await page.evaluate(() => window.__hnmMap.jumpTo({ zoom: 16 }));
    await page.waitForTimeout(800);
    const target = await page.evaluate(() => {
      const m = window.__hnmMap;
      const fs = m.queryRenderedFeatures({ layers: ["stations-point"] });
      if (!fs.length) return null;
      const f = fs[fs.length - 1];
      const p = m.project(f.geometry.coordinates);
      const r = m.getCanvas().getBoundingClientRect();
      return { id: String(f.properties.id), x: r.left + p.x, y: r.top + p.y };
    });
    if (target) {
      await page.mouse.click(target.x, target.y);
      await page.waitForTimeout(800);
      const selected = await page.locator(`#station-card-${target.id}`).getAttribute("class").catch(() => "");
      check("地図マーカー → 一覧の該当カードへフォーカス", (selected ?? "").includes("ring-2"), `id=${target.id}`);
    } else {
      check("地図マーカー → 一覧の該当カードへフォーカス", false, "描画されたマーカーなし");
    }
    await page.screenshot({ path: `${OUT}/03-pc-selected.png` });

    // Marker clustering
    await page.evaluate(() => window.__hnmMap.jumpTo({ zoom: 11 }));
    await page.waitForTimeout(1200);
    const clusters = await page.locator(".hnm-cluster").count();
    check("Marker clustering（縮小時にクラスタ表示）", clusters > 0, `${clusters}個`);

    // このエリアを検索
    await page.mouse.move(1000, 450);
    await page.mouse.down();
    await page.mouse.move(900, 400, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const areaBtn = page.getByRole("button", { name: /このエリアを検索/ });
    const shown = await areaBtn.count();
    if (shown) await areaBtn.click();
    await page.waitForTimeout(1200);
    check("地図移動で「このエリアを検索」表示・実行", shown === 1 && (await areaBtn.count()) === 0);
    await page.screenshot({ path: `${OUT}/04-pc-cluster.png` });

    // 現在地
    await page.getByRole("button", { name: /現在地から探す/ }).click();
    await page.waitForFunction(() => document.querySelector(".hnm-current-marker"), null, { timeout: 15_000 });
    await page.waitForTimeout(1200);
    const d2 = await cardDistances(page);
    const summary2 = await page.locator("aside [aria-live]").innerText();
    check("現在地検索: 現在地マーカー + 距離順", d2.length > 0 && sorted(d2) && summary2.includes("現在地"), `${summary2.replace(/\s+/g, " ")} / 先頭 ${d2.slice(0, 3).join(",")}m`);
    await page.screenshot({ path: `${OUT}/05-pc-current-location.png` });

    // 詳細ページ
    await page.locator("li[id^=station-card-] a", { hasText: "詳細を見る" }).first().click();
    await page.waitForURL(/\/stations\/\d+/);
    const body = await page.locator("main").innerText();
    check("詳細ページ: データ出典・公的データ最終更新日", body.includes("データ出典") && body.includes("公的データ最終更新日") && body.includes("公的データ"), page.url());
    await page.screenshot({ path: `${OUT}/06-pc-detail.png`, fullPage: true });

    // 住所検索失敗
    await page.goto(BASE);
    await page.waitForSelector("li[id^=station-card-]");
    await page.fill("#q", "ああああああ");
    await page.click("button[type=submit]");
    await page.waitForTimeout(2500);
    check("住所検索失敗メッセージ", (await page.getByText("該当する場所を確認できませんでした。住所を変更してお試しください。").count()) === 1);

    // 管理画面
    await page.goto(`${BASE}/admin`);
    const adm = await page.locator("main").innerText();
    check("管理画面: 件数・Geocoding・import結果", adm.includes("登録事業所総数") && adm.includes("Geocoding 成功") && adm.includes("変更なし"));
    await page.screenshot({ path: `${OUT}/07-admin.png`, fullPage: true });
    await ctx.close();
  }

  // ===== 位置情報拒否 =====
  {
    const { ctx, page } = await newPage({ viewport: { width: 1280, height: 800 }, permissions: [] });
    await page.goto(BASE);
    await page.waitForSelector("li[id^=station-card-]");
    await page.getByRole("button", { name: /現在地から探す/ }).click();
    await page.waitForTimeout(2000);
    check("位置情報拒否時のメッセージ", (await page.getByText("位置情報を取得できませんでした。住所から検索してください。").count()) === 1);
    await ctx.close();
  }

  // ===== スマートフォン =====
  {
    const { ctx, page } = await newPage({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      permissions: ["geolocation"], geolocation: GEO,
    });
    await page.goto(BASE);
    await page.waitForTimeout(3000);
    const mapVisible = await page.locator("section .maplibregl-canvas").isVisible();
    await page.screenshot({ path: `${OUT}/08-sp-map.png` });
    await page.fill("#q", ADDRESS);
    await page.click("button[type=submit]");
    await page.waitForTimeout(2500);
    await page.getByRole("tab", { name: /一覧/ }).click();
    await page.waitForTimeout(500);
    const cards = await page.locator("li[id^=station-card-]").count();
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check("スマートフォン: 地図/一覧の切替・横スクロールなし", mapVisible && cards > 0 && scrollW <= 390, `${cards}件, scrollWidth=${scrollW}`);
    await page.screenshot({ path: `${OUT}/09-sp-list.png` });
    await page.locator("li[id^=station-card-] a", { hasText: "詳細を見る" }).first().click();
    await page.waitForURL(/\/stations\/\d+/);
    await page.screenshot({ path: `${OUT}/10-sp-detail.png`, fullPage: true });
    await ctx.close();
  }
} finally {
  await browser.close();
}

check("重大な runtime error なし", errors.length === 0, errors.slice(0, 5).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
