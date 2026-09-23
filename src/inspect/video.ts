import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

/** シェルを経由しない execFile を使う。引数は配列で渡すのでパスにどんな文字が入っても壊れない。 */
const run = promisify(execFile);

export interface LoopReport {
  path: string;
  width: number;
  height: number;
  durationMs: number;
  /** 先頭フレームと末尾フレームの差（0〜1）。小さいほどつながる */
  firstLastRms: number;
  /** 閾値が未設定のうちは断定しない */
  seamless: boolean | null;
  issues: string[];
}

const COMPARE_SIZE = 64;

async function probe(path: string): Promise<{ width: number; height: number; durationMs: number }> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json',
    path,
  ]);
  const j = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number }[];
    format?: { duration?: string };
  };
  return {
    width: j.streams?.[0]?.width ?? 0,
    height: j.streams?.[0]?.height ?? 0,
    durationMs: Math.round(parseFloat(j.format?.duration ?? '0') * 1000),
  };
}

async function grayscale64(pngPath: string): Promise<Uint8Array> {
  const { data } = await sharp(pngPath)
    .resize(COMPARE_SIZE, COMPARE_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

export async function inspectLoop(path: string, threshold: number | null): Promise<LoopReport> {
  const { width, height, durationMs } = await probe(path);
  const work = await mkdtemp(join(tmpdir(), 'kakera-loop-'));

  try {
    const first = join(work, 'first.png');
    const last = join(work, 'last.png');

    await run('ffmpeg', ['-y', '-v', 'error', '-i', path, '-frames:v', '1', first]);
    // -sseof で末尾から拾う。最終フレームを確実に取るための定石
    await run('ffmpeg', [
      '-y', '-v', 'error', '-sseof', '-0.5', '-i', path,
      '-update', '1', '-frames:v', '1', last,
    ]);

    const a = await grayscale64(first);
    const b = await grayscale64(last);

    let sum = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = (a[i]! - b[i]!) / 255;
      sum += d * d;
    }
    const firstLastRms = n > 0 ? Math.sqrt(sum / n) : 0;

    const issues: string[] = [];
    let seamless: boolean | null = null;
    if (threshold !== null) {
      seamless = firstLastRms <= threshold;
      if (!seamless) {
        issues.push(
          `先頭と末尾の差が ${firstLastRms.toFixed(4)} で、ループがつながりません（上限 ${threshold}）`,
        );
      }
    }

    return { path, width, height, durationMs, firstLastRms, seamless, issues };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
