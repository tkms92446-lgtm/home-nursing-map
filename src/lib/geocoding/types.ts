export type GeocodeStatus = "success" | "failed" | "needs_review";
/** 精度: official=公的データ記載の座標 / address=住居番号 / block=街区 / town=町丁目代表点 / city=市区町村代表点 */
export type GeocodeAccuracy = "official" | "address" | "block" | "town" | "city";

export interface GeocodeResult {
  status: GeocodeStatus;
  latitude: number | null;
  longitude: number | null;
  provider: string;
  accuracy: GeocodeAccuracy | null;
  matchedText: string | null;
  message?: string;
  raw?: unknown;
}

export interface GeocodeProvider {
  name: string;
  /** 外部 API を呼ぶ（課金・レート制限の対象になり得る）か */
  external: boolean;
  geocode(normalizedAddress: string): Promise<GeocodeResult>;
}

export const ACCURACY_RANK: Record<GeocodeAccuracy, number> = {
  official: 5,
  address: 4,
  block: 3,
  town: 2,
  city: 1,
};
