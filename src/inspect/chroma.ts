/**
 * 単色背景の抜き（クロマキー）。
 *
 * 生成時に「plain flat solid <色> background」を指定しているので、背景は一定の単色になる。
 * それならローカルで抜ける。API へ1点ずつ投げる往復が要らず、閾値も自分で調整できる。
 *
 * 抜いた結果は必ず既存の検品ゲート2（アルファ実在）に通すこと。
 * ここが通らないものは棚に出さない。
 */

export interface ChromaResult {
  /** RGBA の生ピクセル（入力と同じ寸法） */
  data: Uint8Array;
  /** 完全に透明になった画素の割合（0〜1）。0 に近すぎたら抜けていない */
  transparentRatio: number;
  /** 推定した背景色 */
  background: [number, number, number];
}

/** 四隅の小さな窓から背景色を推定する。中央の主体を拾わないため。 */
export function estimateBackground(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
): [number, number, number] {
  const win = Math.max(2, Math.round(Math.min(width, height) * 0.02));
  const corners: [number, number][] = [
    [0, 0],
    [width - win, 0],
    [0, height - win],
    [width - win, height - win],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const [cx, cy] of corners) {
    for (let y = cy; y < cy + win; y++) {
      for (let x = cx; x < cx + win; x++) {
        const i = (y * width + x) * channels;
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
        n++;
      }
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/** 0〜255 のユークリッド距離。単色背景の判定にはこれで足りる。 */
function dist(
  r: number,
  g: number,
  b: number,
  bg: [number, number, number],
): number {
  const dr = r - bg[0];
  const dg = g - bg[1];
  const db = b - bg[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 単色背景を抜く。
 *
 * `near` 以下なら完全に透明、`far` 以上なら完全に不透明、その間は線形に羽根を付ける。
 * 羽根が無いとギザギザが残り、広すぎると輪郭が溶ける。
 */
export function chromaKey(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
  opts: { near?: number; far?: number; background?: [number, number, number] } = {},
): ChromaResult {
  const bg = opts.background ?? estimateBackground(data, width, height, channels);
  const near = opts.near ?? 60;
  const far = opts.far ?? 110;

  const out = new Uint8Array(width * height * 4);
  let transparent = 0;

  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const d = dist(r, g, b, bg);

    let a: number;
    if (d <= near) a = 0;
    else if (d >= far) a = 255;
    else a = Math.round(((d - near) / (far - near)) * 255);

    if (a === 0) transparent++;

    const o = p * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }

  return { data: out, transparentRatio: transparent / (width * height), background: bg };
}

/**
 * 半透明の画素に残った背景色のにじみを抑える。
 *
 * 羽根の部分は「主体の色」と「背景の色」が混ざっているので、そのままだと
 * 輪郭にマゼンタの縁が出る。混ざったぶんを背景の側へ差し戻す。
 */
export function suppressSpill(
  rgba: Uint8Array,
  background: [number, number, number],
): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let o = 0; o + 3 < rgba.length; o += 4) {
    const a = rgba[o + 3]!;
    out[o + 3] = a;
    if (a === 0 || a === 255) {
      out[o] = rgba[o]!;
      out[o + 1] = rgba[o + 1]!;
      out[o + 2] = rgba[o + 2]!;
      continue;
    }
    // 観測色 = 主体色 * α + 背景色 * (1-α) を主体色について解く
    const k = a / 255;
    for (let c = 0; c < 3; c++) {
      const v = (rgba[o + c]! - background[c]! * (1 - k)) / k;
      out[o + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return out;
}
