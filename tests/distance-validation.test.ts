import { describe, expect, it } from "vitest";
import { bboxAround, formatDistance, haversineMeters } from "@/lib/geo/distance";
import { boundsQuerySchema, geocodeQuerySchema, nearbyQuerySchema } from "@/lib/stations/validation";

describe("距離計算", () => {
  it("天王寺駅〜大阪上本町駅は約1.8km", () => {
    const d = haversineMeters(34.6466, 135.5139, 34.6635, 135.5212);
    expect(d).toBeGreaterThan(1800);
    expect(d).toBeLessThan(2100);
  });
  it("同一地点は0m", () => {
    expect(haversineMeters(34.6, 135.5, 34.6, 135.5)).toBe(0);
  });
  it("表示形式", () => {
    expect(formatDistance(842)).toBe("840m");
    expect(formatDistance(1234)).toBe("1.2km");
    expect(formatDistance(12_345)).toBe("12km");
  });
  it("半径を含む bbox", () => {
    const b = bboxAround(34.65, 135.5, 1000);
    expect(haversineMeters(34.65, 135.5, b.north, 135.5)).toBeCloseTo(1000, 0);
    expect(haversineMeters(34.65, 135.5, 34.65, b.east)).toBeCloseTo(1000, -1);
  });
});

describe("API validation", () => {
  it("bbox を検証する", () => {
    expect(boundsQuerySchema.safeParse({ bbox: "135.49,34.63,135.55,34.68" }).success).toBe(true);
    expect(boundsQuerySchema.safeParse({ bbox: "135.55,34.63,135.49,34.68" }).success).toBe(false); // 逆順
    expect(boundsQuerySchema.safeParse({ bbox: "1,2,3" }).success).toBe(false);
    expect(boundsQuerySchema.safeParse({ bbox: "abc,1,2,3" }).success).toBe(false);
    expect(boundsQuerySchema.safeParse({ bbox: "100,0,170,45" }).success).toBe(false); // 広すぎる
    expect(boundsQuerySchema.safeParse({ bbox: "135.49,34.63,135.55,34.68", filters: "sat,xxx" }).success).toBe(false);
  });
  it("検索半径は 500m/1km/3km/5km/10km のみ", () => {
    for (const r of [500, 1000, 3000, 5000, 10000]) {
      expect(nearbyQuerySchema.safeParse({ lat: "34.6", lng: "135.5", radius: String(r) }).success).toBe(true);
    }
    expect(nearbyQuerySchema.safeParse({ lat: "34.6", lng: "135.5", radius: "50000" }).success).toBe(false);
    expect(nearbyQuerySchema.safeParse({ lat: "200", lng: "135.5", radius: "1000" }).success).toBe(false);
    const p = nearbyQuerySchema.parse({ lat: "34.6", lng: "135.5", radius: "1000", filters: "sat,hol" });
    expect(p).toMatchObject({ limit: 50, offset: 0, filters: ["sat", "hol"] });
  });
  it("住所検索の入力長", () => {
    expect(geocodeQuerySchema.safeParse({ q: "天" }).success).toBe(false);
    expect(geocodeQuerySchema.safeParse({ q: "天王寺区" }).success).toBe(true);
    expect(geocodeQuerySchema.safeParse({ q: "あ".repeat(101) }).success).toBe(false);
  });
});
