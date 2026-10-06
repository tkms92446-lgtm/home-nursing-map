import type { Pool } from "pg";

export interface AdminStats {
  totals: { total: number; active: number; inactiveCandidate: number };
  geocoding: { success: number; failed: number; pending: number; needsReview: number };
  byPrefecture: { prefecture: string; count: number }[];
  byCity: { prefecture: string; city: string; count: number }[];
  sources: { code: string; name: string; isFictional: boolean; url: string | null; license: string | null; stations: number }[];
  imports: {
    id: number;
    source: string;
    fileName: string;
    sourceUpdatedAt: string | null;
    scope: string;
    status: string;
    total: number;
    inserted: number;
    updated: number;
    unchanged: number;
    errors: number;
    inactiveCandidates: number;
    finishedAt: string | null;
  }[];
  geocodeIssues: { id: string; name: string; fullAddress: string; status: string; error: string | null; attempts: number }[];
  apiUsage: { provider: string; day: string; calls: number }[];
}

export async function getAdminStats(pool: Pool): Promise<AdminStats> {
  const [totals, geo, pref, city, sources, imports, issues, usage] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status='active')::int AS active,
        count(*) FILTER (WHERE status='inactive_candidate')::int AS "inactiveCandidate" FROM stations`),
    pool.query(`SELECT count(*) FILTER (WHERE geocoding_status='success')::int AS success,
        count(*) FILTER (WHERE geocoding_status='failed')::int AS failed,
        count(*) FILTER (WHERE geocoding_status='pending')::int AS pending,
        count(*) FILTER (WHERE geocoding_status='needs_review')::int AS "needsReview" FROM stations`),
    pool.query(`SELECT prefecture, count(*)::int AS count FROM stations GROUP BY prefecture ORDER BY count DESC`),
    pool.query(`SELECT prefecture, city, count(*)::int AS count FROM stations GROUP BY prefecture, city
        ORDER BY count DESC, city LIMIT 100`),
    pool.query(`SELECT ds.code, ds.name, ds.is_fictional AS "isFictional", ds.url, ds.license,
        (SELECT count(*)::int FROM stations s WHERE s.source_id = ds.id) AS stations FROM data_sources ds ORDER BY ds.id`),
    pool.query(`SELECT r.id, ds.name AS source, r.file_name AS "fileName",
        to_char(r.source_updated_at,'YYYY-MM-DD') AS "sourceUpdatedAt",
        concat_ws(' ', coalesce(r.scope_prefecture,'全国'), r.scope_city) AS scope, r.status,
        r.in_scope_rows AS total, r.inserted_count AS inserted, r.updated_count AS updated,
        r.unchanged_count AS unchanged, r.error_count AS errors, r.inactive_candidate_count AS "inactiveCandidates",
        to_char(r.finished_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD HH24:MI') AS "finishedAt"
        FROM import_runs r JOIN data_sources ds ON ds.id = r.source_id ORDER BY r.id DESC LIMIT 20`),
    pool.query(`SELECT id::text, name, full_address AS "fullAddress", geocoding_status AS status,
        geocoding_error AS error, geocoding_attempts AS attempts
        FROM stations WHERE geocoding_status IN ('failed','needs_review') ORDER BY id LIMIT 200`),
    pool.query(`SELECT provider, to_char(day,'YYYY-MM-DD') AS day, calls FROM geocode_api_usage ORDER BY day DESC, provider LIMIT 30`),
  ]);
  return {
    totals: totals.rows[0],
    geocoding: geo.rows[0],
    byPrefecture: pref.rows,
    byCity: city.rows,
    sources: sources.rows,
    imports: imports.rows,
    geocodeIssues: issues.rows,
    apiUsage: usage.rows,
  };
}
