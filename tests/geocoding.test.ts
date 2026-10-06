import { describe, expect, it, vi } from "vitest";
import { fromKanjiNumber, normalizeAddress, toKanjiNumber } from "@/lib/geocoding/address";
import { createGeocoder } from "@/lib/geocoding/geocoder";
import { createGeoloniaProvider, matchCity, matchTown, type GeoloniaLoader } from "@/lib/geocoding/providers/geolonia";
import { interpretGsiResponse } from "@/lib/geocoding/providers/gsi";
import { stationGeocodeQuery } from "@/lib/geocoding/station-geocoding";
import type { GeocodeProvider, GeocodeResult } from "@/lib/geocoding/types";

const PREF_CITIES = {
  大阪府: ["大阪市天王寺区", "大阪市北区", "堺市北区", "豊能郡豊能町"],
  東京都: ["北区", "千代田区"],
};
const TOWNS = [
  { town: "上本町六丁目", koaza: "", lat: 34.665, lng: 135.519 },
  { town: "上本町", koaza: "", lat: 1, lng: 1 },
  { town: "夕陽丘町", koaza: "", lat: 34.658, lng: 135.513 },
  { town: "寺田町一丁目", koaza: "", lat: 34.651, lng: 135.522 },
  { town: "筆ケ崎町", koaza: "", lat: 34.666, lng: 135.525 },
];

const loader: GeoloniaLoader = {
  prefCities: async () => PREF_CITIES,
  towns: async (_p, c) => (c === "大阪市天王寺区" ? TOWNS : []),
  gaiku: async (_p, _c, town) => (town === "上本町六丁目" ? [{ gaiku: "5", lat: 34.6655, lng: 135.5195 }] : null),
};

describe("住所正規化", () => {
  it("番地表記の揺れを統一しビル名を除去する", () => {
    expect(normalizeAddress("大阪府大阪市天王寺区寺田町１丁目５番１０号　ABCビル3階")).toBe("大阪府大阪市天王寺区寺田町1丁目5-10");
    expect(normalizeAddress("上汐４－３－２ テストビル2-3F")).toBe("上汐4-3-2");
    expect(normalizeAddress("上本町6丁目5番地の13")).toBe("上本町6丁目5-13");
    expect(normalizeAddress("天王寺区")).toBe("天王寺区");
  });
  it("漢数字変換", () => {
    expect(toKanjiNumber(6)).toBe("六");
    expect(toKanjiNumber(12)).toBe("十二");
    expect(toKanjiNumber(20)).toBe("二十");
    expect(fromKanjiNumber("六")).toBe(6);
    expect(fromKanjiNumber("二十三")).toBe(23);
    expect(fromKanjiNumber("十")).toBe(10);
  });
});

describe("住所検索（Geolonia町丁目マッチ）", () => {
  it("都道府県省略・区のみの入力でも市区町村を特定する（既定: 大阪府を優先）", () => {
    expect(matchCity("大阪市天王寺区上本町6", PREF_CITIES)?.city).toBe("大阪市天王寺区");
    expect(matchCity("天王寺区", PREF_CITIES)).toEqual({ pref: "大阪府", city: "大阪市天王寺区", rest: "" });
    expect(matchCity("東京都北区", PREF_CITIES)).toEqual({ pref: "東京都", city: "北区", rest: "" });
    expect(matchCity("豊能町", PREF_CITIES)?.city).toBe("豊能郡豊能町");
    expect(matchCity("ほげ", PREF_CITIES)).toBeNull();
  });
  it("丁目のアラビア数字・ハイフン表記に対応し、最長一致を選ぶ", () => {
    expect(matchTown("上本町6-5-13", TOWNS)?.town.town).toBe("上本町六丁目");
    expect(matchTown("上本町6丁目5-13", TOWNS)?.rest).toBe("5-13");
    expect(matchTown("上本町六丁目", TOWNS)?.town.town).toBe("上本町六丁目");
    expect(matchTown("上本町", TOWNS)?.town.town).toBe("上本町");
    expect(matchTown("夕陽丘町2-3", TOWNS)?.town.town).toBe("夕陽丘町");
    // 「上本町60」は六丁目ではない
    expect(matchTown("上本町60", TOWNS)?.town.town).toBe("上本町");
  });
  it("ヶ/ケ の表記揺れを吸収する", () => {
    expect(matchTown("筆ヶ崎町5-52", TOWNS)?.town.town).toBe("筆ケ崎町");
  });
  it("政令市の区が省略された住所は、町丁目が1つの区にだけある場合のみ特定", async () => {
    const p = createGeoloniaProvider(loader);
    expect(await p.geocode("大阪府大阪市夕陽丘町2-3")).toMatchObject({ status: "success", accuracy: "town", matchedText: "大阪府大阪市天王寺区夕陽丘町" });
  });
  it("住所列で市区町村が省略された事業所は公的データの市区町村名列を前置して検索", () => {
    expect(stationGeocodeQuery("大阪府", "大阪市天王寺区", "大阪府細工谷2-3-2")).toBe("大阪府大阪市天王寺区細工谷2-3-2");
    expect(stationGeocodeQuery("大阪府", "大阪市天王寺区", "大阪市天王寺区夕陽丘町2-3")).toBe("大阪府大阪市天王寺区夕陽丘町2-3");
    expect(stationGeocodeQuery("大阪府", "大阪市天王寺区", "大阪府大阪市天王寺区夕陽丘町2-3")).toBe("大阪府大阪市天王寺区夕陽丘町2-3");
  });
  it("街区まで分かれば block、町丁目まで town、市区町村のみなら city", async () => {
    const p = createGeoloniaProvider(loader);
    expect(await p.geocode("大阪府大阪市天王寺区上本町6丁目5-13")).toMatchObject({ status: "success", accuracy: "block", latitude: 34.6655 });
    expect(await p.geocode("大阪市天王寺区夕陽丘町2-3")).toMatchObject({ status: "success", accuracy: "town", latitude: 34.658 });
    expect(await p.geocode("天王寺区")).toMatchObject({ status: "success", accuracy: "city" });
    expect(await p.geocode("大阪市天王寺区存在しない町1-1")).toMatchObject({ status: "needs_review", accuracy: "city" });
    expect(await p.geocode("ほげほげ")).toMatchObject({ status: "failed" });
  });
});

describe("Geocoder チェーン", () => {
  const ok = (accuracy: GeocodeResult["accuracy"], provider: string): GeocodeResult => ({
    status: "success", latitude: 34, longitude: 135, provider, accuracy, matchedText: "x",
  });

  it("精度 block 以上の結果が得られたら後続プロバイダを呼ばない", async () => {
    const second = vi.fn(async () => ok("town", "b"));
    const a: GeocodeProvider = { name: "a", external: true, geocode: async () => ok("block", "a") };
    const b: GeocodeProvider = { name: "b", external: false, geocode: second };
    const usage = vi.fn();
    const r = await createGeocoder([a, b], usage).geocode("大阪市天王寺区上本町6-5");
    expect(r.provider).toBe("a");
    expect(second).not.toHaveBeenCalled();
    expect(usage).toHaveBeenCalledTimes(1); // 外部 API 実行件数を記録
  });

  it("外部APIが失敗しても次のプロバイダで継続する", async () => {
    const a: GeocodeProvider = { name: "a", external: false, geocode: async () => { throw new Error("network"); } };
    const b: GeocodeProvider = { name: "b", external: false, geocode: async () => ok("town", "b") };
    const r = await createGeocoder([a, b]).geocode("x");
    expect(r).toMatchObject({ status: "success", provider: "b" });
  });

  it("全て失敗したら failed", async () => {
    const a: GeocodeProvider = { name: "a", external: false, geocode: async () => { throw new Error("network"); } };
    const r = await createGeocoder([a]).geocode("x");
    expect(r.status).toBe("failed");
    expect(r.message).toContain("network");
  });

  it("国土地理院APIの応答を解釈（都道府県不一致は要確認）", () => {
    const f = (title: string) => [{ geometry: { coordinates: [135.5, 34.6] as [number, number] }, properties: { title } }];
    expect(interpretGsiResponse("大阪府大阪市天王寺区上本町6-5", f("大阪府大阪市天王寺区上本町六丁目5"))).toMatchObject({ status: "success", accuracy: "block", latitude: 34.6 });
    expect(interpretGsiResponse("大阪府大阪市北区", f("東京都北区"))).toMatchObject({ status: "needs_review" });
    expect(interpretGsiResponse("ほげ", [])).toMatchObject({ status: "failed" });
  });
});
