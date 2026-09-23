import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { inspectImage, ratioLabel } from '../src/inspect/image.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kakera-img-'));

  await sharp({
    create: { width: 2400, height: 1350, channels: 3, background: { r: 40, g: 60, b: 120 } },
  })
    .png()
    .toFile(join(dir, 'wide.png'));

  await sharp({
    create: { width: 800, height: 450, channels: 3, background: { r: 40, g: 60, b: 120 } },
  })
    .png()
    .toFile(join(dir, 'small.png'));

  // アルファチャンネルはあるが全部不透明 = 透過素材ではない
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } },
  })
    .png()
    .toFile(join(dir, 'fake-alpha.png'));

  // 実際に抜けている
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0 } },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 200,
            height: 200,
            channels: 4,
            background: { r: 200, g: 30, b: 30, alpha: 1 },
          },
        })
          .png()
          .toBuffer(),
        top: 100,
        left: 100,
      },
    ])
    .png()
    .toFile(join(dir, 'real-alpha.png'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ratioLabel', () => {
  it('1920×1080 は 16:9', () => expect(ratioLabel(1920, 1080)).toBe('16:9'));
  it('1080×1920 は 9:16', () => expect(ratioLabel(1080, 1920)).toBe('9:16'));
  it('512×512 は 1:1', () => expect(ratioLabel(512, 512)).toBe('1:1'));
  it('端数が出る比率はそのまま分数で返す', () => expect(ratioLabel(1000, 333)).toBe('1000:333'));
});

describe('inspectImage', () => {
  it('十分な大きさの静止画は指摘なしで通る', async () => {
    const r = await inspectImage(join(dir, 'wide.png'), { alpha: false });
    expect(r.width).toBe(2400);
    expect(r.ratio).toBe('16:9');
    expect(r.issues).toEqual([]);
  });

  it('長辺が 2048px 未満なら指摘する', async () => {
    const r = await inspectImage(join(dir, 'small.png'), { alpha: false });
    expect(r.issues.join()).toMatch(/長辺/);
  });

  it('アルファチャンネルがあっても中身が全部不透明なら透過素材と認めない', async () => {
    const r = await inspectImage(join(dir, 'fake-alpha.png'), { alpha: true });
    expect(r.hasAlphaChannel).toBe(true);
    expect(r.hasRealAlpha).toBe(false);
    expect(r.issues.join()).toMatch(/透過/);
  });

  it('本当に抜けている透過PNGは通る', async () => {
    const r = await inspectImage(join(dir, 'real-alpha.png'), { alpha: true, minLongEdge: 512 });
    expect(r.hasRealAlpha).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('透過を宣言していないのに抜けていたら指摘する', async () => {
    const r = await inspectImage(join(dir, 'real-alpha.png'), { alpha: false, minLongEdge: 512 });
    expect(r.issues.join()).toMatch(/宣言/);
  });
});
