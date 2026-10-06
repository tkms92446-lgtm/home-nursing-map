// GET /api/stations/nearby?lat=&lng=&radius=1000&filters=&limit=&offset=
// 検索地点（住所・現在地）から半径内を近い順に返す。座標はログ・DBに保存しない
import { NextResponse, type NextRequest } from "next/server";
import { badRequest, serverError } from "@/lib/api";
import { getPool } from "@/lib/db/pool";
import { filtersToAvailableDays } from "@/lib/stations/filters";
import { searchNearby } from "@/lib/stations/repository";
import { nearbyQuerySchema, searchParamsToObject } from "@/lib/stations/validation";

export async function GET(req: NextRequest) {
  const parsed = nearbyQuerySchema.safeParse(searchParamsToObject(req.nextUrl.searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const { lat, lng, radius, filters, limit, offset } = parsed.data;
    const result = await searchNearby(getPool(), {
      lat,
      lng,
      radius,
      availableDays: filtersToAvailableDays(filters),
      limit,
      offset,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}
