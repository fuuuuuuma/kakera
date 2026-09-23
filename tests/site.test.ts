import { describe, it, expect } from 'vitest';
import { esc, attr, layout, loadSiteConfig } from '../src/site/html.js';

describe('esc', () => {
  it('タグを無害化する', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('引用符とアンパサンドも', () => {
    expect(esc(`a&b"c'd`)).toBe('a&amp;b&quot;c&#39;d');
  });
  it('日本語はそのまま', () => {
    expect(esc('夜の書斎')).toBe('夜の書斎');
  });
});

describe('attr', () => {
  it('key="value" を並べる', () => {
    expect(attr({ src: '/a.jpg', width: 1920 })).toBe(' src="/a.jpg" width="1920"');
  });
  it('undefined と false は出さない', () => {
    expect(attr({ a: undefined, b: false, c: 'x' })).toBe(' c="x"');
  });
  it('true は属性名だけ', () => {
    expect(attr({ hidden: true })).toBe(' hidden');
  });
  it('値もエスケープする', () => {
    expect(attr({ alt: '"><img>' })).toBe(' alt="&quot;&gt;&lt;img&gt;"');
  });
});

describe('loadSiteConfig', () => {
  it('config/site.json を読む', () => {
    const c = loadSiteConfig();
    expect(c.siteUrl).toMatch(/^https:\/\//);
    expect(c.assetBaseUrl).toMatch(/^https:\/\//);
    expect(c.siteUrl.endsWith('/')).toBe(false);
  });
});

describe('layout', () => {
  const cfg = { siteUrl: 'https://s.example', assetBaseUrl: 'https://a.example' };
  const html = () =>
    layout({
      title: '題',
      description: '説明',
      canonicalPath: '/series/x',
      body: '<p>本文</p>',
      cfg,
    });

  it('日本語のページとして出る', () => {
    expect(html()).toMatch(/^<!doctype html>/i);
    expect(html()).toContain('<html lang="ja">');
  });
  it('title と description が入る', () => {
    expect(html()).toContain('<title>題 — KAKERA</title>');
    expect(html()).toContain('name="description" content="説明"');
  });
  it('canonical が絶対URLになる', () => {
    expect(html()).toContain('<link rel="canonical" href="https://s.example/series/x">');
  });
  it('本文が入る', () => {
    expect(html()).toContain('<p>本文</p>');
  });
  it('対象を片方だけ名指ししない', () => {
    expect(html()).toContain('動画編集者とサムネイル制作者');
  });
  it('フッターに規約と通報の窓口がある', () => {
    const h = html();
    for (const p of ['/license', '/terms', '/moderation', '/report']) {
      expect(h, `${p} へのリンクが無い`).toContain(`href="${p}"`);
    }
  });
  it('head に追加のタグを差し込める', () => {
    expect(
      layout({
        title: 't',
        description: 'd',
        canonicalPath: '/',
        body: '',
        cfg,
        head: '<meta name="x">',
      }),
    ).toContain('<meta name="x">');
  });
  it('img に height:auto がある（width/height属性が aspect-ratio を殺すため）', () => {
    expect(html()).toMatch(/img\{max-width:100%;height:auto/);
  });
  it('[hidden] が display に負けない指定になっている', () => {
    expect(html()).toContain('[hidden]{display:none !important}');
  });
  it('ダウンロードのビーコンが入るが、失敗してもDLを止めない', () => {
    const h = html();
    expect(h).toContain('/api/download');
    expect(h).toContain('sendBeacon');
    expect(h).toContain('catch');
  });
});

// ---- 以下、ページ本体 ----
import { piecePage } from '../src/site/pages/piece.js';
import { seriesPage } from '../src/site/pages/series.js';
import { homePage } from '../src/site/pages/home.js';
import type { Catalog, CatalogPiece, CatalogSeries } from '../src/catalog/schema.js';

const CFG = { siteUrl: 'https://s.example', assetBaseUrl: 'https://a.example' };

const SERIES: CatalogSeries = {
  slug: 'night-desk', title: '夜の書斎', description: '夜のデスクまわり。',
  audience: ['editor'], creator: '@fuuuuuuma', license: 'kakera-free',
  tone: { light: '点光源', colorTemp: '2700K', framing: '俯瞰', texture: '木' },
  generator: { service: 'higgsfield', model: 'soul_location', version: '2026-08' },
  promptPublic: true, pieceCount: 1, toneMaxDistance: 0.5, pieces: [],
};

const PIECE: CatalogPiece = {
  id: 'night-desk-01', kind: 'still',
  prompt: 'a wooden desk at night, warm lamp, no people',
  alpha: false, useTags: ['Bロール'],
  sha256: 'a'.repeat(64), bytes: 1803864, mime: 'image/png',
  variants: [
    { ratio: '16:9', w: 1920, h: 1080, key: 'night-desk/night-desk-01/a-16x9.jpg', bytes: 131328, mime: 'image/jpeg' },
    { ratio: '9:16', w: 1080, h: 1920, key: 'night-desk/night-desk-01/a-9x16.jpg', bytes: 153553, mime: 'image/jpeg' },
  ],
};

describe('piecePage', () => {
  const h = () => piecePage({ piece: PIECE, series: SERIES, cfg: CFG });

  it('プロンプトを全文載せる（全公開が前提）', () => {
    expect(h()).toContain('a wooden desk at night, warm lamp, no people');
  });
  it('生成モデルを出す（AI生成の明示）', () => {
    const s = h();
    expect(s).toContain('higgsfield');
    expect(s).toContain('soul_location');
    expect(s).toMatch(/AIで生成/);
  });
  it('比率ごとにダウンロードのリンクがある', () => {
    const s = h();
    expect(s).toContain(`${CFG.assetBaseUrl}/night-desk/night-desk-01/a-16x9.jpg`);
    expect(s).toContain(`${CFG.assetBaseUrl}/night-desk/night-desk-01/a-9x16.jpg`);
    expect(s).toContain('16:9');
    expect(s).toContain('9:16');
  });
  it('ダウンロードの直近に同意文がある', () => {
    const s = h();
    const i = s.indexOf('同意したものとみなします');
    expect(i, '同意文が無い').toBeGreaterThan(0);
    const j = s.lastIndexOf('data-download', i);
    expect(j, 'DLの導線が同意文より前に無い').toBeGreaterThan(0);
    expect(i - j).toBeLessThan(1500);
    expect(s).toContain('href="/license"');
  });
  it('JSON-LD を埋める', () => {
    const s = h();
    expect(s).toContain('application/ld+json');
    expect(s).toContain('"@type": "ImageObject"');
    expect(s).toContain('"license"');
  });
  it('JSON-LD が壊れた JSON にならない（実際に parse できる）', () => {
    const m = h().match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    expect(() => JSON.parse(m![1]!)).not.toThrow();
  });
  it('シリーズへ戻る導線がある', () => {
    expect(h()).toContain('href="/series/night-desk"');
  });
  it('「独占」を書かない', () => {
    expect(h()).not.toMatch(/独占/);
  });
  it('プロンプトに含まれる HTML は無害化される', () => {
    const bad: CatalogPiece = { ...PIECE, prompt: '<img src=x onerror=alert(1)>' };
    const s = piecePage({ piece: bad, series: SERIES, cfg: CFG });
    expect(s).not.toContain('<img src=x');
    expect(s).toContain('&lt;img src=x');
  });
  it('計数のためのフックが入る（data-piece / data-series）', () => {
    const s = h();
    expect(s).toContain('data-piece="night-desk-01"');
    expect(s).toContain('data-series="night-desk"');
  });
});

describe('seriesPage', () => {
  const S: CatalogSeries = { ...SERIES, pieceCount: 2, pieces: [PIECE, { ...PIECE, id: 'night-desk-02' }] };
  const h = () => seriesPage({ series: S, cfg: CFG });

  it('シリーズ名と説明が出る', () => {
    expect(h()).toContain('夜の書斎');
    expect(h()).toContain('夜のデスクまわり。');
  });
  it('全かけらへのリンクが出る', () => {
    expect(h()).toContain('href="/piece/night-desk-01"');
    expect(h()).toContain('href="/piece/night-desk-02"');
  });
  it('比率を等幅で明記する', () => {
    const s = h();
    expect(s).toContain('16:9');
    expect(s).toContain('class="ratio"');
  });
  it('トーン宣言を出す（何を揃えたのか）', () => {
    const s = h();
    expect(s).toContain('2700K');
    expect(s).toContain('点光源');
  });
  it('「独占」は書かない', () => {
    expect(h()).not.toMatch(/独占/);
  });
  it('かけらの数が実体と一致する', () => {
    expect((h().match(/href="\/piece\//g) ?? []).length).toBe(2);
  });
  it('AI生成であることを明示する', () => {
    expect(h()).toMatch(/AIで生成/);
  });
});

const CAT: Catalog = {
  version: 1, builtAt: '2026-08-21T00:00:00.000Z', seriesCount: 1, pieceCount: 2,
  series: [{ ...SERIES, pieceCount: 2, pieces: [PIECE, { ...PIECE, id: 'night-desk-02' }] }],
};

describe('homePage', () => {
  const h = () => homePage({ catalog: CAT, cfg: CFG });

  it('対象を両方名指しする', () => {
    expect(h()).toContain('動画編集者とサムネイル制作者');
  });
  it('数字が実体と一致する', () => {
    const s = h();
    expect(s).toContain('<strong>1</strong>');
    expect(s).toContain('<strong>2</strong>');
  });
  it('シリーズカードから詳細へ行ける', () => {
    expect(h()).toContain('href="/series/night-desk"');
  });
  it('カードに複数のタイルが出る（揃いが見えるように）', () => {
    expect((h().match(/<img/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('絞り込みの選択肢が出る', () => {
    const s = h();
    expect(s).toContain('class="filters"');
    expect(s).toContain('Bロール');
  });
  it('細かい用途タグを全件並べず、主要ジャンルだけを絞り込みに出す', () => {
    const genrePiece: CatalogPiece = {
      ...PIECE,
      useTags: ['ビジネス・仕事', '会議', '背景のみ'],
    };
    const genreSeries: CatalogSeries = {
      ...SERIES,
      pieceCount: 1,
      pieces: [genrePiece],
    };
    const genreCatalog: Catalog = {
      ...CAT,
      seriesCount: 1,
      pieceCount: 1,
      series: [genreSeries],
    };
    const s = homePage({ catalog: genreCatalog, cfg: CFG });
    expect(s).toContain('data-tag="ビジネス・仕事"');
    expect(s).not.toContain('data-tag="会議"');
    expect(s).not.toContain('data-tag="背景のみ"');
  });
  it('価格の話を表に置かない（値段ではなく中身を先に言う）', () => {
    const s = h();
    for (const w of ['ただで', '無料', '手数料', '一円']) {
      expect(s, `トップに「${w}」が出ている`).not.toContain(w);
    }
  });
  it('利用条件（価格ではない）は表でも言う', () => {
    const s = h();
    expect(s).toContain('商用可');
    expect(s).toContain('クレジット不要');
  });
  it('見出しは「そろっている」ことを先に言う', () => {
    expect(h()).toMatch(/そろっている素材/);
  });
  it('「独占」は書かない', () => {
    expect(h()).not.toMatch(/独占/);
  });
  it('シリーズが0件でも壊れない', () => {
    const empty: Catalog = { ...CAT, seriesCount: 0, pieceCount: 0, series: [] };
    expect(() => homePage({ catalog: empty, cfg: CFG })).not.toThrow();
  });
});

describe('透過素材の見せ方', () => {
  const ALPHA_PIECE: CatalogPiece = {
    ...PIECE, id: 'cut-01', alpha: true,
    variants: [{ ratio: 'source', w: 2048, h: 2048, key: 'cut/cut-01/a.png', bytes: 100, mime: 'image/png' }],
  };
  const ALPHA_SERIES: CatalogSeries = { ...SERIES, slug: 'cut', title: '矢印', pieceCount: 1, pieces: [ALPHA_PIECE] };

  it('トップの透過シリーズは市松の上に置く', () => {
    const cat: Catalog = { ...CAT, seriesCount: 1, pieceCount: 1, series: [ALPHA_SERIES] };
    expect(homePage({ catalog: cat, cfg: CFG })).toContain('tiles alpha checker');
  });

  it('不透明のシリーズには市松を付けない', () => {
    expect(homePage({ catalog: CAT, cfg: CFG })).not.toContain('tiles alpha checker');
  });

  it('シリーズページの透過かけらも市松', () => {
    expect(seriesPage({ series: ALPHA_SERIES, cfg: CFG })).toContain('frame alpha checker');
  });

  it('かけら詳細のプレビューも市松', () => {
    expect(piecePage({ piece: ALPHA_PIECE, series: ALPHA_SERIES, cfg: CFG })).toContain('preview checker');
  });

  it('透過は cover で切らない（切り抜きが壊れるため）', () => {
    const css = layout({ title: 't', description: 'd', canonicalPath: '/', body: '', cfg: CFG });
    expect(css).toContain('.tiles.alpha img,.frame.alpha img{object-fit:contain}');
  });

  it('市松は .piece .frame より後で、同等以上の詳細度で宣言する', () => {
    const css = layout({ title: 't', description: 'd', canonicalPath: '/', body: '', cfg: CFG });
    const frameAt = css.indexOf('.piece .frame{');
    const checkerAt = css.indexOf('.checker,.piece .frame.checker');
    expect(frameAt, '.piece .frame が無い').toBeGreaterThan(0);
    expect(checkerAt, '市松の宣言が無い').toBeGreaterThan(0);
    // 後勝ちで打ち消されないよう、宣言順が後であること
    expect(checkerAt).toBeGreaterThan(frameAt);
    expect(css).toContain('.piece .frame.checker');
  });
});
