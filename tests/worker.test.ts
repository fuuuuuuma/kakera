import { describe, it, expect } from 'vitest';
import { dayKey, hashIp, parseBeacon, isRequestFromAdmin, submitDepsFromEnv } from '../src/worker/index.js';

describe('dayKey', () => {
  it('YYYY-MM-DD を返す', () => {
    expect(dayKey(new Date('2026-08-21T15:04:05Z'))).toBe('2026-08-21');
  });
  it('同じ日の別時刻は同じキー', () => {
    expect(dayKey(new Date('2026-08-21T00:00:00Z'))).toBe(
      dayKey(new Date('2026-08-21T23:59:59Z')),
    );
  });
});

describe('hashIp', () => {
  it('同じIPからは同じ値', async () => {
    expect(await hashIp('1.2.3.4', 'salt')).toBe(await hashIp('1.2.3.4', 'salt'));
  });
  it('違うIPからは違う値', async () => {
    expect(await hashIp('1.2.3.4', 'salt')).not.toBe(await hashIp('1.2.3.5', 'salt'));
  });
  it('IPそのものを含まない（元に戻せない）', async () => {
    expect(await hashIp('1.2.3.4', 'salt')).not.toContain('1.2.3.4');
  });
  it('salt が違えば値も違う', async () => {
    expect(await hashIp('1.2.3.4', 'a')).not.toBe(await hashIp('1.2.3.4', 'b'));
  });
  it('SHA-256 の16進64文字', async () => {
    expect(await hashIp('1.2.3.4', 'salt')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('parseBeacon', () => {
  it('正しい形は通る', () => {
    expect(parseBeacon({ series: 'nd', piece: 'nd-01' })).toEqual({ series: 'nd', piece: 'nd-01' });
  });
  it('欠けていたら null', () => {
    expect(parseBeacon({ series: 'nd' })).toBeNull();
    expect(parseBeacon({})).toBeNull();
    expect(parseBeacon(null)).toBeNull();
    expect(parseBeacon('nd')).toBeNull();
  });
  it('形式が違えば null（SQL に渡す前に弾く）', () => {
    expect(parseBeacon({ series: 'a/b', piece: 'x' })).toBeNull();
    expect(parseBeacon({ series: 'nd', piece: "x'; DROP TABLE" })).toBeNull();
    expect(parseBeacon({ series: 'ND', piece: 'x' })).toBeNull();
  });
  it('長すぎたら null', () => {
    expect(parseBeacon({ series: 'a'.repeat(200), piece: 'x' })).toBeNull();
  });
  it('実際のIDは通る', () => {
    expect(parseBeacon({ series: 'night-desk', piece: 'night-desk-01' })).toEqual({
      series: 'night-desk',
      piece: 'night-desk-01',
    });
  });
});

describe('isRequestFromAdmin', () => {
  // 運営者の上限回避 (/api/submit) と管理API (/api/admin/*) が同じヘッダ名・同じ既定値を
  // 使っていることをここで固定する (src/worker/index.ts の isRequestFromAdmin 参照)。
  it('ヘッダ名は x-admin-token (大文字小文字は問わない。Headers仕様どおり)', () => {
    const req = new Request('https://x.example', { headers: { 'x-admin-token': 'secret' } });
    expect(isRequestFromAdmin(req, { ADMIN_TOKEN: 'secret' })).toBe(true);
  });
  it('X-Admin-Token のような大文字表記でも通る (Headers は大文字小文字を区別しない)', () => {
    const req = new Request('https://x.example', { headers: { 'X-Admin-Token': 'secret' } });
    expect(isRequestFromAdmin(req, { ADMIN_TOKEN: 'secret' })).toBe(true);
  });
  it('ヘッダが無ければ false (例外を投げない)', () => {
    const req = new Request('https://x.example');
    expect(isRequestFromAdmin(req, { ADMIN_TOKEN: 'secret' })).toBe(false);
  });
  it('ADMIN_TOKEN が未設定 (undefined) なら、どんなヘッダを送っても false', () => {
    const req = new Request('https://x.example', { headers: { 'x-admin-token': '' } });
    expect(isRequestFromAdmin(req, { ADMIN_TOKEN: undefined })).toBe(false);
  });
  it('トークンが不一致なら false', () => {
    const req = new Request('https://x.example', { headers: { 'x-admin-token': 'wrong' } });
    expect(isRequestFromAdmin(req, { ADMIN_TOKEN: 'secret' })).toBe(false);
  });
});

describe('moderateImage (AIモデレーションの呼び出し)', () => {
  // 2026-09-24 本番: 2048px の PNG (約1.6MB) で String.fromCharCode(...bytes) が
  // 「Maximum call stack size exceeded」を投げ、AIを呼ぶ前に全件保留になっていた。
  function envWithAi(run: (model: string, input: { image: number[] }) => Promise<unknown>) {
    return { AI: { run } } as unknown as Parameters<typeof submitDepsFromEnv>[0];
  }

  it('実物大の画像でも例外にならず、縮めた画像を AI に渡す', async () => {
    const { default: sharp } = await import('sharp');
    const bytes = new Uint8Array(await sharp({
      create: { width: 2048, height: 2048, channels: 3, background: '#d0c0a0' },
    }).png({ compressionLevel: 0 }).toBuffer());
    let seen = 0;
    const deps = submitDepsFromEnv(envWithAi(async (_model, input) => {
      seen = input.image.length;
      return { description: 'No.' };
    }));
    const r = await deps.moderateImage(bytes, 'image/png');
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(bytes.length / 10);
    expect(r.flagged).toBe(false);
  });

  it('画像として読めなければ AI を呼ばずに保留する', async () => {
    let called = false;
    const deps = submitDepsFromEnv(envWithAi(async () => { called = true; return { description: 'No.' }; }));
    const r = await deps.moderateImage(new Uint8Array(64).fill(7), 'image/png');
    expect(called).toBe(false);
    expect(r.flagged).toBe(true);
  });

  it('AI が yes / unsure / 空なら保留する', async () => {
    const { default: sharp } = await import('sharp');
    const bytes = new Uint8Array(await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#ffffff' },
    }).png().toBuffer());
    for (const description of ['Yes.', 'unsure', '']) {
      const deps = submitDepsFromEnv(envWithAi(async () => ({ description })));
      expect((await deps.moderateImage(bytes, 'image/png')).flagged).toBe(true);
    }
  });
});
