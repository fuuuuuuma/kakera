/**
 * シリーズが「トーンが揃っている」ことを数値で言うための計算。
 * 目視では判断できないので、ここが揃いの主張の裏づけになる。
 *
 * 作りの方針:
 *   sRGB → OKLab に変換して、明度6段 × 色相8方向の 48 レーンに投票する。
 *   彩度が低い画素は色相が不安定なので、明度6段だけの無彩色レーン（48〜53）へ回す。
 *   ヒストグラム同士は Hellinger 距離で比べる（0〜1 に収まるので閾値が読みやすい）。
 */

export const L_BINS = 6;
export const H_BINS = 8;
export const TONE_BINS = L_BINS * H_BINS + L_BINS; // 54

/** 彩度がこれ未満の画素は色相を信じない */
const CHROMA_FLOOR = 0.02;
/** アルファがこれ未満の画素は数えない */
const ALPHA_FLOOR = 8;

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearSrgbToOklab(
  r: number,
  g: number,
  b: number,
): { L: number; a: number; b: number } {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/**
 * 生のピクセル列からトーンヒストグラムを作る。
 * 数えた画素が 0 のときは合計 0 の配列をそのまま返す（0除算しない）。
 */
export function toneHistogram(data: Uint8Array, channels: 3 | 4): Float64Array {
  const hist = new Float64Array(TONE_BINS);
  let counted = 0;

  for (let i = 0; i + channels <= data.length; i += channels) {
    if (channels === 4 && data[i + 3]! < ALPHA_FLOOR) continue;

    const { L, a, b } = linearSrgbToOklab(
      srgbToLinear(data[i]! / 255),
      srgbToLinear(data[i + 1]! / 255),
      srgbToLinear(data[i + 2]! / 255),
    );

    const lBin = Math.min(L_BINS - 1, Math.max(0, Math.floor(L * L_BINS)));
    const chroma = Math.hypot(a, b);

    if (chroma < CHROMA_FLOOR) {
      hist[L_BINS * H_BINS + lBin]! += 1;
    } else {
      const hue = Math.atan2(b, a); // -π..π
      const hBin = Math.min(
        H_BINS - 1,
        Math.floor(((hue + Math.PI) / (2 * Math.PI)) * H_BINS),
      );
      hist[lBin * H_BINS + hBin]! += 1;
    }
    counted++;
  }

  if (counted > 0) {
    for (let k = 0; k < TONE_BINS; k++) hist[k]! /= counted;
  }
  return hist;
}

/** 0（同じ）〜 1（まったく重ならない） */
export function hellinger(p: Float64Array, q: Float64Array): number {
  let bc = 0;
  const n = Math.min(p.length, q.length);
  for (let i = 0; i < n; i++) bc += Math.sqrt(p[i]! * q[i]!);
  return Math.sqrt(Math.max(0, 1 - bc));
}

/** シリーズの中心となるトーン。 */
export function centroid(hs: Float64Array[]): Float64Array {
  const c = new Float64Array(TONE_BINS);
  for (const h of hs) {
    for (let i = 0; i < TONE_BINS; i++) c[i]! += h[i]!;
  }
  let sum = 0;
  for (let i = 0; i < TONE_BINS; i++) sum += c[i]!;
  if (sum > 0) {
    for (let i = 0; i < TONE_BINS; i++) c[i]! /= sum;
  }
  return c;
}

/**
 * 外れ値に引きずられない中心。ビンごとの中央値を取って正規化する。
 *
 * 平均（centroid）だと、浮いた1点が中心そのものを動かしてしまい、
 * ちゃんと揃っている残りの点まで距離が跳ね上がる。実測では
 * 揃った3点が 0.14 → 0.39 に押し上げられ、閾値を1本引くと全部が引っかかった。
 * 中央値なら浮いた点は中心に影響しないので、犯人だけが遠くなる。
 */
export function medianCentroid(hs: Float64Array[]): Float64Array {
  const c = new Float64Array(TONE_BINS);
  if (hs.length === 0) return c;

  const lane: number[] = new Array(hs.length);
  for (let i = 0; i < TONE_BINS; i++) {
    for (let k = 0; k < hs.length; k++) lane[k] = hs[k]![i]!;
    lane.sort((a, b) => a - b);
    const mid = hs.length >> 1;
    c[i] = hs.length % 2 === 1 ? lane[mid]! : (lane[mid - 1]! + lane[mid]!) / 2;
  }

  let sum = 0;
  for (let i = 0; i < TONE_BINS; i++) sum += c[i]!;
  if (sum > 0) {
    for (let i = 0; i < TONE_BINS; i++) c[i]! /= sum;
  }
  return c;
}
