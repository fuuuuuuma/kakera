/**
 * 素材URLへ内容由来のバージョンを付ける。
 * 同じ内容なら同じURLを保ち、更新時と事前にキャッシュされた404だけを回避する。
 */
export function assetUrl(baseUrl: string, key: string, sha256: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/${key}?v=${sha256.slice(0, 12)}`;
}
