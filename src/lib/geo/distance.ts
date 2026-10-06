/** 距離・範囲計算（サーバー・クライアント共通） */

const EARTH_RADIUS_M = 6_371_008.8;

/** 2点間の直線距離（大圏距離, m） */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 表示用: 850m / 1.2km / 12km */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "";
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters / 1000)}km`;
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** 中心と半径(m)から外接 bbox を求める（地図のズーム合わせ用） */
export function bboxAround(lat: number, lng: number, radiusM: number): BBox {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  return { west: lng - dLng, south: lat - dLat, east: lng + dLng, north: lat + dLat };
}

/** 半径の円を GeoJSON Polygon で近似（地図に半透明で表示） */
export function circlePolygon(lat: number, lng: number, radiusM: number, steps = 64): GeoJSON.Polygon {
  const coords: [number, number][] = [];
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return { type: "Polygon", coordinates: [coords] };
}
