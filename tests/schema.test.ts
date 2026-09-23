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

  it('openai-imagegen は静止画だけ通る', () => {
    expect(() => assertPublishableGenerator('openai-imagegen', 'still')).not.toThrow();
    expect(() => assertPublishableGenerator('openai-imagegen', 'loop')).toThrow(/種別/);
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
