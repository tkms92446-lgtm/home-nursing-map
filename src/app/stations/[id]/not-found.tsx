import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="text-xl font-bold">ステーションが見つかりませんでした</h1>
      <p className="mt-2 text-sm text-stone-600">URLをご確認いただくか、地図から探し直してください。</p>
      <Link href="/" className="mt-6 inline-block rounded-full bg-teal-700 px-5 py-2 text-sm font-semibold text-white">地図で探す</Link>
    </main>
  );
}
