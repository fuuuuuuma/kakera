/**
 * KAKERA の Worker。
 *
 * 役割:
 *   1. 静的アセットを配る（ASSETS へ委譲するだけ。**Worker は起動しない＝リクエストは無料**）
 *   2. /api/download でダウンロードを数える
 *   3. Phase 2 (投稿の全員開放): /api/submit・/api/report・/api/admin/*
 *      設計: docs/design-2026-09-23-phase2-open-submissions.md
 *   4. Phase 2 の読み取り側: GET /community・GET /community/<slug>
 *      投稿 (/api/submit) は書き込みまでで、これまでサイトのどこにも表示されていなかった
 *      穴を埋める (src/worker/community.ts)。D1 から published のものだけをその場で
 *      HTML化して返す（運営審査カタログのような静的ビルドはしない）。
 *
 * **Workers Cache を有効にしないこと。** 有効にすると、通常は無料の静的アセットの
 * リクエストまで課金対象に変わる（Cloudflare 公式に明記）。
 */
import { shrinkForModeration } from './moderation-image.js';
import {
  handleSubmit,
  handleReport,
  checkAdminAuth,
  type SubmitDeps,
  type ReportDeps,
} from './submit.js';
import {
  handleCommunityIndex,
  handleCommunitySeries,
  type CommunityReadDeps,
  type CommunitySeriesSummary,
  type CommunitySeriesDetail,
  type CommunityPieceRow,
} from './community.js';
// site.json を import で埋め込む (node:fs は使わない。Worker ランタイムに
// ファイルシステムは無い)。tools/build-site.ts 側の loadSiteConfig() と同じ正規化を
// normalizeSiteConfig() に一本化してある (src/site/html-core.ts)。
import siteConfigJson from '../../config/site.json';
import { normalizeSiteConfig, type SiteConfig } from '../site/html-core.js';

const SITE_CONFIG: SiteConfig = normalizeSiteConfig(siteConfigJson);

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  AI: Ai;
  IP_SALT?: string;
  ADMIN_TOKEN?: string;
  TURNSTILE_SECRET?: string;
  /** 既定 true。投稿にログインを必須にするかは docs/design-...-phase2 §2 の提案どおり
   * 既定でオンにしているが、最終判断はユーザーに委ねているため環境変数で切り替えられる。
   * ただし Phase 2 の実装では「ログイン状態の検証」自体は範囲外
   * (Google OAuth の検証はこのタスクでは実装していない。creatorHandle の自己申告のみ)。 */
  REQUIRE_TURNSTILE?: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

// セキュリティ点検 (本体・2026-09-23) resource-exhaustion 対策: JSONパース前に
// Content-Length で弾く上限。/api/submit は最大12点のbase64画像を含むため大きめ、
// /api/report は短文のみなので小さめにする。
const MAX_SUBMIT_BODY_BYTES = 40 * 1024 * 1024; // 40MB
const MAX_REPORT_BODY_BYTES = 16 * 1024; // 16KB

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** IP はそのまま持たない。日ごとの重複判定に必要なだけの一方向ハッシュにする。 */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SQL に渡す前に形を確かめる。システム境界の検証はここ1か所だけ。 */
export function parseBeacon(o: unknown): { series: string; piece: string } | null {
  if (typeof o !== 'object' || o === null) return null;
  const r = o as Record<string, unknown>;
  const series = r['series'];
  const piece = r['piece'];
  if (typeof series !== 'string' || typeof piece !== 'string') return null;
  if (!SLUG.test(series) || !SLUG.test(piece)) return null;
  return { series, piece };
}

/** `x-admin-token` ヘッダと `ADMIN_TOKEN` を突き合わせる、この Worker 内での唯一の窓口。
 * `/api/submit`（上限免除の判定）・`/api/admin/queue`・`/api/admin/takedown`
 * (認証そのもの) の3箇所が同じヘッダ名・同じ既定値 (`ADMIN_TOKEN` 未設定なら空文字列
 * =必ず不一致) を使うことを、ここに一本化して保証する。判定自体は `checkAdminAuth`
 * (定数時間比較・submit.ts) にそのまま委譲する。 */
export function isRequestFromAdmin(request: Request, env: Pick<Env, 'ADMIN_TOKEN'>): boolean {
  return checkAdminAuth(request.headers.get('x-admin-token'), env.ADMIN_TOKEN ?? '');
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function html(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

/** 実際の D1/R2/AI/fetch への橋渡し。テストは SubmitDeps を直接偽物で渡すので
 * この関数自体はユニットテストしていない (統合の配線でしかない)。 */
export function submitDepsFromEnv(env: Env): SubmitDeps {
  return {
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    async countSubmissionsToday(ipHash, day) {
      const row = await env.DB.prepare(`SELECT count FROM submission_event WHERE ip_hash = ? AND day = ?`)
        .bind(ipHash, day)
        .first<{ count: number }>();
      return row?.count ?? 0;
    },
    async incrementSubmissionCount(ipHash, day) {
      await env.DB.prepare(
        `INSERT INTO submission_event (ip_hash, day, count) VALUES (?, ?, 1)
         ON CONFLICT (ip_hash, day) DO UPDATE SET count = count + 1`,
      )
        .bind(ipHash, day)
        .run();
    },
    async slugExists(slug) {
      const row = await env.DB.prepare(`SELECT 1 FROM community_series WHERE slug = ? LIMIT 1`)
        .bind(slug)
        .first();
      return row !== null;
    },
    async verifyTurnstile(token, ip) {
      if (!env.TURNSTILE_SECRET) return false;
      const form = new FormData();
      form.append('secret', env.TURNSTILE_SECRET);
      form.append('response', token);
      form.append('remoteip', ip);
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    },
    async moderateImage(bytes, mime) {
      // モデル選定・精度は実機未検証 (docs/design-...-phase2 §1.1-6 参照)。
      // 判定できない・エラー時は安全側 (flagged=true で保留) に倒す。
      try {
        // 2026-09-24: 以前は btoa(String.fromCharCode(...bytes)) で長さを記録していたが、
        // 引数の展開は数十万要素でスタックがあふれ、2048px の PNG では AI を呼ぶ前に
        // 全件保留になっていた。記録にはバイト数だけを使う。
        // 2048px のまま渡すと AI 側で時間切れになる (moderation-image.ts 参照)。
        const small = shrinkForModeration(bytes);
        const result = (await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
          image: [...small],
          prompt:
            'Does this image contain sexual content, graphic violence, or a photorealistic depiction of a real person? Answer only "yes", "no", or "unsure".',
          max_tokens: 8,
        })) as { description?: string };
        const answer = (result.description || '').toLowerCase();
        const flagged = !answer.includes('no') || answer.includes('yes') || answer.includes('unsure');
        return { flagged, detail: `AI応答: ${answer || '(空)'} mime=${mime} bytes=${bytes.length} 判定用=${small.length}` };
      } catch (e) {
        return { flagged: true, detail: `モデレーション呼び出しに失敗したため保留: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
    async putObject(key, bytes, contentType) {
      await env.ASSETS_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
    },
    async insertSeries(row) {
      await env.DB.prepare(
        `INSERT INTO community_series
           (id, slug, title, description, tone_light, tone_color_temp, tone_framing, tone_texture,
            creator_handle, generator_service, generator_model, generator_version,
            depicts_person, prompt_public, status, consent_json, ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'published', ?, ?, ?)`,
      )
        .bind(
          row.id,
          row.slug,
          row.title,
          row.description,
          row.tone.light,
          row.tone.colorTemp,
          row.tone.framing,
          row.tone.texture,
          row.creatorHandle,
          row.generator.service,
          row.generator.model,
          row.generator.version,
          row.consentJson,
          row.ipHash,
          row.createdAt,
        )
        .run();
    },
    async insertPiece(row) {
      await env.DB.prepare(
        `INSERT INTO community_piece
           (id, series_id, kind, r2_key, bytes, mime, sha256, prompt, alpha, has_alpha_channel, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          row.id,
          row.seriesId,
          row.kind,
          row.r2Key,
          row.bytes,
          row.mime,
          row.sha256,
          row.prompt,
          row.alpha ? 1 : 0,
          row.hasAlphaChannel ? 1 : 0,
          row.createdAt,
        )
        .run();
    },
  };
}

function reportDepsFromEnv(env: Env): ReportDeps {
  return {
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    // submission_event を通報にも流用する (day を "report:<日付>" で名前空間分けして
    // 投稿の回数制限と混ざらないようにする)。セキュリティ点検 2026-09-23 の指摘対応。
    async countReportsToday(ipHash, day) {
      const row = await env.DB.prepare(`SELECT count FROM submission_event WHERE ip_hash = ? AND day = ?`)
        .bind(ipHash, day)
        .first<{ count: number }>();
      return row?.count ?? 0;
    },
    async incrementReportCount(ipHash, day) {
      await env.DB.prepare(
        `INSERT INTO submission_event (ip_hash, day, count) VALUES (?, ?, 1)
         ON CONFLICT (ip_hash, day) DO UPDATE SET count = count + 1`,
      )
        .bind(ipHash, day)
        .run();
    },
    async insertReport(row) {
      await env.DB.prepare(
        `INSERT INTO report (id, target_type, target_id, reason, contact, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      )
        .bind(row.id, row.targetType, row.targetId, row.reason, row.contact, row.createdAt)
        .run();
    },
  };
}

interface CommunitySeriesJoinRow {
  series_id: string;
  slug: string;
  title: string;
  description: string;
  creator_handle: string;
  created_at: string;
  piece_id: string | null;
  r2_key: string | null;
  sha256: string | null;
  alpha: number | null;
}

/** 一覧用に先頭何点をタイル表示するか。home.ts の tiles() と同じ数にそろえる。 */
const PREVIEW_PIECES_PER_SERIES = 4;

function communityDepsFromEnv(env: Env): CommunityReadDeps {
  return {
    async listPublishedSeries(): Promise<CommunitySeriesSummary[]> {
      // シリーズ×かけらをJOINで1回のクエリにまとめ、N+1を避ける
      // (シリーズごとに個別クエリを投げない)。グルーピングと先頭4点への絞り込みはJS側で行う。
      const { results } = await env.DB.prepare(
        `SELECT s.id as series_id, s.slug, s.title, s.description, s.creator_handle, s.created_at,
                p.id as piece_id, p.r2_key, p.sha256, p.alpha
         FROM community_series s
         LEFT JOIN community_piece p ON p.series_id = s.id
         WHERE s.status = 'published'
         ORDER BY s.created_at DESC, p.id ASC`,
      ).all<CommunitySeriesJoinRow>();

      const order: string[] = [];
      const bySeriesId = new Map<string, CommunitySeriesSummary>();
      for (const row of results) {
        let s = bySeriesId.get(row.series_id);
        if (!s) {
          s = {
            id: row.series_id,
            slug: row.slug,
            title: row.title,
            description: row.description,
            creatorHandle: row.creator_handle,
            pieceCount: 0,
            createdAt: row.created_at,
            previewPieces: [],
          };
          bySeriesId.set(row.series_id, s);
          order.push(row.series_id);
        }
        if (row.piece_id !== null && row.r2_key !== null && row.sha256 !== null) {
          s.pieceCount += 1;
          if (s.previewPieces.length < PREVIEW_PIECES_PER_SERIES) {
            s.previewPieces.push({ id: row.piece_id, r2Key: row.r2_key, sha256: row.sha256, alpha: row.alpha === 1 });
          }
        }
      }
      return order.map((id) => bySeriesId.get(id)!);
    },
    async getPublishedSeriesBySlug(
      slug: string,
    ): Promise<{ series: CommunitySeriesDetail; pieces: CommunityPieceRow[] } | null> {
      const s = await env.DB.prepare(`SELECT * FROM community_series WHERE slug = ? AND status = 'published' LIMIT 1`)
        .bind(slug)
        .first<{
          id: string;
          slug: string;
          title: string;
          description: string;
          tone_light: string;
          tone_color_temp: string;
          tone_framing: string;
          tone_texture: string;
          creator_handle: string;
          generator_service: string;
          generator_model: string;
          generator_version: string;
          created_at: string;
        }>();
      if (!s) return null;

      const { results } = await env.DB.prepare(
        `SELECT id, kind, r2_key, bytes, mime, sha256, prompt, alpha, created_at
         FROM community_piece WHERE series_id = ? ORDER BY id ASC`,
      )
        .bind(s.id)
        .all<{
          id: string;
          kind: string;
          r2_key: string;
          bytes: number;
          mime: string;
          sha256: string;
          prompt: string;
          alpha: number;
          created_at: string;
        }>();

      return {
        series: {
          id: s.id,
          slug: s.slug,
          title: s.title,
          description: s.description,
          tone: { light: s.tone_light, colorTemp: s.tone_color_temp, framing: s.tone_framing, texture: s.tone_texture },
          creatorHandle: s.creator_handle,
          generator: { service: s.generator_service, model: s.generator_model, version: s.generator_version },
          createdAt: s.created_at,
        },
        pieces: results.map((p) => ({
          id: p.id,
          kind: p.kind,
          r2Key: p.r2_key,
          bytes: p.bytes,
          mime: p.mime,
          sha256: p.sha256,
          prompt: p.prompt,
          alpha: p.alpha === 1,
          createdAt: p.created_at,
        })),
      };
    },
  };
}

/** ルーティング本体。想定外の例外を投げても、呼び出し元 (default.fetch) が
 * 必ず捕まえて安全側 (500・何も公開しない) に倒す。 */
async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/download') {
      if (request.method !== 'POST') {
        return new Response('method not allowed', { status: 405 });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return new Response('bad json', { status: 400 });
      }
      const b = parseBeacon(body);
      if (!b) return new Response('bad request', { status: 400 });

      const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
      const ipHash = await hashIp(ip, env.IP_SALT ?? 'kakera');
      const now = new Date();

      // 同一IP・同一かけら・同日は1回に丸める。連打を数えない。
      await env.DB.prepare(
        `INSERT OR IGNORE INTO download_event
           (series_slug, piece_id, day, ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(b.series, b.piece, dayKey(now), ipHash, now.toISOString())
        .run();

      return new Response(null, { status: 204 });
    }

    // ---- Phase 2: 投稿の全員開放 ----
    if (url.pathname === '/api/submit') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      // セキュリティ点検 (本体・2026-09-23) resource-exhaustion 対策: JSONとして
      // パースする前に Content-Length で弾く。base64化した画像を複数枚含むので、
      // 12点上限でも余裕を持たせた値にする (30MB)。
      const contentLength = Number(request.headers.get('content-length') || '0');
      if (contentLength > MAX_SUBMIT_BODY_BYTES) {
        return json({ ok: false, error: 'リクエストが大きすぎます' }, 413);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'bad json' }, 400);
      }
      const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
      const requireTurnstile = env.REQUIRE_TURNSTILE !== 'false';
      // 運営者 (x-admin-token が ADMIN_TOKEN と一致) は1日5シリーズのIP上限だけ免除する
      // (docs/design-...-phase2 の追加要件)。
      const isAdmin = isRequestFromAdmin(request, env);
      const result = await handleSubmit(body, ip, submitDepsFromEnv(env), { requireTurnstile, isAdmin });
      return json(result.body, result.status);
    }

    if (url.pathname === '/api/report') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      const contentLength = Number(request.headers.get('content-length') || '0');
      if (contentLength > MAX_REPORT_BODY_BYTES) {
        return json({ ok: false, error: 'リクエストが大きすぎます' }, 413);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'bad json' }, 400);
      }
      const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
      const result = await handleReport(body, ip, reportDepsFromEnv(env));
      return json(result.body, result.status);
    }

    if (url.pathname === '/api/admin/queue') {
      if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
      if (!isRequestFromAdmin(request, env)) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      const reports = await env.DB.prepare(`SELECT * FROM report WHERE status = 'pending' ORDER BY created_at DESC`).all();
      const flags = await env.DB.prepare(`SELECT * FROM moderation_flag WHERE resolved = 0 ORDER BY created_at DESC`).all();
      return json({ ok: true, reports: reports.results, flags: flags.results }, 200);
    }

    if (url.pathname === '/api/admin/takedown') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      if (!isRequestFromAdmin(request, env)) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'bad json' }, 400);
      }
      const b = body as { targetId?: string; reportId?: string };
      if (typeof b.targetId !== 'string') return json({ ok: false, error: 'targetId が必要です' }, 400);
      // 削除の実行は人の承認 (この管理者トークン付きリクエストそのものが承認の記録)。
      // R2のファイルは証拠保全のため残し、一覧から外すだけにする。
      await env.DB.prepare(`UPDATE community_series SET status = 'removed' WHERE id = ?`).bind(b.targetId).run();
      if (typeof b.reportId === 'string') {
        await env.DB.prepare(`UPDATE report SET status = 'approved' WHERE id = ?`).bind(b.reportId).run();
      }
      return json({ ok: true }, 200);
    }

    // ---- Phase 2 の読み取り側: 投稿されたシリーズの一覧・詳細 ----
    // 静的ビルド (dist/site) に community/ のページは無いので、not_found_handling の
    // 404探索をすり抜けてここまで届く。html() で text/html を返す (json() は使わない)。
    if (url.pathname === '/community' || url.pathname === '/community/') {
      if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
      const result = await handleCommunityIndex(communityDepsFromEnv(env), SITE_CONFIG);
      return html(result.html, result.status);
    }
    const communityMatch = /^\/community\/([^/]+)\/?$/.exec(url.pathname);
    if (communityMatch) {
      if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
      const slug = decodeURIComponent(communityMatch[1]!);
      const result = await handleCommunitySeries(slug, communityDepsFromEnv(env), SITE_CONFIG);
      return html(result.html, result.status);
    }

    // それ以外は静的アセット。Worker はここで何もしない。
    return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (e) {
      // セキュリティ点検 (本体・2026-09-23) moderation-fail-open 対策の最後の砦:
      // ここまでの各ゲート・deps実装が想定外の例外を投げても、ここで捕まえて
      // 「公開されない・500を返す」に倒す (書き込みは例外発生前のawaitチェーンの
      // 途中で止まっているため、この例外到達時点でシリーズが公開状態になることは無い)。
      // エラーメッセージは env の秘密値を含み得るため、詳細はログにだけ出し
      // クライアントへは定型文だけ返す。
      console.error('unhandled error in route():', e instanceof Error ? e.stack || e.message : String(e));
      return json({ ok: false, error: '内部エラーが発生しました' }, 500);
    }
  },
};
