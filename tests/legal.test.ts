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
  it('CC0 とは名乗らず、名乗らない理由を書く', () => {
    expect(h).toMatch(/CC0 を宣言していません/);
    expect(h).toMatch(/著作物性/);
  });
  it('AI生成であることと、一意でないことを断る', () => {
    expect(h).toMatch(/AI/);
    expect(h).toMatch(/類似/);
  });
  it('「独占」を主張しない', () => {
    expect(h).not.toMatch(/独占素材/);
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
    expect(h).toMatch(/存続/);
  });
  it('投稿者の権利表明を書く', () => {
    expect(h).toMatch(/自分が生成/);
  });
  it('人物素材の禁止を書く', () => {
    expect(h).toMatch(/人物/);
  });
  it('生成元の申告を必須と書く', () => {
    expect(h).toMatch(/生成元/);
    expect(h).toMatch(/必須/);
  });
});

describe('moderationPage', () => {
  const h = moderationPage(CFG);
  it('AIが一次で見て、削除は人が決めると書く', () => {
    expect(h).toMatch(/AI/);
    expect(h).toMatch(/人が決め/);
  });
  it('何を削除するかを列挙する', () => {
    for (const w of ['権利', '人物', '違法']) expect(h).toContain(w);
  });
  it('申立ての窓口へ導線がある', () => {
    expect(h).toContain('href="/report"');
  });
});

describe('reportPage', () => {
  const h = reportPage(CFG);
  it('申立ての窓口として連絡先を出す', () => {
    expect(h).toMatch(/申立て/);
    expect(h).toMatch(/@/);
  });
  it('何を書けばよいかを示す', () => {
    expect(h).toMatch(/URL/);
  });
  it('削除の基準へ導線がある', () => {
    expect(h).toContain('href="/moderation"');
  });
});
