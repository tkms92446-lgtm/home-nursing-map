/**
 * 事業所の Geocoding バッチ（アプリ本体とは独立した CLI）。
 *
 *   npm run geocode -- --city 大阪市天王寺区 --limit 20     # 少数で動作確認
 *   npm run geocode -- --prefecture 大阪府                   # 大阪府の pending を処理
 *   npm run geocode -- --retry-failed                         # failed のみ再試行（最大試行回数まで）
 *   npm run geocode -- --verify 30 --city 大阪市              # 住所 Geocoding 精度を公的座標と比較（DB座標は更新しない）
 *
 * 全国一括処理も同じコマンドで可能だが、--limit で分割実行し API 実行件数を確認しながら進めること。
 */
import "./load-env";
import { parseArgs } from "node:util";
import { closePool, getPool } from "@/lib/db/pool";
import { haversineMeters } from "@/lib/geo/distance";
import { createGeocoder, providersFromEnv } from "@/lib/geocoding/geocoder";
import { geocodeAddressCached, geocodeStations, recordApiUsage, stationGeocodeQuery } from "@/lib/geocoding/station-geocoding";

async function verify(n: number, prefecture?: string, city?: string) {
  const pool = getPool();
  let apiCalls = 0;
  const gc = createGeocoder(providersFromEnv(), async (p) => {
    apiCalls++;
    await recordApiUsage(pool, p);
  });
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.prefecture, s.city, s.full_address, o.official_latitude AS lat, o.official_longitude AS lng
       FROM stations s JOIN station_official_data o ON o.station_id = s.id
      WHERE o.official_latitude IS NOT NULL
        AND ($1::text IS NULL OR s.prefecture = $1) AND ($2::text IS NULL OR s.city LIKE $2 || '%')
      ORDER BY s.id LIMIT $3`,
    [prefecture ?? null, city ?? null, n],
  );
  const dists: number[] = [];
  let failed = 0;
  for (const r of rows) {
    const { result } = await geocodeAddressCached(pool, gc, stationGeocodeQuery(r.prefecture, r.city, r.full_address));
    if (result.latitude == null || result.longitude == null) {
      failed++;
      console.log(`  失敗  ${r.name} ${r.full_address} (${result.message ?? ""})`);
      continue;
    }
    const d = haversineMeters(r.lat, r.lng, result.latitude, result.longitude);
    dists.push(d);
    console.log(`  ${Math.round(d).toString().padStart(5)}m  [${result.provider}/${result.accuracy}] ${r.name}`);
  }
  dists.sort((a, b) => a - b);
  const median = dists.length ? dists[Math.floor(dists.length / 2)] : NaN;
  console.log("---- 住所Geocoding精度検証（公的データ座標との差） ----");
  console.log(`対象: ${rows.length} / 取得成功: ${dists.length} / 失敗: ${failed}`);
  console.log(`中央値: ${Math.round(median)}m / 500m以内: ${dists.filter((d) => d <= 500).length} / 最大: ${Math.round(dists.at(-1) ?? NaN)}m`);
  console.log(`外部API呼び出し: ${apiCalls}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "500" },
      prefecture: { type: "string" },
      city: { type: "string" },
      "retry-failed": { type: "boolean", default: false },
      verify: { type: "string" },
    },
  });
  if (values.verify) return verify(Number(values.verify), values.prefecture, values.city);

  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit は正の整数で指定してください");
  const stats = await geocodeStations(getPool(), {
    limit,
    prefecture: values.prefecture,
    cityPrefix: values.city,
    retryFailed: values["retry-failed"],
    onProgress: (done, total, last) => {
      if (done % 50 === 0 || done === total) console.log(`  ${done}/${total} ${last.name} → ${last.status}`);
    },
  });
  console.log("---- Geocoding 結果 ----");
  console.log(`対象: ${stats.targeted}`);
  console.log(`成功: ${stats.success}（公的データの座標を採用 ${stats.fromOfficial}）`);
  console.log(`要確認: ${stats.needsReview} / 失敗: ${stats.failed}`);
  console.log(`キャッシュ利用: ${stats.fromCache} / 外部API呼び出し: ${stats.apiCalls}`);
}

main()
  .catch((e) => {
    console.error(`エラー: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
