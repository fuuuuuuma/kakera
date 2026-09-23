import sharp from 'sharp';

export interface ImageReport {
  path: string;
  width: number;
  height: number;
  ratio: string;
  hasAlphaChannel: boolean;
  /** 実際に透けている画素があるか。チャンネルの有無とは別物 */
  hasRealAlpha: boolean;
  issues: string[];
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function ratioLabel(w: number, h: number): string {
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

export const DEFAULT_MIN_LONG_EDGE = 2048;
/** これ未満のアルファ値が1つでもあれば「本当に抜けている」とみなす */
const ALPHA_TRANSPARENT_BELOW = 250;

export async function inspectImage(
  path: string,
  opts: { alpha: boolean; minLongEdge?: number },
): Promise<ImageReport> {
  const minLongEdge = opts.minLongEdge ?? DEFAULT_MIN_LONG_EDGE;
  const img = sharp(path);
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const issues: string[] = [];

  if (width === 0 || height === 0) {
    return {
      path,
      width,
      height,
      ratio: '0:0',
      hasAlphaChannel: false,
      hasRealAlpha: false,
      issues: ['寸法を読めません'],
    };
  }

  const stats = await img.stats();
  const hasAlphaChannel = stats.channels.length === 4;
  const alphaMin = hasAlphaChannel ? stats.channels[3]!.min : 255;
  const hasRealAlpha = hasAlphaChannel && alphaMin < ALPHA_TRANSPARENT_BELOW;

  if (Math.max(width, height) < minLongEdge) {
    issues.push(
      `長辺が ${Math.max(width, height)}px で、必要な ${minLongEdge}px に届いていません`,
    );
  }
  if (opts.alpha && !hasRealAlpha) {
    issues.push(
      hasAlphaChannel
        ? '透過PNGと宣言されていますが、アルファチャンネルの中身が全部不透明です'
        : '透過PNGと宣言されていますが、アルファチャンネルがありません',
    );
  }
  if (!opts.alpha && hasRealAlpha) {
    issues.push('透過を宣言していませんが、実際に抜けている画素があります');
  }

  return {
    path,
    width,
    height,
    ratio: ratioLabel(width, height),
    hasAlphaChannel,
    hasRealAlpha,
    issues,
  };
}
