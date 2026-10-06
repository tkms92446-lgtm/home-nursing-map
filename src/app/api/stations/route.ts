// GET /api/stations?bbox=west,south,east,north&filters=sat,sun&lat=&lng=
// 地図の表示範囲内の事業所のみ返す
import { NextResponse, type NextRequest } from "next/server";
import { badRequest, serverError } from "@/lib/api";
import { getPool } from "@/lib/db/pool";
import { filtersToAvailableDays } from "@/lib/stations/filters";
import { searchInBounds } from "@/lib/stations/repository";
import { boundsQuerySchema, searchParamsToObject } from "@/lib/stations/validation";

export async function GET(req: NextRequest) {
  const parsed = boundsQuerySchema.safeParse(searchParamsToObject(req.nextUrl.searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const { bbox, filters, lat, lng } = parsed.data;
    const result = await searchInBounds(getPool(), {
      bbox: bbox as [number, number, number, number],
      availableDays: filtersToAvailableDays(filters),
      refLat: lat,
      refLng: lng,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}
