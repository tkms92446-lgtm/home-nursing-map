// MapLibre GL v6 の Web Worker を public/maplibre/ へコピー（Next.js のバンドルでは worker の相対URLが解決できないため）
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const src = path.join(process.cwd(), "node_modules", "maplibre-gl", "dist");
const dest = path.join(process.cwd(), "public", "maplibre");
mkdirSync(dest, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(path.join(src, f), path.join(dest, f));
console.log("maplibre worker copied to public/maplibre/");
