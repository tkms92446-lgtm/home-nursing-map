/**
 * 地図スタイル設定。NEXT_PUBLIC_MAP_STYLE で切り替え（コード変更なしでタイル提供元を移行できる）。
 *   gsi-pale : 地理院タイル（淡色地図）… 既定。無料・APIキー不要・出典表示で商用利用可
 *   gsi-std  : 地理院タイル（標準地図）
 *   osm      : OpenStreetMap 公式タイル … 開発・少量アクセス専用（大規模利用は利用規約上不可）
 *   https://…/style.json : 自前 PMTiles / MapTiler / 他社の MapLibre スタイル
 */
import type { StyleSpecification } from "maplibre-gl";

function rasterStyle(tiles: string, attribution: string, maxzoom = 18): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: { type: "raster", tiles: [tiles], tileSize: 256, attribution, maxzoom },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';

export function getMapStyle(): StyleSpecification | string {
  const v = process.env.NEXT_PUBLIC_MAP_STYLE ?? "gsi-pale";
  if (v.startsWith("https://")) return v;
  if (v === "osm") {
    return rasterStyle(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      19,
    );
  }
  if (v === "gsi-std") return rasterStyle("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", GSI_ATTR);
  return rasterStyle("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", GSI_ATTR);
}

export const DEFAULT_VIEW = {
  lat: Number(process.env.NEXT_PUBLIC_DEFAULT_LAT ?? 34.6545),
  lng: Number(process.env.NEXT_PUBLIC_DEFAULT_LNG ?? 135.519),
  zoom: Number(process.env.NEXT_PUBLIC_DEFAULT_ZOOM ?? 13),
};
