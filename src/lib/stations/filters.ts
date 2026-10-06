/**
 * 検索フィルター定義（公的データに存在する項目のみ）。
 * 24時間対応・精神科・小児・ターミナル・PT/OT/ST などは今回の公的CSVに項目が無いため、
 * UI に出さない。将来 station_profiles（事業所登録情報）等で取得できた時点でここへ追加する。
 */
export interface FilterDef {
  key: string;
  label: string;
  description: string;
  /** station_official_data.available_days に含まれるべき値 */
  availableDay?: string;
}

export const STATION_FILTERS: FilterDef[] = [
  { key: "sat", label: "土曜日", description: "公的データの「利用可能曜日」に土曜日の記載あり", availableDay: "土曜日" },
  { key: "sun", label: "日曜日", description: "公的データの「利用可能曜日」に日曜日の記載あり", availableDay: "日曜日" },
  { key: "hol", label: "祝日", description: "公的データの「利用可能曜日」に祝日の記載あり", availableDay: "祝日" },
];

export const FILTER_KEYS = STATION_FILTERS.map((f) => f.key);

export function filtersToAvailableDays(keys: string[]): string[] {
  return STATION_FILTERS.filter((f) => keys.includes(f.key) && f.availableDay).map((f) => f.availableDay!);
}

export const SEARCH_RADII = [500, 1000, 3000, 5000, 10000] as const;
export type SearchRadius = (typeof SEARCH_RADII)[number];
