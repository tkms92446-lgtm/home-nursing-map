import Link from "next/link";

export const DISCLAIMER =
  "本サービスの情報は公的オープンデータ等をもとに構成しています。最新の情報や実際の訪問対応可否については各事業所へ直接ご確認ください。";

export function Disclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <footer className="border-t border-stone-200 bg-white px-4 py-1.5 text-[10.5px] leading-snug text-stone-500 md:px-6">
        {DISCLAIMER}
        <span className="ml-2 whitespace-nowrap">
          出典: <Link href="/about" className="underline">データについて</Link>
        </span>
      </footer>
    );
  }
  return (
    <footer className="mt-12 border-t border-stone-200 bg-white">
      <div className="mx-auto max-w-4xl space-y-2 px-4 py-6 text-xs leading-relaxed text-stone-500">
        <p>{DISCLAIMER}</p>
        <p>
          <Link href="/" className="underline">地図で探す</Link>
          <span className="mx-2">·</span>
          <Link href="/about" className="underline">データ出典・利用条件</Link>
        </p>
      </div>
    </footer>
  );
}
