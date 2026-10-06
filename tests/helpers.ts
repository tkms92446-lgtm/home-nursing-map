import iconv from "iconv-lite";

export const HEADER =
  "都道府県コード又は市町村コード,No,都道府県名,市区町村名,事業所名,事業所名カナ,サービスの種類,住所,方書（ビル名等）,緯度,経度,電話番号,FAX番号,法人番号,法人の名称,事業所番号,利用可能曜日,利用可能曜日特記事項,定員,URL,高齢者の方と障害者の方が同時一体的に利用できるサービス,介護保険の通常の指定基準を満たしている,障害福祉の通常の指定基準を満たしている,備考";

export interface RowInput {
  id: string;
  name?: string;
  city?: string;
  address?: string;
  lat?: string;
  lng?: string;
  phone?: string;
  days?: string;
  service?: string;
}

export function row(r: RowInput): string {
  const city = r.city ?? "大阪市天王寺区";
  const cols = [
    "271098", r.id, "大阪府", city, r.name ?? `テスト${r.id}`, "テスト", r.service ?? "訪問看護",
    r.address ?? `大阪府${city}上本町6丁目1-1`, "", r.lat ?? "", r.lng ?? "", r.phone ?? "06-1234-5678", "", "", "テスト法人",
    r.id, `"${r.days ?? "平日,土曜日"}"`, "", "", "", "", "", "", "",
  ];
  return cols.join(",");
}

export function csv(rows: RowInput[], encoding: "utf8bom" | "sjis" = "utf8bom"): Buffer {
  const text = [HEADER, ...rows.map(row)].join("\r\n") + "\r\n";
  return encoding === "sjis" ? iconv.encode(text, "cp932") : Buffer.from("﻿" + text, "utf8");
}
