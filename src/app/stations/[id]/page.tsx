import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Disclaimer } from "@/components/Disclaimer";
import { MiniMap } from "@/components/MiniMap";
import { getPool } from "@/lib/db/pool";
import { getStation, type StationDetail } from "@/lib/stations/repository";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const s = await getStation(getPool(), id);
  return { title: s ? `${s.name}｜訪問看護ステーションMAP` : "ステーションが見つかりません" };
}

const NONE = <span className="text-stone-400">情報なし</span>;

function Row({ label, children, official = true }: { label: string; children: React.ReactNode; official?: boolean }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 border-b border-stone-100 py-3 text-sm last:border-0 sm:grid-cols-[10rem_1fr]">
      <dt className="flex items-start gap-1.5 font-medium text-stone-500">
        {label}
        {official && <span className="mt-0.5 rounded bg-teal-50 px-1 py-px text-[10px] font-semibold text-teal-700">公的データ</span>}
      </dt>
      <dd className="break-words text-stone-900">{children}</dd>
    </div>
  );
}

const ACCURACY_LABEL: Record<string, string> = {
  official: "公的データ記載の座標",
  address: "住所から算出（住居番号）",
  block: "住所から算出（街区代表点）",
  town: "住所から算出（町丁目の代表点）",
  city: "住所から算出（市区町村の代表点）",
};

/** 将来、事業所が登録する情報（MVPでは未登録＝情報なし） */
const PROFILE_ITEMS = ["訪問対応エリア", "新規受入状況", "24時間対応", "精神科", "小児", "終末期・看取り", "PT・OT・ST", "スタッフ構成"];

export default async function StationPage({ params }: Params) {
  const { id } = await params;
  const s: StationDetail | null = await getStation(getPool(), id);
  if (!s) notFound();

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-sm font-semibold text-teal-800 hover:underline">
            ← 地図で探す
          </Link>
          <span className="text-xs text-stone-500">訪問看護ステーションMAP</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        {s.isFictional && (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            これはUI確認用の架空データです。実在する事業所ではありません。
          </p>
        )}
        {s.status !== "active" && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            最新の公的データに掲載されていません（廃止・休止等の可能性があります）。事業所へ直接ご確認ください。
          </p>
        )}

        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">{s.serviceType}</span>
            <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600">事業所番号 {s.officialProviderId}</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-stone-900">{s.name}</h1>
          {s.nameKana && <p className="text-xs text-stone-500">{s.nameKana}</p>}
          <p className="mt-3 text-sm text-stone-700">{s.fullAddress}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {s.phone && (
              <a href={`tel:${s.phone}`} className="rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
                ☎ {s.phone} に電話
              </a>
            )}
            {s.websiteUrl && (
              <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer nofollow" className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                Webサイト ↗
              </a>
            )}
          </div>
        </section>

        {s.latitude != null && s.longitude != null && s.geocodingStatus !== "failed" && (
          <section className="space-y-2">
            <MiniMap lat={s.latitude} lng={s.longitude} label={s.name} />
            <p className="text-xs text-stone-500">
              地図上の位置: {s.geocodingAccuracy ? ACCURACY_LABEL[s.geocodingAccuracy] ?? s.geocodingAccuracy : "情報なし"}
              {s.geocodingStatus === "needs_review" && "（位置の精度を確認中）"}
            </p>
          </section>
        )}

        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200 sm:p-7">
          <h2 className="mb-2 text-base font-bold text-stone-900">基本情報</h2>
          <dl>
            <Row label="事業所名">{s.name}</Row>
            <Row label="法人名">{s.corporationName ?? NONE}</Row>
            <Row label="郵便番号">{s.postalCode ?? NONE}</Row>
            <Row label="住所">{s.fullAddress}</Row>
            <Row label="電話番号">{s.phone ?? NONE}</Row>
            <Row label="FAX番号">{s.fax ?? NONE}</Row>
            <Row label="サービス種別">{s.serviceType}</Row>
            <Row label="利用可能曜日">{s.availableDays.length ? s.availableDays.join("・") : NONE}</Row>
            {s.availableDaysNote && <Row label="曜日の特記事項">{s.availableDaysNote}</Row>}
            {/* 訪問看護には通所系のような定員の概念が無く、元データは多くが空欄または「0」のため、値がある場合のみ表示 */}
            {s.capacity && s.capacity !== "0" && <Row label="定員">{s.capacity}</Row>}
            <Row label="共生型サービス">{s.kyoseigata ?? NONE}</Row>
            <Row label="Webサイト">
              {s.websiteUrl ? (
                <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-teal-800 underline">
                  {s.websiteUrl}
                </a>
              ) : (
                NONE
              )}
            </Row>
            {s.remarks && <Row label="備考">{s.remarks}</Row>}
          </dl>
        </section>

        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200 sm:p-7">
          <h2 className="text-base font-bold text-stone-900">対応内容・受入状況</h2>
          <p className="mt-1 text-xs text-stone-500">
            以下は現在の公的データに含まれないため表示していません。推測による表示は行いません。利用可否は事業所へ直接ご確認ください。
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {PROFILE_ITEMS.map((i) => (
              <li key={i} className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-500">
                {i}：－ 情報なし
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl bg-stone-100 p-5 text-sm text-stone-700 sm:p-7">
          <h2 className="text-base font-bold text-stone-900">データ出典</h2>
          <dl className="mt-2 space-y-1">
            <div><dt className="inline font-semibold">出典：</dt><dd className="inline">{s.sourceName}</dd></div>
            {s.sourceDatasetName && <div><dt className="inline font-semibold">データ名称：</dt><dd className="inline">{s.sourceDatasetName}</dd></div>}
            <div><dt className="inline font-semibold">公的データ最終更新日：</dt><dd className="inline">{s.sourceUpdatedAt ? `${s.sourceUpdatedAt} 時点` : "情報なし"}</dd></div>
            <div><dt className="inline font-semibold">本サービスへの取込日時：</dt><dd className="inline">{s.importedAt}</dd></div>
            {s.sourceLicense && <div><dt className="inline font-semibold">利用条件：</dt><dd className="inline">{s.sourceLicense}</dd></div>}
            {s.sourceUrl && (
              <div>
                <dt className="inline font-semibold">取得元：</dt>
                <dd className="inline"><a className="break-all underline" href={s.sourceUrl} target="_blank" rel="noopener noreferrer">{s.sourceUrl}</a></dd>
              </div>
            )}
          </dl>
        </section>
      </main>
      <Disclaimer />
    </div>
  );
}
