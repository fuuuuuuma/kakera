import type { Catalog } from '../catalog/schema.js';
import type { SiteConfig } from './html.js';
import { homePage } from './pages/home.js';
import { seriesPage } from './pages/series.js';
import { piecePage } from './pages/piece.js';
import { licensePage, termsPage, moderationPage, reportPage } from './pages/legal.js';

export interface SiteFile {
  path: string;
  html: string;
}

/** カタログから全ページを組み立てる。**ファイルシステムには触らない。** */
export function buildSite(catalog: Catalog, cfg: SiteConfig): SiteFile[] {
  const files: SiteFile[] = [
    { path: 'index.html', html: homePage({ catalog, cfg }) },
    { path: 'license/index.html', html: licensePage(cfg) },
    { path: 'terms/index.html', html: termsPage(cfg) },
    { path: 'moderation/index.html', html: moderationPage(cfg) },
    { path: 'report/index.html', html: reportPage(cfg) },
  ];

  for (const s of catalog.series) {
    files.push({ path: `series/${s.slug}/index.html`, html: seriesPage({ series: s, cfg }) });
    for (const p of s.pieces) {
      files.push({
        path: `piece/${p.id}/index.html`,
        html: piecePage({ piece: p, series: s, cfg }),
      });
    }
  }
  return files;
}

const normalize = (p: string): string => {
  const t = p.split('#')[0]!.split('?')[0]!.replace(/\/+$/, '');
  return t === '' ? '/' : t;
};

/**
 * 静的ビルドには含まれないが、Worker が動的に応答する実在のルート。
 * Phase 2 (投稿の全員開放・docs/design-2026-09-23-phase2-open-submissions.md) で追加した
 * `/community`・`/community/<slug>` は D1 から読むためビルド時には静的ファイル化されない
 * (src/worker/community.ts 参照)。トップページ・ナビからここへリンクしても「実在しない」
 * 誤検知にしない。
 */
const DYNAMIC_ROUTES = ['/community'];

/**
 * サイト内リンクが実在するページを指しているかを機械で照合する。
 * カタログのキーが実体とずれていた事故と同じ種類のものを、公開前に止めるためのもの。
 */
export function assertNoBrokenLinks(files: SiteFile[]): void {
  const have = new Set(files.map((f) => normalize('/' + f.path.replace(/index\.html$/, ''))));
  const isDynamic = (href: string): boolean =>
    DYNAMIC_ROUTES.some((p) => href === p || href.startsWith(`${p}/`));

  const broken: string[] = [];
  for (const f of files) {
    for (const m of f.html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1]!;
      if (!href.startsWith('/')) continue; // 外部・アンカーは見ない
      if (isDynamic(href)) continue;
      if (!have.has(normalize(href))) broken.push(`${f.path} → ${href}`);
    }
  }
  if (broken.length > 0) {
    throw new Error(
      `サイト内リンクが実在しないページを指しています:\n  ${broken.join('\n  ')}`,
    );
  }
}
