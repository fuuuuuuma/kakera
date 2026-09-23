/**
 * `src/site/html.ts` から `node:fs` 依存 (`loadSiteConfig`) を切り離した部分。
 *
 * Cloudflare Workers ランタイムには `node:fs` が無い（`wrangler.jsonc` に
 * `nodejs_compat` も設定していない）。`src/worker/community.ts` はサイトの
 * ページ生成コード (`esc`/`attr`/`layout`/`SiteConfig`) を Worker から直接呼ぶ
 * 必要があるが、`html.ts` をそのまま import すると先頭の `import { readFileSync }
 * from 'node:fs'` が Worker のバンドルに巻き込まれてしまう。
 *
 * そのため fs を使わない部分だけをここに置き、`html.ts`（ビルドツール用・Node専用）と
 * `layout.ts` の両方がこちらを参照する形にした。既存の `html.ts` の公開API
 * (esc/attr/layout/CSS/SiteConfig/loadSiteConfig) は変更していない
 * (すべて re-export で維持。既存ページの import 文は無修正で動く)。
 */

export interface SiteConfig {
  siteUrl: string;
  assetBaseUrl: string;
}

const ENT: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENT[c]!);
}

export function attr(o: Record<string, string | number | boolean | undefined>): string {
  let out = '';
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === false) continue;
    if (v === true) {
      out += ` ${k}`;
      continue;
    }
    out += ` ${k}="${esc(String(v))}"`;
  }
  return out;
}

const trimSlash = (u: string): string => u.replace(/\/+$/, '');

/** JSON から読んだ生の値 (末尾スラッシュ等を含みうる) を SiteConfig の形へそろえる。
 * `loadSiteConfig` (Node/fsで読む側) と Worker 側 (JSONを import で埋め込む側) の
 * 両方がこれを呼ぶことで、正規化ロジックを二重に持たない。 */
export function normalizeSiteConfig(raw: { siteUrl: string; assetBaseUrl: string }): SiteConfig {
  return { siteUrl: trimSlash(raw.siteUrl), assetBaseUrl: trimSlash(raw.assetBaseUrl) };
}
