import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { inspectSeriesTone, imageToneHistogram } from '../src/inspect/tone.js';
import { hellinger } from '../src/inspect/color.js';

let dir: string;
const p = (n: string) => join(dir, n);

async function solid(name: string, r: number, g: number, b: number) {
  await sharp({ create: { width: 320, height: 180, channels: 3, background: { r, g, b } } })
    .png()
    .toFile(p(name));
  return p(name);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kakera-tone-'));
  // 揃っているシリーズ: 青系で明度だけ変える
  await solid('t1.png', 30, 60, 130);
  await solid('t2.png', 38, 72, 150);
  await solid('t3.png', 26, 52, 118);
  // 明らかに浮いている1枚
  await solid('odd.png', 230, 190, 40);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('imageToneHistogram', () => {
  it('同じ絵からは同じヒストグラムが出る', async () => {
    const a = await imageToneHistogram(p('t1.png'));
    const b = await imageToneHistogram(p('t1.png'));
    expect(hellinger(a, b)).toBeCloseTo(0, 6);
  });
});

describe('inspectSeriesTone', () => {
  it('揃っているシリーズは距離が小さい', async () => {
    const r = await inspectSeriesTone([p('t1.png'), p('t2.png'), p('t3.png')], null);
    expect(r.entries.length).toBe(3);
    expect(r.max).toBeLessThan(0.5);
  });

  it('浮いている1枚を入れると最大距離が跳ね上がる', async () => {
    const tight = await inspectSeriesTone([p('t1.png'), p('t2.png'), p('t3.png')], null);
    const loose = await inspectSeriesTone(
      [p('t1.png'), p('t2.png'), p('t3.png'), p('odd.png')],
      null,
    );
    expect(loose.max).toBeGreaterThan(tight.max);
  });

  it('閾値が null のときは指摘を出さない（測るだけ）', async () => {
    const r = await inspectSeriesTone([p('t1.png'), p('odd.png')], null);
    expect(r.issues).toEqual([]);
    expect(r.threshold).toBeNull();
  });

  it('閾値を渡すと超えたファイルを名指しで指摘する', async () => {
    const r = await inspectSeriesTone(
      [p('t1.png'), p('t2.png'), p('t3.png'), p('odd.png')],
      0.3,
    );
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.join()).toContain('odd.png');
  });

  it('距離は大きい順に並ぶ（直すべき1枚が先頭に来る）', async () => {
    const r = await inspectSeriesTone([p('t1.png'), p('odd.png'), p('t2.png')], null);
    expect(r.entries[0]!.file).toContain('odd.png');
    expect(r.entries[0]!.distance).toBeGreaterThanOrEqual(r.entries[1]!.distance);
  });

  it('1点しかないシリーズは距離 0（重心が自分自身）', async () => {
    const r = await inspectSeriesTone([p('t1.png')], 0.3);
    expect(r.max).toBeCloseTo(0, 6);
    expect(r.issues).toEqual([]);
  });
});
