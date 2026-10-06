import { describe, expect, it } from "vitest";
import { decideAction, inScope } from "@/lib/import/importer";
import { hashRecord, parseAvailableDays, parseMhlwCsv, splitAddress } from "@/lib/import/mhlw";
import { normalizePhone, normalizeText, normalizeUrl } from "@/lib/text";
import { csv } from "./helpers";

describe("CSV parsing", () => {
  it("UTF-8(BOM付き) の厚労省形式CSVを読み込める", () => {
    const r = parseMhlwCsv(csv([{ id: "2710000001", lat: "34.665", lng: "135.519" }]));
    expect(r.encoding).toBe("utf-8");
    expect(r.totalRows).toBe(1);
    expect(r.errors).toEqual([]);
    const s = r.records[0];
    expect(s.officialProviderId).toBe("2710000001");
    expect(s.serviceCode).toBe("130");
    expect(s.prefecture).toBe("大阪府");
    expect(s.city).toBe("大阪市天王寺区");
    expect(s.officialLatitude).toBe(34.665);
    expect(s.availableDays).toEqual(["平日", "土曜日"]);
    expect(s.postalCode).toBeNull(); // 元データに無い項目は推測しない
  });

  it("Shift_JIS のCSVも読み込める", () => {
    const r = parseMhlwCsv(csv([{ id: "2710000001", name: "テスト訪問看護ステーション" }], "sjis"));
    expect(r.encoding).toBe("shift_jis");
    expect(r.records[0].name).toBe("テスト訪問看護ステーション");
  });

  it("必須項目の欠落・形式不正・ファイル内重複はエラーとして数える", () => {
    const r = parseMhlwCsv(
      csv([
        { id: "2710000001" },
        { id: "2710000001" }, // 重複
        { id: "123" }, // 形式不正
        { id: "2710000004", address: "" }, // 住所なし
        { id: "2710000005", service: "訪問介護" }, // 対象外サービス
      ]),
    );
    expect(r.records).toHaveLength(1);
    expect(r.errors).toHaveLength(4);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
  });

  it("サテライト事業所は主たる事業所と事業所番号を共有しても別事業所として扱う", () => {
    const r = parseMhlwCsv(
      csv([
        { id: "2264290277", name: "ハートピアの森リハビリ訪問看護ステーションサテライト瀬名" },
        { id: "2264290277", name: "ハートピアの森 リハビリ訪問看護ステーション" },
      ]),
    );
    expect(r.errors).toEqual([]);
    expect(r.records.map((x) => x.siteKey)).toEqual(["ハートピアの森リハビリ訪問看護ステーションサテライト瀬名", ""]);
  });

  it("列構成が異なるCSVは明示的に失敗する", () => {
    expect(() => parseMhlwCsv(Buffer.from("a,b,c\n1,2,3\n"))).toThrow(/列が想定と異なります/);
  });

  it("日本国外・不正な緯度経度は採用しない", () => {
    const r = parseMhlwCsv(csv([{ id: "2710000001", lat: "0", lng: "0" }]));
    expect(r.records[0].officialLatitude).toBeNull();
  });
});

describe("データ正規化", () => {
  it("全角英数・記号を半角化し空白を整える", () => {
    expect(normalizeText("　上本町６丁目１－１　")).toBe("上本町6丁目1-1");
    expect(normalizeText("   ")).toBeNull();
    expect(normalizeText("ステーション")).toBe("ステーション"); // 長音は保持
  });
  it("電話番号を正規化し不正値は null", () => {
    expect(normalizePhone("０６－１２３４－５６７８")).toBe("06-1234-5678");
    expect(normalizePhone("不明")).toBeNull();
  });
  it("URL は http(s) のみ", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("http://example.com")).toBe("http://example.com/");
  });
  it("住所から都道府県・市区町村を分離", () => {
    expect(splitAddress("大阪府大阪市天王寺区上本町6丁目1-1", "大阪府", "大阪市天王寺区")).toBe("上本町6丁目1-1");
  });
  it("利用可能曜日を配列化", () => {
    expect(parseAvailableDays("平日,土曜日,日曜日,祝日")).toEqual(["平日", "土曜日", "日曜日", "祝日"]);
    expect(parseAvailableDays("")).toEqual([]);
  });
  it("ハッシュはキー順に依存せず、値の変化で変わる", () => {
    expect(hashRecord({ a: "1", b: "2" })).toBe(hashRecord({ b: "2", a: "1" }));
    expect(hashRecord({ a: "1" })).not.toBe(hashRecord({ a: "2" }));
  });
});

describe("差分判定", () => {
  it("INSERT / UPDATE / UNCHANGED を判定する", () => {
    expect(decideAction(undefined, "h1")).toBe("insert");
    expect(decideAction({ content_hash: "h1", status: "active" }, "h1")).toBe("unchanged");
    expect(decideAction({ content_hash: "h1", status: "active" }, "h2")).toBe("update");
    expect(decideAction({ content_hash: "h1", status: "inactive_candidate" }, "h1")).toBe("update");
  });
  it("取り込み範囲（都道府県・市区町村前方一致）", () => {
    const r = { prefecture: "大阪府", city: "大阪市天王寺区" };
    expect(inScope(r, {})).toBe(true);
    expect(inScope(r, { prefecture: "大阪府", cityPrefix: "大阪市" })).toBe(true);
    expect(inScope(r, { cityPrefix: "大阪市北区" })).toBe(false);
    expect(inScope(r, { prefecture: "兵庫県" })).toBe(false);
  });
});
