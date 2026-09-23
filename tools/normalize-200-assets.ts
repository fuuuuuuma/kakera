/**
 * ImageGenの可変サイズ出力をKAKERAの配布元画像規格へそろえる。
 *
 * - 透過素材: 2048×2048、アルファと余白を維持
 * - 背景付き素材: 2048×1152、注目領域を保ちながら16:9へクロップ
 *
 * 元のImageGenファイルは ~/.codex/generated_images に残るため、再生成せず復元できる。
 */
import { mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { SeriesDefSchema } from '../src/catalog/schema.js';

const SERIES_ROOT = 'series';

async function normalizeFile(path: string, alpha: boolean): Promise<'normalized' | 'unchanged'> {
  const metadata = await sharp(path).metadata();
  const targetWidth = 2048;
  const targetHeight = alpha ? 2048 : 1152;
  if (metadata.width === targetWidth && metadata.height === targetHeight && Boolean(metadata.hasAlpha) === alpha) {
    return 'unchanged';
  }

  const tempPath = `${path}.normalize.tmp.png`;
  await mkdir(dirname(path), { recursive: true });
  let pipeline = sharp(path).rotate();
  if (alpha) {
    pipeline = pipeline
      .ensureAlpha()
      .resize(targetWidth, targetHeight, {
        fit: 'contain',
        position: 'centre',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: sharp.kernel.lanczos3,
      });
  } else {
    pipeline = pipeline
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(targetWidth, targetHeight, {
        fit: 'cover',
        position: sharp.strategy.attention,
        kernel: sharp.kernel.lanczos3,
      });
  }
  await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(tempPath);
  await rename(tempPath, path);
  return 'normalized';
}

const selectedSlug = process.argv.includes('--series')
  ? process.argv[process.argv.indexOf('--series') + 1]
  : undefined;

const seriesDirs = selectedSlug ? [selectedSlug] : await readdir(SERIES_ROOT);
let normalized = 0;
let unchanged = 0;
let missing = 0;

for (const slug of seriesDirs) {
  const manifestPath = join(SERIES_ROOT, slug, 'series.json');
  let manifest;
  try {
    manifest = SeriesDefSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    if (selectedSlug) throw error;
    continue;
  }
  for (const piece of manifest.pieces) {
    const path = join(SERIES_ROOT, slug, piece.file);
    try {
      const result = await normalizeFile(path, piece.alpha);
      if (result === 'normalized') normalized += 1;
      else unchanged += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        missing += 1;
        continue;
      }
      throw error;
    }
  }
}

console.log(JSON.stringify({ normalized, unchanged, missing }, null, 2));
