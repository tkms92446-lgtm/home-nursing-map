/**
 * データソース定義。新しい公的データ（他サービス種別・自治体台帳など）はここに追加する。
 */
export interface DataSourceDef {
  code: string;
  name: string;
  publisher: string;
  datasetName: string;
  url: string;
  /** 自動取得用の CSV URL（取得元の構造が変わったら更新、または data/raw/ へ手動配置） */
  downloadUrl?: string;
  /** 自動取得時のデータ時点（downloadUrl と組で更新する） */
  downloadAsOf?: string;
  license: string;
  termsUrl: string;
  isFictional: boolean;
}

export const DATA_SOURCES: Record<string, DataSourceDef> = {
  mhlw_kaigo_kouhyou_130: {
    code: "mhlw_kaigo_kouhyou_130",
    name: "厚生労働省 介護サービス情報公表システム",
    publisher: "厚生労働省",
    datasetName: "介護サービス情報公表システム オープンデータ（事業所一覧：訪問看護）",
    url: "https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html",
    downloadUrl: "https://www.mhlw.go.jp/content/12300000/jigyosho_130_all_20260709180342.csv",
    downloadAsOf: "2026-06-30",
    license: "介護サービス情報公表システム オープンデータ利用規約に基づき利用（出典の明記）",
    termsUrl: "https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html",
    isFictional: false,
  },
  fixture_fictional_130: {
    code: "fixture_fictional_130",
    name: "UI確認用の架空データ（実在しません）",
    publisher: "開発用",
    datasetName: "架空の訪問看護ステーション（厚労省CSVと同じ列構成）",
    url: "",
    license: "開発・テスト専用",
    termsUrl: "",
    isFictional: true,
  },
};
