import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import {
  handleSubmit, handleReport, checkAdminAuth, withTimeout,
  MAX_PIECES_HARD_CAP, MAX_PIECE_BASE64_CHARS,
  type SubmitDeps, type ReportDeps,
} from '../src/worker/submit.js';

async function pngBase64(opts: { width: number; height: number; alpha: boolean }): Promise<string> {
  const buf = await sharp({
    create: {
      width: opts.width,
      height: opts.height,
      channels: opts.alpha ? 4 : 3,
      background: opts.alpha ? { r: 10, g: 10, b: 10, alpha: 0 } : { r: 10, g: 10, b: 10 },
    },
  })
    .png()
    .toBuffer();
  return buf.toString('base64');
}

const VALID_CONSENT = {
  termsVersion: '2026-09-23',
  licenseVersion: 'kakera-free-v1',
  agreedAt: '2026-09-23T00:00:00Z',
  rightsAttestation: true,
  depictsPersonDeclared: false,
  generatorDeclared: { service: 'openai-imagegen', model: 'codex-cli', version: '0.154.0' },
};

async function validBody() {
  const b64 = await pngBase64({ width: 1920, height: 1080, alpha: false });
  const pieces = Array.from({ length: 6 }, (_, i) => ({
    id: `piece-${i + 1}`,
    kind: 'still',
    mime: 'image/png',
    bytesBase64: b64,
    prompt: `落ち着いたオフィス、朝の光 ${i + 1}`,
    alpha: false,
  }));
  return {
    slug: 'test-series',
    title: 'テストシリーズ',
    description: '説明',
    tone: { light: '朝', colorTemp: '暖色', framing: '広め', texture: 'マット' },
    creatorHandle: '@tester',
    consent: VALID_CONSENT,
    turnstileToken: 'fake-token',
    pieces,
  };
}

function makeDeps(overrides: Partial<SubmitDeps> = {}): SubmitDeps & {
  puts: { key: string; bytes: Uint8Array; contentType: string }[];
  seriesRows: unknown[];
  pieceRows: unknown[];
} {
  const puts: { key: string; bytes: Uint8Array; contentType: string }[] = [];
  const seriesRows: unknown[] = [];
  const pieceRows: unknown[] = [];
  return {
    now: () => new Date('2026-09-23T12:00:00Z'),
    randomId: () => 'fixed-id-001',
    countSubmissionsToday: vi.fn(async () => 0),
    incrementSubmissionCount: vi.fn(async () => {}),
    verifyTurnstile: vi.fn(async () => true),
    slugExists: vi.fn(async () => false),
    moderateImage: vi.fn(async () => ({ flagged: false, detail: '' })),
    putObject: vi.fn(async (key: string, bytes: Uint8Array, contentType: string) => {
      puts.push({ key, bytes, contentType });
    }),
    insertSeries: vi.fn(async (row) => {
      seriesRows.push(row);
    }),
    insertPiece: vi.fn(async (row) => {
      pieceRows.push(row);
    }),
    puts,
    seriesRows,
    pieceRows,
    ...overrides,
  };
}

describe('handleSubmit', () => {
  it('全て正しければ201で受理し、R2とD1へ書く', async () => {
    const deps = makeDeps();
    const r = await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(deps.puts.length).toBe(6);
    expect(deps.seriesRows.length).toBe(1);
    expect(deps.pieceRows.length).toBe(6);
    expect(deps.incrementSubmissionCount).toHaveBeenCalledTimes(1);
  });

  it('Turnstile検証に失敗したら403で、R2/D1には一切書かない (実送信しない・押すまで送らないの担保)', async () => {
    const deps = makeDeps({ verifyTurnstile: vi.fn(async () => false) });
    const r = await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(403);
    expect(deps.puts.length).toBe(0);
    expect(deps.seriesRows.length).toBe(0);
  });

  it('requireTurnstile=false なら token 無しでも通る (開発・テスト用)', async () => {
    const deps = makeDeps();
    const body = await validBody();
    delete (body as { turnstileToken?: string }).turnstileToken;
    const r = await handleSubmit(body, '1.2.3.4', deps, { requireTurnstile: false });
    expect(r.status).toBe(201);
  });

  it('1日の投稿上限に達していたら429で、何も書かない', async () => {
    const deps = makeDeps({ countSubmissionsToday: vi.fn(async () => 5) });
    const r = await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(429);
    expect(deps.puts.length).toBe(0);
  });

  it('公開の関門 (ゲート) に落ちたら422で、何も書かない', async () => {
    const deps = makeDeps();
    const body = await validBody();
    body.consent = { ...VALID_CONSENT, generatorDeclared: { service: 'grok', model: 'x', version: '1' } };
    const r = await handleSubmit(body, '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(422);
    expect(r.body.gate).toBe('generator');
    expect(deps.puts.length).toBe(0);
    expect(deps.seriesRows.length).toBe(0);
    // ゲートに落ちた時点で回数制限の枠も消費しない
    expect(deps.incrementSubmissionCount).not.toHaveBeenCalled();
  });

  it('slugが既に使われていれば409で、何も書かない (advisor指摘: 二人が同じslugを選んだだけの通常ケースを500にしない)', async () => {
    const deps = makeDeps({ slugExists: vi.fn(async () => true) });
    const r = await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(409);
    expect(r.body.gate).toBe('slug-taken');
    expect(deps.puts.length).toBe(0);
    expect(deps.seriesRows.length).toBe(0);
    expect(deps.moderateImage).not.toHaveBeenCalled();
  });

  it('AIモデレーションでflaggedなら422で公開しない (ゲート通過後でも止める)', async () => {
    const deps = makeDeps({ moderateImage: vi.fn(async () => ({ flagged: true, detail: '暴力的な表現の疑い' })) });
    const r = await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(422);
    expect(r.body.gate).toBe('ai-moderation');
    expect(deps.puts.length).toBe(0);
    expect(deps.seriesRows.length).toBe(0);
  });

  it('R2キーは community/<seriesId>/<pieceId> の形式', async () => {
    const deps = makeDeps();
    await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true });
    expect(deps.puts[0]?.key).toBe('community/fixed-id-001/piece-1');
  });

  it('必須項目が欠けていれば400', async () => {
    const deps = makeDeps();
    const body = await validBody();
    // @ts-expect-error -- 意図的に欠落させる
    delete body.slug;
    const r = await handleSubmit(body, '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(400);
  });

  // ---- セキュリティ点検 (本体・2026-09-23) 対応の回帰テスト ----

  it('piecesが多すぎればデコード前に413で拒否する (resource-exhaustion対策)', async () => {
    const deps = makeDeps();
    const body = await validBody();
    body.pieces = Array.from({ length: MAX_PIECES_HARD_CAP + 1 }, (_, i) => ({
      id: `piece-${i + 1}`, kind: 'still', mime: 'image/png', bytesBase64: '', prompt: 'x', alpha: false,
    }));
    const r = await handleSubmit(body, '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(413);
    expect(deps.puts.length).toBe(0);
    // デコード処理 (moderateImage等) に一切到達していないことも確認する
    expect(deps.moderateImage).not.toHaveBeenCalled();
  });

  it('1点のbase64が大きすぎればデコード前に413で拒否する (resource-exhaustion対策)', async () => {
    const deps = makeDeps();
    const body = await validBody();
    const first = body.pieces[0];
    if (!first) throw new Error('test setup error');
    first.bytesBase64 = 'A'.repeat(MAX_PIECE_BASE64_CHARS + 1);
    const r = await handleSubmit(body, '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(413);
    expect(deps.puts.length).toBe(0);
  });

  it('piece.id がパス文字列 (../ 等) なら schema ゲートで落ち、R2へは一切書かない', async () => {
    const deps = makeDeps();
    const body = await validBody();
    const first = body.pieces[0];
    if (!first) throw new Error('test setup error');
    first.id = '../../other-series/piece-1';
    const r = await handleSubmit(body, '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(422);
    expect(r.body.gate).toBe('schema');
    expect(deps.puts.length).toBe(0);
  });

  it('piece.id が重複していれば schema ゲートで落ちる', async () => {
    const deps = makeDeps();
    const body = await validBody();
    body.pieces[1]!.id = body.pieces[0]!.id;
    const r = await handleSubmit(body, '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(422);
    expect(r.body.gate).toBe('schema');
    expect(deps.puts.length).toBe(0);
  });

  it('kindが still 以外 (loop等) なら拒否する (Phase2は静止画の検品しか無いため)', async () => {
    const deps = makeDeps();
    const body = await validBody();
    body.pieces[0]!.kind = 'loop';
    const r = await handleSubmit(body, '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(422);
    expect(r.body.gate).toBe('schema');
    expect(deps.puts.length).toBe(0);
  });

  it('mimeを偽ってPNG以外のバイト列を送っても、実バイト列で判定して拒否する (mimeスプーフィング対策)', async () => {
    const deps = makeDeps();
    const body = await validBody();
    const first = body.pieces[0];
    if (!first) throw new Error('test setup error');
    // PNGではない中身 (例: 任意のテキスト) を、mimeだけ image/png のまま送る想定の逆
    // (ここでは mime を image/jpeg と偽りつつ、実際は image/png のバイト列を送る —
    // 以前の実装なら「mime!=png だから素通し」で不正な非PNGバイト列も通っていた経路を、
    // 「実バイト列で判定」であることを確認する形で検証する: 中身を壊れたバイト列にする)
    first.bytesBase64 = Buffer.from('<script>alert(1)</script> not a png').toString('base64');
    const r = await handleSubmit(body, '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(422);
    expect(r.body.gate).toBe('image');
    expect(deps.puts.length).toBe(0);
  });

  it('保存時のcontentTypeはクライアント申告のmimeではなく常にimage/pngを使う', async () => {
    const deps = makeDeps();
    const body = await validBody();
    // クライアントは image/jpeg と偽って申告するが、実バイト列は正しいPNG
    body.pieces.forEach((p: { mime: string }) => { p.mime = 'image/jpeg'; });
    const r = await handleSubmit(body, '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(201);
    for (const put of deps.puts) expect(put.contentType).toBe('image/png');
  });

  it('AIモデレーションが例外を投げても (実装のバグを想定) 保留扱いにして公開しない', async () => {
    const deps = makeDeps({ moderateImage: vi.fn(async () => { throw new Error('boom'); }) });
    const r = await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(422);
    expect(r.body.gate).toBe('ai-moderation');
    expect(deps.puts.length).toBe(0);
  });

  // withTimeout自体はここで直接 (短い実時間で) 検証する。handleSubmit全体を
  // fakeTimersで動かすと複数awaitの間でタイマー登録タイミングが揺れて不安定になるため、
  // 「呼び出し側がハングしたAI呼び出しをタイムアウトさせ、必ずrejectする」という
  // 契約そのものをこの単体テストで固定する (handleSubmit側は例外時にflagged:trueへ倒す
  // ことを上の「AIモデレーションが例外を投げても」で別途検証済み)。
  it('withTimeout: 解決しないPromiseを渡すと指定ミリ秒でrejectする', async () => {
    await expect(withTimeout(new Promise(() => {}), 30, 'テスト')).rejects.toThrow(/タイムアウト/);
  });

  it('withTimeout: 先に解決すればそのまま解決する', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'テスト')).resolves.toBe('ok');
  });

  it('withTimeout: 先に失敗すればそのまま失敗する', async () => {
    await expect(withTimeout(Promise.reject(new Error('元の失敗')), 1000, 'テスト')).rejects.toThrow('元の失敗');
  });

  // ---- 運営者の上限回避 (x-admin-token) ----

  it('isAdmin=true なら1日の投稿上限に達していても201で通る (上限だけ免除)', async () => {
    const deps = makeDeps({ countSubmissionsToday: vi.fn(async () => 5) });
    const r = await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true, isAdmin: true });
    expect(r.status).toBe(201);
    expect(deps.seriesRows.length).toBe(1);
  });

  it('isAdmin=false (既定) なら上限到達で従来どおり429', async () => {
    const deps = makeDeps({ countSubmissionsToday: vi.fn(async () => 5) });
    const r = await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true });
    expect(r.status).toBe(429);
  });

  it('isAdmin=true でも生成元格付けゲートは免除しない (免除は上限だけ)', async () => {
    const deps = makeDeps({ countSubmissionsToday: vi.fn(async () => 5) });
    const body = await validBody();
    body.consent = { ...VALID_CONSENT, generatorDeclared: { service: 'grok', model: 'x', version: '1' } };
    const r = await handleSubmit(body, '1.2.3.4', deps, { requireTurnstile: true, isAdmin: true });
    expect(r.status).toBe(422);
    expect(r.body.gate).toBe('generator');
    expect(deps.puts.length).toBe(0);
  });

  it('isAdmin=true でもAIモデレーションで保留なら公開しない (免除は上限だけ)', async () => {
    const deps = makeDeps({
      countSubmissionsToday: vi.fn(async () => 5),
      moderateImage: vi.fn(async () => ({ flagged: true, detail: '疑いあり' })),
    });
    const r = await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true, isAdmin: true });
    expect(r.status).toBe(422);
    expect(r.body.gate).toBe('ai-moderation');
    expect(deps.puts.length).toBe(0);
  });

  it('isAdmin=true でもTurnstile検証は免除しない (免除は上限だけ)', async () => {
    const deps = makeDeps({ verifyTurnstile: vi.fn(async () => false) });
    const r = await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true, isAdmin: true });
    expect(r.status).toBe(403);
    expect(deps.puts.length).toBe(0);
  });

  it('isAdmin=true で上限に達していなければ通常どおり加算される (免除は「達していても通す」だけ)', async () => {
    const deps = makeDeps({ countSubmissionsToday: vi.fn(async () => 2) });
    const r = await handleSubmit(await validBody(), '1.2.3.4', deps, { requireTurnstile: true, isAdmin: true });
    expect(r.status).toBe(201);
    expect(deps.incrementSubmissionCount).toHaveBeenCalledTimes(1);
  });
});

function makeReportDeps(overrides: Partial<ReportDeps> = {}): ReportDeps & { inserted: unknown[] } {
  const inserted: unknown[] = [];
  return {
    now: () => new Date('2026-09-23T00:00:00Z'),
    randomId: () => 'report-1',
    countReportsToday: vi.fn(async () => 0),
    incrementReportCount: vi.fn(async () => {}),
    insertReport: vi.fn(async (row) => {
      inserted.push(row);
    }),
    inserted,
    ...overrides,
  };
}

describe('handleReport', () => {
  it('通報を受理する', async () => {
    const deps = makeReportDeps();
    const r = await handleReport(
      { targetType: 'community_series', targetId: 'fixed-id-001', reason: '無断使用の疑い' },
      '1.2.3.4',
      deps,
    );
    expect(r.status).toBe(201);
    expect(deps.inserted.length).toBe(1);
  });

  it('reasonが空なら400', async () => {
    const deps = makeReportDeps();
    const r = await handleReport({ targetType: 'community_series', targetId: 'x', reason: '' }, '1.2.3.4', deps);
    expect(r.status).toBe(400);
  });

  it('理由が長すぎれば413で、書き込まない (セキュリティ点検2026-09-23 resource-exhaustion対応)', async () => {
    const deps = makeReportDeps();
    const r = await handleReport(
      { targetType: 'community_series', targetId: 'x', reason: 'あ'.repeat(2001) },
      '1.2.3.4',
      deps,
    );
    expect(r.status).toBe(413);
    expect(deps.inserted.length).toBe(0);
  });

  it('1日の通報上限に達していたら429で、書き込まない', async () => {
    const deps = makeReportDeps({ countReportsToday: vi.fn(async () => 20) });
    const r = await handleReport(
      { targetType: 'community_series', targetId: 'x', reason: '通常の通報' },
      '1.2.3.4',
      deps,
    );
    expect(r.status).toBe(429);
    expect(deps.inserted.length).toBe(0);
  });
});

describe('checkAdminAuth', () => {
  it('トークンが一致すれば true', () => {
    expect(checkAdminAuth('secret-abc', 'secret-abc')).toBe(true);
  });
  it('不一致・null・未設定なら false', () => {
    expect(checkAdminAuth('wrong', 'secret-abc')).toBe(false);
    expect(checkAdminAuth(null, 'secret-abc')).toBe(false);
    expect(checkAdminAuth('secret-abc', '')).toBe(false);
  });
  it('長さが違うトークンも false (セキュリティ点検2026-09-23: 定数時間比較に変更)', () => {
    expect(checkAdminAuth('secret-abc-extra', 'secret-abc')).toBe(false);
    expect(checkAdminAuth('short', 'secret-abc')).toBe(false);
  });
});
