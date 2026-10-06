/**
 * 国土地理院 住所検索API（無料・APIキー不要）
 *   https://msearch.gsi.go.jp/address-search/AddressSearch?q=...
 * 公式な SLA は無いため、レート制限（既定 1 リクエスト/秒）を守り、結果は DB にキャッシュする。
 */
import { splitPrefecture } from "../address";
import type { GeocodeProvider, GeocodeResult } from "../types";
import { RateLimiter } from "../rate-limit";

const limiter = new RateLimiter(Number(process.env.GEOCODER_GSI_INTERVAL_MS ?? 1000));

interface GsiFeature {
  geometry: { coordinates: [number, number] };
  properties: { title: string };
}

export function interpretGsiResponse(query: string, features: GsiFeature[]): GeocodeResult {
  const base = { provider: "gsi", raw: features.slice(0, 3) };
  if (!Array.isArray(features) || features.length === 0) {
    return { ...base, status: "failed", latitude: null, longitude: null, accuracy: null, matchedText: null, message: "該当なし" };
  }
  const f = features[0];
  const [lng, lat] = f.geometry.coordinates;
  const title = f.properties.title ?? "";
  const { prefecture } = splitPrefecture(query);
  // 都道府県が一致しない候補は誤マッチの可能性が高い
  const prefMismatch = prefecture != null && !title.startsWith(prefecture);
  const hasNumber = /[0-9０-９]/.test(title);
  return {
    ...base,
    status: prefMismatch ? "needs_review" : "success",
    latitude: lat,
    longitude: lng,
    accuracy: hasNumber ? "block" : "town",
    matchedText: title,
    message: prefMismatch ? "都道府県が一致しません" : undefined,
  };
}

export const gsiProvider: GeocodeProvider = {
  name: "gsi",
  external: true,
  async geocode(q: string): Promise<GeocodeResult> {
    await limiter.wait();
    const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`GSI HTTP ${res.status}`);
    const json = (await res.json()) as GsiFeature[];
    return interpretGsiResponse(q, json);
  },
};
