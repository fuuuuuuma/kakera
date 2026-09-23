import { describe, it, expect } from 'vitest';
import {
  TONE_BINS,
  toneHistogram,
  hellinger,
  centroid,
  medianCentroid,
  linearSrgbToOklab,
  srgbToLinear,
} from '../src/inspect/color.js';

/** 単色で満たした RGB(A) バッファを作る */
function fill(px: number, rgba: [number, number, number, number?]): { data: Uint8Array; ch: 3 | 4 } {
  const ch = (rgba[3] === undefined ? 3 : 4) as 3 | 4;
  const data = new Uint8Array(px * ch);
  for (let i = 0; i < px; i++) {
    data[i * ch] = rgba[0];
    data[i * ch + 1] = rgba[1];
    data[i * ch + 2] = rgba[2];
    if (ch === 4) data[i * ch + 3] = rgba[3]!;
  }
  return { data, ch };
}

describe('OKLab', () => {
  it('白は L がほぼ 1、彩度がほぼ 0', () => {
    const { L, a, b } = linearSrgbToOklab(srgbToLinear(1), srgbToLinear(1), srgbToLinear(1));
    expect(L).toBeCloseTo(1, 2);
    expect(Math.hypot(a, b)).toBeLessThan(0.01);
  });

  it('黒は L がほぼ 0', () => {
    expect(linearSrgbToOklab(0, 0, 0).L).toBeCloseTo(0, 5);
  });
});

describe('トーンヒストグラム', () => {
  it('長さは 54 で、合計は 1', () => {
    const { data, ch } = fill(100, [200, 30, 30]);
    const h = toneHistogram(data, ch);
    expect(h.length).toBe(TONE_BINS);
    expect([...h].reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });

  it('灰色は無彩色レーン（48〜53）に入る', () => {
    const { data, ch } = fill(100, [128, 128, 128]);
    const h = toneHistogram(data, ch);
    const achromatic = [...h].slice(48).reduce((s, v) => s + v, 0);
    expect(achromatic).toBeCloseTo(1, 6);
  });

  it('鮮やかな赤は有彩レーン（0〜47）に入る', () => {
    const { data, ch } = fill(100, [220, 20, 20]);
    const h = toneHistogram(data, ch);
    const chromatic = [...h].slice(0, 48).reduce((s, v) => s + v, 0);
    expect(chromatic).toBeCloseTo(1, 6);
  });

  it('ほぼ透明な画素は数えない', () => {
    const px = 100;
    const data = new Uint8Array(px * 4);
    for (let i = 0; i < px; i++) {
      const opaque = i < 50;
      data[i * 4] = opaque ? 220 : 20;
      data[i * 4 + 1] = opaque ? 20 : 220;
      data[i * 4 + 2] = 20;
      data[i * 4 + 3] = opaque ? 255 : 0;
    }
    const h = toneHistogram(data, 4);
    const onlyRed = toneHistogram(fill(50, [220, 20, 20, 255]).data, 4);
    expect(hellinger(h, onlyRed)).toBeCloseTo(0, 6);
  });

  it('全部透明なら合計 0 の空ヒストグラムを返す（0除算しない）', () => {
    const h = toneHistogram(fill(10, [10, 10, 10, 0]).data, 4);
    expect([...h].reduce((s, v) => s + v, 0)).toBe(0);
  });
});

describe('Hellinger 距離', () => {
  it('同じヒストグラム同士は 0', () => {
    const h = toneHistogram(fill(64, [90, 120, 200]).data, 3);
    expect(hellinger(h, h)).toBeCloseTo(0, 6);
  });

  it('赤一色と青一色はほぼ 1', () => {
    const r = toneHistogram(fill(64, [220, 20, 20]).data, 3);
    const b = toneHistogram(fill(64, [20, 20, 220]).data, 3);
    expect(hellinger(r, b)).toBeGreaterThan(0.95);
  });

  it('近い色どうしは遠い色どうしより小さい', () => {
    const a = toneHistogram(fill(64, [200, 60, 40]).data, 3);
    const near = toneHistogram(fill(64, [210, 80, 45]).data, 3);
    const far = toneHistogram(fill(64, [30, 200, 90]).data, 3);
    expect(hellinger(a, near)).toBeLessThan(hellinger(a, far));
  });
});

describe('centroid', () => {
  it('同じもの3つの重心は元と同じ', () => {
    const h = toneHistogram(fill(64, [120, 90, 200]).data, 3);
    expect(hellinger(centroid([h, h, h]), h)).toBeCloseTo(0, 6);
  });

  it('重心の合計は 1', () => {
    const a = toneHistogram(fill(64, [200, 60, 40]).data, 3);
    const b = toneHistogram(fill(64, [30, 200, 90]).data, 3);
    expect([...centroid([a, b])].reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });
});

describe('medianCentroid（外れ値に引きずられない中心）', () => {
  it('揃った3つに浮いた1つを混ぜても、揃った側の中心はほぼ動かない', () => {
    const a = toneHistogram(fill(64, [30, 60, 130]).data, 3);
    const b = toneHistogram(fill(64, [38, 72, 150]).data, 3);
    const c = toneHistogram(fill(64, [26, 52, 118]).data, 3);
    const odd = toneHistogram(fill(64, [230, 190, 40]).data, 3);

    const tight = medianCentroid([a, b, c]);
    const withOdd = medianCentroid([a, b, c, odd]);
    expect(hellinger(tight, withOdd)).toBeLessThan(0.05);
  });

  it('平均だと同じ場面で中心が大きく動く（これが切り替えた理由）', () => {
    const a = toneHistogram(fill(64, [30, 60, 130]).data, 3);
    const b = toneHistogram(fill(64, [38, 72, 150]).data, 3);
    const c = toneHistogram(fill(64, [26, 52, 118]).data, 3);
    const odd = toneHistogram(fill(64, [230, 190, 40]).data, 3);

    const meanShift = hellinger(centroid([a, b, c]), centroid([a, b, c, odd]));
    const medianShift = hellinger(medianCentroid([a, b, c]), medianCentroid([a, b, c, odd]));
    expect(medianShift).toBeLessThan(meanShift);
  });

  it('合計は 1', () => {
    const a = toneHistogram(fill(64, [200, 60, 40]).data, 3);
    const b = toneHistogram(fill(64, [30, 200, 90]).data, 3);
    expect([...medianCentroid([a, b])].reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });

  it('空の入力でも落ちない', () => {
    expect([...medianCentroid([])].reduce((s, v) => s + v, 0)).toBe(0);
  });
});
