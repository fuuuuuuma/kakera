import { z } from 'zod';
import { KINDS, type Kind } from './generators.js';

export const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export const GeneratorRefSchema = z.object({
  service: z.string().min(1),
  model: z.string().min(1),
  version: z.string().min(1).default('unknown'),
});

export const PieceDefSchema = z.object({
  id: z.string().regex(SLUG),
  kind: z.enum(KINDS),
  /** シリーズディレクトリからの相対パス */
  file: z.string().min(1),
  prompt: z.string().min(1),
  seed: z.number().int().optional(),
  negativePrompt: z.string().optional(),
  /** 透過PNGか。true なら比率バリアントを作らない */
  alpha: z.boolean().default(false),
  /** サムネ用途。true なら 1280×720 を必ず書き出す */
  forThumbnail: z.boolean().default(false),
  useTags: z.array(z.string()).default([]),
});

export const ToneSchema = z.object({
  light: z.string().min(1),
  colorTemp: z.string().min(1),
  framing: z.string().min(1),
  texture: z.string().min(1),
});

export const SeriesDefSchema = z.object({
  slug: z.string().regex(SLUG),
  title: z.string().min(1),
  description: z.string().min(1),
  audience: z.array(z.enum(['editor', 'thumbnail'])).min(1),
  creator: z.string().regex(/^@[a-z0-9_]+$/),
  license: z.literal('kakera-free'),
  tone: ToneSchema,
  generator: GeneratorRefSchema,
  /** 全シリーズでプロンプトを公開する。false は許さない */
  promptPublic: z.literal(true),
  pieces: z.array(PieceDefSchema).min(6).max(12),
});

export type GeneratorRef = z.infer<typeof GeneratorRefSchema>;
export type PieceDef = z.infer<typeof PieceDefSchema>;
export type SeriesDef = z.infer<typeof SeriesDefSchema>;

/** 書き出したファイル1つ。 */
export interface CatalogVariant {
  ratio: '16:9' | '9:16' | '1:1' | 'source';
  w: number;
  h: number;
  /** R2 のキー。**実ファイルの置き場所と必ず一致させる** */
  key: string;
  bytes: number;
  /** 書き出し後の形式。元ファイルの mime とは別物（PNG を JPEG に書き出すため） */
  mime: string;
}

export interface CatalogPiece {
  id: string;
  kind: Kind;
  prompt: string;
  seed?: number;
  alpha: boolean;
  useTags: string[];
  sha256: string;
  bytes: number;
  mime: string;
  durationMs?: number;
  loopSeamless?: boolean;
  variants: CatalogVariant[];
}

export interface CatalogSeries {
  slug: string;
  title: string;
  description: string;
  audience: ('editor' | 'thumbnail')[];
  creator: string;
  license: 'kakera-free';
  tone: z.infer<typeof ToneSchema>;
  generator: GeneratorRef;
  promptPublic: true;
  pieceCount: number;
  toneMaxDistance: number;
  pieces: CatalogPiece[];
}

export interface Catalog {
  version: 1;
  builtAt: string;
  seriesCount: number;
  pieceCount: number;
  series: CatalogSeries[];
}
