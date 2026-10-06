import Link from "next/link";
import { getPool } from "@/lib/db/pool";
import { getAdminStats } from "@/lib/stations/admin-stats";

export const dynamic = "force-dynamic";
export const metadata = { title: "管理画面｜訪問看護ステーションMAP", robots: { index: false } };

function Stat({ label, value, tone = "stone" }: { label: string; value: number | string; tone?: "stone" | "teal" | "rose" | "amber" }) {
  const tones = { stone: "text-stone-900", teal: "text-teal-700", rose: "text-rose-600", amber: "text-amber-600" };
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{typeof value === "number" ? value.toLocaleString() : value}</p>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number | null)[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-stone-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs text-stone-500">
          <tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td className="px-3 py-3 text-stone-400" colSpan={head.length}>データなし</td></tr>}
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-stone-100">
              {r.map((c, j) => <td key={j} className="whitespace-nowrap px-3 py-2">{c ?? "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminPage() {
  const s = await getAdminStats(getPool());
  const last = s.imports[0];
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <h1 className="font-bold">管理画面</h1>
          <Link href="/" className="text-sm text-teal-800 underline">地図へ</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="登録事業所総数" value={s.totals.total} />
          <Stat label="掲載中" value={s.totals.active} tone="teal" />
          <Stat label="掲載終了の可能性" value={s.totals.inactiveCandidate} tone="amber" />
          <Stat label="最終import" value={last?.finishedAt ?? "—"} />
          <Stat label="Geocoding 成功" value={s.geocoding.success} tone="teal" />
          <Stat label="Geocoding 失敗" value={s.geocoding.failed} tone="rose" />
          <Stat label="Geocoding 待機" value={s.geocoding.pending} />
          <Stat label="Geocoding 要確認" value={s.geocoding.needsReview} tone="amber" />
        </section>

        {last && (
          <section className="space-y-2">
            <h2 className="font-bold">最新の import 結果</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="対象件数" value={last.total} />
              <Stat label="新規" value={last.inserted} tone="teal" />
              <Stat label="更新" value={last.updated} />
              <Stat label="変更なし" value={last.unchanged} />
              <Stat label="エラー" value={last.errors} tone="rose" />
            </div>
            <p className="text-xs text-stone-500">{last.source} / {last.fileName} / データ時点 {last.sourceUpdatedAt ?? "—"} / 範囲 {last.scope}</p>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="font-bold">データソース</h2>
          <Table head={["コード", "名称", "件数", "架空", "利用条件"]} rows={s.sources.map((x) => [x.code, x.name, x.stations, x.isFictional ? "架空" : "", x.license])} />
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="space-y-2">
            <h2 className="font-bold">都道府県別件数</h2>
            <Table head={["都道府県", "件数"]} rows={s.byPrefecture.map((x) => [x.prefecture, x.count])} />
          </section>
          <section className="space-y-2">
            <h2 className="font-bold">市区町村別件数（上位100）</h2>
            <div className="max-h-96 overflow-y-auto">
              <Table head={["都道府県", "市区町村", "件数"]} rows={s.byCity.map((x) => [x.prefecture, x.city, x.count])} />
            </div>
          </section>
        </div>

        <section className="space-y-2">
          <h2 className="font-bold">import 履歴</h2>
          <Table
            head={["ID", "ソース", "ファイル", "時点", "範囲", "状態", "対象", "新規", "更新", "変更なし", "エラー", "掲載終了候補", "完了"]}
            rows={s.imports.map((r) => [r.id, r.source, r.fileName, r.sourceUpdatedAt, r.scope, r.status, r.total, r.inserted, r.updated, r.unchanged, r.errors, r.inactiveCandidates, r.finishedAt])}
          />
        </section>

        <section className="space-y-2">
          <h2 className="font-bold">Geocoding 失敗・要確認</h2>
          <p className="text-xs text-stone-500">再試行: <code>npm run geocode -- --retry-failed</code></p>
          <Table head={["ID", "事業所名", "住所", "状態", "試行", "理由"]} rows={s.geocodeIssues.map((x) => [x.id, x.name, x.fullAddress, x.status, x.attempts, x.error])} />
        </section>

        <section className="space-y-2">
          <h2 className="font-bold">外部Geocoding API 実行件数（日別）</h2>
          <Table head={["日付", "プロバイダ", "回数"]} rows={s.apiUsage.map((x) => [x.day, x.provider, x.calls])} />
        </section>
      </main>
    </div>
  );
}
