/**
 * KAKERA への投稿道具。PNGの入ったフォルダ（または Codex ImageGen の出力から選んだN枚）と
 * メタデータJSONから `/api/submit` の本文を組み立て、既定では**送らずに手元で検査だけ**する。
 * `--send` を付けたときだけ実際に送信する。
 *
 * 使い方:
 *   npm run submit-series -- --meta meta.json --dir ./pngs              # 検査だけ（既定）
 *   npm run submit-series -- --meta meta.json --dir ./pngs --send       # 検査OKなら送信
 *   npm run submit-series -- --meta meta.json --from-codex 9 --send     # Codex生成物から9枚選ぶ
 *   npm run submit-series -- --meta meta.json --dir ./pngs --send \
 *     --endpoint http://localhost:8787                                  # wrangler dev 等へ送る
 *
 * メタデータJSONの見本: docs/submit-series.meta.example.json
 *
 * 検査の中身は本番の投稿API (`src/worker/submit.ts`) が使うのと**同じ関門**
 * (`src/catalog/community.ts` の `runSubmissionGates`) をそのまま呼ぶ。ここだけ別の
 * 緩い基準で判定して「ローカルは通ったのにサーバーで弾かれる」を起こさないため。
 * 画像の実デコード確認 (PNGとして読めるか・長辺1024px以上か) は sharp を使う
 * (Worker 側は sharp が使えないため軽量なヘッダ解析で代替しているが、こちらは
 * Node で動く手元の道具なので sharp で確実に検証できる)。
 *
 * `KAKERA_ADMIN_TOKEN` 環境変数があれば `x-admin-token` ヘッダを付けて送る
 * （運営者は1日5シリーズの上限だけ免除される。他の検品は免除されない）。
 * 値はログに一切出さない。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import {
  runSubmissionGates,
  MIN_LONG_EDGE,
  type CommunitySeriesInput,
  type ConsentRecord,
} from '../src/catalog/community.js';

export const DEFAULT_ENDPOINT = 'https://kakera.fuuuuuuma.dev';
export const DEFAULT_TERMS_VERSION = '2026-09-23';
export const DEFAULT_LICENSE_VERSION = 'kakera-free-v1';
export const CODEX_IMAGES_DIR = join(homedir(), '.codex', 'generated_images');

// ------------------------------------------------------- メタデータの形

export interface SubmitSeriesTone {
  light: string;
  colorTemp: string;
  framing: string;
  texture: string;
}

export interface SubmitSeriesMeta {
  slug: string;
  title: string;
  description: string;
  tone: SubmitSeriesTone;
  creatorHandle: string;
  generatorDeclared: { service: string; model: string; version: string };
  /** 全点共通のプロンプト。ファイルごとの `prompts` が無ければこれを使う */
  prompt?: string;
  /** ファイル名 (拡張子込み) → 個別プロンプト。無い点は `prompt` にフォールバックする */
  prompts?: Record<string, string>;
  /** 既定のalpha (全点共通)。個別に上書きしたい場合は `alphaOverrides` */
  alpha?: boolean;
  alphaOverrides?: Record<string, boolean>;
  /** 同意情報の一部を上書きしたい場合。通常は既定値のままでよい */
  consent?: Partial<{ termsVersion: string; licenseVersion: string; agreedAt: string }>;
}

export function loadMeta(raw: unknown): SubmitSeriesMeta {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('メタデータJSONの形式が不正です（オブジェクトではありません）');
  }
  const r = raw as Record<string, unknown>;
  for (const key of ['slug', 'title', 'description', 'tone', 'creatorHandle', 'generatorDeclared']) {
    if (!(key in r)) throw new Error(`メタデータJSONに ${key} がありません`);
  }
  return raw as SubmitSeriesMeta;
}

// ------------------------------------------------------- ファイル選択

/** ファイル名から SLUG形式 (^[a-z0-9][a-z0-9-]{0,63}$) のpiece idを作る。
 * 衝突したら -2, -3 ... を足す（Codexの自動生成ファイル名は非決定的なので必要）。 */
export function slugifyId(filename: string, taken: Set<string>): string {
  const base = basename(filename, extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  const safe = /^[a-z0-9]/.test(base) ? base : `p-${base}`.slice(0, 63);
  const id = safe || 'piece';
  if (!taken.has(id)) {
    taken.add(id);
    return id;
  }
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = `${id.slice(0, 63 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** そのファイルのプロンプトを決める。個別指定 → 共通プロンプトの順で探す。無ければ null。 */
export function resolvePiecePrompt(meta: SubmitSeriesMeta, filename: string): string | null {
  const byName = meta.prompts?.[basename(filename)];
  if (typeof byName === 'string' && byName.trim()) return byName;
  if (typeof meta.prompt === 'string' && meta.prompt.trim()) return meta.prompt;
  return null;
}

function resolvePieceAlpha(meta: SubmitSeriesMeta, filename: string): boolean {
  const byName = meta.alphaOverrides?.[basename(filename)];
  if (typeof byName === 'boolean') return byName;
  return meta.alpha === true;
}

/** `--dir` で指定したフォルダ直下の .png ファイルをアルファベット順で返す（非再帰）。 */
export async function listPngsInDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.png'))
    .map((e) => join(dir, e.name))
    .sort();
}

/** Codex ImageGen の保存先 (既定 ~/.codex/generated_images) から、更新日時が新しい順に
 * N枚選ぶ。元ファイルは残るので選び直しても安全 (normalize-200-assets.ts の冒頭コメント参照)。 */
export async function selectFromCodex(n: number, dir: string = CODEX_IMAGES_DIR): Promise<string[]> {
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.png'));
  } catch (e) {
    throw new Error(
      `Codexの生成物フォルダを読めませんでした: ${dir}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
  const withStat = await Promise.all(
    entries.map(async (f) => {
      const p = join(dir, f);
      const st = await stat(p);
      return { path: p, mtimeMs: st.mtimeMs };
    }),
  );
  withStat.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (withStat.length < n) {
    throw new Error(`${dir} にPNGが${withStat.length}枚しかありません（${n}枚必要）`);
  }
  return withStat.slice(0, n).map((e) => e.path);
}

// ------------------------------------------------------- sharpでの実デコード確認

export interface SharpCheckResult {
  file: string;
  ok: boolean;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  bytes: number;
  reason?: string;
}

/** 実バイト列をsharpで開き、PNGとして読めるか・長辺が既定以上かを確認する。
 * ここでの判定はあくまで手元での早期発見用。最終判定は runSubmissionGates
 * (サーバーと同じPNGヘッダ解析) が行う。 */
export async function checkImageWithSharp(file: string, bytes: Buffer): Promise<SharpCheckResult> {
  try {
    const meta = await sharp(bytes).metadata();
    if (meta.format !== 'png') {
      return { file, ok: false, bytes: bytes.length, reason: `PNGではありません (検出形式: ${meta.format ?? '不明'})` };
    }
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (Math.max(w, h) < MIN_LONG_EDGE) {
      return { file, ok: false, width: w, height: h, bytes: bytes.length, reason: `解像度が小さすぎます (長辺${MIN_LONG_EDGE}px以上・実測${w}x${h})` };
    }
    return { file, ok: true, width: w, height: h, hasAlpha: meta.hasAlpha === true, bytes: bytes.length };
  } catch (e) {
    return { file, ok: false, bytes: bytes.length, reason: `sharpで開けませんでした: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ------------------------------------------------------- 投稿ペイロードの組み立て

export interface LoadedPiece {
  id: string;
  file: string;
  bytes: Buffer;
  prompt: string;
  alpha: boolean;
}

/** ファイル群 + メタデータから、送信対象の点を読み込んで確定させる
 * (プロンプト欠落・id重複はここで例外にする)。 */
export async function loadPieces(files: string[], meta: SubmitSeriesMeta): Promise<LoadedPiece[]> {
  const taken = new Set<string>();
  const pieces: LoadedPiece[] = [];
  for (const file of files) {
    const prompt = resolvePiecePrompt(meta, file);
    if (prompt === null) {
      throw new Error(`prompt がありません: ${file}（meta.prompts["${basename(file)}"] か meta.prompt を指定してください）`);
    }
    const bytes = await readFile(file);
    pieces.push({ id: slugifyId(file, taken), file, bytes, prompt, alpha: resolvePieceAlpha(meta, file) });
  }
  return pieces;
}

export function buildConsent(meta: SubmitSeriesMeta): ConsentRecord {
  return {
    termsVersion: meta.consent?.termsVersion ?? DEFAULT_TERMS_VERSION,
    licenseVersion: meta.consent?.licenseVersion ?? DEFAULT_LICENSE_VERSION,
    agreedAt: meta.consent?.agreedAt ?? new Date().toISOString(),
    rightsAttestation: true,
    depictsPersonDeclared: false,
    generatorDeclared: meta.generatorDeclared,
  };
}

export function buildSubmitInput(meta: SubmitSeriesMeta, pieces: LoadedPiece[]): CommunitySeriesInput {
  return {
    slug: meta.slug,
    title: meta.title,
    description: meta.description,
    tone: meta.tone,
    creatorHandle: meta.creatorHandle,
    consent: buildConsent(meta),
    pieces: pieces.map((p) => ({
      id: p.id,
      kind: 'still',
      mime: 'image/png',
      bytesBase64: p.bytes.toString('base64'),
      prompt: p.prompt,
      alpha: p.alpha,
    })),
  };
}

// ------------------------------------------------------- 検査 (本番と同じ関門)

export interface LocalCheckResult {
  ok: boolean;
  gate?: string;
  reason?: string;
  sharpResults: SharpCheckResult[];
}

/** sharpでの実デコード確認 → runSubmissionGates (本番と同じ関門) の順で検査する。
 * どちらか一方でも落ちれば ok:false。--send が付いていても、ここが ok:false なら送らない。 */
export async function runLocalChecks(meta: SubmitSeriesMeta, pieces: LoadedPiece[]): Promise<LocalCheckResult> {
  const sharpResults = await Promise.all(pieces.map((p) => checkImageWithSharp(p.file, p.bytes)));
  const firstFailed = sharpResults.find((r) => !r.ok);
  if (firstFailed) {
    return { ok: false, gate: 'image-sharp', reason: `${firstFailed.file}: ${firstFailed.reason}`, sharpResults };
  }

  const input = buildSubmitInput(meta, pieces);
  const pieceBytes = new Map(pieces.map((p) => [p.id, new Uint8Array(p.bytes)]));
  const gate = runSubmissionGates(input, pieceBytes);
  if (!gate.ok) {
    return { ok: false, gate: gate.issue.gate, reason: gate.issue.reason, sharpResults };
  }
  return { ok: true, sharpResults };
}

// ------------------------------------------------------- 送信

export interface SendResult {
  status: number;
  body: unknown;
}

/** グローバルの `fetch` (DOM lib / Workers 実行時の型) は環境によって型が微妙に異なり、
 * テストの偽物実装と噛み合わないことがある。ここで使う分だけの最小限の形に絞って、
 * その環境差から切り離す。 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<Response>;

/** `/api/submit` へ送る。fetch実装を差し替えられるようにしてある (テスト用)。
 * adminToken はヘッダに使うだけでログには一切出さない (呼び出し側も出さないこと)。 */
export async function sendSubmission(
  endpoint: string,
  meta: SubmitSeriesMeta,
  pieces: LoadedPiece[],
  adminToken: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  const input = buildSubmitInput(meta, pieces);
  const url = `${endpoint.replace(/\/+$/, '')}/api/submit`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (adminToken) headers['x-admin-token'] = adminToken;
  const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(input) });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ------------------------------------------------------- 要約表示

export function formatSummary(meta: SubmitSeriesMeta, pieces: LoadedPiece[], check: LocalCheckResult): string {
  const lines: string[] = [];
  lines.push(`=== KAKERA 投稿 検査 ===`);
  lines.push(`slug: ${meta.slug}`);
  lines.push(`title: ${meta.title}`);
  lines.push(`生成元: ${meta.generatorDeclared.service} / ${meta.generatorDeclared.model}`);
  lines.push(`枚数: ${pieces.length}`);
  lines.push('');
  for (const r of check.sharpResults) {
    const name = basename(r.file);
    if (r.ok) {
      lines.push(`  [OK] ${name}  ${r.width}x${r.height}  ${Math.round(r.bytes / 1024)}KB  alpha=${r.hasAlpha ?? false}`);
    } else {
      lines.push(`  [NG] ${name}  ${r.reason}`);
    }
  }
  lines.push('');
  if (check.ok) {
    lines.push('検品ゲート: OK（schema・同意・生成元格付け・プロンプト禁止語・画像ゲートすべて通過）');
  } else {
    lines.push(`検品ゲート: NG (${check.gate ?? '不明'}) ${check.reason ?? ''}`);
  }
  return lines.join('\n');
}

// ------------------------------------------------------- CLI

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const metaPath = getFlag(args, '--meta');
  const dir = getFlag(args, '--dir');
  const fromCodexStr = getFlag(args, '--from-codex');
  const send = hasFlag(args, '--send');
  const endpoint = getFlag(args, '--endpoint') ?? DEFAULT_ENDPOINT;

  if (!metaPath) {
    console.error('使い方: npm run submit-series -- --meta meta.json (--dir ./pngs | --from-codex N) [--send] [--endpoint URL]');
    process.exit(1);
  }
  if (!dir && !fromCodexStr) {
    console.error('--dir か --from-codex のどちらかが必要です');
    process.exit(1);
  }
  if (dir && fromCodexStr) {
    console.error('--dir と --from-codex は同時に指定できません');
    process.exit(1);
  }

  const meta = loadMeta(JSON.parse(await readFile(metaPath, 'utf8')));

  const files = fromCodexStr
    ? await selectFromCodex(Number(fromCodexStr))
    : await listPngsInDir(dir!);

  if (fromCodexStr) {
    console.log(`Codexの生成物から新しい順に${files.length}枚選びました:`);
    for (const f of files) console.log(`  ${f}`);
    console.log('');
  }

  const pieces = await loadPieces(files, meta);
  const check = await runLocalChecks(meta, pieces);
  console.log(formatSummary(meta, pieces, check));

  if (!check.ok) {
    console.log('');
    console.log('検査で落ちたため送信しません。');
    process.exit(1);
  }

  if (!send) {
    console.log('');
    console.log('--send が無いため送信しません。検査だけで終わります。');
    console.log(`送るときは --send を付けてください（送信先: ${endpoint}）。`);
    return;
  }

  const adminToken = process.env.KAKERA_ADMIN_TOKEN;
  console.log('');
  console.log(`${endpoint}/api/submit へ送信します${adminToken ? '（x-admin-token 付き）' : ''}...`);
  const result = await sendSubmission(endpoint, meta, pieces, adminToken);
  console.log(`status: ${result.status}`);
  console.log(JSON.stringify(result.body, null, 2));
  if (result.status >= 400) process.exit(1);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
