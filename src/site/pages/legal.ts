import { layout, type SiteConfig } from '../html.js';

/**
 * 権利侵害の申立ての宛先。
 *
 * **fuuuuuuma.dev に MX レコードが無いので、そのドメインのアドレスは受信できない**（DNS実測）。
 * 窓口として公開する以上、届かないアドレスは書けない。
 * Cloudflare Email Routing を設定したら kakera@fuuuuuuma.dev へ差し替える。
 */
export const CONTACT = 'pinpon.fuuma@gmail.com';

const page = (
  cfg: SiteConfig,
  title: string,
  path: string,
  desc: string,
  body: string,
): string =>
  layout({
    title,
    description: desc,
    canonicalPath: path,
    body: `<div class="prose">${body}</div>`,
    cfg,
  });

export function licensePage(cfg: SiteConfig): string {
  return page(
    cfg,
    'KAKERA ライセンス',
    '/license',
    'KAKERA の素材の使い方と、禁止していること。',
    `
<h1>KAKERA ライセンス</h1>
<p>KAKERA に置いてある素材は、すべて<strong>無料</strong>です。
ダウンロードした時点で、このライセンスに同意したものとみなします。</p>

<h2>できること</h2>
<ul>
<li><strong>商用利用ができます。</strong>仕事の動画でも、収益化しているチャンネルでも使えます</li>
<li><strong>クレジット不要です。</strong>書いても構いませんが、義務ではありません</li>
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
<p>ここにある素材は<strong>すべて AI で生成したもの</strong>です。
生成に使ったサービスとモデル、そしてプロンプトは、各かけらのページにすべて公開しています。</p>
<p>生成AIの性質上、<strong>他の利用者が類似の出力を得る場合があります。</strong>
「ここでしか手に入らない1枚」ではありません。KAKERA が提供しているのは、
<strong>光も色も画角もそろえた組み合わせ</strong>のほうです。</p>
<p>なお KAKERA は素材に <strong>CC0 を宣言していません</strong>。
AI生成物の著作物性は個別に判断されるもので、権利があることを前提にした放棄の宣言はできないためです。
このライセンスは<strong>利用条件の取り決め</strong>として読んでください。</p>
`,
  );
}

export function termsPage(cfg: SiteConfig): string {
  return page(
    cfg,
    '投稿規約',
    '/terms',
    'KAKERA に素材を載せるときの取り決め。',
    `
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
<p>プロンプトも公開していただきます。KAKERA は全素材のプロンプトを公開する方針です。
アーティスト名・実在の著名人・既存キャラクター・ブランドに言及したプロンプトは受け付けません。</p>
`,
  );
}

export function moderationPage(cfg: SiteConfig): string {
  return page(
    cfg,
    '削除の基準',
    '/moderation',
    'どんなときに素材を削除するか、誰が決めるか。',
    `
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
`,
  );
}

export function reportPage(cfg: SiteConfig): string {
  return page(
    cfg,
    '権利侵害の申立て',
    '/report',
    '権利を侵害している素材を見つけたときの窓口。',
    `
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
判断は人が行います。結果はご連絡いただいた連絡先へお返しします。</p>
`,
  );
}
