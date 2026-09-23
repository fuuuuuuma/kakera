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
  'openai-imagegen': {
    id: 'openai-imagegen',
    label: 'OpenAI ImageGen',
    grade: 'A',
    kinds: ['still'],
    note: 'OpenAI Terms of Use で Output の権利を利用者へ譲渡。第三者権利の確認と AI 生成表示は KAKERA 側で継続する',
  },
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
    throw new Error(`${g.label} は格付け ${g.grade} なので公開できません: ${g.note}`);
  }
  if (!g.kinds.includes(kind)) {
    throw new Error(
      `${g.label} は種別 "${kind}" に使えません（使えるのは ${g.kinds.join(', ') || 'なし'}）`,
    );
  }
}
