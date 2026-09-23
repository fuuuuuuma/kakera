/**
 * Phase 2 (投稿の全員開放) の読み取り側: GET /community・GET /community/<slug>。
 * 設計: docs/design-2026-09-23-phase2-open-submissions.md
 *
 * これまで投稿 (`/api/submit`) は D1・R2 に書き込むところまでで、サイトのどこにも
 * 表示されていなかった（静的サイト dist/site は運営審査カタログ series/*.json から
 * ビルド時に作るだけで、community_series/community_piece を読む経路が無かった）。
 * この2ルートで「即座に公開」を実際に見える形にする。
 *
 * 投稿API (`submit.ts`) と同じ理由で、D1 への実際のI/Oは `CommunityReadDeps` 越しに呼ぶ。
 * テストは偽物の deps を直接渡す（wrangler のミニフレア相当は使わない）。
 */
import {
  communityIndexPage,
  communitySeriesPage,
  communityNotFoundPage,
  type CommunitySeriesSummary,
  type CommunitySeriesDetail,
  type CommunityPieceRow,
} from '../site/pages/community.js';
// html.js ではなく html-core.js から。html.js は node:fs (loadSiteConfig) を持ち、
// Worker のバンドルに fs を巻き込まないため (詳細は site/html-core.ts のコメント参照)。
import type { SiteConfig } from '../site/html-core.js';

export type { CommunitySeriesSummary, CommunitySeriesDetail, CommunityPieceRow };

export interface CommunityReadDeps {
  /** status='published' のシリーズだけを新しい順で返す (取り下げ済み・保留中は出さない) */
  listPublishedSeries(): Promise<CommunitySeriesSummary[]>;
  /** slug から status='published' のシリーズ1件とそのかけらを返す。
   * 無ければ null (存在しない slug・取り下げ済み・保留中のいずれも null で統一する。
   * 「取り下げたら404」と「元から無い」を外から区別できないようにするのは意図的
   * — 取り下げた投稿の slug を通報者以外に推測させないため)。 */
  getPublishedSeriesBySlug(slug: string): Promise<{ series: CommunitySeriesDetail; pieces: CommunityPieceRow[] } | null>;
}

export interface PageResult {
  status: number;
  html: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function handleCommunityIndex(deps: CommunityReadDeps, cfg: SiteConfig): Promise<PageResult> {
  const series = await deps.listPublishedSeries();
  return { status: 200, html: communityIndexPage({ series, cfg }) };
}

export async function handleCommunitySeries(
  slug: string,
  deps: CommunityReadDeps,
  cfg: SiteConfig,
): Promise<PageResult> {
  if (!SLUG.test(slug)) {
    return { status: 404, html: communityNotFoundPage(cfg, '/community') };
  }
  const found = await deps.getPublishedSeriesBySlug(slug);
  if (!found) {
    return { status: 404, html: communityNotFoundPage(cfg, `/community/${slug}`) };
  }
  return { status: 200, html: communitySeriesPage({ series: found.series, pieces: found.pieces, cfg }) };
}
