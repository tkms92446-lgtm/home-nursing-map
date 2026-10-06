/**
 * 事業所の Geocoding バッチ。
 *  - 公的データに緯度経度がある場合はそれを採用（API を呼ばない）
 *  - 無い場合のみ住所から Geocoding。同一住所は geocode_cache を参照し API を二度呼ばない
 *  - 対象: pending（既定） / failed の再試行は --retry-failed 指定時のみ
 */
import type { Pool } from "pg";
import { normalizeAddress } from "./address";
import { createGeocoder, providersFromEnv, type Geocoder } from "./geocoder";
import type { GeocodeResult } from "./types";
import { isValidJapanCoordinate } from "@/lib/text";

export interface GeocodeBatchOptions {
  limit: number;
  prefecture?: string;
  cityPrefix?: string;
  retryFailed?: boolean;
  /** 公的データの座標を使わず住所から求める（Geocoder 精度検証用。DB の座標は更新しない） */
  maxAttempts?: number;
  onProgress?: (done: number, total: number, last: { id: string; name: string; status: string }) => void;
}

export interface GeocodeBatchStats {
  targeted: number;
  success: number;
  needsReview: number;
  failed: number;
  fromOfficial: number;
  fromCache: number;
  apiCalls: number;
}

/**
 * Geocoding 用の住所文字列。元データの住所列で市区町村が省略されている場合（例: 「大阪府細工谷2-3-2」）は、
 * 同じ公的データの「都道府県名」「市区町村名」列を前置する（推測による補完ではない）。表示用住所は変更しない。
 */
export function stationGeocodeQuery(prefecture: string, city: string, fullAddress: string): string {
  const head = `${prefecture}${city}`;
  if (fullAddress.startsWith(head)) return fullAddress;
  const rest = fullAddress.startsWith(prefecture) ? fullAddress.slice(prefecture.length) : fullAddress;
  if (rest.startsWith(city)) return `${prefecture}${rest}`;
  return `${head}${rest}`;
}

export async function recordApiUsage(pool: Pool, provider: string): Promise<void> {
  await pool.query(
    `INSERT INTO geocode_api_usage (provider, day, calls) VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (provider, day) DO UPDATE SET calls = geocode_api_usage.calls + 1`,
    [provider],
  );
}

/** geocode_cache を使う住所 Geocoding（同一住所は一度だけ外部呼び出し） */
export async function geocodeAddressCached(
  pool: Pool,
  geocoder: Geocoder,
  address: string,
): Promise<{ result: GeocodeResult; cached: boolean }> {
  const key = normalizeAddress(address);
  const { rows } = await pool.query(
    `UPDATE geocode_cache SET hit_count = hit_count + 1 WHERE normalized_address = $1
     RETURNING status, latitude, longitude, provider, accuracy, matched_text`,
    [key],
  );
  if (rows.length && rows[0].status !== "failed") {
    const r = rows[0];
    return {
      cached: true,
      result: {
        status: r.status,
        latitude: r.latitude,
        longitude: r.longitude,
        provider: r.provider,
        accuracy: r.accuracy,
        matchedText: r.matched_text,
      },
    };
  }
  const result = await geocoder.geocode(address);
  await pool.query(
    `INSERT INTO geocode_cache (normalized_address, status, latitude, longitude, provider, accuracy, matched_text, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (normalized_address) DO UPDATE SET status=EXCLUDED.status, latitude=EXCLUDED.latitude,
       longitude=EXCLUDED.longitude, provider=EXCLUDED.provider, accuracy=EXCLUDED.accuracy,
       matched_text=EXCLUDED.matched_text, raw=EXCLUDED.raw, updated_at=now()`,
    [key, result.status, result.latitude, result.longitude, result.provider, result.accuracy, result.matchedText, JSON.stringify(result.raw ?? null)],
  );
  return { cached: false, result };
}

export async function geocodeStations(
  pool: Pool,
  opts: GeocodeBatchOptions,
  geocoder?: Geocoder,
): Promise<GeocodeBatchStats> {
  let apiCalls = 0;
  const gc =
    geocoder ??
    createGeocoder(providersFromEnv(), async (p) => {
      apiCalls++;
      await recordApiUsage(pool, p);
    });
  const statuses = opts.retryFailed ? ["pending", "failed"] : ["pending"];
  const { rows } = await pool.query<{
    id: string;
    name: string;
    prefecture: string;
    city: string;
    full_address: string;
    official_latitude: number | null;
    official_longitude: number | null;
  }>(
    `SELECT s.id, s.name, s.prefecture, s.city, s.full_address, o.official_latitude, o.official_longitude
       FROM stations s LEFT JOIN station_official_data o ON o.station_id = s.id
      WHERE s.geocoding_status = ANY($1)
        AND ($2::text IS NULL OR s.prefecture = $2)
        AND ($3::text IS NULL OR s.city LIKE $3 || '%')
        AND s.geocoding_attempts < $4
      ORDER BY s.id
      LIMIT $5`,
    [statuses, opts.prefecture ?? null, opts.cityPrefix ?? null, opts.maxAttempts ?? 5, opts.limit],
  );

  const stats: GeocodeBatchStats = { targeted: rows.length, success: 0, needsReview: 0, failed: 0, fromOfficial: 0, fromCache: 0, apiCalls: 0 };
  let done = 0;
  for (const s of rows) {
    let result: GeocodeResult;
    if (isValidJapanCoordinate(s.official_latitude, s.official_longitude)) {
      result = {
        status: "success",
        latitude: s.official_latitude,
        longitude: s.official_longitude,
        provider: "official_source",
        accuracy: "official",
        matchedText: null,
      };
      stats.fromOfficial++;
    } else {
      const r = await geocodeAddressCached(pool, gc, stationGeocodeQuery(s.prefecture, s.city, s.full_address));
      if (r.cached) stats.fromCache++;
      result = r.result;
    }
    await pool.query(
      `UPDATE stations SET latitude=$2, longitude=$3, geocoding_status=$4, geocoding_provider=$5,
         geocoding_accuracy=$6, geocoding_error=$7, geocoding_attempts=geocoding_attempts+1,
         geocoded_at=now(), updated_at=now()
       WHERE id=$1`,
      [
        s.id,
        result.status === "failed" ? null : result.latitude,
        result.status === "failed" ? null : result.longitude,
        result.status,
        result.provider,
        result.accuracy,
        result.status === "success" ? null : (result.message ?? null),
      ],
    );
    if (result.status === "success") stats.success++;
    else if (result.status === "needs_review") stats.needsReview++;
    else stats.failed++;
    done++;
    opts.onProgress?.(done, rows.length, { id: s.id, name: s.name, status: result.status });
  }
  stats.apiCalls = apiCalls;
  return stats;
}
