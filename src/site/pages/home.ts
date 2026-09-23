import { esc, attr, layout, type SiteConfig } from '../html.js';
import { assetUrl } from '../../catalog/asset-url.js';
import type { Catalog, CatalogSeries } from '../../catalog/schema.js';

const nf = (n: number): string => n.toLocaleString('en-US');

/**
 * 細かい用途タグはカタログに残し、トップでは探索の入口だけを見せる。
 * 200シリーズで全タグを並べると、ジャンルに辿り着く前に画面を使い切ってしまう。
 */
const FEATURED_FILTERS = [
  { tag: 'ビジネス・仕事', label: 'ビジネス・仕事' },
  { tag: '家族・暮らし', label: '家族・暮らし' },
  { tag: '医療・健康・福祉', label: '医療・健康・福祉' },
  { tag: '教育・子ども', label: '教育・子ども' },
  { tag: '食・店舗・接客', label: '食・店舗・接客' },
  { tag: '旅行・街・交通', label: '旅行・街・交通' },
  { tag: 'テクノロジー・制作', label: 'テクノロジー・制作' },
  { tag: '産業・物流・環境', label: '産業・物流・環境' },
  { tag: 'スポーツ・美容・行事', label: 'スポーツ・美容・行事' },
  { tag: 'Bロール', label: 'Bロール' },
  { tag: '背景', label: '背景素材' },
  { tag: '透過', label: '透過素材' },
] as const;

/** カード1枚に4点。揃いが一目で伝わるようにする（単品サムネの海にしない）。 */
function tiles(s: CatalogSeries, cfg: SiteConfig): string {
  const picks = s.pieces.slice(0, 4);
  // 透過のシリーズは市松の上に置き、切らずに全体を見せる
  const isAlpha = picks.some((p) => p.alpha);
  const cls = isAlpha ? 'tiles alpha checker' : 'tiles';
  return `<div class="${cls}">${picks
    .map((p) => {
      const v = p.variants.find((x) => x.ratio === '16:9') ?? p.variants[0];
      return v
        ? `<img${attr({
            src: assetUrl(cfg.assetBaseUrl, v.key, p.sha256),
            alt: `${s.title} ${p.id}`,
            loading: 'lazy',
            width: v.w,
            height: v.h,
          })}>`
        : '';
    })
    .join('')}</div>`;
}

export function homePage(args: { catalog: Catalog; cfg: SiteConfig }): string {
  const { catalog, cfg } = args;

  const availableTags = new Set(
    [
    ...new Set(catalog.series.flatMap((s) => s.pieces.flatMap((p) => p.useTags))),
    ],
  );
  const filters = FEATURED_FILTERS.filter((filter) => availableTags.has(filter.tag));

  const cards = catalog.series
    .map(
      (s) => `<article class="card"${attr({
        'data-tags': [...new Set(s.pieces.flatMap((p) => p.useTags))].join(','),
      })}>
<a href="/series/${esc(s.slug)}">
${tiles(s, cfg)}
<h3>${esc(s.title)}</h3>
</a>
<div class="by">${s.pieceCount} のかけら · ${esc(
        s.audience.map((a) => (a === 'editor' ? '編集' : 'サムネ')).join(' / '),
      )}</div>
<div class="foot"><span class="dl">${esc(s.tone.colorTemp)}</span></div>
</article>`,
    )
    .join('');

  const body = `
<h1>そろっている素材は、探さなくていい。</h1>
<p class="lead">動画編集者とサムネイル制作者のための、AI生成素材ライブラリ。
<strong>同じ光・同じ色・同じ画角でそろえた6〜12点を、ひと組にして置いています。</strong>
1枚ずつ探して並べたときの「浮く」がありません。商用可・クレジット不要・登録不要。</p>

<dl class="kv">
<div><dt>SERIES</dt><dd><strong>${nf(catalog.seriesCount)}</strong></dd></div>
<div><dt>PIECES</dt><dd><strong>${nf(catalog.pieceCount)}</strong></dd></div>
</dl>

<div class="sechead"><h2>すべてのシリーズ</h2><span class="note">同じ光・色・画角でそろえた6〜12点をひと組にしています</span></div>
<div class="filters">
<button aria-pressed="true" data-tag="">すべて</button>
${filters
  .map(
    ({ tag, label }) =>
      `<button aria-pressed="false"${attr({ 'data-tag': tag })}>${esc(label)}</button>`,
  )
  .join('')}
</div>
<div class="grid" id="series">${cards}</div>

<div class="sechead"><h2>みんなの投稿</h2><span class="note">誰でも追加できます</span></div>
<p class="lead">運営審査を待たず、自動検品を通れば即座に公開される投稿シリーズもあります。
<a href="/community">みんなの投稿を見る →</a></p>
<script>
document.querySelectorAll('.filters button').forEach(function (b) {
  b.addEventListener('click', function () {
    document.querySelectorAll('.filters button').forEach(function (x) {
      x.setAttribute('aria-pressed', String(x === b));
    });
    var t = b.dataset.tag || '';
    document.querySelectorAll('#series .card').forEach(function (c) {
      var tags = (c.dataset.tags || '').split(',');
      c.hidden = t !== '' && tags.indexOf(t) === -1;
    });
  });
});
</script>`;

  return layout({
    title: '動画編集者とサムネイル制作者のためのAI生成素材',
    description:
      'AIで生成した素材を、トーンのそろったシリーズ単位で。商用可・クレジット不要・登録不要。',
    canonicalPath: '/',
    body,
    cfg,
  });
}
