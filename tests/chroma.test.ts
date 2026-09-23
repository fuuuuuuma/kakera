import { describe, it, expect } from 'vitest';
import { chromaKey, suppressSpill, estimateBackground } from '../src/inspect/chroma.js';

const MAGENTA: [number, number, number] = [196, 65, 126];

/** 背景色で埋めて、中央に四角い主体を置いたバッファを作る */
function scene(
  w: number,
  h: number,
  bg: [number, number, number],
  subject: [number, number, number],
): Uint8Array {
  const d = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const inSubject = x > w * 0.3 && x < w * 0.7 && y > h * 0.3 && y < h * 0.7;
      const c = inSubject ? subject : bg;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    }
  }
  return d;
}

describe('estimateBackground', () => {
  it('四隅から背景色を当てる', () => {
    const d = scene(100, 100, MAGENTA, [0, 0, 0]);
    expect(estimateBackground(d, 100, 100, 3)).toEqual(MAGENTA);
  });

  it('中央の主体を拾わない（主体が大きくても四隅を見る）', () => {
    const d = scene(100, 100, [255, 255, 255], [0, 0, 0]);
    expect(estimateBackground(d, 100, 100, 3)).toEqual([255, 255, 255]);
  });
});

describe('chromaKey', () => {
  it('背景は完全に透明、主体は完全に不透明になる', () => {
    const d = scene(100, 100, MAGENTA, [0, 0, 0]);
    const r = chromaKey(d, 100, 100, 3);
    expect(r.data[3]).toBe(0); // 左上＝背景
    const center = (50 * 100 + 50) * 4;
    expect(r.data[center + 3]).toBe(255); // 中央＝主体
  });

  it('透明になった割合を返す（抜けたかどうかの機械判定に使う）', () => {
    const d = scene(100, 100, MAGENTA, [0, 0, 0]);
    const r = chromaKey(d, 100, 100, 3);
    expect(r.transparentRatio).toBeGreaterThan(0.5);
    expect(r.transparentRatio).toBeLessThan(0.9);
  });

  it('全面が背景色なら全部透明になる（抜けすぎを検出できる）', () => {
    const d = scene(100, 100, MAGENTA, MAGENTA);
    expect(chromaKey(d, 100, 100, 3).transparentRatio).toBe(1);
  });

  it('背景に近い色の主体は残る（白背景に白い主体は抜けてしまう、の裏返し）', () => {
    // 背景マゼンタ・主体が白 → 距離が大きいので残る
    const d = scene(100, 100, MAGENTA, [255, 255, 255]);
    const r = chromaKey(d, 100, 100, 3);
    const center = (50 * 100 + 50) * 4;
    expect(r.data[center + 3]).toBe(255);
  });

  it('近い色の主体は消える（この場合は背景色を変えるしかない）', () => {
    const near: [number, number, number] = [200, 70, 130]; // 背景とほぼ同じ
    const d = scene(100, 100, MAGENTA, near);
    const r = chromaKey(d, 100, 100, 3);
    expect(r.transparentRatio).toBeGreaterThan(0.99);
  });

  it('中間の距離では羽根が付く（ギザギザにしない）', () => {
    // 距離80 = near60 と far110 の間。8bit を超えない向き（引く側）に取ること —
    // 196+80 は Uint8Array で 20 に折り返して距離が逆に大きくなる（テストで踏んだ）
    const mid: [number, number, number] = [196 - 80, 65, 126];
    const d = scene(100, 100, MAGENTA, mid);
    const center = (50 * 100 + 50) * 4;
    const a = chromaKey(d, 100, 100, 3).data[center + 3]!;
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
  });

  it('4チャンネルの入力も扱える', () => {
    const w = 20, h = 20;
    const d = new Uint8Array(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      d[p * 4] = MAGENTA[0]; d[p * 4 + 1] = MAGENTA[1]; d[p * 4 + 2] = MAGENTA[2]; d[p * 4 + 3] = 255;
    }
    expect(chromaKey(d, w, h, 4).transparentRatio).toBe(1);
  });
});

describe('suppressSpill', () => {
  it('不透明な画素は触らない', () => {
    const rgba = new Uint8Array([10, 20, 30, 255]);
    expect([...suppressSpill(rgba, MAGENTA)]).toEqual([10, 20, 30, 255]);
  });

  it('完全に透明な画素も触らない', () => {
    const rgba = new Uint8Array([196, 65, 126, 0]);
    expect([...suppressSpill(rgba, MAGENTA)]).toEqual([196, 65, 126, 0]);
  });

  it('半透明の画素から背景色の混ざりを取り除く', () => {
    // 黒(0,0,0) が α=0.5 で背景と混ざった観測色
    const k = 0.5;
    const mixed: [number, number, number] = [
      Math.round(0 * k + MAGENTA[0] * (1 - k)),
      Math.round(0 * k + MAGENTA[1] * (1 - k)),
      Math.round(0 * k + MAGENTA[2] * (1 - k)),
    ];
    const out = suppressSpill(new Uint8Array([...mixed, 128]), MAGENTA);
    // 元の黒に戻るはず（丸め誤差の範囲で）
    expect(out[0]).toBeLessThan(6);
    expect(out[1]).toBeLessThan(6);
    expect(out[2]).toBeLessThan(6);
    expect(out[3]).toBe(128);
  });

  it('抑制しないと背景色のにじみが残る（これが AI 版で見えた縁）', () => {
    const k = 0.5;
    const mixed = new Uint8Array([98, 33, 63, 128]); // 黒とマゼンタの中間
    const before = mixed[0]!;
    const after = suppressSpill(mixed, MAGENTA)[0]!;
    expect(after).toBeLessThan(before);
  });
});
