# CONTRIBUTING

KAKERA への貢献方法は2種類あります。**素材の追加は API から（コードは不要）**、
**サイト・Worker の改善はコードの PR から**、です。

## 1. 素材を追加する (API・コード不要)

`POST /api/submit` にシリーズ（6〜12点のPNG画像＋メタデータ）を送ると、自動検品を
通った時点で**即座に公開**されます（人の事前承認は待ちません）。詳しい検品の中身は
`docs/design-2026-09-23-phase2-open-submissions.md` を参照してください。

### 送るもの

```jsonc
{
  "slug": "night-office",              // 半角英数字とハイフンのみ
  "title": "夜のオフィス街",
  "description": "落ち着いた夜のオフィス街の切り抜き素材",
  "tone": { "light": "夜", "colorTemp": "寒色", "framing": "広め", "texture": "マット" },
  "creatorHandle": "@your_name",       // @に続けて半角英数字とアンダースコアのみ
  "consent": {
    "termsVersion": "2026-09-23",
    "licenseVersion": "kakera-free-v1",
    "agreedAt": "2026-09-23T12:00:00Z",
    "rightsAttestation": true,          // 自分に権利があることの表明 (必須)
    "depictsPersonDeclared": false,     // 人物を描いていないことの表明 (falseのみ許可)
    "generatorDeclared": { "service": "openai-imagegen", "model": "...", "version": "..." }
  },
  "turnstileToken": "...",              // 現在は不要（REQUIRE_TURNSTILE=false）。送っても無視されます
  "pieces": [
    {
      "id": "piece-1",                  // 半角英数字とハイフンのみ・同一シリーズ内で重複不可
      "kind": "still",                  // 現在は static (静止画) のみ対応
      "mime": "image/png",              // 実バイト列がPNGでなければ拒否されます (申告は信用しません)
      "bytesBase64": "...",             // PNGファイルのbase64
      "prompt": "落ち着いたオフィス、朝の光",
      "alpha": false                    // 透過PNGなら true
    }
    // ... 6〜12点
  ]
}
```

### 満たす必要があること (通らないと422で理由が返ります)

- **投稿できる生成元だけ**: `src/catalog/generators.ts` の格付けを参照 (現状は
  Codex/DALL-E系など「出力の権利が利用者に帰属する」と確認できているものだけ)
- **人物を描かない**: `depictsPersonDeclared` は `false` のみ許可。実在人物・
  写実的な人物描写を含む素材は投稿できません
- **禁止語チェック**: プロンプトに特定アーティスト名・キャラクター名等を含められません
  (`src/catalog/prompt-gate.ts`)
- **解像度**: PNGの長辺が1024px以上（運営投稿の基準2048pxより緩めています）
- **6〜12点で1シリーズ**、全点で光・色温度・構図・質感のトーンを揃えてください
- **1日5シリーズまで**（IPアドレスのハッシュ単位。回数制限）

### 通った後

自動検品（Workers上で動く範囲の検査＋AIによる不適切コンテンツの一次チェック）を
通れば即座に公開されます。問題が見つかった場合は `POST /api/report` から取り下げを
申し立てられます。**削除の実行は必ず人が確認したうえで行います**（自動削除はしません）。

### Premiere から送りたい場合

Cut & SRT プラグイン（[premiere-cut-srt-plugin](../premiere-cut-srt-plugin/)）の
素材タブ「KAKERA」から、生成〜プレビュー〜投稿までできます。

### Codex で生成してそのまま投稿する

裏で動く Codex（`codex exec` の ImageGen）に画像を作らせて、`tools/submit-series.ts`
（`npm run submit-series`）でそのまま KAKERA に投稿できます。**既定では送信せず、
手元で検査だけします。** `--send` を付けたときだけ実際に送信します。

1. **Codex に依頼する。** トーンを揃えた6〜12枚、人物を描かない、長辺2048px推奨、
   という条件を依頼文に入れます。例:

   ```
   KAKERA用の素材を9枚作ってください。テーマ「夜のオフィス街のデスク」。
   すべて同じ光・同じ色温度・同じ構図でそろえること（シリーズとして使うため）。
   人物は一切描かないこと（手元・後ろ姿・シルエットも禁止）。
   実在のブランド名・キャラクター名・アーティスト名を含めないこと。
   すべてPNG、長辺2048px推奨（最低1024px）。
   ```

   生成された画像は `~/.codex/generated_images` に残ります
   （`tools/normalize-200-assets.ts` 冒頭のコメント参照）。

2. **メタデータJSONを用意する。** 見本: `docs/submit-series.meta.example.json`
   （コピーして書き換えてください。`slug`・`title`・`description`・`tone`・
   `creatorHandle`・`generatorDeclared` は必須。`prompt` は全点共通、点ごとに
   変えたい場合は `prompts: { "ファイル名.png": "個別プロンプト" }` を使います）。

3. **検査する（送信しない）。**

   ```sh
   npm run submit-series -- --from-codex 9 --meta meta.json
   ```

   `~/.codex/generated_images` から更新日時が新しい順に9枚選び、本番の投稿API
   (`/api/submit`) と同じ検品ゲート（枚数・PNGとして読めるか・長辺1024px以上・
   slugの形・プロンプト禁止語・生成元格付け）を手元で実行して要約を表示します。
   ここでは何も送信しません。

4. **問題が無ければ送信する。**

   ```sh
   npm run submit-series -- --from-codex 9 --meta meta.json --send
   ```

   既定の送信先は `https://kakera.fuuuuuuma.dev` です。`wrangler dev` 等
   ローカルの Worker へ試し送りしたいときは `--endpoint http://localhost:8787`
   を付けてください。環境変数 `KAKERA_ADMIN_TOKEN` を設定していれば
   `x-admin-token` ヘッダを付けて送ります（運営者は1日5シリーズの上限だけ
   免除されます。値はログに出しません）。

## 2. コードを直す (PR)

```sh
git clone <このリポジトリ>
cd kakera
npm install
npm test              # vitest run。まずこれが通ることを確認する
npx tsc --noEmit       # 型検査
```

### 開発の約束

- **コメント・エラーメッセージは日本語**（既存コードに合わせる）
- **Cloudflare Workers ランタイムのファイル (`src/worker/*.ts`) は Node.js
  ネイティブモジュールに依存しない** (`sharp`・`child_process`・`fs` は使えません)。
  重い画像・動画処理が必要な検品は `src/inspect/*.ts` (Node専用・ローカル/CIでのみ実行)
  に置き、Worker からは呼びません
- **投稿API (`src/worker/submit.ts`) を触るときは、必ずテストを足す**: 特に
  「悪い入力・想定外の失敗で公開されないこと」（`expect(deps.puts.length).toBe(0)` の
  パターン）。このAPIは認証なしで誰でも叩けるため、失敗時は必ず「保留・不合格」側に
  倒す設計を崩さないでください
- **D1/R2への実際のI/Oは `SubmitDeps`/`ReportDeps` インターフェース越しに書く**
  (`src/worker/submit.ts` の既存のパターンを参照)。テストは偽物の deps を直接渡します
  (`wrangler`のミニフレア相当の実行環境は使っていません)
- **`wrangler dev --local` で確認できます** (D1・R2はローカルでエミュレートされますが、
  `AI` バインディングは常に実サービスへ接続します。課金・実際のモデレーション呼び出しを
  避けたい場合は、AI呼び出しへ到達する前に失敗するパス（不正なリクエスト等）で確認してください)
- **本番デプロイ (`wrangler deploy`) はメンテナが行います。** PRの中でデプロイは不要です

### PRの出し方

1. 変更に対応するテストを追加・更新する
2. `npm test` と `npx tsc --noEmit` が通ることを確認する
3. 何を・なぜ変えたかを説明するPRを送る（設計上の判断が絡む場合は、既存の
   `docs/design-*.md` との整合性にも触れてください）

## ライセンスについて

投稿した素材は、KAKERA の投稿規約に従い、非独占・無償・世界的・再許諾可能なライセンスを
KAKERA に付与したものとして扱われます（著作権自体は投稿者に残ります）。コードへの
PR は、このリポジトリの MIT ライセンスの下で貢献したものとして扱われます。
