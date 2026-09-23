/**
 * 単色背景の生成物を一括で抜く。
 * 使い方: npm run cutout -- <入力ディレクトリ> <出力ディレクトリ>
 *
 * 抜いたあとは必ず検品CLIに通すこと。ここは「抜く」だけで「出せる」判定はしない。
 */
import { readdir, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import sharp from 'sharp';
import { chromaKey, suppressSpill } from '../src/inspect/chroma.js';

const [inDir, outDir] = process.argv.slice(2);
if (!inDir || !outDir) {
  console.error('使い方: npm run cutout -- <入力ディレクトリ> <出力ディレクトリ>');
  process.exit(1);
}
await mkdir(outDir, { recursive: true });

const files = (await readdir(inDir)).filter((f) => extname(f).toLowerCase() === '.png').sort();
let warn = 0;

for (const f of files) {
  const { data, info } = await sharp(join(inDir, f)).raw().toBuffer({ resolveWithObject: true });
  const r = chromaKey(new Uint8Array(data), info.width, info.height, info.channels);
  const out = suppressSpill(r.data, r.background);

  await sharp(Buffer.from(out), { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, f));

  const pct = (r.transparentRatio * 100).toFixed(1);
  // 抜けなさすぎ・抜けすぎのどちらも人が見るべき合図
  const flag =
    r.transparentRatio < 0.15 ? '  ← ほとんど抜けていない' :
    r.transparentRatio > 0.97 ? '  ← 抜けすぎ（主体が消えた可能性）' : '';
  if (flag) warn++;
  console.log(`  ${f}  背景 rgb(${r.background.join(',')})  透明 ${pct}%${flag}`);
}

console.log('');
console.log(`${files.length} 点を抜きました${warn ? `（要確認 ${warn} 点）` : ''}`);
