import { Pool, type PoolClient } from "pg";

/**
 * PostgreSQL 接続プール（サーバー側専用）。
 * DATABASE_URL はサーバー環境変数のみ。NEXT_PUBLIC_ を付けないことでクライアントに露出しない。
 */
const globalForPg = globalThis as unknown as { __hnmPool?: Pool };

export function getPool(): Pool {
  if (!globalForPg.__hnmPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL が設定されていません（.env.local を確認してください）");
    }
    globalForPg.__hnmPool = new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 5) });
  }
  return globalForPg.__hnmPool;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (globalForPg.__hnmPool) {
    await globalForPg.__hnmPool.end();
    globalForPg.__hnmPool = undefined;
  }
}
