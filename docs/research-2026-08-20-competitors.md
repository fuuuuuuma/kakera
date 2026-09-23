# 競合リサーチと設計の見直し（2026-08-20）

設計 v1 を書いたあとに、競合の**中身**を調べた記録。
規約の文面だけでなく、公開APIを実際に叩いてデータ構造とランキングの実装を見ている。

結論を先に: **立ち位置は正しかったが、報酬設計が既知の失敗と同型だった。**
加えて、設計に一言も入っていなかった大きな穴が3つある。

---

## 1. 立ち位置 — 空いているマスが正確に分かった

| | UGCのAI生成物を受け入れるか | 価格 |
|---|---|---|
| **Pexels** | **禁止**（ToS 7B） | 無料 |
| **Unsplash** | **禁止**（投稿ガイドライン） | 無料 |
| **Freepik** | **受け入れる**。ツールのホワイト/ブラックリスト無し。**`_ai_generated` タグ必須**（違反はアカウント処分） | 有料 |
| **Adobe Stock** | **受け入れる**。「Created using generative AI tools」のチェック必須 | 有料 |
| **ぱくたそ** | **受け入れない**（自社生成のみ） | 無料 |
| **Civitai** | 受け入れる | 無料＋投げ銭 |

**「無料ストックは AI を閉じ、有料ストックは受け入れてラベルを義務化した」**という綺麗な分かれ方をしている。

→ **空いているのは「無料 × 投稿を受け付ける × AI生成 × 日本語」のマスだけ。** ここは本当に空いている。
設計 v1 の立ち位置は正しい。

### ただし ぱくたそが既に AI素材を 4,180点持っている

自社生成・**登録不要**・商用可。カテゴリは
ファンタジー / ダンジョン / サイバーパンク / ゲーム背景 / 部屋 / 光エフェクト / テクスチャ背景 /
炎 / ひび割れ / 魔法陣 / 銀河 / 布。

**初期12シリーズの半分と正面からかぶる**（抽象グラデ背景・光の粒・紙とインクの質感・基板回路）。

ぱくたそに無くて KAKERA にあるもの、として立てられるのは3つだけ:
1. **誰でも投稿できる**（ぱくたそは自社生成のみ）
2. **プロンプトを全公開する**（ぱくたそは非公開）
3. **シリーズ＝揃いで配る**（ぱくたそは単品のカテゴリ分けのみ）

**3つ目が一番強い。** ぱくたそは1点ずつバラバラに作っているので、
「同じ光・同じ色で12点」という単位を持っていない。

---

## 2. 報酬設計が、既知の失敗と同型だった 🔴 最重要

**MakerWorld（Bambu Lab の3Dモデル共有）は、KAKERA と同じ設計で始めて失敗している。**

- **旧制度**: ポイントの配分をほぼ「人気」＝ダウンロード数・印刷数だけで決めた
- **起きたこと**: 公式の言葉で
  「ポイントがダウンロード数と印刷数だけに依存していたとき、**さっと刷れる小物が浮上し、
  手間をかけた複雑な作品が埋もれた**」
  「人気に大きく偏るやり方だと明らかになった。**手の込んだモデルを作った人が、
  すぐ広まった単純なモデルより報われないことがある**」
- **修正**: ①**複数指標の組み合わせ**に変更 ②**Boost**（人が選ぶ加点・12ポイント、独占モデルは15）を導入

**KAKERA の「報酬はいいねとDLランキング」は、MakerWorld が一度通って壊した道そのもの。**

さらに悪いことに、KAKERA には**交換できるものが何も無い**。
- Printables（Prusa）の Prusameters は**自社のプリンタ・フィラメントと交換できる**
- MakerWorld のポイントも Bambu の製品と交換できる
- **KAKERA のいいねは、いいねのままで終わる**

### どう直すか（設計 v2 への反映）

1. **ランキングを「DL数の単独ランキング」にしない。**
   最低でも「DL数 / 保存数 / いいね数 / 揃いの精度（トーン距離）」の複数軸を持ち、
   **軸ごとに別のランキングを出す**。1本の総合順位を作ると必ず「軽いものが勝つ」に収束する
2. **人が選ぶ枠を作る。** MakerWorld の Boost に当たるもの。
   「**今週の一組**」を運営が1つ選んでトップに固定する。機械の順位と別レーンにする
3. **交換できるものが無い事実を直視する。** 現実的な代替は
   - 作者ページを**ポートフォリオとして使えるもの**にする（実績が外部に見せられる）
   - メンテナのチャンネル・note での**紹介枠**を報酬にする（これは実際に価値がある）
   - この2つ以外に出せるものは無い。**無い報酬をあるように見せない**

---

## 3. Civitai の中身から分かったこと（公開APIを実際に叩いた）

`https://civitai.com/api/v1/models` と `/images` の実レスポンス。

### ライセンスを1本の名前ではなく4軸のフラグで持っている

```
allowCommercialUse, allowDerivatives, allowDifferentLicense, allowNoCredit
```

KAKERA は `license: 'kakera-free'` の1種類に固定している。**これは意図的な差**で、
受け取る側に判断させないための設計。ただし裏返しとして
**「自分の条件で出したい作者は KAKERA に投稿しない」**という取りこぼしが必ず出る。
これはトレードオフとして受け入れる（1ライセンス固定は維持）が、**弱点として自覚しておく**。

### ランキングの軸が8つある

```
Highest Rated / Most Downloaded / Most Liked / Most Discussed /
Most Collected / Most Images / Newest / Oldest
期間: Day / Week / Month / Year / AllTime
```

**`Most Collected`（保存された数）が KAKERA に無い軸。**
素材サイトでは「保存」が**いいねよりずっと強い意図**を表す。
編集者は「今すぐ使う」ではなく「今度使う」で保存する。→ **設計に追加する。**

**期間に `Day` がある。** KAKERA は週間を主役にする予定だったが、
**日次があると新規が最短24時間で上位に出られる**。埋もれ対策として効く。→ **追加する。**

### リアクションが5種類ある

```
likeCount / heartCount / laughCount / cryCount / dislikeCount
実データ例: like 911 / heart 330 / laugh 197 / cry 57 / dislike 0
```

素材サイトに笑いと涙は要らないが、**「単一のいいね」が唯一の正解ではない**ことは分かる。
KAKERA に足すなら「いいね」ではなく**「使った」**が正しい。実際に完成物へ使ったという申告は、
DL数よりずっと強い信号になる。→ **v2 で「使った」を検討対象に入れる。**

### 実在人物フラグ（`poi`）を専用に持っている

`poi`（person of interest）/ `nsfw` / `nsfwLevel` / `minor` / `sfwOnly`。
**実在人物を含むかどうかを独立したフラグで管理している。**

設計 v1 は「人物素材は扱わない」で回避したが、**投稿を開放すれば人物は必ず来る**。
拒否するにも「人物かどうか」を持つ必要がある。→ **データモデルに `depictsPerson` を足す。**

### 投げ銭がいいねの80倍ついていた

```
thumbsUpCount: 10,984 / tippedAmountCount: 907,636
```

**「無料」を掲げたプラットフォームでも、価値の受け渡しの手段が結局は要求された。**
Civitai は Buzz という独自通貨で応えている。
KAKERA は金銭を扱わないと決めたので、ここは**意図的に空けたまま**にする。
ただし「作者に何も返らない」ことが離脱の理由になりうる、と分かっている状態で進める。

### ページングが cursor 方式

offset ではなく `nextCursor`。カタログが増え続ける前提なら最初からこうしておく。

---

## 4. 設計に一言も入っていなかった穴 3つ

### 穴① Google 画像検索の構造化データ 🔴

無料素材サイトの流入は Google 画像検索が主戦場。設計 v1 には**一言も入っていない**。

- `schema.org/ImageObject` に `license` / `acquireLicensePage` / `creditText` / `creator` / `copyrightNotice` を入れると、
  Google 画像検索に **「Licensable」バッジ**が出て、ライセンスのフィルタにも入る
- **注意して書く**: Google は「**構造化データは検索順位に影響しない**」と明言している。
  効くのはバッジとフィルタへの露出であって、順位ではない
- 実装は JSON-LD を各かけらのページに置くだけ。**コストはほぼゼロで、やらない理由が無い**

→ **設計 v2 に「かけら詳細ページに ImageObject の JSON-LD を出す」を追加。**

### 穴② AI生成であることのラベル 🟠

- **Freepik は `_ai_generated` タグを義務化**（違反はアカウント処分）
- **Adobe Stock はメタデータのチェックボックスを必須化**
- **EU AI Act 第50条が 2026-08-02 に施行**（透かしの実装には 2026-12-02 までの猶予）
- Google が Search / Chrome / Gemini で **C2PA の検証を展開中**

KAKERA は「AI生成素材の場所」なので全点がAI生成なのは自明だが、
**業界の標準がラベル必須に固まりつつある**以上、明示しないほうが不自然になる。

**法的な整理**（断定は避ける）:
第50条の「出力を機械可読に標識せよ」は**AIシステムの提供者**（Higgsfield 等）の義務で、
配布するだけの KAKERA が提供者に当たる読み方は苦しい。
ただし**利用者（deployer）としての開示義務**が別にあり、対象は
「実在の人物・物・場所・出来事に酷似し、本物と誤認させる」ディープフェイク。
**KAKERA は人物素材を扱わず、実写に酷似した「本物と誤認させる」絵を出さない方針なので、
ここに触れない立て付けにできる。**

→ **設計 v2**: 全かけらに `aiGenerated: true` を持たせ、画面とファイルのメタデータ両方に出す。
生成元（`generator`）は既にデータモデルにあるので、それを表に出すだけで済む。

### 穴③ 投稿プロンプトの機械検査 🟠 これは強い

**Adobe Stock の投稿規約にこうある**:
> アーティスト名・実在の著名人・架空のキャラクター・場所・財産に言及するプロンプトで作った作品は、
> 法的権利がある場合を除き提出できない

これは「出来上がった絵を見て判断する」のではなく、**プロンプトの段階で線を引いている**。

**KAKERA はプロンプトを全公開する設計なので、この規約を機械で検査できる。**
既知のアーティスト名・キャラクター名・著名人名の辞書と突き合わせて、
プロンプトに入っていたら投稿を止める。

**プロンプト公開が「差別化」だけでなく「モデレーションの道具」になる。**
これは設計 v1 が見落としていた、プロンプト公開の2つ目の意味。

→ **設計 v2**: 検品ゲートに「プロンプトの禁止語検査」を追加（7つ目のゲート）。

---

## 5. まだ未確認 / 僕の提案

### 提案: MCP サーバとして素材を配る

メンテナは `/mcp-publish`（任意の配布物にMCP接続URLを発行するスキル）を持っていて、
WazaScout と SkillDeck を既に MCP で配っている。

**KAKERA をMCPサーバにすると、Claude Code や Codex から素材を直接引ける。**
「夜のデスクの背景を1枚くれ」で、エージェントがカタログを検索してURLを返す。

- 誰もやっていない配布経路
- 実装は薄い（カタログJSONを読んで検索して返すだけ）
- **AIエージェントが素材を探す時代の入口を先に取る**

ただし**これは今やることではない**。Web が先。ここに書いて残しておく。

### 未確認のまま残したもの

- MakerWorld の現行ポイント算式の詳細（公式フォーラムが 403 で読めなかった。
  検索結果のスニペットからは「複数指標の組み合わせ」までしか分かっていない）
- Civitai の「Collection」がユーザー側でどう見えているか（APIには数しか出ない）
- ぱくたそのAI素材の実際の質（画像を直リンクできない規約なので、目で見るには手で開くしかない）

---

## 出典

- [Pexels — Can I upload generative AI photos and videos?](https://help.pexels.com/hc/en-us/articles/27453505326873-Can-I-upload-generative-AI-photos-and-videos-to-Pexels)
- [Unsplash Submission Guidelines](https://help.unsplash.com/en/articles/2534415-unsplash-submission-guidelines)
- [Freepik — AI generated resources guidelines](https://support.freepik.com/s/article/AI-generated-resources-General-guidelines)
- [Adobe Stock — Generative AI content guidelines](https://helpx.adobe.com/stock/contributor/submit-your-content/submit-generative-ai-content/generative-ai-content-guidelines.html)
- [ぱくたそ AI素材](https://www.pakutaso.com/ai/)
- [MakerWorld — Why We're Upgrading Our Points System](https://makerworld.com/en/community/post/458727)
- [All3DP — MakerWorld Introduces Boosts](https://all3dp.com/4/makerworld-introduces-boosts-to-tackle-unfair-popularity-based-points-system/)
- [Civitai 公開REST API](https://developer.civitai.com/site/reference/)
- [Google — Image license metadata structured data](https://developers.google.com/search/docs/appearance/structured-data/image-license-metadata)
- [EU AI Act Article 50](https://artificialintelligenceact.eu/article/50/)
- [Content Authenticity Initiative — The State of Content Authenticity in 2026](https://contentauthenticity.org/blog/the-state-of-content-authenticity-in-2026)
