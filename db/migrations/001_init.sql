-- 001_init.sql : 訪問看護ステーションMAP 初期スキーマ
-- 設計方針:
--   * stations               : 検索・地図表示用の中核テーブル（公的データ由来の基本項目 + 座標 + 状態）
--   * station_official_data  : 公的データの全項目（原文 raw JSON を含む）。import でのみ更新
--   * station_profiles 等    : 将来、事業所自身が登録する情報。公的データ更新で消えないよう別テーブル
-- 全国展開を前提に、都道府県・市区町村・サービス種別で絞れるようにしている。

CREATE EXTENSION IF NOT EXISTS postgis;

-- データソース（取得元）マスタ
CREATE TABLE data_sources (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE,            -- 例: mhlw_kaigo_kouhyou_130
  name          text NOT NULL,                   -- 表示名: 厚生労働省 介護サービス情報公表システム
  publisher     text NOT NULL,
  dataset_name  text,
  url           text,                            -- 取得ページURL
  license       text,
  terms_url     text,
  is_fictional  boolean NOT NULL DEFAULT false,  -- UI確認用の架空データなら true
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- import 実行履歴（差分件数を記録）
CREATE TABLE import_runs (
  id                    serial PRIMARY KEY,
  source_id             integer NOT NULL REFERENCES data_sources(id),
  file_name             text NOT NULL,
  file_sha256           text NOT NULL,
  source_url            text,
  source_updated_at     date,                     -- 公的データの時点（例: 2026-06-30）
  scope_prefecture      text,
  scope_city            text,
  status                text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  total_rows            integer NOT NULL DEFAULT 0,
  in_scope_rows         integer NOT NULL DEFAULT 0,
  inserted_count        integer NOT NULL DEFAULT 0,
  updated_count         integer NOT NULL DEFAULT 0,
  unchanged_count       integer NOT NULL DEFAULT 0,
  error_count           integer NOT NULL DEFAULT 0,
  inactive_candidate_count integer NOT NULL DEFAULT 0,
  reactivated_count     integer NOT NULL DEFAULT 0,
  error_samples         jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz
);

-- 中核テーブル
CREATE TABLE stations (
  id                    bigserial PRIMARY KEY,
  official_provider_id  text NOT NULL,            -- 介護保険事業所番号（10桁）
  service_code          text NOT NULL,            -- 介護サービス種別コード（訪問看護=130）
  site_key              text NOT NULL DEFAULT '', -- 主たる事業所は ''。サテライト等で事業所番号を共有する場合に名称で区別
  name                  text NOT NULL,
  name_kana             text,
  corporation_name      text,
  postal_code           text,                     -- 元データに無い場合は NULL（推測しない）
  prefecture            text NOT NULL,
  city                  text NOT NULL,            -- 例: 大阪市天王寺区
  local_gov_code        text,                     -- 全国地方公共団体コード（6桁, 検査数字込み）
  address               text,                     -- 市区町村より後ろ
  full_address          text NOT NULL,            -- 元データの住所（原文）
  latitude              double precision,
  longitude             double precision,
  location              geography(Point, 4326) GENERATED ALWAYS AS (
                          CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
                               THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END
                        ) STORED,
  phone                 text,
  service_type          text NOT NULL,            -- 例: 訪問看護
  source_id             integer NOT NULL REFERENCES data_sources(id),
  source                text NOT NULL,            -- 表示用出典名
  source_url            text,
  source_updated_at     date,
  imported_at           timestamptz NOT NULL DEFAULT now(),
  last_import_run_id    integer REFERENCES import_runs(id),
  geocoding_status      text NOT NULL DEFAULT 'pending'
                          CHECK (geocoding_status IN ('pending','success','failed','needs_review')),
  geocoding_provider    text,                     -- official_source / gsi / geolonia_town ...
  geocoding_accuracy    text,                     -- official / address / town / city
  geocoding_attempts    integer NOT NULL DEFAULT 0,
  geocoding_error       text,
  geocoded_at           timestamptz,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','inactive_candidate','closed')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stations_provider_service_uniq UNIQUE (official_provider_id, service_code, site_key)
);
CREATE INDEX stations_location_gix ON stations USING gist (location);
CREATE INDEX stations_pref_city_idx ON stations (prefecture, city);
CREATE INDEX stations_local_gov_idx ON stations (local_gov_code);
CREATE INDEX stations_status_idx ON stations (status);
CREATE INDEX stations_geocoding_status_idx ON stations (geocoding_status);
CREATE INDEX stations_lat_lng_idx ON stations (latitude, longitude);
CREATE INDEX stations_service_type_idx ON stations (service_type);

-- 公的データの全項目（import 時のみ更新、事業所独自情報とは分離）
CREATE TABLE station_official_data (
  station_id            bigint PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
  source_id             integer NOT NULL REFERENCES data_sources(id),
  building              text,                     -- 方書（ビル名等）
  fax                   text,
  corporate_number      text,                     -- 法人番号
  available_days        text[] NOT NULL DEFAULT '{}', -- 利用可能曜日（平日/土曜日/日曜日/祝日）
  available_days_note   text,                     -- 利用可能曜日特記事項
  capacity              text,                     -- 定員（元データ文字列のまま）
  website_url           text,
  kyoseigata            text,                     -- 高齢者と障害者が同時一体的に利用できるサービス
  meets_kaigo_standard  text,
  meets_shogai_standard text,
  remarks               text,                     -- 備考
  official_latitude     double precision,         -- 元データに含まれる緯度経度（あれば）
  official_longitude    double precision,
  raw                   jsonb NOT NULL,           -- 元CSV行（原文）
  content_hash          text NOT NULL,            -- 差分判定用
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX station_official_days_gin ON station_official_data USING gin (available_days);

-- ===== 将来機能用（MVP では空。公的データ更新で消えない） =====

-- 事業所が自ら登録する情報（Verified Station 後に編集可能）
CREATE TABLE station_profiles (
  station_id            bigint PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
  is_verified           boolean NOT NULL DEFAULT false,
  verified_at           timestamptz,
  introduction          text,
  website_url           text,
  business_hours        text,
  specialties           text[] NOT NULL DEFAULT '{}',
  -- 対応可否は NULL = 情報なし（推測で埋めない）
  supports_24h          boolean,
  supports_psychiatric  boolean,
  supports_pediatric    boolean,
  supports_terminal     boolean,
  supports_intractable  boolean,
  supports_high_medical_dependency boolean,
  has_male_staff        boolean,
  has_pt                boolean,
  has_ot                boolean,
  has_st                boolean,
  weekend_holiday_note  text,
  updated_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 新規受入状況（◎○△×－）。履歴として残し、最新のみ表示。有効期限で古い情報を自動的に「情報なし」扱い
CREATE TABLE station_acceptance_status (
  id                    bigserial PRIMARY KEY,
  station_id            bigint NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  status                text NOT NULL CHECK (status IN ('actively_accepting','accepting','consult','not_accepting','unknown')),
  note                  text,
  reported_by           text,
  reported_at           timestamptz NOT NULL DEFAULT now(),
  valid_until           timestamptz NOT NULL
);
CREATE INDEX station_acceptance_station_idx ON station_acceptance_status (station_id, reported_at DESC);

-- 訪問対応エリア（事業所登録のみ。公的データから推測して作らない）
CREATE TABLE station_service_areas (
  id                    bigserial PRIMARY KEY,
  station_id            bigint NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  area_level            text NOT NULL CHECK (area_level IN ('normal','consult')),  -- 通常対応 / 要相談
  area_kind             text NOT NULL CHECK (area_kind IN ('municipality','town','radius','polygon')),
  local_gov_code        text,
  town_name             text,
  radius_m              integer,
  geom                  geography(MultiPolygon, 4326),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX station_service_areas_station_idx ON station_service_areas (station_id);
CREATE INDEX station_service_areas_geom_gix ON station_service_areas USING gist (geom);

-- 事業所の管理者申請（Claim）
CREATE TABLE station_claims (
  id                    bigserial PRIMARY KEY,
  station_id            bigint NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  applicant_name        text NOT NULL,
  applicant_email       text NOT NULL,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  reviewed_at           timestamptz
);

-- ===== Geocoding =====

-- 住所 → 座標のキャッシュ（同一住所で API を二度呼ばない）
CREATE TABLE geocode_cache (
  normalized_address    text PRIMARY KEY,
  status                text NOT NULL CHECK (status IN ('success','failed','needs_review')),
  latitude              double precision,
  longitude             double precision,
  provider              text NOT NULL,
  accuracy              text,
  matched_text          text,
  raw                   jsonb,
  hit_count             integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 外部 API 実行件数（日別・プロバイダ別）
CREATE TABLE geocode_api_usage (
  provider              text NOT NULL,
  day                   date NOT NULL,
  calls                 integer NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, day)
);
