import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** シェルを経由しない execFile を使う。引数は配列で渡すのでパスにどんな文字が入っても壊れない。 */
const run = promisify(execFile);

export interface AudioReport {
  path: string;
  durationMs: number;
  /** ピーク音量（dBFS）。0 に近いほど張り付いている */
  maxVolumeDb: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  issues: string[];
}

/** これ未満を無音とみなす */
const SILENCE_NOISE_DB = -50;
const SILENCE_MIN_SEC = 0.2;

async function durationMs(path: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path,
  ]);
  const j = JSON.parse(stdout) as { format?: { duration?: string } };
  return Math.round(parseFloat(j.format?.duration ?? '0') * 1000);
}

/** ffmpeg のフィルタ結果は stderr に出る。execFile はエラーにしないので stderr を読む。 */
async function filterStderr(path: string, af: string): Promise<string> {
  const { stderr } = await run(
    'ffmpeg',
    ['-v', 'info', '-i', path, '-af', af, '-f', 'null', '-'],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return stderr;
}

export async function inspectAudio(
  path: string,
  opts: { maxVolumeDb: number; maxEdgeSilenceMs: number },
): Promise<AudioReport> {
  const dur = await durationMs(path);

  const volOut = await filterStderr(path, 'volumedetect');
  const maxMatch = volOut.match(/max_volume:\s*(-?[\d.]+) dB/);
  const maxVolumeDb = maxMatch ? parseFloat(maxMatch[1]!) : -Infinity;

  const silOut = await filterStderr(
    path,
    `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_SEC}`,
  );
  const starts = [...silOut.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]!));
  const ends = [...silOut.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]!));

  // 先頭の無音: 0秒付近から始まる無音区間の終わり
  let leadingSilenceMs = 0;
  if (starts.length > 0 && starts[0]! < 0.05 && ends.length > 0) {
    leadingSilenceMs = Math.round(ends[0]! * 1000);
  }

  // 末尾の無音: 最後の無音区間が終端まで続いていれば、その長さ
  let trailingSilenceMs = 0;
  if (starts.length > 0) {
    const lastStart = starts[starts.length - 1]!;
    const closed = ends.length === starts.length;
    const lastEnd = closed ? ends[ends.length - 1]! : dur / 1000;
    if (Math.abs(lastEnd - dur / 1000) < 0.15) {
      trailingSilenceMs = Math.round((dur / 1000 - lastStart) * 1000);
    }
  }

  const issues: string[] = [];
  if (maxVolumeDb === -Infinity) {
    issues.push('音が入っていません（全編無音）');
  } else if (maxVolumeDb >= opts.maxVolumeDb) {
    issues.push(
      `ピークが ${maxVolumeDb.toFixed(2)} dBFS で 0dBFS に張り付いています（上限 ${opts.maxVolumeDb}）`,
    );
  }
  if (leadingSilenceMs > opts.maxEdgeSilenceMs) {
    issues.push(`先頭に ${leadingSilenceMs}ms の無音があります（上限 ${opts.maxEdgeSilenceMs}ms）`);
  }
  if (trailingSilenceMs > opts.maxEdgeSilenceMs) {
    issues.push(`末尾に ${trailingSilenceMs}ms の無音があります（上限 ${opts.maxEdgeSilenceMs}ms）`);
  }

  return { path, durationMs: dur, maxVolumeDb, leadingSilenceMs, trailingSilenceMs, issues };
}
