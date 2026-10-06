/** 文字列正規化ユーティリティ（import と Geocoding で共通利用） */

/** 全角英数・記号を半角へ（NFKC）、ハイフン類を統一、前後空白除去、連続空白を1つに */
export function normalizeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = value
    .normalize("NFKC")
    // ハイフン類を統一（長音記号「ー」はカタカナ語で使うため、住所正規化側で数字の後ろのみ変換）
    .replace(/[‐-―−﹣－]/g, "-")
    .replace(/[\s　]+/g, " ")
    .trim();
  return s === "" ? null : s;
}

/** 電話番号: 半角化し、数字とハイフン以外を除去。桁が明らかに足りなければ null */
export function normalizePhone(value: string | null | undefined): string | null {
  const s = normalizeText(value);
  if (!s) return null;
  const cleaned = s.replace(/[^0-9-]/g, "");
  const digits = cleaned.replace(/-/g, "");
  if (digits.length < 9 || digits.length > 11) return null;
  return cleaned;
}

/** 郵便番号: 7桁なら 123-4567 形式 */
export function normalizePostalCode(value: string | null | undefined): string | null {
  const s = normalizeText(value);
  if (!s) return null;
  const digits = s.replace(/[^0-9]/g, "");
  return digits.length === 7 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : null;
}

/** URL: http(s) のみ許可 */
export function normalizeUrl(value: string | null | undefined): string | null {
  const s = normalizeText(value);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** 緯度経度として妥当（日本の範囲内）か */
export function isValidJapanCoordinate(lat: number | null, lng: number | null): boolean {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= 20 && lat <= 46 && lng >= 122 && lng <= 154;
}

export function parseNumber(value: string | null | undefined): number | null {
  const s = normalizeText(value);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
