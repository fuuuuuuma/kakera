import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  parsePngHeader,
  checkImageGateLite,
  validateConsent,
  runSubmissionGates,
  checkSubmissionRateLimit,
  SUBMIT_DAILY_LIMIT,
  type CommunitySeriesInput,
} from '../src/catalog/community.js';

// sharp は Node (テスト環境) では使えるが、実際の Worker では使わない
// (このファイルは PNG フィクスチャを作るためだけに使う。community.ts 本体は sharp に依存しない)。
async function pngBytes(opts: { width: number; height: number; alpha: boolean }): Promise<Uint8Array> {
  const img = sharp({
    create: {
      width: opts.width,
      height: opts.height,
      channels: opts.alpha ? 4 : 3,
      background: opts.alpha ? { r: 10, g: 10, b: 10, alpha: 0 } : { r: 10, g: 10, b: 10 },
    },
  }).png();
  const buf = await img.toBuffer();
  return new Uint8Array(buf);
}

describe('parsePngHeader', () => {
  it('幅・高さ・アルファ有無を読み取る (RGB)', async () => {
    const bytes = await pngBytes({ width: 1920, height: 1080, alpha: false });
    const h = parsePngHeader(bytes);
    expect(h).not.toBeNull();
    expect(h?.width).toBe(1920);
    expect(h?.height).toBe(1080);
    expect(h?.hasAlphaChannel).toBe(false);
  });

  it('RGBA はアルファ有りと判定する', async () => {
    const bytes = await pngBytes({ width: 512, height: 512, alpha: true });
    const h = parsePngHeader(bytes);
    expect(h?.hasAlphaChannel).toBe(true);
    expect(h?.colorType).toBe(6);
  });

  it('PNGシグネチャが無ければ null', () => {
    expect(parsePngHeader(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it('短すぎるバイト列は null (範囲外アクセスで例外を投げない)', () => {
    expect(parsePngHeader(new Uint8Array(10))).toBeNull();
    expect(parsePngHeader(new Uint8Array(0))).toBeNull();
  });

  it('PNGシグネチャはあるがIHDRでない偽物は null', () => {
    const fake = new Uint8Array(40);
    fake.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // 12バイト目からIHDR以外を書く
    fake.set([0, 0, 0, 0], 12);
    expect(parsePngHeader(fake)).toBeNull();
  });
});

describe('checkImageGateLite', () => {
  it('十分な解像度のPNGは通る', async () => {
    const bytes = await pngBytes({ width: 1920, height: 1080, alpha: false });
    const r = checkImageGateLite(bytes, 'image/png', false);
    expect(r.ok).toBe(true);
  });

  it('小さすぎる解像度は落ちる', async () => {
    const bytes = await pngBytes({ width: 400, height: 300, alpha: false });
    const r = checkImageGateLite(bytes, 'image/png', false);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/解像度/);
  });

  it('alpha申告ありなのにアルファチャンネルが無ければ落ちる', async () => {
    const bytes = await pngBytes({ width: 1920, height: 1080, alpha: false });
    const r = checkImageGateLite(bytes, 'image/png', true);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/透過/);
  });

  it('alpha申告ありでアルファチャンネルがあれば通る', async () => {
    const bytes = await pngBytes({ width: 1920, height: 1080, alpha: true });
    const r = checkImageGateLite(bytes, 'image/png', true);
    expect(r.ok).toBe(true);
  });

  it('mimeを image/jpeg と偽ってもPNGでない実バイト列は拒否する (セキュリティ点検2026-09-23: mimeスプーフィング対策)', () => {
    const r = checkImageGateLite(new Uint8Array([1, 2, 3]), 'image/jpeg', false);
    expect(r.ok).toBe(false);
  });

  it('mimeを image/jpeg と偽っても、実バイト列が本物のPNGなら通る (mimeは判定に使わない)', async () => {
    const bytes = await pngBytes({ width: 1920, height: 1080, alpha: false });
    const r = checkImageGateLite(bytes, 'image/jpeg', false);
    expect(r.ok).toBe(true);
  });

  it('壊れたPNGは落ちる', () => {
    const r = checkImageGateLite(new Uint8Array(5), 'image/png', false);
    expect(r.ok).toBe(false);
  });
});

const VALID_CONSENT = {
  termsVersion: '2026-09-23',
  licenseVersion: 'kakera-free-v1',
  agreedAt: '2026-09-23T00:00:00Z',
  rightsAttestation: true,
  depictsPersonDeclared: false,
  generatorDeclared: { service: 'openai-imagegen', model: 'codex-cli', version: '0.154.0' },
};

describe('validateConsent', () => {
  it('正しい形は通る', () => {
    const r = validateConsent(VALID_CONSENT);
    expect(r.ok).toBe(true);
  });
  it('rightsAttestation が false なら落ちる', () => {
    const r = validateConsent({ ...VALID_CONSENT, rightsAttestation: false });
    expect(r.ok).toBe(false);
  });
  it('depictsPersonDeclared が true なら落ちる (人物は投稿でも禁止)', () => {
    const r = validateConsent({ ...VALID_CONSENT, depictsPersonDeclared: true });
    expect(r.ok).toBe(false);
  });
  it('generatorDeclared が無ければ落ちる', () => {
    const r = validateConsent({ ...VALID_CONSENT, generatorDeclared: undefined });
    expect(r.ok).toBe(false);
  });
  it('agreedAt が日付として不正なら落ちる', () => {
    const r = validateConsent({ ...VALID_CONSENT, agreedAt: 'not-a-date' });
    expect(r.ok).toBe(false);
  });
});

describe('runSubmissionGates', () => {
  async function baseInput(overrides: Partial<CommunitySeriesInput> = {}): Promise<{
    input: CommunitySeriesInput;
    bytes: Map<string, Uint8Array>;
  }> {
    const pieceBytes = new Map<string, Uint8Array>();
    const pieces = [];
    for (let i = 1; i <= 6; i++) {
      const id = `piece-${i}`;
      pieceBytes.set(id, await pngBytes({ width: 1920, height: 1080, alpha: false }));
      pieces.push({ id, kind: 'still' as const, mime: 'image/png', bytesBase64: '', prompt: `落ち着いたオフィス、朝の光 ${i}`, alpha: false });
    }
    const input: CommunitySeriesInput = {
      slug: 'test-series',
      title: 'テストシリーズ',
      description: 'テスト用の説明',
      tone: { light: '朝の柔らかい光', colorTemp: '暖色', framing: '広め', texture: 'マット' },
      creatorHandle: '@tester',
      consent: VALID_CONSENT,
      pieces,
      ...overrides,
    };
    return { input, bytes: pieceBytes };
  }

  it('すべて正しければ通る', async () => {
    const { input, bytes } = await baseInput();
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(true);
  });

  it('slugの形式が不正なら schema ゲートで落ちる', async () => {
    const { input, bytes } = await baseInput({ slug: 'Bad Slug!' });
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.gate).toBe('schema');
  });

  it('5点しかなければ落ちる (6〜12点必須)', async () => {
    const { input, bytes } = await baseInput();
    input.pieces = input.pieces.slice(0, 5);
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.gate).toBe('schema');
  });

  it('同意が不正なら consent ゲートで落ちる', async () => {
    const { input, bytes } = await baseInput({ consent: { ...VALID_CONSENT, rightsAttestation: false } });
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.gate).toBe('consent');
  });

  it('格付けBの生成元を申告すると generator ゲートで落ちる', async () => {
    const { input, bytes } = await baseInput({
      consent: { ...VALID_CONSENT, generatorDeclared: { service: 'grok', model: 'x', version: '1' } },
    });
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.gate).toBe('generator');
  });

  it('未登録の生成元は generator ゲートで落ちる', async () => {
    const { input, bytes } = await baseInput({
      consent: { ...VALID_CONSENT, generatorDeclared: { service: 'unknown-service', model: 'x', version: '1' } },
    });
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.gate).toBe('generator');
  });

  it('禁止語を含むプロンプトは prompt ゲートで落ちる', async () => {
    const { input, bytes } = await baseInput();
    const first = input.pieces[0];
    if (!first) throw new Error('test setup error: pieces empty');
    first.prompt = 'in the style of Greg Rutkowski, office scene';
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.gate).toBe('prompt');
  });

  it('解像度不足の画像は image ゲートで落ちる', async () => {
    const { input, bytes } = await baseInput();
    bytes.set('piece-1', await pngBytes({ width: 300, height: 200, alpha: false }));
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.gate).toBe('image');
  });

  it('ファイルが届いていないpieceは image ゲートで落ちる (なりすまし対策)', async () => {
    const { input, bytes } = await baseInput();
    bytes.delete('piece-1');
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.gate).toBe('image');
  });

  // ---- セキュリティ点検 (本体・2026-09-23) 対応の回帰テスト ----

  it('piece.id がパス文字列を含むと schema ゲートで落ちる (R2キーへの注入対策)', async () => {
    const { input, bytes } = await baseInput();
    const first = input.pieces[0];
    if (!first) throw new Error('test setup error');
    first.id = '../other-series/piece-1';
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.gate).toBe('schema');
  });

  it('piece.id が重複していると schema ゲートで落ちる', async () => {
    const { input, bytes } = await baseInput();
    input.pieces[1]!.id = input.pieces[0]!.id;
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.gate).toBe('schema');
  });

  it('kind が still 以外 (loop/se/bgm) だと schema ゲートで落ちる (Phase2は静止画の検品しか無い)', async () => {
    const { input, bytes } = await baseInput();
    input.pieces[0]!.kind = 'loop';
    const r = runSubmissionGates(input, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.gate).toBe('schema');
  });
});

describe('checkSubmissionRateLimit', () => {
  it('上限未満なら通る', () => {
    expect(checkSubmissionRateLimit(0).ok).toBe(true);
    expect(checkSubmissionRateLimit(SUBMIT_DAILY_LIMIT - 1).ok).toBe(true);
  });
  it('上限に達したら落ちる', () => {
    const r = checkSubmissionRateLimit(SUBMIT_DAILY_LIMIT);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/上限/);
  });
});
