// GET /api/geocode?q=大阪市天王寺区上本町6丁目
// 検索ボックスの住所・地域を座標に変換（サーバー側で実行し、APIキー等をクライアントに出さない）
import { NextResponse, type NextRequest } from "next/server";
import { badRequest } from "@/lib/api";
import { geocodeSearchQuery } from "@/lib/geocoding/search-geocoding";
import { geocodeQuerySchema, searchParamsToObject } from "@/lib/stations/validation";

const NOT_FOUND = "該当する場所を確認できませんでした。住所を変更してお試しください。";

export async function GET(req: NextRequest) {
  const parsed = geocodeQuerySchema.safeParse(searchParamsToObject(req.nextUrl.searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const r = await geocodeSearchQuery(parsed.data.q);
    if (r.latitude == null || r.longitude == null || r.status === "failed") {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    return NextResponse.json(
      { lat: r.latitude, lng: r.longitude, label: r.matchedText ?? parsed.data.q, accuracy: r.accuracy, provider: r.provider, approximate: r.status !== "success" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }
}
