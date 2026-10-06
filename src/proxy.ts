// /admin の簡易 Basic 認証（MVP）。ADMIN_PASSWORD 未設定時はローカル開発用に素通し
import { NextResponse, type NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return NextResponse.next();
  const user = process.env.ADMIN_USER ?? "admin";
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const [u, p] = atob(header.slice(6)).split(":");
    if (u === user && p === password) return NextResponse.next();
  }
  return new NextResponse("認証が必要です", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="admin", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/admin/:path*"] };
