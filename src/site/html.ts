import { readFileSync } from 'node:fs';
import { normalizeSiteConfig, type SiteConfig } from './html-core.js';

// 既存の呼び出し元 (src/site/pages/*.ts・tools/*.ts) の import 文を変えずに済むよう、
// esc/attr/SiteConfig は html-core.ts からそのまま re-export する
// (実装は html-core.ts に一本化。ここでの重複定義はしない)。
export { esc, attr, type SiteConfig } from './html-core.js';

export function loadSiteConfig(): SiteConfig {
  const raw = JSON.parse(
    readFileSync(new URL('../../config/site.json', import.meta.url), 'utf8'),
  ) as { siteUrl: string; assetBaseUrl: string };
  return normalizeSiteConfig(raw);
}

export { layout, CSS } from './layout.js';
