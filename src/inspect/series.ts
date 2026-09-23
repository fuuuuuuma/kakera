import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { SeriesDefSchema, type SeriesDef } from '../catalog/schema.js';
import { assertPublishableGenerator } from '../catalog/generators.js';
import { checkPrompt } from '../catalog/prompt-gate.js';
import { inspectImage } from './image.js';
import { inspectSeriesTone, type ToneReport } from './tone.js';
import { inspectLoop } from './video.js';
import { inspectAudio } from './audio.js';

export interface Thresholds {
  toneMaxDistance: number | null;
  loopFirstLastRms: number | null;
  audioMaxVolumeDb: number;
}

export interface PieceIssue {
  pieceId: string;
  file: string;
  issues: string[];
}

export interface SeriesReport {
  slug: string;
  def: SeriesDef;
  pieceIssues: PieceIssue[];
  tone: ToneReport | null;
  /** 公開を止める理由。空なら出せる */
  blocking: string[];
  ok: boolean;
}

const MAX_EDGE_SILENCE_MS = 500;

export async function loadSeriesDef(dir: string): Promise<SeriesDef> {
  const raw = await readFile(join(dir, 'series.json'), 'utf8');
  return SeriesDefSchema.parse(JSON.parse(raw));
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

export async function inspectSeries(dir: string, th: Thresholds): Promise<SeriesReport> {
  const def = await loadSeriesDef(dir);
  const blocking: string[] = [];
  const pieceIssues: PieceIssue[] = [];

  // 法務ゲート: 人が覚えている前提にしない。ここで必ず走る。
  for (const kind of new Set(def.pieces.map((p) => p.kind))) {
    try {
      assertPublishableGenerator(def.generator.service, kind);
    } catch (e) {
      blocking.push((e as Error).message);
    }
  }

  const stillPaths: string[] = [];

  for (const piece of def.pieces) {
    const path = join(dir, piece.file);
    if (!(await exists(path))) {
      blocking.push(`かけら ${piece.id} のファイルが見つかりません: ${piece.file}`);
      continue;
    }

    const issues: string[] = [];

    // ゲート7: プロンプトの禁止語検査。種別によらず全部に掛ける。
    for (const v of checkPrompt(piece.prompt)) {
      issues.push(
        `プロンプトに使えない語が入っています（${v.category}）: "${v.matched}"`,
      );
    }

    if (piece.kind === 'still') {
      const r = await inspectImage(path, { alpha: piece.alpha });
      issues.push(...r.issues);
      if (!piece.alpha) stillPaths.push(path);
    } else if (piece.kind === 'loop') {
      const r = await inspectLoop(path, th.loopFirstLastRms);
      issues.push(...r.issues);
    } else {
      const r = await inspectAudio(path, {
        maxVolumeDb: th.audioMaxVolumeDb,
        maxEdgeSilenceMs: MAX_EDGE_SILENCE_MS,
      });
      issues.push(...r.issues);
    }

    if (issues.length > 0) pieceIssues.push({ pieceId: piece.id, file: piece.file, issues });
  }

  // トーンの揃いは不透明な静止画だけで測る。透過は背景が無いので比べられない。
  const tone = stillPaths.length > 0 ? await inspectSeriesTone(stillPaths, th.toneMaxDistance) : null;
  if (tone) blocking.push(...tone.issues);

  const ok = blocking.length === 0 && pieceIssues.length === 0;
  return { slug: def.slug, def, pieceIssues, tone, blocking, ok };
}
