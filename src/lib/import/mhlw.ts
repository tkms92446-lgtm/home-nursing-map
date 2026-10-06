/**
 * 厚生労働省「介護サービス情報公表システム」オープンデータ（事業所一覧CSV）のパーサ。
 * 例: 訪問看護 = jigyosho_130*.csv
 *
 * ここでは「元データに存在する項目のみ」を正規化して返す。欠けている項目を推測で補完しない。
 */
import { parse } from "csv-parse/sync";
import iconv from "iconv-lite";
import { createHash } from "node:crypto";
import {
  isValidJapanCoordinate,
  normalizePhone,
  normalizeText,
  normalizeUrl,
  parseNumber,
} from "@/lib/text";

/** CSV ヘッダ（2026年6月末時点のファイルで確認済み） */
export const MHLW_COLUMNS = {
  localGovCode: "都道府県コード又は市町村コード",
  no: "No",
  prefecture: "都道府県名",
  city: "市区町村名",
  name: "事業所名",
  nameKana: "事業所名カナ",
  serviceType: "サービスの種類",
  address: "住所",
  building: "方書（ビル名等）",
  latitude: "緯度",
  longitude: "経度",
  phone: "電話番号",
  fax: "FAX番号",
  corporateNumber: "法人番号",
  corporationName: "法人の名称",
  providerId: "事業所番号",
  availableDays: "利用可能曜日",
  availableDaysNote: "利用可能曜日特記事項",
  capacity: "定員",
  url: "URL",
  kyoseigata: "高齢者の方と障害者の方が同時一体的に利用できるサービス",
  meetsKaigoStandard: "介護保険の通常の指定基準を満たしている",
  meetsShogaiStandard: "障害福祉の通常の指定基準を満たしている",
  remarks: "備考",
} as const;

const REQUIRED_HEADERS = [
  MHLW_COLUMNS.prefecture,
  MHLW_COLUMNS.city,
  MHLW_COLUMNS.name,
  MHLW_COLUMNS.serviceType,
  MHLW_COLUMNS.address,
  MHLW_COLUMNS.providerId,
];

/** サービス種類名 → 介護サービスコード（介護サービス情報公表システムのファイル番号） */
export const SERVICE_CODES: Record<string, string> = {
  訪問看護: "130",
};

export const KNOWN_DAYS = ["平日", "土曜日", "日曜日", "祝日"] as const;

export interface OfficialStationRecord {
  officialProviderId: string;
  serviceCode: string;
  /** 主たる事業所は ""。サテライト事業所等は主たる事業所と事業所番号を共有するため名称で区別 */
  siteKey: string;
  serviceType: string;
  name: string;
  nameKana: string | null;
  corporationName: string | null;
  corporateNumber: string | null;
  postalCode: string | null; // 本CSVには郵便番号列が無いため常に null（推測しない）
  prefecture: string;
  city: string;
  localGovCode: string | null;
  address: string | null; // 都道府県・市区町村より後ろ
  fullAddress: string;
  building: string | null;
  officialLatitude: number | null;
  officialLongitude: number | null;
  phone: string | null;
  fax: string | null;
  availableDays: string[];
  availableDaysNote: string | null;
  capacity: string | null;
  websiteUrl: string | null;
  kyoseigata: string | null;
  meetsKaigoStandard: string | null;
  meetsShogaiStandard: string | null;
  remarks: string | null;
  raw: Record<string, string>;
  contentHash: string;
}

export interface ParseError {
  line: number;
  providerId?: string;
  /** 範囲指定 import でエラーを範囲内だけ数えるため（判明している場合） */
  prefecture?: string;
  city?: string;
  message: string;
}

export interface ParseResult {
  records: OfficialStationRecord[];
  errors: ParseError[];
  totalRows: number;
  encoding: "utf-8" | "shift_jis";
}

/** UTF-8 (BOM有無) / Shift_JIS(CP932) を自動判定してデコード */
export function decodeCsv(buf: Buffer): { text: string; encoding: "utf-8" | "shift_jis" } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return { text: (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text), encoding: "utf-8" };
  } catch {
    return { text: iconv.decode(buf, "cp932"), encoding: "shift_jis" };
  }
}

export function parseAvailableDays(value: string | null): string[] {
  const s = normalizeText(value);
  if (!s) return [];
  return s
    .split(/[,、，]/)
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

/** 差分判定用ハッシュ。キー順を固定し、正規化済みの値から計算（No 列など揺れやすい値は除外しない＝原文どおり） */
export function hashRecord(raw: Record<string, string>): string {
  const keys = Object.keys(raw).sort();
  const h = createHash("sha256");
  for (const k of keys) h.update(`${k}\u0001${normalizeText(raw[k]) ?? ""}\u0002`);
  return h.digest("hex");
}

/** 住所文字列から都道府県・市区町村部分を取り除いた残り */
export function splitAddress(fullAddress: string, prefecture: string, city: string): string | null {
  let rest = fullAddress;
  if (rest.startsWith(prefecture)) rest = rest.slice(prefecture.length);
  if (rest.startsWith(city)) rest = rest.slice(city.length);
  return normalizeText(rest);
}

const SATELLITE_PATTERN = /サテライト|出張所|分室|支所|サブステーション/;

/** サテライト等の従たる事業所なら名称（空白除去）をキーにする */
export function siteKeyFor(name: string): string {
  return SATELLITE_PATTERN.test(name) ? name.replace(/\s+/g, "") : "";
}

/** 事業所の一意キー */
export function recordKey(r: Pick<OfficialStationRecord, "officialProviderId" | "serviceCode" | "siteKey">): string {
  return `${r.officialProviderId}:${r.serviceCode}:${r.siteKey}`;
}

export function normalizeRow(row: Record<string, string>, line: number): OfficialStationRecord | ParseError {
  const get = (col: string) => normalizeText(row[col]);
  const providerId = get(MHLW_COLUMNS.providerId);
  const name = get(MHLW_COLUMNS.name);
  const prefecture = get(MHLW_COLUMNS.prefecture);
  const city = get(MHLW_COLUMNS.city);
  const fullAddress = get(MHLW_COLUMNS.address);
  const serviceType = get(MHLW_COLUMNS.serviceType);

  if (!providerId) return { line, message: "事業所番号がありません" };
  if (!/^[0-9A-Za-z]{10}$/.test(providerId))
    return { line, providerId, message: `事業所番号の形式が不正です: ${providerId}` };
  if (!name) return { line, providerId, message: "事業所名がありません" };
  if (!prefecture || !city) return { line, providerId, message: "都道府県名・市区町村名がありません" };
  if (!fullAddress) return { line, providerId, message: "住所がありません" };
  if (!serviceType) return { line, providerId, message: "サービスの種類がありません" };
  const serviceCode = SERVICE_CODES[serviceType];
  if (!serviceCode) return { line, providerId, message: `未対応のサービス種類です: ${serviceType}` };

  let lat = parseNumber(row[MHLW_COLUMNS.latitude]);
  let lng = parseNumber(row[MHLW_COLUMNS.longitude]);
  if (!isValidJapanCoordinate(lat, lng)) {
    lat = null;
    lng = null;
  }

  const localGov = get(MHLW_COLUMNS.localGovCode);
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) raw[k] = v ?? "";

  // 住所が都道府県名から始まらない場合は付与して完全住所にする（元の文字列は raw に保持）
  const full = fullAddress.startsWith(prefecture) ? fullAddress : `${prefecture}${fullAddress}`;

  return {
    officialProviderId: providerId,
    serviceCode,
    siteKey: siteKeyFor(name),
    serviceType,
    name,
    nameKana: get(MHLW_COLUMNS.nameKana),
    corporationName: get(MHLW_COLUMNS.corporationName),
    corporateNumber: get(MHLW_COLUMNS.corporateNumber),
    postalCode: null,
    prefecture,
    city,
    localGovCode: localGov && /^\d{6}$/.test(localGov) ? localGov : null,
    address: splitAddress(full, prefecture, city),
    fullAddress: full,
    building: get(MHLW_COLUMNS.building),
    officialLatitude: lat,
    officialLongitude: lng,
    phone: normalizePhone(row[MHLW_COLUMNS.phone]),
    fax: normalizePhone(row[MHLW_COLUMNS.fax]),
    availableDays: parseAvailableDays(row[MHLW_COLUMNS.availableDays]),
    availableDaysNote: get(MHLW_COLUMNS.availableDaysNote),
    capacity: get(MHLW_COLUMNS.capacity),
    websiteUrl: normalizeUrl(row[MHLW_COLUMNS.url]),
    kyoseigata: get(MHLW_COLUMNS.kyoseigata),
    meetsKaigoStandard: get(MHLW_COLUMNS.meetsKaigoStandard),
    meetsShogaiStandard: get(MHLW_COLUMNS.meetsShogaiStandard),
    remarks: get(MHLW_COLUMNS.remarks),
    raw,
    contentHash: hashRecord(raw),
  };
}

export function parseMhlwCsv(buf: Buffer): ParseResult {
  const { text, encoding } = decodeCsv(buf);
  const rows = parse(text, {
    columns: (header: string[]) => header.map((h) => normalizeText(h) ?? h),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false,
  }) as Record<string, string>[];

  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(normalizeText(h)!));
    if (missing.length > 0) {
      throw new Error(`CSVの列が想定と異なります。不足: ${missing.join(", ")}`);
    }
  }

  const records: OfficialStationRecord[] = [];
  const errors: ParseError[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const line = i + 2; // ヘッダ行が1行目
    const r = normalizeRow(row, line);
    if ("message" in r) {
      errors.push({ ...r, prefecture: normalizeText(row[MHLW_COLUMNS.prefecture]) ?? undefined, city: normalizeText(row[MHLW_COLUMNS.city]) ?? undefined });
      return;
    }
    const key = recordKey(r);
    if (seen.has(key)) {
      errors.push({ line, providerId: r.officialProviderId, prefecture: r.prefecture, city: r.city, message: "同一ファイル内で事業所番号が重複しています" });
      return;
    }
    seen.add(key);
    records.push(r);
  });
  return { records, errors, totalRows: rows.length, encoding };
}
