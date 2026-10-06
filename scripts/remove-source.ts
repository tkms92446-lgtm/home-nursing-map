/**
 * 指定データソースの事業所を削除（主に UI 確認用の架空データを実データ投入後に消すため）
 *   npm run remove:fixture
 *   npm run remove-source -- --source <code>
 */
import "./load-env";
import { parseArgs } from "node:util";
import { closePool, getPool } from "@/lib/db/pool";

async function main() {
  const { values } = parseArgs({ options: { source: { type: "string", default: "fixture_fictional_130" } } });
  const { rowCount } = await getPool().query(
    `DELETE FROM stations WHERE source_id IN (SELECT id FROM data_sources WHERE code = $1)`,
    [values.source],
  );
  console.log(`削除: ${rowCount} 件（source=${values.source}）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
