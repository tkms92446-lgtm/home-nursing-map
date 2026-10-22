"""公開ページ用の stations.json を作る。

入力:
  - 厚労省 介護サービス情報公表システム オープンデータ（訪問看護 jigyosho_130）の CSV
  - 連絡会アンケートを整理した CSV（site/data/members.csv）
使い方:
  python3 scripts/site/build-stations.py <jigyosho_130.csv>
"""
import csv, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MEMBERS_CSV = ROOT / "site/data/members.csv"
OUT = ROOT / "site/data/stations.json"
MHLW_SOURCE = "厚生労働省 介護サービス情報公表システム オープンデータ（訪問看護、2026年6月末時点）"
FEATS = ["24時間対応", "土日対応", "小児受入れ", "精神科対応", "ターミナル", "人工呼吸器", "リハビリ",
         "腹膜透析受入れ", "翌日までの受入れ判断", "外国語対応", "認定・特定看護師"]


def tel(row):
    parts = []
    if row["電話番号"]:
        parts.append("TEL " + row["電話番号"])
    if row["FAX番号"]:
        parts.append("FAX " + row["FAX番号"])
    return " / ".join(parts)


def days(row):
    d = row["利用可能曜日"]
    if row["利用可能曜日特記事項"]:
        d += "（" + row["利用可能曜日特記事項"] + "）"
    return d


def main(mhlw_path):
    mhlw = [r for r in csv.DictReader(open(mhlw_path, encoding="utf-8-sig"))
            if r["市区町村名"].startswith("大阪市")]
    by_no = {r["事業所番号"]: r for r in mhlw}
    members = list(csv.DictReader(open(MEMBERS_CSV, encoding="utf-8")))
    used = set()
    out = []
    for m in members:
        src = by_no.get(m["事業所番号"]) if m["事業所番号"] else None
        rec = {
            "member": True,
            "区": "天王寺区",
            "事業所名": m["事業所名"],
            "住所": m["住所"],
            "建物": m["建物・部屋"],
            "電話": tel(src) if src else m["公開電話"],
            "営業日": days(src) if src else "",
            "URL": src["URL"] if src else "",
            "法人": src["法人の名称"] if src else "",
            "lat": float(src["緯度"]) if src else None,
            "lng": float(src["経度"]) if src else None,
            "geocode": m["位置の検索用住所"],
            "メモ": m["メモ"],
            "出典": "連絡会アンケートへの回答（" + m["回答日"] + "）" + ("／" + MHLW_SOURCE if src else ""),
        }
        for k in FEATS:
            rec[k] = m[k]
        if src:
            used.add(src["事業所番号"])
        out.append(rec)
    rest = [r for r in mhlw if r["事業所番号"] not in used]
    rest.sort(key=lambda r: r["市区町村名"] != "大阪市天王寺区")
    for r in rest:
        out.append({
            "member": False,
            "区": r["市区町村名"].replace("大阪市", ""),
            "事業所名": r["事業所名"],
            "住所": r["住所"],
            "建物": "",
            "電話": tel(r),
            "営業日": days(r),
            "URL": r["URL"],
            "法人": r["法人の名称"],
            "lat": float(r["緯度"]) if r["緯度"] else None,
            "lng": float(r["経度"]) if r["経度"] else None,
            "出典": MHLW_SOURCE,
        })
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)}件（連絡会 {len(members)}件・厚労省と一致 {len(used)}件）→ {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1])
