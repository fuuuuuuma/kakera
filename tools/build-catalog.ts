/**
 * すべてのシリーズを検品してカタログを吐く。
 * 使い方: npm run build-catalog
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCatalog } from '../src/build/catalog.js';
import type { Thresholds } from '../src/inspect/series.js';

const SERIES_ROOT = 'series';
const OUT_ROOT = 'dist/variants';
const OUT_JSON = 'dist/catalog.json';

const cfg = JSON.parse(
  await readFile(new URL('../config/thresholds.json', import.meta.url), 'utf8'),
) as {
  toneMaxDistance: { value: number | null };
  loopFirstLastRms: { value: number | null };
  audioMaxVolumeDb: { value: number };
};
const th: Thresholds = {
  toneMaxDistance: cfg.toneMaxDistance.value,
  loopFirstLastRms: cfg.loopFirstLastRms.value,
  audioMaxVolumeDb: cfg.audioMaxVolumeDb.value,
};

const dirs = (await readdir(SERIES_ROOT, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => join(SERIES_ROOT, d.name))
  .sort();

if (dirs.length === 0) {
  console.error(`${SERIES_ROOT}/ にシリーズがありません`);
  process.exit(1);
}

// 検品で止まったときにスタックトレースを吐かない。読める理由だけを出す。
try {
  const catalog = await buildCatalog(dirs, OUT_ROOT, th);
  await mkdir('dist', { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(catalog, null, 2));

  console.log(
    `${catalog.seriesCount} シリーズ / ${catalog.pieceCount} のかけら を ${OUT_JSON} に書きました`,
  );
  for (const s of catalog.series) {
    console.log(`  ${s.slug}  ${s.pieceCount}点  トーン最大距離 ${s.toneMaxDistance.toFixed(4)}`);
  }
} catch (e) {
  console.error('カタログを書けませんでした。');
  console.error((e as Error).message);
  console.error('');
  console.error('シリーズ単位で確かめるなら: npm run inspect -- series/<slug>');
  process.exit(1);
}
