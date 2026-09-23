/**
 * Phase 2（投稿の全員開放）のうち、Cloudflare Workers の中だけで完結できる純関数。
 * 詳細設計は docs/design-2026-09-23-phase2-open-submissions.md 。
 *
 * `sharp` や `child_process` に依存する既存の検品 (src/inspect/*.ts) は
 * Workers isolate の中では動かない (ネイティブ拡張・ファイルシステムが無い)。
 * ここに書くのは、その制約の中で「公開の関門」として実際にブロックできるものだけ。
 */

import { KINDS, type Kind, assertPublishableGenerator } from './generators.js';
import { checkPrompt } from './prompt-gate.js';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ------------------------------------------------------- ゲート1・2 (軽量版: PNG限定)

export interface PngHeader {
  width: number;
  height: number;
  /** IHDR の color type。0=グレースケール 2=RGB 3=パレット 4=グレースケール+アルファ 6=RGBA */
  colorType: number;
  hasAlphaChannel: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * PNGファイルの先頭バイトだけを読んで幅・高さ・アルファチャンネルの有無を得る。
 * `sharp` を使わない (Workersで動かないため)。IHDRチャンクは規格上、常に
 * シグネチャ直後の最初のチャンクとして固定位置にあるため、ストリーム全体を
 * デコードする必要が無い。
 *
 * 「実際に透けている画素があるか」(hasRealAlpha 相当) は画素を全走査しないと
 * 分からず、ファイルサイズ次第でWorkerのCPU時間内に終わる保証が無いため見送る。
 * ここで判定するのは「アルファチャンネルという入れ物を持っているか」だけ。
 */
export function parsePngHeader(bytes: Uint8Array): PngHeader | null {
  if (bytes.length < 33) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  // IHDR: [length(4)][type(4)="IHDR"][width(4)][height(4)][bitDepth(1)][colorType(1)]...
  const typeBytes = [bytes[12], bytes[13], bytes[14], bytes[15]];
  if (typeBytes.some((b) => b === undefined)) return null;
  const type = String.fromCharCode(...(typeBytes as number[]));
  if (type !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const colorType = bytes[25];
  if (colorType === undefined) return null;
  const hasAlphaChannel = colorType === 4 || colorType === 6;
  return { width, height, colorType, hasAlphaChannel };
}

export interface ImageGateResult {
  ok: boolean;
  reason?: string;
  header?: PngHeader;
}

export const MIN_LONG_EDGE = 1024; // 運営投稿(既定2048)より緩める。一般投稿の敷居を下げるため

/** ゲート1・2の軽量版。
 *
 * セキュリティ点検 (本体・2026-09-23) の指摘で修正: 以前は `mime !== 'image/png'`
 * (クライアントの自己申告) の場合を無条件に通していた。これは `mime: "image/jpeg"`
 * 等と偽るだけで、中身が何であっても (実行ファイル・スクリプト・任意のバイト列でも)
 * 一切検査されずに公開されてしまう抜け道だった。
 *
 * 「画像はヘッダの実物（マジックバイト）で種類を判定する」の方針に合わせ、`mime` は
 * 一切信用せず、実バイト列が PNG として読めるかどうかだけで判定する。Phase 2 は
 * PNG のみ対応のため、PNG として読めないものは mime の値に関わらず全て拒否する。 */
export function checkImageGateLite(bytes: Uint8Array, _mime: string, alphaRequired: boolean): ImageGateResult {
  const header = parsePngHeader(bytes);
  if (!header) {
    return { ok: false, reason: 'PNG画像として読み取れませんでした (現在はPNGのみ対応。申告のmimeは信用しません)' };
  }
  if (header.width < MIN_LONG_EDGE && header.height < MIN_LONG_EDGE) {
    return { ok: false, reason: `解像度が小さすぎます (長辺${MIN_LONG_EDGE}px以上・実測${header.width}x${header.height})`, header };
  }
  if (alphaRequired && !header.hasAlphaChannel) {
    return { ok: false, reason: '透過PNGとして申告されていますが、アルファチャンネルがありません', header };
  }
  return { ok: true, header };
}

// ------------------------------------------------------- 同意・申告

export interface ConsentRecord {
  termsVersion: string;
  licenseVersion: string;
  agreedAt: string;
  rightsAttestation: boolean;
  depictsPersonDeclared: boolean;
  generatorDeclared: { service: string; model: string; version: string };
}

export function validateConsent(c: unknown): { ok: true; consent: ConsentRecord } | { ok: false; reason: string } {
  if (typeof c !== 'object' || c === null) return { ok: false, reason: '同意情報がありません' };
  const r = c as Record<string, unknown>;
  if (typeof r.termsVersion !== 'string' || !r.termsVersion) return { ok: false, reason: 'termsVersion が無効です' };
  if (typeof r.licenseVersion !== 'string' || !r.licenseVersion) return { ok: false, reason: 'licenseVersion が無効です' };
  if (typeof r.agreedAt !== 'string' || Number.isNaN(Date.parse(r.agreedAt))) {
    return { ok: false, reason: 'agreedAt が無効です' };
  }
  if (r.rightsAttestation !== true) {
    return { ok: false, reason: '権利表明（自分に権利があること）への同意が必要です' };
  }
  if (r.depictsPersonDeclared !== false) {
    return { ok: false, reason: 'KAKERAは人物を含む素材を扱いません（depictsPersonDeclared は false のみ許可）' };
  }
  const g = r.generatorDeclared;
  if (typeof g !== 'object' || g === null) return { ok: false, reason: 'generatorDeclared が無効です' };
  const gr = g as Record<string, unknown>;
  if (typeof gr.service !== 'string' || typeof gr.model !== 'string' || typeof gr.version !== 'string') {
    return { ok: false, reason: 'generatorDeclared の形式が不正です' };
  }
  return {
    ok: true,
    consent: {
      termsVersion: r.termsVersion,
      licenseVersion: r.licenseVersion,
      agreedAt: r.agreedAt,
      rightsAttestation: true,
      depictsPersonDeclared: false,
      generatorDeclared: { service: gr.service, model: gr.model, version: gr.version },
    },
  };
}

// ------------------------------------------------------- 投稿ペイロードの検証

export interface CommunityPieceInput {
  id: string;
  kind: Kind;
  mime: string;
  bytesBase64: string;
  prompt: string;
  alpha: boolean;
}

export interface CommunitySeriesInput {
  slug: string;
  title: string;
  description: string;
  tone: { light: string; colorTemp: string; framing: string; texture: string };
  creatorHandle: string;
  consent: unknown;
  pieces: CommunityPieceInput[];
}

export interface ValidationIssue {
  gate: string;
  reason: string;
}

/** 公開の関門をすべて順に通す。1つでも失敗したら即座に理由を返す (それ以降は評価しない)。
 * すべて通れば { ok: true, consent } を返す。R2/D1への書き込みは呼び出し側の責務。 */
export function runSubmissionGates(
  input: CommunitySeriesInput,
  pieceBytes: Map<string, Uint8Array>,
): { ok: true; consent: ConsentRecord } | { ok: false; issue: ValidationIssue } {
  // gate: schema
  if (!SLUG.test(input.slug)) return { ok: false, issue: { gate: 'schema', reason: 'slugの形式が不正です' } };
  if (!input.title.trim()) return { ok: false, issue: { gate: 'schema', reason: 'titleが空です' } };
  if (input.pieces.length < 6 || input.pieces.length > 12) {
    return { ok: false, issue: { gate: 'schema', reason: 'シリーズは6〜12点で投稿してください' } };
  }
  if (!/^@[a-z0-9_]+$/.test(input.creatorHandle)) {
    return { ok: false, issue: { gate: 'schema', reason: 'creatorHandle の形式が不正です (例: @your_name)' } };
  }
  // セキュリティ点検 (本体・2026-09-23) の指摘: piece.id がここまで形式検査されておらず、
  // R2キー `community/<seriesId>/<piece.id>` へそのまま使われていた (利用者の文字列を
  // パスへ直接使う危険なパターン)。ここで許可リスト (SLUGと同じ形) に強制する。
  // "../" や "/" を含む id・制御文字・極端に長い文字列はここで弾かれる。
  const seenIds = new Set<string>();
  for (const p of input.pieces) {
    if (!SLUG.test(p.id)) {
      return { ok: false, issue: { gate: 'schema', reason: `piece id の形式が不正です: ${JSON.stringify(p.id).slice(0, 80)}` } };
    }
    if (seenIds.has(p.id)) {
      return { ok: false, issue: { gate: 'schema', reason: `piece id が重複しています: ${p.id}` } };
    }
    seenIds.add(p.id);
    // Phase 2 は静止画のみ対応。'loop'/'se'/'bgm' には内容検査 (checkImageGateLite相当) が
    // 無く、生成元格付け・プロンプト禁止語だけでは中身が何であれ通ってしまうため、
    // 検査が揃っている 'still' 以外は明示的に拒否する。
    if (p.kind !== 'still') {
      return { ok: false, issue: { gate: 'schema', reason: `Phase 2 は静止画 (still) のみ対応です: ${p.id} の kind=${p.kind}` } };
    }
  }

  // gate: 同意
  const consentResult = validateConsent(input.consent);
  if (!consentResult.ok) return { ok: false, issue: { gate: 'consent', reason: consentResult.reason } };
  const { consent } = consentResult;

  // gate6: 生成元格付け (既存コードをそのまま使う)
  for (const p of input.pieces) {
    try {
      assertPublishableGenerator(consent.generatorDeclared.service, p.kind);
    } catch (e) {
      return { ok: false, issue: { gate: 'generator', reason: e instanceof Error ? e.message : String(e) } };
    }
    if (!KINDS.includes(p.kind)) {
      return { ok: false, issue: { gate: 'schema', reason: `不明な種別: ${p.kind}` } };
    }
  }

  // gate7: プロンプト禁止語検査 (既存コードをそのまま使う)
  for (const p of input.pieces) {
    const violations = checkPrompt(p.prompt);
    if (violations.length > 0) {
      return {
        ok: false,
        issue: {
          gate: 'prompt',
          reason: `プロンプトに投稿できない語が含まれています (${p.id}): ${violations.map((v) => v.matched).join(', ')}`,
        },
      };
    }
  }

  // gate1・2 軽量版
  for (const p of input.pieces) {
    const bytes = pieceBytes.get(p.id);
    if (!bytes) return { ok: false, issue: { gate: 'image', reason: `${p.id} のファイルが受信できていません` } };
    const r = checkImageGateLite(bytes, p.mime, p.alpha);
    if (!r.ok) return { ok: false, issue: { gate: 'image', reason: `${p.id}: ${r.reason}` } };
  }

  return { ok: true, consent };
}

// ------------------------------------------------------- いたずら対策 (回数制限)

export const SUBMIT_DAILY_LIMIT = 5;

/** D1のクエリ結果 (今日の件数) を受け取って判定するだけの純関数。
 * カウント自体 (INSERT) は呼び出し側 (Worker) が D1 に対して行う。 */
export function checkSubmissionRateLimit(todayCount: number): { ok: boolean; reason?: string } {
  if (todayCount >= SUBMIT_DAILY_LIMIT) {
    return { ok: false, reason: `1日の投稿上限 (${SUBMIT_DAILY_LIMIT}シリーズ) に達しています。明日また投稿してください` };
  }
  return { ok: true };
}
