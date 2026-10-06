"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { formatDistance } from "@/lib/geo/distance";
import type { StationListItem } from "@/lib/stations/repository";

interface Props {
  station: StationListItem;
  selected: boolean;
  distanceLabel: string;
  onSelect(): void;
}

export const StationCard = forwardRef<HTMLLIElement, Props>(function StationCard({ station: s, selected, distanceLabel, onSelect }, ref) {
  const weekendDays = s.availableDays.filter((d) => d !== "平日");
  return (
    <li
      ref={ref}
      id={`station-card-${s.id}`}
      className={`group rounded-2xl border bg-white p-4 shadow-sm transition ${
        selected ? "border-coral-500 ring-2 ring-coral-200" : "border-stone-200 hover:border-stone-300 hover:shadow"
      }`}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left" aria-pressed={selected}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-semibold leading-snug text-stone-900">{s.name}</h3>
          {s.distanceM != null && (
            <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700" title={distanceLabel}>
              {formatDistance(s.distanceM)}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-stone-600">{s.fullAddress}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-md bg-teal-50 px-2 py-0.5 font-medium text-teal-800">{s.serviceType}</span>
          {weekendDays.map((d) => (
            <span key={d} className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-800" title="公的データの利用可能曜日">
              {d}可
            </span>
          ))}
          {s.isFictional && <span className="rounded-md bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">架空データ</span>}
        </div>
      </button>
      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        {s.phone ? (
          <a href={`tel:${s.phone}`} className="font-medium text-teal-800 hover:underline">
            ☎ {s.phone}
          </a>
        ) : (
          <span className="text-stone-400">電話番号 情報なし</span>
        )}
        <Link
          href={`/stations/${s.id}`}
          className="rounded-full bg-stone-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-stone-700"
        >
          詳細を見る
        </Link>
      </div>
      <p className="mt-2 text-[11px] text-stone-400">
        公的データ {s.sourceUpdatedAt ? `${s.sourceUpdatedAt} 時点` : "更新日 情報なし"}
      </p>
    </li>
  );
});
