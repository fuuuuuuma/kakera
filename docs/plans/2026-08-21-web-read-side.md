# KAKERA Web（読む側）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `dist/catalog.json` から静的な HTML を書き出し、`kakera.fuuuuuuma.dev` で「見る・探す・落とす」が成立する状態にする。

**Architecture:** カタログを読んで HTML 文字列を返す**純関数**の集まり。フレームワークを使わない。書き出した静的ファイルを Workers Static Assets で配り、ダウンロード計数だけ同じ Worker の API 経路で受けて D1 に書く。

**Tech Stack:** Node 22 / TypeScript / vitest（既存パッケージに追加）/ Cloudflare Workers Static Assets / D1 / wrangler 4.125

**Spec:** `projects/常時運用/kakera/docs/design-2026-08-20.md`（v2.1）

## この計画の範囲

Phase 1 の Web のうち、**「読む側」だけ**をやる。

| 入る | 入らない（次の計画） |
|---|---|
| トップ・シリーズ一覧・シリーズ詳細・かけら詳細 | **いいね・保存**（Google ログインが要る） |
| 用途タグと対象での絞り込み | ランキング（いいね・保存の数が無いと出せない） |
| ダウンロード（登録不要） | 投稿フォーム |
| **ダウンロード数の計数**（アカウント不要なので今できる） | 作者ページ（1人しかいない） |
| ライセンス全文・投稿規約・削除の基準・通報の窓口 | 一括ZIP |
| かけら詳細の JSON-LD | |

**切り方の理由**: いいね・保存はアカウント必須で、Google OAuth は独立した塊。
**ダウンロード計数はアカウント不要なので、この計画で完結できる。**
ランキングは3軸のうち2軸（いいね・保存）が無いと出せないので、次の計画へ回す。

## Global Constraints

設計書からの引き写し。全タスクの要件に含まれる。

- **ページを完全に静的へ書き出す。** SSR にすると Worker が起動して課金対象になる
- **Workers Cache を有効にしない。** 有効にすると静的アセットのリクエストも課金対象に変わる
- 見た目は**白基調・ゴシック体**。面を重ねず**黒の細い罫線と余白**で組む。影は使わない。
  差し色は**青1色**、いいねだけローズ（この計画にいいねは無いので青のみ）
- **数字（DL数・順位）は大きく等幅で**出す。これがこのサイトの通貨だから
- **masonry にしない。** 均一の高さのセルに実比率の枠を描き、比率を等幅で明記する
- 文言の基準は **「動画編集者とサムネイル制作者のための」**。片方だけを名指ししない
- **「独占素材」「ここでしか手に入らない1枚」は書かない。** 書けるのは「この揃いはここだけ」
- **ダウンロードボタンの直近に**規約リンクと「ダウンロードすると KAKERA ライセンスに同意したものと
  みなします」を置く。フッターのリンクだけでは足りない
- 全かけらに **AI生成であることを明示**する
- コントラストは **WCAG AA**。全テキスト要素を走査して機械検査する
- 公開先の確定値は `config/site.json`。**ここ以外にドメインをベタ書きしない**

## File Structure

```
projects/常時運用/kakera/
├── src/site/
│   ├── html.ts        エスケープ・属性・要素の最小ヘルパ（純関数）
│   ├── layout.ts      共通の外枠（ヘッダ・フッター・<head>）＋CSS
│   ├── pages/
│   │   ├── home.ts       トップ
│   │   ├── series.ts     シリーズ詳細
│   │   ├── piece.ts      かけら詳細（JSON-LD を含む）
│   │   └── legal.ts      ライセンス・投稿規約・削除の基準・通報
│   └── build.ts       カタログ → ファイル一覧（純関数。fs に触らない）
├── src/worker/
│   └── index.ts       Worker: 静的アセット＋ /api/download の計数
├── tools/build-site.ts   CLI: build.ts の結果を dist/site へ書く
├── migrations/0001_download.sql
├── wrangler.jsonc
└── tests/site.test.ts, tests/worker.test.ts
```

**分け方の理由:** `build.ts` は**ファイルシステムに触らない**（`{path, html}[]` を返すだけ）。
これで「どのページが出るか」「中に何が入るか」を、ディスクを汚さずに全部テストできる。
実際に書くのは `tools/build-site.ts` だけ。

---

### Task 1: HTML の最小ヘルパと共通の外枠

**Files:**
- Create: `src/site/html.ts`
- Create: `src/site/layout.ts`
- Test: `tests/site.test.ts`

**Interfaces:**
- Consumes: `config/site.json`
- Produces:
  - `esc(s: string): string` — HTML エスケープ
  - `attr(o: Record<string, string | number | boolean | undefined>): string`
  - `interface SiteConfig { siteUrl: string; assetBaseUrl: string }`
  - `loadSiteConfig(): SiteConfig`
  - `layout(args: { title: string; description: string; canonicalPath: string; body: string; cfg: SiteConfig; head?: string }): string`
  - `CSS: string` — 白基調ゴシックのスタイル1式

- [ ] **Step 1: 失敗するテストを書く**

`tests/site.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { esc, attr, layout, loadSiteConfig } from '../src/site/html.js';

describe('esc', () => {
  it('タグを無害化する', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('引用符とアンパサンドも', () => {
    expect(esc(`a&b"c'd`)).toBe('a&amp;b&quot;c&#39;d');
  });
  it('日本語はそのまま', () => {
    expect(esc('夜の書斎')).toBe('夜の書斎');
  });
});

describe('attr', () => {
  it('key="value" を並べる', () => {
    expect(attr({ src: '/a.jpg', width: 1920 })).toBe(' src="/a.jpg" width="1920"');
  });
  it('undefined と false は出さない', () => {
    expect(attr({ a: undefined, b: false, c: 'x' })).toBe(' c="x"');
  });
  it('true は属性名だけ', () => {
    expect(attr({ hidden: true })).toBe(' hidden');
  });
  it('値もエスケープする', () => {
    expect(attr({ alt: '"><img>' })).toBe(' alt="&quot;&gt;&lt;img&gt;"');
  });
});

describe('loadSiteConfig', () => {
  it('config/site.json を読む', () => {
    const c = loadSiteConfig();
    expect(c.siteUrl).toMatch(/^https:\/\//);
    expect(c.assetBaseUrl).toMatch(/^https:\/\//);
    expect(c.siteUrl.endsWith('/')).toBe(false);
  });
});

describe('layout', () => {
  const cfg = { siteUrl: 'https://s.example', assetBaseUrl: 'https://a.example' };
  const html = () =>
    layout({ title: '題', description: '説明', canonicalPath: '/series/x', body: '<p>本文</p>', cfg });

  it('日本語のページとして出る', () => {
    expect(html()).toMatch(/^<!doctype html>/i);
    expect(html()).toContain('<html lang="ja">');
  });
  it('title と description が入る', () => {
    expect(html()).toContain('<title>題 — KAKERA</title>');
    expect(html()).toContain('name="description" content="説明"');
  });
  it('canonical が絶対URLになる', () => {
    expect(html()).toContain('<link rel="canonical" href="https://s.example/series/x">');
  });
  it('本文が入る', () => {
    expect(html()).toContain('<p>本文</p>');
  });
  it('対象を片方だけ名指ししない', () => {
    expect(html()).toContain('動画編集者とサムネイル制作者');
  });
  it('フッターに規約と通報の窓口がある', () => {
    const h = html();
    for (const p of ['/license', '/terms', '/moderation', '/report']) {
      expect(h, `${p} へのリンクが無い`).toContain(`href="${p}"`);
    }
  });
  it('head に追加のタグを差し込める', () => {
    expect(
      layout({ title: 't', description: 'd', canonicalPath: '/', body: '', cfg, head: '<meta name="x">' }),
    ).toContain('<meta name="x">');
  });
});
```

- [ ] **Step 2: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/site.test.ts`
Expected: FAIL（`Cannot find module '../src/site/html.js'`）

- [ ] **Step 3: `src/site/html.ts` を書く**

```ts
import { readFileSync } from 'node:fs';

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

export function loadSiteConfig(): SiteConfig {
  const raw = JSON.parse(
    readFileSync(new URL('../../config/site.json', import.meta.url), 'utf8'),
  ) as { siteUrl: string; assetBaseUrl: string };
  return { siteUrl: trimSlash(raw.siteUrl), assetBaseUrl: trimSlash(raw.assetBaseUrl) };
}

export { layout, CSS } from './layout.js';
```

- [ ] **Step 4: `src/site/layout.ts` を書く**

見た目の決めは設計書の「白基調ゴシック」節そのまま。**面を重ねず罫線と余白で組み、影は使わない。**

```ts
import { esc, type SiteConfig } from './html.js';

/**
 * 白基調・ゴシック体。面を重ねず、黒の細い罫線と余白で構造を作る。影は使わない。
 * 差し色は青1色。数字（DL数）は等幅で大きく出す — これがこのサイトの通貨だから。
 */
export const CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#101315;
 font-family:"Noto Sans JP",system-ui,sans-serif;font-size:15px;line-height:1.8;
 font-feature-settings:"palt" 1}
a{color:inherit}
img{max-width:100%;display:block}
:focus-visible{outline:2px solid #1749FF;outline-offset:2px}
:root{--ink:#101315;--sub:#5A6570;--faint:#67717A;--rule:#DFE3E7;--rule2:#EDF0F2;
 --panel:#F7F8F9;--blue:#1749FF}
.wrap{max-width:1200px;margin:0 auto;padding:0 28px}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
header{border-bottom:1px solid var(--ink);position:sticky;top:0;background:#fff;z-index:50}
header .row{display:flex;align-items:center;gap:16px;height:62px}
.logo{font-family:"Archivo",sans-serif;font-weight:900;font-size:21px;letter-spacing:.2em;
 text-decoration:none}
header nav{margin-left:auto;display:flex;gap:24px;font-size:13.5px;font-weight:500}
header nav a{text-decoration:none;color:var(--sub)}
header nav a:hover{color:var(--ink)}
h1{font-size:clamp(26px,4vw,44px);font-weight:900;line-height:1.34;letter-spacing:-.02em;margin:0 0 16px}
h2{font-size:19px;font-weight:900;letter-spacing:-.01em;margin:0}
.sechead{display:flex;align-items:flex-end;gap:16px;padding-bottom:14px;
 border-bottom:2px solid var(--ink);margin:52px 0 0}
.sechead .note{font-size:12.5px;color:var(--faint);padding-bottom:3px}
.lead{max-width:40em;font-size:15.5px;line-height:2.05;color:var(--sub);margin:0 0 28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));
 border-left:1px solid var(--rule);border-top:1px solid var(--rule)}
.card{border-right:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:16px}
.card a{text-decoration:none}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:3px}
.tiles img{aspect-ratio:16/9;object-fit:cover;width:100%}
.card h3{margin:13px 0 4px;font-size:15px;font-weight:700;letter-spacing:-.01em}
.card .by{font-size:12.5px;color:var(--sub)}
.card .foot{display:flex;align-items:center;gap:14px;padding-top:11px;margin-top:11px;
 border-top:1px solid var(--rule2)}
.dl{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11.5px;color:var(--sub);
 letter-spacing:.04em;font-variant-numeric:tabular-nums}
.tag{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.06em;
 border:1px solid var(--rule);padding:2px 7px;color:var(--sub);white-space:nowrap}
.tag.alpha{border-color:var(--blue);color:var(--blue)}
.tagline{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
/* 比率の枠。masonry にしない — 編集者は 16:9 か 9:16 かで捨てるので、実比率を見せる */
.pieces{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px;margin-top:24px}
.piece{border:1px solid var(--rule);padding:14px}
.piece .frame{display:flex;align-items:center;justify-content:center;background:var(--panel);
 border:1px solid var(--rule);height:190px}
.piece .frame img{max-height:100%;width:auto;object-fit:contain}
.piece .ratio{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;
 color:var(--faint);letter-spacing:.08em;margin-top:8px}
.btn{display:inline-flex;align-items:center;gap:7px;font-size:13.5px;font-weight:700;
 padding:9px 18px;text-decoration:none;border:1px solid var(--ink)}
.btn-p{background:var(--ink);color:#fff}
.btn-p:hover{background:var(--blue);border-color:var(--blue)}
.consent{font-size:11.5px;color:var(--sub);margin-top:8px;line-height:1.7}
.consent a{color:var(--blue)}
.kv{border-top:1px solid var(--rule);margin-top:22px}
.kv div{display:flex;gap:16px;padding:9px 0;border-bottom:1px solid var(--rule2);font-size:13px}
.kv dt,.kv b{flex:none;width:9em;color:var(--faint);font-weight:400;
 font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.08em}
pre.prompt{background:var(--panel);border:1px solid var(--rule);padding:14px;margin:8px 0 0;
 font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;line-height:1.9;
 white-space:pre-wrap;word-break:break-word;color:var(--ink)}
.filters{display:flex;gap:6px;flex-wrap:wrap;margin:18px 0 0}
.filters button{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;
 letter-spacing:.08em;padding:6px 12px;border:1px solid var(--rule);color:var(--sub);
 background:none;cursor:pointer}
.filters button[aria-pressed="true"]{background:var(--ink);color:#fff;border-color:var(--ink)}
.prose{max-width:44em}
.prose h2{margin:36px 0 12px;font-size:17px}
.prose p,.prose li{color:var(--sub);font-size:14.5px;line-height:2}
.prose strong{color:var(--ink)}
footer{margin-top:64px;border-top:1px solid var(--ink);padding:28px 0 70px;
 font-size:12.5px;color:var(--sub);line-height:2}
footer nav{display:flex;gap:20px;flex-wrap:wrap;margin-top:12px}
footer nav a{color:var(--sub)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const FONTS =
  'https://fonts.googleapis.com/css2?family=Archivo:wght@700;900&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+JP:wght@400;500;700;900&display=swap';

export function layout(args: {
  title: string;
  description: string;
  canonicalPath: string;
  body: string;
  cfg: SiteConfig;
  head?: string;
}): string {
  const { title, description, canonicalPath, body, cfg } = args;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — KAKERA</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(cfg.siteUrl + canonicalPath)}">
<meta property="og:title" content="${esc(title)} — KAKERA">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${CSS}</style>
${args.head ?? ''}
</head>
<body>
<header><div class="wrap row">
<a class="logo" href="/">KAKERA</a>
<nav>
<a href="/">シリーズ</a><a href="/tag/透過">透過</a><a href="/license">ライセンス</a>
</nav>
</div></header>
<main class="wrap">${body}</main>
<footer><div class="wrap">
<div><strong>KAKERA</strong> — 動画編集者とサムネイル制作者のための、AI生成素材ライブラリ。
誰でも無料で持っていけます。</div>
<div>すべて AI で生成した素材です。他の利用者が類似の出力を得る場合があります。</div>
<nav>
<a href="/license">ライセンス全文</a><a href="/terms">投稿規約</a>
<a href="/moderation">削除の基準</a><a href="/report">権利侵害の申立て</a>
</nav>
</div></footer>
</body>
</html>`;
}
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/site.test.ts`
Expected: PASS（15件）

- [ ] **Step 6: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/site tests/site.test.ts && git commit -m "feat(kakera): サイトのHTMLヘルパと白基調ゴシックの外枠"
```

---

### Task 2: かけら詳細ページ

**Files:**
- Create: `src/site/pages/piece.ts`
- Test: `tests/site.test.ts`（追記）

**Interfaces:**
- Consumes: `layout` / `esc` / `attr`（T1）, `imageObjectLd`（既存 `src/build/jsonld.ts`）, `CatalogPiece` / `CatalogSeries`
- Produces: `piecePage(args: { piece: CatalogPiece; series: CatalogSeries; cfg: SiteConfig }): string`

**このページが持つべきもの**（設計書より）:
プレビュー・**比率ごとのダウンロード**・**プロンプト全文**・生成モデル・ライセンス・
**AI生成の明示**・**ダウンロードボタンの直近に同意文**・JSON-LD。

- [ ] **Step 1: 失敗するテストを書く**

`tests/site.test.ts` に追記:

```ts
import { piecePage } from '../src/site/pages/piece.js';
import type { CatalogPiece, CatalogSeries } from '../src/catalog/schema.js';

const CFG = { siteUrl: 'https://s.example', assetBaseUrl: 'https://a.example' };

const SERIES: CatalogSeries = {
  slug: 'night-desk', title: '夜の書斎', description: '夜のデスクまわり。',
  audience: ['editor'], creator: '@fuuuuuuma', license: 'kakera-free',
  tone: { light: '点光源', colorTemp: '2700K', framing: '俯瞰', texture: '木' },
  generator: { service: 'higgsfield', model: 'soul_location', version: '2026-08' },
  promptPublic: true, pieceCount: 1, toneMaxDistance: 0.5, pieces: [],
};

const PIECE: CatalogPiece = {
  id: 'night-desk-01', kind: 'still',
  prompt: 'a wooden desk at night, warm lamp, no people',
  alpha: false, useTags: ['Bロール'],
  sha256: 'a'.repeat(64), bytes: 1803864, mime: 'image/png',
  variants: [
    { ratio: '16:9', w: 1920, h: 1080, key: 'night-desk/night-desk-01/a-16x9.jpg', bytes: 131328, mime: 'image/jpeg' },
    { ratio: '9:16', w: 1080, h: 1920, key: 'night-desk/night-desk-01/a-9x16.jpg', bytes: 153553, mime: 'image/jpeg' },
  ],
};

describe('piecePage', () => {
  const h = () => piecePage({ piece: PIECE, series: SERIES, cfg: CFG });

  it('プロンプトを全文載せる（全公開が前提）', () => {
    expect(h()).toContain('a wooden desk at night, warm lamp, no people');
  });

  it('生成モデルを出す（AI生成の明示）', () => {
    const s = h();
    expect(s).toContain('higgsfield');
    expect(s).toContain('soul_location');
    expect(s).toMatch(/AIで生成/);
  });

  it('比率ごとにダウンロードのリンクがある', () => {
    const s = h();
    expect(s).toContain(`${CFG.assetBaseUrl}/night-desk/night-desk-01/a-16x9.jpg`);
    expect(s).toContain(`${CFG.assetBaseUrl}/night-desk/night-desk-01/a-9x16.jpg`);
    expect(s).toContain('16:9');
    expect(s).toContain('9:16');
  });

  it('ダウンロードの直近に同意文がある', () => {
    const s = h();
    const i = s.indexOf('同意したものとみなします');
    const j = s.lastIndexOf('download', i);
    expect(i, '同意文が無い').toBeGreaterThan(0);
    // 同意文の直前1500文字以内にダウンロードの導線があること
    expect(i - j).toBeLessThan(1500);
    expect(s).toContain('href="/license"');
  });

  it('JSON-LD を埋める', () => {
    const s = h();
    expect(s).toContain('application/ld+json');
    expect(s).toContain('"@type": "ImageObject"');
    expect(s).toContain('"license"');
  });

  it('JSON-LD が壊れた JSON にならない（実際に parse できる）', () => {
    const m = h().match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    expect(() => JSON.parse(m![1]!)).not.toThrow();
  });

  it('シリーズへ戻る導線がある', () => {
    expect(h()).toContain('href="/series/night-desk"');
  });

  it('「独占」を書かない', () => {
    expect(h()).not.toMatch(/独占/);
  });

  it('プロンプトに含まれる HTML は無害化される', () => {
    const bad: CatalogPiece = { ...PIECE, prompt: '<img src=x onerror=alert(1)>' };
    const s = piecePage({ piece: bad, series: SERIES, cfg: CFG });
    expect(s).not.toContain('<img src=x');
    expect(s).toContain('&lt;img src=x');
  });

  it('計数のためのフックが入る（data-piece / data-series）', () => {
    const s = h();
    expect(s).toContain('data-piece="night-desk-01"');
    expect(s).toContain('data-series="night-desk"');
  });
});
```

- [ ] **Step 2: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/site.test.ts`
Expected: FAIL（`Cannot find module '../src/site/pages/piece.js'`）

- [ ] **Step 3: `src/site/pages/piece.ts` を書く**

```ts
import { esc, attr, layout, type SiteConfig } from '../html.js';
import { imageObjectLd } from '../../build/jsonld.js';
import type { CatalogPiece, CatalogSeries } from '../../catalog/schema.js';

const nf = (n: number): string => n.toLocaleString('en-US');
const kb = (n: number): string => `${Math.round(n / 1024)} KB`;

export function piecePage(args: {
  piece: CatalogPiece;
  series: CatalogSeries;
  cfg: SiteConfig;
}): string {
  const { piece, series, cfg } = args;
  const preview = [...piece.variants].sort((a, b) => b.w * b.h - a.w * a.h)[0];

  const ld = imageObjectLd({
    piece,
    series,
    siteUrl: cfg.siteUrl,
    assetBaseUrl: cfg.assetBaseUrl,
  });
  const head = ld
    ? `<script type="application/ld+json">${JSON.stringify(ld, null, 1).replace(/</g, '\\u003c')}</script>`
    : '';

  const downloads = piece.variants
    .map((v) => {
      const url = `${cfg.assetBaseUrl}/${v.key}`;
      return `<li class="dlrow">
<a class="btn"${attr({
        href: url,
        download: `${piece.id}-${v.ratio.replace(':', 'x')}`,
        'data-download': '1',
        'data-piece': piece.id,
        'data-series': series.slug,
      })}>${esc(v.ratio)} で落とす</a>
<span class="dl">${esc(`${v.w}×${v.h}`)} · ${esc(kb(v.bytes))}</span>
</li>`;
    })
    .join('');

  const body = `
<p class="crumb"><a href="/series/${esc(series.slug)}">← ${esc(series.title)}</a></p>
<h1>${esc(piece.id)}</h1>
<p class="lead">${esc(series.title)} の1点。AIで生成した素材です。商用可・クレジット不要・改変自由。</p>

${preview ? `<div class="preview"><img${attr({
    src: `${cfg.assetBaseUrl}/${preview.key}`,
    width: preview.w,
    height: preview.h,
    alt: `${series.title} ${piece.id}`,
    loading: 'eager',
  })}></div>` : ''}

<h2 class="sechead">ダウンロード</h2>
<ul class="dllist">${downloads}</ul>
<p class="consent">ダウンロードすると <a href="/license">KAKERA ライセンス</a> に同意したものとみなします。
商用可・クレジット不要・改変自由。禁止するのは素材ファイルそのものの再配布・転売・素材集への収録のみです。</p>

<h2 class="sechead">プロンプト</h2>
<pre class="prompt">${esc(piece.prompt)}</pre>

<h2 class="sechead">この素材について</h2>
<dl class="kv">
<div><dt>生成元</dt><dd>${esc(series.generator.service)} / ${esc(series.generator.model)}</dd></div>
<div><dt>元ファイル</dt><dd>${esc(kb(piece.bytes))}（${esc(piece.mime)}）</dd></div>
<div><dt>用途</dt><dd>${piece.useTags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ') || '—'}</dd></div>
<div><dt>ライセンス</dt><dd><a href="/license">KAKERA Free</a></dd></div>
<div><dt>SHA-256</dt><dd class="dl">${esc(piece.sha256)}</dd></div>
</dl>`;

  return layout({
    title: `${piece.id} — ${series.title}`,
    description: `${series.title} の1点。AIで生成した素材。商用可・クレジット不要。プロンプト付き。`,
    canonicalPath: `/piece/${piece.id}`,
    body,
    cfg,
    head,
  });
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/site.test.ts`
Expected: PASS（26件）

- [ ] **Step 5: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/site/pages/piece.ts tests/site.test.ts && git commit -m "feat(kakera): かけら詳細ページ（プロンプト全公開・JSON-LD・同意文）"
```

---

### Task 3: シリーズ詳細ページ

**Files:**
- Create: `src/site/pages/series.ts`
- Test: `tests/site.test.ts`（追記）

**Interfaces:**
- Consumes: T1 のヘルパ, `CatalogSeries`
- Produces: `seriesPage(args: { series: CatalogSeries; cfg: SiteConfig }): string`

**masonry にしない。** 均一の高さのセルに実比率の枠を描き、**比率を等幅で明記する**。

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { seriesPage } from '../src/site/pages/series.js';

describe('seriesPage', () => {
  const S: CatalogSeries = { ...SERIES, pieceCount: 2, pieces: [PIECE, { ...PIECE, id: 'night-desk-02' }] };
  const h = () => seriesPage({ series: S, cfg: CFG });

  it('シリーズ名と説明が出る', () => {
    expect(h()).toContain('夜の書斎');
    expect(h()).toContain('夜のデスクまわり。');
  });

  it('全かけらへのリンクが出る', () => {
    expect(h()).toContain('href="/piece/night-desk-01"');
    expect(h()).toContain('href="/piece/night-desk-02"');
  });

  it('比率を等幅で明記する', () => {
    const s = h();
    expect(s).toContain('16:9');
    expect(s).toContain('class="ratio"');
  });

  it('トーン宣言を出す（何を揃えたのか）', () => {
    const s = h();
    expect(s).toContain('2700K');
    expect(s).toContain('点光源');
  });

  it('「この揃いはここだけ」は書けるが「独占」は書かない', () => {
    expect(h()).not.toMatch(/独占/);
  });

  it('かけらの数が実体と一致する', () => {
    expect(h()).toContain('2');
    expect((h().match(/href="\/piece\//g) ?? []).length).toBe(2);
  });

  it('AI生成であることを明示する', () => {
    expect(h()).toMatch(/AIで生成|AI で生成/);
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/site.test.ts`
Expected: FAIL（`Cannot find module '../src/site/pages/series.js'`）

- [ ] **Step 3: `src/site/pages/series.ts` を書く**

```ts
import { esc, attr, layout, type SiteConfig } from '../html.js';
import type { CatalogPiece, CatalogSeries } from '../../catalog/schema.js';

/** 一覧に出す代表の書き出し。16:9 があればそれ、無ければ一番大きいもの。 */
function thumb(p: CatalogPiece) {
  return p.variants.find((v) => v.ratio === '16:9') ??
    [...p.variants].sort((a, b) => b.w * b.h - a.w * a.h)[0];
}

export function seriesPage(args: { series: CatalogSeries; cfg: SiteConfig }): string {
  const { series, cfg } = args;

  const pieces = series.pieces
    .map((p) => {
      const t = thumb(p);
      const ratio = t ? `${t.ratio} · ${t.w}×${t.h}` : '—';
      return `<article class="piece">
<a href="/piece/${esc(p.id)}">
<div class="frame">${t ? `<img${attr({
        src: `${cfg.assetBaseUrl}/${t.key}`,
        alt: `${series.title} ${p.id}`,
        loading: 'lazy',
        width: t.w,
        height: t.h,
      })}>` : ''}</div>
<div class="ratio">${esc(ratio)}</div>
</a>
<div class="tagline">${p.useTags.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}${
        p.alpha ? '<span class="tag alpha">透過PNG</span>' : ''
      }</div>
</article>`;
    })
    .join('');

  const body = `
<p class="crumb"><a href="/">← すべてのシリーズ</a></p>
<h1>${esc(series.title)}</h1>
<p class="lead">${esc(series.description)}<br>
${series.pieceCount} のかけら。AIで生成した素材です。商用可・クレジット不要・改変自由。</p>

<h2 class="sechead">そろえたもの<span class="note">この揃いはここだけです</span></h2>
<dl class="kv">
<div><dt>光</dt><dd>${esc(series.tone.light)}</dd></div>
<div><dt>色温度</dt><dd>${esc(series.tone.colorTemp)}</dd></div>
<div><dt>画角</dt><dd>${esc(series.tone.framing)}</dd></div>
<div><dt>質感</dt><dd>${esc(series.tone.texture)}</dd></div>
<div><dt>生成元</dt><dd>${esc(series.generator.service)} / ${esc(series.generator.model)}</dd></div>
</dl>

<h2 class="sechead">かけら<span class="note">${series.pieceCount} 点</span></h2>
<div class="pieces">${pieces}</div>`;

  return layout({
    title: series.title,
    description: `${series.description} ${series.pieceCount}点のAI生成素材。商用可・クレジット不要。`,
    canonicalPath: `/series/${series.slug}`,
    body,
    cfg,
  });
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/site.test.ts`
Expected: PASS（33件）

- [ ] **Step 5: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/site/pages/series.ts tests/site.test.ts && git commit -m "feat(kakera): シリーズ詳細ページ（実比率の枠・トーン宣言）"
```

---

### Task 4: トップページと絞り込み

**Files:**
- Create: `src/site/pages/home.ts`
- Test: `tests/site.test.ts`（追記）

**Interfaces:**
- Consumes: T1 のヘルパ, `Catalog`
- Produces: `homePage(args: { catalog: Catalog; cfg: SiteConfig }): string`

**シリーズカードは1枚に4点をタイル表示**して「揃い」が一目で伝わるようにする（単品サムネの海にしない）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { homePage } from '../src/site/pages/home.js';
import type { Catalog } from '../src/catalog/schema.js';

const CAT: Catalog = {
  version: 1, builtAt: '2026-08-21T00:00:00.000Z', seriesCount: 1, pieceCount: 2,
  series: [{ ...SERIES, pieceCount: 2, pieces: [PIECE, { ...PIECE, id: 'night-desk-02' }] }],
};

describe('homePage', () => {
  const h = () => homePage({ catalog: CAT, cfg: CFG });

  it('対象を両方名指しする', () => {
    expect(h()).toContain('動画編集者とサムネイル制作者');
  });

  it('数字が実体と一致する', () => {
    const s = h();
    expect(s).toContain('>1<');   // シリーズ数
    expect(s).toContain('>2<');   // かけら数
  });

  it('シリーズカードから詳細へ行ける', () => {
    expect(h()).toContain('href="/series/night-desk"');
  });

  it('カードに複数のタイルが出る（揃いが見えるように）', () => {
    const imgs = (h().match(/<img/g) ?? []).length;
    expect(imgs).toBeGreaterThanOrEqual(2);
  });

  it('絞り込みの選択肢が出る', () => {
    const s = h();
    expect(s).toContain('class="filters"');
    expect(s).toContain('Bロール');
  });

  it('「無料」「手数料」を明示する', () => {
    const s = h();
    expect(s).toMatch(/無料/);
    expect(s).toMatch(/手数料/);
  });

  it('「独占」は書かない', () => {
    expect(h()).not.toMatch(/独占/);
  });

  it('シリーズが0件でも壊れない', () => {
    const empty: Catalog = { ...CAT, seriesCount: 0, pieceCount: 0, series: [] };
    expect(() => homePage({ catalog: empty, cfg: CFG })).not.toThrow();
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/site.test.ts`
Expected: FAIL（`Cannot find module '../src/site/pages/home.js'`）

- [ ] **Step 3: `src/site/pages/home.ts` を書く**

```ts
import { esc, attr, layout, type SiteConfig } from '../html.js';
import type { Catalog, CatalogSeries } from '../../catalog/schema.js';

const nf = (n: number): string => n.toLocaleString('en-US');

/** カード1枚に4点。揃いが一目で伝わるようにする（単品サムネの海にしない）。 */
function tiles(s: CatalogSeries, cfg: SiteConfig): string {
  const picks = s.pieces.slice(0, 4);
  return `<div class="tiles">${picks
    .map((p) => {
      const v = p.variants.find((x) => x.ratio === '16:9') ?? p.variants[0];
      return v
        ? `<img${attr({
            src: `${cfg.assetBaseUrl}/${v.key}`,
            alt: `${s.title} ${p.id}`,
            loading: 'lazy',
            width: v.w,
            height: v.h,
          })}>`
        : '';
    })
    .join('')}</div>`;
}

export function homePage(args: { catalog: Catalog; cfg: SiteConfig }): string {
  const { catalog, cfg } = args;

  const allTags = [...new Set(catalog.series.flatMap((s) => s.pieces.flatMap((p) => p.useTags)))].sort();

  const cards = catalog.series
    .map(
      (s) => `<article class="card"${attr({
        'data-tags': s.pieces.flatMap((p) => p.useTags).join(','),
        'data-audience': s.audience.join(','),
      })}>
<a href="/series/${esc(s.slug)}">
${tiles(s, cfg)}
<h3>${esc(s.title)}</h3>
</a>
<div class="by">${s.pieceCount} のかけら · ${esc(s.audience.map((a) => (a === 'editor' ? '編集' : 'サムネ')).join(' / '))}</div>
<div class="foot"><span class="dl">無料</span></div>
</article>`,
    )
    .join('');

  const body = `
<div class="hero">
<h1>つくった素材を、ただで置いていく場所。</h1>
<p class="lead">動画編集者とサムネイル制作者のための、AI生成素材ライブラリ。
誰でも無料で持っていけます。<strong>お金は一円も動きません。手数料もありません。</strong>
光も色も画角もそろえた6〜12点をひと組にして置いています。</p>
</div>

<h2 class="sechead">すべてのシリーズ<span class="note">${nf(catalog.seriesCount)} シリーズ / ${nf(catalog.pieceCount)} のかけら</span></h2>
<div class="counts kv">
<div><dt>SERIES</dt><dd><strong>${nf(catalog.seriesCount)}</strong></dd></div>
<div><dt>PIECES</dt><dd><strong>${nf(catalog.pieceCount)}</strong></dd></div>
</div>
<div class="filters">
<button aria-pressed="true" data-tag="">すべて</button>
${allTags.map((t) => `<button aria-pressed="false"${attr({ 'data-tag': t })}>${esc(t)}</button>`).join('')}
</div>
<div class="grid" id="series">${cards}</div>
<script>
document.querySelectorAll('.filters button').forEach(function (b) {
  b.addEventListener('click', function () {
    document.querySelectorAll('.filters button').forEach(function (x) {
      x.setAttribute('aria-pressed', String(x === b));
    });
    var t = b.dataset.tag || '';
    document.querySelectorAll('#series .card').forEach(function (c) {
      var tags = (c.dataset.tags || '').split(',');
      c.hidden = t !== '' && tags.indexOf(t) === -1;
    });
  });
});
</script>`;

  return layout({
    title: '動画編集者とサムネイル制作者のためのAI生成素材',
    description:
      'AIで生成した素材を、トーンのそろったシリーズ単位で無料配布。商用可・クレジット不要・登録不要。',
    canonicalPath: '/',
    body,
    cfg,
  });
}
```

**注意**: `[hidden]` は `display` 指定に負けるので、CSS の先頭に
`[hidden]{display:none!important}` を足すこと（T1 の `CSS` へ追記）。

- [ ] **Step 4: `CSS` に `[hidden]` の指定を足す**

`src/site/layout.ts` の `CSS` の**先頭**に追記:

```
[hidden]{display:none !important}
```

- [ ] **Step 5: 通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/site.test.ts`
Expected: PASS（41件）

- [ ] **Step 6: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/site tests/site.test.ts && git commit -m "feat(kakera): トップページと用途タグの絞り込み"
```

---

### Task 5: 法務ページ（ライセンス・投稿規約・削除の基準・通報）

**Files:**
- Create: `src/site/pages/legal.ts`
- Test: `tests/legal.test.ts`

**Interfaces:**
- Consumes: T1 のヘルパ
- Produces: `licensePage(cfg)` / `termsPage(cfg)` / `moderationPage(cfg)` / `reportPage(cfg)`（すべて `string` を返す）

**中身は設計書の7章と2章そのまま。** 文面を発明しない。

- [ ] **Step 1: 失敗するテストを書く**

`tests/legal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { licensePage, termsPage, moderationPage, reportPage } from '../src/site/pages/legal.js';

const CFG = { siteUrl: 'https://s.example', assetBaseUrl: 'https://a.example' };

describe('licensePage', () => {
  const h = licensePage(CFG);
  it('できることを書く', () => {
    for (const w of ['商用', 'クレジット不要', '改変']) expect(h).toContain(w);
  });
  it('禁止を書く', () => {
    for (const w of ['再配布', '転売', '素材集']) expect(h).toContain(w);
  });
  it('CC0 とは名乗らない', () => {
    expect(h).not.toMatch(/CC0/);
  });
  it('AI生成であることと、一意でないことを断る', () => {
    expect(h).toMatch(/AI/);
    expect(h).toMatch(/類似/);
  });
});

describe('termsPage', () => {
  const h = termsPage(CFG);
  it('投稿者から KAKERA への許諾を書く', () => {
    expect(h).toMatch(/非独占/);
    expect(h).toMatch(/再許諾/);
  });
  it('取り下げ後もDL済みのライセンスが残ることを書く', () => {
    expect(h).toMatch(/取り下げ/);
    expect(h).toMatch(/存続|残り/);
  });
  it('投稿者の権利表明を書く', () => {
    expect(h).toMatch(/自分が生成/);
  });
  it('人物素材の禁止を書く', () => {
    expect(h).toMatch(/人物/);
  });
  it('生成元の申告を必須と書く', () => {
    expect(h).toMatch(/生成元/);
  });
});

describe('moderationPage', () => {
  const h = moderationPage(CFG);
  it('AIが一次で見て、削除は人が決めると書く', () => {
    expect(h).toMatch(/AI/);
    expect(h).toMatch(/人/);
  });
  it('何を削除するかを列挙する', () => {
    for (const w of ['権利', '人物', '違法']) expect(h).toContain(w);
  });
});

describe('reportPage', () => {
  const h = reportPage(CFG);
  it('申立ての窓口として連絡先を出す', () => {
    expect(h).toMatch(/申立て|申し立て/);
    expect(h).toMatch(/@/);
  });
  it('何を書けばよいかを示す', () => {
    expect(h).toMatch(/URL/);
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/legal.test.ts`
Expected: FAIL（`Cannot find module '../src/site/pages/legal.js'`）

- [ ] **Step 3: `src/site/pages/legal.ts` を書く**

```ts
import { layout, type SiteConfig } from '../html.js';

/** 権利侵害の申立ての宛先。運用開始時に実在するアドレスへ差し替えること。 */
export const CONTACT = 'kakera@fuuuuuuma.dev';

const page = (cfg: SiteConfig, title: string, path: string, desc: string, body: string): string =>
  layout({ title, description: desc, canonicalPath: path, body: `<div class="prose">${body}</div>`, cfg });

export function licensePage(cfg: SiteConfig): string {
  return page(cfg, 'KAKERA ライセンス', '/license', 'KAKERA の素材の使い方と、禁止していること。', `
<h1>KAKERA ライセンス</h1>
<p>KAKERA に置いてある素材は、すべて<strong>無料</strong>です。ダウンロードした時点で、
このライセンスに同意したものとみなします。</p>

<h2>できること</h2>
<ul>
<li><strong>商用利用ができます。</strong>仕事の動画でも、収益化しているチャンネルでも使えます</li>
<li><strong>クレジット表記は要りません。</strong>書いても構いませんが、義務ではありません</li>
<li><strong>改変できます。</strong>色を変える、切る、重ねる、組み合わせる — 自由です</li>
<li>使う数に上限はありません</li>
</ul>

<h2>できないこと</h2>
<ul>
<li><strong>素材ファイルそのものの再配布</strong>（そのまま配る、ミラーする）</li>
<li><strong>素材ファイルそのものの転売</strong></li>
<li><strong>素材集・テンプレート集への収録</strong>（素材を主たる価値として売ること）</li>
</ul>
<p>完成した作品に使うぶんには何も制限しません。制限しているのは
<strong>素材を素材のまま流すこと</strong>だけです。</p>

<h2>知っておいてほしいこと</h2>
<p>ここにある素材は<strong>すべて AI で生成したもの</strong>です。生成に使ったサービスとモデル、
そしてプロンプトは、各かけらのページにすべて公開しています。</p>
<p>生成AIの性質上、<strong>他の利用者が類似の出力を得る場合があります。</strong>
「ここでしか手に入らない1枚」ではありません。KAKERA が提供しているのは、
<strong>光も色も画角もそろえた組み合わせ</strong>のほうです。</p>
<p>なお KAKERA は素材に CC0 を宣言していません。AI生成物の著作物性は個別に判断されるもので、
権利があることを前提にした放棄の宣言はできないためです。このライセンスは
<strong>利用条件の取り決め</strong>として読んでください。</p>
`);
}

export function termsPage(cfg: SiteConfig): string {
  return page(cfg, '投稿規約', '/terms', 'KAKERA に素材を載せるときの取り決め。', `
<h1>投稿規約</h1>
<p>KAKERA には誰でも無料で素材を載せられます。お金のやりとりは一切ありません。
載せるときは次に同意していただきます。</p>

<h2>KAKERA への許諾</h2>
<p>投稿された素材について、KAKERA に対して
<strong>非独占・無償・世界的・再許諾可能</strong>なライセンスを付与していただきます。
KAKERA 上での配布と、利用者への KAKERA ライセンスでの再許諾のために必要なものです。</p>
<p><strong>著作権は投稿者のものです。</strong>KAKERA が取り上げることはありません。</p>

<h2>取り下げについて</h2>
<p>投稿はいつでも取り下げられます。ただし
<strong>取り下げより前にダウンロードされた素材のライセンスは、そのまま存続します。</strong></p>
<p>これは利用者を守るための取り決めです。完成した動画を公開したあとに、
足元の権利が消えることがあってはならないためです。</p>

<h2>投稿者の表明</h2>
<p>投稿する素材について、次を表明していただきます。</p>
<ul>
<li><strong>自分が生成したものであること</strong></li>
<li>第三者の権利を侵害していないこと</li>
<li><strong>実在の人物・既存のキャラクター・ブランドを含まないこと</strong></li>
</ul>

<h2>人物素材は扱いません</h2>
<p>KAKERA は<strong>人物を写した素材を扱いません。</strong>手元・後ろ姿・シルエットまでです。</p>
<p>AI が生成した人物が実在の誰かに似てしまった場合、素材として第三者に配ってしまうと、
受け取った側の使い方をこちらで止められません。そのリスクを負わせない、という判断です。</p>

<h2>生成元の申告</h2>
<p>投稿時に<strong>どのサービス・どのモデルで生成したかの申告が必須</strong>です。
出力物を第三者へ再配布できることが規約で確認できているサービスのみ受け付けます。</p>
<p>プロンプトも公開していただきます。KAKERA は全素材のプロンプトを公開する方針です。</p>
`);
}

export function moderationPage(cfg: SiteConfig): string {
  return page(cfg, '削除の基準', '/moderation', 'どんなときに素材を削除するか、誰が決めるか。', `
<h1>削除の基準</h1>

<h2>誰が決めるか</h2>
<p><strong>AI が一次的に確認し、削除するかどうかは人が決めます。</strong></p>
<p>AI だけで完結させないのは、削除の判断責任が最終的に運営に残るためです。
誤って消してしまうことも、見逃してしまうことも、どちらも起こしたくありません。</p>

<h2>削除するもの</h2>
<ul>
<li>第三者の<strong>権利</strong>を侵害している、またはその申立てを受けて妥当と判断したもの</li>
<li><strong>人物</strong>を写した素材（実在・非実在を問わず）</li>
<li>アーティスト名・実在の著名人・既存キャラクター・ブランドに言及したプロンプトで作られたもの</li>
<li><strong>違法</strong>な内容、性的な内容、暴力的な内容</li>
<li>再配布が認められていないサービスで生成されたもの</li>
</ul>

<h2>申立てを受けたら</h2>
<p>権利侵害の申立てを受けたら、内容を確認して対応します。
窓口は <a href="/report">こちら</a> です。</p>
`);
}

export function reportPage(cfg: SiteConfig): string {
  return page(cfg, '権利侵害の申立て', '/report', '権利を侵害している素材を見つけたときの窓口。', `
<h1>権利侵害の申立て</h1>
<p>KAKERA に置かれている素材が、あなたの権利、または第三者の権利を侵害していると
お考えの場合は、こちらからお知らせください。</p>

<h2>連絡先</h2>
<p><strong>${CONTACT}</strong></p>

<h2>お知らせいただきたいこと</h2>
<ul>
<li>対象の素材の <strong>URL</strong>（かけらのページ、またはシリーズのページ）</li>
<li>どの権利をどのように侵害しているか</li>
<li>あなたと、その権利との関係</li>
<li>返信できる連絡先</li>
</ul>

<h2>受け取ったあと</h2>
<p>内容を確認し、<a href="/moderation">削除の基準</a> に沿って対応します。
判断は人が行います。結果はご連絡した連絡先へお返しします。</p>
`);
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/legal.test.ts`
Expected: PASS（14件）

- [ ] **Step 5: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/site/pages/legal.ts tests/legal.test.ts && git commit -m "feat(kakera): ライセンス・投稿規約・削除の基準・通報の窓口"
```

---

### Task 6: サイト全体の組み立てと機械検査

ここが要。**リンク切れとコントラストを機械で検査する。**

**Files:**
- Create: `src/site/build.ts`
- Create: `tools/build-site.ts`
- Test: `tests/build-site.test.ts`

**Interfaces:**
- Consumes: T2〜T5 のページ関数, `Catalog`
- Produces:
  - `interface SiteFile { path: string; html: string }`
  - `buildSite(catalog: Catalog, cfg: SiteConfig): SiteFile[]`
  - `assertNoBrokenLinks(files: SiteFile[]): void`

`buildSite` は**ファイルシステムに触らない**。これで全ページの中身をディスクを汚さずに検査できる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/build-site.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSite, assertNoBrokenLinks } from '../src/site/build.js';
import type { Catalog, CatalogPiece, CatalogSeries } from '../src/catalog/schema.js';

const CFG = { siteUrl: 'https://s.example', assetBaseUrl: 'https://a.example' };

const PIECE: CatalogPiece = {
  id: 'nd-01', kind: 'still', prompt: 'a desk', alpha: false, useTags: ['Bロール'],
  sha256: 'a'.repeat(64), bytes: 100, mime: 'image/png',
  variants: [{ ratio: '16:9', w: 1920, h: 1080, key: 'nd/nd-01/a.jpg', bytes: 10, mime: 'image/jpeg' }],
};
const SERIES: CatalogSeries = {
  slug: 'nd', title: '夜の書斎', description: '説明。', audience: ['editor'],
  creator: '@fuuuuuuma', license: 'kakera-free',
  tone: { light: '光', colorTemp: '2700K', framing: '俯瞰', texture: '木' },
  generator: { service: 'higgsfield', model: 'soul_location', version: '1' },
  promptPublic: true, pieceCount: 2, toneMaxDistance: 0.4,
  pieces: [PIECE, { ...PIECE, id: 'nd-02' }],
};
const CAT: Catalog = {
  version: 1, builtAt: '2026-08-21T00:00:00.000Z', seriesCount: 1, pieceCount: 2, series: [SERIES],
};

describe('buildSite', () => {
  const files = () => buildSite(CAT, CFG);

  it('必要なページが全部出る', () => {
    const paths = files().map((f) => f.path).sort();
    for (const p of ['index.html', 'license/index.html', 'terms/index.html',
                     'moderation/index.html', 'report/index.html',
                     'series/nd/index.html', 'piece/nd-01/index.html', 'piece/nd-02/index.html']) {
      expect(paths, `${p} が無い`).toContain(p);
    }
  });

  it('かけらの数だけページが出る', () => {
    expect(files().filter((f) => f.path.startsWith('piece/')).length).toBe(2);
  });

  it('パスが重複しない', () => {
    const paths = files().map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('全ページが空でない', () => {
    for (const f of files()) expect(f.html.length, f.path).toBeGreaterThan(500);
  });

  it('シリーズが0件でも法務ページは出る', () => {
    const empty: Catalog = { ...CAT, seriesCount: 0, pieceCount: 0, series: [] };
    const paths = buildSite(empty, CFG).map((f) => f.path);
    expect(paths).toContain('license/index.html');
    expect(paths).toContain('index.html');
  });
});

describe('assertNoBrokenLinks', () => {
  it('全ページのサイト内リンクが実在するページを指している', () => {
    expect(() => assertNoBrokenLinks(buildSite(CAT, CFG))).not.toThrow();
  });

  it('存在しないページを指していたら落ちる', () => {
    const bad = [...buildSite(CAT, CFG), { path: 'x/index.html', html: '<a href="/nope">x</a>' }];
    expect(() => assertNoBrokenLinks(bad)).toThrow(/nope/);
  });

  it('外部リンクは検査しない', () => {
    const ok = [...buildSite(CAT, CFG), { path: 'x/index.html', html: '<a href="https://example.com">x</a>' }];
    expect(() => assertNoBrokenLinks(ok)).not.toThrow();
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/build-site.test.ts`
Expected: FAIL（`Cannot find module '../src/site/build.js'`）

- [ ] **Step 3: `src/site/build.ts` を書く**

```ts
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
      files.push({ path: `piece/${p.id}/index.html`, html: piecePage({ piece: p, series: s, cfg }) });
    }
  }
  return files;
}

/** サイト内リンクが実在するページを指しているかを機械で照合する。 */
export function assertNoBrokenLinks(files: SiteFile[]): void {
  const have = new Set(files.map((f) => '/' + f.path.replace(/index\.html$/, '').replace(/\/$/, '')));
  have.add('/'); // トップ

  const broken: string[] = [];
  for (const f of files) {
    for (const m of f.html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1]!;
      if (!href.startsWith('/')) continue; // 外部・アンカーは見ない
      const target = href.split('#')[0]!.replace(/\/$/, '') || '/';
      if (!have.has(target)) broken.push(`${f.path} → ${href}`);
    }
  }
  if (broken.length > 0) {
    throw new Error(`サイト内リンクが実在しないページを指しています:\n  ${broken.join('\n  ')}`);
  }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/build-site.test.ts`
Expected: PASS（8件）

- [ ] **Step 5: `tools/build-site.ts` を書く**

```ts
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
```

`package.json` の `scripts` に追加:

```json
"build-site": "tsx tools/build-site.ts"
```

- [ ] **Step 6: 実データで書き出す**

Run: `cd "projects/常時運用/kakera" && npm run build-site`
Expected: `12 ページを dist/site に書きました`（トップ＋法務4＋シリーズ1＋かけら6）

- [ ] **Step 7: コントラストを実測する**

書き出した HTML を実ブラウザで開き、**全テキスト要素を走査して WCAG AA を検査する**。
`mock/top.html` で27件の違反が出た前例があるので、目視で済ませない。

`.claude/launch.json` に追加:

```json
{
  "name": "kakera-site",
  "runtimeExecutable": "python3",
  "runtimeArgs": ["-m", "http.server", "8792", "--directory", "projects/常時運用/kakera/dist/site"],
  "port": 8792
}
```

`preview_start` で開き、トップ・シリーズ・かけら・ライセンスの4ページで
コントラスト走査と横スクロールの検査を行う。違反が出たら色を直して再検査。

- [ ] **Step 8: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/site/build.ts tools/build-site.ts package.json tests/build-site.test.ts && git commit -m "feat(kakera): サイトの組み立てとリンク切れの機械検査"
```

---

### Task 7: Worker（静的配信とダウンロード計数）と公開

**Files:**
- Create: `wrangler.jsonc`
- Create: `src/worker/index.ts`
- Create: `migrations/0001_download.sql`
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: `dist/site`（T6 の出力）
- Produces: Worker の `fetch`（`/api/download` のみ処理し、他は静的アセットへ委譲）

**制約の再掲**: **Workers Cache を有効にしない。** 有効にすると静的アセットのリクエストも課金対象になる。

- [ ] **Step 1: `wrangler.jsonc` を書く**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "kakera",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-08-21",
  "assets": {
    // 静的アセットへのリクエストは無料・無制限。Worker を起動させない。
    "directory": "./dist/site",
    "binding": "ASSETS",
    "not_found_handling": "404-page"
  },
  "observability": { "enabled": true },
  "d1_databases": [
    { "binding": "DB", "database_name": "kakera", "database_id": "PLACEHOLDER" }
  ]
  // Workers Cache は有効にしない。有効にすると静的アセットのリクエストも課金対象になる。
}
```

- [ ] **Step 2: D1 を作って database_id を埋める**

```bash
cd "projects/常時運用/kakera" && npx wrangler d1 create kakera
```

出力の `database_id` を `wrangler.jsonc` の `PLACEHOLDER` と差し替える。

- [ ] **Step 3: マイグレーションを書く**

`migrations/0001_download.sql`:

```sql
-- ダウンロード計数。アカウント不要なので (series, piece, day, ip_hash) で一意にして
-- 連打を数えない。設計書の「同一IP・同一シリーズは1日1回に丸める」の実装。
CREATE TABLE IF NOT EXISTS download_event (
  series_slug TEXT NOT NULL,
  piece_id    TEXT NOT NULL,
  day         TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (series_slug, piece_id, day, ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_download_series ON download_event (series_slug);
CREATE INDEX IF NOT EXISTS idx_download_day ON download_event (day);
```

適用:

```bash
cd "projects/常時運用/kakera" && npx wrangler d1 migrations apply kakera --remote
```

- [ ] **Step 4: 失敗するテストを書く**

`tests/worker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dayKey, hashIp, parseBeacon } from '../src/worker/index.js';

describe('dayKey', () => {
  it('YYYY-MM-DD を返す', () => {
    expect(dayKey(new Date('2026-08-21T15:04:05Z'))).toBe('2026-08-21');
  });
});

describe('hashIp', () => {
  it('同じIPからは同じ値', async () => {
    expect(await hashIp('1.2.3.4', 'salt')).toBe(await hashIp('1.2.3.4', 'salt'));
  });
  it('違うIPからは違う値', async () => {
    expect(await hashIp('1.2.3.4', 'salt')).not.toBe(await hashIp('1.2.3.5', 'salt'));
  });
  it('IPそのものを含まない（元に戻せない）', async () => {
    expect(await hashIp('1.2.3.4', 'salt')).not.toContain('1.2.3.4');
  });
  it('salt が違えば値も違う', async () => {
    expect(await hashIp('1.2.3.4', 'a')).not.toBe(await hashIp('1.2.3.4', 'b'));
  });
});

describe('parseBeacon', () => {
  it('正しい形は通る', () => {
    expect(parseBeacon({ series: 'nd', piece: 'nd-01' })).toEqual({ series: 'nd', piece: 'nd-01' });
  });
  it('欠けていたら null', () => {
    expect(parseBeacon({ series: 'nd' })).toBeNull();
    expect(parseBeacon({})).toBeNull();
  });
  it('形式が違えば null（SQL に渡す前に弾く）', () => {
    expect(parseBeacon({ series: 'a/b', piece: 'x' })).toBeNull();
    expect(parseBeacon({ series: 'nd', piece: "x'; DROP TABLE" })).toBeNull();
  });
  it('長すぎたら null', () => {
    expect(parseBeacon({ series: 'a'.repeat(200), piece: 'x' })).toBeNull();
  });
});
```

- [ ] **Step 5: 落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/worker.test.ts`
Expected: FAIL（`Cannot find module '../src/worker/index.js'`）

- [ ] **Step 6: `src/worker/index.ts` を書く**

```ts
/**
 * KAKERA の Worker。
 *
 * 役割は2つだけ。
 *   1. 静的アセットを配る（ASSETS へ委譲するだけ。**Worker は起動しない＝リクエストは無料**）
 *   2. /api/download でダウンロードを数える
 *
 * **Workers Cache を有効にしないこと。** 有効にすると静的アセットのリクエストも課金対象になる。
 */

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IP_SALT?: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** IP はそのまま持たない。日ごとの重複判定に必要なだけの一方向ハッシュにする。 */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SQL に渡す前に形を確かめる。境界はここ1か所。 */
export function parseBeacon(o: unknown): { series: string; piece: string } | null {
  if (typeof o !== 'object' || o === null) return null;
  const r = o as Record<string, unknown>;
  const series = r['series'];
  const piece = r['piece'];
  if (typeof series !== 'string' || typeof piece !== 'string') return null;
  if (!SLUG.test(series) || !SLUG.test(piece)) return null;
  return { series, piece };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/download' && request.method === 'POST') {
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

    // それ以外は静的アセット。Worker はここで何もしない。
    return env.ASSETS.fetch(request);
  },
};
```

- [ ] **Step 7: 通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/worker.test.ts`
Expected: PASS（10件）

- [ ] **Step 8: ダウンロードのビーコンをページに足す**

`src/site/layout.ts` の `layout()` の `</body>` の直前に追記。
**ビーコンは非同期にし、失敗してもダウンロードを止めない**（設計書の指示）。

```html
<script>
document.addEventListener('click', function (e) {
  var a = e.target.closest('a[data-download]');
  if (!a) return;
  try {
    var body = JSON.stringify({ series: a.dataset.series, piece: a.dataset.piece });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/download', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/download', { method: 'POST', body: body, keepalive: true }).catch(function () {});
    }
  } catch (_) { /* 数えられなくてもダウンロードは止めない */ }
});
</script>
```

対応するテストを `tests/site.test.ts` に追記:

```ts
it('ダウンロードのビーコンが入るが、失敗してもDLを止めない', () => {
  const h = layout({ title: 't', description: 'd', canonicalPath: '/', body: '', cfg: CFG });
  expect(h).toContain('/api/download');
  expect(h).toContain('sendBeacon');
  expect(h).toContain('catch');
});
```

- [ ] **Step 9: 全テストと型検査**

Run: `cd "projects/常時運用/kakera" && npm test && npx tsc --noEmit`
Expected: 全 PASS / `tsc` は出力なし

- [ ] **Step 10: デプロイして実際に踏む**

```bash
cd "projects/常時運用/kakera" && npm run build-site && npx wrangler deploy
```

続けて `kakera.fuuuuuuma.dev` を Worker のカスタムドメインに割り当てる
（Cloudflare ダッシュボード、または `wrangler` の routes 設定）。

**実測で確かめること**（推測で「動いた」と言わない）:

1. `curl -o /dev/null -w "%{http_code}" https://kakera.fuuuuuuma.dev/` → 200
2. トップ・シリーズ・かけら・ライセンスの4ページが 200
3. かけらページの画像が `assets.fuuuuuuma.dev` から読めている
4. `curl -X POST https://kakera.fuuuuuuma.dev/api/download -d '{"series":"night-desk","piece":"night-desk-01"}'` → 204
5. `npx wrangler d1 execute kakera --remote --command "SELECT * FROM download_event"` → 1行入っている
6. 同じ POST をもう一度 → 204 だが**行は増えない**（丸めが効いている）
7. 不正な body → 400
8. 実ブラウザでコントラストと横スクロールを再検査

- [ ] **Step 11: コミット**

```bash
cd "projects/常時運用/kakera" && git add wrangler.jsonc src/worker migrations tests/worker.test.ts src/site/layout.ts tests/site.test.ts && git commit -m "feat(kakera): Workerで静的配信とダウンロード計数、kakera.fuuuuuuma.dev で公開"
```

---

## この計画を終えたときの状態

- `kakera.fuuuuuuma.dev` で「見る・探す・落とす」が成立する
- **ページのリクエストは無料・無制限**（静的アセットなので Worker が起動しない）
- ダウンロード数が D1 に貯まり始める（同一IP・同日は1回に丸め）
- ライセンス・投稿規約・削除の基準・権利侵害の申立ての窓口が公開されている
- リンク切れとコントラストが機械で検査されている

## 次の計画に送るもの

1. **Google ログイン** → いいね・保存
2. **ランキング**（3軸 × 日次/週間/全期間 ＋ 運営が選ぶ枠）
3. **投稿フォーム**（生成元の申告・権利表明・プロンプトの禁止語検査）
4. 残り11シリーズの生成

## Self-Review

**1. Spec coverage（設計書 → タスク）**

| 設計書の節 | 対応 |
|---|---|
| 11章 トップ（シリーズ内4点をタイル） | T4 |
| 11章 シリーズページ（masonry にしない・比率明記） | T3 |
| 11章 かけら詳細（プロンプト・生成モデル・ライセンス） | T2 |
| 11章 絞り込み（用途タグ） | T4 |
| 11章 Google 画像検索の構造化データ | T2（既存 `jsonld.ts` を使用） |
| 11章 AI生成のラベル | T2・T3・T5 |
| 7章 ライセンス（CC0 を名乗らない） | T5 |
| 7章 投稿規約（非独占許諾・取り下げ後の存続） | T5 |
| 7章 同意の成立（DLボタンの直近） | T2 |
| 2章 削除基準・権利侵害の窓口 | T5 |
| 4章 ダウンロード数（同一IP・同日は1回） | T7 |
| 8章 静的配信・Cache を有効にしない | T7 |
| 白基調ゴシック・コントラストAA | T1・T6 |

**範囲外（明記済み）**: いいね・保存・ランキング・投稿・作者ページ・一括ZIP。

**2. Placeholder scan:** `wrangler.jsonc` の `database_id: "PLACEHOLDER"` は
T7 Step 2 で実値に差し替える手順を書いてある。それ以外に未確定の記述は無い。
`CONTACT` のアドレスは実在確認が必要（下の未確定事項）。

**3. Type consistency:**
- `SiteConfig` は T1 で定義し、T2〜T6 が同じ形で受け取る ✓
- `SiteFile` は T6 で定義し、`assertNoBrokenLinks` と `tools/build-site.ts` が共有 ✓
- `piecePage` / `seriesPage` / `homePage` の引数はすべて名前付きオブジェクト ✓
- `imageObjectLd` は既存の `src/build/jsonld.ts` のものをそのまま使う（引数順も既存どおり）✓
- `parseBeacon` の戻り値 `{series, piece}` は Worker 本体の bind 順と一致 ✓

## 未確定のまま残すもの

- **`kakera@fuuuuuuma.dev` が実在するか未確認。** 権利侵害の窓口として公開するアドレスなので、
  受信できることを確かめてから公開する。受信できないなら別のアドレスに差し替える
- **元PNG（2048×1152）を配るかどうかが未決。** この計画では書き出した JPEG のみを配る。
  配ることにした場合は `writeVariants` に `source` を足し、R2 へアップロードし直す
