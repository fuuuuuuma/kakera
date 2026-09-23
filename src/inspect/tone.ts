import sharp from 'sharp';
import { basename } from 'node:path';
import { toneHistogram, hellinger, medianCentroid } from './color.js';

export interface ToneEntry {
  file: string;
  distance: number;
}

export interface ToneReport {
  entries: ToneEntry[];
  max: number;
  mean: number;
  threshold: number | null;
  issues: string[];
}

/** 距離の計算に使う縮小サイズ。細部ではなく色の分布を見たいので小さくする。 */
const SAMPLE = 96;

export async function imageToneHistogram(path: string): Promise<Float64Array> {
  const { data, info } = await sharp(path)
    .resize(SAMPLE, SAMPLE, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return toneHistogram(new Uint8Array(data), info.channels === 4 ? 4 : 3);
}

/**
 * シリーズ全体の重心からの距離を出す。
 * threshold が null のときは測るだけで指摘を出さない（閾値を実測で決めるまでの状態）。
 */
export async function inspectSeriesTone(
  paths: string[],
  threshold: number | null,
): Promise<ToneReport> {
  const hists = await Promise.all(paths.map(imageToneHistogram));
  // 平均ではなく中央値を中心にする。浮いた1点に中心を動かされると、
  // 揃っている残りまで巻き添えで遠くなるため（実測で確認済み）。
  const c = medianCentroid(hists);

  const entries: ToneEntry[] = paths
    .map((file, i) => ({ file, distance: hellinger(hists[i]!, c) }))
    .sort((a, b) => b.distance - a.distance);

  const max = entries.length ? entries[0]!.distance : 0;
  const mean = entries.length
    ? entries.reduce((s, e) => s + e.distance, 0) / entries.length
    : 0;

  const issues: string[] = [];
  if (threshold !== null) {
    for (const e of entries) {
      if (e.distance > threshold) {
        issues.push(
          `${basename(e.file)} はシリーズの中心から ${e.distance.toFixed(3)} 離れています（上限 ${threshold}）`,
        );
      }
    }
  }

  return { entries, max, mean, threshold, issues };
}
