/**
 * シリーズを検品してレポートを出す。
 * 使い方: npm run inspect -- series/night-desk
 */
import { readFile } from 'node:fs/promises';
import { inspectSeries, type Thresholds } from '../src/inspect/series.js';

const dir = process.argv[2];
if (!dir) {
  console.error('使い方: npm run inspect -- <シリーズのディレクトリ>');
  process.exit(1);
}

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

const r = await inspectSeries(dir, th);

console.log(`${r.def.title}（${r.slug}） / ${r.def.pieces.length}のかけら`);
console.log(`生成元: ${r.def.generator.service} ${r.def.generator.model}`);
console.log('');

if (r.tone) {
  console.log(
    `トーンの散らばり: 最大 ${r.tone.max.toFixed(4)} / 平均 ${r.tone.mean.toFixed(4)}` +
      (r.tone.threshold === null ? '（閾値は未計測なので測るだけ）' : `（上限 ${r.tone.threshold}）`),
  );
  for (const e of r.tone.entries.slice(0, 3)) {
    console.log(`  ${e.distance.toFixed(4)}  ${e.file.split('/').pop()}`);
  }
  console.log('');
}

for (const p of r.pieceIssues) {
  console.log(`[かけら] ${p.pieceId} (${p.file})`);
  for (const i of p.issues) console.log(`    - ${i}`);
}
for (const b of r.blocking) console.log(`[止める] ${b}`);

console.log('');
console.log(r.ok ? '通りました。棚に出せます。' : '止めました。上の指摘を直してください。');
process.exit(r.ok ? 0 : 1);
