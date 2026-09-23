/**
 * 60シリーズ拡張のうち、ビジネス・技術14シリーズを定義する単一ソース。
 *
 * npm run prepare-root-series
 * npx tsx tools/prepare-root-ai-series.ts --prompts server-room
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Seed {
  slug: string;
  title: string;
  description: string;
  scene: string;
  style: string;
  composition: string;
  lighting: string;
  palette: string;
  textures: string;
  tone: { light: string; colorTemp: string; framing: string; texture: string };
  tags: string[];
  shots: string[];
}

const SERIES: Seed[] = [
  {
    slug: 'server-room', title: 'サーバールーム',
    description: 'データセンターのラック、配線、冷却設備を、冷たいシアン光で統一したテクノロジーBロールです。',
    scene: 'a clean professional data center with no people',
    style: 'premium cinematic editorial photography, realistic materials',
    composition: 'wide 16:9 landscape, eye-level 35mm lens, strong depth and clean negative space',
    lighting: 'cool cyan practical lighting with restrained contrast, calm and precise',
    palette: 'charcoal black, steel grey, muted cyan',
    textures: 'brushed metal, perforated rack doors, polished anti-static floor',
    tone: { light: '天井の白色灯と弱いシアンの機器光', colorTemp: '5000K前後の寒色', framing: '目線の高さから35mmの広角。直線と奥行きを強調', texture: '黒い金属ラック、細かなメッシュ、反射を抑えた床' },
    tags: ['Bロール', 'テクノロジー'],
    shots: [
      'symmetrical rows of matte black server racks seen down the central aisle',
      'a close view of neatly routed network cables and subtle status lights',
      'rear rack doors and organized cable trays extending into the distance',
      'raised-floor cooling vents between two rows of server cabinets',
      'a wide corner view of multiple server aisles with repeating geometry',
      'a closed data-center access door glowing softly at the end of an aisle',
    ],
  },
  {
    slug: 'circuit-closeup', title: '回路基板の接写',
    description: '回路パターン、実装部品、はんだの反射を、深い緑と青のマクロ撮影でそろえた素材です。',
    scene: 'a generic unbranded electronic circuit board in a dark studio',
    style: 'ultra-detailed cinematic macro photography, physically realistic',
    composition: 'wide 16:9 macro frame, shallow depth of field, diagonal leading lines',
    lighting: 'low-key cool rim light with small cyan reflections',
    palette: 'deep PCB green, black, copper, muted cyan',
    textures: 'fiberglass board, copper traces, matte components, metallic solder joints',
    tone: { light: '暗いスタジオの寒色リムライト', colorTemp: '5200K前後の寒色', framing: 'マクロの浅い被写界深度。斜めの導線', texture: '基板、銅配線、マットな部品、はんだの点反射' },
    tags: ['Bロール', 'テクノロジー'],
    shots: [
      'copper traces weaving between small surface-mount components',
      'a blank square processor package surrounded by tiny capacitors',
      'rows of clean solder joints catching a narrow rim light',
      'a macro view across layered circuit pathways and vias',
      'a generic connector socket and nearby components in shallow focus',
      'an abstract low-angle view skimming across a dense circuit board',
    ],
  },
  {
    slug: 'data-visualization-concept', title: 'データ可視化コンセプト',
    description: '数字や文字を使わず、光る立体グラフと透明パネルでデータの増減を表す抽象ビジュアルです。',
    scene: 'an abstract dark presentation space with floating data forms, no interface text',
    style: 'polished cinematic 3D visualization with realistic glass and soft volumetric light',
    composition: 'wide 16:9 frame, layered depth, clear central subject and negative space',
    lighting: 'controlled blue and violet glow on a dark background',
    palette: 'navy, black, cyan, restrained violet',
    textures: 'transparent glass panels, luminous bars, matte floor, soft particles',
    tone: { light: '青紫の発光体による低照度の面光源', colorTemp: '寒色の青〜紫', framing: '中央に主題を置いた奥行きのある16:9', texture: '透明ガラス、発光する立体、微細な粒子' },
    tags: ['Bロール', 'ビジネス'],
    shots: [
      'ascending translucent bars arranged like a chart without labels or numbers',
      'a flowing line made of luminous nodes rising across transparent panels',
      'stacked glass columns with different heights on a dark reflective floor',
      'concentric data rings and small light points forming a clean analytic composition',
      'a field of glowing cubes with one clear upward progression',
      'two abstract groups of light blocks suggesting comparison without text',
    ],
  },
  {
    slug: 'finance-desk', title: '数字を扱うデスク',
    description: '計算、集計、予算管理を連想させる机上の道具を、落ち着いた昼光で統一したビジネスBロールです。',
    scene: 'a tidy unbranded finance work desk with blank documents and no people',
    style: 'realistic editorial still-life photography',
    composition: 'wide 16:9 landscape, slightly elevated 45-degree view, organized geometry',
    lighting: 'soft neutral daylight from one side with gentle shadows',
    palette: 'warm wood, off-white paper, graphite grey, muted green',
    textures: 'paper, wood grain, brushed metal, glass',
    tone: { light: '窓からの中立的な拡散光', colorTemp: '4300K前後のニュートラル', framing: '斜め上45度の整理された机上構図', texture: '木、紙、金属、ガラスの控えめな反射' },
    tags: ['Bロール', 'ビジネス'],
    shots: [
      'a blank calculator beside neatly stacked blank paper and a pencil',
      'small neutral coins arranged beside an empty notebook and ruler',
      'a blank chart sheet with simple unlabeled lines under a metal clip',
      'organized receipt-like blank slips beside a ceramic cup',
      'a magnifying glass resting over abstract grid paper with no readable marks',
      'a closed ledger-style notebook with a calculator and paper clips',
    ],
  },
  {
    slug: 'ecommerce-packaging', title: 'EC梱包',
    description: '無地の箱、薄紙、緩衝材、テープを、明るい作業台で統一したEC・物流向け素材です。',
    scene: 'a clean small-business packing table with generic unbranded materials and no people',
    style: 'bright realistic commercial editorial photography',
    composition: 'wide 16:9 landscape, slightly overhead view, simple usable arrangement',
    lighting: 'soft diffused daylight with light warm shadows',
    palette: 'kraft brown, off-white, pale beige, muted sage',
    textures: 'corrugated cardboard, tissue paper, paper tape, wood table',
    tone: { light: '明るい窓光の拡散光', colorTemp: '4200K前後の自然光', framing: '斜め上からの作業台。余白を広く取る', texture: '段ボール、薄紙、紙テープ、木の天板' },
    tags: ['Bロール', 'EC'],
    shots: [
      'an open kraft shipping box lined with folded off-white tissue paper',
      'three different sizes of plain sealed cardboard boxes arranged neatly',
      'paper tape, twine, and a blank shipping label beside a small box',
      'recycled paper cushioning gathered around a simple unbranded parcel',
      'a top-down view of flat boxes, scissors, and blank cards arranged for packing',
      'a closed parcel wrapped in kraft paper with a simple natural twine knot',
    ],
  },
  {
    slug: 'education-desk', title: '学習机',
    description: 'ノート、鉛筆、本、定規を、柔らかな朝の光でそろえた学習・教育向けBロールです。',
    scene: 'a quiet study desk with generic blank learning materials and no people',
    style: 'warm realistic editorial still-life photography',
    composition: 'wide 16:9 landscape, elevated 35-degree angle, clean negative space',
    lighting: 'soft morning window light with delicate shadows',
    palette: 'light wood, cream paper, muted blue, soft yellow',
    textures: 'paper fibers, wood grain, painted pencils, matte book covers',
    tone: { light: '朝の柔らかな窓光', colorTemp: '4000K前後の自然な暖色', framing: '斜め上35度。手前に余白を確保', texture: '紙、木、鉛筆のマットな質感' },
    tags: ['Bロール', '教育'],
    shots: [
      'an open blank notebook with two pencils and a wooden ruler',
      'a small stack of plain books beside an eraser and pencil sharpener',
      'colored pencils arranged in a gentle fan on blank drawing paper',
      'a simple desk globe without readable labels beside a closed notebook',
      'blank index cards organized with binder clips and a pen',
      'an empty classroom-style desk with a notebook centered in warm light',
    ],
  },
  {
    slug: 'wellness-still-life', title: 'ウェルネスの静物',
    description: 'タオル、石、キャンドル、ハーブティーを、生成りの柔らかな光で統一した素材です。',
    scene: 'a calm minimalist wellness still life in a neutral quiet room, no people',
    style: 'premium natural lifestyle photography, realistic and understated',
    composition: 'wide 16:9 landscape, close still life with generous breathing room',
    lighting: 'soft diffused side light with warm gentle shadows',
    palette: 'linen white, sand beige, pale sage, warm stone grey',
    textures: 'linen, smooth stone, frosted glass, raw wood, dried herbs',
    tone: { light: '生成りの柔らかな片側拡散光', colorTemp: '3800K前後の暖色', framing: '寄りの静物。左右どちらかに余白', texture: 'リネン、石、曇りガラス、木、乾燥ハーブ' },
    tags: ['Bロール', 'ライフスタイル'],
    shots: [
      'rolled white towels with smooth stones and a small unlit candle',
      'a clear cup of herbal tea beside dried leaves and a linen cloth',
      'a small frosted glass bottle with a blank label beside pale flowers',
      'a wooden massage brush and folded linen on a light stone surface',
      'three balanced river stones with a soft green leaf nearby',
      'a shallow ceramic bowl of water reflecting warm window light',
    ],
  },
  {
    slug: 'food-prep', title: '料理の下ごしらえ',
    description: '野菜、包丁、ボウル、まな板を、自然光の俯瞰でそろえた料理Bロールです。',
    scene: 'a clean home kitchen prep surface with fresh generic ingredients and no people',
    style: 'natural realistic food editorial photography',
    composition: 'wide 16:9 landscape, overhead or high 60-degree view, orderly negative space',
    lighting: 'soft neutral daylight with crisp but gentle food texture',
    palette: 'natural wood, leafy green, tomato red, ceramic white',
    textures: 'fresh vegetables, wood cutting board, brushed steel, ceramic bowls',
    tone: { light: '自然な窓光の拡散光', colorTemp: '4300K前後の自然光', framing: '真上〜斜め上60度の俯瞰', texture: '野菜、木のまな板、金属、陶器' },
    tags: ['Bロール', '料理'],
    shots: [
      'colorful whole vegetables arranged around an empty wooden cutting board',
      'sliced tomatoes and herbs beside a clean unbranded kitchen knife',
      'small ceramic bowls holding measured spices with no labels',
      'leafy greens being prepared beside a glass bowl and folded towel',
      'a simple row of chopped vegetables organized by color',
      'a wooden spoon, whisk, and empty mixing bowl ready for cooking',
    ],
  },
  {
    slug: 'travel-essentials', title: '旅の持ち物',
    description: 'バッグ、サングラス、地図、カメラ小物を、明るい旅支度の俯瞰でそろえた素材です。',
    scene: 'a clean travel packing surface with generic unbranded objects and no people',
    style: 'bright realistic lifestyle flat-lay photography',
    composition: 'wide 16:9 landscape, top-down flat lay, balanced negative space',
    lighting: 'soft daylight with a light summer feel',
    palette: 'sand beige, sky blue, canvas white, warm leather brown',
    textures: 'canvas, paper map without labels, glass lenses, woven fabric',
    tone: { light: '明るい夏の拡散光', colorTemp: '4500K前後の自然光', framing: '真上からのフラットレイ', texture: '帆布、無地の紙、ガラス、織物' },
    tags: ['Bロール', '旅行'],
    shots: [
      'a folded canvas bag with sunglasses and a blank paper map',
      'a compact unbranded camera pouch beside a woven strap and lens cloth',
      'a plain notebook, pen, and blank luggage tag arranged for travel',
      'rolled clothing and a small toiletry pouch inside an open suitcase corner',
      'a reusable water bottle, sun hat, and folded light scarf',
      'generic travel adapters and neatly coiled charging cables with no logos',
    ],
  },
  {
    slug: 'construction-site', title: '建設現場',
    description: 'ヘルメット、図面、足場、コンクリートを、乾いた昼光で統一した現場Bロールです。',
    scene: 'a clean active-looking construction environment with no workers or people',
    style: 'realistic industrial editorial photography',
    composition: 'wide 16:9 landscape, 28mm documentary framing, strong structural lines',
    lighting: 'hard but controlled midday light with defined shadows',
    palette: 'concrete grey, safety yellow, steel blue, dusty beige',
    textures: 'raw concrete, galvanized steel, plywood, matte plastic',
    tone: { light: '乾いた昼の直射光と明確な影', colorTemp: '4800K前後の中立光', framing: '28mmの広角で構造線を強調', texture: 'コンクリート、鋼材、合板、マットな樹脂' },
    tags: ['Bロール', '建設'],
    shots: [
      'a plain yellow hard hat resting on blank rolled plans over plywood',
      'repeating steel scaffolding against an unfinished concrete wall',
      'stacks of clean lumber and metal pipes arranged by size',
      'a close view of concrete texture with formwork lines and anchor holes',
      'an empty corridor inside an unfinished building with light at the far end',
      'generic safety cones and temporary barriers casting long geometric shadows',
    ],
  },
  {
    slug: 'medical-lab-empty', title: '無人の研究室',
    description: '顕微鏡、ガラス器具、ピペットを、清潔な白と青の光で統一した研究Bロールです。',
    scene: 'a clean generic research laboratory bench with no people and no patient material',
    style: 'realistic clinical editorial photography, precise and non-dramatic',
    composition: 'wide 16:9 landscape, eye-level or slightly elevated close view',
    lighting: 'bright cool diffuse laboratory light with soft blue accents',
    palette: 'clean white, pale blue, clear glass, brushed silver',
    textures: 'glassware, stainless steel, matte white bench, clear liquids',
    tone: { light: '明るい白色の拡散光と弱い青の補助光', colorTemp: '5200K前後の寒色', framing: '目線〜斜め上の清潔な実験台', texture: '透明ガラス、白い樹脂、ステンレス' },
    tags: ['Bロール', '研究'],
    shots: [
      'a generic microscope on a clean white bench with empty space around it',
      'clear unlabeled test tubes in a simple rack with soft blue reflections',
      'glass beakers containing clear and pale blue liquids with no labels',
      'a neat row of generic pipettes beside an empty transparent tray',
      'a closed petri dish and stainless tools on a sterile bench',
      'an empty laboratory aisle with repeating white workstations and glass cabinets',
    ],
  },
  {
    slug: 'renewable-energy', title: '再生可能エネルギー',
    description: '太陽光、風力、蓄電設備を、澄んだ青空と明るい昼光で統一した環境素材です。',
    scene: 'modern renewable energy infrastructure in a clean open landscape with no people',
    style: 'premium realistic environmental editorial photography',
    composition: 'wide 16:9 landscape, 28mm lens, strong horizon and spacious sky',
    lighting: 'clear bright daylight with crisp natural contrast',
    palette: 'sky blue, clean white, deep green, graphite grey',
    textures: 'solar glass, painted turbine metal, grass, gravel, clean utility enclosures',
    tone: { light: '澄んだ昼の自然光', colorTemp: '5000K前後の中立〜寒色', framing: '広い空と水平線を入れた28mm広角', texture: '太陽光ガラス、白い金属、草地、砂利' },
    tags: ['Bロール', '環境'],
    shots: [
      'rows of blue solar panels receding across a green field',
      'three white wind turbines standing across a low grassy ridge',
      'a close low-angle view along reflective solar panel edges',
      'a clean battery storage facility with plain unbranded enclosures',
      'wind turbine towers seen from below against a clear blue sky',
      'solar panels and distant wind turbines sharing one broad landscape',
    ],
  },
  {
    slug: 'city-transport', title: '都市交通',
    description: '駅、線路、バスレーン、自転車ラックを、早朝の青い都市光でそろえた素材です。',
    scene: 'a clean modern city transport environment at early morning with no people and no vehicles in motion',
    style: 'realistic cinematic urban editorial photography',
    composition: 'wide 16:9 landscape, eye-level 35mm lens, strong leading lines',
    lighting: 'cool early-morning ambient light with restrained warm practical lights',
    palette: 'steel grey, muted blue, concrete, soft amber accents',
    textures: 'concrete, steel rails, glass shelters, painted road surfaces',
    tone: { light: '早朝の青い環境光と弱い暖色灯', colorTemp: '4700K前後の寒色寄り', framing: '35mm目線。線路やレーンの導線', texture: 'コンクリート、レール、ガラス、路面塗装' },
    tags: ['Bロール', '交通'],
    shots: [
      'an empty metro platform with repeating columns and tracks',
      'parallel railway tracks converging toward a distant city station',
      'a clean empty bus lane with a generic glass shelter and no text',
      'a row of unbranded city bicycles parked in a simple rack',
      'a broad pedestrian crossing between quiet modern buildings',
      'an elevated rail structure casting geometric shadows over an empty road',
    ],
  },
  {
    slug: 'warehouse-aisle', title: '倉庫の通路',
    description: '棚、箱、パレット、コンベアを、白色灯の奥行きある構図で統一した物流Bロールです。',
    scene: 'a clean organized warehouse with generic unbranded boxes and no people',
    style: 'realistic industrial editorial photography',
    composition: 'wide 16:9 landscape, eye-level 28mm lens, deep symmetrical perspective',
    lighting: 'bright neutral warehouse lighting with controlled shadows',
    palette: 'kraft brown, steel grey, safety orange, concrete',
    textures: 'corrugated boxes, galvanized shelving, wood pallets, rubber conveyor belts',
    tone: { light: '天井の白色灯による均一な照明', colorTemp: '4800K前後の中立光', framing: '28mm目線。棚の反復と奥行き', texture: '段ボール、金属棚、木製パレット、ゴム' },
    tags: ['Bロール', '物流'],
    shots: [
      'a symmetrical aisle between tall shelves filled with plain boxes',
      'neatly stacked wooden pallets beside wrapped unbranded cartons',
      'an empty conveyor belt carrying several plain sealed parcels',
      'a parked generic forklift beside organized shelving with no driver',
      'a wide loading dock with closed doors and numbered areas omitted',
      'a close perspective along repeating box edges and metal shelf beams',
    ],
  },
];

function prompt(seed: Seed, shot: string): string {
  return `Use case: photorealistic-natural\n` +
    `Asset type: KAKERA stock B-roll for video editing and thumbnails\n` +
    `Primary request: ${shot}\n` +
    `Scene/backdrop: ${seed.scene}\n` +
    `Style/medium: ${seed.style}\n` +
    `Composition/framing: ${seed.composition}\n` +
    `Lighting/mood: ${seed.lighting}\n` +
    `Color palette: ${seed.palette}\n` +
    `Materials/textures: ${seed.textures}\n` +
    `Constraints: no people, no faces, no readable text, no logos, no brands, no watermark, no UI overlays, no recognizable trademarks`;
}

const promptArg = process.argv.indexOf('--prompts');
if (promptArg >= 0) {
  const slug = process.argv[promptArg + 1];
  const seed = SERIES.find((x) => x.slug === slug);
  if (!seed) throw new Error(`unknown slug: ${slug}`);
  console.log(JSON.stringify(seed.shots.map((shot) => prompt(seed, shot))));
  process.exit(0);
}

for (const seed of SERIES) {
  const dir = join('series', seed.slug);
  await mkdir(join(dir, 'pieces'), { recursive: true });
  const def = {
    slug: seed.slug,
    title: seed.title,
    description: seed.description,
    audience: ['editor', 'thumbnail'],
    creator: '@fuuuuuuma',
    license: 'kakera-free',
    tone: seed.tone,
    generator: { service: 'openai-imagegen', model: 'built-in-imagegen', version: '2026-09' },
    promptPublic: true,
    pieces: seed.shots.map((shot, i) => ({
      id: `${seed.slug}-${String(i + 1).padStart(2, '0')}`,
      kind: 'still',
      file: `pieces/${seed.slug}-${String(i + 1).padStart(2, '0')}.png`,
      alpha: false,
      useTags: seed.tags,
      prompt: prompt(seed, shot),
    })),
  };
  await writeFile(join(dir, 'series.json'), JSON.stringify(def, null, 2) + '\n');
}

console.log(`${SERIES.length} series definitions prepared`);
