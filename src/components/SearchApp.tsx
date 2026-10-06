"use client";

/**
 * トップページの検索アプリ。
 *   住所・地域から探す / 現在地から探す → 半径内を距離順に表示
 *   地図を動かす → 「このエリアを検索」で表示範囲内を取得
 * 現在地の緯度経度はブラウザ内の状態と検索リクエストにのみ使い、保存しない。
 */
import { useCallback, useRef, useState } from "react";
import { Disclaimer } from "./Disclaimer";
import { StationCard } from "./StationCard";
import { StationMap, type MapBounds, type SearchPoint, type StationMapHandle } from "./StationMap";
import { SEARCH_RADII, STATION_FILTERS } from "@/lib/stations/filters";
import type { SearchResponse } from "@/lib/stations/repository";

type Mode = { kind: "area"; bounds: MapBounds } | { kind: "point"; point: SearchPoint };

const MSG = {
  geoFail: "位置情報を取得できませんでした。住所から検索してください。",
  addressFail: "該当する場所を確認できませんでした。住所を変更してお試しください。",
  empty: "この周辺ではステーションを確認できませんでした。検索範囲を広げてください。",
  emptyArea: "この表示範囲ではステーションを確認できませんでした。地図を動かすか縮小してください。",
  server: "検索中にエラーが発生しました。時間をおいて再度お試しください。",
};

function radiusLabel(r: number) {
  return r < 1000 ? `${r}m` : `${r / 1000}km`;
}

export function SearchApp() {
  const mapRef = useRef<StationMapHandle>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [radius, setRadius] = useState<number>(3000);
  const [filters, setFilters] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapMoved, setMapMoved] = useState(false);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [listPage, setListPage] = useState(0);

  const run = useCallback(
    async (m: Mode, opts: { page?: number; radius?: number; filters?: string[] } = {}) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setError(null);
      const page = opts.page ?? 0;
      const f = (opts.filters ?? filters).join(",");
      const r = opts.radius ?? radius;
      let url: string;
      if (m.kind === "point") {
        const p = new URLSearchParams({
          lat: m.point.lat.toFixed(6),
          lng: m.point.lng.toFixed(6),
          radius: String(r),
          limit: "50",
          offset: String(page * 50),
        });
        if (f) p.set("filters", f);
        url = `/api/stations/nearby?${p}`;
      } else {
        const b = m.bounds;
        const p = new URLSearchParams({
          bbox: [b.west, b.south, b.east, b.north].map((v) => v.toFixed(5)).join(","),
          lat: b.centerLat.toFixed(6),
          lng: b.centerLng.toFixed(6),
        });
        if (f) p.set("filters", f);
        url = `/api/stations?${p}`;
      }
      try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as SearchResponse;
        setResult(data);
        setListPage(page);
        setMapMoved(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(MSG.server);
      } finally {
        if (abortRef.current === ac) setLoading(false);
      }
    },
    [filters, radius],
  );

  // 半径・フィルター変更時は現在のモードで再検索
  function changeRadius(r: number) {
    setRadius(r);
    if (!mode) return;
    if (mode.kind === "point") mapRef.current?.fitToRadius(mode.point.lat, mode.point.lng, r);
    run(mode, { radius: r });
  }

  const startPointSearch = useCallback(
    (point: SearchPoint) => {
      const m: Mode = { kind: "point", point };
      setMode(m);
      setSelectedId(null);
      mapRef.current?.fitToRadius(point.lat, point.lng, radius);
      run(m);
    },
    [radius, run],
  );

  async function onAddressSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    setNotice(null);
    if (q.length < 2) {
      setError("住所・地域を2文字以上入力してください。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        setError(MSG.addressFail);
        setLoading(false);
        return;
      }
      const g = (await res.json()) as { lat: number; lng: number; label: string; approximate: boolean; accuracy: string };
      if (g.approximate || g.accuracy === "city") setNotice(`「${g.label}」付近を中心に表示しています。`);
      startPointSearch({ lat: g.lat, lng: g.lng, label: g.label, kind: "address" });
    } catch {
      setError(MSG.addressFail);
      setLoading(false);
    }
  }

  function onCurrentLocation() {
    setNotice(null);
    setError(null);
    if (!("geolocation" in navigator)) {
      setError(MSG.geoFail);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        startPointSearch({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "現在地", kind: "current" });
      },
      () => {
        setLocating(false);
        setError(MSG.geoFail);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function onSearchThisArea() {
    const b = mapRef.current?.getBounds();
    if (!b) return;
    const m: Mode = { kind: "area", bounds: b };
    setMode(m);
    setSelectedId(null);
    run(m);
  }

  function clearPoint() {
    const b = mapRef.current?.getBounds();
    if (!b) return;
    setNotice(null);
    const m: Mode = { kind: "area", bounds: b };
    setMode(m);
    run(m);
  }

  const onReady = useCallback(
    (b: MapBounds) => {
      const m: Mode = { kind: "area", bounds: b };
      setMode(m);
      run(m);
    },
    [run],
  );

  const onUserMove = useCallback(() => setMapMoved(true), []);

  function selectFromList(id: string) {
    setSelectedId(id);
    const s = result?.list.find((x) => x.id === id);
    if (s) mapRef.current?.focusStation(id, s.latitude, s.longitude);
    setMobileView("map");
  }

  const selectFromMap = useCallback((id: string) => {
    setSelectedId(id);
    // 一覧側の該当カードへフォーカス（描画後にスクロール）
    requestAnimationFrame(() => {
      document.getElementById(`station-card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);

  function toggleFilter(key: string) {
    const next = filters.includes(key) ? filters.filter((k) => k !== key) : [...filters, key];
    setFilters(next);
    if (mode) run(mode, { filters: next });
  }

  const point = mode?.kind === "point" ? mode.point : null;
  const distanceLabel = point ? (point.kind === "current" ? "現在地からの直線距離" : "検索地点からの直線距離") : "地図の中心からの直線距離";
  const total = result?.total ?? 0;
  const list = result?.list ?? [];
  const selectedInList = selectedId && !list.some((s) => s.id === selectedId);
  const emptyMsg = point ? MSG.empty : MSG.emptyArea;

  return (
    <div className="flex h-[100dvh] flex-col bg-stone-50">
      {/* ===== ヘッダー / 検索 ===== */}
      <header className="z-20 border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-2 lg:w-[30%]">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-teal-700 text-lg text-white">＋</span>
            <div>
              <h1 className="text-base font-bold leading-tight text-stone-900 md:text-lg">訪問看護ステーションを探す</h1>
              <p className="text-[11px] text-stone-500">公的オープンデータをもとにした地図検索</p>
            </div>
          </div>
          <form onSubmit={onAddressSearch} className="flex flex-1 flex-col gap-2 sm:flex-row" role="search">
            <label htmlFor="q" className="sr-only">住所・駅・地域</label>
            <div className="relative flex-1">
              <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400">⌕</span>
              <input
                id="q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="住所・駅・地域から訪問看護を探す"
                maxLength={100}
                autoComplete="street-address"
                className="h-11 w-full rounded-full border border-stone-300 bg-white pl-9 pr-4 text-[15px] shadow-sm outline-none placeholder:text-stone-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="h-11 flex-1 whitespace-nowrap rounded-full bg-teal-700 px-5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60 sm:flex-none"
                disabled={loading}
              >
                住所・地域から探す
              </button>
              <button
                type="button"
                onClick={onCurrentLocation}
                className="h-11 flex-1 whitespace-nowrap rounded-full border border-coral-500 bg-white px-5 text-sm font-semibold text-coral-600 shadow-sm hover:bg-coral-50 disabled:opacity-60 sm:flex-none"
                disabled={locating}
              >
                {locating ? "取得中…" : "◎ 現在地から探す"}
              </button>
            </div>
          </form>
        </div>
      </header>

      {/* ===== モバイル: 地図/一覧 切替 ===== */}
      <div className="flex border-b border-stone-200 bg-white md:hidden" role="tablist" aria-label="表示切替">
        {(["map", "list"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={mobileView === v}
            onClick={() => setMobileView(v)}
            className={`flex-1 py-2.5 text-sm font-semibold ${mobileView === v ? "border-b-2 border-teal-700 text-teal-800" : "text-stone-500"}`}
          >
            {v === "map" ? "地図" : `一覧（${total}件）`}
          </button>
        ))}
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* ===== 左: 条件 + 一覧（PC 35%） ===== */}
        <aside
          className={`${mobileView === "list" ? "flex" : "hidden"} min-h-0 w-full flex-col border-r border-stone-200 bg-stone-50 md:flex md:w-[35%] md:min-w-[340px] md:max-w-[520px]`}
          aria-label="検索条件と結果一覧"
        >
          <div className="space-y-3 border-b border-stone-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-stone-500">検索半径</span>
              {SEARCH_RADII.map((r) => (
                <button
                  key={r}
                  onClick={() => changeRadius(r)}
                  aria-pressed={radius === r}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    radius === r ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                  }`}
                >
                  {radiusLabel(r)}
                </button>
              ))}
            </div>
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">利用可能曜日で絞り込み</legend>
              <span className="text-xs font-semibold text-stone-500" title="公的データの「利用可能曜日」の記載で絞り込みます">
                利用可能曜日<span className="ml-1 rounded bg-stone-100 px-1 py-px text-[10px] text-stone-500">公的データ</span>
              </span>
              {STATION_FILTERS.map((f) => (
                <label
                  key={f.key}
                  title={f.description}
                  className={`cursor-pointer select-none rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    filters.includes(f.key) ? "border-amber-500 bg-amber-50 text-amber-800" : "border-stone-200 bg-white text-stone-600 hover:border-stone-300"
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={filters.includes(f.key)} onChange={() => toggleFilter(f.key)} />
                  {f.label}
                </label>
              ))}
            </fieldset>
          </div>

          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <p className="text-sm text-stone-700" aria-live="polite">
              {loading ? (
                "検索中…"
              ) : (
                <>
                  <span className="text-lg font-bold text-stone-900">{total}</span> 件
                  <span className="ml-2 text-xs text-stone-500">
                    {point ? `${point.kind === "current" ? "現在地" : point.label} から ${radiusLabel(radius)} 以内・近い順` : "表示範囲内・地図の中心から近い順"}
                  </span>
                </>
              )}
            </p>
            {point && (
              <button onClick={clearPoint} className="shrink-0 whitespace-nowrap text-xs font-semibold text-stone-500 underline-offset-2 hover:underline">
                地点を解除
              </button>
            )}
          </div>
          {notice && <p className="mx-4 mt-1 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">{notice}</p>}
          {error && (
            <p role="alert" className="mx-4 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <ul ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-2">
            {!loading && !error && result && list.length === 0 && (
              <li className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center text-sm text-stone-600">{emptyMsg}</li>
            )}
            {selectedInList && (
              <li className="text-xs text-stone-500">選択中のステーションは一覧の表示件数外です。地図のポップアップから詳細を確認できます。</li>
            )}
            {list.map((s) => (
              <StationCard key={s.id} station={s} selected={s.id === selectedId} distanceLabel={distanceLabel} onSelect={() => selectFromList(s.id)} />
            ))}
            {result && result.mode === "points" && point && total > (listPage + 1) * 50 && (
              <li className="flex justify-center gap-2 pt-1">
                <button onClick={() => mode && run(mode, { page: listPage + 1 })} className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-stone-200">
                  次の50件
                </button>
              </li>
            )}
            {point && listPage > 0 && (
              <li className="flex justify-center">
                <button onClick={() => mode && run(mode, { page: listPage - 1 })} className="text-xs text-stone-500 underline">
                  前の50件
                </button>
              </li>
            )}
            {!point && total > list.length && (
              <li className="text-center text-xs text-stone-500">地図の中心に近い {list.length} 件を表示しています。住所や現在地で絞り込むと便利です。</li>
            )}
            <li className="pt-2 text-[11px] leading-relaxed text-stone-400">
              距離は{distanceLabel.replace("の直線距離", "")}からの直線距離です。訪問対応エリアや受入可否を示すものではありません。
            </li>
          </ul>
        </aside>

        {/* ===== 右: 地図（PC 65%） ===== */}
        <section className={`${mobileView === "map" ? "block" : "hidden"} relative min-h-0 flex-1 md:block`}>
          <StationMap
            ref={mapRef}
            points={result?.points ?? []}
            clusters={result?.clusters ?? []}
            selectedId={selectedId}
            searchPoint={point}
            radiusM={point ? radius : null}
            onSelect={selectFromMap}
            onReady={onReady}
            onUserMove={onUserMove}
          />
          {mapMoved && (
            <button
              onClick={onSearchThisArea}
              className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 shadow-lg ring-1 ring-stone-200 hover:bg-stone-50"
            >
              ↻ このエリアを検索
            </button>
          )}
          {result?.mode === "aggregate" && (
            <p className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/95 px-4 py-1.5 text-xs text-stone-700 shadow">
              件数が多いため集約表示中。拡大すると個別に表示されます
            </p>
          )}
          {loading && (
            <div className="absolute right-14 top-4 z-10 rounded-full bg-white/95 px-3 py-1.5 text-xs text-stone-600 shadow">読み込み中…</div>
          )}
          <button
            onClick={() => setMobileView("list")}
            className="absolute bottom-8 right-4 z-10 rounded-full bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg md:hidden"
          >
            一覧を見る（{total}件）
          </button>
        </section>
      </div>
      <Disclaimer compact />
    </div>
  );
}
