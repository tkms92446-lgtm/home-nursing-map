/**
 * 厚労省 介護サービス情報公表システム オープンデータ（訪問看護 CSV）の取り込み。
 * アプリ本体とは独立した CLI。
 *
 *  A. 公式URLから自動取得して取り込む
 *     npm run import:mhlw -- --download --prefecture 大阪府 --city 大阪市天王寺区
 *  B. data/raw/ に配置した CSV を取り込む
 *     npm run import:mhlw -- --file data/raw/jigyosho_130.csv --as-of 2026-06-30 --prefecture 大阪府
 *
 *  オプション:
 *     --source <code>       データソース（既定: mhlw_kaigo_kouhyou_130）
 *     --as-of YYYY-MM-DD    公的データの時点（例: 2026年6月末時点 → 2026-06-30）
 *     --prefecture <名称>   都道府県で絞る（STEP: 天王寺区 → 大阪市 → 大阪府 → 全国）
 *     --city <前方一致>     市区町村で絞る（例: 大阪市 / 大阪市天王寺区）
 *     --dry-run             DB を更新せず解析結果のみ表示
 */
import "./load-env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { closePool, withTransaction } from "@/lib/db/pool";
import { importRecords, inScope } from "@/lib/import/importer";
import { parseMhlwCsv } from "@/lib/import/mhlw";
import { DATA_SOURCES } from "@/lib/import/sources";

async function download(url: string): Promise<string> {
  const rawDir = path.join(process.cwd(), "data", "raw");
  mkdirSync(rawDir, { recursive: true });
  const fileName = path.basename(new URL(url).pathname);
  const dest = path.join(rawDir, fileName);
  if (existsSync(dest)) {
    console.log(`既に取得済みのファイルを使用します: ${dest}`);
    return dest;
  }
  console.log(`ダウンロード中: ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": "home-nursing-map-importer/0.1" } });
  if (!res.ok) throw new Error(`ダウンロード失敗: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`保存しました: ${dest} (${buf.length} bytes)`);
  return dest;
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      download: { type: "boolean", default: false },
      url: { type: "string" },
      source: { type: "string", default: "mhlw_kaigo_kouhyou_130" },
      "as-of": { type: "string" },
      prefecture: { type: "string" },
      city: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const source = DATA_SOURCES[values.source!];
  if (!source) throw new Error(`不明なデータソース: ${values.source}`);

  let file = values.file;
  let asOf = values["as-of"] ?? null;
  if (!file && (values.download || values.url)) {
    const url = values.url ?? source.downloadUrl;
    if (!url) throw new Error("このデータソースには自動取得URLがありません。--file で CSV を指定してください");
    file = await download(url);
    if (!asOf && !values.url) asOf = source.downloadAsOf ?? null;
  }
  if (!file) throw new Error("--file <CSV> または --download を指定してください");
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("--as-of は YYYY-MM-DD 形式で指定してください");

  const buf = readFileSync(file);
  const sha = createHash("sha256").update(buf).digest("hex");
  const parsed = parseMhlwCsv(buf);
  const scope = { prefecture: values.prefecture, cityPrefix: values.city };
  const scopedCount = parsed.records.filter((r) => inScope(r, scope)).length;

  console.log(`ファイル: ${file}（${parsed.encoding}）`);
  console.log(`CSV行数: ${parsed.totalRows} / 正常: ${parsed.records.length} / 解析エラー: ${parsed.errors.length}`);
  console.log(`取り込み範囲: ${values.prefecture ?? "全国"} ${values.city ?? ""} → ${scopedCount} 件`);
  if (values["dry-run"]) {
    console.log("dry-run のため DB は更新しません");
    return;
  }

  const stats = await withTransaction((client) =>
    importRecords(client, parsed.records, {
      source,
      fileName: path.basename(file!),
      fileSha256: sha,
      sourceUpdatedAt: asOf,
      scope,
      totalRows: parsed.totalRows,
      parseErrors: parsed.errors,
    }),
  );

  console.log("---- import 結果 ----");
  console.log(`総件数（範囲内）: ${stats.inScopeRows}`);
  console.log(`新規: ${stats.inserted}`);
  console.log(`更新: ${stats.updated}（うち再掲載 ${stats.reactivated}）`);
  console.log(`変更なし: ${stats.unchanged}`);
  console.log(`エラー: ${stats.errors}`);
  console.log(`掲載終了の可能性（inactive_candidate）: ${stats.inactiveCandidates}`);
  if (stats.errorSamples.length) {
    console.log("エラー例:");
    for (const e of stats.errorSamples.slice(0, 10)) console.log(`  line ${e.line} ${e.providerId ?? ""} ${e.message}`);
  }
  console.log("次: npm run geocode で座標を付与してください");
}

main()
  .catch((e) => {
    console.error(`エラー: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
