// html.js ではなく html-core.js / layout.js から直接取る。このファイルは
// src/worker/community.ts から Worker ランタイムにも読み込まれるため、
// node:fs を持つ html.js を経由しない (詳細は html-core.ts のコメント参照)。
import { esc, attr, type SiteConfig } from '../html-core.js';
import { layout } from '../layout.js';
import { assetUrl } from '../../catalog/asset-url.js';

/**
 * Phase 2 (投稿の全員開放) の読み取り側の表示データ。
 * D1 の community_series / community_piece をそのまま持たず、ページ生成に要る形だけ
 * ここで定義する（`src/worker/community.ts` の `CommunityReadDeps` がこの形を返す）。
 * 運営審査カタログ (`CatalogSeries`/`CatalogPiece`・src/catalog/schema.ts) とは別物:
 * 投稿1点につき比率バリアントは作らない（元のPNG1枚だけ）。
 */
export interface CommunityPreviewPiece {
  id: string;
  r2Key: string;
  sha256: string;
  alpha: boolean;
}

export interface CommunitySeriesSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  creatorHandle: string;
  pieceCount: number;
  createdAt: string;
  /** 一覧のタイル表示用に先頭数点だけ */
  previewPieces: CommunityPreviewPiece[];
}

export interface CommunityPieceRow {
  id: string;
  kind: string;
  r2Key: string;
  bytes: number;
  mime: string;
  sha256: string;
  prompt: string;
  alpha: boolean;
  createdAt: string;
}

export interface CommunitySeriesDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  tone: { light: string; colorTemp: string; framing: string; texture: string };
  creatorHandle: string;
  generator: { service: string; model: string; version: string };
  createdAt: string;
}

/** ホームの `tiles()` と同じ考え方: 4点だけ見せて「揃い」を一目で伝える。 */
function tiles(previewPieces: CommunityPreviewPiece[], cfg: SiteConfig, title: string): string {
  const isAlpha = previewPieces.some((p) => p.alpha);
  const cls = isAlpha ? 'tiles alpha checker' : 'tiles';
  return `<div class="${cls}">${previewPieces
    .map(
      (p) =>
        `<img${attr({
          src: assetUrl(cfg.assetBaseUrl, p.r2Key, p.sha256),
          alt: `${title} ${p.id}`,
          loading: 'lazy',
        })}>`,
    )
    .join('')}</div>`;
}

export function communityIndexPage(args: { series: CommunitySeriesSummary[]; cfg: SiteConfig }): string {
  const { series, cfg } = args;

  const cards = series
    .map(
      (s) => `<article class="card">
<a href="/community/${esc(s.slug)}">
${tiles(s.previewPieces, cfg, s.title)}
<h3>${esc(s.title)}</h3>
</a>
<div class="by">${s.pieceCount} のかけら · ${esc(s.creatorHandle)}</div>
</article>`,
    )
    .join('');

  const empty =
    series.length === 0
      ? `<p class="lead">まだ投稿はありません。<a href="/terms">投稿規約</a>を読んで、最初の投稿者になりませんか？</p>`
      : '';

  const body = `
<p class="crumb"><a href="/">← すべてのシリーズ</a></p>
<h1>みんなの投稿</h1>
<p class="lead">誰でも <a href="/terms">投稿規約</a> に同意して素材を追加できます。
自動検品を通れば<strong>運営の審査を待たずに即座に公開</strong>されます。
権利侵害などの問題があれば <a href="/report">こちら</a> から取り下げを申し立てられます。</p>
${empty}
<div class="sechead"><h2>投稿シリーズ</h2><span class="note">新しい順</span></div>
<div class="grid">${cards}</div>`;

  return layout({
    title: 'みんなの投稿',
    description: '誰でも投稿できるKAKERAの投稿シリーズ一覧。自動検品を通れば即座に公開されます。',
    canonicalPath: '/community',
    body,
    cfg,
  });
}

export function communitySeriesPage(args: {
  series: CommunitySeriesDetail;
  pieces: CommunityPieceRow[];
  cfg: SiteConfig;
}): string {
  const { series, pieces, cfg } = args;

  const piecesHtml = pieces
    .map((p) => {
      const url = assetUrl(cfg.assetBaseUrl, p.r2Key, p.sha256);
      return `<article class="piece">
<div class="frame${p.alpha ? ' alpha checker' : ''}"><img${attr({
        src: url,
        alt: `${series.title} ${p.id}`,
        loading: 'lazy',
      })}></div>
<div class="tagline">${p.alpha ? '<span class="tag alpha">透過PNG</span>' : ''}</div>
<pre class="prompt">${esc(p.prompt)}</pre>
<a class="btn btn-p"${attr({
        href: url,
        download: p.id,
        'data-download': '1',
        'data-piece': p.id,
        'data-series': series.slug,
      })}>ダウンロード</a>
</article>`;
    })
    .join('');

  const body = `
<p class="crumb"><a href="/community">← みんなの投稿</a></p>
<h1>${esc(series.title)}</h1>
<p class="lead">${esc(series.description)}<br>
${pieces.length} のかけら。投稿: ${esc(series.creatorHandle)}。商用可・クレジット不要・改変自由。</p>

<div class="sechead"><h2>そろえたもの</h2></div>
<dl class="kv">
<div><dt>光</dt><dd>${esc(series.tone.light)}</dd></div>
<div><dt>色温度</dt><dd>${esc(series.tone.colorTemp)}</dd></div>
<div><dt>画角</dt><dd>${esc(series.tone.framing)}</dd></div>
<div><dt>質感</dt><dd>${esc(series.tone.texture)}</dd></div>
<div><dt>生成元</dt><dd>${esc(series.generator.service)} / ${esc(series.generator.model)}</dd></div>
</dl>

<p class="consent">この投稿は <a href="/terms">投稿規約</a> に基づく利用者投稿です。ダウンロードすると
<a href="/license">KAKERA ライセンス</a> に同意したものとみなします。
権利侵害などの問題がある場合は <a href="/report">こちら</a> から取り下げを申し立てられます
（削除の実行は必ず人が確認します）。</p>

<div class="sechead"><h2>かけら</h2><span class="note">${pieces.length} 点</span></div>
<div class="pieces">${piecesHtml}</div>`;

  return layout({
    title: series.title,
    description: `${series.description} 投稿者: ${series.creatorHandle}。誰でも投稿できるKAKERAのコミュニティ投稿。`,
    canonicalPath: `/community/${series.slug}`,
    body,
    cfg,
  });
}

export function communityNotFoundPage(cfg: SiteConfig, canonicalPath: string): string {
  return layout({
    title: '見つかりません',
    description: '指定された投稿は見つかりませんでした。',
    canonicalPath,
    body: `<h1>見つかりません</h1>
<p class="lead">指定された投稿は存在しないか、取り下げられました。<a href="/community">みんなの投稿へ戻る</a></p>`,
    cfg,
  });
}
