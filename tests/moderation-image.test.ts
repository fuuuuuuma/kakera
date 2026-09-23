import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { shrinkForModeration, MODERATION_MAX_EDGE } from '../src/worker/moderation-image.js';

// 2026-09-24 本番: Workers AI の llava に 2048px の PNG (約1.6MB) をそのまま渡すと
// 「3007: Request timeout」、数百KBなら1〜2秒で判定できた (実モデルで確認)。
// 判定の前に長辺 512px の JPEG へ縮める。
async function png(w: number, h: number): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: '#88aacc' } }).png().toBuffer();
  return new Uint8Array(buf);
}

describe('shrinkForModeration', () => {
  it('2048px の PNG を長辺 512px 以下の JPEG にする', async () => {
    const out = shrinkForModeration(await png(2048, 1152));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(MODERATION_MAX_EDGE);
    expect(meta.width! / meta.height!).toBeCloseTo(2048 / 1152, 1);
  });

  it('小さい画像は拡大しない', async () => {
    const meta = await sharp(shrinkForModeration(await png(300, 200))).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it('画像として読めなければ例外 (呼び出し側で保留に倒す)', () => {
    expect(() => shrinkForModeration(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
