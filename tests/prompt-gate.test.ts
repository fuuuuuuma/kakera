import { describe, it, expect } from 'vitest';
import { checkPrompt, BANNED } from '../src/catalog/prompt-gate.js';

describe('プロンプトの禁止語検査（Adobe Stock の投稿規約を機械化したもの）', () => {
  it('ふつうの素材プロンプトは通る', () => {
    expect(
      checkPrompt(
        'a wooden writing desk at night lit by a single warm desk lamp, open notebook and pen, no people, 2700K',
      ),
    ).toEqual([]);
  });

  it('日本語のプロンプトも通る', () => {
    expect(checkPrompt('夜のデスク、電球色のスタンド1灯、木の天板、人物なし')).toEqual([]);
  });

  it('アーティスト名を含むと止める', () => {
    const v = checkPrompt('a dark room in the style of Greg Rutkowski');
    expect(v.length).toBeGreaterThan(0);
    expect(v.some((x) => x.category === 'artist')).toBe(true);
  });

  it('架空のキャラクター名を含むと止める', () => {
    expect(checkPrompt('ミッキーマウスが机に座っている').some((x) => x.category === 'character')).toBe(
      true,
    );
  });

  it('実在の著名人を含むと止める', () => {
    expect(checkPrompt('a desk owned by Elon Musk').some((x) => x.category === 'person')).toBe(true);
  });

  it('ブランド・財産を含むと止める', () => {
    expect(checkPrompt('a Coca-Cola bottle on the desk').some((x) => x.category === 'brand')).toBe(
      true,
    );
  });

  it('大文字小文字は区別しない', () => {
    expect(checkPrompt('IN THE STYLE OF GREG RUTKOWSKI').length).toBeGreaterThan(0);
  });

  it('辞書に無い名前でも「in the style of 〜」の形なら止める', () => {
    const v = checkPrompt('a quiet desk in the style of Some Unknown Painter');
    expect(v.some((x) => x.category === 'style-reference')).toBe(true);
  });

  it('「style of」だけでも拾う（in が無い書き方）', () => {
    expect(checkPrompt('desk, style of a famous illustrator').length).toBeGreaterThan(0);
  });

  it('どこが引っかかったかを返す', () => {
    const v = checkPrompt('a Coca-Cola bottle');
    expect(v[0]!.matched.toLowerCase()).toContain('coca-cola');
  });

  it('同じ語が2回出ても1件にまとめる', () => {
    const v = checkPrompt('Coca-Cola and more Coca-Cola');
    expect(v.filter((x) => x.term === 'coca-cola').length).toBe(1);
  });

  it('辞書は空でない（カテゴリごとに語がある）', () => {
    for (const [cat, terms] of Object.entries(BANNED)) {
      expect(terms.length, `${cat} が空`).toBeGreaterThan(0);
    }
  });

  it('英字の禁止語は語の途中では誤爆しない', () => {
    // "nike" を含むが別の語（"unikernel"）。止めてはいけない
    expect(checkPrompt('a unikernel diagram on screen')).toEqual([]);
  });
});
