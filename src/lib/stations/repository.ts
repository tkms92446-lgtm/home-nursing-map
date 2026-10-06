/**
 * 事業所検索クエリ（PostGIS）。
 *  - map bounds 内のみ取得（全件をブラウザへ送らない）
 *  - 件数が多い広域表示ではサーバー側でグリッド集約して返す
 *  - 距離は検索地点からの直線距離（訪問可否とは無関係）
 */
import type { Pool } from "pg";

export const MAX_POINTS = Number(process.env.MAX_MAP_POINTS ?? 2000);
export const LIST_LIMIT = 50;

/** 地図・一覧に表示する条件: 掲載中 & 座標確定 */
const VISIBLE = `s.status = 'active' AND s.geocoding_status = 'success' AND s.location IS NOT NULL`;

export interface StationListItem {
  id: string;
  name: string;
  fullAddress: string;
  phone: string | null;
  serviceType: string;
  availableDays: string[];
  sourceName: string;
  sourceUpdatedAt: string | null;
  isFictional: boolean;
  latitude: number;
  longitude: number;
  distanceM: number | null;
}

export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface MapCluster {
  lat: number;
  lng: number;
  count: number;
}

export interface SearchResponse {
  mode: "points" | "aggregate";
  total: number;
  points: MapPoint[];
  clusters: MapCluster[];
  list: StationListItem[];
  listOffset: number;
  listLimit: number;
}

const LIST_COLUMNS = (refLng: string, refLat: string) => `
  s.id::text AS id, s.name, s.full_address AS "fullAddress", s.phone, s.service_type AS "serviceType",
  o.available_days AS "availableDays", ds.name AS "sourceName",
  to_char(s.source_updated_at, 'YYYY-MM-DD') AS "sourceUpdatedAt", ds.is_fictional AS "isFictional",
  s.latitude, s.longitude,
  CASE WHEN ${refLat}::float8 IS NULL THEN NULL
       ELSE ST_Distance(s.location, ST_SetSRID(ST_MakePoint(${refLng}::float8, ${refLat}::float8), 4326)::geography) END
    AS "distanceM"`;

const FROM = `FROM stations s
  JOIN station_official_data o ON o.station_id = s.id
  JOIN data_sources ds ON ds.id = s.source_id`;

export interface BoundsQuery {
  bbox: [number, number, number, number];
  availableDays: string[];
  refLat?: number;
  refLng?: number;
}

export async function searchInBounds(pool: Pool, q: BoundsQuery, maxPoints = MAX_POINTS): Promise<SearchResponse> {
  const [w, s, e, n] = q.bbox;
  const ref = { lat: q.refLat ?? (s + n) / 2, lng: q.refLng ?? (w + e) / 2 };
  const where = `${VISIBLE}
    AND s.location && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
    AND (cardinality($5::text[]) = 0 OR o.available_days @> $5::text[])`;
  const params = [w, s, e, n, q.availableDays];

  // 上限 + 1 件だけ取得して、多すぎる場合は集約モードへ
  const { rows: pts } = await pool.query<MapPoint>(
    `SELECT s.id::text AS id, s.name, s.latitude AS lat, s.longitude AS lng ${FROM} WHERE ${where} LIMIT ${maxPoints + 1}`,
    params,
  );

  const { rows: list } = await pool.query<StationListItem>(
    `SELECT ${LIST_COLUMNS("$6", "$7")} ${FROM} WHERE ${where}
      ORDER BY s.location <-> ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326)::geography
      LIMIT ${LIST_LIMIT}`,
    [...params, ref.lng, ref.lat],
  );

  if (pts.length <= maxPoints) {
    return { mode: "points", total: pts.length, points: pts, clusters: [], list, listOffset: 0, listLimit: LIST_LIMIT };
  }

  const cell = Math.max((e - w) / 24, 0.0005);
  const { rows: clusters } = await pool.query<MapCluster & { count: string }>(
    `SELECT avg(s.latitude) AS lat, avg(s.longitude) AS lng, count(*) AS count ${FROM} WHERE ${where}
      GROUP BY ST_SnapToGrid(s.location::geometry, $6::float8)`,
    [...params, cell],
  );
  const total = clusters.reduce((sum, c) => sum + Number(c.count), 0);
  return {
    mode: "aggregate",
    total,
    points: [],
    clusters: clusters.map((c) => ({ lat: Number(c.lat), lng: Number(c.lng), count: Number(c.count) })),
    list,
    listOffset: 0,
    listLimit: LIST_LIMIT,
  };
}

export interface NearbyQuery {
  lat: number;
  lng: number;
  radius: number;
  availableDays: string[];
  limit: number;
  offset: number;
}

/** 検索地点（住所・現在地）から半径内を近い順に。現在地はこの関数の引数としてのみ使い保存しない */
export async function searchNearby(pool: Pool, q: NearbyQuery): Promise<SearchResponse> {
  const where = `${VISIBLE}
    AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography, $3)
    AND (cardinality($4::text[]) = 0 OR o.available_days @> $4::text[])`;
  const params = [q.lng, q.lat, q.radius, q.availableDays];
  const { rows: pts } = await pool.query<MapPoint>(
    `SELECT s.id::text AS id, s.name, s.latitude AS lat, s.longitude AS lng ${FROM} WHERE ${where} LIMIT ${MAX_POINTS}`,
    params,
  );
  const { rows: countRows } = await pool.query<{ c: string }>(`SELECT count(*) AS c ${FROM} WHERE ${where}`, params);
  const { rows: list } = await pool.query<StationListItem>(
    `SELECT ${LIST_COLUMNS("$1", "$2")} ${FROM} WHERE ${where}
      ORDER BY "distanceM" ASC, s.id LIMIT $5 OFFSET $6`,
    [...params, q.limit, q.offset],
  );
  return {
    mode: "points",
    total: Number(countRows[0].c),
    points: pts,
    clusters: [],
    list,
    listOffset: q.offset,
    listLimit: q.limit,
  };
}

export interface StationDetail {
  id: string;
  officialProviderId: string;
  name: string;
  nameKana: string | null;
  corporationName: string | null;
  postalCode: string | null;
  prefecture: string;
  city: string;
  fullAddress: string;
  building: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  fax: string | null;
  serviceType: string;
  status: string;
  geocodingStatus: string;
  geocodingProvider: string | null;
  geocodingAccuracy: string | null;
  availableDays: string[];
  availableDaysNote: string | null;
  capacity: string | null;
  websiteUrl: string | null;
  kyoseigata: string | null;
  remarks: string | null;
  corporateNumber: string | null;
  sourceName: string;
  sourcePublisher: string;
  sourceDatasetName: string | null;
  sourceUrl: string | null;
  sourceLicense: string | null;
  sourceUpdatedAt: string | null;
  isFictional: boolean;
  importedAt: string;
  officialUpdatedAt: string;
}

export async function getStation(pool: Pool, id: string): Promise<StationDetail | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const { rows } = await pool.query<StationDetail>(
    `SELECT s.id::text AS id, s.official_provider_id AS "officialProviderId", s.name, s.name_kana AS "nameKana",
        s.corporation_name AS "corporationName", s.postal_code AS "postalCode", s.prefecture, s.city,
        s.full_address AS "fullAddress", o.building, s.latitude, s.longitude, s.phone, o.fax,
        s.service_type AS "serviceType", s.status, s.geocoding_status AS "geocodingStatus",
        s.geocoding_provider AS "geocodingProvider", s.geocoding_accuracy AS "geocodingAccuracy",
        o.available_days AS "availableDays", o.available_days_note AS "availableDaysNote", o.capacity,
        o.website_url AS "websiteUrl", o.kyoseigata, o.remarks, o.corporate_number AS "corporateNumber",
        ds.name AS "sourceName", ds.publisher AS "sourcePublisher", ds.dataset_name AS "sourceDatasetName",
        ds.url AS "sourceUrl", ds.license AS "sourceLicense",
        to_char(s.source_updated_at, 'YYYY-MM-DD') AS "sourceUpdatedAt", ds.is_fictional AS "isFictional",
        to_char(s.imported_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') AS "importedAt",
        to_char(o.updated_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') AS "officialUpdatedAt"
       ${FROM} WHERE s.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
