/**
 * 公的データ import パイプライン（idempotent / 差分判定）。
 *
 *  - キー: (事業所番号, サービスコード)。同じ CSV を何度取り込んでも重複しない
 *  - 判定: INSERT / UPDATE / UNCHANGED / ERROR
 *  - 今回のファイルに存在しない既存事業所は即削除せず status='inactive_candidate'
 *  - station_official_data のみ更新し、station_profiles 等の事業所独自情報には触れない
 */
import type { PoolClient } from "pg";
import type { DataSourceDef } from "./sources";
import { recordKey, type OfficialStationRecord, type ParseError } from "./mhlw";

export interface ImportScope {
  prefecture?: string;
  /** 前方一致（例: "大阪市" で大阪市全区、"大阪市天王寺区" で天王寺区のみ） */
  cityPrefix?: string;
}

export interface ImportOptions {
  source: DataSourceDef;
  fileName: string;
  fileSha256: string;
  sourceUpdatedAt: string | null; // YYYY-MM-DD
  scope: ImportScope;
  totalRows: number;
  parseErrors: ParseError[];
  /** ファイル全体を取り込んだ場合のみ inactive_candidate 判定を行う（既定 true） */
  markMissingAsInactive?: boolean;
}

export interface ImportStats {
  runId: number;
  totalRows: number;
  inScopeRows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  inactiveCandidates: number;
  reactivated: number;
  errorSamples: ParseError[];
}

export function inScope(r: Pick<OfficialStationRecord, "prefecture" | "city">, scope: ImportScope): boolean {
  if (scope.prefecture && r.prefecture !== scope.prefecture) return false;
  if (scope.cityPrefix && !r.city.startsWith(scope.cityPrefix)) return false;
  return true;
}

export type RowAction = "insert" | "update" | "unchanged";

/** 既存行との比較で処理種別を決める（純粋関数・テスト対象） */
export function decideAction(
  existing: { content_hash: string | null; status: string } | undefined,
  incomingHash: string,
): RowAction {
  if (!existing) return "insert";
  if (existing.content_hash !== incomingHash || existing.status !== "active") return "update";
  return "unchanged";
}

async function upsertSource(client: PoolClient, s: DataSourceDef): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO data_sources (code, name, publisher, dataset_name, url, license, terms_url, is_fictional)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, publisher=EXCLUDED.publisher,
       dataset_name=EXCLUDED.dataset_name, url=EXCLUDED.url, license=EXCLUDED.license,
       terms_url=EXCLUDED.terms_url, is_fictional=EXCLUDED.is_fictional, updated_at=now()
     RETURNING id`,
    [s.code, s.name, s.publisher, s.datasetName, s.url || null, s.license, s.termsUrl || null, s.isFictional],
  );
  return rows[0].id;
}

export async function importRecords(
  client: PoolClient,
  records: OfficialStationRecord[],
  opts: ImportOptions,
): Promise<ImportStats> {
  const sourceId = await upsertSource(client, opts.source);
  const scoped = records.filter((r) => inScope(r, opts.scope));
  // 解析エラーは範囲内（都道府県・市区町村が不明なものは含める）のみ数える
  const scopedErrors = opts.parseErrors.filter(
    (e) => e.prefecture == null || e.city == null || inScope({ prefecture: e.prefecture, city: e.city }, opts.scope),
  );

  const { rows: runRows } = await client.query<{ id: number }>(
    `INSERT INTO import_runs (source_id, file_name, file_sha256, source_url, source_updated_at,
       scope_prefecture, scope_city, total_rows, in_scope_rows)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      sourceId,
      opts.fileName,
      opts.fileSha256,
      opts.source.url || null,
      opts.sourceUpdatedAt,
      opts.scope.prefecture ?? null,
      opts.scope.cityPrefix ?? null,
      opts.totalRows,
      scoped.length,
    ],
  );
  const runId = runRows[0].id;

  // 既存データを一括取得（範囲内のみ）
  const { rows: existingRows } = await client.query<{
    id: string;
    official_provider_id: string;
    service_code: string;
    site_key: string;
    status: string;
    full_address: string;
    content_hash: string | null;
    official_latitude: number | null;
    official_longitude: number | null;
  }>(
    `SELECT s.id, s.official_provider_id, s.service_code, s.site_key, s.status, s.full_address,
            o.content_hash, o.official_latitude, o.official_longitude
       FROM stations s LEFT JOIN station_official_data o ON o.station_id = s.id
      WHERE s.source_id = $1
        AND ($2::text IS NULL OR s.prefecture = $2)
        AND ($3::text IS NULL OR s.city LIKE $3 || '%')`,
    [sourceId, opts.scope.prefecture ?? null, opts.scope.cityPrefix ?? null],
  );
  const existing = new Map(
    existingRows.map((r) => [recordKey({ officialProviderId: r.official_provider_id, serviceCode: r.service_code, siteKey: r.site_key }), r]),
  );

  // 範囲外の既存行（他ソース・他地域）とのキー衝突検出用
  const stats: ImportStats = {
    runId,
    totalRows: opts.totalRows,
    inScopeRows: scoped.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: scopedErrors.length,
    inactiveCandidates: 0,
    reactivated: 0,
    errorSamples: scopedErrors.slice(0, 50),
  };

  const seenIds: string[] = [];
  for (const r of scoped) {
    const ex = existing.get(recordKey(r));
    const action = decideAction(ex, r.contentHash);
    await client.query("SAVEPOINT row_sp");
    try {
      if (action === "unchanged") {
        await client.query(`UPDATE stations SET last_import_run_id=$1 WHERE id=$2`, [runId, ex!.id]);
        stats.unchanged++;
        seenIds.push(ex!.id);
      } else if (action === "insert") {
        const id = await insertStation(client, r, sourceId, runId, opts);
        seenIds.push(id);
        stats.inserted++;
      } else {
        const locationChanged =
          ex!.full_address !== r.fullAddress ||
          ex!.official_latitude !== r.officialLatitude ||
          ex!.official_longitude !== r.officialLongitude;
        await updateStation(client, ex!.id, r, sourceId, runId, opts, locationChanged);
        if (ex!.status !== "active") stats.reactivated++;
        seenIds.push(ex!.id);
        stats.updated++;
      }
      await client.query("RELEASE SAVEPOINT row_sp");
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT row_sp");
      stats.errors++;
      if (stats.errorSamples.length < 50) {
        stats.errorSamples.push({ line: -1, providerId: r.officialProviderId, message: (e as Error).message });
      }
    }
  }

  if (opts.markMissingAsInactive !== false) {
    const { rowCount } = await client.query(
      `UPDATE stations SET status='inactive_candidate', updated_at=now()
        WHERE source_id=$1 AND status='active'
          AND ($2::text IS NULL OR prefecture = $2)
          AND ($3::text IS NULL OR city LIKE $3 || '%')
          AND (last_import_run_id IS DISTINCT FROM $4)`,
      [sourceId, opts.scope.prefecture ?? null, opts.scope.cityPrefix ?? null, runId],
    );
    stats.inactiveCandidates = rowCount ?? 0;
  }

  await client.query(
    `UPDATE import_runs SET status='succeeded', finished_at=now(), inserted_count=$2, updated_count=$3,
       unchanged_count=$4, error_count=$5, inactive_candidate_count=$6, reactivated_count=$7, error_samples=$8
     WHERE id=$1`,
    [
      runId,
      stats.inserted,
      stats.updated,
      stats.unchanged,
      stats.errors,
      stats.inactiveCandidates,
      stats.reactivated,
      JSON.stringify(stats.errorSamples),
    ],
  );
  return stats;
}

function stationParams(r: OfficialStationRecord, source: DataSourceDef, sourceUpdatedAt: string | null) {
  return [
    r.name,
    r.nameKana,
    r.corporationName,
    r.postalCode,
    r.prefecture,
    r.city,
    r.localGovCode,
    r.address,
    r.fullAddress,
    r.phone,
    r.serviceType,
    source.name,
    source.url || null,
    sourceUpdatedAt,
  ];
}

async function insertStation(
  client: PoolClient,
  r: OfficialStationRecord,
  sourceId: number,
  runId: number,
  opts: ImportOptions,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO stations (official_provider_id, service_code, site_key, name, name_kana, corporation_name, postal_code,
        prefecture, city, local_gov_code, address, full_address, phone, service_type, source, source_url,
        source_updated_at, source_id, last_import_run_id, imported_at, geocoding_status, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now(), 'pending', 'active')
     RETURNING id`,
    [r.officialProviderId, r.serviceCode, r.siteKey, ...stationParams(r, opts.source, opts.sourceUpdatedAt), sourceId, runId],
  );
  const id = rows[0].id;
  await upsertOfficial(client, id, sourceId, r);
  return id;
}

async function updateStation(
  client: PoolClient,
  id: string,
  r: OfficialStationRecord,
  sourceId: number,
  runId: number,
  opts: ImportOptions,
  locationChanged: boolean,
): Promise<void> {
  await client.query(
    `UPDATE stations SET name=$2, name_kana=$3, corporation_name=$4, postal_code=$5, prefecture=$6, city=$7,
        local_gov_code=$8, address=$9, full_address=$10, phone=$11, service_type=$12, source=$13, source_url=$14,
        source_updated_at=$15, source_id=$16, last_import_run_id=$17, imported_at=now(), status='active',
        updated_at=now()
        ${locationChanged ? ", latitude=NULL, longitude=NULL, geocoding_status='pending', geocoding_provider=NULL, geocoding_accuracy=NULL, geocoding_attempts=0, geocoding_error=NULL, geocoded_at=NULL" : ""}
      WHERE id=$1`,
    [id, ...stationParams(r, opts.source, opts.sourceUpdatedAt), sourceId, runId],
  );
  await upsertOfficial(client, id, sourceId, r);
}

async function upsertOfficial(client: PoolClient, stationId: string, sourceId: number, r: OfficialStationRecord) {
  await client.query(
    `INSERT INTO station_official_data (station_id, source_id, building, fax, corporate_number, available_days,
        available_days_note, capacity, website_url, kyoseigata, meets_kaigo_standard, meets_shogai_standard,
        remarks, official_latitude, official_longitude, raw, content_hash, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
     ON CONFLICT (station_id) DO UPDATE SET source_id=EXCLUDED.source_id, building=EXCLUDED.building,
        fax=EXCLUDED.fax, corporate_number=EXCLUDED.corporate_number, available_days=EXCLUDED.available_days,
        available_days_note=EXCLUDED.available_days_note, capacity=EXCLUDED.capacity,
        website_url=EXCLUDED.website_url, kyoseigata=EXCLUDED.kyoseigata,
        meets_kaigo_standard=EXCLUDED.meets_kaigo_standard, meets_shogai_standard=EXCLUDED.meets_shogai_standard,
        remarks=EXCLUDED.remarks, official_latitude=EXCLUDED.official_latitude,
        official_longitude=EXCLUDED.official_longitude, raw=EXCLUDED.raw, content_hash=EXCLUDED.content_hash,
        updated_at=now()`,
    [
      stationId,
      sourceId,
      r.building,
      r.fax,
      r.corporateNumber,
      r.availableDays,
      r.availableDaysNote,
      r.capacity,
      r.websiteUrl,
      r.kyoseigata,
      r.meetsKaigoStandard,
      r.meetsShogaiStandard,
      r.remarks,
      r.officialLatitude,
      r.officialLongitude,
      JSON.stringify(r.raw),
      r.contentHash,
    ],
  );
}
