/**
 * 利用者が入力した住所・地域の Geocoding（検索ボックス用）。
 * 利用者宅の住所などが含まれ得るため、入力文字列や結果座標は DB に保存しない。
 * 同じ入力で外部 API を何度も呼ばないよう、プロセス内メモリにだけ短時間キャッシュする。
 */
import { getPool } from "@/lib/db/pool";
import { normalizeAddress } from "./address";
import { createGeocoder, providersFromEnv, type Geocoder } from "./geocoder";
import { recordApiUsage } from "./station-geocoding";
import type { GeocodeResult } from "./types";

const MAX_ENTRIES = 500;
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; result: GeocodeResult }>();
let geocoder: Geocoder | undefined;

function getGeocoder(): Geocoder {
  return (geocoder ??= createGeocoder(providersFromEnv(), async (p) => {
    try {
      await recordApiUsage(getPool(), p); // 件数のみ記録（入力内容は保存しない）
    } catch {
      // DB 未接続でも検索自体は継続
    }
  }));
}

export async function geocodeSearchQuery(q: string): Promise<GeocodeResult> {
  const key = normalizeAddress(q);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
  const result = await getGeocoder().geocode(q);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), result });
  return result;
}
