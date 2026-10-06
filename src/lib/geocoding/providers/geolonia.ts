/**
 * Geolonia「japanese-addresses」(CC BY 4.0) を用いたオフライン寄りの Geocoder。
 *   - 町丁目の代表点（国土交通省 位置参照情報ベース）で座標を返す（精度: town）
 *   - 街区データが取得できる環境では街区代表点まで絞り込む（精度: block）
 *   - 取得した JSON は data/cache/geolonia/ に保存し、2回目以降はネットワークを使わない
 * 住所文字列のみから計算するため、API 料金は発生しない。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fromKanjiNumber, splitPrefecture, PREFECTURES } from "../address";
import type { GeocodeProvider, GeocodeResult } from "../types";

export interface TownEntry {
  town: string;
  koaza?: string;
  lat: number;
  lng: number;
  residential?: boolean;
}
export interface GaikuEntry {
  gaiku: string;
  lat: number;
  lng: number;
}

export interface GeoloniaLoader {
  prefCities(): Promise<Record<string, string[]>>;
  towns(pref: string, city: string): Promise<TownEntry[]>;
  gaiku(pref: string, city: string, town: string): Promise<GaikuEntry[] | null>;
}

const TOWN_BASE =
  process.env.GEOLONIA_API_BASE ?? "https://raw.githubusercontent.com/geolonia/japanese-addresses/master/api";
const GAIKU_BASE = process.env.GEOLONIA_GAIKU_BASE ?? "https://geolonia.github.io/japanese-addresses/api";
const CACHE_DIR = path.join(process.cwd(), "data", "cache", "geolonia");

/** ファイルキャッシュ付き HTTP ローダ */
export function createHttpLoader(): GeoloniaLoader {
  const mem = new Map<string, unknown>();
  const failed = new Set<string>();

  async function load<T>(base: string, rel: string): Promise<T | null> {
    const key = `${base}|${rel}`;
    if (mem.has(key)) return mem.get(key) as T;
    if (failed.has(key)) return null;
    const file = path.join(CACHE_DIR, rel);
    if (existsSync(file)) {
      const v = JSON.parse(readFileSync(file, "utf8")) as T;
      mem.set(key, v);
      return v;
    }
    try {
      const url = `${base}/${rel.split("/").map(encodeURIComponent).join("/")}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const v = (await res.json()) as T;
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(v));
      } catch {
        // 読み取り専用環境ではメモリキャッシュのみ
      }
      mem.set(key, v);
      return v;
    } catch {
      failed.add(key);
      return null;
    }
  }

  return {
    async prefCities() {
      const v = await load<Record<string, string[]>>(TOWN_BASE, "ja.json");
      if (!v) throw new Error("市区町村リストを取得できませんでした");
      return v;
    },
    async towns(pref, city) {
      const v = await load<TownEntry[]>(TOWN_BASE, `ja/${pref}/${city}.json`);
      if (!v) throw new Error(`町丁目リストを取得できませんでした: ${pref}${city}`);
      return v;
    },
    async gaiku(pref, city, town) {
      return load<GaikuEntry[]>(GAIKU_BASE, `ja/${pref}/${city}/${town}.json`);
    },
  };
}

/** 表記揺れの吸収（文字数を変えない置換のみ）: ヶ/ケ/ヵ → ケ など */
export function fold(s: string): string {
  return s.replace(/[ヶヵ]/g, (c) => (c === "ヶ" ? "ケ" : "カ")).replace(/[籠篭]/g, "篭").replace(/[檜桧]/g, "桧");
}

interface CityMatch {
  pref: string;
  city: string;
  rest: string;
}

const DEFAULT_PREF = process.env.DEFAULT_PREFECTURE ?? "大阪府";

/** 都道府県・市区町村を特定する（都道府県省略・郡省略・政令市の区のみ入力にも対応） */
export function matchCity(input: string, prefCities: Record<string, string[]>): CityMatch | null {
  const { prefecture, rest: rawRest } = splitPrefecture(input);
  const rest = fold(rawRest);
  const prefs = prefecture ? [prefecture] : (Object.keys(prefCities) as string[]);
  const candidates: (CityMatch & { len: number; viaWard: boolean })[] = [];
  for (const p of prefs) {
    for (const c of prefCities[p] ?? []) {
      const forms = new Set([fold(c), fold(c).replace(/^.+?郡/, "")]);
      for (const f of forms) {
        if (f && rest.startsWith(f)) candidates.push({ pref: p, city: c, rest: rest.slice(f.length), len: f.length, viaWard: false });
      }
      // 「天王寺区」のように政令市名を省略した入力
      const ward = fold(c).match(/^.+?市(.+区)$/)?.[1];
      if (ward && rest.startsWith(ward) && !rest.startsWith(fold(c))) {
        candidates.push({ pref: p, city: c, rest: rest.slice(ward.length), len: ward.length, viaWard: true });
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      b.len - a.len ||
      Number(a.viaWard) - Number(b.viaWard) ||
      Number(b.pref === DEFAULT_PREF) - Number(a.pref === DEFAULT_PREF),
  );
  const best = candidates[0];
  return { pref: best.pref, city: best.city, rest: best.rest };
}

/** 町丁目を特定する。「上本町6-5-13」「上本町6丁目5-13」「上本町六丁目」のいずれにも対応 */
export function matchTown(rest: string, towns: TownEntry[]): { town: TownEntry; rest: string } | null {
  const r = fold(rest).replace(/^大字/, "");
  let best: { town: TownEntry; rest: string; len: number } | null = null;
  const consider = (town: TownEntry, prefix: string) => {
    if (!r.startsWith(prefix)) return;
    if (!best || prefix.length > best.len) {
      best = { town, rest: r.slice(prefix.length).replace(/^-/, ""), len: prefix.length };
    }
  };
  for (const t of towns) {
    const name = fold(t.town).replace(/^大字/, "");
    consider(t, name);
    const m = name.match(/^(.*?)([一二三四五六七八九十]+)丁目$/);
    if (m) {
      const n = fromKanjiNumber(m[2]);
      if (n != null) {
        consider(t, `${m[1]}${n}丁目`);
        // 「上本町6-5」形式：数字の直後がハイフンか末尾の場合のみ丁目とみなす
        const p = `${m[1]}${n}`;
        if (r.startsWith(p) && (r.length === p.length || r[p.length] === "-")) consider(t, p);
      }
    }
  }
  if (!best) return null;
  const b = best as { town: TownEntry; rest: string };
  return { town: b.town, rest: b.rest };
}

/**
 * 「大阪市上本町8丁目」のように政令指定都市の区が省略された住所。
 * 各区の町丁目を調べ、町丁目名が1つの区にだけ存在する場合に限りその区とみなす。
 */
async function matchWardlessDesignatedCity(
  input: string,
  prefCities: Record<string, string[]>,
  loader: GeoloniaLoader,
): Promise<CityMatch | null> {
  const { prefecture, rest: rawRest } = splitPrefecture(input);
  const rest = fold(rawRest);
  const prefs = prefecture ? [prefecture] : Object.keys(prefCities);
  for (const p of prefs) {
    const wards = (prefCities[p] ?? []).filter((c) => /^.+?市.+区$/.test(c));
    const cityNames = [...new Set(wards.map((c) => c.match(/^(.+?市)/)![1]))];
    const city = cityNames.find((n) => rest.startsWith(n));
    if (!city) continue;
    const after = rest.slice(city.length);
    const hits: CityMatch[] = [];
    for (const w of wards.filter((c) => c.startsWith(city))) {
      const towns = await loader.towns(p, w).catch(() => [] as TownEntry[]);
      if (matchTown(after, towns)) hits.push({ pref: p, city: w, rest: after });
    }
    if (hits.length === 1) return hits[0];
  }
  return null;
}

export function createGeoloniaProvider(loader: GeoloniaLoader = createHttpLoader()): GeocodeProvider {
  return {
    name: "geolonia",
    external: false,
    async geocode(q: string): Promise<GeocodeResult> {
      const base = { provider: "geolonia" };
      const fail = (message: string): GeocodeResult => ({
        ...base, status: "failed", latitude: null, longitude: null, accuracy: null, matchedText: null, message,
      });
      const prefCities = await loader.prefCities();
      let cm = matchCity(q, prefCities);
      if (!cm) cm = await matchWardlessDesignatedCity(q, prefCities, loader);
      if (!cm) {
        // 都道府県名だけの入力
        const { prefecture, rest } = splitPrefecture(q);
        if (prefecture && rest === "" && (PREFECTURES as readonly string[]).includes(prefecture)) {
          return fail("都道府県のみの指定です。市区町村以下を入力してください");
        }
        return fail("市区町村を特定できませんでした");
      }
      const towns = await loader.towns(cm.pref, cm.city);
      const tm = matchTown(cm.rest, towns);
      if (!tm) {
        if (towns.length === 0) return fail("町丁目データがありません");
        const lat = towns.reduce((s, t) => s + t.lat, 0) / towns.length;
        const lng = towns.reduce((s, t) => s + t.lng, 0) / towns.length;
        // 市区町村名だけの入力なら「地域検索」として成功扱い。それ以外は要確認
        return {
          ...base,
          status: cm.rest === "" ? "success" : "needs_review",
          latitude: lat,
          longitude: lng,
          accuracy: "city",
          matchedText: `${cm.pref}${cm.city}`,
          message: cm.rest === "" ? undefined : "町丁目を特定できず市区町村の代表点を使用",
        };
      }
      const matchedTown = `${cm.pref}${cm.city}${tm.town.town}`;
      const gaikuNo = tm.rest.match(/^([0-9]+)/)?.[1];
      if (gaikuNo) {
        const gaiku = await loader.gaiku(cm.pref, cm.city, tm.town.town);
        const g = gaiku?.find((x) => x.gaiku === gaikuNo);
        if (g) {
          return { ...base, status: "success", latitude: g.lat, longitude: g.lng, accuracy: "block", matchedText: `${matchedTown}${gaikuNo}` };
        }
      }
      return { ...base, status: "success", latitude: tm.town.lat, longitude: tm.town.lng, accuracy: "town", matchedText: matchedTown };
    },
  };
}
