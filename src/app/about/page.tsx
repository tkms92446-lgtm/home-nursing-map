import Link from "next/link";
import { Disclaimer } from "@/components/Disclaimer";
import { getPool } from "@/lib/db/pool";

export const dynamic = "force-dynamic";
export const metadata = { title: "データ出典・利用条件｜訪問看護ステーションMAP" };

export default async function AboutPage() {
  const { rows: sources } = await getPool().query(
    `SELECT ds.name, ds.dataset_name, ds.publisher, ds.url, ds.license, ds.is_fictional,
       (SELECT to_char(max(source_updated_at),'YYYY-MM-DD') FROM stations s WHERE s.source_id = ds.id) AS as_of,
       (SELECT count(*)::int FROM stations s WHERE s.source_id = ds.id) AS n
     FROM data_sources ds ORDER BY ds.is_fictional, ds.id`,
  );
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-3">
          <Link href="/" className="text-sm font-semibold text-teal-800 hover:underline">← 地図で探す</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 text-sm leading-relaxed text-stone-700">
        <h1 className="text-2xl font-bold text-stone-900">データ出典・利用条件</h1>
        <section className="space-y-3">
          <h2 className="text-base font-bold text-stone-900">事業所データ</h2>
          {sources.map((s) => (
            <div key={s.name} className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
              <p className="font-semibold text-stone-900">{s.name}{s.is_fictional && "（架空・開発用）"}</p>
              {s.dataset_name && <p>{s.dataset_name}</p>}
              <p>提供: {s.publisher} / 時点: {s.as_of ?? "—"} / 掲載件数: {s.n}</p>
              {s.license && <p>利用条件: {s.license}</p>}
              {s.url && <a href={s.url} className="break-all text-teal-800 underline" target="_blank" rel="noopener noreferrer">{s.url}</a>}
            </div>
          ))}
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-bold text-stone-900">地図・位置情報</h2>
          <p>地図: 国土地理院「地理院タイル」</p>
          <p>住所の位置: 公的データに記載の緯度経度を優先して使用。記載が無い場合のみ、国土地理院 住所検索API、または Geolonia「japanese-addresses」（CC BY 4.0、国土交通省 位置参照情報等をもとに作成）で住所から算出しています。</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-bold text-stone-900">表示についての注意</h2>
          <p>表示している距離は検索地点からの直線距離で、訪問対応エリアや受入可否を示すものではありません。</p>
          <p>公的データに含まれない情報（訪問対応エリア、新規受入状況、24時間対応、精神科・小児対応など）は「情報なし」と表示し、推測で補うことはしません。</p>
          <p>現在地は検索のためにのみ利用し、保存しません。</p>
        </section>
      </main>
      <Disclaimer />
    </div>
  );
}
