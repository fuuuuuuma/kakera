# KAKERA

AI生成の画像・動画素材を無料で配る素材サイト。Cloudflare Workers + D1 (SQLite互換) +
R2 (S3互換オブジェクトストレージ) で動く。公開サイト: https://kakera.fuuuuuuma.dev

素材そのものは商用利用可・クレジット表記不要（ファイルそのものの再配布・転売のみ禁止）。
詳しくは https://kakera.fuuuuuuma.dev/license を参照。**この README・LICENSE ファイルが
対象にしているのはこのリポジトリのソースコードのライセンス (MIT) であり、サイトが配る
素材ファイルのライセンス (KAKERA License) とは別物**（`LICENSE` ファイル末尾を参照）。

## できること

- **カタログ配信**: 運営が審査して収録したシリーズを検索・ダウンロードできる静的サイト
- **投稿の全員開放 (Phase 2)**: 誰でも `/api/submit` でシリーズ (6〜12点) を投稿でき、
  自動検品を通れば即座に公開される（人の事前承認を待たない。詳細設計は
  `docs/design-2026-09-23-phase2-open-submissions.md`）
- **通報・取り下げ**: `/api/report` で通報を受け付け、削除の実行は
  `/api/admin/takedown`（管理者トークン必須）で人が承認したときだけ行う

## 技術構成

- Cloudflare Workers（`src/worker/index.ts` がエントリポイント）
- D1（`DB` バインディング。マイグレーションは `migrations/*.sql`）
- R2（`ASSETS_BUCKET` バインディング。バケット名は `wrangler.jsonc` を参照）
- Workers AI（`AI` バインディング。投稿画像の不適切コンテンツ一次チェックに使用。
  **モデル選定・精度は実機未検証** — 2026-09-23 時点の既知の未検証事項）
- Zod によるスキーマ検証、TypeScript（`noUncheckedIndexedAccess: true`）

Cloudflare Workers の実行環境には Node.js のネイティブモジュール（`sharp` / `ffmpeg` /
`child_process` 等）が無いため、投稿時の自動検品は「Workers 上で動く軽い検査」と
「投稿後に別の場所で動かす重い検査（未実装。ループ継ぎ目・無音・シリーズ内の色の揃い
など）」に分けて設計している。詳細は `docs/design-2026-09-23-phase2-open-submissions.md` §1。

## セットアップ（開発）

```sh
npm install
npm test              # vitest run
npx tsc --noEmit       # 型検査
npx wrangler types     # worker-configuration.d.ts を再生成 (gitignore 対象・ローカルのみ)
npx wrangler dev --local   # ローカルでD1/R2をエミュレートして起動 (Workers AIは実機に繋がるため注意)
```

**フォークしてローカルで動かす場合**: `wrangler.jsonc` の `d1_databases[0].database_id`
はこのプロジェクト運営者自身の Cloudflare アカウント内の D1 インスタンスIDです。
自分の環境で動かすには `npx wrangler d1 create <好きな名前>` で自分のD1を作り、
その `database_id` に差し替えてください（そのまま使うと他人のDBを指してしまいます）。
同様に R2 バケット（`kakera-assets`）も自分のアカウントで作成したものに差し替えてください。

`wrangler dev --local` は D1 / R2 を完全にローカルでエミュレートしますが、
**Workers AI (`AI` バインディング) だけは常に Cloudflare 側の実サービスへ接続し、
ローカル実行中でも課金対象になり得ます**（Cloudflare公式の明記）。ローカル検証時は
AIモデレーションを通る手前のパス（不正なリクエスト・ゲート不合格のケースなど）を
中心に確認し、実際にAI呼び出しへ到達するテストは避けるか、事前に把握したうえで行ってください。

必要な環境変数 / Secrets（`npx wrangler secret put <名前>` で設定）:

| 名前 | 用途 | 省略時 |
|---|---|---|
| `ADMIN_TOKEN` | `/api/admin/*` の認証（ヘッダ `x-admin-token` と一致するか） | 未設定なら管理APIは常に401 |
| `TURNSTILE_SECRET` | Cloudflare Turnstile (CAPTCHA) のサーバー側検証 | 未設定なら Turnstile 検証は常に失敗扱い |
| `REQUIRE_TURNSTILE` | `"false"` にすると開発中は Turnstile なしで投稿APIを叩ける | 既定 true (必須) |
| `IP_SALT` | ダウンロード集計・投稿回数制限のIPハッシュ化に使うsalt | 既定値あり (`kakera` 等の固定文字列。公開前に運用値へ差し替え推奨) |

## ディレクトリ

```
src/worker/      Cloudflare Worker 本体 (index.ts) と投稿API (submit.ts)
src/catalog/     運営審査カタログのスキーマ・生成元格付け・投稿の検品ゲート (community.ts)
src/inspect/     画像・音声・動画・色調の検品 (Node専用。sharp/ffmpeg依存。Workers上では動かない)
src/site/        静的サイトのページ生成
migrations/      D1のスキーマ migration
docs/            設計ドキュメント (design-*.md が正本。plans/ は過去の実行計画)
tools/           運営側の生成・検品CLI (measure-tone / build-catalog / build-site 等)
tests/           vitest
```

## 貢献

素材を追加したい方も、コードを直したい方も `CONTRIBUTING.md` を参照してください。

## ライセンス

コード: MIT (`LICENSE` を参照)。素材ファイル自体: KAKERA License
(https://kakera.fuuuuuuma.dev/license 、商用可・クレジット不要・再配布/転売のみ禁止)。
