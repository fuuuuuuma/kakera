/**
 * AIモデレーションに渡す前に画像を縮める。
 *
 * 2026-09-24 に実モデル (@cf/llava-hf/llava-1.5-7b-hf) で測った結果:
 *   - 2048px の PNG (約1.6MB) をそのまま渡すと「3007: Request timeout」
 *   - 長辺 512px の JPEG (20〜30KB) なら 0.7〜1.9 秒で判定できる
 * モデル内部の入力は 336px なので、512px に縮めても判定材料は減らない。
 *
 * 縮小は Workers 用に作られた WebAssembly の photon で行う (Cloudflare Images の
 * 別課金を増やさないため)。画像として読めないものは例外にし、呼び出し側で保留に倒す。
 */
import { PhotonImage, resize, SamplingFilter } from '@cf-wasm/photon';

export const MODERATION_MAX_EDGE = 512;
const JPEG_QUALITY = 80;

export function shrinkForModeration(bytes: Uint8Array): Uint8Array {
  const img = PhotonImage.new_from_byteslice(bytes);
  try {
    const w = img.get_width();
    const h = img.get_height();
    const scale = Math.min(1, MODERATION_MAX_EDGE / Math.max(w, h));
    if (scale === 1) return img.get_bytes_jpeg(JPEG_QUALITY);
    const small = resize(
      img,
      Math.max(1, Math.round(w * scale)),
      Math.max(1, Math.round(h * scale)),
      SamplingFilter.Triangle,
    );
    try {
      return small.get_bytes_jpeg(JPEG_QUALITY);
    } finally {
      small.free();
    }
  } finally {
    img.free();
  }
}
