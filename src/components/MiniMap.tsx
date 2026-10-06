"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { loadMaplibre } from "@/lib/load-maplibre";
import { getMapStyle } from "@/lib/map-style";

/** 詳細ページ用の小さな地図（1地点） */
export function MiniMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("maplibre-gl").Map | null = null;
    let cancelled = false;
    (async () => {
      const lib = await loadMaplibre();
      if (cancelled || !ref.current) return;
      map = new lib.Map({ container: ref.current, style: getMapStyle(), center: [lng, lat], zoom: 15, attributionControl: { compact: true } });
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      const el = document.createElement("div");
      el.className = "hnm-search-marker";
      el.title = label;
      new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lng, label]);
  return <div ref={ref} className="h-64 w-full overflow-hidden rounded-2xl border border-stone-200" role="img" aria-label={`${label}の位置`} />;
}
