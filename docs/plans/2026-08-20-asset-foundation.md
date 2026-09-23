# KAKERA 素材の土台 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** シリーズ定義ファイルから、機械検品を通った素材と型付きカタログJSONを作る土台を組む。素材が「トーンが揃っている」ことを目視ではなく数値で裏づけられる状態にする。

**Architecture:** Node/TypeScript の純関数を核にした CLI 群。色の距離計算・比率判定・アルファ判定は外部プロセスなしの純関数にしてテストを速く保ち、動画と音だけ ffmpeg/ffprobe を子プロセスで叩く。カタログの型はこのパッケージが単一ソースになり、後続の Web アプリ計画がそのまま import する。

**Tech Stack:** Node 22 / TypeScript / vitest / zod / sharp / ffmpeg・ffprobe（`~/.local/bin` に導入済み）

**Spec:** `projects/常時運用/kakera/docs/design-2026-08-20.md`（v1・承認済み）

## この計画の位置づけ

設計書の Phase 1 は3つの独立した部分からなる。本計画はそのうち1つ目だけを扱う。

1. **素材の土台**（本計画） — スキーマ・機械検品・比率書き出し・カタログ生成
2. Web アプリ（次の計画） — Next.js。本計画が吐く `catalog.json` を消費する
3. 計数バックエンド（その次の計画） — Workers + D1。いいねとダウンロード数

1つ目を先にやる理由は2つ。**設計の中で最も未検証の主張が「トーンの揃いを機械判定できる」であり、これが崩れると製品の芯（揃いが堀）が崩れる**こと。もう1つは、生成にはクレジットがかかるので、**12シリーズぶん生成する前にパイプラインを1シリーズで確かめたい**こと。本計画はネットワークもクレジットも使わずに完結する。

## Global Constraints

設計書からの引き写し。全タスクの要件に含まれるものとして扱う。

- **格付け A / A− の生成元のみ公開可**。`higgsfield`（画像・動画）/ `ace-step`（BGM）/ `stable-audio-open`（SE）。`grok`・`gemini` は B、`pika` は C、**`musicgen` は D で使用禁止**（重みが CC-BY-NC 4.0）
- **プロンプトは全シリーズ公開**（`promptPublic` は常に `true`）
- **人物素材は扱わない**。手元・後ろ姿・シルエットまで
- シリーズは **6〜12 のかけら**で構成する
- 静止画は**長辺 2048px 以上**で生成し、`16:9`(1920×1080) / `9:16` / `1:1` を書き出す
- **サムネ用途のかけらは 1280×720 を必ず含める**
- **透過PNGは元の比率のまま**。アルファを保持したまま各比率を作らない（切れるため）
- ライセンスは `kakera-free` の1種類のみ（CC0 とは名乗らない）
- 文言に「独占素材」「ここでしか手に入らない1枚」を使わない。書けるのは「この揃いはここだけ」
- 対象の言い方は「動画編集者とサムネイル制作者のための」。片方だけを名指ししない
- **閾値をベタ書きで決めない。** 先に測る道具を作り、実測した値を条件ごと記録してから設定する

## File Structure

```
projects/常時運用/kakera/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── src/
│   ├── catalog/
│   │   ├── generators.ts    生成元の格付け表と公開可否の判定
│   │   └── schema.ts        SeriesDef / PieceDef / Catalog の zod スキーマと型
│   ├── inspect/
│   │   ├── color.ts         sRGB→OKLab、トーンヒストグラム、Hellinger距離（純関数）
│   │   ├── image.ts         静止画の検品（解像度・比率・アルファ実在）
│   │   ├── variants.ts      比率バリアントの書き出し
│   │   ├── tone.ts          シリーズ内のトーン揃い判定
│   │   ├── video.ts         ループのシームレス判定（ffmpeg）
│   │   ├── audio.ts         無音・クリップ検査（ffmpeg）
│   │   └── series.ts        全ゲートの統合
│   └── build/
│       └── catalog.ts       定義＋実ファイル → catalog.json
├── tools/
│   ├── inspect.ts           CLI: シリーズを検品してレポートを出す
│   ├── measure-tone.ts      CLI: トーン距離の分布を出す（閾値決定用）
│   └── build-catalog.ts     CLI: カタログを吐く
├── series/
│   └── <slug>/series.json   シリーズ定義（トーン宣言＋プロンプト）
│   └── <slug>/pieces/       生成物（git 管理外・のちに R2 へ）
├── config/
│   └── thresholds.json      実測してから埋める閾値
└── tests/
    └── *.test.ts
```

**分け方の理由:** `color.ts` は外部プロセスにもファイルにも触らない純関数だけにする。ここがこのパッケージで唯一むずかしい計算で、速いテストを何十回も回せることが正しさの担保になる。ffmpeg を叩く `video.ts` / `audio.ts` は遅いので、純関数から切り離しておく。

---

### Task 1: プロジェクト土台とカタログスキーマ

**Files:**
- Create: `projects/常時運用/kakera/package.json`
- Create: `projects/常時運用/kakera/tsconfig.json`
- Create: `projects/常時運用/kakera/vitest.config.ts`
- Create: `projects/常時運用/kakera/.gitignore`
- Create: `projects/常時運用/kakera/src/catalog/generators.ts`
- Create: `projects/常時運用/kakera/src/catalog/schema.ts`
- Test: `projects/常時運用/kakera/tests/schema.test.ts`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces:
  - `KINDS: readonly ['still','loop','se','bgm']`, `type Kind`
  - `type Grade = 'A' | 'A-' | 'B' | 'C' | 'D'`
  - `GENERATORS: Record<string, GeneratorEntry>`（`GeneratorEntry = { id, label, grade, kinds, note }`）
  - `assertPublishableGenerator(serviceId: string, kind: Kind): void` — 公開不可なら `Error` を投げる
  - `SeriesDefSchema`, `PieceDefSchema`, `type SeriesDef`, `type PieceDef`
  - `type Catalog`, `type CatalogSeries`, `type CatalogPiece`, `type CatalogVariant`

- [x] **Step 1: パッケージの雛形を作る**

`package.json`:

```json
{
  "name": "kakera",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "inspect": "tsx tools/inspect.ts",
    "measure-tone": "tsx tools/measure-tone.ts",
    "build-catalog": "tsx tools/build-catalog.ts"
  },
  "dependencies": {
    "sharp": "^0.35.3",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5",
    "@types/node": "^22.10.5"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "tools", "tests"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
```

`.gitignore`:

```
node_modules/
series/*/pieces/
series/*/variants/
dist/
*.log
```

- [x] **Step 2: 依存を入れる**

Run: `cd "projects/常時運用/kakera" && npm install`
Expected: `node_modules` ができ、`sharp` が darwin-arm64 の prebuilt を取得して終了コード 0

続けて `npm audit` を走らせ、`found 0 vulnerabilities` を確かめる。**sharp は 0.35.0 未満だと libvips 由来の高深刻度 CVE を抱える**（CVE-2026-33327 / 33328 / 35590 / 35591）。Phase 2 で他人が上げた画像を通す前提なので、ここは落とせない。

- [x] **Step 3: 生成元の格付け表を書く（失敗するテストを先に）**

`tests/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GENERATORS, assertPublishableGenerator } from '../src/catalog/generators.js';

describe('生成元の格付け', () => {
  it('musicgen は使用禁止（重みが CC-BY-NC 4.0）', () => {
    expect(GENERATORS['musicgen']?.grade).toBe('D');
    expect(() => assertPublishableGenerator('musicgen', 'bgm')).toThrow(/CC-BY-NC/);
  });

  it('grok と gemini は B なので公開に使えない', () => {
    expect(() => assertPublishableGenerator('grok', 'still')).toThrow(/格付け B/);
    expect(() => assertPublishableGenerator('gemini', 'still')).toThrow(/格付け B/);
  });

  it('higgsfield は静止画とループで通る', () => {
    expect(() => assertPublishableGenerator('higgsfield', 'still')).not.toThrow();
    expect(() => assertPublishableGenerator('higgsfield', 'loop')).not.toThrow();
  });

  it('ace-step は BGM、stable-audio-open は SE で通る', () => {
    expect(() => assertPublishableGenerator('ace-step', 'bgm')).not.toThrow();
    expect(() => assertPublishableGenerator('stable-audio-open', 'se')).not.toThrow();
  });

  it('格付けが A でも、想定していない種別なら弾く', () => {
    expect(() => assertPublishableGenerator('ace-step', 'still')).toThrow(/種別/);
  });

  it('知らない生成元は弾く', () => {
    expect(() => assertPublishableGenerator('midjourney', 'still')).toThrow(/未登録/);
  });
});
```

- [x] **Step 4: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/schema.test.ts`
Expected: FAIL（`Failed to resolve import "../src/catalog/generators.js"`）

- [x] **Step 5: `src/catalog/generators.ts` を書く**

```ts
export const KINDS = ['still', 'loop', 'se', 'bgm'] as const;
export type Kind = (typeof KINDS)[number];

export type Grade = 'A' | 'A-' | 'B' | 'C' | 'D';

export interface GeneratorEntry {
  id: string;
  label: string;
  grade: Grade;
  /** この生成元で作ってよい種別 */
  kinds: Kind[];
  /** 格付けの根拠。弾いたときのメッセージに出す */
  note: string;
}

/**
 * 判定基準は「出力物を第三者へ再配布・サブライセンスできることが条文で確認できるか」。
 * 根拠は docs/design-2026-08-20.md の「生成元の格付け」に置いてある。
 */
export const GENERATORS: Record<string, GeneratorEntry> = {
  higgsfield: {
    id: 'higgsfield',
    label: 'Higgsfield',
    grade: 'A',
    kinds: ['still', 'loop'],
    note: '§4.4 で所有権を主張せず、第三者への transfer / sublicense を明示的に許している',
  },
  'ace-step': {
    id: 'ace-step',
    label: 'ACE-Step v1-3.5B',
    grade: 'A',
    kinds: ['bgm'],
    note: 'Apache-2.0。条件なしで商用可・再配布可',
  },
  'stable-audio-open': {
    id: 'stable-audio-open',
    label: 'Stable Audio Open',
    grade: 'A-',
    kinds: ['se'],
    note: '出力は利用者のもの。年商100万USD未満は無料。出力の配布に帰属表示は不要',
  },
  grok: {
    id: 'grok',
    label: 'Grok / xAI',
    grade: 'B',
    kinds: [],
    note: 'xAI が帰属表示を求めるため、受け取った人に不確実な義務を負わせる',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini / Imagen',
    grade: 'B',
    kinds: [],
    note: 'SynthID 透かしが常に埋まり無効化できない',
  },
  pika: {
    id: 'pika',
    label: 'Pika',
    grade: 'C',
    kinds: [],
    note: 'AI Self の出力は書面同意なしの再配布・収益化が禁止',
  },
  musicgen: {
    id: 'musicgen',
    label: 'MusicGen / AudioCraft',
    grade: 'D',
    kinds: [],
    note: 'コードは MIT だが重みが CC-BY-NC 4.0 で商用不可',
  },
};

const PUBLISHABLE: Grade[] = ['A', 'A-'];

/** 公開できない生成元・種別なら理由つきで投げる。 */
export function assertPublishableGenerator(serviceId: string, kind: Kind): void {
  const g = GENERATORS[serviceId];
  if (!g) {
    throw new Error(
      `生成元 "${serviceId}" は未登録です。格付けを確かめて src/catalog/generators.ts に足してください。`,
    );
  }
  if (!PUBLISHABLE.includes(g.grade)) {
    throw new Error(
      `${g.label} は格付け ${g.grade} なので公開できません: ${g.note}`,
    );
  }
  if (!g.kinds.includes(kind)) {
    throw new Error(
      `${g.label} は種別 "${kind}" に使えません（使えるのは ${g.kinds.join(', ') || 'なし'}）`,
    );
  }
}
```

- [x] **Step 6: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/schema.test.ts`
Expected: PASS（6件）

- [x] **Step 7: スキーマの失敗するテストを足す**

`tests/schema.test.ts` の末尾に追記:

```ts
import { SeriesDefSchema } from '../src/catalog/schema.js';

const valid = {
  slug: 'night-desk',
  title: '夜の書斎',
  description: '解説動画のインサートに敷く、夜のデスクまわり。',
  audience: ['editor'],
  creator: '@fuuuuuuma',
  license: 'kakera-free',
  tone: { light: '低い色温度の点光源', colorTemp: '2700K 前後', framing: '寄りの俯瞰', texture: '木とガラス' },
  generator: { service: 'higgsfield', model: 'soul', version: '2026-08' },
  promptPublic: true,
  pieces: Array.from({ length: 6 }, (_, i) => ({
    id: `night-desk-${String(i + 1).padStart(2, '0')}`,
    kind: 'still',
    file: `pieces/night-desk-${String(i + 1).padStart(2, '0')}.png`,
    prompt: 'a dim wooden desk at night, warm point light, no people',
    useTags: ['Bロール'],
  })),
};

describe('シリーズ定義スキーマ', () => {
  it('正しい定義は通る', () => {
    expect(SeriesDefSchema.parse(valid).slug).toBe('night-desk');
  });

  it('かけらが6点未満なら弾く', () => {
    const bad = { ...valid, pieces: valid.pieces.slice(0, 5) };
    expect(() => SeriesDefSchema.parse(bad)).toThrow();
  });

  it('かけらが12点を超えたら弾く', () => {
    const bad = { ...valid, pieces: [...valid.pieces, ...valid.pieces, ...valid.pieces] };
    expect(() => SeriesDefSchema.parse(bad)).toThrow();
  });

  it('promptPublic が false なら弾く（全シリーズ公開が前提）', () => {
    const bad = { ...valid, promptPublic: false };
    expect(() => SeriesDefSchema.parse(bad)).toThrow();
  });

  it('プロンプトが空のかけらは弾く', () => {
    const bad = { ...valid, pieces: [{ ...valid.pieces[0]!, prompt: '' }, ...valid.pieces.slice(1)] };
    expect(() => SeriesDefSchema.parse(bad)).toThrow();
  });

  it('kakera-free 以外のライセンスは弾く', () => {
    const bad = { ...valid, license: 'cc0' };
    expect(() => SeriesDefSchema.parse(bad)).toThrow();
  });

  it('alpha と useTags は省略できて既定値が入る', () => {
    const parsed = SeriesDefSchema.parse(valid);
    expect(parsed.pieces[0]!.alpha).toBe(false);
  });
});
```

- [x] **Step 8: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/schema.test.ts`
Expected: FAIL（`Failed to resolve import "../src/catalog/schema.js"`）

- [x] **Step 9: `src/catalog/schema.ts` を書く**

```ts
import { z } from 'zod';
import { KINDS, type Kind } from './generators.js';

export const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export const GeneratorRefSchema = z.object({
  service: z.string().min(1),
  model: z.string().min(1),
  version: z.string().min(1).default('unknown'),
});

export const PieceDefSchema = z.object({
  id: z.string().regex(SLUG),
  kind: z.enum(KINDS),
  /** シリーズディレクトリからの相対パス */
  file: z.string().min(1),
  prompt: z.string().min(1),
  seed: z.number().int().optional(),
  negativePrompt: z.string().optional(),
  /** 透過PNGか。true なら比率バリアントを作らない */
  alpha: z.boolean().default(false),
  /** サムネ用途。true なら 1280×720 を必ず書き出す */
  forThumbnail: z.boolean().default(false),
  useTags: z.array(z.string()).default([]),
});

export const ToneSchema = z.object({
  light: z.string().min(1),
  colorTemp: z.string().min(1),
  framing: z.string().min(1),
  texture: z.string().min(1),
});

export const SeriesDefSchema = z.object({
  slug: z.string().regex(SLUG),
  title: z.string().min(1),
  description: z.string().min(1),
  audience: z.array(z.enum(['editor', 'thumbnail'])).min(1),
  creator: z.string().regex(/^@[a-z0-9_]+$/),
  license: z.literal('kakera-free'),
  tone: ToneSchema,
  generator: GeneratorRefSchema,
  /** 全シリーズでプロンプトを公開する。false は許さない */
  promptPublic: z.literal(true),
  pieces: z.array(PieceDefSchema).min(6).max(12),
});

export type GeneratorRef = z.infer<typeof GeneratorRefSchema>;
export type PieceDef = z.infer<typeof PieceDefSchema>;
export type SeriesDef = z.infer<typeof SeriesDefSchema>;

/** 書き出したファイル1つ。 */
export interface CatalogVariant {
  ratio: '16:9' | '9:16' | '1:1' | 'source';
  w: number;
  h: number;
  key: string;
  bytes: number;
}

export interface CatalogPiece {
  id: string;
  kind: Kind;
  prompt: string;
  seed?: number;
  alpha: boolean;
  useTags: string[];
  sha256: string;
  bytes: number;
  mime: string;
  durationMs?: number;
  loopSeamless?: boolean;
  variants: CatalogVariant[];
}

export interface CatalogSeries {
  slug: string;
  title: string;
  description: string;
  audience: ('editor' | 'thumbnail')[];
  creator: string;
  license: 'kakera-free';
  tone: z.infer<typeof ToneSchema>;
  generator: GeneratorRef;
  promptPublic: true;
  pieceCount: number;
  toneMaxDistance: number;
  pieces: CatalogPiece[];
}

export interface Catalog {
  version: 1;
  builtAt: string;
  seriesCount: number;
  pieceCount: number;
  series: CatalogSeries[];
}
```

- [x] **Step 10: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run`
Expected: PASS（13件）

- [x] **Step 11: コミット**

```bash
cd "projects/常時運用/kakera" && git add package.json tsconfig.json vitest.config.ts .gitignore src/catalog tests/schema.test.ts && git commit -m "feat(kakera): カタログの型と生成元の法務ゲートを置く"
```

---

### Task 2: 色のトーン距離（純関数）

シリーズが「揃っている」ことを数値で言えるようにする。ここがこのパッケージで唯一むずかしい計算なので、ファイルにも子プロセスにも触らない純関数として独立させる。

**Files:**
- Create: `projects/常時運用/kakera/src/inspect/color.ts`
- Test: `projects/常時運用/kakera/tests/color.test.ts`

**Interfaces:**
- Consumes: なし（純関数）
- Produces:
  - `TONE_BINS: 54`
  - `srgbToLinear(c: number): number`
  - `linearSrgbToOklab(r: number, g: number, b: number): { L: number; a: number; b: number }`
  - `toneHistogram(data: Uint8Array, channels: 3 | 4): Float64Array`（長さ 54・合計 1）
  - `hellinger(p: Float64Array, q: Float64Array): number`（0〜1）
  - `centroid(hs: Float64Array[]): Float64Array`

- [x] **Step 1: 失敗するテストを書く**

`tests/color.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TONE_BINS, toneHistogram, hellinger, centroid, linearSrgbToOklab, srgbToLinear } from '../src/inspect/color.js';

/** 単色で満たした RGB(A) バッファを作る */
function fill(px: number, rgba: [number, number, number, number?]): { data: Uint8Array; ch: 3 | 4 } {
  const ch = (rgba[3] === undefined ? 3 : 4) as 3 | 4;
  const data = new Uint8Array(px * ch);
  for (let i = 0; i < px; i++) {
    data[i * ch] = rgba[0];
    data[i * ch + 1] = rgba[1];
    data[i * ch + 2] = rgba[2];
    if (ch === 4) data[i * ch + 3] = rgba[3]!;
  }
  return { data, ch };
}

describe('OKLab', () => {
  it('白は L がほぼ 1、彩度がほぼ 0', () => {
    const { L, a, b } = linearSrgbToOklab(srgbToLinear(1), srgbToLinear(1), srgbToLinear(1));
    expect(L).toBeCloseTo(1, 2);
    expect(Math.hypot(a, b)).toBeLessThan(0.01);
  });

  it('黒は L がほぼ 0', () => {
    expect(linearSrgbToOklab(0, 0, 0).L).toBeCloseTo(0, 5);
  });
});

describe('トーンヒストグラム', () => {
  it('長さは 54 で、合計は 1', () => {
    const { data, ch } = fill(100, [200, 30, 30]);
    const h = toneHistogram(data, ch);
    expect(h.length).toBe(TONE_BINS);
    expect([...h].reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });

  it('灰色は無彩色レーン（48〜53）に入る', () => {
    const { data, ch } = fill(100, [128, 128, 128]);
    const h = toneHistogram(data, ch);
    const achromatic = [...h].slice(48).reduce((s, v) => s + v, 0);
    expect(achromatic).toBeCloseTo(1, 6);
  });

  it('鮮やかな赤は有彩レーン（0〜47）に入る', () => {
    const { data, ch } = fill(100, [220, 20, 20]);
    const h = toneHistogram(data, ch);
    const chromatic = [...h].slice(0, 48).reduce((s, v) => s + v, 0);
    expect(chromatic).toBeCloseTo(1, 6);
  });

  it('ほぼ透明な画素は数えない', () => {
    const px = 100;
    const data = new Uint8Array(px * 4);
    for (let i = 0; i < px; i++) {
      const opaque = i < 50;
      data[i * 4] = opaque ? 220 : 20;
      data[i * 4 + 1] = opaque ? 20 : 220;
      data[i * 4 + 2] = 20;
      data[i * 4 + 3] = opaque ? 255 : 0;
    }
    const h = toneHistogram(data, 4);
    const onlyRed = toneHistogram(fill(50, [220, 20, 20, 255]).data, 4);
    expect(hellinger(h, onlyRed)).toBeCloseTo(0, 6);
  });

  it('全部透明なら合計 0 の空ヒストグラムを返す（0除算しない）', () => {
    const h = toneHistogram(fill(10, [10, 10, 10, 0]).data, 4);
    expect([...h].reduce((s, v) => s + v, 0)).toBe(0);
  });
});

describe('Hellinger 距離', () => {
  it('同じヒストグラム同士は 0', () => {
    const h = toneHistogram(fill(64, [90, 120, 200]).data, 3);
    expect(hellinger(h, h)).toBeCloseTo(0, 6);
  });

  it('赤一色と青一色はほぼ 1', () => {
    const r = toneHistogram(fill(64, [220, 20, 20]).data, 3);
    const b = toneHistogram(fill(64, [20, 20, 220]).data, 3);
    expect(hellinger(r, b)).toBeGreaterThan(0.95);
  });

  it('近い色どうしは遠い色どうしより小さい', () => {
    const a = toneHistogram(fill(64, [200, 60, 40]).data, 3);
    const near = toneHistogram(fill(64, [210, 80, 45]).data, 3);
    const far = toneHistogram(fill(64, [30, 200, 90]).data, 3);
    expect(hellinger(a, near)).toBeLessThan(hellinger(a, far));
  });
});

describe('centroid', () => {
  it('同じもの3つの重心は元と同じ', () => {
    const h = toneHistogram(fill(64, [120, 90, 200]).data, 3);
    expect(hellinger(centroid([h, h, h]), h)).toBeCloseTo(0, 6);
  });

  it('重心の合計は 1', () => {
    const a = toneHistogram(fill(64, [200, 60, 40]).data, 3);
    const b = toneHistogram(fill(64, [30, 200, 90]).data, 3);
    expect([...centroid([a, b])].reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });
});
```

- [x] **Step 2: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/color.test.ts`
Expected: FAIL（`Failed to resolve import "../src/inspect/color.js"`）

- [x] **Step 3: `src/inspect/color.ts` を書く**

```ts
/**
 * シリーズが「トーンが揃っている」ことを数値で言うための計算。
 * 目視では判断できないので、ここが揃いの主張の裏づけになる。
 *
 * 作りの方針:
 *   sRGB → OKLab に変換して、明度6段 × 色相8方向の 48 レーンに投票する。
 *   彩度が低い画素は色相が不安定なので、明度6段だけの無彩色レーン（48〜53）へ回す。
 *   ヒストグラム同士は Hellinger 距離で比べる（0〜1 に収まるので閾値が読みやすい）。
 */

export const L_BINS = 6;
export const H_BINS = 8;
export const TONE_BINS = L_BINS * H_BINS + L_BINS; // 54

/** 彩度がこれ未満の画素は色相を信じない */
const CHROMA_FLOOR = 0.02;
/** アルファがこれ未満の画素は数えない */
const ALPHA_FLOOR = 8;

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearSrgbToOklab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/**
 * 生のピクセル列からトーンヒストグラムを作る。
 * 数えた画素が 0 のときは合計 0 の配列をそのまま返す（0除算しない）。
 */
export function toneHistogram(data: Uint8Array, channels: 3 | 4): Float64Array {
  const hist = new Float64Array(TONE_BINS);
  let counted = 0;

  for (let i = 0; i + channels <= data.length; i += channels) {
    if (channels === 4 && data[i + 3]! < ALPHA_FLOOR) continue;

    const { L, a, b } = linearSrgbToOklab(
      srgbToLinear(data[i]! / 255),
      srgbToLinear(data[i + 1]! / 255),
      srgbToLinear(data[i + 2]! / 255),
    );

    const lBin = Math.min(L_BINS - 1, Math.max(0, Math.floor(L * L_BINS)));
    const chroma = Math.hypot(a, b);

    if (chroma < CHROMA_FLOOR) {
      hist[L_BINS * H_BINS + lBin]! += 1;
    } else {
      const hue = Math.atan2(b, a); // -π..π
      const hBin = Math.min(H_BINS - 1, Math.floor(((hue + Math.PI) / (2 * Math.PI)) * H_BINS));
      hist[lBin * H_BINS + hBin]! += 1;
    }
    counted++;
  }

  if (counted > 0) {
    for (let k = 0; k < TONE_BINS; k++) hist[k]! /= counted;
  }
  return hist;
}

/** 0（同じ）〜 1（まったく重ならない） */
export function hellinger(p: Float64Array, q: Float64Array): number {
  let bc = 0;
  const n = Math.min(p.length, q.length);
  for (let i = 0; i < n; i++) bc += Math.sqrt(p[i]! * q[i]!);
  return Math.sqrt(Math.max(0, 1 - bc));
}

/** シリーズの中心となるトーン。 */
export function centroid(hs: Float64Array[]): Float64Array {
  const c = new Float64Array(TONE_BINS);
  for (const h of hs) {
    for (let i = 0; i < TONE_BINS; i++) c[i]! += h[i]!;
  }
  let sum = 0;
  for (let i = 0; i < TONE_BINS; i++) sum += c[i]!;
  if (sum > 0) {
    for (let i = 0; i < TONE_BINS; i++) c[i]! /= sum;
  }
  return c;
}
```

- [x] **Step 4: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/color.test.ts`
Expected: PASS（12件）

- [x] **Step 5: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/inspect/color.ts tests/color.test.ts && git commit -m "feat(kakera): トーンの揃いを測る色距離（OKLab + Hellinger）"
```

---

### Task 3: 静止画の検品

**Files:**
- Create: `projects/常時運用/kakera/src/inspect/image.ts`
- Test: `projects/常時運用/kakera/tests/image.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `interface ImageReport { path: string; width: number; height: number; ratio: string; hasAlphaChannel: boolean; hasRealAlpha: boolean; issues: string[] }`
  - `ratioLabel(w: number, h: number): string`
  - `inspectImage(path: string, opts: { alpha: boolean; minLongEdge?: number }): Promise<ImageReport>`

`hasAlphaChannel` と `hasRealAlpha` を分けるのが要。**PNG はアルファチャンネルを持っていても中身が全部 255 のことがある**ので、チャンネルの有無だけでは「透過素材です」と言えない。

- [x] **Step 1: 失敗するテストを書く**

`tests/image.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { inspectImage, ratioLabel } from '../src/inspect/image.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kakera-img-'));

  await sharp({ create: { width: 2400, height: 1350, channels: 3, background: { r: 40, g: 60, b: 120 } } })
    .png().toFile(join(dir, 'wide.png'));

  await sharp({ create: { width: 800, height: 450, channels: 3, background: { r: 40, g: 60, b: 120 } } })
    .png().toFile(join(dir, 'small.png'));

  // アルファチャンネルはあるが全部不透明 = 透過素材ではない
  await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } })
    .png().toFile(join(dir, 'fake-alpha.png'));

  // 実際に抜けている
  await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0 } } })
    .composite([{
      input: await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer(),
      top: 100, left: 100,
    }])
    .png().toFile(join(dir, 'real-alpha.png'));
});

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('ratioLabel', () => {
  it('1920×1080 は 16:9', () => expect(ratioLabel(1920, 1080)).toBe('16:9'));
  it('1080×1920 は 9:16', () => expect(ratioLabel(1080, 1920)).toBe('9:16'));
  it('512×512 は 1:1', () => expect(ratioLabel(512, 512)).toBe('1:1'));
  it('端数が出る比率はそのまま分数で返す', () => expect(ratioLabel(1000, 333)).toBe('1000:333'));
});

describe('inspectImage', () => {
  it('十分な大きさの静止画は指摘なしで通る', async () => {
    const r = await inspectImage(join(dir, 'wide.png'), { alpha: false });
    expect(r.width).toBe(2400);
    expect(r.ratio).toBe('16:9');
    expect(r.issues).toEqual([]);
  });

  it('長辺が 2048px 未満なら指摘する', async () => {
    const r = await inspectImage(join(dir, 'small.png'), { alpha: false });
    expect(r.issues.join()).toMatch(/長辺/);
  });

  it('アルファチャンネルがあっても中身が全部不透明なら透過素材と認めない', async () => {
    const r = await inspectImage(join(dir, 'fake-alpha.png'), { alpha: true });
    expect(r.hasAlphaChannel).toBe(true);
    expect(r.hasRealAlpha).toBe(false);
    expect(r.issues.join()).toMatch(/透過/);
  });

  it('本当に抜けている透過PNGは通る', async () => {
    const r = await inspectImage(join(dir, 'real-alpha.png'), { alpha: true, minLongEdge: 512 });
    expect(r.hasRealAlpha).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('透過を宣言していないのに抜けていたら指摘する', async () => {
    const r = await inspectImage(join(dir, 'real-alpha.png'), { alpha: false, minLongEdge: 512 });
    expect(r.issues.join()).toMatch(/宣言/);
  });
});
```

- [x] **Step 2: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/image.test.ts`
Expected: FAIL（`Failed to resolve import "../src/inspect/image.js"`）

- [x] **Step 3: `src/inspect/image.ts` を書く**

```ts
import sharp from 'sharp';

export interface ImageReport {
  path: string;
  width: number;
  height: number;
  ratio: string;
  hasAlphaChannel: boolean;
  /** 実際に透けている画素があるか。チャンネルの有無とは別物 */
  hasRealAlpha: boolean;
  issues: string[];
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function ratioLabel(w: number, h: number): string {
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

export const DEFAULT_MIN_LONG_EDGE = 2048;
/** これ未満のアルファ値が1つでもあれば「本当に抜けている」とみなす */
const ALPHA_TRANSPARENT_BELOW = 250;

export async function inspectImage(
  path: string,
  opts: { alpha: boolean; minLongEdge?: number },
): Promise<ImageReport> {
  const minLongEdge = opts.minLongEdge ?? DEFAULT_MIN_LONG_EDGE;
  const img = sharp(path);
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const issues: string[] = [];

  if (width === 0 || height === 0) {
    return { path, width, height, ratio: '0:0', hasAlphaChannel: false, hasRealAlpha: false, issues: ['寸法を読めません'] };
  }

  const stats = await img.stats();
  const hasAlphaChannel = stats.channels.length === 4;
  const alphaMin = hasAlphaChannel ? stats.channels[3]!.min : 255;
  const hasRealAlpha = hasAlphaChannel && alphaMin < ALPHA_TRANSPARENT_BELOW;

  if (Math.max(width, height) < minLongEdge) {
    issues.push(`長辺が ${Math.max(width, height)}px で、必要な ${minLongEdge}px に届いていません`);
  }
  if (opts.alpha && !hasRealAlpha) {
    issues.push(
      hasAlphaChannel
        ? '透過PNGと宣言されていますが、アルファチャンネルの中身が全部不透明です'
        : '透過PNGと宣言されていますが、アルファチャンネルがありません',
    );
  }
  if (!opts.alpha && hasRealAlpha) {
    issues.push('透過を宣言していませんが、実際に抜けている画素があります');
  }

  return { path, width, height, ratio: ratioLabel(width, height), hasAlphaChannel, hasRealAlpha, issues };
}
```

- [x] **Step 4: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/image.test.ts`
Expected: PASS（9件）

- [x] **Step 5: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/inspect/image.ts tests/image.test.ts && git commit -m "feat(kakera): 静止画の検品（アルファは実在まで見る）"
```

---

### Task 4: 比率バリアントの書き出し

**Files:**
- Create: `projects/常時運用/kakera/src/inspect/variants.ts`
- Test: `projects/常時運用/kakera/tests/variants.test.ts`

**Interfaces:**
- Consumes: `CatalogVariant`（Task 1）
- Produces:
  - `writeVariants(srcPath: string, outDir: string, baseName: string, opts: { alpha: boolean; forThumbnail: boolean }): Promise<CatalogVariant[]>`

**書き出す組み合わせ:**

| 条件 | 出すもの |
|---|---|
| `alpha: true` | `source` のみ（元の比率のまま。切ると絵が欠ける） |
| `alpha: false` | `16:9` 1920×1080 / `9:16` 1080×1920 / `1:1` 1080×1080 |
| `forThumbnail: true` を足す | `16:9` を 1280×720 でも出す（YouTube サムネの実寸） |

切り抜きは `fit: 'cover'` に `position: sharp.strategy.attention` を使う。**中央固定にしない**理由は、生成画像の主題が中央にあるとは限らないため。

- [x] **Step 1: 失敗するテストを書く**

`tests/variants.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { writeVariants } from '../src/inspect/variants.js';

let dir: string;
let out: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kakera-var-'));
  out = join(dir, 'out');
  await sharp({ create: { width: 2400, height: 1350, channels: 3, background: { r: 30, g: 90, b: 160 } } })
    .png().toFile(join(dir, 'src.png'));
  await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 240, g: 200, b: 60, alpha: 0.4 } } })
    .png().toFile(join(dir, 'alpha.png'));
});

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('writeVariants', () => {
  it('不透明な静止画は 16:9 / 9:16 / 1:1 の3つを出す', async () => {
    const vs = await writeVariants(join(dir, 'src.png'), out, 'a', { alpha: false, forThumbnail: false });
    expect(vs.map(v => `${v.ratio}@${v.w}x${v.h}`).sort()).toEqual(
      ['16:9@1920x1080', '1:1@1080x1080', '9:16@1080x1920'].sort(),
    );
    for (const v of vs) expect(v.bytes).toBeGreaterThan(0);
  });

  it('サムネ用途なら 1280×720 も出す', async () => {
    const vs = await writeVariants(join(dir, 'src.png'), out, 'b', { alpha: false, forThumbnail: true });
    expect(vs.some(v => v.w === 1280 && v.h === 720)).toBe(true);
    expect(vs.length).toBe(4);
  });

  it('透過PNGは source だけを出す（切らない）', async () => {
    const vs = await writeVariants(join(dir, 'alpha.png'), out, 'c', { alpha: true, forThumbnail: false });
    expect(vs.length).toBe(1);
    expect(vs[0]!.ratio).toBe('source');
    expect(vs[0]!.w).toBe(2048);
  });

  it('透過PNGはアルファを保ったまま書き出す', async () => {
    const vs = await writeVariants(join(dir, 'alpha.png'), out, 'd', { alpha: true, forThumbnail: false });
    const stats = await sharp(join(out, vs[0]!.key.split('/').pop()!)).stats();
    expect(stats.channels.length).toBe(4);
    expect(stats.channels[3]!.min).toBeLessThan(250);
  });

  it('書き出したファイルは実際にその寸法になっている', async () => {
    const vs = await writeVariants(join(dir, 'src.png'), out, 'e', { alpha: false, forThumbnail: false });
    const nine = vs.find(v => v.ratio === '9:16')!;
    const meta = await sharp(join(out, nine.key.split('/').pop()!)).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });
});
```

- [x] **Step 2: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/variants.test.ts`
Expected: FAIL（`Failed to resolve import "../src/inspect/variants.js"`）

- [x] **Step 3: `src/inspect/variants.ts` を書く**

```ts
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CatalogVariant } from '../catalog/schema.js';

interface Target {
  ratio: CatalogVariant['ratio'];
  w: number;
  h: number;
  suffix: string;
}

const BASE_TARGETS: Target[] = [
  { ratio: '16:9', w: 1920, h: 1080, suffix: '16x9' },
  { ratio: '9:16', w: 1080, h: 1920, suffix: '9x16' },
  { ratio: '1:1', w: 1080, h: 1080, suffix: '1x1' },
];

/** YouTube サムネの実寸 */
const THUMBNAIL_TARGET: Target = { ratio: '16:9', w: 1280, h: 720, suffix: '1280x720' };

export async function writeVariants(
  srcPath: string,
  outDir: string,
  baseName: string,
  opts: { alpha: boolean; forThumbnail: boolean },
): Promise<CatalogVariant[]> {
  await mkdir(outDir, { recursive: true });
  const out: CatalogVariant[] = [];

  // 透過は切らない。切ると絵が欠けるうえ、重ねる用途では元の比率が意味を持つ。
  if (opts.alpha) {
    const meta = await sharp(srcPath).metadata();
    const name = `${baseName}-source.png`;
    const dest = join(outDir, name);
    await sharp(srcPath).png({ compressionLevel: 9 }).toFile(dest);
    const { size } = await stat(dest);
    out.push({ ratio: 'source', w: meta.width ?? 0, h: meta.height ?? 0, key: `${baseName}/${name}`, bytes: size });
    return out;
  }

  const targets = opts.forThumbnail ? [...BASE_TARGETS, THUMBNAIL_TARGET] : BASE_TARGETS;

  for (const t of targets) {
    const name = `${baseName}-${t.suffix}.jpg`;
    const dest = join(outDir, name);
    await sharp(srcPath)
      // 主題が中央にあるとは限らないので、注目領域を残す切り方にする
      .resize(t.w, t.h, { fit: 'cover', position: sharp.strategy.attention })
      .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
      .toFile(dest);
    const { size } = await stat(dest);
    out.push({ ratio: t.ratio, w: t.w, h: t.h, key: `${baseName}/${name}`, bytes: size });
  }

  return out;
}
```

- [x] **Step 4: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/variants.test.ts`
Expected: PASS（5件）

- [x] **Step 5: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/inspect/variants.ts tests/variants.test.ts && git commit -m "feat(kakera): 比率バリアントの書き出し（透過は切らない）"
```

---

### Task 5: シリーズのトーン揃い判定と、閾値を測る道具

**閾値をここでベタ書きしない。** 測る道具を先に作り、実素材で分布を出してから `config/thresholds.json` に条件つきで記録する。この計画の時点では実素材が無いので、閾値は `null`（= 警告のみ）で始める。

**Files:**
- Create: `projects/常時運用/kakera/src/inspect/tone.ts`
- Create: `projects/常時運用/kakera/config/thresholds.json`
- Create: `projects/常時運用/kakera/tools/measure-tone.ts`
- Test: `projects/常時運用/kakera/tests/tone.test.ts`

**Interfaces:**
- Consumes: `toneHistogram` / `hellinger` / `centroid`（Task 2）
- Produces:
  - `interface ToneEntry { file: string; distance: number }`
  - `interface ToneReport { entries: ToneEntry[]; max: number; mean: number; threshold: number | null; issues: string[] }`
  - `imageToneHistogram(path: string): Promise<Float64Array>`
  - `inspectSeriesTone(paths: string[], threshold: number | null): Promise<ToneReport>`

- [x] **Step 1: 失敗するテストを書く**

`tests/tone.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { inspectSeriesTone, imageToneHistogram } from '../src/inspect/tone.js';
import { hellinger } from '../src/inspect/color.js';

let dir: string;
const p = (n: string) => join(dir, n);

async function solid(name: string, r: number, g: number, b: number) {
  await sharp({ create: { width: 320, height: 180, channels: 3, background: { r, g, b } } })
    .png().toFile(p(name));
  return p(name);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kakera-tone-'));
  // 揃っているシリーズ: 青系で明度だけ変える
  await solid('t1.png', 30, 60, 130);
  await solid('t2.png', 38, 72, 150);
  await solid('t3.png', 26, 52, 118);
  // 明らかに浮いている1枚
  await solid('odd.png', 230, 190, 40);
});

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('imageToneHistogram', () => {
  it('同じ絵からは同じヒストグラムが出る', async () => {
    const a = await imageToneHistogram(p('t1.png'));
    const b = await imageToneHistogram(p('t1.png'));
    expect(hellinger(a, b)).toBeCloseTo(0, 6);
  });
});

describe('inspectSeriesTone', () => {
  it('揃っているシリーズは距離が小さい', async () => {
    const r = await inspectSeriesTone([p('t1.png'), p('t2.png'), p('t3.png')], null);
    expect(r.entries.length).toBe(3);
    expect(r.max).toBeLessThan(0.5);
  });

  it('浮いている1枚を入れると最大距離が跳ね上がる', async () => {
    const tight = await inspectSeriesTone([p('t1.png'), p('t2.png'), p('t3.png')], null);
    const loose = await inspectSeriesTone([p('t1.png'), p('t2.png'), p('t3.png'), p('odd.png')], null);
    expect(loose.max).toBeGreaterThan(tight.max);
  });

  it('閾値が null のときは指摘を出さない（測るだけ）', async () => {
    const r = await inspectSeriesTone([p('t1.png'), p('odd.png')], null);
    expect(r.issues).toEqual([]);
    expect(r.threshold).toBeNull();
  });

  it('閾値を渡すと超えたファイルを名指しで指摘する', async () => {
    const r = await inspectSeriesTone([p('t1.png'), p('t2.png'), p('t3.png'), p('odd.png')], 0.3);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.join()).toContain('odd.png');
  });

  it('距離は大きい順に並ぶ（直すべき1枚が先頭に来る）', async () => {
    const r = await inspectSeriesTone([p('t1.png'), p('odd.png'), p('t2.png')], null);
    expect(r.entries[0]!.file).toContain('odd.png');
    expect(r.entries[0]!.distance).toBeGreaterThanOrEqual(r.entries[1]!.distance);
  });

  it('1点しかないシリーズは距離 0（重心が自分自身）', async () => {
    const r = await inspectSeriesTone([p('t1.png')], 0.3);
    expect(r.max).toBeCloseTo(0, 6);
    expect(r.issues).toEqual([]);
  });
});
```

- [x] **Step 2: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/tone.test.ts`
Expected: FAIL（`Failed to resolve import "../src/inspect/tone.js"`）

- [x] **Step 3: `src/inspect/tone.ts` を書く**

```ts
import sharp from 'sharp';
import { basename } from 'node:path';
import { toneHistogram, hellinger, centroid } from './color.js';

export interface ToneEntry {
  file: string;
  distance: number;
}

export interface ToneReport {
  entries: ToneEntry[];
  max: number;
  mean: number;
  threshold: number | null;
  issues: string[];
}

/** 距離の計算に使う縮小サイズ。細部ではなく色の分布を見たいので小さくする。 */
const SAMPLE = 96;

export async function imageToneHistogram(path: string): Promise<Float64Array> {
  const { data, info } = await sharp(path)
    .resize(SAMPLE, SAMPLE, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return toneHistogram(new Uint8Array(data), info.channels === 4 ? 4 : 3);
}

/**
 * シリーズ全体の重心からの距離を出す。
 * threshold が null のときは測るだけで指摘を出さない（閾値を実測で決めるまでの状態）。
 */
export async function inspectSeriesTone(paths: string[], threshold: number | null): Promise<ToneReport> {
  const hists = await Promise.all(paths.map(imageToneHistogram));
  const c = centroid(hists);

  const entries: ToneEntry[] = paths
    .map((file, i) => ({ file, distance: hellinger(hists[i]!, c) }))
    .sort((a, b) => b.distance - a.distance);

  const max = entries.length ? entries[0]!.distance : 0;
  const mean = entries.length ? entries.reduce((s, e) => s + e.distance, 0) / entries.length : 0;

  const issues: string[] = [];
  if (threshold !== null) {
    for (const e of entries) {
      if (e.distance > threshold) {
        issues.push(
          `${basename(e.file)} はシリーズの中心から ${e.distance.toFixed(3)} 離れています（上限 ${threshold}）`,
        );
      }
    }
  }

  return { entries, max, mean, threshold, issues };
}
```

- [x] **Step 4: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/tone.test.ts`
Expected: PASS（7件）

- [x] **Step 5: 閾値ファイルを未計測の状態で置く**

`config/thresholds.json`:

```json
{
  "_note": "実測して決める値。null は「測るだけで弾かない」。測った条件（対象・件数・日付）を必ず添える。",
  "toneMaxDistance": {
    "value": null,
    "measuredOn": null,
    "sampleSize": 0,
    "condition": "未計測。tools/measure-tone.ts を実素材にかけて分布を見てから決める"
  },
  "loopFirstLastRms": {
    "value": null,
    "measuredOn": null,
    "sampleSize": 0,
    "condition": "未計測"
  },
  "audioMaxVolumeDb": {
    "value": -0.1,
    "measuredOn": "2026-08-20",
    "sampleSize": 0,
    "condition": "0dBFS 張り付きの検出。実測ではなく仕様上の上限なので、素材が増えても変えない"
  }
}
```

- [x] **Step 6: 測る道具の CLI を書く**

`tools/measure-tone.ts`:

```ts
/**
 * シリーズ内のトーン距離の分布を出す。閾値を決めるための道具。
 * 使い方: npm run measure-tone -- series/night-desk/pieces
 */
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { inspectSeriesTone } from '../src/inspect/tone.js';

const dir = process.argv[2];
if (!dir) {
  console.error('使い方: npm run measure-tone -- <画像の入ったディレクトリ>');
  process.exit(1);
}

const files = (await readdir(dir))
  .filter((f) => ['.png', '.jpg', '.jpeg', '.webp'].includes(extname(f).toLowerCase()))
  .map((f) => join(dir, f))
  .sort();

if (files.length === 0) {
  console.error(`${dir} に画像がありません`);
  process.exit(1);
}

const r = await inspectSeriesTone(files, null);

console.log(`対象 ${files.length} 点 / ${dir}`);
console.log('');
for (const e of r.entries) {
  const bar = '█'.repeat(Math.round(e.distance * 60));
  console.log(`${e.distance.toFixed(4)}  ${bar}  ${e.file.split('/').pop()}`);
}
console.log('');
console.log(`最大 ${r.max.toFixed(4)} / 平均 ${r.mean.toFixed(4)}`);
console.log('この値を config/thresholds.json に、測った条件と一緒に書き入れてください。');
```

- [x] **Step 7: CLI が合成画像で動くことを確かめる**

```bash
cd "projects/常時運用/kakera" && mkdir -p /tmp/kakera-probe && node -e "
const sharp=require('sharp');
const mk=(n,r,g,b)=>sharp({create:{width:320,height:180,channels:3,background:{r,g,b}}}).png().toFile('/tmp/kakera-probe/'+n);
Promise.all([mk('a.png',30,60,130),mk('b.png',38,72,150),mk('c.png',26,52,118),mk('odd.png',230,190,40)]);
" && npx tsx tools/measure-tone.ts /tmp/kakera-probe
```

Expected: 4行の距離が棒グラフつきで並び、`odd.png` が先頭に来て最大値が最も大きい

- [x] **Step 8: コミット**

```bash
cd "projects/常時運用/kakera" && rm -rf /tmp/kakera-probe && git add src/inspect/tone.ts tools/measure-tone.ts config/thresholds.json tests/tone.test.ts && git commit -m "feat(kakera): シリーズのトーン揃い判定と、閾値を実測する道具"
```

---

### Task 6: ループ動画の検品

**Files:**
- Create: `projects/常時運用/kakera/src/inspect/video.ts`
- Test: `projects/常時運用/kakera/tests/video.test.ts`

**Interfaces:**
- Consumes: `srgbToLinear`（Task 2）
- Produces:
  - `interface LoopReport { path: string; width: number; height: number; durationMs: number; firstLastRms: number; seamless: boolean | null; issues: string[] }`
  - `inspectLoop(path: string, threshold: number | null): Promise<LoopReport>`

`firstLastRms` は先頭フレームと末尾フレームを 64×64 に落として比べた二乗平均平方根（0〜1）。**`seamless` は `threshold` が `null` のとき `null` を返す。** 閾値を実測で決めるまで真偽を断定しない。

- [x] **Step 1: 失敗するテストを書く**

`tests/video.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectLoop } from '../src/inspect/video.js';

const exec = promisify(execFile);
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kakera-vid-'));

  // 先頭と末尾が同じ = つながる
  await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0x2050A0:s=320x180:d=2:r=24',
    '-pix_fmt', 'yuv420p', join(dir, 'flat.mp4')]);

  // 明→暗に変化して終わる = つながらない
  await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=2:r=24',
    '-vf', 'fade=t=out:st=0:d=2', '-pix_fmt', 'yuv420p', join(dir, 'fade.mp4')]);
}, 60_000);

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('inspectLoop', () => {
  it('寸法と尺を読める', async () => {
    const r = await inspectLoop(join(dir, 'flat.mp4'), null);
    expect(r.width).toBe(320);
    expect(r.height).toBe(180);
    expect(r.durationMs).toBeGreaterThan(1800);
  }, 30_000);

  it('先頭と末尾が同じ動画は差が小さい', async () => {
    const r = await inspectLoop(join(dir, 'flat.mp4'), null);
    expect(r.firstLastRms).toBeLessThan(0.02);
  }, 30_000);

  it('末尾で暗くなる動画は差が大きい', async () => {
    const r = await inspectLoop(join(dir, 'fade.mp4'), null);
    expect(r.firstLastRms).toBeGreaterThan(0.2);
  }, 30_000);

  it('閾値が null なら seamless を断定しない', async () => {
    const r = await inspectLoop(join(dir, 'fade.mp4'), null);
    expect(r.seamless).toBeNull();
    expect(r.issues).toEqual([]);
  }, 30_000);

  it('閾値を渡すとつながらない動画を指摘する', async () => {
    const r = await inspectLoop(join(dir, 'fade.mp4'), 0.05);
    expect(r.seamless).toBe(false);
    expect(r.issues.join()).toMatch(/ループ/);
  }, 30_000);

  it('閾値を渡してもつながる動画は指摘しない', async () => {
    const r = await inspectLoop(join(dir, 'flat.mp4'), 0.05);
    expect(r.seamless).toBe(true);
    expect(r.issues).toEqual([]);
  }, 30_000);
});
```

- [x] **Step 2: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/video.test.ts`
Expected: FAIL（`Failed to resolve import "../src/inspect/video.js"`）

- [x] **Step 3: `src/inspect/video.ts` を書く**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const exec = promisify(execFile);

export interface LoopReport {
  path: string;
  width: number;
  height: number;
  durationMs: number;
  /** 先頭フレームと末尾フレームの差（0〜1）。小さいほどつながる */
  firstLastRms: number;
  /** 閾値が未設定のうちは断定しない */
  seamless: boolean | null;
  issues: string[];
}

const COMPARE_SIZE = 64;

async function probe(path: string): Promise<{ width: number; height: number; durationMs: number }> {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json', path,
  ]);
  const j = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number }[];
    format?: { duration?: string };
  };
  return {
    width: j.streams?.[0]?.width ?? 0,
    height: j.streams?.[0]?.height ?? 0,
    durationMs: Math.round(parseFloat(j.format?.duration ?? '0') * 1000),
  };
}

async function grayscale64(pngPath: string): Promise<Uint8Array> {
  const { data } = await sharp(pngPath)
    .resize(COMPARE_SIZE, COMPARE_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

export async function inspectLoop(path: string, threshold: number | null): Promise<LoopReport> {
  const { width, height, durationMs } = await probe(path);
  const work = await mkdtemp(join(tmpdir(), 'kakera-loop-'));

  try {
    const first = join(work, 'first.png');
    const last = join(work, 'last.png');

    await exec('ffmpeg', ['-y', '-v', 'error', '-i', path, '-frames:v', '1', first]);
    // -sseof で末尾から拾う。最終フレームを確実に取るための定石
    await exec('ffmpeg', ['-y', '-v', 'error', '-sseof', '-0.5', '-i', path, '-update', '1', '-frames:v', '1', last]);

    const a = await grayscale64(first);
    const b = await grayscale64(last);

    let sum = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = (a[i]! - b[i]!) / 255;
      sum += d * d;
    }
    const firstLastRms = n > 0 ? Math.sqrt(sum / n) : 0;

    const issues: string[] = [];
    let seamless: boolean | null = null;
    if (threshold !== null) {
      seamless = firstLastRms <= threshold;
      if (!seamless) {
        issues.push(
          `先頭と末尾の差が ${firstLastRms.toFixed(4)} で、ループがつながりません（上限 ${threshold}）`,
        );
      }
    }

    return { path, width, height, durationMs, firstLastRms, seamless, issues };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
```

- [x] **Step 4: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/video.test.ts`
Expected: PASS（6件）

- [x] **Step 5: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/inspect/video.ts tests/video.test.ts && git commit -m "feat(kakera): ループ動画のシームレス判定"
```

---

### Task 7: 音の検品

**Files:**
- Create: `projects/常時運用/kakera/src/inspect/audio.ts`
- Test: `projects/常時運用/kakera/tests/audio.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `interface AudioReport { path: string; durationMs: number; maxVolumeDb: number; leadingSilenceMs: number; trailingSilenceMs: number; issues: string[] }`
  - `inspectAudio(path: string, opts: { maxVolumeDb: number; maxEdgeSilenceMs: number }): Promise<AudioReport>`

- [x] **Step 1: 失敗するテストを書く**

`tests/audio.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectAudio } from '../src/inspect/audio.js';

const exec = promisify(execFile);
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kakera-aud-'));

  // 適正音量のトーン
  await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-af', 'volume=-6dB', join(dir, 'ok.wav')]);

  // 0dBFS に張り付いた音。
  // lavfi の sine はフルスケールではなくピーク -18.1 dB なので、+12dB では張り付かない（実測）。
  await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-af', 'volume=25dB', join(dir, 'clip.wav')]);

  // 先頭に1.5秒の無音がある音
  // -filter_complex と -af は同じストリームに併用できないので、音量調整も chain の中でやる
  await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-filter_complex', '[0][1]concat=n=2:v=0:a=1,volume=-6dB[out]',
    '-map', '[out]', join(dir, 'lead.wav')]);
}, 60_000);

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

const OPTS = { maxVolumeDb: -0.1, maxEdgeSilenceMs: 500 };

describe('inspectAudio', () => {
  it('尺とピーク音量を読める', async () => {
    const r = await inspectAudio(join(dir, 'ok.wav'), OPTS);
    expect(r.durationMs).toBeGreaterThan(1800);
    expect(r.maxVolumeDb).toBeLessThan(-3);
  }, 30_000);

  it('適正な音は指摘なしで通る', async () => {
    const r = await inspectAudio(join(dir, 'ok.wav'), OPTS);
    expect(r.issues).toEqual([]);
  }, 30_000);

  it('0dBFS に張り付いた音を指摘する', async () => {
    const r = await inspectAudio(join(dir, 'clip.wav'), OPTS);
    expect(r.maxVolumeDb).toBeGreaterThanOrEqual(-0.1);
    expect(r.issues.join()).toMatch(/張り付/);
  }, 30_000);

  it('先頭の長い無音を測って指摘する', async () => {
    const r = await inspectAudio(join(dir, 'lead.wav'), OPTS);
    expect(r.leadingSilenceMs).toBeGreaterThan(1000);
    expect(r.issues.join()).toMatch(/先頭/);
  }, 30_000);

  it('無音が短ければ指摘しない', async () => {
    const r = await inspectAudio(join(dir, 'lead.wav'), { ...OPTS, maxEdgeSilenceMs: 3000 });
    expect(r.issues.join()).not.toMatch(/先頭/);
  }, 30_000);
});
```

- [x] **Step 2: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/audio.test.ts`
Expected: FAIL（`Failed to resolve import "../src/inspect/audio.js"`）

- [x] **Step 3: `src/inspect/audio.ts` を書く**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface AudioReport {
  path: string;
  durationMs: number;
  /** ピーク音量（dBFS）。0 に近いほど張り付いている */
  maxVolumeDb: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  issues: string[];
}

/** これ未満を無音とみなす */
const SILENCE_NOISE_DB = -50;
const SILENCE_MIN_SEC = 0.2;

async function durationMs(path: string): Promise<number> {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path,
  ]);
  const j = JSON.parse(stdout) as { format?: { duration?: string } };
  return Math.round(parseFloat(j.format?.duration ?? '0') * 1000);
}

/** ffmpeg のフィルタ結果は stderr に出る。execFile はエラーにしないので stderr を読む。 */
async function filterStderr(path: string, af: string): Promise<string> {
  const { stderr } = await exec('ffmpeg', ['-v', 'info', '-i', path, '-af', af, '-f', 'null', '-'], {
    maxBuffer: 8 * 1024 * 1024,
  });
  return stderr;
}

export async function inspectAudio(
  path: string,
  opts: { maxVolumeDb: number; maxEdgeSilenceMs: number },
): Promise<AudioReport> {
  const dur = await durationMs(path);

  const volOut = await filterStderr(path, 'volumedetect');
  const maxMatch = volOut.match(/max_volume:\s*(-?[\d.]+) dB/);
  const maxVolumeDb = maxMatch ? parseFloat(maxMatch[1]!) : -Infinity;

  const silOut = await filterStderr(path, `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_SEC}`);
  const starts = [...silOut.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]!));
  const ends = [...silOut.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]!));

  // 先頭の無音: 0秒付近から始まる無音区間の終わり
  let leadingSilenceMs = 0;
  if (starts.length > 0 && starts[0]! < 0.05 && ends.length > 0) {
    leadingSilenceMs = Math.round(ends[0]! * 1000);
  }

  // 末尾の無音: 最後の無音区間が終端まで続いていれば、その長さ
  let trailingSilenceMs = 0;
  if (starts.length > 0) {
    const lastStart = starts[starts.length - 1]!;
    const closed = ends.length === starts.length;
    const lastEnd = closed ? ends[ends.length - 1]! : dur / 1000;
    if (Math.abs(lastEnd - dur / 1000) < 0.15) {
      trailingSilenceMs = Math.round((dur / 1000 - lastStart) * 1000);
    }
  }

  const issues: string[] = [];
  if (maxVolumeDb >= opts.maxVolumeDb) {
    issues.push(`ピークが ${maxVolumeDb.toFixed(2)} dBFS で 0dBFS に張り付いています（上限 ${opts.maxVolumeDb}）`);
  }
  if (maxVolumeDb === -Infinity) {
    issues.push('音が入っていません（全編無音）');
  }
  if (leadingSilenceMs > opts.maxEdgeSilenceMs) {
    issues.push(`先頭に ${leadingSilenceMs}ms の無音があります（上限 ${opts.maxEdgeSilenceMs}ms）`);
  }
  if (trailingSilenceMs > opts.maxEdgeSilenceMs) {
    issues.push(`末尾に ${trailingSilenceMs}ms の無音があります（上限 ${opts.maxEdgeSilenceMs}ms）`);
  }

  return { path, durationMs: dur, maxVolumeDb, leadingSilenceMs, trailingSilenceMs, issues };
}
```

- [x] **Step 4: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/audio.test.ts`
Expected: PASS（5件）

- [x] **Step 5: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/inspect/audio.ts tests/audio.test.ts && git commit -m "feat(kakera): 音の検品（クリップと端の無音）"
```

---

### Task 8: シリーズ定義の読み込みと検品CLI

ここまでのゲートを1本にまとめる。**法務ゲート（格付け A のみ）はここで必ず走る**ようにして、人が覚えている前提にしない。

**Files:**
- Create: `projects/常時運用/kakera/src/inspect/series.ts`
- Create: `projects/常時運用/kakera/tools/inspect.ts`
- Create: `projects/常時運用/kakera/series/night-desk/series.json`
- Test: `projects/常時運用/kakera/tests/series.test.ts`

**Interfaces:**
- Consumes: `SeriesDefSchema`（T1）, `assertPublishableGenerator`（T1）, `inspectImage`（T3）, `inspectSeriesTone`（T5）, `inspectLoop`（T6）, `inspectAudio`（T7）
- Produces:
  - `interface PieceIssue { pieceId: string; file: string; issues: string[] }`
  - `interface SeriesReport { slug: string; def: SeriesDef; pieceIssues: PieceIssue[]; tone: ToneReport | null; blocking: string[]; ok: boolean }`
  - `loadSeriesDef(dir: string): Promise<SeriesDef>`
  - `inspectSeries(dir: string, thresholds: Thresholds): Promise<SeriesReport>`
  - `interface Thresholds { toneMaxDistance: number | null; loopFirstLastRms: number | null; audioMaxVolumeDb: number }`

- [x] **Step 1: 失敗するテストを書く**

`tests/series.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadSeriesDef, inspectSeries } from '../src/inspect/series.js';

let root: string;
const TH = { toneMaxDistance: null, loopFirstLastRms: null, audioMaxVolumeDb: -0.1 };

function def(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'probe',
    title: '検品用',
    description: '検品のためのシリーズ。',
    audience: ['editor'],
    creator: '@fuuuuuuma',
    license: 'kakera-free',
    tone: { light: '低い色温度', colorTemp: '2700K', framing: '俯瞰', texture: '木' },
    generator: { service: 'higgsfield', model: 'soul', version: '2026-08' },
    promptPublic: true,
    pieces: Array.from({ length: 6 }, (_, i) => ({
      id: `probe-${i + 1}`,
      kind: 'still',
      file: `pieces/p${i + 1}.png`,
      prompt: 'a dim wooden desk at night, no people',
    })),
    ...overrides,
  };
}

async function makeSeries(name: string, d: Record<string, unknown>, longEdge = 2400) {
  const dir = join(root, name);
  await mkdir(join(dir, 'pieces'), { recursive: true });
  await writeFile(join(dir, 'series.json'), JSON.stringify(d, null, 2));
  for (let i = 1; i <= 6; i++) {
    await sharp({
      create: { width: longEdge, height: Math.round(longEdge * 9 / 16), channels: 3,
                background: { r: 30 + i, g: 60 + i, b: 130 + i } },
    }).png().toFile(join(dir, 'pieces', `p${i}.png`));
  }
  return dir;
}

beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'kakera-series-')); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('loadSeriesDef', () => {
  it('定義を読んで型を通す', async () => {
    const dir = await makeSeries('ok', def());
    expect((await loadSeriesDef(dir)).slug).toBe('probe');
  });

  it('壊れた定義は理由つきで落ちる', async () => {
    const dir = await makeSeries('bad-def', def({ promptPublic: false }));
    await expect(loadSeriesDef(dir)).rejects.toThrow();
  });
});

describe('inspectSeries', () => {
  it('揃った静止画のシリーズは通る', async () => {
    const dir = await makeSeries('good', def());
    const r = await inspectSeries(dir, TH);
    expect(r.blocking).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.tone).not.toBeNull();
  }, 30_000);

  it('格付け D の生成元は必ず止める（MusicGen）', async () => {
    const dir = await makeSeries('musicgen', def({
      generator: { service: 'musicgen', model: 'large', version: '1' },
    }));
    const r = await inspectSeries(dir, TH);
    expect(r.ok).toBe(false);
    expect(r.blocking.join()).toMatch(/CC-BY-NC/);
  }, 30_000);

  it('格付け B の生成元も止める（Grok）', async () => {
    const dir = await makeSeries('grok', def({
      generator: { service: 'grok', model: 'imagine', version: '1' },
    }));
    const r = await inspectSeries(dir, TH);
    expect(r.ok).toBe(false);
    expect(r.blocking.join()).toMatch(/格付け B/);
  }, 30_000);

  it('ファイルが無いかけらを名指しで指摘する', async () => {
    const d = def();
    (d.pieces as Record<string, unknown>[])[2]!.file = 'pieces/missing.png';
    const dir = await makeSeries('missing', d);
    const r = await inspectSeries(dir, TH);
    expect(r.ok).toBe(false);
    expect(r.blocking.join()).toMatch(/missing\.png/);
  }, 30_000);

  it('解像度が足りない静止画を指摘する', async () => {
    const dir = await makeSeries('small', def(), 800);
    const r = await inspectSeries(dir, TH);
    expect(r.pieceIssues.flatMap(p => p.issues).join()).toMatch(/長辺/);
    expect(r.ok).toBe(false);
  }, 30_000);

  it('トーンの閾値が null のうちは、距離を出すだけで止めない', async () => {
    const dir = await makeSeries('tone-null', def());
    const r = await inspectSeries(dir, TH);
    expect(r.tone!.threshold).toBeNull();
    expect(r.tone!.issues).toEqual([]);
    expect(r.ok).toBe(true);
  }, 30_000);
});
```

- [x] **Step 2: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/series.test.ts`
Expected: FAIL（`Failed to resolve import "../src/inspect/series.js"`）

- [x] **Step 3: `src/inspect/series.ts` を書く**

```ts
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { SeriesDefSchema, type SeriesDef } from '../catalog/schema.js';
import { assertPublishableGenerator } from '../catalog/generators.js';
import { inspectImage } from './image.js';
import { inspectSeriesTone, type ToneReport } from './tone.js';
import { inspectLoop } from './video.js';
import { inspectAudio } from './audio.js';

export interface Thresholds {
  toneMaxDistance: number | null;
  loopFirstLastRms: number | null;
  audioMaxVolumeDb: number;
}

export interface PieceIssue {
  pieceId: string;
  file: string;
  issues: string[];
}

export interface SeriesReport {
  slug: string;
  def: SeriesDef;
  pieceIssues: PieceIssue[];
  tone: ToneReport | null;
  /** 公開を止める理由。空なら出せる */
  blocking: string[];
  ok: boolean;
}

const MAX_EDGE_SILENCE_MS = 500;

export async function loadSeriesDef(dir: string): Promise<SeriesDef> {
  const raw = await readFile(join(dir, 'series.json'), 'utf8');
  return SeriesDefSchema.parse(JSON.parse(raw));
}

const exists = async (p: string): Promise<boolean> => {
  try { await access(p); return true; } catch { return false; }
};

export async function inspectSeries(dir: string, th: Thresholds): Promise<SeriesReport> {
  const def = await loadSeriesDef(dir);
  const blocking: string[] = [];
  const pieceIssues: PieceIssue[] = [];

  // 法務ゲート: 人が覚えている前提にしない。ここで必ず走る。
  for (const kind of new Set(def.pieces.map((p) => p.kind))) {
    try {
      assertPublishableGenerator(def.generator.service, kind);
    } catch (e) {
      blocking.push((e as Error).message);
    }
  }

  const stillPaths: string[] = [];

  for (const piece of def.pieces) {
    const path = join(dir, piece.file);
    if (!(await exists(path))) {
      blocking.push(`かけら ${piece.id} のファイルが見つかりません: ${piece.file}`);
      continue;
    }

    const issues: string[] = [];

    if (piece.kind === 'still') {
      const r = await inspectImage(path, { alpha: piece.alpha });
      issues.push(...r.issues);
      if (!piece.alpha) stillPaths.push(path);
    } else if (piece.kind === 'loop') {
      const r = await inspectLoop(path, th.loopFirstLastRms);
      issues.push(...r.issues);
    } else {
      const r = await inspectAudio(path, {
        maxVolumeDb: th.audioMaxVolumeDb,
        maxEdgeSilenceMs: MAX_EDGE_SILENCE_MS,
      });
      issues.push(...r.issues);
    }

    if (issues.length > 0) pieceIssues.push({ pieceId: piece.id, file: piece.file, issues });
  }

  // トーンの揃いは不透明な静止画だけで測る。透過は背景が無いので比べられない。
  const tone = stillPaths.length > 0 ? await inspectSeriesTone(stillPaths, th.toneMaxDistance) : null;
  if (tone) blocking.push(...tone.issues);

  const ok = blocking.length === 0 && pieceIssues.length === 0;
  return { slug: def.slug, def, pieceIssues, tone, blocking, ok };
}
```

- [x] **Step 4: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/series.test.ts`
Expected: PASS（8件）

- [x] **Step 5: 最初のシリーズ定義を書く**

`series/night-desk/series.json`:

```json
{
  "slug": "night-desk",
  "title": "夜の書斎",
  "description": "解説動画のインサートに敷く、夜のデスクまわり。低い色温度の点光源で統一しています。",
  "audience": ["editor"],
  "creator": "@fuuuuuuma",
  "license": "kakera-free",
  "tone": {
    "light": "デスクライト1灯の点光源。影は落とすが潰さない",
    "colorTemp": "2700K 前後の電球色",
    "framing": "斜め上からの寄りの俯瞰。水平は保つ",
    "texture": "木の天板・紙・ガラス・金属の細い反射"
  },
  "generator": { "service": "higgsfield", "model": "soul", "version": "2026-08" },
  "promptPublic": true,
  "pieces": [
    { "id": "night-desk-01", "kind": "still", "file": "pieces/night-desk-01.png", "useTags": ["Bロール"],
      "prompt": "a wooden writing desk at night lit by a single warm desk lamp, open notebook and pen, shallow depth of field, no people, cinematic, 2700K" },
    { "id": "night-desk-02", "kind": "still", "file": "pieces/night-desk-02.png", "useTags": ["Bロール"],
      "prompt": "close-up of a keyboard on a wooden desk at night, warm lamp light from the left, faint screen glow, no people, 2700K" },
    { "id": "night-desk-03", "kind": "still", "file": "pieces/night-desk-03.png", "useTags": ["Bロール"],
      "prompt": "a mug of coffee beside stacked books on a night desk, warm single lamp, steam catching the light, no people, 2700K" },
    { "id": "night-desk-04", "kind": "still", "file": "pieces/night-desk-04.png", "useTags": ["Bロール"],
      "prompt": "overhead view of scattered handwritten notes on a wooden desk at night, warm lamp, no people, 2700K" },
    { "id": "night-desk-05", "kind": "still", "file": "pieces/night-desk-05.png", "useTags": ["Bロール"],
      "prompt": "a desk lamp casting a warm pool of light on an empty wooden desk at night, dark room behind, no people, 2700K" },
    { "id": "night-desk-06", "kind": "still", "file": "pieces/night-desk-06.png", "useTags": ["Bロール", "場面転換"],
      "prompt": "eyeglasses resting on an open book on a night desk, warm lamp light, soft bokeh, no people, 2700K" }
  ]
}
```

- [x] **Step 6: 検品CLIを書く**

`tools/inspect.ts`:

```ts
/**
 * シリーズを検品してレポートを出す。
 * 使い方: npm run inspect -- series/night-desk
 */
import { readFile } from 'node:fs/promises';
import { inspectSeries, type Thresholds } from '../src/inspect/series.js';

const dir = process.argv[2];
if (!dir) {
  console.error('使い方: npm run inspect -- <シリーズのディレクトリ>');
  process.exit(1);
}

const cfg = JSON.parse(await readFile(new URL('../config/thresholds.json', import.meta.url), 'utf8')) as {
  toneMaxDistance: { value: number | null };
  loopFirstLastRms: { value: number | null };
  audioMaxVolumeDb: { value: number };
};

const th: Thresholds = {
  toneMaxDistance: cfg.toneMaxDistance.value,
  loopFirstLastRms: cfg.loopFirstLastRms.value,
  audioMaxVolumeDb: cfg.audioMaxVolumeDb.value,
};

const r = await inspectSeries(dir, th);

console.log(`${r.def.title}（${r.slug}） / ${r.def.pieces.length}のかけら`);
console.log(`生成元: ${r.def.generator.service} ${r.def.generator.model}`);
console.log('');

if (r.tone) {
  console.log(`トーンの散らばり: 最大 ${r.tone.max.toFixed(4)} / 平均 ${r.tone.mean.toFixed(4)}` +
    (r.tone.threshold === null ? '（閾値は未計測なので測るだけ）' : `（上限 ${r.tone.threshold}）`));
  for (const e of r.tone.entries.slice(0, 3)) {
    console.log(`  ${e.distance.toFixed(4)}  ${e.file.split('/').pop()}`);
  }
  console.log('');
}

for (const p of r.pieceIssues) {
  console.log(`[かけら] ${p.pieceId} (${p.file})`);
  for (const i of p.issues) console.log(`    - ${i}`);
}
for (const b of r.blocking) console.log(`[止める] ${b}`);

console.log('');
console.log(r.ok ? '通りました。棚に出せます。' : '止めました。上の指摘を直してください。');
process.exit(r.ok ? 0 : 1);
```

- [x] **Step 7: CLI が「素材が無い」ことを正しく止めるのを確かめる**

Run: `cd "projects/常時運用/kakera" && npx tsx tools/inspect.ts series/night-desk`
Expected: 終了コード 1。`[止める] かけら night-desk-01 のファイルが見つかりません: pieces/night-desk-01.png` が6件並ぶ

これが正しい姿。**素材はまだ生成していないので、止まるのが期待どおり。**

- [x] **Step 8: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/inspect/series.ts tools/inspect.ts series/night-desk/series.json tests/series.test.ts && git commit -m "feat(kakera): シリーズ検品CLI（法務ゲートを必ず通す）"
```

---

### Task 9: カタログJSONの生成と整合検査

**Files:**
- Create: `projects/常時運用/kakera/src/build/catalog.ts`
- Create: `projects/常時運用/kakera/tools/build-catalog.ts`
- Test: `projects/常時運用/kakera/tests/catalog.test.ts`

**Interfaces:**
- Consumes: `Catalog` / `CatalogSeries` / `CatalogPiece`（T1）, `inspectSeries`（T8）, `writeVariants`（T4）
- Produces:
  - `buildCatalog(seriesDirs: string[], outRoot: string, th: Thresholds): Promise<Catalog>`
  - `assertCatalogIntegrity(c: Catalog): void`

`assertCatalogIntegrity` は**カタログが自分の主張と食い違っていないか**を機械で照合する。`seriesCount` と実際の配列長、`pieceCount` の合計、slug と piece id の重複、宣言した比率と実寸、`promptPublic` なのに prompt が空、を見る。

- [x] **Step 1: 失敗するテストを書く**

`tests/catalog.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildCatalog, assertCatalogIntegrity } from '../src/build/catalog.js';
import type { Catalog } from '../src/catalog/schema.js';

let root: string;
let outRoot: string;
const TH = { toneMaxDistance: null, loopFirstLastRms: null, audioMaxVolumeDb: -0.1 };

async function makeSeries(slug: string) {
  const dir = join(root, slug);
  await mkdir(join(dir, 'pieces'), { recursive: true });
  await writeFile(join(dir, 'series.json'), JSON.stringify({
    slug, title: `題 ${slug}`, description: '説明。', audience: ['editor'],
    creator: '@fuuuuuuma', license: 'kakera-free',
    tone: { light: '光', colorTemp: '2700K', framing: '俯瞰', texture: '木' },
    generator: { service: 'higgsfield', model: 'soul', version: '2026-08' },
    promptPublic: true,
    pieces: Array.from({ length: 6 }, (_, i) => ({
      id: `${slug}-${i + 1}`, kind: 'still', file: `pieces/p${i + 1}.png`,
      prompt: 'a dim wooden desk at night, no people',
      forThumbnail: i === 0,
    })),
  }, null, 2));
  for (let i = 1; i <= 6; i++) {
    await sharp({ create: { width: 2400, height: 1350, channels: 3,
      background: { r: 30 + i, g: 60 + i, b: 130 + i } } })
      .png().toFile(join(dir, 'pieces', `p${i}.png`));
  }
  return dir;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kakera-cat-'));
  outRoot = join(root, '_out');
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('buildCatalog', () => {
  it('シリーズ数とかけら数が実体と一致する', async () => {
    const a = await makeSeries('aaa');
    const b = await makeSeries('bbb');
    const c = await buildCatalog([a, b], outRoot, TH);
    expect(c.seriesCount).toBe(2);
    expect(c.pieceCount).toBe(12);
    expect(c.series.map(s => s.slug).sort()).toEqual(['aaa', 'bbb']);
  }, 120_000);

  it('sha256 と bytes が入る', async () => {
    const a = await makeSeries('ccc');
    const c = await buildCatalog([a], outRoot, TH);
    const p = c.series[0]!.pieces[0]!;
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.bytes).toBeGreaterThan(0);
  }, 120_000);

  it('サムネ用途のかけらには 1280×720 が入る', async () => {
    const a = await makeSeries('ddd');
    const c = await buildCatalog([a], outRoot, TH);
    const first = c.series[0]!.pieces.find(p => p.id === 'ddd-1')!;
    expect(first.variants.some(v => v.w === 1280 && v.h === 720)).toBe(true);
  }, 120_000);

  it('トーンの最大距離がシリーズに記録される', async () => {
    const a = await makeSeries('eee');
    const c = await buildCatalog([a], outRoot, TH);
    expect(c.series[0]!.toneMaxDistance).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('検品で止まったシリーズはカタログに入らない', async () => {
    const bad = join(root, 'fff');
    await mkdir(join(bad, 'pieces'), { recursive: true });
    await writeFile(join(bad, 'series.json'), await readFile(join(await makeSeries('ggg'), 'series.json'), 'utf8'));
    await expect(buildCatalog([bad], outRoot, TH)).rejects.toThrow(/見つかりません/);
  }, 120_000);
});

describe('assertCatalogIntegrity', () => {
  const base = (): Catalog => ({
    version: 1, builtAt: '2026-08-20T00:00:00.000Z', seriesCount: 1, pieceCount: 1,
    series: [{
      slug: 's', title: 't', description: 'd', audience: ['editor'], creator: '@k',
      license: 'kakera-free',
      tone: { light: 'l', colorTemp: 'c', framing: 'f', texture: 'x' },
      generator: { service: 'higgsfield', model: 'soul', version: '1' },
      promptPublic: true, pieceCount: 1, toneMaxDistance: 0.1,
      pieces: [{
        id: 'p1', kind: 'still', prompt: 'x', alpha: false, useTags: [],
        sha256: 'a'.repeat(64), bytes: 10, mime: 'image/png',
        variants: [{ ratio: '16:9', w: 1920, h: 1080, key: 'p1/a.jpg', bytes: 10 }],
      }],
    }],
  });

  it('整合していれば通る', () => {
    expect(() => assertCatalogIntegrity(base())).not.toThrow();
  });

  it('seriesCount が配列長と違えば落ちる', () => {
    const c = base(); c.seriesCount = 5;
    expect(() => assertCatalogIntegrity(c)).toThrow(/seriesCount/);
  });

  it('pieceCount の合計が違えば落ちる', () => {
    const c = base(); c.pieceCount = 9;
    expect(() => assertCatalogIntegrity(c)).toThrow(/pieceCount/);
  });

  it('slug が重複していれば落ちる', () => {
    const c = base(); c.series.push({ ...c.series[0]! }); c.seriesCount = 2; c.pieceCount = 2;
    expect(() => assertCatalogIntegrity(c)).toThrow(/重複/);
  });

  it('宣言した比率と実寸が食い違えば落ちる', () => {
    const c = base(); c.series[0]!.pieces[0]!.variants[0]!.h = 1000;
    expect(() => assertCatalogIntegrity(c)).toThrow(/比率/);
  });

  it('プロンプトが空なら落ちる（全公開が前提）', () => {
    const c = base(); c.series[0]!.pieces[0]!.prompt = '';
    expect(() => assertCatalogIntegrity(c)).toThrow(/プロンプト/);
  });
});
```

- [x] **Step 2: テストを走らせて落ちることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/catalog.test.ts`
Expected: FAIL（`Failed to resolve import "../src/build/catalog.js"`）

- [x] **Step 3: `src/build/catalog.ts` を書く**

```ts
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';
import { inspectSeries, type Thresholds } from '../inspect/series.js';
import { writeVariants } from '../inspect/variants.js';
import { ratioLabel } from '../inspect/image.js';
import { inspectLoop } from '../inspect/video.js';
import { inspectAudio } from '../inspect/audio.js';
import type { Catalog, CatalogPiece, CatalogSeries, CatalogVariant } from '../catalog/schema.js';

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function buildCatalog(
  seriesDirs: string[],
  outRoot: string,
  th: Thresholds,
): Promise<Catalog> {
  const series: CatalogSeries[] = [];

  for (const dir of seriesDirs) {
    const report = await inspectSeries(dir, th);
    if (!report.ok) {
      const why = [...report.blocking, ...report.pieceIssues.flatMap((p) => p.issues)].join(' / ');
      throw new Error(`${dir} は検品を通っていないのでカタログに入れられません: ${why}`);
    }

    const def = report.def;
    const pieces: CatalogPiece[] = [];

    for (const p of def.pieces) {
      const src = join(dir, p.file);
      const ext = extname(src).toLowerCase();
      const { size } = await stat(src);

      let variants: CatalogVariant[] = [];
      let durationMs: number | undefined;
      let loopSeamless: boolean | undefined;

      if (p.kind === 'still') {
        variants = await writeVariants(src, join(outRoot, def.slug, p.id), p.id, {
          alpha: p.alpha,
          forThumbnail: p.forThumbnail,
        });
      } else if (p.kind === 'loop') {
        const r = await inspectLoop(src, th.loopFirstLastRms);
        durationMs = r.durationMs;
        loopSeamless = r.seamless ?? undefined;
        variants = [{ ratio: 'source', w: r.width, h: r.height, key: `${def.slug}/${p.id}/${p.id}${ext}`, bytes: size }];
      } else {
        const r = await inspectAudio(src, { maxVolumeDb: th.audioMaxVolumeDb, maxEdgeSilenceMs: 500 });
        durationMs = r.durationMs;
        variants = [{ ratio: 'source', w: 0, h: 0, key: `${def.slug}/${p.id}/${p.id}${ext}`, bytes: size }];
      }

      pieces.push({
        id: p.id,
        kind: p.kind,
        prompt: p.prompt,
        ...(p.seed === undefined ? {} : { seed: p.seed }),
        alpha: p.alpha,
        useTags: p.useTags,
        sha256: await sha256(src),
        bytes: size,
        mime: MIME[ext] ?? 'application/octet-stream',
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(loopSeamless === undefined ? {} : { loopSeamless }),
        variants,
      });
    }

    series.push({
      slug: def.slug,
      title: def.title,
      description: def.description,
      audience: def.audience,
      creator: def.creator,
      license: def.license,
      tone: def.tone,
      generator: def.generator,
      promptPublic: true,
      pieceCount: pieces.length,
      toneMaxDistance: report.tone?.max ?? 0,
      pieces,
    });
  }

  const catalog: Catalog = {
    version: 1,
    builtAt: new Date().toISOString(),
    seriesCount: series.length,
    pieceCount: series.reduce((s, x) => s + x.pieces.length, 0),
    series,
  };

  assertCatalogIntegrity(catalog);
  return catalog;
}

/** カタログが自分の主張と食い違っていないかを機械で照合する。 */
export function assertCatalogIntegrity(c: Catalog): void {
  if (c.seriesCount !== c.series.length) {
    throw new Error(`seriesCount が ${c.seriesCount} ですが、実際は ${c.series.length} 件です`);
  }
  const total = c.series.reduce((s, x) => s + x.pieces.length, 0);
  if (c.pieceCount !== total) {
    throw new Error(`pieceCount が ${c.pieceCount} ですが、実際は ${total} 点です`);
  }

  const slugs = new Set<string>();
  for (const s of c.series) {
    if (slugs.has(s.slug)) throw new Error(`シリーズの slug が重複しています: ${s.slug}`);
    slugs.add(s.slug);

    if (s.pieceCount !== s.pieces.length) {
      throw new Error(`${s.slug} の pieceCount が ${s.pieceCount} ですが、実際は ${s.pieces.length} 点です`);
    }

    const ids = new Set<string>();
    for (const p of s.pieces) {
      if (ids.has(p.id)) throw new Error(`${s.slug} でかけらの id が重複しています: ${p.id}`);
      ids.add(p.id);

      if (p.prompt.trim() === '') {
        throw new Error(`${s.slug}/${p.id} のプロンプトが空です（全シリーズ公開が前提）`);
      }
      for (const v of p.variants) {
        if (v.ratio !== 'source' && ratioLabel(v.w, v.h) !== v.ratio) {
          throw new Error(
            `${s.slug}/${p.id} の比率が食い違っています: ${v.ratio} と宣言して実寸は ${v.w}×${v.h}`,
          );
        }
      }
    }
  }
}
```

- [x] **Step 4: テストが通ることを確かめる**

Run: `cd "projects/常時運用/kakera" && npx vitest run tests/catalog.test.ts`
Expected: PASS（11件）

- [x] **Step 5: カタログ生成CLIを書く**

`tools/build-catalog.ts`:

```ts
/**
 * すべてのシリーズを検品してカタログを吐く。
 * 使い方: npm run build-catalog
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCatalog } from '../src/build/catalog.js';
import type { Thresholds } from '../src/inspect/series.js';

const SERIES_ROOT = 'series';
const OUT_ROOT = 'dist/variants';
const OUT_JSON = 'dist/catalog.json';

const cfg = JSON.parse(await readFile(new URL('../config/thresholds.json', import.meta.url), 'utf8')) as {
  toneMaxDistance: { value: number | null };
  loopFirstLastRms: { value: number | null };
  audioMaxVolumeDb: { value: number };
};
const th: Thresholds = {
  toneMaxDistance: cfg.toneMaxDistance.value,
  loopFirstLastRms: cfg.loopFirstLastRms.value,
  audioMaxVolumeDb: cfg.audioMaxVolumeDb.value,
};

const dirs = (await readdir(SERIES_ROOT, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => join(SERIES_ROOT, d.name))
  .sort();

if (dirs.length === 0) {
  console.error(`${SERIES_ROOT}/ にシリーズがありません`);
  process.exit(1);
}

const catalog = await buildCatalog(dirs, OUT_ROOT, th);
await mkdir('dist', { recursive: true });
await writeFile(OUT_JSON, JSON.stringify(catalog, null, 2));

console.log(`${catalog.seriesCount} シリーズ / ${catalog.pieceCount} のかけら を ${OUT_JSON} に書きました`);
for (const s of catalog.series) {
  console.log(`  ${s.slug}  ${s.pieceCount}点  トーン最大距離 ${s.toneMaxDistance.toFixed(4)}`);
}
```

- [x] **Step 6: 全テストを走らせる**

Run: `cd "projects/常時運用/kakera" && npm test`
Expected: 全ファイル PASS（合計 80 件）

- [x] **Step 7: コミット**

```bash
cd "projects/常時運用/kakera" && git add src/build/catalog.ts tools/build-catalog.ts tests/catalog.test.ts && git commit -m "feat(kakera): カタログ生成と、主張と実体の機械照合"
```

---

## この計画を終えたときの状態

- `npm test` が **80 件**通り、ネットワークもクレジットも使わずに検品の正しさが担保されている
- `npm run inspect -- series/night-desk` が「素材がまだ無い」ことを正しく止める
- 生成元の法務ゲートが自動で走り、**MusicGen・Grok・Gemini は人が忘れても通らない**
- トーンの閾値は `null`（測るだけ）で、`tools/measure-tone.ts` がいつでも分布を出せる

## 次の計画に送るもの

1. **素材の生成と閾値の計測** — `night-desk` の6点を実際に生成し、`measure-tone` で分布を見て `config/thresholds.json` を埋める。クレジットを使うので、着手前にメンテナの確認を取る
2. **Web アプリ** — `dist/catalog.json` を読む Next.js。白基調・ゴシック体。モックは `mock/top.html`
3. **計数バックエンド** — Workers + D1。いいねとダウンロード数

## Self-Review

**1. Spec coverage（設計書の該当節 → タスク）**

| 設計書の節 | 対応 |
|---|---|
| 4章 かけら / シリーズの定義 | T1（スキーマ・6〜12点の制約） |
| 6章 生成元の格付け | T1（格付け表・公開可否）、T8（必ず走る法務ゲート） |
| 7章 ライセンス（`kakera-free` のみ） | T1（`z.literal('kakera-free')`） |
| 7章 プロンプト全公開 | T1（`z.literal(true)`）、T9（空プロンプトで落とす） |
| 5章 書き出し比率・1280×720 | T4 |
| 5章 透過PNGは元の比率のまま | T4（`alpha` なら `source` のみ） |
| 10章 検品ゲート1（解像度・比率） | T3 |
| 10章 検品ゲート2（アルファ実在） | T3（`hasRealAlpha`） |
| 10章 検品ゲート3（ループ） | T6 |
| 10章 検品ゲート4（無音・0dBFS） | T7 |
| 10章 検品ゲート5（トーンの揃い） | T2・T5 |
| 10章 検品ゲート6（格付け A のみ・自動） | T1・T8 |
| 9章 データモデル（Series / Piece / Variant） | T1・T9 |
| Global「閾値をベタ書きしない」 | T5（`thresholds.json` と測る道具） |

Web アプリと計数バックエンドは意図的に範囲外。上の「次の計画に送るもの」に明記した。

**2. Placeholder scan:** 「TBD」「あとで実装」「適切なエラー処理を追加」「Task N と同様」は無し。全コード段は実際に動く内容を書いた。

**3. Type consistency:**
- `Kind` は T1 で定義し、T8・T9 が同名で使用 ✓
- `CatalogVariant` は T1 で定義し、T4 が返して T9 が組み立てる ✓
- `ratioLabel` は T3 で定義し、T9 の整合検査が再利用 ✓
- `Thresholds` は T8 で定義し、T9 と両CLIが同じ形で読む ✓
- `ToneReport` は T5 で定義し、T8 の `SeriesReport.tone` が参照 ✓
- `inspectSeriesTone(paths, threshold)` の引数順は T5・T8 で一致 ✓
- `writeVariants(srcPath, outDir, baseName, opts)` の引数順は T4・T9 で一致 ✓


---

## Deviations（計画から逸れたところ）

計画どおりに進めない判断をした箇所を、理由つきで記録する。

### D1: sharp を ^0.34.1 から ^0.35.3 へ（Task 1 実行時）

`npm audit` が高深刻度を1件出した。**sharp 0.35.0 未満は libvips 由来の CVE を4件抱える**
（CVE-2026-33327 / 33328 / 35590 / 35591）。Phase 2 で他人が上げた画像を通す前提のパッケージなので、
ここは落とせない。0.35.3 に上げて `found 0 vulnerabilities` を確認し、
使う API（`create` / `metadata` / `stats` / `resize` / `raw` / `strategy.attention` / `jpeg` / `png`）が
すべて生きていることを実測してから進めた。計画側の記述も直した。

### D2: トーンの中心を平均から中央値へ（Task 5 実行時）

**測って初めて分かった欠陥。** `tools/measure-tone.ts` を合成画像にかけたところ、
揃った3点＋浮いた1点の組で次の値が出た。

| | 犯人（odd） | 揃っている残り3点 |
|---|---|---|
| 平均を中心にする（当初の設計） | 0.7071 | **0.3851〜0.3991** |
| 参考: 犯人を外して測った場合 | — | 0.1286〜0.1709 |

**浮いた1点が中心そのものを動かすので、ちゃんと揃っている残りまで距離が3倍近くに跳ね上がる。**
この状態で閾値を1本引くと、犯人だけでなくシリーズ全部が引っかかる。順位は正しく出ていたので、
目視のレポートを読んでいるうちは気づけない類のずれだった。

`medianCentroid()`（ビンごとの中央値を取って正規化）に切り替えた結果:

| | 犯人（odd） | 揃っている残り3点 |
|---|---|---|
| 中央値を中心にする（採用） | **1.0000** | **0.0296〜0.2712** |

犯人が上限に張り付き、残りは犯人を外して測った値（0.0274〜0.2635）とほぼ同じところに留まる。
閾値を1本引けば犯人だけが落ちる。`centroid()`（平均）は比較用に残し、
テストで「同じ場面で平均のほうが中心が大きく動く」ことを機械的に固定した。

**この気づきは計画の原則（閾値をベタ書きせず、先に測る道具を作る）がそのまま効いた例。**
測る道具を後回しにしていたら、実素材を12シリーズ生成したあとに同じ壁に当たっていた。

### D3: 音のテスト素材が ffmpeg で作れなかった（Task 7 実行時）

2つ続けて踏んだ。どちらも**仮定で書いた引数が実際には通らない**類。

1. **`-filter_complex` と `-af` は同じストリームに併用できない。**
   「無音1.5秒 + トーン1秒」を concat してから音量を下げようとして
   `Filtergraph 'volume=-6dB' was specified for a stream fed from a complex filtergraph` で落ちた。
   音量調整も chain の中に入れて `[0][1]concat=n=2:v=0:a=1,volume=-6dB[out]` + `-map "[out]"` にした。

2. **lavfi の `sine` はフルスケールではない。** ピークは **-18.1 dB**。
   `volume=12dB` を掛けても -6.1 dB にしかならず、「0dBFS に張り付いた音」の素材にならなかった。
   ゲインを振って実測したところ **+20dB から 0.0 dB に達する**ので、余裕を見て +25dB にした。

   | ゲイン | 実測ピーク |
   |---|---|
   | +12dB | -6.1 dB |
   | **+20dB** | **0.0 dB** |
   | +25dB | 0.0 dB |
   | +30dB | 0.0 dB |

### D4: build-catalog がスタックトレースを吐いていた（Task 9 実行時）

検品で止まったとき、`inspect` は読めるレポートを出すのに `build-catalog` は
Node の未処理例外としてスタックトレースを吐いていた。**CLI の存在意義が読める指摘を返すことなので**、
try/catch で理由だけを出し、`npm run inspect -- series/<slug>` への導線を添えて終了コード 1 で終わるようにした。

## 実行結果（2026-08-20）

- **9タスクすべて完了。80テスト通過・`tsc --noEmit` クリーン。**
- `npm run inspect -- series/night-desk` は「素材がまだ無い」ことを6点とも名指しで止める（期待どおり）
- `npm run build-catalog` も同じ理由で止まり、読めるメッセージを返す
- 生成元の法務ゲートは自動で走り、MusicGen・Grok・Gemini は人が忘れても通らない
- トーンの閾値は `null`（測るだけ）。実素材で計測してから値を入れる

### D5: 競合リサーチを受けてゲート7を追加（2026-08-20 夜）

計画の範囲外だが、リサーチの結果そのまま実装できる形で出たので入れた。

**Adobe Stock の投稿規約が、出来上がった絵ではなくプロンプトの段階で線を引いている**
（アーティスト名・実在の著名人・架空のキャラクター・場所・財産に言及するプロンプトは提出不可）。
KAKERA はプロンプトを全公開するので、**この規約を機械で検査できる**。

`src/catalog/prompt-gate.ts` を足し、`inspectSeries` の中で全かけらのプロンプトに掛けるようにした。
英字の禁止語は語境界を要求し（`unikernel` が `nike` で誤爆しない）、日本語は素の包含で見る。
辞書に無い名前でも `in the style of 〜` の形は止める。

**プロンプト公開が、差別化だけでなくモデレーションの道具になる**という発見が本体。

### D6: Google 画像検索の構造化データを追加（2026-08-20 夜）

無料素材サイトの流入は Google 画像検索が主戦場なのに、設計 v1 に一言も無かった。
`src/build/jsonld.ts` に `imageObjectLd()` を足した。
`license` は**絶対URLでなければならない**（テストの期待値を相対パスで書いて落ちた。実装が正しかった）。

**Google は「構造化データは検索順位に影響しない」と明言している。**
効くのはバッジとフィルタへの露出であって順位ではない、という理解で入れている。

## 実行結果の更新（2026-08-20 夜）

- **106テスト通過・tsc クリーン**（80 → 106。ゲート7で13＋3、JSON-LD で10）
