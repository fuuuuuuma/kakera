/**
 * プロンプトの禁止語検査。
 *
 * Adobe Stock の投稿規約は、出来上がった絵ではなく**プロンプトの段階で線を引いている**:
 *   「アーティスト名・実在の著名人・架空のキャラクター・場所・財産に言及するプロンプトで
 *    作った作品は、法的権利がある場合を除き提出できない」
 *
 * KAKERA はプロンプトを全公開する設計なので、この規約を機械で検査できる。
 * プロンプト公開は差別化のためだけでなく、**モデレーションの道具**でもある。
 *
 * 辞書は完全ではない。**通ったから安全という保証にはならない**。
 * 明らかなものを機械で落とし、残りは通報と削除で受けるという役割分担にしている。
 */

export type BannedCategory = 'artist' | 'person' | 'character' | 'brand' | 'place';

export interface PromptViolation {
  /** 辞書に載っている見出し（小文字） */
  term: string;
  category: BannedCategory | 'style-reference';
  /** プロンプトの中で実際に当たった文字列 */
  matched: string;
}

/**
 * 初期辞書。**運用しながら足していく前提**で、いまは「まず確実に落としたいもの」だけ。
 * 短すぎる語・一般名詞と衝突する語は入れない（「Sora」は空／そらと衝突するので入れない）。
 */
export const BANNED: Record<BannedCategory, string[]> = {
  artist: [
    'greg rutkowski',
    'artgerm',
    'makoto shinkai',
    '新海誠',
    'hayao miyazaki',
    '宮崎駿',
    'yoji shinkawa',
    'banksy',
    'yayoi kusama',
    '草間彌生',
    'takashi murakami',
    '村上隆',
  ],
  person: ['elon musk', 'taylor swift', 'donald trump', 'emma watson', 'scarlett johansson'],
  character: [
    'mickey mouse',
    'ミッキーマウス',
    'pikachu',
    'ピカチュウ',
    'totoro',
    'トトロ',
    'doraemon',
    'ドラえもん',
    'super mario',
    'spider-man',
    'darth vader',
    'hello kitty',
    'ハローキティ',
  ],
  brand: [
    'coca-cola',
    'コカコーラ',
    'starbucks',
    'スターバックス',
    'louis vuitton',
    'ルイヴィトン',
    'ferrari',
    'フェラーリ',
    'nike',
    'ナイキ',
    'apple logo',
    'rolex',
  ],
  place: ['tokyo disneyland', '東京ディズニーランド', 'universal studios', 'ユニバーサルスタジオ'],
};

/** 辞書に無い名前でも、この形は作風の借用を指すので止める */
const STYLE_PATTERNS = [/\bin the style of\b/i, /\bstyle of\b/i, /のスタイルで/, /風に描/];

const LATIN = /^[\x20-\x7E]+$/;

/** 英字の語は語の途中で誤爆しないよう境界を要求する。日本語は境界の概念が無いので素の包含で見る。 */
function findTerm(prompt: string, term: string): string | null {
  if (LATIN.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i');
    const m = prompt.match(re);
    return m ? m[0] : null;
  }
  const i = prompt.indexOf(term);
  return i >= 0 ? prompt.slice(i, i + term.length) : null;
}

/**
 * 引っかかった箇所を返す。空配列なら（この辞書の範囲では）通る。
 * 同じ見出しが何回出ても1件にまとめる。
 */
export function checkPrompt(prompt: string): PromptViolation[] {
  const out: PromptViolation[] = [];
  const seen = new Set<string>();

  for (const [category, terms] of Object.entries(BANNED) as [BannedCategory, string[]][]) {
    for (const term of terms) {
      if (seen.has(term)) continue;
      const matched = findTerm(prompt, term);
      if (matched !== null) {
        seen.add(term);
        out.push({ term, category, matched });
      }
    }
  }

  for (const re of STYLE_PATTERNS) {
    const m = prompt.match(re);
    if (m) {
      out.push({ term: re.source, category: 'style-reference', matched: m[0] });
      break; // 形の指摘は1件で足りる
    }
  }

  return out;
}
