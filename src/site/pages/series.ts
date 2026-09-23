import { esc, attr, layout, type SiteConfig } from '../html.js';
import { assetUrl } from '../../catalog/asset-url.js';
import type { CatalogPiece, CatalogSeries } from '../../catalog/schema.js';

/** 一覧に出す代表の書き出し。16:9 があればそれ、無ければ一番大きいもの。 */
function thumb(p: CatalogPiece) {
  return (
    p.variants.find((v) => v.ratio === '16:9') ??
    [...p.variants].sort((a, b) => b.w * b.h - a.w * a.h)[0]
  );
}

export function seriesPage(args: { series: CatalogSeries; cfg: SiteConfig }): string {
  const { series, cfg } = args;

  const pieces = series.pieces
    .map((p) => {
      const t = thumb(p);
      // masonry にしない。編集者は 16:9 か 9:16 かで捨てるので、実比率を数字で見せる。
      const ratio = t ? `${t.ratio} · ${t.w}×${t.h}` : '—';
      return `<article class="piece">
<a href="/piece/${esc(p.id)}">
<div class="frame${p.alpha ? ' alpha checker' : ''}">${
        t
          ? `<img${attr({
              src: assetUrl(cfg.assetBaseUrl, t.key, p.sha256),
              alt: `${series.title} ${p.id}`,
              loading: 'lazy',
              width: t.w,
              height: t.h,
            })}>`
          : ''
      }</div>
<div class="ratio">${esc(ratio)}</div>
</a>
<div class="tagline">${p.useTags.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}${
        p.alpha ? '<span class="tag alpha">透過PNG</span>' : ''
      }</div>
</article>`;
    })
    .join('');

  const body = `
<p class="crumb"><a href="/">← すべてのシリーズ</a></p>
<h1>${esc(series.title)}</h1>
<p class="lead">${esc(series.description)}<br>
${series.pieceCount} のかけら。AIで生成した素材です。商用可・クレジット不要・改変自由。</p>

<div class="sechead"><h2>そろえたもの</h2><span class="note">この揃いはここだけです</span></div>
<dl class="kv">
<div><dt>光</dt><dd>${esc(series.tone.light)}</dd></div>
<div><dt>色温度</dt><dd>${esc(series.tone.colorTemp)}</dd></div>
<div><dt>画角</dt><dd>${esc(series.tone.framing)}</dd></div>
<div><dt>質感</dt><dd>${esc(series.tone.texture)}</dd></div>
<div><dt>生成元</dt><dd>${esc(series.generator.service)} / ${esc(series.generator.model)}</dd></div>
</dl>

<div class="sechead"><h2>かけら</h2><span class="note">${series.pieceCount} 点</span></div>
<div class="pieces">${pieces}</div>`;

  return layout({
    title: series.title,
    description: `${series.description} ${series.pieceCount}点のAI生成素材。商用可・クレジット不要。`,
    canonicalPath: `/series/${series.slug}`,
    body,
    cfg,
  });
}
