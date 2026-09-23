import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CatalogVariant } from '../catalog/schema.js';

interface Target {
  ratio: CatalogVariant['ratio'];
  w: number;
  h: number;
  suffix: string;
}

const BASE_TARGETS: Target[] = [
  { ratio: '16:9', w: 1920, h: 1080, suffix: '16x9' },
  { ratio: '9:16', w: 1080, h: 1920, suffix: '9x16' },
  { ratio: '1:1', w: 1080, h: 1080, suffix: '1x1' },
];

/** YouTube サムネの実寸 */
const THUMBNAIL_TARGET: Target = { ratio: '16:9', w: 1280, h: 720, suffix: '1280x720' };

export async function writeVariants(
  srcPath: string,
  outDir: string,
  baseName: string,
  opts: { alpha: boolean; forThumbnail: boolean; keyPrefix?: string },
): Promise<CatalogVariant[]> {
  await mkdir(outDir, { recursive: true });
  const out: CatalogVariant[] = [];
  // キーは実ファイルの置き場所と一致していなければならない。
  // シリーズ名を落とすと R2 のキーが実体とずれる（実データで踏んだ）。
  const prefix = opts.keyPrefix ? `${opts.keyPrefix}/` : '';

  // 透過は切らない。切ると絵が欠けるうえ、重ねる用途では元の比率が意味を持つ。
  if (opts.alpha) {
    const meta = await sharp(srcPath).metadata();
    const name = `${baseName}-source.png`;
    const dest = join(outDir, name);
    await sharp(srcPath).png({ compressionLevel: 9 }).toFile(dest);
    const { size } = await stat(dest);
    out.push({
      ratio: 'source',
      w: meta.width ?? 0,
      h: meta.height ?? 0,
      key: `${prefix}${baseName}/${name}`,
      bytes: size,
      mime: 'image/png',
    });
    return out;
  }

  const targets = opts.forThumbnail ? [...BASE_TARGETS, THUMBNAIL_TARGET] : BASE_TARGETS;

  for (const t of targets) {
    const name = `${baseName}-${t.suffix}.jpg`;
    const dest = join(outDir, name);
    await sharp(srcPath)
      // 主題が中央にあるとは限らないので、注目領域を残す切り方にする
      .resize(t.w, t.h, { fit: 'cover', position: sharp.strategy.attention })
      .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
      .toFile(dest);
    const { size } = await stat(dest);
    out.push({
      ratio: t.ratio,
      w: t.w,
      h: t.h,
      key: `${prefix}${baseName}/${name}`,
      bytes: size,
      mime: 'image/jpeg',
    });
  }

  return out;
}
