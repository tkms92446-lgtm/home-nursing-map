import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
// テストは必ずテスト用DBを使う（開発DBを壊さない）
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://hnm:hnm@localhost:5432/hnm_test";
// 外部 API を呼ばない
process.env.GEOCODER_PROVIDERS = "geolonia";
