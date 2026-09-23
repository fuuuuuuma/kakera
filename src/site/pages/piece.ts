import { esc, attr, layout, type SiteConfig } from '../html.js';
import { imageObjectLd } from '../../build/jsonld.js';
import { assetUrl } from '../../catalog/asset-url.js';
import type { CatalogPiece, CatalogSeries } from '../../catalog/schema.js';

const kb = (n: number): string => `${Math.round(n / 1024).toLocaleString('en-US')} KB`;

export function piecePage(args: {
  piece: CatalogPiece;
  series: CatalogSeries;
  cfg: SiteConfig;
}): string {
  const { piece, series, cfg } = args;
  const preview = [...piece.variants].sort((a, b) => b.w * b.h - a.w * a.h)[0];

  const ld = imageObjectLd({
    piece,
    series,
    siteUrl: cfg.siteUrl,
    assetBaseUrl: cfg.assetBaseUrl,
  });
  // </script> でページを壊さないよう < をエスケープする
  const head = ld
    ? `<script type="application/ld+json">${JSON.stringify(ld, null, 1).replace(/</g, '\\u003c')}</script>`
    : '';

  const downloads = piece.variants
    .map((v) => {
      const url = assetUrl(cfg.assetBaseUrl, v.key, piece.sha256);
      return `<li class="dlrow">
<a class="btn btn-p"${attr({
        href: url,
        download: `${piece.id}-${v.ratio.replace(':', 'x')}`,
        'data-download': '1',
        'data-piece': piece.id,
        'data-series': series.slug,
      })}>${esc(v.ratio)} で落とす</a>
<span class="dl">${esc(`${v.w}×${v.h}`)} · ${esc(kb(v.bytes))}</span>
</li>`;
    })
    .join('');

  const body = `
<p class="crumb"><a href="/series/${esc(series.slug)}">← ${esc(series.title)}</a></p>
<h1>${esc(piece.id)}</h1>
<p class="lead">${esc(series.title)} の1点。AIで生成した素材です。商用可・クレジット不要・改変自由。</p>
${
  preview
    ? `<div class="preview${piece.alpha ? ' checker' : ''}"><img${attr({
        src: assetUrl(cfg.assetBaseUrl, preview.key, piece.sha256),
        width: preview.w,
        height: preview.h,
        alt: `${series.title} ${piece.id}`,
      })}></div>`
    : ''
}

<div class="sechead"><h2>ダウンロード</h2><span class="note">比率を選んでください</span></div>
<ul class="dllist">${downloads}</ul>
<p class="consent">ダウンロードすると <a href="/license">KAKERA ライセンス</a> に同意したものとみなします。
商用可・クレジット不要・改変自由。禁止するのは素材ファイルそのものの再配布・転売・素材集への収録のみです。</p>

<div class="sechead"><h2>プロンプト</h2><span class="note">全シリーズで公開しています</span></div>
<pre class="prompt">${esc(piece.prompt)}</pre>

<div class="sechead"><h2>この素材について</h2></div>
<dl class="kv">
<div><dt>生成元</dt><dd>${esc(series.generator.service)} / ${esc(series.generator.model)}</dd></div>
<div><dt>元ファイル</dt><dd>${esc(kb(piece.bytes))}（${esc(piece.mime)}）</dd></div>
<div><dt>用途</dt><dd>${
    piece.useTags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ') || '—'
  }</dd></div>
<div><dt>ライセンス</dt><dd><a href="/license">KAKERA Free</a></dd></div>
<div><dt>SHA-256</dt><dd class="dl">${esc(piece.sha256)}</dd></div>
</dl>`;

  return layout({
    title: `${piece.id} — ${series.title}`,
    description: `${series.title} の1点。AIで生成した素材。商用可・クレジット不要。プロンプト付き。`,
    canonicalPath: `/piece/${piece.id}`,
    body,
    cfg,
    head,
  });
}
