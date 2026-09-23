import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectLoop } from '../src/inspect/video.js';

const exec = promisify(execFile);
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kakera-vid-'));

  // 先頭と末尾が同じ = つながる
  await exec('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=0x2050A0:s=320x180:d=2:r=24',
    '-pix_fmt', 'yuv420p', join(dir, 'flat.mp4'),
  ]);

  // 明→暗に変化して終わる = つながらない
  await exec('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=2:r=24',
    '-vf', 'fade=t=out:st=0:d=2', '-pix_fmt', 'yuv420p', join(dir, 'fade.mp4'),
  ]);
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('inspectLoop', () => {
  it('寸法と尺を読める', async () => {
    const r = await inspectLoop(join(dir, 'flat.mp4'), null);
    expect(r.width).toBe(320);
    expect(r.height).toBe(180);
    expect(r.durationMs).toBeGreaterThan(1800);
  }, 30_000);

  it('先頭と末尾が同じ動画は差が小さい', async () => {
    const r = await inspectLoop(join(dir, 'flat.mp4'), null);
    expect(r.firstLastRms).toBeLessThan(0.02);
  }, 30_000);

  it('末尾で暗くなる動画は差が大きい', async () => {
    const r = await inspectLoop(join(dir, 'fade.mp4'), null);
    expect(r.firstLastRms).toBeGreaterThan(0.2);
  }, 30_000);

  it('閾値が null なら seamless を断定しない', async () => {
    const r = await inspectLoop(join(dir, 'fade.mp4'), null);
    expect(r.seamless).toBeNull();
    expect(r.issues).toEqual([]);
  }, 30_000);

  it('閾値を渡すとつながらない動画を指摘する', async () => {
    const r = await inspectLoop(join(dir, 'fade.mp4'), 0.05);
    expect(r.seamless).toBe(false);
    expect(r.issues.join()).toMatch(/ループ/);
  }, 30_000);

  it('閾値を渡してもつながる動画は指摘しない', async () => {
    const r = await inspectLoop(join(dir, 'flat.mp4'), 0.05);
    expect(r.seamless).toBe(true);
    expect(r.issues).toEqual([]);
  }, 30_000);
});
