/**
 * カタログから静的サイトを書き出す。
 * 使い方: npm run build-site
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildSite, assertNoBrokenLinks } from '../src/site/build.js';
import { loadSiteConfig } from '../src/site/html.js';
import type { Catalog } from '../src/catalog/schema.js';

const OUT = 'dist/site';

const catalog = JSON.parse(await readFile('dist/catalog.json', 'utf8')) as Catalog;
const cfg = loadSiteConfig();
const files = buildSite(catalog, cfg);

// リンク切れがあれば書き出す前に止める
assertNoBrokenLinks(files);

await rm(OUT, { recursive: true, force: true });
for (const f of files) {
  const dest = join(OUT, f.path);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, f.html);
}

console.log(`${files.length} ページを ${OUT} に書きました`);
console.log(`  シリーズ ${catalog.seriesCount} / かけら ${catalog.pieceCount}`);
console.log(`  サイト: ${cfg.siteUrl} / 素材: ${cfg.assetBaseUrl}`);
