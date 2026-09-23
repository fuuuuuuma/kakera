import { describe, it, expect } from 'vitest';
import { buildSite, assertNoBrokenLinks } from '../src/site/build.js';
import type { Catalog, CatalogPiece, CatalogSeries } from '../src/catalog/schema.js';

const CFG = { siteUrl: 'https://s.example', assetBaseUrl: 'https://a.example' };

const PIECE: CatalogPiece = {
  id: 'nd-01',
  kind: 'still',
  prompt: 'a desk',
  alpha: false,
  useTags: ['Bロール'],
  sha256: 'a'.repeat(64),
  bytes: 100,
  mime: 'image/png',
  variants: [
    { ratio: '16:9', w: 1920, h: 1080, key: 'nd/nd-01/a.jpg', bytes: 10, mime: 'image/jpeg' },
  ],
};
const SERIES: CatalogSeries = {
  slug: 'nd',
  title: '夜の書斎',
  description: '説明。',
  audience: ['editor'],
  creator: '@fuuuuuuma',
  license: 'kakera-free',
  tone: { light: '光', colorTemp: '2700K', framing: '俯瞰', texture: '木' },
  generator: { service: 'higgsfield', model: 'soul_location', version: '1' },
  promptPublic: true,
  pieceCount: 2,
  toneMaxDistance: 0.4,
  pieces: [PIECE, { ...PIECE, id: 'nd-02' }],
};
const CAT: Catalog = {
  version: 1,
  builtAt: '2026-08-21T00:00:00.000Z',
  seriesCount: 1,
  pieceCount: 2,
  series: [SERIES],
};

describe('buildSite', () => {
  const files = () => buildSite(CAT, CFG);

  it('必要なページが全部出る', () => {
    const paths = files().map((f) => f.path);
    for (const p of [
      'index.html',
      'license/index.html',
      'terms/index.html',
      'moderation/index.html',
      'report/index.html',
      'series/nd/index.html',
      'piece/nd-01/index.html',
      'piece/nd-02/index.html',
    ]) {
      expect(paths, `${p} が無い`).toContain(p);
    }
  });

  it('かけらの数だけページが出る', () => {
    expect(files().filter((f) => f.path.startsWith('piece/')).length).toBe(2);
  });

  it('パスが重複しない', () => {
    const paths = files().map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('全ページが空でない', () => {
    for (const f of files()) expect(f.html.length, f.path).toBeGreaterThan(500);
  });

  it('シリーズが0件でも法務ページは出る', () => {
    const empty: Catalog = { ...CAT, seriesCount: 0, pieceCount: 0, series: [] };
    const paths = buildSite(empty, CFG).map((f) => f.path);
    expect(paths).toContain('license/index.html');
    expect(paths).toContain('index.html');
  });
});

describe('assertNoBrokenLinks', () => {
  it('全ページのサイト内リンクが実在するページを指している', () => {
    expect(() => assertNoBrokenLinks(buildSite(CAT, CFG))).not.toThrow();
  });

  it('存在しないページを指していたら落ちる', () => {
    const bad = [...buildSite(CAT, CFG), { path: 'x/index.html', html: '<a href="/nope">x</a>' }];
    expect(() => assertNoBrokenLinks(bad)).toThrow(/nope/);
  });

  it('外部リンクは検査しない', () => {
    const ok = [
      ...buildSite(CAT, CFG),
      { path: 'x/index.html', html: '<a href="https://example.com">x</a>' },
    ];
    expect(() => assertNoBrokenLinks(ok)).not.toThrow();
  });

  it('末尾スラッシュの有無で誤検知しない', () => {
    const ok = [...buildSite(CAT, CFG), { path: 'x/index.html', html: '<a href="/license/">x</a>' }];
    expect(() => assertNoBrokenLinks(ok)).not.toThrow();
  });
});

describe('表に出す文言の決まり', () => {
  /**
   * 価格の話をサイトの表に置かない（メンテナ指示・2026-08-21）。
   * 値段ではなく中身を先に言う。ライセンス全文・投稿規約には事実として書いてよい。
   */
  const PRICE_WORDS = ['ただで', '無料', '手数料', '一円', 'タダ'];
  const FRONT = ['index.html', 'series/', 'piece/'];

  const front = () =>
    buildSite(CAT, CFG).filter((f) => FRONT.some((p) => f.path.startsWith(p) || f.path === p));

  it('トップ・シリーズ・かけらに価格の言い回しを置かない', () => {
    for (const f of front()) {
      for (const w of PRICE_WORDS) {
        expect(f.html, `${f.path} に「${w}」が出ている`).not.toContain(w);
      }
    }
  });

  it('ライセンス全文には書いてよい（事実だから）', () => {
    const lic = buildSite(CAT, CFG).find((f) => f.path === 'license/index.html')!;
    expect(lic.html).toContain('無料');
  });

  it('表でも「商用可・クレジット不要」は言う（価格ではなく条件だから）', () => {
    const home = buildSite(CAT, CFG).find((f) => f.path === 'index.html')!;
    expect(home.html).toContain('商用可');
    expect(home.html).toContain('クレジット不要');
  });

  it('「独占」も表に出さない', () => {
    for (const f of front()) expect(f.html, f.path).not.toMatch(/独占/);
  });
});
