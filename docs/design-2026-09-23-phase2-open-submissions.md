# KAKERA Phase 2 — 投稿の全員開放（設計）

- 日付: 2026-09-23
- 前提: `docs/design-2026-08-20.md` §10〜14（生成・検品パイプライン／フェーズ／やらないこと／リスク一覧）
- 決定事項（ユーザー・メンテナ指示）: 「自動検品つきで即公開」。誰でも投稿でき、人の承認は待たずに公開する。
  追加の瞬間に機械で検品（解像度・透過・シリーズ内の色の揃い・生成元の格付け・AIによる不適切画像の一次チェック）。
  問題があれば後から取り下げ＝**削除の実行は人の承認**（運営の既存決定「通報・削除の運用」と同じ線）。
- この文書の役割: Phase 2（§12）を実装するにあたっての具体設計。実装（Worker・D1・Cut&SRT連携）は
  この文書のあとに行った。**本番デプロイ・公開リポジトリ化はしていない**（手元での実装とテストまで）。

## 1. 一番大事な制約: 重い検品は Worker の中で実行できない

設計書 §10 の機械検品ゲート1〜7のうち、既存実装 (`src/inspect/*.ts`) は次のものに依存する。

| モジュール | 依存 | Cloudflare Workers で動くか |
|---|---|---|
| `image.ts`（ゲート1・2: 解像度・アルファ） | `sharp`（ネイティブバイナリ） | **不可**（Workers は V8 isolate。ネイティブ拡張・libvipsバインディングは動かない） |
| `video.ts`（ゲート3: ループ判定） | `sharp` + `child_process`（ffmpeg呼び出し）+ `fs` | **不可**（child_process・ファイルシステムが無い） |
| `audio.ts`（ゲート4: 無音検査） | `child_process` + `fs` | **不可** |
| `tone.ts`（ゲート5: 色ヒストグラム距離） | `sharp` | **不可** |
| `generators.ts`（ゲート6: 生成元格付け） | 純粋なJS（Recordの参照） | **可** |
| `prompt-gate.ts`（ゲート7: 禁止語検査） | 純粋なJS（文字列一致） | **可** |

**これは実装上の制約であって、運用でごまかせない事実。** そのため「即公開」の中身を、
「全ゲートが公開前に完了する」ではなく「**Workerで完結できるゲートだけを公開の関門にし、
残りは公開直後の非同期ジョブで検査して、結果を通報キューと同じ人手承認の削除フローに合流させる**」
という形に設計し直した。

**これは私の推測であり、ユーザーの確認が要る。** 「即公開」の文言がこの非同期扱いを許容するかは
明言されていない。許容しない場合は、Cut & SRT 側でゲート3〜5相当の検査を実行してから投稿する
（Pythonの `Pillow`/`ffmpeg` はサーバー側では動くため技術的には可能）か、専用の常時稼働コンピュート
（Cloudflare Queues consumer を Node/Container 実行環境で動かす、等）を別途用意する必要がある。
今回はコストと実装量を抑えるため前者（非同期・公開後検査）を選んだ。

### 1.1 公開の関門（同期・投稿APIがブロックする）

1. **schema検証**（`SeriesDefSchema`/`PieceDefSchema` 相当。zodはWorkersで動く）
2. **ゲート6: 生成元格付け**（`assertPublishableGenerator`。既存コードをそのまま使う）
3. **ゲート7: プロンプト禁止語検査**（`checkPrompt`。既存コードをそのまま使う）
4. **ゲート1・2の軽量版**: `sharp` を使わず、PNG/JPEGのファイル先頭バイトを直接読んで
   幅・高さ・カラータイプ（PNGのIHDRチャンクのcolor typeが6=RGBA/4=グレースケール+アルファなら
   「アルファチャンネルを持つ」と判定できる）を取り出す。**「実際に透けている画素があるか」
   （`hasRealAlpha`）は画素を全走査する必要がありWorkerのCPU時間的に不確実なため、
   Phase 2では見送り、ゲート2は「アルファチャンネルの有無」だけをブロッキング条件にする**
5. **人物写り込みの自己申告**: `depictsPerson` を投稿者が明示的に `false` と申告しないと投稿不可
   （設計書 §13「人物素材は扱わない。投稿でも禁止」をAPIレベルで強制する）
6. **AIによる不適切画像の一次チェック（新規）**: Cloudflare **Workers AI** の画像分類モデル
   （候補: `@cf/microsoft/resnet-50` は一般物体分類でNSFW検出には弱い。より適切なのは
   Cloudflare公式の **Image Moderation** 系バインディングだが、2026-09時点でWorkers AIの
   カタログに専用NSFW分類モデルが無いため、**代替として暫定的に汎用の視覚言語モデル
   （`@cf/llava-hf/llava-1.5-7b-hf` 等）へ「この画像に性的・暴力的・人物の実写に極めて近い
   表現が含まれるか」を尋ねるプロンプトを投げ、Yes/不明な回答は保留（=投稿を止めてキューへ）**、
   という設計にした。Workers AIは同期呼び出しでき、タイムアウトはWorkerのCPU時間制限とは別枠
   （GPU推論はCloudflareのインフラ側で実行されるため）。**モデル選定は実機（`wrangler dev`ではなく
   実際のWorkers AI呼び出し）で精度を測っていない。暫定実装であることを明記する**
7. **投稿規約・KAKERAライセンスへの同意の記録**（後述 §3）
8. **いたずら対策**（後述 §2）を通過

### 1.2 公開後の非同期チェック（ブロックしない・結果は取り下げ検討キューへ）

- ゲート3（ループのシームレス判定）・ゲート4（無音検査）・ゲート5（シリーズ内トーンの揃い）
- 実行主体: Cloudflare **Queues**。投稿APIが受理した時点でメッセージをQueueへ積み、
  consumer Worker（`sharp`を使わない範囲で簡易実装するか、**このタスクでは実装を見送り
  「設計のみ」とし、キューにメッセージを積むところまでを実装した**。理由: consumer側の
  重い画像処理も結局Workers isolateの中で動くため、根本的な解決には
  ①WASM版画像ライブラリへの置き換え ②Cloudflare Containers（Docker実行環境）での実行、
  のどちらかが要る。どちらも検証に時間がかかるため、今回は「積むところまで」で止めた
- 判定結果は `moderation_flag` テーブルに記録し、しきい値を外れたものは
  既存の `Report`（通報）と同じ人手承認の削除フローに乗せる（§4）

### 1.3 検品を迂回されない作り

- 投稿APIは「クライアントが検品済みと申告した」情報を一切信用しない。
  ゲート1・2・6・7は**Worker側で受け取ったファイル・メタデータそのものに対して**再実行する
  （Cut&SRT側で先に検品していても、Worker側でもう一度やる。二重にはなるが、これが
  「迂回されない」の唯一の担保。クライアント側の検品はUXのためだけで、信頼の根拠にしない）
- R2への書き込みは、投稿APIがゲートを全部通した**後**にのみ行う（Workerのコード上、
  R2書き込み呼び出しの前に全ゲートのreturn/throwが完了している一本道にする。
  実装は `src/worker/submit.ts` の `handleSubmit` を参照）

## 2. いたずら対策

- **Cloudflare Turnstile**（無料・専用の検証エンドポイントをWorkerから叩く）を投稿フォームに設置。
  トークンをAPIへ渡し、Workerが `https://challenges.cloudflare.com/turnstile/v0/siteverify` を
  サーバーサイドで検証する（このタスクでは**実際にTurnstileサイトキーを取得していない**ため、
  検証ロジックはテストで偽物のfetchを差し込んで確認し、実キーの設定は本番導入時の作業として残す）
- **回数制限**: 同一IPハッシュ（既存の `hashIp` をそのまま使う）で1日あたりの投稿数に上限を設ける
  （既定5シリーズ/日。D1に `submission_event(ip_hash, day)` を持ち `download_event` と同じ
  一意制約パターンで数える）
- **ログインの要否（提案）**: **投稿にはGoogleログインを必須にすることを推奨する。**
  理由: いいねは既に「Google必須」（運営の既存決定）という前例があり実装コストの増分が小さい。
  匿名投稿+即時自動公開の組み合わせは、Turnstile+IP制限だけでは「別IPから量産」を防げない。
  ログイン必須にすれば `creator_id` 単位でも回数制限・取り下げ履歴の追跡ができ、
  悪質な投稿者のアカウント単位のブロックが可能になる。**ただし「誰でも追加」という依頼の趣旨と
  多少の摩擦があるため、最終判断はユーザーに委ねる。** 今回の実装は
  「ログイン必須」を既定にしつつ、匿名投稿を許可するかどうかは環境変数
  （`REQUIRE_LOGIN_FOR_SUBMIT`）で切り替えられる形にした（既定値: true）

## 3. 同意の記録

投稿ごとに以下を記録する（`community_series.consent_json` に保存。改変不可のログとして残す）:

```json
{
  "termsVersion": "2026-09-23",
  "licenseVersion": "kakera-free-v1",
  "agreedAt": "2026-09-23T12:00:00Z",
  "rightsAttestation": true,
  "depictsPersonDeclared": false,
  "generatorDeclared": { "service": "openai-imagegen", "model": "codex-cli", "version": "0.154.0" }
}
```

投稿規約の要点（設計書 §7 に準拠。全文はPhase 2公開時に別ページで用意する）:
投稿者はKAKERAに対し非独占・無償・世界的・再許諾可能なライセンスを付与する／著作権は手放さない／
取り下げ可能だが取り下げ前にダウンロードされた素材のライセンスは存続する。

## 4. 取り下げ（通報→人の承認で削除）

既存の `Report` 概念（設計書 §9）をそのままD1テーブル化し、投稿者自身の取り下げ申立ても
同じテーブル・同じフローに合流させる（`reason: "self-withdraw"`）。

```
POST /api/report          { targetType, targetId, reason, contact }  → status="pending" で登録
GET  /api/admin/queue      (要 X-Admin-Token)                         → pending一覧 (Report + moderation_flag)
POST /api/admin/takedown   (要 X-Admin-Token) { targetId, action }    → 承認したら community_series.status を "removed" にし R2 は残す(証拠保全)・一覧から外す
```

管理者認証は簡易な共有シークレット（`ADMIN_TOKEN` という Workers Secret とヘッダ一致）にした。
本番導入時はCloudflare AccessやOAuthへの置き換えを推奨する（今回は「手元で作ってテストまで」の
範囲のため簡易実装で止めている）。

## 5. データモデル（新規・community_ 接頭辞で既存の運営投稿分と分離）

既存の `series`/`piece`（設計書§9のデータモデル）はまだD1化されておらず、現状は
ビルド時に静的JSON化される運用（`src/build/catalog.ts`）。Phase 2はこれを壊さないよう、
**コミュニティ投稿ぶんは別テーブル・別の一覧面（`/community` 想定）として作る。**
将来的に運営投稿分もD1化して統合することは可能だが、今回のタスクの範囲外。

```sql
community_series(
  id, slug, title, description, tone_light, tone_color_temp, tone_framing, tone_texture,
  creator_handle, generator_service, generator_model, generator_version,
  depicts_person, prompt_public,
  status,            -- 'published' | 'removed' | 'pending_review'
  consent_json,
  created_at
)
community_piece(
  id, series_id, kind, r2_key, bytes, mime, sha256, prompt, seed, alpha,
  has_alpha_channel,  -- ゲート2 (軽量版) の結果
  created_at
)
moderation_flag(
  id, series_id, gate, severity, detail, created_at, resolved
)
report(
  id, target_type, target_id, reason, contact, status, created_at
)
submission_event(
  ip_hash, day, count
)
```

## 6. Cut & SRT（Premiere パネル）からの投稿導線

Cut & SRT の素材タブ「KAKERA」サブページを、現状の「説明1行＋Webタブで開く」から、
「注文（シリーズ名・トーン・枚数）→サーバーが `codex exec` で生成（一時フォルダ）→
パネルで見本確認→『KAKERAに載せる』ボタンで投稿API送信」の流れに拡張する。
**ボタンを押すまでは何も外へ出さない。押したら何をどこへ送るかを確認の1行で出す。**
詳細はCut & SRT側の設計書（`premiere-cut-srt-plugin/docs/superpowers/specs/`）と実装
（`server/kakera_generate_job.py`・`assets_tab.js`）を参照。

生成元の申告は `{"service":"openai-imagegen","model":"codex-cli","version":"<codexのバージョン>"}`
を使う。**`openai-imagegen` は既に `src/catalog/generators.ts` に格付けAとして登録されている**
（「OpenAI Terms of Use で Output の権利を利用者へ譲渡」という根拠。これは今回のタスクより前の
既存の判断で、このタスクで新たに追加・検証したものではない）。今回のタスクではOpenAI公式サイトへの
直接アクセスがブロックされ（WebFetchが403を返す）、この既存判断を一次情報で再検証することは
できなかった。**再検証はしていない**——既存の判断をそのまま使っただけである。

## 7. 未着手・要判断のまとめ

1. Turnstileの実サイトキー取得（本番導入時の作業）
2. AIモデレーション（Workers AI呼び出し）のモデル選定と精度測定（実機未検証）
3. ゲート3〜5の非同期実行の実装本体（Queue consumerの中身。今回はキューに積むところまで）
4. 投稿にGoogleログインを必須にするかどうかの最終判断
5. 管理画面の認証をAdminトークンから正式な仕組み（Cloudflare Access等）へ置き換え
6. `openai-imagegen` 格付けAの一次情報での再確認（今回は未実施）

## 8. セキュリティ点検 (本体・2026-09-23) への対応

コミット後、本体からの自動セキュリティ点検で4件の指摘を受け、すべて修正した
(テストも追加。`npm test` で回帰を固定済み)。

1. **moderation-fail-open**: `moderateImage` 実装 (`submitDepsFromEnv`) 自体は
   例外時に `flagged:true` を返すようにしてあったが、それを実装側の善意に依存させず、
   呼び出し側 (`handleSubmit`) でも `withTimeout` (20秒) + try/catch で包み、
   タイムアウト・想定外の例外のどちらでも機械的に「保留=不合格」へ倒すようにした。
   さらに `route()` 全体を最上位の try/catch で包み、どのゲート・deps実装が
   想定外の例外を投げても 500 を返すだけで、公開状態にならないことを保証した
   (書き込みは全ゲート通過後にしか走らないため、例外到達時点でDB/R2への書き込みは
   まだ起きていない)。生成元格付けゲート (`assertPublishableGenerator`) は元々
   try/catchで正しく失敗側に倒れていたことを確認した (回帰なし)。
2. **input-validation**: `piece.id` が形式検査されないまま R2 キー
   `community/<seriesId>/<piece.id>` へ直接使われていた。`SLUG` と同じ許可リスト
   ( `^[a-z0-9][a-z0-9-]{0,63}$` ) で検証し、`../` 等のパス文字列・重複idを
   schemaゲートで拒否するようにした。また `checkImageGateLite` が
   クライアント申告の `mime` を信用しており、`mime` を偽るだけで中身が何であれ
   無検査で通っていた (Phase 2はPNG限定の設計なのに、mimeを image/png 以外と
   偽るだけで抜けられた)。実バイト列のマジックバイト (PNG シグネチャ) だけで
   判定するよう変更し、R2への保存時の `contentType` もクライアント申告値ではなく
   常に `'image/png'` (サーバー側で検証済みの値) を使うようにした。加えて、
   Phase 2 は静止画の検品しか実装していないため `kind` を `'still'` のみに制限した
   (`loop`/`se`/`bgm` は内容検査が無いまま通ってしまうため)。
3. **resource-exhaustion**: base64デコード (重い処理) が枚数・サイズの上限チェックより
   前に走っていたため、大量・巨大なpiecesを送るだけでデコード分のCPU時間を消費させられた。
   デコード前に `pieces.length` (最大30件・schemaゲート本来の上限12より緩い早期リジェクト用)
   と、1点ごとの `bytesBase64` 文字列長 (約20MB相当) を弾くようにした。加えて
   `/api/submit`・`/api/report` の両方に、JSONパース前の `Content-Length` 上限
   (それぞれ40MB・16KB) を追加した。
4. **4件目 (通知に詳細が無かったため自分で点検して発見)**: `handleReport`
   (`/api/report`) には `handleSubmit` と違って回数制限が無く、無認証のまま
   連打できた。`submission_event` テーブルを `day` を `"report:<日付>"` で
   名前空間分けして流用し、1日20件の上限を追加した (投稿の5件より緩め。
   通報は投稿より軽い行為のため)。また、`reason`/`contact` に文字数上限
   (2000字・200字) を追加した。加えて `checkAdminAuth` の `===` 比較を
   定数時間比較に変更した (タイミング攻撃対策)。CORS/Origin ヘッダは元々
   何も設定していないことを確認した (Cookie等のambient credentialに依存しない
   設計のため、CORSヘッダの有無自体は攻撃面を増やしていないと判断し、変更なし)。
   秘密値 (`ADMIN_TOKEN`/`TURNSTILE_SECRET`/`IP_SALT`) は元からコード中に
   バインディング名としてのみ登場し、実値のコミットは無いことを再確認した。
