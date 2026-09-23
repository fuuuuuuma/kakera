/**
 * Phase 2: 投稿の全員開放。/api/submit・/api/report・/api/admin/* のハンドラ。
 * 設計: docs/design-2026-09-23-phase2-open-submissions.md
 *
 * テストしやすさのため、D1・R2・Workers AI・Turnstile検証への実際のI/Oは
 * `SubmitDeps` インターフェース越しに呼ぶ。本物の bindings (Env) から
 * `depsFromEnv()` で作る。テストは偽物の deps を直接渡す。
 */
import { hashIp, dayKey } from './index.js';
import {
  runSubmissionGates,
  checkSubmissionRateLimit,
  type CommunitySeriesInput,
} from '../catalog/community.js';

export interface SubmitDeps {
  now(): Date;
  randomId(): string;
  /** 今日この IP が何件投稿済みか */
  countSubmissionsToday(ipHash: string, day: string): Promise<number>;
  /** 投稿回数を1増やす (INSERT OR UPDATE) */
  incrementSubmissionCount(ipHash: string, day: string): Promise<void>;
  /** Cloudflare Turnstile のトークンを検証する。実装は siteverify を叩く */
  verifyTurnstile(token: string, ip: string): Promise<boolean>;
  /** そのslugが既に使われているか (community_series.slug は UNIQUE)。
   * セキュリティ点検 (本体・2026-09-23) の副作用対策: 以前はslug重複時、
   * insertSeriesのD1制約違反がハンドラの外まで例外として飛び、挙動が未定義だった。
   * 今回追加した最上位try/catchのおかげで「500だけ返して非公開」までは保証されたが、
   * 二人が同じslugを選んだだけの通常のケースを内部エラー扱いにするのは不親切なため、
   * 書き込み前に明示チェックして 409 で分かりやすく返す。 */
  slugExists(slug: string): Promise<boolean>;
  /** AIによる不適切画像の一次チェック。true = 問題あり(投稿を止める)。
   * 判定できない場合は「保留」として true 寄り (安全側) を返す実装にする。
   * 呼び出し側 (handleSubmit) もタイムアウトで包み、ハングしても安全側に倒す。 */
  moderateImage(bytes: Uint8Array, mime: string): Promise<{ flagged: boolean; detail: string }>;
  /** R2への書き込み */
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** D1への書き込み (シリーズ+ピース) */
  insertSeries(row: {
    id: string;
    slug: string;
    title: string;
    description: string;
    tone: { light: string; colorTemp: string; framing: string; texture: string };
    creatorHandle: string;
    generator: { service: string; model: string; version: string };
    consentJson: string;
    ipHash: string;
    createdAt: string;
  }): Promise<void>;
  insertPiece(row: {
    id: string;
    seriesId: string;
    kind: string;
    r2Key: string;
    bytes: number;
    mime: string;
    sha256: string;
    prompt: string;
    alpha: boolean;
    hasAlphaChannel: boolean;
    createdAt: string;
  }): Promise<void>;
}

// セキュリティ点検 (本体・2026-09-23) resource-exhaustion 対策の上限。
// MAX_PIECES_HARD_CAP: schemaゲート本来の上限は12だが、デコード前の早期リジェクト用に
// 少し緩く (413を返すだけの軽い判定にするため、ここでは「話にならない量」だけ弾く)。
export const MAX_PIECES_HARD_CAP = 30;
// 2048x2048のPNG (Phase2の既定生成サイズ) は通常数MB。透過や複雑な絵柄でも大きく
// 超えることは想定しにくいため、余裕を持たせつつ上限を切る (20MB相当のbase64文字数)。
export const MAX_PIECE_BASE64_CHARS = 28_000_000; // base64は元データの約4/3。約20MB相当

// AIモデレーション呼び出しがハング/極端に遅い場合に備えたタイムアウト。ゲートを
// 全て通過した後の最後の関門なので、ここが詰まると投稿全体が詰まるだけで
// 誤って公開されることは無いが (呼び出し側はcatchでflagged:true)、無応答のまま
// Workerの実行時間を食い潰すのを避けるため明示的に切る。
export const MODERATION_TIMEOUT_MS = 20_000;

/** 指定ミリ秒で確実にreject するラッパー。moderateImage が内部で例外を投げない
 * (Promiseが解決しない) 実装だった場合でも、ここで強制的に失敗させ、呼び出し側の
 * catch (flagged:true) へ倒す。「判定できない＝不合格」を呼び出し側の実装に
 * 依存させないための最後の砦。 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}がタイムアウトしました (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // digest() は ArrayBuffer 限定 (SharedArrayBuffer不可) なので、確実に
  // 素の ArrayBuffer を持つコピーを作ってから渡す。
  const copy = bytes.slice();
  const buf = await crypto.subtle.digest('SHA-256', copy.buffer as ArrayBuffer);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface SubmitRequestBody {
  slug: string;
  title: string;
  description: string;
  tone: { light: string; colorTemp: string; framing: string; texture: string };
  creatorHandle: string;
  consent: unknown;
  turnstileToken?: string;
  pieces: {
    id: string;
    kind: string;
    mime: string;
    bytesBase64: string;
    prompt: string;
    alpha: boolean;
  }[];
}

export interface SubmitResult {
  status: number;
  body: { ok: boolean; error?: string; gate?: string; seriesId?: string; flagged?: { gate: string; detail: string }[] };
}

/** 投稿の本体。全ゲートを一本道で通し、通った後にだけ R2/D1 へ書く
 * (「検品を迂回されない作り」の担保。クライアント申告は一切信用しない)。 */
export async function handleSubmit(
  body: unknown,
  ip: string,
  deps: SubmitDeps,
  opts: {
    requireTurnstile: boolean;
    /** `x-admin-token` が ADMIN_TOKEN と一致した投稿。運営者の投稿を素早く棚に並べるため、
     * 「1日5シリーズ」の IP 上限（いたずら対策）だけを免除する。schema・同意・生成元格付け・
     * プロンプト禁止語・画像ゲート・AIモデレーションはこれまでどおり全件に適用し、免除しない
     * （運営者の投稿だからといって検品を迂回できてしまうと、投稿API自体の「迂回されない作り」
     * が崩れるため）。呼び出し元 (index.ts) が checkAdminAuth で判定してから渡す。 */
    isAdmin?: boolean;
  },
): Promise<SubmitResult> {
  if (typeof body !== 'object' || body === null) {
    return { status: 400, body: { ok: false, error: 'リクエストの形式が不正です' } };
  }
  const b = body as Partial<SubmitRequestBody>;
  if (
    typeof b.slug !== 'string' ||
    typeof b.title !== 'string' ||
    typeof b.description !== 'string' ||
    typeof b.creatorHandle !== 'string' ||
    !b.tone ||
    !Array.isArray(b.pieces)
  ) {
    return { status: 400, body: { ok: false, error: '必須項目が欠けています' } };
  }

  // セキュリティ点検 (本体・2026-09-23) の指摘: 枚数・サイズの上限チェックが
  // base64デコード (重い処理) の「後」にあり、大量・巨大なpiecesを送るだけで
  // 実際に投稿が成立するかに関わらずCPU時間を消費させられた (resource-exhaustion)。
  // デコードに入る前に、まず軽い文字列長だけで弾く。
  if (b.pieces.length > MAX_PIECES_HARD_CAP) {
    return { status: 413, body: { ok: false, error: `piecesが多すぎます (最大${MAX_PIECES_HARD_CAP}件)` } };
  }
  for (const p of b.pieces) {
    const bytesBase64 = (p as { bytesBase64?: unknown } | null)?.bytesBase64;
    if (typeof bytesBase64 === 'string' && bytesBase64.length > MAX_PIECE_BASE64_CHARS) {
      return { status: 413, body: { ok: false, error: '1点あたりのファイルが大きすぎます' } };
    }
  }

  // いたずら対策: Turnstile
  if (opts.requireTurnstile) {
    if (!b.turnstileToken || !(await deps.verifyTurnstile(b.turnstileToken, ip))) {
      return { status: 403, body: { ok: false, error: 'Turnstile検証に失敗しました' } };
    }
  }

  // いたずら対策: 回数制限
  const ipHash = await hashIp(ip, 'kakera-submit');
  const day = dayKey(deps.now());
  const todayCount = await deps.countSubmissionsToday(ipHash, day);
  const rateLimit = checkSubmissionRateLimit(todayCount);
  // 運営者 (x-admin-token 一致) は「1日5シリーズ」のIP上限だけを免除する。
  // それ以外のゲート (このあとの schema/同意/生成元/プロンプト/画像/AIモデレーション) は
  // opts.isAdmin を一切参照しない — 免除するのはここだけ、という担保。
  if (!rateLimit.ok && !opts.isAdmin) {
    return { status: 429, body: { ok: false, error: rateLimit.reason } };
  }

  // ペイロード → 純関数のゲート入力へ変換
  const pieceBytes = new Map<string, Uint8Array>();
  const pieces = [];
  for (const p of b.pieces) {
    if (
      typeof p.id !== 'string' ||
      typeof p.kind !== 'string' ||
      typeof p.mime !== 'string' ||
      typeof p.bytesBase64 !== 'string' ||
      typeof p.prompt !== 'string'
    ) {
      return { status: 400, body: { ok: false, error: `piece の形式が不正です` } };
    }
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(p.bytesBase64);
    } catch {
      return { status: 400, body: { ok: false, error: `${p.id} のファイルをデコードできませんでした` } };
    }
    pieceBytes.set(p.id, bytes);
    pieces.push({
      id: p.id,
      kind: p.kind as CommunitySeriesInput['pieces'][number]['kind'],
      mime: p.mime,
      bytesBase64: p.bytesBase64,
      prompt: p.prompt,
      alpha: p.alpha === true,
    });
  }

  const input: CommunitySeriesInput = {
    slug: b.slug,
    title: b.title,
    description: b.description,
    tone: {
      light: String(b.tone.light ?? ''),
      colorTemp: String(b.tone.colorTemp ?? ''),
      framing: String(b.tone.framing ?? ''),
      texture: String(b.tone.texture ?? ''),
    },
    creatorHandle: b.creatorHandle,
    consent: b.consent,
    pieces,
  };

  // 公開の関門 (schema / consent / 生成元格付け / プロンプト禁止語 / 画像ゲート軽量版)
  const gateResult = runSubmissionGates(input, pieceBytes);
  if (!gateResult.ok) {
    return { status: 422, body: { ok: false, error: gateResult.issue.reason, gate: gateResult.issue.gate } };
  }
  const { consent } = gateResult;

  // slugの重複は「不正な入力」ではなく普通に起こり得るケースなので、AIモデレーション
  // (時間のかかる処理) の前に軽いD1参照で弾き、分かりやすい409を返す。
  if (await deps.slugExists(input.slug)) {
    return { status: 409, body: { ok: false, error: `このslugは既に使われています: ${input.slug}`, gate: 'slug-taken' } };
  }

  // AIによる不適切画像の一次チェック (同期・ブロッキング)。
  // セキュリティ点検 (本体・2026-09-23) moderation-fail-open 対策:
  // deps.moderateImage 自身の実装 (submitDepsFromEnv) は例外時に flagged:true を返す
  // ようにしてあるが、それを実装側の善意に依存させず、この呼び出し側でも
  // タイムアウト+try/catchで包み、「判定できない＝不合格」を機械的に強制する。
  for (const p of input.pieces) {
    const bytes = pieceBytes.get(p.id);
    if (!bytes) continue;
    let mod: { flagged: boolean; detail: string };
    try {
      mod = await withTimeout(deps.moderateImage(bytes, p.mime), MODERATION_TIMEOUT_MS, 'AIモデレーション');
    } catch (e) {
      mod = { flagged: true, detail: e instanceof Error ? e.message : String(e) };
    }
    if (mod.flagged) {
      return {
        status: 422,
        body: { ok: false, error: `AIモデレーションで保留されました (${p.id}): ${mod.detail}`, gate: 'ai-moderation' },
      };
    }
  }

  // ここまで全部通った。回数を先に加算してから書き込む (書き込み失敗時に枠だけ消費するのは許容:
  // 悪用防止を優先し、失敗しても再試行で枠を使い切らせない方向にはしない)
  await deps.incrementSubmissionCount(ipHash, day);

  const now = deps.now();
  const createdAt = now.toISOString();
  const seriesId = deps.randomId();

  await deps.insertSeries({
    id: seriesId,
    slug: input.slug,
    title: input.title,
    description: input.description,
    tone: input.tone,
    creatorHandle: input.creatorHandle,
    generator: consent.generatorDeclared,
    consentJson: JSON.stringify(consent),
    ipHash,
    createdAt,
  });

  for (const p of input.pieces) {
    const bytes = pieceBytes.get(p.id);
    if (!bytes) continue;
    const sha = await sha256Hex(bytes);
    const r2Key = `community/${seriesId}/${p.id}`;
    // セキュリティ点検 (本体・2026-09-23) の指摘: R2へ保存するcontentTypeは
    // クライアント申告の p.mime ではなく、runSubmissionGates (checkImageGateLite) が
    // 実バイト列から確認した種別を使う。ここまで到達した時点でPhase 2はPNGのみ
    // 通しているため、常に 'image/png' で固定できる (p.mimeを信用しない)。
    await deps.putObject(r2Key, bytes, 'image/png');
    const hasAlphaChannel = p.alpha;
    await deps.insertPiece({
      id: p.id,
      seriesId,
      kind: p.kind,
      r2Key,
      bytes: bytes.length,
      mime: 'image/png',
      sha256: sha,
      prompt: p.prompt,
      alpha: p.alpha,
      hasAlphaChannel,
      createdAt,
    });
  }

  return { status: 201, body: { ok: true, seriesId } };
}

// ------------------------------------------------------- 通報・取り下げ

// セキュリティ点検 (本体・2026-09-23) の指摘: handleSubmit には回数制限があるのに
// handleReport には無く、無認証のまま /api/report を連打できた (resource-exhaustion /
// 4件目の指摘)。同じ仕組み (ip_hash + day で数える) を通報にも適用する。
// 通報は投稿より軽い行為なので、投稿 (SUBMIT_DAILY_LIMIT=5) より少し緩めにする。
export const REPORT_DAILY_LIMIT = 20;
export const MAX_REPORT_REASON_CHARS = 2000;
export const MAX_REPORT_CONTACT_CHARS = 200;

export interface ReportDeps {
  now(): Date;
  randomId(): string;
  /** 今日この IP が何件通報済みか (submission_event と同じ表を day='report:<日付>' で共用) */
  countReportsToday(ipHash: string, day: string): Promise<number>;
  incrementReportCount(ipHash: string, day: string): Promise<void>;
  insertReport(row: { id: string; targetType: string; targetId: string; reason: string; contact: string | null; createdAt: string }): Promise<void>;
}

export interface ReportRequestBody {
  targetType: string;
  targetId: string;
  reason: string;
  contact?: string;
}

export async function handleReport(body: unknown, ip: string, deps: ReportDeps): Promise<SubmitResult> {
  if (typeof body !== 'object' || body === null) {
    return { status: 400, body: { ok: false, error: 'リクエストの形式が不正です' } };
  }
  const b = body as Partial<ReportRequestBody>;
  if (typeof b.targetType !== 'string' || typeof b.targetId !== 'string' || typeof b.reason !== 'string' || !b.reason.trim()) {
    return { status: 400, body: { ok: false, error: '必須項目が欠けています (targetType, targetId, reason)' } };
  }
  if (b.reason.length > MAX_REPORT_REASON_CHARS) {
    return { status: 413, body: { ok: false, error: `理由が長すぎます (最大${MAX_REPORT_REASON_CHARS}文字)` } };
  }
  if (typeof b.contact === 'string' && b.contact.length > MAX_REPORT_CONTACT_CHARS) {
    return { status: 413, body: { ok: false, error: `連絡先が長すぎます (最大${MAX_REPORT_CONTACT_CHARS}文字)` } };
  }

  const ipHash = await hashIp(ip, 'kakera-report');
  const day = `report:${dayKey(deps.now())}`;
  const todayCount = await deps.countReportsToday(ipHash, day);
  if (todayCount >= REPORT_DAILY_LIMIT) {
    return { status: 429, body: { ok: false, error: `1日の通報上限 (${REPORT_DAILY_LIMIT}件) に達しています` } };
  }
  await deps.incrementReportCount(ipHash, day);

  const id = deps.randomId();
  await deps.insertReport({
    id,
    targetType: b.targetType,
    targetId: b.targetId,
    reason: b.reason,
    contact: typeof b.contact === 'string' && b.contact ? b.contact : null,
    createdAt: deps.now().toISOString(),
  });
  return { status: 201, body: { ok: true, seriesId: id } };
}

// ------------------------------------------------------- 管理 (取り下げの承認)

export interface AdminDeps {
  listPendingReports(): Promise<{ id: string; targetType: string; targetId: string; reason: string; createdAt: string }[]>;
  listUnresolvedFlags(): Promise<{ id: string; seriesId: string; gate: string; severity: string; detail: string }[]>;
  approveTakedown(targetId: string): Promise<void>;
  rejectReport(reportId: string): Promise<void>;
}

/** 文字列ごとの長さで早期returnせず、常に同じ処理量で比較する (タイミング攻撃対策)。
 * セキュリティ点検 (本体・2026-09-23) の指摘: `===` は不一致箇所によって比較の
 * 打ち切りタイミングが変わり得る。管理者トークンという単一の認証手段なので、
 * 定数時間比較にしておく。 */
function timingSafeEqual(a: string, b: string): boolean {
  // 長さが違う時点で不一致なのは確定だが、「即returnせず両方を最後まで舐める」ことで
  // 長さ起因のタイミング差だけは残る (実務上は許容範囲。文字数を秘匿する要件は無い)。
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

export function checkAdminAuth(headerToken: string | null, adminToken: string): boolean {
  if (!adminToken || headerToken === null) return false;
  return timingSafeEqual(headerToken, adminToken);
}
