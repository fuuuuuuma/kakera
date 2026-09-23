import { describe, it, expect } from 'vitest';
import { imageObjectLd, LICENSE_URL } from '../src/build/jsonld.js';
import type { CatalogPiece, CatalogSeries } from '../src/catalog/schema.js';

const series: CatalogSeries = {
  slug: 'night-desk',
  title: '夜の書斎',
  description: '夜のデスクまわり。',
  audience: ['editor'],
  creator: '@fuuuuuuma',
  license: 'kakera-free',
  tone: { light: '点光源', colorTemp: '2700K', framing: '俯瞰', texture: '木' },
  generator: { service: 'higgsfield', model: 'soul', version: '2026-08' },
  promptPublic: true,
  pieceCount: 1,
  toneMaxDistance: 0.1,
  pieces: [],
};

const piece: CatalogPiece = {
  id: 'night-desk-01',
  kind: 'still',
  prompt: 'a wooden desk at night, warm lamp, no people',
  alpha: false,
  useTags: ['Bロール'],
  sha256: 'a'.repeat(64),
  bytes: 1234,
  mime: 'image/png',
  variants: [
    { ratio: '16:9', w: 1920, h: 1080, key: 'night-desk/night-desk-01/night-desk-01-16x9.jpg', bytes: 900, mime: 'image/jpeg' },
    { ratio: '1:1', w: 1080, h: 1080, key: 'night-desk/night-desk-01/night-desk-01-1x1.jpg', bytes: 800, mime: 'image/jpeg' },
  ],
};

const SITE = 'https://kakera.example';
const ASSETS = 'https://assets.kakera.example';

const ld = () => imageObjectLd({ piece, series, siteUrl: SITE, assetBaseUrl: ASSETS })!;

describe('imageObjectLd（Google 画像検索の構造化データ）', () => {
  it('schema.org の ImageObject である', () => {
    const j = ld();
    expect(j['@context']).toBe('https://schema.org');
    expect(j['@type']).toBe('ImageObject');
  });

  it('Google が要求する license と acquireLicensePage を持つ', () => {
    const j = ld();
    // license は相対パスではなく絶対URLでなければならない
    expect(j['license']).toBe(`${SITE}${LICENSE_URL}`);
    expect(String(j['license']).startsWith('https://')).toBe(true);
    expect(String(j['acquireLicensePage'])).toContain('/series/night-desk');
  });

  it('contentUrl は一番大きい書き出しを指す', () => {
    const j = ld();
    expect(j['contentUrl']).toBe(
      `${ASSETS}/night-desk/night-desk-01/night-desk-01-16x9.jpg?v=${piece.sha256.slice(0, 12)}`,
    );
    expect(j['width']).toBe(1920);
    expect(j['height']).toBe(1080);
  });

  it('作者とクレジットが入る', () => {
    const j = ld();
    expect((j['creator'] as Record<string, unknown>)['name']).toBe('@fuuuuuuma');
    expect(j['creditText']).toContain('KAKERA');
  });

  it('encodingFormat は書き出しの形式（元がPNGでも JPEG）', () => {
    expect(ld()['encodingFormat']).toBe('image/jpeg');
  });

  it('AI生成であることを明示する', () => {
    const j = ld();
    // 業界の標準がラベル必須に固まりつつあるので、構造化データにも出す
    expect(JSON.stringify(j)).toContain('higgsfield');
    expect(j['description']).toContain('AI');
  });

  it('プロンプトを載せる（全公開が前提）', () => {
    expect(JSON.stringify(ld())).toContain('a wooden desk at night');
  });

  it('書き出しが1つしかなくても壊れない', () => {
    const one: CatalogPiece = { ...piece, variants: [piece.variants[1]!] };
    const j = imageObjectLd({ piece: one, series, siteUrl: SITE, assetBaseUrl: ASSETS })!;
    expect(j['width']).toBe(1080);
  });

  it('書き出しが空なら null を返す（出せないものを出さない）', () => {
    const none: CatalogPiece = { ...piece, variants: [] };
    expect(imageObjectLd({ piece: none, series, siteUrl: SITE, assetBaseUrl: ASSETS })).toBeNull();
  });

  it('静止画以外は null を返す（ImageObject ではないので）', () => {
    const bgm: CatalogPiece = { ...piece, kind: 'bgm' };
    expect(imageObjectLd({ piece: bgm, series, siteUrl: SITE, assetBaseUrl: ASSETS })).toBeNull();
  });

  it('末尾のスラッシュがあってもURLが二重にならない', () => {
    const j = imageObjectLd({
      piece,
      series,
      siteUrl: `${SITE}/`,
      assetBaseUrl: `${ASSETS}/`,
    })!;
    expect(String(j['contentUrl'])).not.toContain('//night-desk-01');
    expect(String(j['acquireLicensePage'])).not.toContain('//series');
  });
});
