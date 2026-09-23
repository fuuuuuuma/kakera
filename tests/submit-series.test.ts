import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  slugifyId,
  resolvePiecePrompt,
  listPngsInDir,
  selectFromCodex,
  checkImageWithSharp,
  loadPieces,
  buildConsent,
  buildSubmitInput,
  runLocalChecks,
  sendSubmission,
  loadMeta,
  type FetchLike,
  DEFAULT_TERMS_VERSION,
  DEFAULT_LICENSE_VERSION,
  type SubmitSeriesMeta,
} from '../tools/submit-series.js';

async function pngBuffer(opts: { width: number; height: number; alpha?: boolean }): Promise<Buffer> {
  return sharp({
    create: {
      width: opts.width,
      height: opts.height,
      channels: opts.alpha ? 4 : 3,
      background: opts.alpha ? { r: 10, g: 10, b: 10, alpha: 0 } : { r: 10, g: 10, b: 10 },
    },
  })
    .png()
    .toBuffer();
}

const META: SubmitSeriesMeta = {
  slug: 'night-office',
  title: '夜のオフィス街',
  description: '落ち着いた夜のオフィス街',
  tone: { light: '夜', colorTemp: '寒色', framing: '広め', texture: 'マット' },
  creatorHandle: '@tester',
  generatorDeclared: { service: 'openai-imagegen', model: 'codex-cli', version: '0.154.0' },
  prompt: '共通プロンプト: 落ち着いたオフィス、朝の光',
};

const tmpDirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'kakera-submit-series-'));
  tmpDirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('loadMeta', () => {
  it('必要なフィールドが揃っていれば通る', () => {
    expect(() => loadMeta(META)).not.toThrow();
  });
  it('欠けていれば分かりやすいエラーになる', () => {
    const bad = { ...META } as Partial<SubmitSeriesMeta>;
    delete bad.slug;
    expect(() => loadMeta(bad)).toThrow(/slug/);
  });
});

describe('slugifyId', () => {
  it('拡張子を除き小文字化・非英数字をハイフンにする', () => {
    const taken = new Set<string>();
    expect(slugifyId('Night Office_01.png', taken)).toBe('night-office-01');
  });
  it('重複したら連番を足す', () => {
    const taken = new Set<string>();
    const a = slugifyId('piece.png', taken);
    const b = slugifyId('piece.png', taken);
    expect(a).not.toBe(b);
    expect(b).toMatch(/^piece-2/);
  });
  it('Codexの日本語を含まないタイムスタンプ風ファイル名でも安全なidになる', () => {
    const taken = new Set<string>();
    const id = slugifyId('image_2026-09-23_12-00-00.png', taken);
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
  });
});

describe('resolvePiecePrompt', () => {
  it('個別プロンプトがあればそれを使う', () => {
    const meta: SubmitSeriesMeta = { ...META, prompts: { 'a.png': '個別プロンプト' } };
    expect(resolvePiecePrompt(meta, '/x/a.png')).toBe('個別プロンプト');
  });
  it('無ければ共通プロンプトにフォールバックする', () => {
    expect(resolvePiecePrompt(META, '/x/b.png')).toBe(META.prompt);
  });
  it('どちらも無ければ null', () => {
    const meta: SubmitSeriesMeta = { ...META, prompt: undefined };
    expect(resolvePiecePrompt(meta, '/x/c.png')).toBeNull();
  });
});

describe('listPngsInDir / selectFromCodex', () => {
  it('フォルダ直下の.pngだけをアルファベット順で返す', async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, 'b.png'), await pngBuffer({ width: 1200, height: 1200 }));
    await writeFile(join(dir, 'a.png'), await pngBuffer({ width: 1200, height: 1200 }));
    await writeFile(join(dir, 'note.txt'), 'x');
    const files = await listPngsInDir(dir);
    expect(files.map((f) => f.split('/').pop())).toEqual(['a.png', 'b.png']);
  });

  it('更新日時が新しい順にN枚選ぶ', async () => {
    const dir = await makeTmpDir();
    const names = ['old.png', 'mid.png', 'new.png'];
    for (const n of names) await writeFile(join(dir, n), await pngBuffer({ width: 1200, height: 1200 }));
    const now = Date.now() / 1000;
    await utimes(join(dir, 'old.png'), now - 300, now - 300);
    await utimes(join(dir, 'mid.png'), now - 200, now - 200);
    await utimes(join(dir, 'new.png'), now - 100, now - 100);
    const selected = await selectFromCodex(2, dir);
    expect(selected.map((f) => f.split('/').pop())).toEqual(['new.png', 'mid.png']);
  });

  it('足りない枚数しか無ければ分かりやすいエラーになる', async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, 'one.png'), await pngBuffer({ width: 1200, height: 1200 }));
    await expect(selectFromCodex(5, dir)).rejects.toThrow(/5枚必要/);
  });

  it('フォルダが無ければ分かりやすいエラーになる', async () => {
    await expect(selectFromCodex(3, '/does/not/exist/kakera-test')).rejects.toThrow(/読めませんでした/);
  });
});

describe('checkImageWithSharp', () => {
  it('長辺1024px以上のPNGは通る', async () => {
    const bytes = await pngBuffer({ width: 1920, height: 1080 });
    const r = await checkImageWithSharp('x.png', bytes);
    expect(r.ok).toBe(true);
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
  });
  it('長辺1024px未満は落ちる', async () => {
    const bytes = await pngBuffer({ width: 800, height: 600 });
    const r = await checkImageWithSharp('small.png', bytes);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/1024/);
  });
  it('PNGでないバイト列は落ちる', async () => {
    const r = await checkImageWithSharp('fake.png', Buffer.from('not a png'));
    expect(r.ok).toBe(false);
  });
  it('アルファチャンネルの有無を検出する', async () => {
    const bytes = await pngBuffer({ width: 1200, height: 1200, alpha: true });
    const r = await checkImageWithSharp('a.png', bytes);
    expect(r.hasAlpha).toBe(true);
  });
});

describe('buildConsent', () => {
  it('既定のtermsVersion/licenseVersionを使う', () => {
    const c = buildConsent(META);
    expect(c.termsVersion).toBe(DEFAULT_TERMS_VERSION);
    expect(c.licenseVersion).toBe(DEFAULT_LICENSE_VERSION);
    expect(c.rightsAttestation).toBe(true);
    expect(c.depictsPersonDeclared).toBe(false);
  });
  it('meta.consentで上書きできる', () => {
    const meta: SubmitSeriesMeta = { ...META, consent: { termsVersion: '9999-01-01' } };
    expect(buildConsent(meta).termsVersion).toBe('9999-01-01');
  });
});

async function makeValidPieces(n = 6) {
  const dir = await makeTmpDir();
  const files: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = join(dir, `piece-${i + 1}.png`);
    await writeFile(f, await pngBuffer({ width: 1920, height: 1080 }));
    files.push(f);
  }
  return loadPieces(files, META);
}

describe('runLocalChecks (本番と同じ関門)', () => {
  it('正しいシリーズは通る', async () => {
    const pieces = await makeValidPieces(6);
    const r = await runLocalChecks(META, pieces);
    expect(r.ok).toBe(true);
    expect(r.sharpResults.every((x) => x.ok)).toBe(true);
  });

  it('6点未満はschemaゲートで落ちる (runSubmissionGatesをそのまま使っている確認)', async () => {
    const pieces = await makeValidPieces(3);
    const r = await runLocalChecks(META, pieces);
    expect(r.ok).toBe(false);
    expect(r.gate).toBe('schema');
  });

  it('禁止語を含むプロンプトはpromptゲートで落ちる', async () => {
    const meta: SubmitSeriesMeta = { ...META, prompt: 'in the style of greg rutkowski' };
    const pieces = await makeValidPieces(6);
    const withBadPrompt = pieces.map((p) => ({ ...p, prompt: meta.prompt! }));
    const r = await runLocalChecks(meta, withBadPrompt);
    expect(r.ok).toBe(false);
    expect(r.gate).toBe('prompt');
  });

  it('格付けの低い生成元 (grok等) はgeneratorゲートで落ちる', async () => {
    const meta: SubmitSeriesMeta = { ...META, generatorDeclared: { service: 'grok', model: 'x', version: '1' } };
    const pieces = await makeValidPieces(6);
    const r = await runLocalChecks(meta, pieces);
    expect(r.ok).toBe(false);
    expect(r.gate).toBe('generator');
  });

  it('解像度不足はsharpチェックの時点で落ち、runSubmissionGatesまで進まない', async () => {
    const dir = await makeTmpDir();
    const files: string[] = [];
    for (let i = 0; i < 6; i++) {
      const f = join(dir, `piece-${i + 1}.png`);
      await writeFile(f, await pngBuffer({ width: 500, height: 400 }));
      files.push(f);
    }
    const pieces = await loadPieces(files, META);
    const r = await runLocalChecks(META, pieces);
    expect(r.ok).toBe(false);
    expect(r.gate).toBe('image-sharp');
  });
});

describe('sendSubmission (--send)', () => {
  it('fetchを差し替えて呼び出せる。x-admin-tokenはadminTokenを渡したときだけ付く', async () => {
    const pieces = await makeValidPieces(6);
    const fakeFetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ ok: true, seriesId: 'abc' }), { status: 201 }));
    const r = await sendSubmission('https://example.test', META, pieces, undefined, fakeFetch );
    expect(r.status).toBe(201);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = fakeFetch.mock.calls[0]!;
    expect(url).toBe('https://example.test/api/submit');
    expect(init.method).toBe('POST');
    expect(init.headers).not.toHaveProperty('x-admin-token');
  });

  it('adminTokenを渡したらx-admin-tokenヘッダが付く', async () => {
    const pieces = await makeValidPieces(6);
    const fakeFetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    await sendSubmission('https://example.test', META, pieces, 'secret-token', fakeFetch );
    const [, init] = fakeFetch.mock.calls[0]!;
    expect(init.headers).toMatchObject({ 'x-admin-token': 'secret-token' });
  });

  it('endpoint末尾のスラッシュは正規化される', async () => {
    const pieces = await makeValidPieces(6);
    const fakeFetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    await sendSubmission('https://example.test/', META, pieces, undefined, fakeFetch );
    const [url] = fakeFetch.mock.calls[0]!;
    expect(url).toBe('https://example.test/api/submit');
  });

  it('レスポンスのstatus/bodyをそのまま返す (エラー時も)', async () => {
    const pieces = await makeValidPieces(6);
    const fakeFetch = vi.fn<FetchLike>(
      async () => new Response(JSON.stringify({ ok: false, error: 'だめでした', gate: 'prompt' }), { status: 422 }),
    );
    const r = await sendSubmission('https://example.test', META, pieces, undefined, fakeFetch );
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ ok: false, gate: 'prompt' });
  });
});

describe('buildSubmitInput', () => {
  it('本文の形が /api/submit の期待どおり (id/kind/mime/bytesBase64/prompt/alpha)', async () => {
    const pieces = await makeValidPieces(6);
    const input = buildSubmitInput(META, pieces);
    expect(input.slug).toBe(META.slug);
    expect(input.pieces).toHaveLength(6);
    for (const p of input.pieces) {
      expect(p.kind).toBe('still');
      expect(p.mime).toBe('image/png');
      expect(typeof p.bytesBase64).toBe('string');
      expect(p.bytesBase64.length).toBeGreaterThan(0);
    }
  });
});
