/** Geocoding 用の住所正規化 */
import { normalizeText } from "@/lib/text";

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

const KANJI_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 1〜99 のアラビア数字を漢数字へ（丁目表記用: 6 → 六, 12 → 十二, 20 → 二十） */
export function toKanjiNumber(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n >= 100) return String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  let s = "";
  if (tens > 0) s += (tens > 1 ? KANJI_DIGITS[tens] : "") + "十";
  if (ones > 0) s += KANJI_DIGITS[ones];
  return s;
}

/** 漢数字（〜九十九）をアラビア数字へ。変換できなければ null */
export function fromKanjiNumber(s: string): number | null {
  if (!/^[一二三四五六七八九十]+$/.test(s)) return null;
  const idx = s.indexOf("十");
  const d = (c: string) => KANJI_DIGITS.indexOf(c);
  if (idx === -1) return s.length === 1 ? d(s) : null;
  const tens = idx === 0 ? 1 : d(s.slice(0, idx));
  const onesStr = s.slice(idx + 1);
  const ones = onesStr === "" ? 0 : onesStr.length === 1 ? d(onesStr) : -1;
  if (tens < 1 || ones < 0) return null;
  return tens * 10 + ones;
}

/**
 * 住所を Geocoding キャッシュキー兼検索文字列へ正規化。
 *  - NFKC（全角英数→半角）、空白除去
 *  - 数字の後ろの長音記号・ハイフン類を "-" に統一
 *  - 「番地」「番」「号」を "-" 区切りへ（例: 6丁目5番13号 → 6丁目5-13）
 *  - ビル名など、番地以降の文字列は除去（同一建物の別表記で別キャッシュにならないように）
 */
export function normalizeAddress(input: string): string {
  let s = normalizeText(input) ?? "";
  s = s.replace(/\s+/g, "");
  s = s.replace(/([0-9])[ー−‐―-]/g, "$1-");
  s = s.replace(/([0-9]+)番地の?([0-9]+)/g, "$1-$2");
  s = s.replace(/([0-9]+)番地/g, "$1");
  s = s.replace(/([0-9]+)番([0-9]+)号?/g, "$1-$2");
  s = s.replace(/([0-9]+)番$/g, "$1");
  s = s.replace(/([0-9]+)号/g, "$1");
  s = s.replace(/([0-9]+)の([0-9]+)/g, "$1-$2");
  // 番地（数字とハイフン）以降のビル名等を除去
  const afterChome = s.match(/^(.*?丁目[0-9]+(?:-[0-9]+)*)/);
  if (afterChome) return afterChome[1];
  const hyphenated = s.match(/^(.*?[0-9]+(?:-[0-9]+)+)/);
  if (hyphenated) return hyphenated[1];
  return s;
}

export interface SplitAddress {
  prefecture: string | null;
  rest: string;
}

export function splitPrefecture(s: string): SplitAddress {
  for (const p of PREFECTURES) {
    if (s.startsWith(p)) return { prefecture: p, rest: s.slice(p.length) };
  }
  return { prefecture: null, rest: s };
}
