# 訪問看護ステーションMAP

住所・地域・現在地から、周辺の訪問看護ステーションを地図と一覧で探せる Web サービスです。
ケアマネジャー、病院 MSW、相談支援専門員、医療機関、利用者家族などが「近くにどんなステーションがあるか」をすぐ確認できることを目的にしています。

初期データには、厚生労働省「介護サービス情報公表システム」の**公的オープンデータ**を使います。各事業所に登録作業を依頼する必要はありません。

> 現在は MVP（大阪府・大阪市・天王寺区で動作確認済み）です。データ構造・API・DB は全国展開を前提にしています。

---

## 目次

1. [サービス概要](#サービス概要)
2. [技術構成](#技術構成)
3. [アーキテクチャ](#アーキテクチャ)
4. [ディレクトリ構成](#ディレクトリ構成)
5. [環境構築](#環境構築)
6. [必要な環境変数](#必要な環境変数)
7. [DBセットアップ方法](#dbセットアップ方法)
8. [CSV import 方法](#csv-import-方法)
9. [Geocoding 方法](#geocoding-方法)
10. [データ取得元](#データ取得元)
11. [データライセンス・利用条件](#データライセンス利用条件)
12. [地図サービス選定理由](#地図サービス選定理由)
13. [現在地機能について](#現在地機能について)
14. [MVP段階の無料運用方法](#mvp段階の無料運用方法)
15. [将来的に費用が発生する可能性がある部分](#将来的に費用が発生する可能性がある部分)
16. [全国展開方法](#全国展開方法)
17. [テスト](#テスト)
18. [今後のロードマップ](#今後のロードマップ)

---

## サービス概要

| 機能 | 内容 |
| --- | --- |
| 地図表示 | 初期表示は大阪市天王寺区周辺。表示範囲内（map bounds）の事業所だけを取得し、Marker clustering で表示 |
| 住所・地域から探す | 住所・地域名を入力 → 地図移動・検索地点マーカー → 半径内を近い順に一覧表示 |
| 現在地から探す | ブラウザの位置情報（許可した場合のみ）→ 現在地マーカー → 近い順に一覧表示 |
| 検索半径 | 500m / 1km / 3km / 5km / 10km |
| このエリアを検索 | 地図を動かすと表示。押すとその表示範囲で再検索 |
| 一覧と地図の連動 | カードをクリック → 地図の該当マーカーへ移動。マーカーをクリック → 一覧の該当カードへスクロール |
| フィルター | 公的データにある「利用可能曜日」（土曜日・日曜日・祝日）のみ |
| 詳細ページ `/stations/[id]` | 事業所名・法人名・住所・地図・電話・サービス種別・公的データの項目・データ出典・公的データ更新日 |
| 管理画面 `/admin` | 総数・都道府県別・市区町村別件数、Geocoding 成功/失敗/待機/要確認、import 履歴（新規/更新/変更なし/エラー）、API 実行件数 |
| データについて `/about` | データ出典・利用条件・表示上の注意 |

表示上のルール:

- 距離は**検索地点からの直線距離**です。「訪問可能」「対応エリア内」とは表示しません。
- 公的データに無い情報（訪問対応エリア、新規受入状況、24時間対応、精神科・小児・終末期対応、スタッフ構成など）は**「情報なし」**とし、AI 等で推測して補いません。
- 公的データ由来の項目には「公的データ」ラベルを付けます。
- 全ページのフッターに免責表示があります。

## 技術構成

| 区分 | 採用 | 理由 |
| --- | --- | --- |
| フレームワーク | Next.js 16（App Router）/ React 19 / TypeScript | 画面と API を1つのアプリで持て、Vercel 等へもそのまま載る |
| スタイル | Tailwind CSS v4 | |
| DB | PostgreSQL 16 + PostGIS 3.4 | 地理空間インデックス（GiST）で bounds 検索・距離検索を高速に。Supabase 無料枠でも PostGIS が使える |
| DB アクセス | `pg`（node-postgres）＋ 素の SQL マイグレーション | 空間クエリを SQL で素直に書け、ORM 依存を増やさない |
| 入力検証 | Zod | API のクエリパラメータを全件検証 |
| 地図 | MapLibre GL JS v6（OSS, BSD）＋ 地理院タイル | 無料・APIキー不要。タイル提供元は環境変数で切替可能 |
| Geocoding | 公的データの座標 → 国土地理院 住所検索API → Geolonia japanese-addresses | 無料・APIキー不要。結果は DB キャッシュ |
| CSV 処理 | csv-parse / iconv-lite（UTF-8・Shift_JIS 自動判定） | |
| テスト | Vitest（単体＋PostGIS 結合）/ Playwright（E2E スモーク） | |

## アーキテクチャ

```
┌──────────────── データ取込（アプリ本体から分離した CLI） ────────────────┐
│ scripts/import-mhlw.ts                                                    │
│   A. 公式URLから自動取得（--download）  B. data/raw/ に置いた CSV（--file）│
│   → 解析・正規化 → 差分判定(INSERT/UPDATE/UNCHANGED/ERROR) → DB            │
│ scripts/geocode.ts                                                        │
│   公的座標あり → そのまま採用（API呼び出しなし）                            │
│   なし → geocode_cache → 国土地理院API → Geolonia（町丁目/街区）            │
└───────────────────────────────────────────────────────────────────────────┘
                     │ PostgreSQL + PostGIS
┌────────────────────▼──────────────────────────────────────────────────────┐
│ Next.js                                                                   │
│  GET /api/stations?bbox=…        表示範囲内のみ（上限超はサーバー側で集約）│
│  GET /api/stations/nearby?lat&lng&radius  半径内を距離順（ページング）     │
│  GET /api/geocode?q=…            検索ボックスの住所→座標（保存しない）     │
│  /  /stations/[id]  /admin  /about                                        │
└───────────────────────────────────────────────────────────────────────────┘
                     │ JSON（必要な範囲・件数だけ）
            ブラウザ（MapLibre GL：クラスタリング・一覧連動）
```

### DB 設計（`db/migrations/001_init.sql`）

公的データと、将来事業所が登録する情報を**別テーブル**に分けています。公的データを再 import しても事業所独自情報は消えません。

| テーブル | 役割 |
| --- | --- |
| `stations` | 検索・地図用の中核。`official_provider_id`（事業所番号）＋`service_code`＋`site_key` で一意。`location geography(Point)`（緯度経度から自動生成, GiST index）、`geocoding_status`（pending/success/failed/needs_review）、`status`（active/inactive_candidate/closed） |
| `station_official_data` | 公的データの全項目（利用可能曜日、FAX、法人番号、URL、元CSV行 `raw`、差分判定用 `content_hash`）。import でのみ更新 |
| `data_sources` / `import_runs` | 出典マスタ、import 履歴（新規・更新・変更なし・エラー・掲載終了候補） |
| `geocode_cache` / `geocode_api_usage` | 住所→座標キャッシュ、外部 API の日別実行件数 |
| `station_profiles` | （将来）事業所登録情報：紹介文・得意分野・24h/精神科/小児/PT/OT/ST 等。NULL＝情報なし |
| `station_acceptance_status` | （将来）新規受入状況 ◎○△×－。`reported_at` と `valid_until` を持ち、古い情報を表示し続けない |
| `station_service_areas` | （将来）訪問対応エリア：市区町村・町丁目・半径・GeoJSON Polygon、通常/要相談 |
| `station_claims` | （将来）「このステーションの管理者です」申請 → 運営確認 → Verified Station |

主な index: `official_provider_id`（一意制約）、`(prefecture, city)`、`local_gov_code`、`status`、`geocoding_status`、`(latitude, longitude)`、`location`（GiST）、`available_days`（GIN）。

## ディレクトリ構成

```
.
├── db/migrations/            SQL マイグレーション
├── data/
│   ├── raw/                  公的CSVの置き場（git 管理外）
│   ├── fixtures/             UI確認用の架空データ（【架空】と明記）
│   └── cache/                Geolonia 住所データのキャッシュ（git 管理外）
├── scripts/                  CLI（アプリ本体から分離）
│   ├── migrate.ts            マイグレーション
│   ├── import-mhlw.ts        公的CSV import
│   ├── geocode.ts            Geocoding バッチ・精度検証
│   ├── remove-source.ts      データソース単位の削除（架空データの掃除）
│   └── copy-maplibre-worker.mjs
├── src/
│   ├── app/                  画面と API（page / stations/[id] / admin / about / api/*）
│   ├── components/           SearchApp・StationMap・StationCard・MiniMap・Disclaimer
│   ├── lib/
│   │   ├── import/           CSV パーサ（mhlw.ts）・差分 import（importer.ts）・出典定義
│   │   ├── geocoding/        住所正規化・プロバイダ（gsi / geolonia）・キャッシュ・バッチ
│   │   ├── stations/         検索クエリ・フィルター定義・入力検証・管理統計
│   │   ├── geo/distance.ts   距離計算・半径円
│   │   └── db/pool.ts        DB 接続（サーバー専用）
│   └── proxy.ts              /admin の Basic 認証
├── tests/                    Vitest（単体・DB結合）
└── tests-e2e/smoke.mjs       Playwright による主要フロー確認
```

## 環境構築

前提: Node.js 20 以上（22 で確認）、PostgreSQL 14 以上 + PostGIS 3。

```bash
# 1. 依存パッケージ
npm install

# 2. 環境変数
cp .env.example .env.local      # 必要に応じて DATABASE_URL を編集

# 3. DB（例: ローカル PostgreSQL。Docker なら下の「DBセットアップ方法」参照）
createdb hnm && psql hnm -c "CREATE EXTENSION postgis;"
npm run db:migrate

# 4. 公的データを取り込み（天王寺区 → 大阪市 → 大阪府 の順で確認できます）
npm run import:mhlw -- --download --prefecture 大阪府 --city 大阪市天王寺区
npm run geocode -- --city 大阪市天王寺区
npm run import:mhlw -- --download --prefecture 大阪府
npm run geocode -- --prefecture 大阪府

# 5. 起動
npm run dev                      # http://localhost:3000
# 本番ビルド
npm run build && npm start
```

公式 URL からのダウンロードができない環境では、CSV をブラウザで保存して `data/raw/` に置き、`--file` で指定してください（[CSV import 方法](#csv-import-方法)）。

DB が無い状態でもまず画面だけ見たい場合は、架空データで確認できます:

```bash
npm run import:fixture && npm run geocode      # 【架空】と表示される UI 確認用データ
npm run remove:fixture                          # 実データ投入後に削除
```

## 必要な環境変数

`.env.example` を `.env.local` にコピーして使います。**APIキーは不要**です（APIキー未設定でもすべて動作します）。

| 変数 | 必須 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✓ | — | PostgreSQL 接続文字列（サーバー側のみ。ブラウザに出しません） |
| `TEST_DATABASE_URL` | テスト時 | `postgres://hnm:hnm@localhost:5432/hnm_test` | テスト用 DB（毎回作り直されます。本番DBを指定しないこと） |
| `GEOCODER_PROVIDERS` | | `gsi,geolonia` | Geocoding の優先順 |
| `GEOCODER_GSI_INTERVAL_MS` | | `1000` | 国土地理院 API の最小呼び出し間隔 |
| `GEOLONIA_API_BASE` / `GEOLONIA_GAIKU_BASE` | | GitHub / GitHub Pages | Geolonia 住所データの取得元 |
| `DEFAULT_PREFECTURE` | | `大阪府` | 「北区」のように曖昧な地名を優先解決する都道府県 |
| `ADMIN_USER` / `ADMIN_PASSWORD` | 公開時 | `admin` / 空 | `/admin` の Basic 認証。**空だと認証なし（ローカル用）** |
| `MAX_MAP_POINTS` | | `2000` | bounds 内がこの件数を超えるとサーバー側で集約表示 |
| `NEXT_PUBLIC_MAP_STYLE` | | `gsi-pale` | `gsi-pale` / `gsi-std` / `osm` / MapLibre スタイル JSON の URL |
| `NEXT_PUBLIC_DEFAULT_LAT` / `_LNG` / `_ZOOM` | | 34.6545 / 135.519 / 13 | 初期表示位置（天王寺区周辺）。ここを変えるだけで他地域向けにできます |

## DBセットアップ方法

ローカル PostgreSQL:

```bash
createuser -s hnm && createdb -O hnm hnm && createdb -O hnm hnm_test
psql hnm -c "CREATE EXTENSION postgis;"
npm run db:migrate
```

Docker（PostGIS 入りイメージ）:

```bash
docker run -d --name hnm-db -p 5432:5432 -e POSTGRES_USER=hnm -e POSTGRES_PASSWORD=hnm -e POSTGRES_DB=hnm postgis/postgis:16-3.4
docker exec hnm-db createdb -U hnm hnm_test
npm run db:migrate
```

Supabase（無料枠）: Database → Extensions で `postgis` を有効化し、接続文字列（Session pooler 推奨）を `DATABASE_URL` に設定して `npm run db:migrate`。

## CSV import 方法

```bash
# A. 公式URLから自動取得（src/lib/import/sources.ts の downloadUrl）
npm run import:mhlw -- --download --prefecture 大阪府

# B. CSV を data/raw/ に置いて取り込み
npm run import:mhlw -- --file data/raw/jigyosho_130_all_20260709180342.csv --as-of 2026-06-30 --prefecture 大阪府

# 範囲の指定（STEP 1 → 2 → 3 → 全国）
--prefecture 大阪府 --city 大阪市天王寺区   # 天王寺区のみ
--prefecture 大阪府 --city 大阪市           # 大阪市（全24区, 前方一致）
--prefecture 大阪府                         # 大阪府
（指定なし）                                # 全国

--dry-run                                   # DB を更新せず件数だけ確認
```

- 文字コードは UTF-8（BOM 有無）/ Shift_JIS を自動判定します。
- **idempotent**: 一意キーは `事業所番号 + サービス種別 + site_key`。同じ CSV を何度取り込んでも重複しません。
- 結果は `新規 / 更新 / 変更なし / エラー / 掲載終了の可能性` で表示し、`import_runs` に記録します（管理画面に表示）。
- 新しい CSV に無い事業所は削除せず `inactive_candidate`（地図から非表示、詳細ページに注意表示）にします。範囲指定 import では範囲内だけを判定します。
- サテライト事業所は主たる事業所と事業所番号を共有するため、名称に「サテライト」等を含む行は名称で区別します（`site_key`）。
- 住所や公的座標が変わった事業所は Geocoding を `pending` に戻します。
- 新しいCSVが公開されたら `sources.ts` の `downloadUrl` / `downloadAsOf` を更新するか、`--file` と `--as-of` で取り込みます。

実データでの結果（2026年6月末時点の CSV）:

```
CSV行数: 18,436 / 正常: 18,436 / 解析エラー: 0（事業所番号を共有するサテライト事業所1件は site_key で別事業所として扱う）
天王寺区: 新規 23
大阪市  : 新規 663 / 変更なし 23
大阪府  : 新規 1,193 / 変更なし 686
再取込  : 変更なし 1,879（重複なし）
```

## Geocoding 方法

```bash
npm run geocode -- --city 大阪市天王寺区 --limit 20   # 少数で確認
npm run geocode -- --prefecture 大阪府                 # pending をまとめて処理（既定 --limit 500）
npm run geocode -- --retry-failed                       # failed のみ再試行（最大5回）
npm run geocode -- --verify 100 --city 大阪市           # 住所Geocodingの精度を公的座標と比較（DB座標は変えない）
```

処理順と API コスト対策:

1. **公的データに緯度経度がある場合はそれを採用**（API 呼び出し 0）。厚労省 CSV は全件に座標があるため、通常は外部 API を一切呼びません。
2. 無い場合のみ住所から求めます。`geocode_cache`（正規化住所がキー）を先に見て、**同一住所は二度呼びません**。
3. プロバイダを順に試し、街区レベル以上の結果が出た時点で終了します。
   - `gsi`: 国土地理院 住所検索 API（無料・キー不要・1 リクエスト/秒に制限・1回リトライ）
   - `geolonia`: Geolonia japanese-addresses（町丁目・街区の代表点。JSON をローカルキャッシュするのでほぼオフライン）
4. 結果は `success`（座標確定）/ `needs_review`（市区町村代表点しか取れない等。地図には出さない）/ `failed` を保存。管理画面で一覧できます。
5. 外部 API の実行件数は `geocode_api_usage` に日別で記録し、管理画面に表示します。

住所 Geocoding の精度検証（公的座標を正解として比較, 大阪市 686 件, `geolonia` のみ）:

```
取得成功: 686 / 失敗: 0
公的座標との差 中央値: 137m / 500m以内: 666件（97%）
外部API呼び出し: 0
```

元データの住所列で市区町村が省略されている事業所（例: 「大阪府細工谷2-3-2」）は、同じ公的データの「市区町村名」列を前置して検索します（推測による補完ではありません）。

## データ取得元

| 項目 | 内容 |
| --- | --- |
| 取得元 | 厚生労働省 |
| データ名称 | 介護サービス情報公表システム オープンデータ（事業所一覧：訪問看護, `jigyosho_130`） |
| 取得ページ | https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html |
| 取得URL | https://www.mhlw.go.jp/content/12300000/jigyosho_130_all_20260709180342.csv |
| データ時点 | 2026年6月末時点（ファイル出力 2026-07-09） |
| 取得日 | 2026-10-06 |
| 形式 | CSV（UTF-8 BOM付き）, 18,436 件, 24 列（緯度・経度を含む） |
| 本アプリで使う主な列 | 事業所番号・事業所名・法人の名称・都道府県名・市区町村名・住所・方書・緯度・経度・電話番号・FAX番号・法人番号・サービスの種類・利用可能曜日・利用可能曜日特記事項・URL・備考 |

このCSVに**郵便番号・営業時間・24時間対応・精神科/小児/ターミナル対応・PT/OT/ST・スタッフ構成の列はありません**。そのため画面では「情報なし」とし、フィルターにも出していません（将来 `station_profiles` 等で取得できた時点で `src/lib/stations/filters.ts` に追加）。

位置情報の補助データ:

| データ | 提供 | ライセンス |
| --- | --- | --- |
| 地理院タイル（淡色地図） | 国土地理院 | 出典明示で利用可（商用可）。https://maps.gsi.go.jp/development/ichiran.html |
| 住所検索 API | 国土地理院 | 無料・キー不要。サービスの安定性は保証されないため、キャッシュとレート制限を前提に利用 |
| japanese-addresses | 株式会社 Geolonia（国土交通省 位置参照情報・日本郵便データ等をもとに作成） | CC BY 4.0 |

## データライセンス・利用条件

- 厚労省「介護サービス情報公表システム」オープンデータは、同ページの利用規約の条件の下で自由に利用できると明記されています。本アプリでは**出典（厚生労働省 介護サービス情報公表システム）とデータ時点を詳細ページ・`/about` に表示**しています。利用規約の最新の内容は公開前に上記ページで確認してください（同ページでは利用の報告フォームへの協力も呼びかけられています）。
- 地理院タイルは画面右下に「地理院タイル」の出典を表示しています。
- Geolonia の住所データ（CC BY 4.0）は `/about` に出典を表示しています。
- UI 確認用の架空データ（`data/fixtures/`）は名称に【架空】を付け、画面にも「架空データ」と表示します。実データ投入後は `npm run remove:fixture` で削除します。

## 地図サービス選定理由

| | 初期費用 | 無料枠 | 商用利用 | 日本での使いやすさ | アクセス増加時 | Clustering | 規約上の注意 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Google Maps | 0円 | 月一定額のクレジット / 無料枠あり（要カード登録） | 可 | ◎ | 従量課金で増加 | 別ライブラリ | 地図表示は Google の規約に従う必要。Geocoding 結果の保存に制限 |
| Mapbox | 0円 | 月 5 万ロード程度 | 可 | ○ | 従量課金 | ◎（GL JS） | 要アカウント・トークン |
| **MapLibre GL JS** | 0円 | ライブラリ自体は無料（OSS） | 可 | ○（タイル次第） | タイル提供元次第 | ◎（GeoJSON cluster 内蔵） | タイルの規約に従う |
| Leaflet | 0円 | 無料（OSS） | 可 | ○ | タイル提供元次第 | プラグイン | 同上 |
| OpenStreetMap 公式タイル | 0円 | 無料 | — | ○ | **大量アクセスは利用ポリシー違反** | — | 開発・少量用途のみ |
| **地理院タイル** | 0円 | 無料・キー不要 | 出典明示で可 | ◎（日本語・行政地名） | 大量アクセス時は自前配信推奨 | — | 出典表示必須 |

**採用: MapLibre GL JS ＋ 地理院タイル（淡色）**

- 初期費用・APIキー・カード登録が不要で、日本の地名表記に強い。
- 地図ライブラリは OSS のため、タイル提供元だけを `NEXT_PUBLIC_MAP_STYLE` で差し替えられます（コード変更不要）。
- OSM 公式タイルは開発用に選べますが、本番の大量アクセスには使わない設計です。

**本番運用時の移行方法**

1. アクセスが増えたら、地理院ベクトルタイルや OpenStreetMap から生成した **PMTiles を自前の静的ホスティング / CDN（Cloudflare R2 等）で配信**し、`NEXT_PUBLIC_MAP_STYLE` にスタイル JSON の URL を設定。
2. もしくは MapTiler / Stadia Maps / Mapbox などの有料タイルの API キーを取得し、スタイル URL を設定（MapLibre のまま利用可）。

## 現在地機能について

- 「現在地から探す」を押したときだけ、ブラウザの Geolocation API で位置を取得します（ブラウザの許可ダイアログで許可した場合のみ）。
- 取得した緯度経度は、地図の移動・現在地マーカー表示・半径検索 API の引数にだけ使います。**DB・ログ・Cookie・localStorage に保存しません**。行動履歴も取りません。
- 検索ボックスに入力された住所（利用者宅の住所が入り得ます）も DB に保存しません。外部 API の重複呼び出しを避けるため、サーバーのメモリ上で最大1時間・500件だけ保持します。
- 取得できない・拒否された場合は「位置情報を取得できませんでした。住所から検索してください。」と表示します。
- 位置情報 API は **HTTPS（または localhost）でのみ**動作します。

## MVP段階の無料運用方法

| 構成要素 | 無料での運用 |
| --- | --- |
| アプリ | ローカル（`npm run dev` / `npm start`）。公開するなら Vercel Hobby（非商用）や自前サーバー |
| DB | ローカル PostgreSQL + PostGIS、または Supabase Free（PostGIS 利用可、500MB。全国 2 万件弱なら十分） |
| 地図 | MapLibre（OSS）＋ 地理院タイル（無料・キー不要） |
| Geocoding | 公的データの座標を採用（API 0 回）。補助に国土地理院 API（無料）と Geolonia データ（CC BY） |
| 公的データ | 厚労省オープンデータ（無料） |

現時点で**有料契約・APIキーは一切使っていません**。

## 将来的に費用が発生する可能性がある部分

| 部分 | 発生する条件 | 対策・目安 |
| --- | --- | --- |
| ホスティング | 商用公開（Vercel Hobby は非商用のみ）、アクセス増 | Vercel Pro、または VPS / Cloud Run 等 |
| DB | Supabase Free の容量・接続数・一時停止（無操作時）を超える | Supabase Pro 等 |
| 地図タイル | 大量アクセスで地理院タイル・OSM 公式タイルへの負荷が問題になる場合 | PMTiles 自前配信（ストレージ・転送量の費用）または有料タイル |
| Geocoding | 公的座標の無いデータ（他サービス種別・自治体台帳等）を大量に扱い、国土地理院 API で賄えない場合 | Google / Yahoo! 等の有料 API。キャッシュ前提で件数を抑える |
| 将来機能 | 事業所ログイン（認証基盤）、写真アップロード（ストレージ）、通知（メール送信）、ルート・移動時間（経路 API）、AI 検索（LLM API） | 各機能の追加時に見積り |

## 全国展開方法

データ構造は最初から全国対応です（都道府県・市区町村・地方公共団体コードを保持、一意キーは事業所番号）。初期表示位置以外に大阪固有の処理はありません。

```bash
npm run import:mhlw -- --download               # 全国（約1.8万件）
npm run geocode -- --limit 20000                # 公的座標を採用するため外部APIは呼ばない
```

- 地図・一覧 API は表示範囲内／半径内のみを返し、上限（`MAX_MAP_POINTS`）を超えると PostGIS でグリッド集約して返すため、全国データでもブラウザに全件を送りません。一覧は 50 件ずつのページングです。
- 公的座標が無いデータを扱う場合は `--prefecture` / `--limit` で分割し、管理画面の API 実行件数を見ながら進めます。
- 地域ごとに初期表示を変える場合は `NEXT_PUBLIC_DEFAULT_LAT/LNG/ZOOM` を変更します。
- 他のサービス種別（居宅介護支援・訪問診療など）は `SERVICE_CODES` と `DATA_SOURCES` に追加すれば同じ pipeline で取り込めます（「在宅医療・介護MAP」への拡張）。

## テスト

```bash
npm test          # Vitest: 単体 + PostGIS 結合テスト（TEST_DATABASE_URL の DB を作り直します）
npm run lint
npm run typecheck
npm run build

# E2E（主要ユーザーフロー）: 別ターミナルで npm run dev を起動してから
npx playwright install chromium   # 初回のみ
npm run e2e
```

テスト対象: CSV parsing（UTF-8/Shift_JIS・列検証・エラー行）、データ正規化、重複防止（idempotent）、差分更新（INSERT/UPDATE/UNCHANGED/ERROR, inactive_candidate, 事業所独自情報の保持）、住所検索（町丁目マッチ・表記揺れ・区の省略）、距離計算、map bounds 検索・集約、距離順検索・フィルター、API validation、Geocoding status 管理（キャッシュ・再試行・住所変更時の pending 戻し）。

E2E（`tests-e2e/smoke.mjs`）: 初期表示、PC レイアウト、住所検索、半径変更、フィルター、カード→地図／マーカー→カード連動、クラスタリング、「このエリアを検索」、現在地検索（許可・拒否）、詳細ページの出典、住所検索失敗メッセージ、管理画面、スマートフォン表示、runtime error の有無。

## 今後のロードマップ

MVP 完了後に検討する順序の案です。

1. **公開準備**: HTTPS でのデプロイ（Vercel + Supabase 等）、`ADMIN_PASSWORD` 設定、地図タイルの本番方針決定、厚労省 CSV の定期更新（四半期ごと）を自動化
2. **駅名検索の強化**: 国土地理院 API が使えない環境向けに、国土数値情報「鉄道駅」データ（オープンデータ）で駅名→座標を引けるようにする
3. **事業所 Claim / Verified Station**: `station_claims` → 運営確認 → 事業所ログイン → `station_profiles` を編集
4. **訪問対応エリア・新規受入状況**: `station_service_areas`（通常/要相談を半透明表示）、`station_acceptance_status`（◎○△×－、有効期限付き）
5. **詳細条件のフィルター**: 精神科・小児・終末期・難病・医療依存度・男性スタッフ・PT/OT/ST・土日祝（事業所登録情報または追加の公的データから）
6. その後: お気に入り・比較・問い合わせ、利用者宅からの車移動時間・ルート、CSV 一括更新・管理者による手動修正、写真登録、自然文 AI 検索（例:「天王寺区、精神科、男性スタッフ、24時間対応」→ 条件に分解して既存フィルターで検索。データに無い情報は推測しない）、病院・診療所・薬局・居宅介護支援事業所などを含む「在宅医療・介護MAP」への拡張
