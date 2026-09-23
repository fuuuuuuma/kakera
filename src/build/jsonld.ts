import type { CatalogPiece, CatalogSeries } from '../catalog/schema.js';
import { assetUrl } from '../catalog/asset-url.js';

/** Google 画像検索向けの構造化データ。 */
export const LICENSE_URL = '/license';

const trimSlash = (u: string): string => u.replace(/\/+$/, '');

/**
 * かけら1つぶんの ImageObject を返す。
 * 静止画でない、または書き出しが1つも無いときは null。
 */
export function imageObjectLd(args: {
  piece: CatalogPiece;
  series: CatalogSeries;
  siteUrl: string;
  assetBaseUrl: string;
}): Record<string, unknown> | null {
  const { piece, series } = args;
  if (piece.kind !== 'still') return null;
  if (piece.variants.length === 0) return null;

  const site = trimSlash(args.siteUrl);
  const assets = trimSlash(args.assetBaseUrl);
  const largest = [...piece.variants].sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
  const seriesPage = `${site}/series/${series.slug}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    name: `${series.title} — ${piece.id}`,
    description:
      `AI（${series.generator.service} / ${series.generator.model}）で生成した素材。` +
      `シリーズ「${series.title}」の1点。プロンプト: ${piece.prompt}`,
    contentUrl: assetUrl(assets, largest.key, piece.sha256),
    width: largest.w,
    height: largest.h,
    encodingFormat: largest.mime,
    license: `${site}${LICENSE_URL}`,
    acquireLicensePage: seriesPage,
    creditText: `KAKERA / ${series.creator}`,
    creator: { '@type': 'Person', name: series.creator },
    copyrightNotice: `KAKERA / ${series.creator}`,
    isPartOf: { '@type': 'CreativeWork', name: series.title, url: seriesPage },
    keywords: piece.useTags.join(', '),
  };
}
