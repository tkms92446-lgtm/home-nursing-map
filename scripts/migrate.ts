/**
 * SQL マイグレーション実行: db/migrations/*.sql を番号順に1回ずつ適用する。
 *   npm run db:migrate
 */
import "./load-env";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { closePool, getPool } from "@/lib/db/pool";

export async function migrate(): Promise<string[]> {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const done = new Set(rows.map((r) => r.name));
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(path.join(dir, f), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
      await client.query("COMMIT");
      applied.push(f);
      console.log(`applied: ${f}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`マイグレーション失敗 ${f}: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  if (applied.length === 0) console.log("マイグレーションは最新です");
  return applied;
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  migrate()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
