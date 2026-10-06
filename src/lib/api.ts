import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function badRequest(error: ZodError) {
  return NextResponse.json(
    { error: "入力内容を確認してください", details: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
    { status: 400 },
  );
}

export function serverError(e: unknown) {
  console.error(e);
  return NextResponse.json({ error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" }, { status: 500 });
}
