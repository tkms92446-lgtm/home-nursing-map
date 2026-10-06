/**
 * DB 結合テスト（TEST_DATABASE_URL の PostGIS DB を毎回作り直す）
 *  - 重複防止 / 差分更新 / inactive_candidate / 事業所独自情報の保持
 *  - Geocoding status 管理とキャッシュ（同一住所で外部APIを二度呼ばない）
 *  - map bounds 検索 / 距離検索
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, getPool, withTransaction } from "@/lib/db/pool";
import { importRecords, type ImportScope } from "@/lib/import/importer";
import { parseMhlwCsv } from "@/lib/import/mhlw";
import { DATA_SOURCES } from "@/lib/import/sources";
import type { Geocoder } from "@/lib/geocoding/geocoder";
import { geocodeStations } from "@/lib/geocoding/station-geocoding";
import { getStation, searchInBounds, searchNearby } from "@/lib/stations/repository";
import { migrate } from "../scripts/migrate";
import { csv, type RowInput } from "./helpers";

const source = DATA_SOURCES.mhlw_kaigo_kouhyou_130;

async function runImport(rows: RowInput[], scope: ImportScope = {}) {
  const parsed = parseMhlwCsv(csv(rows));
  return withTransaction((c) =>
    importRecords(c, parsed.records, {
      source,
      fileName: "test.csv",
      fileSha256: "x",
      sourceUpdatedAt: "2026-06-30",
      scope,
      totalRows: parsed.totalRows,
      parseErrors: parsed.errors,
    }),
  );
}

const BASE: RowInput[] = [
  { id: "2710000001", name: "A訪問看護", address: "大阪府大阪市天王寺区上本町6丁目1-1", lat: "34.6650", lng: "135.5190", days: "平日,土曜日" },
  { id: "2710000002", name: "B訪問看護", address: "大阪府大阪市天王寺区夕陽丘町2-3", days: "平日,土曜日,日曜日,祝日" },
  { id: "2710000003", name: "C訪問看護", address: "大阪府大阪市天王寺区夕陽丘町2-3", days: "平日" }, // B と同一住所
  { id: "2711900004", name: "D訪問看護", city: "大阪市阿倍野区", address: "大阪府大阪市阿倍野区阿倍野筋1丁目1-1", lat: "34.6457", lng: "135.5133" },
];

beforeAll(async () => {
  const pool = getPool();
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await migrate();
});

afterAll(async () => {
  await closePool();
});

describe("import pipeline", () => {
  it("初回は全件 INSERT", async () => {
    const s = await runImport(BASE);
    expect(s).toMatchObject({ inserted: 4, updated: 0, unchanged: 0, errors: 0, inactiveCandidates: 0 });
  });

  it("同じCSVを再取込しても重複しない（UNCHANGED）", async () => {
    const s = await runImport(BASE);
    expect(s).toMatchObject({ inserted: 0, updated: 0, unchanged: 4 });
    const { rows } = await getPool().query("SELECT count(*)::int AS n FROM stations");
    expect(rows[0].n).toBe(4);
  });

  it("変更行は UPDATE、エラー行は ERROR として数える", async () => {
    const changed = BASE.map((r) => (r.id === "2710000002" ? { ...r, phone: "06-9999-9999" } : r));
    const s = await runImport([...changed, { id: "bad" }]);
    expect(s).toMatchObject({ inserted: 0, updated: 1, unchanged: 3, errors: 1 });
  });

  it("消えた事業所は削除せず inactive_candidate。事業所独自情報は保持", async () => {
    const pool = getPool();
    const { rows } = await pool.query("SELECT id FROM stations WHERE official_provider_id='2710000003'");
    await pool.query("INSERT INTO station_profiles (station_id, introduction) VALUES ($1, '事業所が登録した紹介文')", [rows[0].id]);

    const s = await runImport(BASE.filter((r) => r.id !== "2710000003"));
    expect(s.inactiveCandidates).toBe(1);
    const st = await pool.query("SELECT status FROM stations WHERE id=$1", [rows[0].id]);
    expect(st.rows[0].status).toBe("inactive_candidate");

    const s2 = await runImport(BASE);
    expect(s2).toMatchObject({ updated: 1, reactivated: 1, inactiveCandidates: 0 });
    const prof = await pool.query("SELECT introduction FROM station_profiles WHERE station_id=$1", [rows[0].id]);
    expect(prof.rows[0].introduction).toBe("事業所が登録した紹介文");
  });

  it("範囲指定 import は範囲外の事業所を inactive にせず、範囲外のエラーも数えない", async () => {
    const outOfScopeError: RowInput = { id: "bad", city: "大阪市北区" };
    const s = await runImport([...BASE.filter((r) => r.city === undefined), outOfScopeError], { prefecture: "大阪府", cityPrefix: "大阪市天王寺区" });
    expect(s.inScopeRows).toBe(3);
    expect(s.inactiveCandidates).toBe(0);
    expect(s.errors).toBe(0);
    const { rows } = await getPool().query("SELECT status FROM stations WHERE official_provider_id='2711900004'");
    expect(rows[0].status).toBe("active");
  });
});

describe("Geocoding status 管理", () => {
  it("公的座標があればAPIを呼ばず、同一住所は一度だけ Geocoding する", async () => {
    const geocode = vi.fn(async () => ({
      status: "success" as const, latitude: 34.658, longitude: 135.513, provider: "fake", accuracy: "town" as const, matchedText: "夕陽丘町",
    }));
    const gc: Geocoder = { geocode };
    const pool = getPool();
    const s = await geocodeStations(pool, { limit: 100 }, gc);
    expect(s).toMatchObject({ targeted: 4, success: 4, fromOfficial: 2, fromCache: 1 });
    expect(geocode).toHaveBeenCalledTimes(1); // B と C は同一住所

    // success 済みは再処理しない
    const again = await geocodeStations(pool, { limit: 100 }, gc);
    expect(again.targeted).toBe(0);
    const { rows } = await pool.query("SELECT geocoding_status, geocoding_provider FROM stations ORDER BY official_provider_id");
    expect(rows.map((r) => r.geocoding_provider)).toEqual(["official_source", "fake", "fake", "official_source"]);
  });

  it("failed は --retry-failed 指定時のみ再試行。住所変更時は pending に戻る", async () => {
    const pool = getPool();
    // 住所を変更 → pending
    await runImport(BASE.map((r) => (r.id === "2710000002" ? { ...r, address: "大阪府大阪市天王寺区存在しない町1-1" } : r)));
    const st = await pool.query("SELECT geocoding_status, latitude FROM stations WHERE official_provider_id='2710000002'");
    expect(st.rows[0]).toMatchObject({ geocoding_status: "pending", latitude: null });

    const failing: Geocoder = {
      geocode: async () => ({ status: "failed", latitude: null, longitude: null, provider: "fake", accuracy: null, matchedText: null, message: "該当なし" }),
    };
    const s1 = await geocodeStations(pool, { limit: 100 }, failing);
    expect(s1).toMatchObject({ targeted: 1, failed: 1 });
    expect((await geocodeStations(pool, { limit: 100 }, failing)).targeted).toBe(0);
    expect((await geocodeStations(pool, { limit: 100, retryFailed: true }, failing)).targeted).toBe(1);
    const err = await pool.query("SELECT geocoding_status, geocoding_attempts, geocoding_error FROM stations WHERE official_provider_id='2710000002'");
    expect(err.rows[0]).toMatchObject({ geocoding_status: "failed", geocoding_attempts: 2, geocoding_error: "該当なし" });
  });
});

describe("検索", () => {
  it("map bounds 内の事業所のみ返す（失敗・掲載終了は除外）", async () => {
    const pool = getPool();
    const r = await searchInBounds(pool, { bbox: [135.505, 34.655, 135.53, 34.67], availableDays: [] });
    expect(r.mode).toBe("points");
    expect(r.points.map((p) => p.id).length).toBe(2); // A と C（B は failed、D は範囲外）
    const all = await searchInBounds(pool, { bbox: [135.4, 34.6, 135.6, 34.7], availableDays: [] });
    expect(all.total).toBe(3);
  });

  it("件数が上限を超える広域表示ではサーバー側で集約して返す（全件を送らない）", async () => {
    const r = await searchInBounds(getPool(), { bbox: [135.4, 34.6, 135.6, 34.7], availableDays: [] }, 1);
    expect(r.mode).toBe("aggregate");
    expect(r.points).toEqual([]);
    expect(r.clusters.reduce((s, c) => s + c.count, 0)).toBe(3);
    expect(r.total).toBe(3);
  });

  it("検索地点から近い順・半径内・曜日フィルター", async () => {
    const pool = getPool();
    const r = await searchNearby(pool, { lat: 34.6650, lng: 135.5190, radius: 3000, availableDays: [], limit: 50, offset: 0 });
    expect(r.list.map((s) => s.name)).toEqual(["A訪問看護", "C訪問看護", "D訪問看護"]);
    expect(r.list[0].distanceM).toBeLessThan(1);
    const d = r.list.map((s) => s.distanceM!);
    expect([...d].sort((a, b) => a - b)).toEqual(d);

    const near = await searchNearby(pool, { lat: 34.6650, lng: 135.5190, radius: 500, availableDays: [], limit: 50, offset: 0 });
    expect(near.total).toBe(1);

    const sat = await searchNearby(pool, { lat: 34.6650, lng: 135.5190, radius: 5000, availableDays: ["土曜日"], limit: 50, offset: 0 });
    expect(sat.list.map((s) => s.name)).toEqual(["A訪問看護", "D訪問看護"]);
  });

  it("詳細取得（出典・更新日を含む）と不正IDの拒否", async () => {
    const pool = getPool();
    const { rows } = await pool.query("SELECT id FROM stations WHERE official_provider_id='2710000001'");
    const s = await getStation(pool, String(rows[0].id));
    expect(s).toMatchObject({ name: "A訪問看護", sourceName: "厚生労働省 介護サービス情報公表システム", sourceUpdatedAt: "2026-06-30" });
    expect(await getStation(pool, "1; DROP TABLE stations")).toBeNull();
  });
});
