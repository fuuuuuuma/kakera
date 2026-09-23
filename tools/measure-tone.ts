/**
 * シリーズ内のトーン距離の分布を出す。閾値を決めるための道具。
 * 使い方: npm run measure-tone -- series/night-desk/pieces
 */
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { inspectSeriesTone } from '../src/inspect/tone.js';

const dir = process.argv[2];
if (!dir) {
  console.error('使い方: npm run measure-tone -- <画像の入ったディレクトリ>');
  process.exit(1);
}

const files = (await readdir(dir))
  .filter((f) => ['.png', '.jpg', '.jpeg', '.webp'].includes(extname(f).toLowerCase()))
  .map((f) => join(dir, f))
  .sort();

if (files.length === 0) {
  console.error(`${dir} に画像がありません`);
  process.exit(1);
}

const r = await inspectSeriesTone(files, null);

console.log(`対象 ${files.length} 点 / ${dir}`);
console.log('');
for (const e of r.entries) {
  const bar = '█'.repeat(Math.round(e.distance * 60));
  console.log(`${e.distance.toFixed(4)}  ${bar}  ${e.file.split('/').pop()}`);
}
console.log('');
console.log(`最大 ${r.max.toFixed(4)} / 平均 ${r.mean.toFixed(4)}`);
console.log('この値を config/thresholds.json に、測った条件と一緒に書き入れてください。');
