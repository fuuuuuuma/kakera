// html.ts ではなく html-core.ts から取る。html.ts は node:fs (loadSiteConfig) を
// 持っていて、layout.ts は Worker からも直接 import される (src/worker/community.ts)
// ため、fs をバンドルに巻き込まないようにする。
import { esc, type SiteConfig } from './html-core.js';

/**
 * 白基調・ゴシック体。面を重ねず、黒の細い罫線と余白で構造を作る。影は使わない。
 * 差し色は青1色。数字（DL数）は等幅で大きく出す — これがこのサイトの通貨だから。
 *
 * 色の値は mock/top.html で全161テキスト要素を走査して WCAG AA を満たしたもの。
 * 薄いグレーは 3.05:1 で落ちたので --faint は #67717A まで濃くしてある。目分量で薄くしない。
 */
export const CSS = `
[hidden]{display:none !important}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#101315;
 font-family:"Noto Sans JP",system-ui,sans-serif;font-size:15px;line-height:1.8;
 font-feature-settings:"palt" 1}
a{color:inherit}
/* height:auto が要る。width/height 属性（CLS対策で入れている）は presentational hint として
   使用高さを決めてしまい、height が auto でないと aspect-ratio も intrinsic 比率も効かない。
   これが無いと 1920x1080 の画像が「幅125px・高さ1080px」になる（実測で踏んだ）。 */
img{max-width:100%;height:auto;display:block}
:focus-visible{outline:2px solid #1749FF;outline-offset:2px}
:root{--ink:#101315;--sub:#5A6570;--faint:#67717A;--rule:#DFE3E7;--rule2:#EDF0F2;
 --panel:#F7F8F9;--blue:#1749FF}
.wrap{max-width:1200px;margin:0 auto;padding:0 28px}
header{border-bottom:1px solid var(--ink);position:sticky;top:0;background:#fff;z-index:50}
header .row{display:flex;align-items:center;gap:16px;height:62px}
.logo{font-family:"Archivo",sans-serif;font-weight:900;font-size:21px;letter-spacing:.2em;
 text-decoration:none}
header nav{margin-left:auto;display:flex;gap:24px;font-size:13.5px;font-weight:500}
header nav a{text-decoration:none;color:var(--sub);white-space:nowrap}
header nav a:hover{color:var(--ink)}
h1{font-size:clamp(26px,4vw,44px);font-weight:900;line-height:1.34;letter-spacing:-.02em;
 margin:36px 0 16px}
h2{font-size:19px;font-weight:900;letter-spacing:-.01em;margin:0}
.crumb{font-size:12.5px;color:var(--sub);margin:22px 0 0}
.crumb a{color:var(--sub)}
.sechead{display:flex;align-items:flex-end;gap:16px;padding-bottom:14px;
 border-bottom:2px solid var(--ink);margin:52px 0 0}
.sechead .note{font-size:12.5px;color:var(--faint);padding-bottom:3px}
.lead{max-width:42em;font-size:15.5px;line-height:2.05;color:var(--sub);margin:0 0 28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));
 border-left:1px solid var(--rule);border-top:1px solid var(--rule);margin-top:20px}
.card{border-right:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:16px}
.card a{text-decoration:none}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:3px}
.tiles img{aspect-ratio:16/9;object-fit:cover;width:100%}
/* 透過素材は切らない。切り抜きを cover で切ると絵が壊れる（書き出しと同じ理由）。 */
.tiles.alpha img,.frame.alpha img{object-fit:contain}
.card h3{margin:13px 0 4px;font-size:15px;font-weight:700;letter-spacing:-.01em}
.card .by{font-size:12.5px;color:var(--sub)}
.card .foot{display:flex;align-items:center;gap:14px;padding-top:11px;margin-top:11px;
 border-top:1px solid var(--rule2)}
.dl{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11.5px;color:var(--sub);
 letter-spacing:.04em;font-variant-numeric:tabular-nums}
.tag{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.06em;
 border:1px solid var(--rule);padding:2px 7px;color:var(--sub);white-space:nowrap}
.tag.alpha{border-color:var(--blue);color:var(--blue)}
.tagline{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
/* 比率の枠。masonry にしない — 編集者は 16:9 か 9:16 かで捨てるので、実比率を見せる */
.pieces{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px;
 margin-top:24px}
.piece{border:1px solid var(--rule);padding:14px}
.piece a{text-decoration:none}
.piece .frame{display:flex;align-items:center;justify-content:center;background:var(--panel);
 border:1px solid var(--rule);height:190px;overflow:hidden}
.piece .frame img{max-height:100%;width:auto;object-fit:contain}
.preview.checker img{max-height:70vh;width:auto;margin:0 auto}
.piece .ratio{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;
 color:var(--faint);letter-spacing:.08em;margin-top:8px}
.preview{margin-top:20px;border:1px solid var(--rule)}
.btn{display:inline-flex;align-items:center;gap:7px;font-size:13.5px;font-weight:700;
 padding:9px 18px;text-decoration:none;border:1px solid var(--ink)}
.btn-p{background:var(--ink);color:#fff}
.btn:hover{background:var(--blue);border-color:var(--blue);color:#fff}
.dllist{list-style:none;padding:0;margin:20px 0 0}
.dlrow{display:flex;align-items:center;gap:14px;padding:10px 0;
 border-bottom:1px solid var(--rule2);flex-wrap:wrap}
.consent{font-size:11.5px;color:var(--sub);margin-top:12px;line-height:1.8;max-width:42em}
.consent a{color:var(--blue)}
.kv{border-top:1px solid var(--rule);margin:20px 0 0;padding:0}
.kv div{display:flex;gap:16px;padding:9px 0;border-bottom:1px solid var(--rule2);font-size:13px}
.kv dt{flex:none;width:9em;color:var(--faint);font-weight:400;
 font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.08em;
 padding-top:3px}
.kv dd{margin:0;color:var(--ink);word-break:break-all}
.kv dd strong{font-family:"Archivo",sans-serif;font-weight:900;font-size:26px;
 font-variant-numeric:tabular-nums;letter-spacing:-.02em}
pre.prompt{background:var(--panel);border:1px solid var(--rule);padding:14px;margin:16px 0 0;
 font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;line-height:1.9;
 white-space:pre-wrap;word-break:break-word;color:var(--ink)}
.filters{display:flex;gap:6px;flex-wrap:wrap;margin:18px 0 0}
.filters button{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;
 letter-spacing:.08em;padding:6px 12px;border:1px solid var(--rule);color:var(--sub);
 background:none;cursor:pointer}
.filters button[aria-pressed="true"]{background:var(--ink);color:#fff;border-color:var(--ink)}
.prose{max-width:44em}
.prose h2{margin:36px 0 12px;font-size:17px}
.prose p,.prose li{color:var(--sub);font-size:14.5px;line-height:2}
.prose strong{color:var(--ink)}
footer{margin-top:64px;border-top:1px solid var(--ink);padding:28px 0 70px;
 font-size:12.5px;color:var(--sub);line-height:2}
footer nav{display:flex;gap:20px;flex-wrap:wrap;margin-top:12px}
footer nav a{color:var(--sub)}
@media (max-width:480px){
 .wrap{padding-left:14px;padding-right:14px}
 header .row{gap:10px}
 .logo{font-size:18px;letter-spacing:.16em}
 header nav{gap:12px;font-size:12px}
}
/* 市松（透過であることを見せる地）。
   .piece .frame の background ショートハンドに打ち消されていたので、
   詳細度を合わせたうえで宣言順を最後に置く。 */
.checker,.piece .frame.checker,.tiles.checker{
 background-color:#fff;
 background-image:
  linear-gradient(45deg,#dfe3e7 25%,transparent 25%,transparent 75%,#dfe3e7 75%),
  linear-gradient(45deg,#dfe3e7 25%,transparent 25%,transparent 75%,#dfe3e7 75%);
 background-size:14px 14px;
 background-position:0 0,7px 7px}
@media (prefers-reduced-motion:reduce){*{transition:none !important}}
`;

const FONTS =
  'https://fonts.googleapis.com/css2?family=Archivo:wght@700;900&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+JP:wght@400;500;700;900&display=swap';

/**
 * ダウンロードの計数。**非同期にし、失敗してもダウンロードを止めない。**
 * 数えられないことより、落とせないことのほうが悪い。
 */
const BEACON = `
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[data-download]');
  if (!a) return;
  try {
    var body = JSON.stringify({ series: a.dataset.series, piece: a.dataset.piece });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/download', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/download', { method: 'POST', body: body, keepalive: true }).catch(function () {});
    }
  } catch (_) { /* 数えられなくてもダウンロードは止めない */ }
});
`;

export function layout(args: {
  title: string;
  description: string;
  canonicalPath: string;
  body: string;
  cfg: SiteConfig;
  head?: string;
}): string {
  const { title, description, canonicalPath, body, cfg } = args;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — KAKERA</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(cfg.siteUrl + canonicalPath)}">
<meta property="og:title" content="${esc(title)} — KAKERA">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${CSS}</style>
${args.head ?? ''}
</head>
<body>
<header><div class="wrap row">
<a class="logo" href="/">KAKERA</a>
<nav>
<a href="/">シリーズ</a><a href="/community">みんなの投稿</a><a href="/license">ライセンス</a><a href="/terms">投稿規約</a>
</nav>
</div></header>
<main class="wrap">${body}</main>
<footer><div class="wrap">
<div><strong>KAKERA</strong> — 動画編集者とサムネイル制作者のための、AI生成素材ライブラリ。
同じ光・同じ色でそろえた組で置いています。</div>
<div>すべて AI で生成した素材です。他の利用者が類似の出力を得る場合があります。</div>
<nav>
<a href="/community">みんなの投稿</a>
<a href="/license">ライセンス全文</a><a href="/terms">投稿規約</a>
<a href="/moderation">削除の基準</a><a href="/report">権利侵害の申立て</a>
</nav>
</div></footer>
<script>${BEACON}</script>
</body>
</html>`;
}
