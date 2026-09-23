import { describe, it, expect } from 'vitest';
import {
  handleCommunityIndex,
  handleCommunitySeries,
  type CommunityReadDeps,
  type CommunitySeriesSummary,
  type CommunitySeriesDetail,
  type CommunityPieceRow,
} from '../src/worker/community.js';
import { buildSite, assertNoBrokenLinks } from '../src/site/build.js';
import type { Catalog } from '../src/catalog/schema.js';

/**
 * /community・/community/<slug> の読み取り側 (投稿の全員開放・Phase 2) のテスト。
 * D1 への実際のI/Oは行わず、既存の submit.ts/report.ts と同じ作法で
 * 偽物の CommunityReadDeps を直接渡す。
 */

const CFG = { siteUrl: 'https://kakera.example', assetBaseUrl: 'https://assets.example' };

const SUMMARY: CommunitySeriesSummary = {
  id: 'series-1',
  slug: 'night-office',
  title: '夜のオフィス街',
  description: '落ち着いた夜のオフィス街の切り抜き素材',
  creatorHandle: '@tester',
  pieceCount: 6,
  createdAt: '2026-09-23T00:00:00Z',
  previewPieces: [
    { id: 'piece-1', r2Key: 'community/series-1/piece-1', sha256: 'a'.repeat(64), alpha: false },
    { id: 'piece-2', r2Key: 'community/series-1/piece-2', sha256: 'b'.repeat(64), alpha: false },
  ],
};

const DETAIL: CommunitySeriesDetail = {
  id: 'series-1',
  slug: 'night-office',
  title: '夜のオフィス街',
  description: '落ち着いた夜のオフィス街の切り抜き素材',
  tone: { light: '夜', colorTemp: '寒色', framing: '広め', texture: 'マット' },
  creatorHandle: '@tester',
  generator: { service: 'openai-imagegen', model: 'codex-cli', version: '0.154.0' },
  createdAt: '2026-09-23T00:00:00Z',
};

const PIECES: CommunityPieceRow[] = [
  {
    id: 'piece-1',
    kind: 'still',
    r2Key: 'community/series-1/piece-1',
    bytes: 12345,
    mime: 'image/png',
    sha256: 'a'.repeat(64),
    prompt: '落ち着いたオフィス、朝の光',
    alpha: false,
    createdAt: '2026-09-23T00:00:00Z',
  },
];

function makeDeps(overrides: Partial<CommunityReadDeps> = {}): CommunityReadDeps {
  return {
    listPublishedSeries: async () => [SUMMARY],
    getPublishedSeriesBySlug: async (slug: string) =>
      slug === DETAIL.slug ? { series: DETAIL, pieces: PIECES } : null,
    ...overrides,
  };
}

describe('handleCommunityIndex', () => {
  it('200で一覧HTMLを返す', async () => {
    const r = await handleCommunityIndex(makeDeps(), CFG);
    expect(r.status).toBe(200);
    expect(r.html).toContain('夜のオフィス街');
    expect(r.html).toContain('/community/night-office');
  });

  it('0件でも空状態のHTMLを200で返す (落ちない)', async () => {
    const r = await handleCommunityIndex(makeDeps({ listPublishedSeries: async () => [] }), CFG);
    expect(r.status).toBe(200);
    expect(r.html).toContain('まだ投稿はありません');
  });

  it('画像URLは assetBaseUrl + r2Key から組み立てる', async () => {
    const r = await handleCommunityIndex(makeDeps(), CFG);
    expect(r.html).toContain('https://assets.example/community/series-1/piece-1');
  });
});

describe('handleCommunitySeries', () => {
  it('公開中のシリーズは200でかけら一覧・ダウンロードリンクを返す', async () => {
    const r = await handleCommunitySeries('night-office', makeDeps(), CFG);
    expect(r.status).toBe(200);
    expect(r.html).toContain('夜のオフィス街');
    expect(r.html).toContain('落ち着いたオフィス、朝の光'); // プロンプト公開
    expect(r.html).toContain('https://assets.example/community/series-1/piece-1');
    expect(r.html).toContain('data-download');
    expect(r.html).toContain('ダウンロード');
  });

  it('存在しないslugは404 (取り下げ済みと区別しない文言)', async () => {
    const r = await handleCommunitySeries('does-not-exist', makeDeps(), CFG);
    expect(r.status).toBe(404);
    expect(r.html).toContain('見つかりません');
  });

  it('取り下げ済み(removed)・保留中(pending_review)は deps が null を返す設計なので404 (一覧にも詳細にも出ない)', async () => {
    // deps.getPublishedSeriesBySlug は status='published' 以外を null で返す契約
    // (src/worker/index.ts の communityDepsFromEnv がその契約でSQLを組む)。
    const deps = makeDeps({ getPublishedSeriesBySlug: async () => null });
    const r = await handleCommunitySeries('night-office', deps, CFG);
    expect(r.status).toBe(404);
  });

  it('slugの形式が不正ならD1に問い合わせず404 (パス文字列インジェクション対策)', async () => {
    let called = false;
    const deps = makeDeps({
      getPublishedSeriesBySlug: async () => {
        called = true;
        return null;
      },
    });
    const r = await handleCommunitySeries('../../etc/passwd', deps, CFG);
    expect(r.status).toBe(404);
    expect(called).toBe(false);
  });
});

describe('/community へのリンクは静的ビルドのリンク切れ検査を通る', () => {
  it('トップページ・フッターの /community リンクは assertNoBrokenLinks で落ちない (動的ルート許可リスト)', () => {
    // /community・/community/<slug> はD1から読む動的ルートで、buildSite() の
    // 静的ファイル一覧には含まれない (src/worker/community.ts 参照)。
    // それでもナビ・トップページからリンクしてよいことを確かめる回帰テスト。
    const catalog: Catalog = { version: 1, builtAt: '2026-09-23T00:00:00Z', seriesCount: 0, pieceCount: 0, series: [] };
    const files = buildSite(catalog, CFG);
    const home = files.find((f) => f.path === 'index.html')!;
    expect(home.html).toContain('href="/community"');
    expect(() => assertNoBrokenLinks(files)).not.toThrow();
  });

  it('本当に実在しないページへのリンクは、/community 許可リストがあっても検知する', () => {
    const catalog: Catalog = { version: 1, builtAt: '2026-09-23T00:00:00Z', seriesCount: 0, pieceCount: 0, series: [] };
    const files = [...buildSite(catalog, CFG), { path: 'x/index.html', html: '<a href="/nope">x</a>' }];
    expect(() => assertNoBrokenLinks(files)).toThrow(/nope/);
  });
});
