import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectAudio } from '../src/inspect/audio.js';

const run = promisify(execFile);
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kakera-aud-'));

  // 適正音量のトーン
  await run('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-af', 'volume=-6dB', join(dir, 'ok.wav'),
  ]);

  // 0dBFS に張り付いた音。
  // lavfi の sine はフルスケールではなくピーク -18.1 dB なので、+12dB では張り付かない。
  // 実測で +20dB から 0.0 dB に達することを確かめて 25dB にしている。
  await run('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-af', 'volume=25dB', join(dir, 'clip.wav'),
  ]);

  // 先頭に1.5秒の無音がある音
  // -filter_complex と -af は同じストリームに併用できないので、音量調整も chain の中でやる
  await run('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-filter_complex', '[0][1]concat=n=2:v=0:a=1,volume=-6dB[out]',
    '-map', '[out]', join(dir, 'lead.wav'),
  ]);
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const OPTS = { maxVolumeDb: -0.1, maxEdgeSilenceMs: 500 };

describe('inspectAudio', () => {
  it('尺とピーク音量を読める', async () => {
    const r = await inspectAudio(join(dir, 'ok.wav'), OPTS);
    expect(r.durationMs).toBeGreaterThan(1800);
    expect(r.maxVolumeDb).toBeLessThan(-3);
  }, 30_000);

  it('適正な音は指摘なしで通る', async () => {
    const r = await inspectAudio(join(dir, 'ok.wav'), OPTS);
    expect(r.issues).toEqual([]);
  }, 30_000);

  it('0dBFS に張り付いた音を指摘する', async () => {
    const r = await inspectAudio(join(dir, 'clip.wav'), OPTS);
    expect(r.maxVolumeDb).toBeGreaterThanOrEqual(-0.1);
    expect(r.issues.join()).toMatch(/張り付/);
  }, 30_000);

  it('先頭の長い無音を測って指摘する', async () => {
    const r = await inspectAudio(join(dir, 'lead.wav'), OPTS);
    expect(r.leadingSilenceMs).toBeGreaterThan(1000);
    expect(r.issues.join()).toMatch(/先頭/);
  }, 30_000);

  it('無音が短ければ指摘しない', async () => {
    const r = await inspectAudio(join(dir, 'lead.wav'), { ...OPTS, maxEdgeSilenceMs: 3000 });
    expect(r.issues.join()).not.toMatch(/先頭/);
  }, 30_000);
});
