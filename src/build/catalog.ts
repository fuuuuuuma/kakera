import { readFile, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';
import { inspectSeries, type Thresholds } from '../inspect/series.js';
import { writeVariants } from '../inspect/variants.js';
import { ratioLabel } from '../inspect/image.js';
import { inspectLoop } from '../inspect/video.js';
import { inspectAudio } from '../inspect/audio.js';
import type {
  Catalog,
  CatalogPiece,
  CatalogSeries,
  CatalogVariant,
} from '../catalog/schema.js';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function buildCatalog(
  seriesDirs: string[],
  outRoot: string,
  th: Thresholds,
): Promise<Catalog> {
  const series: CatalogSeries[] = [];

  for (const dir of seriesDirs) {
    const report = await inspectSeries(dir, th);
    if (!report.ok) {
      const why = [...report.blocking, ...report.pieceIssues.flatMap((p) => p.issues)].join(' / ');
      throw new Error(`${dir} は検品を通っていないのでカタログに入れられません: ${why}`);
    }

    const def = report.def;
    const pieces: CatalogPiece[] = [];

    for (const p of def.pieces) {
      const src = join(dir, p.file);
      const ext = extname(src).toLowerCase();
      const { size } = await stat(src);

      let variants: CatalogVariant[] = [];
      let durationMs: number | undefined;
      let loopSeamless: boolean | undefined;

      if (p.kind === 'still') {
        variants = await writeVariants(src, join(outRoot, def.slug, p.id), p.id, {
          alpha: p.alpha,
          forThumbnail: p.forThumbnail,
          keyPrefix: def.slug,
        });
      } else if (p.kind === 'loop') {
        const r = await inspectLoop(src, th.loopFirstLastRms);
        durationMs = r.durationMs;
        loopSeamless = r.seamless ?? undefined;
        variants = [
          {
            ratio: 'source',
            w: r.width,
            h: r.height,
            key: `${def.slug}/${p.id}/${p.id}${ext}`,
            bytes: size,
            mime: MIME[ext] ?? 'application/octet-stream',
          },
        ];
      } else {
        const r = await inspectAudio(src, {
          maxVolumeDb: th.audioMaxVolumeDb,
          maxEdgeSilenceMs: 500,
        });
        durationMs = r.durationMs;
        variants = [
          {
            ratio: 'source',
            w: 0,
            h: 0,
            key: `${def.slug}/${p.id}/${p.id}${ext}`,
            bytes: size,
            mime: MIME[ext] ?? 'application/octet-stream',
          },
        ];
      }

      pieces.push({
        id: p.id,
        kind: p.kind,
        prompt: p.prompt,
        ...(p.seed === undefined ? {} : { seed: p.seed }),
        alpha: p.alpha,
        useTags: p.useTags,
        sha256: await sha256(src),
        bytes: size,
        mime: MIME[ext] ?? 'application/octet-stream',
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(loopSeamless === undefined ? {} : { loopSeamless }),
        variants,
      });
    }

    series.push({
      slug: def.slug,
      title: def.title,
      description: def.description,
      audience: def.audience,
      creator: def.creator,
      license: def.license,
      tone: def.tone,
      generator: def.generator,
      promptPublic: true,
      pieceCount: pieces.length,
      toneMaxDistance: report.tone?.max ?? 0,
      pieces,
    });
  }

  const catalog: Catalog = {
    version: 1,
    builtAt: new Date().toISOString(),
    seriesCount: series.length,
    pieceCount: series.reduce((s, x) => s + x.pieces.length, 0),
    series,
  };

  assertCatalogIntegrity(catalog);
  await assertKeysResolve(catalog, outRoot);
  return catalog;
}

/** カタログの key が outRoot 配下の実ファイルを指すことを確かめる。 */
export async function assertKeysResolve(c: Catalog, outRoot: string): Promise<void> {
  for (const s of c.series) {
    for (const p of s.pieces) {
      if (p.kind !== 'still') continue;
      for (const v of p.variants) {
        const path = join(outRoot, v.key);
        try {
          await access(path);
        } catch {
          throw new Error(
            `${s.slug}/${p.id} のキーが実体を指していません: key="${v.key}" → ${path} が存在しない`,
          );
        }
      }
    }
  }
}

/** カタログが自分の主張と食い違っていないかを機械で照合する。 */
export function assertCatalogIntegrity(c: Catalog): void {
  if (c.seriesCount !== c.series.length) {
    throw new Error(`seriesCount が ${c.seriesCount} ですが、実際は ${c.series.length} 件です`);
  }
  const total = c.series.reduce((s, x) => s + x.pieces.length, 0);
  if (c.pieceCount !== total) {
    throw new Error(`pieceCount が ${c.pieceCount} ですが、実際は ${total} 点です`);
  }

  const slugs = new Set<string>();
  for (const s of c.series) {
    if (slugs.has(s.slug)) throw new Error(`シリーズの slug が重複しています: ${s.slug}`);
    slugs.add(s.slug);

    if (s.pieceCount !== s.pieces.length) {
      throw new Error(
        `${s.slug} の pieceCount が ${s.pieceCount} ですが、実際は ${s.pieces.length} 点です`,
      );
    }

    const ids = new Set<string>();
    for (const p of s.pieces) {
      if (ids.has(p.id)) throw new Error(`${s.slug} でかけらの id が重複しています: ${p.id}`);
      ids.add(p.id);

      if (p.prompt.trim() === '') {
        throw new Error(`${s.slug}/${p.id} のプロンプトが空です（全シリーズ公開が前提）`);
      }
      for (const v of p.variants) {
        if (v.ratio !== 'source' && ratioLabel(v.w, v.h) !== v.ratio) {
          throw new Error(
            `${s.slug}/${p.id} の比率が食い違っています: ${v.ratio} と宣言して実寸は ${v.w}×${v.h}`,
          );
        }
      }
    }
  }
}
