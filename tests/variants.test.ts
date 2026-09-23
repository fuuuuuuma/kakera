import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { writeVariants } from '../src/inspect/variants.js';

let dir: string;
let out: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kakera-var-'));
  out = join(dir, 'out');
  await sharp({
    create: { width: 2400, height: 1350, channels: 3, background: { r: 30, g: 90, b: 160 } },
  })
    .png()
    .toFile(join(dir, 'src.png'));
  await sharp({
    create: {
      width: 2048,
      height: 2048,
      channels: 4,
      background: { r: 240, g: 200, b: 60, alpha: 0.4 },
    },
  })
    .png()
    .toFile(join(dir, 'alpha.png'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeVariants', () => {
  it('不透明な静止画は 16:9 / 9:16 / 1:1 の3つを出す', async () => {
    const vs = await writeVariants(join(dir, 'src.png'), out, 'a', {
      alpha: false,
      forThumbnail: false,
    });
    expect(vs.map((v) => `${v.ratio}@${v.w}x${v.h}`).sort()).toEqual(
      ['16:9@1920x1080', '1:1@1080x1080', '9:16@1080x1920'].sort(),
    );
    for (const v of vs) expect(v.bytes).toBeGreaterThan(0);
  });

  it('サムネ用途なら 1280×720 も出す', async () => {
    const vs = await writeVariants(join(dir, 'src.png'), out, 'b', {
      alpha: false,
      forThumbnail: true,
    });
    expect(vs.some((v) => v.w === 1280 && v.h === 720)).toBe(true);
    expect(vs.length).toBe(4);
  });

  it('透過PNGは source だけを出す（切らない）', async () => {
    const vs = await writeVariants(join(dir, 'alpha.png'), out, 'c', {
      alpha: true,
      forThumbnail: false,
    });
    expect(vs.length).toBe(1);
    expect(vs[0]!.ratio).toBe('source');
    expect(vs[0]!.w).toBe(2048);
  });

  it('透過PNGはアルファを保ったまま書き出す', async () => {
    const vs = await writeVariants(join(dir, 'alpha.png'), out, 'd', {
      alpha: true,
      forThumbnail: false,
    });
    const stats = await sharp(join(out, vs[0]!.key.split('/').pop()!)).stats();
    expect(stats.channels.length).toBe(4);
    expect(stats.channels[3]!.min).toBeLessThan(250);
  });

  it('書き出したファイルは実際にその寸法になっている', async () => {
    const vs = await writeVariants(join(dir, 'src.png'), out, 'e', {
      alpha: false,
      forThumbnail: false,
    });
    const nine = vs.find((v) => v.ratio === '9:16')!;
    const meta = await sharp(join(out, nine.key.split('/').pop()!)).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });
});

describe('writeVariants — キーが実体と一致する', () => {
  it('keyPrefix を付けると key がその配下になる', async () => {
    const vs = await writeVariants(join(dir, 'src.png'), out, 'f', {
      alpha: false,
      forThumbnail: false,
      keyPrefix: 'night-desk',
    });
    for (const v of vs) expect(v.key.startsWith('night-desk/f/')).toBe(true);
  });

  it('書き出しの encodingFormat は JPEG（元がPNGでも）', async () => {
    const vs = await writeVariants(join(dir, 'src.png'), out, 'g', {
      alpha: false,
      forThumbnail: false,
    });
    for (const v of vs) expect(v.mime).toBe('image/jpeg');
  });

  it('透過は PNG のまま', async () => {
    const vs = await writeVariants(join(dir, 'alpha.png'), out, 'h', {
      alpha: true,
      forThumbnail: false,
    });
    expect(vs[0]!.mime).toBe('image/png');
  });
});
