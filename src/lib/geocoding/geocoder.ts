/**
 * Geocoder 本体: プロバイダを順に試し、最良の結果を返す。
 * キャッシュ（DB / メモリ）はこの上の層（station-geocoding.ts / search-geocoding.ts）で扱う。
 */
import { normalizeAddress } from "./address";
import { createGeoloniaProvider } from "./providers/geolonia";
import { gsiProvider } from "./providers/gsi";
import { withRetry } from "./rate-limit";
import { ACCURACY_RANK, type GeocodeProvider, type GeocodeResult } from "./types";

export type UsageRecorder = (provider: string) => void | Promise<void>;

export interface Geocoder {
  geocode(address: string): Promise<GeocodeResult>;
}

let geoloniaSingleton: GeocodeProvider | undefined;

export function providersFromEnv(): GeocodeProvider[] {
  const names = (process.env.GEOCODER_PROVIDERS ?? "gsi,geolonia")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return names.map((n) => {
    if (n === "gsi") return gsiProvider;
    if (n === "geolonia") return (geoloniaSingleton ??= createGeoloniaProvider());
    throw new Error(`未知の Geocoding プロバイダ: ${n}`);
  });
}

function better(a: GeocodeResult | null, b: GeocodeResult): GeocodeResult {
  if (!a) return b;
  const score = (r: GeocodeResult) =>
    (r.status === "success" ? 100 : r.status === "needs_review" ? 50 : 0) + (r.accuracy ? ACCURACY_RANK[r.accuracy] : 0);
  return score(b) > score(a) ? b : a;
}

/**
 * プロバイダを順に試す。精度 block 以上の success が得られた時点で終了（無駄な API 呼び出しをしない）。
 */
export function createGeocoder(providers: GeocodeProvider[], recordUsage?: UsageRecorder): Geocoder {
  return {
    async geocode(address: string): Promise<GeocodeResult> {
      const q = normalizeAddress(address);
      let best: GeocodeResult | null = null;
      const errors: string[] = [];
      for (const p of providers) {
        try {
          const r = await withRetry(async () => {
            if (p.external && recordUsage) await recordUsage(p.name);
            return p.geocode(q);
          }, p.external ? 1 : 0);
          best = better(best, r);
          if (r.status === "success" && r.accuracy && ACCURACY_RANK[r.accuracy] >= ACCURACY_RANK.block) break;
        } catch (e) {
          errors.push(`${p.name}: ${(e as Error).message}`);
        }
      }
      if (best) return errors.length && best.status !== "success" ? { ...best, message: [best.message, ...errors].filter(Boolean).join(" / ") } : best;
      return {
        status: "failed",
        latitude: null,
        longitude: null,
        provider: providers.map((p) => p.name).join(","),
        accuracy: null,
        matchedText: null,
        message: errors.join(" / ") || "該当なし",
      };
    },
  };
}
