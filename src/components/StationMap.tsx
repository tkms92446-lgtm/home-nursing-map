"use client";

/**
 * MapLibre GL による地図。
 *  - 事業所ピン（GeoJSON source + クライアント側 Marker clustering）
 *  - 広域表示時はサーバー集約クラスタ（aggregate）を表示
 *  - 検索地点 / 現在地の専用マーカー、検索半径の半透明円
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { GeoJSONSource, Map as MlMap, Marker, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { circlePolygon, bboxAround } from "@/lib/geo/distance";
import { loadMaplibre } from "@/lib/load-maplibre";
import { DEFAULT_VIEW, getMapStyle } from "@/lib/map-style";
import type { MapCluster, MapPoint } from "@/lib/stations/repository";

export interface SearchPoint {
  lat: number;
  lng: number;
  label: string;
  kind: "address" | "current";
}

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
  centerLat: number;
  centerLng: number;
  zoom: number;
}

export interface StationMapHandle {
  fitToRadius(lat: number, lng: number, radiusM: number): void;
  focusStation(id: string, lat: number, lng: number): void;
  getBounds(): MapBounds | null;
}

interface Props {
  points: MapPoint[];
  clusters: MapCluster[];
  selectedId: string | null;
  searchPoint: SearchPoint | null;
  radiusM: number | null;
  onSelect(id: string): void;
  onReady(bounds: MapBounds): void;
  onUserMove(bounds: MapBounds): void;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const COLOR_STATION = "#0f766e"; // teal-700
const COLOR_SELECTED = "#e8573f"; // coral

function toFC(points: MapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { id: p.id, name: p.name },
    })),
  };
}

function readBounds(map: MlMap): MapBounds {
  const b = map.getBounds();
  const c = map.getCenter();
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth(), centerLat: c.lat, centerLng: c.lng, zoom: map.getZoom() };
}

function clusterEl(count: number): HTMLDivElement {
  const el = document.createElement("div");
  const size = count < 10 ? 34 : count < 100 ? 42 : count < 1000 ? 50 : 58;
  el.className = "hnm-cluster";
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.textContent = count >= 1000 ? `${Math.round(count / 100) / 10}k` : String(count);
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `${count}件のステーション。クリックで拡大`);
  return el;
}

export const StationMap = forwardRef<StationMapHandle, Props>(function StationMap(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const programmatic = useRef(false);
  const clusterMarkers = useRef(new Map<string, Marker>());
  const aggregateMarkers = useRef<Marker[]>([]);
  const searchMarker = useRef<Marker | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const pointsRef = useRef<MapPoint[]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;

  useImperativeHandle(ref, () => ({
    fitToRadius(lat, lng, radiusM) {
      const map = mapRef.current;
      if (!map) return;
      const b = bboxAround(lat, lng, radiusM);
      programmatic.current = true;
      map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 40, duration: 600, maxZoom: 16 });
    },
    focusStation(id, lat, lng) {
      const map = mapRef.current;
      if (!map) return;
      programmatic.current = true;
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15), duration: 500 });
      showPopup(id, lat, lng);
    },
    getBounds() {
      return mapRef.current ? readBounds(mapRef.current) : null;
    },
  }));

  function showPopup(id: string, lat: number, lng: number) {
    const lib = libRef.current;
    const map = mapRef.current;
    if (!lib || !map) return;
    const p = pointsRef.current.find((x) => x.id === id);
    const el = document.createElement("div");
    el.className = "hnm-popup";
    const title = document.createElement("div");
    title.className = "hnm-popup-title";
    title.textContent = p?.name ?? "";
    const link = document.createElement("a");
    link.href = `/stations/${encodeURIComponent(id)}`;
    link.textContent = "詳細を見る →";
    link.className = "hnm-popup-link";
    el.append(title, link);
    popupRef.current?.remove();
    popupRef.current = new lib.Popup({ offset: 12, closeButton: true, maxWidth: "260px" }).setLngLat([lng, lat]).setDOMContent(el).addTo(map);
  }

  // 初期化
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    (async () => {
      const lib = await loadMaplibre();
      if (cancelled || !containerRef.current) return;
      libRef.current = lib;
      map = new lib.Map({
        container: containerRef.current,
        style: getMapStyle(),
        center: [DEFAULT_VIEW.lng, DEFAULT_VIEW.lat],
        zoom: DEFAULT_VIEW.zoom,
        minZoom: 4,
        maxZoom: 18,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      // 開発時のみ: E2E 確認用に地図インスタンスを参照可能にする
      if (process.env.NODE_ENV !== "production") (window as unknown as { __hnmMap?: MlMap }).__hnmMap = map;
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new lib.ScaleControl({ unit: "metric" }), "bottom-left");

      map.on("load", () => {
        const m = map!;
        m.addSource("radius", { type: "geojson", data: EMPTY_FC });
        m.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": COLOR_SELECTED, "fill-opacity": 0.06 } });
        m.addLayer({ id: "radius-line", type: "line", source: "radius", paint: { "line-color": COLOR_SELECTED, "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.6 } });

        m.addSource("stations", { type: "geojson", data: EMPTY_FC, cluster: true, clusterRadius: 48, clusterMaxZoom: 14 });
        // クラスタ本体は HTML マーカーで描く（フォント配信に依存しないため）。ヒット判定用の透明円
        m.addLayer({ id: "clusters-hit", type: "circle", source: "stations", filter: ["has", "point_count"], paint: { "circle-radius": 20, "circle-opacity": 0 } });
        m.addLayer({
          id: "stations-point",
          type: "circle",
          source: "stations",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 15, 8],
            "circle-color": COLOR_STATION,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        m.addLayer({
          id: "stations-selected",
          type: "circle",
          source: "stations",
          filter: ["==", ["get", "id"], ""],
          paint: { "circle-radius": 11, "circle-color": COLOR_SELECTED, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
        });

        m.on("click", "stations-point", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const id = String(f.properties?.id);
          const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
          propsRef.current.onSelect(id);
          showPopup(id, lat, lng);
        });
        m.on("mouseenter", "stations-point", () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", "stations-point", () => (m.getCanvas().style.cursor = ""));
        m.on("render", () => updateClusterMarkers());
        propsRef.current.onReady(readBounds(m));
        syncData();
      });

      map.on("moveend", () => {
        if (programmatic.current) {
          programmatic.current = false;
          return;
        }
        propsRef.current.onUserMove(readBounds(map!));
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  function updateClusterMarkers() {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !map.getSource("stations")) return;
    const seen = new Set<string>();
    for (const f of map.querySourceFeatures("stations")) {
      const pr = f.properties;
      if (!pr?.cluster) continue;
      const cid = String(pr.cluster_id);
      if (seen.has(cid)) continue;
      seen.add(cid);
      if (!clusterMarkers.current.has(cid)) {
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const el = clusterEl(Number(pr.point_count));
        el.addEventListener("click", async () => {
          const src = map.getSource("stations") as GeoJSONSource;
          const zoom = await src.getClusterExpansionZoom(Number(pr.cluster_id));
          programmatic.current = false;
          map.easeTo({ center: [lng, lat], zoom: Math.min(zoom, 17) });
        });
        clusterMarkers.current.set(cid, new lib.Marker({ element: el }).setLngLat([lng, lat]).addTo(map));
      }
    }
    for (const [cid, mk] of clusterMarkers.current) {
      if (!seen.has(cid)) {
        mk.remove();
        clusterMarkers.current.delete(cid);
      }
    }
  }

  function syncData() {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !map.getSource("stations")) return;
    const { points, clusters } = propsRef.current;
    pointsRef.current = points;
    for (const mk of clusterMarkers.current.values()) mk.remove();
    clusterMarkers.current.clear();
    (map.getSource("stations") as GeoJSONSource).setData(toFC(points));

    for (const mk of aggregateMarkers.current) mk.remove();
    aggregateMarkers.current = clusters.map((c) => {
      const el = clusterEl(c.count);
      el.classList.add("hnm-cluster-aggregate");
      el.addEventListener("click", () => map.easeTo({ center: [c.lng, c.lat], zoom: map.getZoom() + 2 }));
      return new lib.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
    });
  }

  // データ更新
  useEffect(() => {
    syncData();
  }, [props.points, props.clusters]);

  // 選択状態
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("stations-selected")) return;
    map.setFilter("stations-selected", ["==", ["get", "id"], props.selectedId ?? ""]);
  }, [props.selectedId]);

  // 検索地点マーカーと半径円
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib) return;
    searchMarker.current?.remove();
    searchMarker.current = null;
    const sp = props.searchPoint;
    const radiusSrc = map.getSource("radius") as GeoJSONSource | undefined;
    if (!sp) {
      radiusSrc?.setData(EMPTY_FC);
      return;
    }
    const el = document.createElement("div");
    el.className = sp.kind === "current" ? "hnm-current-marker" : "hnm-search-marker";
    el.setAttribute("aria-label", sp.kind === "current" ? "現在地" : `検索地点: ${sp.label}`);
    el.title = sp.kind === "current" ? "現在地" : sp.label;
    searchMarker.current = new lib.Marker({ element: el, anchor: sp.kind === "current" ? "center" : "bottom" })
      .setLngLat([sp.lng, sp.lat])
      .addTo(map);
    if (props.radiusM) {
      radiusSrc?.setData({ type: "Feature", geometry: circlePolygon(sp.lat, sp.lng, props.radiusM), properties: {} });
    }
  }, [props.searchPoint, props.radiusM]);

  return <div ref={containerRef} className="h-full w-full" role="region" aria-label="訪問看護ステーションの地図" />;
});
