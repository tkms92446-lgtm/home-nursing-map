/** API 入力値 Validation（zod） */
import { z } from "zod";
import { FILTER_KEYS, SEARCH_RADII } from "./filters";

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const latN = z.number().min(-90).max(90);
const lngN = z.number().min(-180).max(180);

const filtersParam = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(",").filter(Boolean) : []))
  .pipe(z.array(z.enum(FILTER_KEYS as [string, ...string[]])).max(FILTER_KEYS.length));

export const boundsQuerySchema = z
  .object({
    bbox: z
      .string()
      .transform((s) => s.split(",").map(Number))
      .pipe(z.tuple([lngN, latN, lngN, latN])),
    filters: filtersParam,
    // 距離表示用の基準点（地図中心・検索地点）。省略可
    lat: lat.optional(),
    lng: lng.optional(),
    zoom: z.coerce.number().min(0).max(24).optional(),
  })
  .refine((v) => v.bbox[0] < v.bbox[2] && v.bbox[1] < v.bbox[3], { message: "bbox は west,south,east,north の順で指定してください" })
  .refine((v) => v.bbox[2] - v.bbox[0] <= 60 && v.bbox[3] - v.bbox[1] <= 40, { message: "bbox が広すぎます" });

export const nearbyQuerySchema = z.object({
  lat,
  lng,
  radius: z.coerce
    .number()
    .int()
    .refine((r) => (SEARCH_RADII as readonly number[]).includes(r), { message: "radius は 500,1000,3000,5000,10000 のいずれか" }),
  filters: filtersParam,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const geocodeQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, "2文字以上入力してください")
    .max(100, "100文字以内で入力してください"),
});

export function searchParamsToObject(sp: URLSearchParams): Record<string, string> {
  const o: Record<string, string> = {};
  sp.forEach((v, k) => (o[k] = v));
  return o;
}
