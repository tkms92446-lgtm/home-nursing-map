// CLI スクリプト用: Next.js と同じ優先順位で .env.local → .env を読み込む
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
