import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadSeriesDef, inspectSeries } from '../src/inspect/series.js';

let root: string;
const TH = { toneMaxDistance: null, loopFirstLastRms: null, audioMaxVolumeDb: -0.1 };

function def(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'probe',
    title: '検品用',
    description: '検品のためのシリーズ。',
    audience: ['editor'],
    creator: '@fuuuuuuma',
    license: 'kakera-free',
    tone: { light: '低い色温度', colorTemp: '2700K', framing: '俯瞰', texture: '木' },
    generator: { service: 'higgsfield', model: 'soul', version: '2026-08' },
    promptPublic: true,
    pieces: Array.from({ length: 6 }, (_, i) => ({
      id: `probe-${i + 1}`,
      kind: 'still',
      file: `pieces/p${i + 1}.png`,
      prompt: 'a dim wooden desk at night, no people',
    })),
    ...overrides,
  };
}

async function makeSeries(name: string, d: Record<string, unknown>, longEdge = 2400) {
  const dir = join(root, name);
  await mkdir(join(dir, 'pieces'), { recursive: true });
  await writeFile(join(dir, 'series.json'), JSON.stringify(d, null, 2));
  for (let i = 1; i <= 6; i++) {
    await sharp({
      create: {
        width: longEdge,
        height: Math.round((longEdge * 9) / 16),
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
  root = await mkdtemp(join(tmpdir(), 'kakera-series-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('loadSeriesDef', () => {
  it('定義を読んで型を通す', async () => {
    const dir = await makeSeries('ok', def());
    expect((await loadSeriesDef(dir)).slug).toBe('probe');
  });

  it('壊れた定義は理由つきで落ちる', async () => {
    const dir = await makeSeries('bad-def', def({ promptPublic: false }));
    await expect(loadSeriesDef(dir)).rejects.toThrow();
  });
});

describe('inspectSeries', () => {
  it('揃った静止画のシリーズは通る', async () => {
    const dir = await makeSeries('good', def());
    const r = await inspectSeries(dir, TH);
    expect(r.blocking).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.tone).not.toBeNull();
  }, 30_000);

  it('格付け D の生成元は必ず止める（MusicGen）', async () => {
    const dir = await makeSeries(
      'musicgen',
      def({ generator: { service: 'musicgen', model: 'large', version: '1' } }),
    );
    const r = await inspectSeries(dir, TH);
    expect(r.ok).toBe(false);
    expect(r.blocking.join()).toMatch(/CC-BY-NC/);
  }, 30_000);

  it('格付け B の生成元も止める（Grok）', async () => {
    const dir = await makeSeries(
      'grok',
      def({ generator: { service: 'grok', model: 'imagine', version: '1' } }),
    );
    const r = await inspectSeries(dir, TH);
    expect(r.ok).toBe(false);
    expect(r.blocking.join()).toMatch(/格付け B/);
  }, 30_000);

  it('ファイルが無いかけらを名指しで指摘する', async () => {
    const d = def();
    (d.pieces as Record<string, unknown>[])[2]!.file = 'pieces/missing.png';
    const dir = await makeSeries('missing', d);
    const r = await inspectSeries(dir, TH);
    expect(r.ok).toBe(false);
    expect(r.blocking.join()).toMatch(/missing\.png/);
  }, 30_000);

  it('解像度が足りない静止画を指摘する', async () => {
    const dir = await makeSeries('small', def(), 800);
    const r = await inspectSeries(dir, TH);
    expect(r.pieceIssues.flatMap((p) => p.issues).join()).toMatch(/長辺/);
    expect(r.ok).toBe(false);
  }, 30_000);

  it('トーンの閾値が null のうちは、距離を出すだけで止めない', async () => {
    const dir = await makeSeries('tone-null', def());
    const r = await inspectSeries(dir, TH);
    expect(r.tone!.threshold).toBeNull();
    expect(r.tone!.issues).toEqual([]);
    expect(r.ok).toBe(true);
  }, 30_000);
});

describe('inspectSeries — プロンプトの禁止語検査（ゲート7）', () => {
  it('アーティスト名を含むプロンプトのかけらを名指しで止める', async () => {
    const d = def();
    (d.pieces as Record<string, unknown>[])[1]!.prompt =
      'a dark desk in the style of Greg Rutkowski';
    const dir = await makeSeries('banned-artist', d);
    const r = await inspectSeries(dir, TH);
    expect(r.ok).toBe(false);
    expect(r.pieceIssues.flatMap((p) => p.issues).join()).toMatch(/Rutkowski/i);
  }, 30_000);

  it('架空キャラクター名も止める', async () => {
    const d = def();
    (d.pieces as Record<string, unknown>[])[0]!.prompt = 'ミッキーマウスが机に座っている夜の書斎';
    const dir = await makeSeries('banned-character', d);
    const r = await inspectSeries(dir, TH);
    expect(r.ok).toBe(false);
    expect(r.pieceIssues.flatMap((p) => p.issues).join()).toContain('ミッキーマウス');
  }, 30_000);

  it('ふつうのプロンプトなら止めない', async () => {
    const dir = await makeSeries('clean-prompt', def());
    const r = await inspectSeries(dir, TH);
    expect(r.pieceIssues.flatMap((p) => p.issues).join()).not.toMatch(/プロンプト/);
  }, 30_000);
});
