/** ジャンル軸140シリーズ／840点の機械検品。 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { SeriesDefSchema } from '../src/catalog/schema.js';

const EXPECTED_SHOT_TAGS = ['背景のみ', '1人・左配置', '1人・右配置', '2人', '3〜5人', '手元・寄り'];
const reportPath = '.akari/reports/genre-assets-mechanical.json';

interface ImageCheck {
  id: string;
  file: string;
  bytes: number;
  sha256: string;
  dHash: string;
  meanStddev: number;
}

function hamming(a: string, b: string): number {
  let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (value) { count += Number(value & 1n); value >>= 1n; }
  return count;
}

async function checkImage(path: string, id: string): Promise<{ image?: ImageCheck; issues: string[] }> {
  const issues: string[] = [];
  let data: Buffer;
  try { data = await readFile(path); } catch { return { issues: [`missing file: ${path}`] }; }
  const image = sharp(data);
  const [metadata, stats, hashPixels] = await Promise.all([
    image.clone().metadata(),
    image.clone().stats(),
    image.clone().resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer(),
  ]);
  if (metadata.width !== 2048 || metadata.height !== 1152) issues.push(`${id}: ${metadata.width}x${metadata.height}, expected 2048x1152`);
  if (metadata.hasAlpha) issues.push(`${id}: unexpected alpha channel`);
  if (data.byteLength < 100_000) issues.push(`${id}: suspiciously small file (${data.byteLength} bytes)`);
  const meanStddev = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / Math.min(3, stats.channels.length);
  if (meanStddev < 8) issues.push(`${id}: suspiciously flat image (mean stdev ${meanStddev.toFixed(2)})`);
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    bits = (bits << 1n) | (hashPixels[y * 9 + x]! > hashPixels[y * 9 + x + 1]! ? 1n : 0n);
  }
  return {
    image: {
      id,
      file: path,
      bytes: data.byteLength,
      sha256: createHash('sha256').update(data).digest('hex'),
      dHash: bits.toString(16).padStart(16, '0'),
      meanStddev,
    },
    issues,
  };
}

const dirs = await readdir('series');
const manifests = [];
for (const dir of dirs) {
  try {
    const def = SeriesDefSchema.parse(JSON.parse(await readFile(join('series', dir, 'series.json'), 'utf8')));
    if (def.pieces.length === 6 && def.pieces.every((piece) => piece.forThumbnail === true)) manifests.push(def);
  } catch { /* 他形式の既存素材はこの検査の対象外 */ }
}

const issues: string[] = [];
const images: ImageCheck[] = [];
const nearDuplicates: Array<{ series: string; first: string; second: string; distance: number }> = [];

if (manifests.length !== 140) issues.push(`genre series count: ${manifests.length}, expected 140`);
for (const def of manifests) {
  const checks = await Promise.all(def.pieces.map(async (piece, index) => {
    if (!piece.useTags.includes(EXPECTED_SHOT_TAGS[index]!)) issues.push(`${piece.id}: missing shot tag ${EXPECTED_SHOT_TAGS[index]}`);
    if (piece.alpha) issues.push(`${piece.id}: alpha must be false`);
    if (!piece.prompt.includes('Originality and rights:') || !piece.prompt.includes('People safety:') || !piece.prompt.includes('Rights constraints:')) issues.push(`${piece.id}: prompt safety clauses missing`);
    return checkImage(join('series', def.slug, piece.file), piece.id);
  }));
  const seriesImages: ImageCheck[] = [];
  for (const check of checks) {
    issues.push(...check.issues);
    if (check.image) { images.push(check.image); seriesImages.push(check.image); }
  }
  for (let i = 0; i < seriesImages.length; i++) for (let j = i + 1; j < seriesImages.length; j++) {
    const distance = hamming(seriesImages[i]!.dHash, seriesImages[j]!.dHash);
    if (distance <= 3) nearDuplicates.push({ series: def.slug, first: seriesImages[i]!.id, second: seriesImages[j]!.id, distance });
  }
}

const bySha = new Map<string, string[]>();
for (const image of images) bySha.set(image.sha256, [...(bySha.get(image.sha256) ?? []), image.id]);
const exactDuplicates = [...bySha.entries()].filter(([, ids]) => ids.length > 1).map(([sha256, ids]) => ({ sha256, ids }));
if (images.length !== 840) issues.push(`image count: ${images.length}, expected 840`);
if (exactDuplicates.length) issues.push(`exact duplicate groups: ${exactDuplicates.length}`);

const report = {
  generatedAt: new Date().toISOString(),
  ok: issues.length === 0,
  seriesCount: manifests.length,
  imageCount: images.length,
  totalBytes: images.reduce((sum, image) => sum + image.bytes, 0),
  exactDuplicates,
  nearDuplicates,
  issues,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
