import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildCatalog, assertCatalogIntegrity } from '../src/build/catalog.js';
import type { Catalog } from '../src/catalog/schema.js';

let root: string;
let outRoot: string;
const TH = { toneMaxDistance: null, loopFirstLastRms: null, audioMaxVolumeDb: -0.1 };

async function makeSeries(slug: string) {
  const dir = join(root, slug);
  await mkdir(join(dir, 'pieces'), { recursive: true });
  await writeFile(
    join(dir, 'series.json'),
    JSON.stringify(
      {
        slug,
        title: `題 ${slug}`,
        description: '説明。',
        audience: ['editor'],
        creator: '@fuuuuuuma',
        license: 'kakera-free',
        tone: { light: '光', colorTemp: '2700K', framing: '俯瞰', texture: '木' },
        generator: { service: 'higgsfield', model: 'soul', version: '2026-08' },
        promptPublic: true,
        pieces: Array.from({ length: 6 }, (_, i) => ({
          id: `${slug}-${i + 1}`,
          kind: 'still',
          file: `pieces/p${i + 1}.png`,
          prompt: 'a dim wooden desk at night, no people',
          forThumbnail: i === 0,
        })),
      },
      null,
      2,
    ),
  );
  for (let i = 1; i <= 6; i++) {
    await sharp({
      create: {
        width: 2400,
        height: 1350,
        channels: 3,
        background: { r: 30 + i, g: 60 + i, b: 130 + i },
      },
    })
      .png()
      .toFile(join(dir, 'pieces', `p${i}.png`));
  }
  return dir;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kakera-cat-'));
  outRoot = join(root, '_out');
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('buildCatalog', () => {
  it('シリーズ数とかけら数が実体と一致する', async () => {
    const a = await makeSeries('aaa');
    const b = await makeSeries('bbb');
    const c = await buildCatalog([a, b], outRoot, TH);
    expect(c.seriesCount).toBe(2);
    expect(c.pieceCount).toBe(12);
    expect(c.series.map((s) => s.slug).sort()).toEqual(['aaa', 'bbb']);
  }, 120_000);

  it('sha256 と bytes が入る', async () => {
    const a = await makeSeries('ccc');
    const c = await buildCatalog([a], outRoot, TH);
    const p = c.series[0]!.pieces[0]!;
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.bytes).toBeGreaterThan(0);
  }, 120_000);

  it('サムネ用途のかけらには 1280×720 が入る', async () => {
    const a = await makeSeries('ddd');
    const c = await buildCatalog([a], outRoot, TH);
    const first = c.series[0]!.pieces.find((p) => p.id === 'ddd-1')!;
    expect(first.variants.some((v) => v.w === 1280 && v.h === 720)).toBe(true);
  }, 120_000);

  it('トーンの最大距離がシリーズに記録される', async () => {
    const a = await makeSeries('eee');
    const c = await buildCatalog([a], outRoot, TH);
    expect(c.series[0]!.toneMaxDistance).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('検品で止まったシリーズはカタログに入らない', async () => {
    const bad = join(root, 'fff');
    await mkdir(join(bad, 'pieces'), { recursive: true });
    await writeFile(
      join(bad, 'series.json'),
      await readFile(join(await makeSeries('ggg'), 'series.json'), 'utf8'),
    );
    await expect(buildCatalog([bad], outRoot, TH)).rejects.toThrow(/見つかりません/);
  }, 120_000);
});

describe('assertCatalogIntegrity', () => {
  const base = (): Catalog => ({
    version: 1,
    builtAt: '2026-08-20T00:00:00.000Z',
    seriesCount: 1,
    pieceCount: 1,
    series: [
      {
        slug: 's',
        title: 't',
        description: 'd',
        audience: ['editor'],
        creator: '@k',
        license: 'kakera-free',
        tone: { light: 'l', colorTemp: 'c', framing: 'f', texture: 'x' },
        generator: { service: 'higgsfield', model: 'soul', version: '1' },
        promptPublic: true,
        pieceCount: 1,
        toneMaxDistance: 0.1,
        pieces: [
          {
            id: 'p1',
            kind: 'still',
            prompt: 'x',
            alpha: false,
            useTags: [],
            sha256: 'a'.repeat(64),
            bytes: 10,
            mime: 'image/png',
            variants: [
              { ratio: '16:9', w: 1920, h: 1080, key: 'p1/a.jpg', bytes: 10, mime: 'image/jpeg' },
            ],
          },
        ],
      },
    ],
  });

  it('整合していれば通る', () => {
    expect(() => assertCatalogIntegrity(base())).not.toThrow();
  });

  it('seriesCount が配列長と違えば落ちる', () => {
    const c = base();
    c.seriesCount = 5;
    expect(() => assertCatalogIntegrity(c)).toThrow(/seriesCount/);
  });

  it('pieceCount の合計が違えば落ちる', () => {
    const c = base();
    c.pieceCount = 9;
    expect(() => assertCatalogIntegrity(c)).toThrow(/pieceCount/);
  });

  it('slug が重複していれば落ちる', () => {
    const c = base();
    c.series.push({ ...c.series[0]! });
    c.seriesCount = 2;
    c.pieceCount = 2;
    expect(() => assertCatalogIntegrity(c)).toThrow(/重複/);
  });

  it('宣言した比率と実寸が食い違えば落ちる', () => {
    const c = base();
    c.series[0]!.pieces[0]!.variants[0]!.h = 1000;
    expect(() => assertCatalogIntegrity(c)).toThrow(/比率/);
  });

  it('プロンプトが空なら落ちる（全公開が前提）', () => {
    const c = base();
    c.series[0]!.pieces[0]!.prompt = '';
    expect(() => assertCatalogIntegrity(c)).toThrow(/プロンプト/);
  });
});
