// MapLibre をクライアントでのみ読み込み、Worker の配置先を指定する
export async function loadMaplibre() {
  const lib = await import("maplibre-gl");
  lib.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
  return lib;
}
