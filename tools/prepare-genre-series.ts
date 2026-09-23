/**
 * 60シリーズから200シリーズへ拡張する、ジャンル軸140シリーズの単一ソース。
 * 各シリーズ: 背景のみ / 1人・左 / 1人・右 / 2人 / 3〜5人 / 手元・寄り。
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Cluster = 'business' | 'lifestyle' | 'health' | 'education' | 'food' | 'travel' | 'creator' | 'industry' | 'culture';
interface Seed { slug: string; title: string; cluster: Cluster; scene: string; activity: string; cast: string; tags: string[] }

const CLUSTERS: Record<Cluster, { label: string; style: string; lighting: string; palette: string; tone: { light: string; colorTemp: string; framing: string; texture: string } }> = {
  business: { label: 'ビジネス・仕事', style: 'photorealistic contemporary commercial editorial photography, credible workplace behavior, understated and natural', lighting: 'clean motivated daylight mixed with realistic workplace practical light', palette: 'navy, pale blue, warm wood, neutral skin tones', tone: { light: '清潔な昼光と職場の実用照明', colorTemp: '4400〜5000Kの中立光', framing: '16:9。背景、左右配置、2人、チーム、手元を網羅', texture: '肌、衣服、紙、木、ガラス、金属の自然な実写質感' } },
  lifestyle: { label: '家族・暮らし', style: 'photorealistic warm lifestyle editorial photography, candid, respectful and realistically lived-in', lighting: 'soft natural daylight or believable warm household practical light', palette: 'cream, sage, soft blue, warm wood, natural skin tones', tone: { light: '柔らかな自然光または家庭の暖色光', colorTemp: '3800〜4600Kの自然な暖色', framing: '16:9。生活背景、左右配置、家族、手元を網羅', texture: '肌、布、木、生活用品、植物の自然な実写質感' } },
  health: { label: '医療・健康・福祉', style: 'photorealistic respectful healthcare editorial photography, calm, credible and non-sensational', lighting: 'bright clean diffuse light with restrained pale-blue accents', palette: 'white, pale blue, warm grey, natural skin tones', tone: { light: '明るく清潔な拡散光', colorTemp: '4700〜5200Kの中立〜寒色', framing: '16:9。相談と支援の関係が伝わる6構図', texture: '肌、白衣、布、紙、ガラス、設備の清潔な実写質感' } },
  education: { label: '教育・子ども', style: 'photorealistic bright educational editorial photography, age-appropriate, safe and encouraging', lighting: 'soft bright daylight with gentle classroom or home practical light', palette: 'sky blue, warm yellow, cream, light wood, natural skin tones', tone: { light: '明るい昼光と柔らかな室内光', colorTemp: '4300〜5000Kの自然光', framing: '16:9。学習環境、個人、対話、集団、手元を網羅', texture: '紙、木、文具、教材、肌、衣服の明るい実写質感' } },
  food: { label: '食・店舗・接客', style: 'photorealistic appetizing food and service editorial photography, natural colors and believable actions', lighting: 'soft directional daylight or warm restaurant practical light', palette: 'fresh green, terracotta, cream, natural wood, natural skin tones', tone: { light: '食材と人物を自然に見せる柔らかな光', colorTemp: '4000〜4800Kの自然な暖色', framing: '16:9。店舗背景、客、スタッフ、グループ、料理の寄りを網羅', texture: '食材、陶器、木、金属、布、肌の触感が伝わる実写質感' } },
  travel: { label: '旅行・街・交通', style: 'photorealistic cinematic travel editorial photography, spontaneous but clean, with a strong sense of place', lighting: 'natural location light appropriate to the time and weather', palette: 'sky blue, stone grey, sand beige, muted warm accents, natural skin tones', tone: { light: '場所と時間帯に合う自然光', colorTemp: '4000〜5200Kの場所に応じた光', framing: '16:9。場所、左右配置、同行者、集団、旅道具を網羅', texture: '建築、路面、空、植物、乗り物、衣服の実在感' } },
  creator: { label: 'テクノロジー・制作', style: 'photorealistic modern creator and technology editorial photography, practical, precise and unbranded', lighting: 'balanced daylight with restrained cyan or warm equipment practical lights', palette: 'charcoal, muted cyan, warm amber, natural skin tones', tone: { light: '自然光と控えめな機材光', colorTemp: '4200〜5000Kの中立光', framing: '16:9。制作環境、単独、共同、チーム、操作の寄りを網羅', texture: '肌、機材、金属、樹脂、木、吸音材の実写質感' } },
  industry: { label: '産業・物流・環境', style: 'photorealistic industrial documentary editorial photography, safe, credible and visually organized', lighting: 'realistic daylight or industrial practical light with clear structural depth', palette: 'steel grey, safety yellow, kraft brown, muted blue, natural skin tones', tone: { light: '現場に即した昼光または実用照明', colorTemp: '4400〜5200Kの中立光', framing: '16:9。現場、担当者、共同作業、チーム、道具を網羅', texture: '金属、コンクリート、木、段ボール、土、作業着の実写質感' } },
  culture: { label: 'スポーツ・美容・行事', style: 'photorealistic energetic lifestyle and event editorial photography, inclusive and contemporary', lighting: 'clean natural or venue light with a clear emotional focus', palette: 'cream, cobalt, muted coral, warm neutral, natural skin tones', tone: { light: '活動内容に合う自然光または会場光', colorTemp: '4000〜5000Kの自然な範囲', framing: '16:9。場所、単独、ペア、グループ、ディテールを網羅', texture: '肌、衣服、道具、装飾、会場素材の自然な実写質感' } },
};

const ROWS = `
business-team-meeting||ビジネスチーム会議||business||a modern generic meeting room with a table and blank display||planning a project and exchanging practical ideas||fictional diverse adult office workers in understated business-casual clothing||会議,チーム,企画
client-presentation||顧客向けプレゼン||business||a clean generic client presentation room with a completely blank wall display||presenting a generic service proposal and listening to questions||fictional adult presenters and clients of varied genders and backgrounds||プレゼン,提案,商談
job-interview||採用面接||business||a neutral generic interview room with blank resumes||conducting a calm professional job interview||fictional adult job candidates and interviewers of varied ages and backgrounds||採用,面接,転職
office-brainstorming||オフィスのアイデア会議||business||a bright project room with movable blank boards and generic laptops||generating and organizing original project ideas||fictional diverse adult project members in casual professional clothing||企画,アイデア,チーム
one-on-one-meeting||1on1ミーティング||business||a quiet small office meeting space with a round table and blank notebook||holding a respectful one-on-one workplace conversation||fictional adult colleagues with varied genders and ages||面談,1on1,相談
remote-hybrid-work||ハイブリッドワーク||business||connected home-office and generic meeting-room environments with unreadable screens||working between remote and in-person settings||fictional adult workers of varied backgrounds using generic devices||在宅勤務,オンライン,働き方
startup-workspace||スタートアップの仕事場||business||a modest bright startup workspace with flexible desks||building and discussing an early-stage business||fictional diverse adult startup members in plain modern casual clothing||起業,スタートアップ,チーム
corporate-training||社内研修||business||a generic bright training room with blank presentation materials||learning practical workplace skills in a training session||fictional adult instructors and employees of varied ages||研修,人材育成,学習
customer-support-office||カスタマーサポート||business||a calm generic support office with abstract unreadable monitors||listening to inquiries and resolving customer issues||fictional diverse adult support agents wearing plain generic headsets||サポート,問い合わせ,オフィス
sales-negotiation||営業商談||business||a contemporary generic meeting room with blank proposal documents||discussing terms and finding a practical agreement||fictional adult sales professionals and clients||営業,交渉,商談
small-business-planning||小規模事業の計画||business||a small unbranded shop workspace with plain products||planning inventory, service and daily operations||fictional adult small-business owners and staff||経営,個人店,計画
accounting-budget-review||予算と会計の確認||business||a tidy finance workspace with blank charts and generic calculator||reviewing a fictional budget and organizing expenses||fictional adult finance workers and clients||会計,予算,家計
human-resources-onboarding||入社オンボーディング||business||a welcoming generic office orientation space with blank starter materials||introducing a new employee to the workplace||fictional adult new hires and human-resources staff||入社,人事,オンボーディング
leadership-strategy||リーダーシップ会議||business||a restrained modern strategy room with blank display and long table||making a considered organizational decision||fictional adult leaders of varied genders and backgrounds||経営,戦略,リーダー
coworking-networking||コワーキング交流||business||a bright generic coworking lounge with shared tables||meeting peers and exchanging professional ideas||fictional diverse adult freelancers and workers||コワーキング,交流,フリーランス
business-phone-call||仕事の電話||business||a realistic generic office and quiet corridor||handling an important but routine business call||fictional adult professionals of varied ages||電話,連絡,仕事
office-break-room||オフィスの休憩||business||a clean generic office break area with plain cups||taking a healthy short break and talking with colleagues||fictional diverse adult coworkers||休憩,同僚,オフィス
contract-review||契約書の確認||business||a quiet consultation table with completely blank legal-style documents||reviewing an agreement carefully before a decision||fictional adult professionals and clients||契約,書類,相談
project-deadline||締切前のプロジェクト||business||a realistic evening project workspace with generic devices||working steadily toward a near project deadline||fictional adult project members with natural restrained expressions||締切,集中,仕事
business-achievement||仕事の達成||business||a bright generic workplace after a completed project||celebrating a professional milestone naturally||fictional diverse adult coworkers||成功,達成,チーム
family-living-room||家族のリビング||lifestyle||a bright realistic Japanese-context living room||spending ordinary relaxed time together at home||a fictional multigenerational family with adults, school-age children and healthy seniors||家族,リビング,日常
family-dining||家族の食卓||lifestyle||a warm home dining area with plain tableware||sharing an everyday family meal||a fictional family with adults and school-age children||家族,食卓,団らん
parenting-homework||親子の宿題||lifestyle||a safe bright home study corner with blank worksheets||a parent supporting age-appropriate homework||a fictional adult parent and elementary-school child around ten years old||親子,宿題,教育
newborn-family-care||赤ちゃんとの暮らし||lifestyle||a soft safe home nursery and living space||caring for a fully clothed infant using safe supported holds||fictional adult parents and a fully clothed infant||赤ちゃん,育児,家族
multigenerational-family||多世代の家族||lifestyle||a comfortable bright family home with a blank photo album||sharing stories and supporting one another across generations||a fictional family including seniors, adults and school-age children||多世代,家族,シニア
couple-household-planning||二人の暮らしの計画||lifestyle||a calm home dining table with blank planning sheets||planning household goals, travel or a future move||a fictional adult couple with respectful natural interaction||カップル,家計,計画
moving-new-home||新居への引っ越し||lifestyle||a bright empty apartment with plain cardboard boxes||moving into and organizing a new home safely||fictional adult couples, roommates and family members||引っ越し,新生活,住宅
home-cleaning-family||家族の掃除||lifestyle||a realistic bright home with generic cleaning tools||cleaning and organizing the home together safely||fictional adults and older school-age family members||掃除,家事,家族
laundry-daily-life||日常の洗濯||lifestyle||a clean home laundry corner with generic appliances||sorting, washing, drying and folding laundry||fictional adults and family members of varied ages||洗濯,家事,日常
morning-family-routine||家族の朝支度||lifestyle||a bright home bedroom, hallway and entry area||getting ready calmly for school and work||a fictional family with adults and school-age children||朝,家族,支度
evening-family-routine||家族の夜時間||lifestyle||a warm uncluttered home living space in the evening||winding down with quiet household routines||a fictional family with adults, children and optionally a senior||夜,家族,暮らし
home-relaxation||自宅での休息||lifestyle||a calm lived-in living room with soft textiles||resting, reading or listening quietly at home||fictional adults of varied ages and backgrounds||休息,自宅,リラックス
senior-home-life||シニアの暮らし||lifestyle||a comfortable accessible home with generic devices and plants||enjoying independent daily life and family connection||fictional healthy senior adults of varied genders||シニア,暮らし,家族
pet-family-life||ペットと暮らす家族||lifestyle||a bright safe home and nearby walking path||living responsibly with a healthy generic dog or cat||fictional adult pet owners and families||ペット,家族,生活
grocery-shopping-family||家族の買い物||lifestyle||a clean generic grocery store with blank shelf labels||choosing everyday groceries thoughtfully||fictional adults, seniors and families||買い物,家族,食品
home-garden||家庭の庭仕事||lifestyle||a small home garden or balcony with generic tools||planting, watering and caring for a home garden||fictional adults, seniors and older children||園芸,庭,家族
rainy-day-family||雨の日の家族||lifestyle||a warm home beside rain-streaked windows||spending a calm rainy day indoors and preparing to go outside||a fictional family with adults and school-age children||雨,家族,日常
family-celebration||家族のお祝い||lifestyle||a warm home celebration with plain decorations||celebrating a birthday, achievement or reunion||a fictional multigenerational family||家族,お祝い,記念日
solo-living-apartment||一人暮らし||lifestyle||a compact realistic apartment with generic furniture||managing ordinary independent daily life||fictional adults of varied genders and backgrounds living alone||一人暮らし,住宅,日常
shared-house-life||シェアハウスの暮らし||lifestyle||a bright shared home kitchen and lounge||sharing space, chores and conversation respectfully||fictional diverse adult roommates||シェアハウス,友人,暮らし
clinic-consultation||クリニックでの相談||health||a clean generic consultation room with no patient identifiers||discussing a routine health concern calmly||fictional adult patients, supporters and healthcare professionals||医療,診察,相談
hospital-teamwork||病院のチームワーク||health||a clean generic hospital corridor and team station||coordinating safe routine care as a healthcare team||fictional diverse adult healthcare professionals||病院,医療チーム,仕事
pharmacy-counseling||薬局での相談||health||a bright generic pharmacy counter with plain containers||providing general medication guidance without specific claims||fictional adult pharmacists and customers||薬局,相談,健康
dental-checkup||歯科の検診||health||a clean generic dental treatment room||performing a calm routine dental checkup without invasive close-ups||fictional adult patients and dental professionals||歯科,検診,医療
physical-therapy||理学療法||health||a bright generic rehabilitation room with simple support equipment||practicing safe mobility and recovery exercises||fictional adult and senior participants with therapists||リハビリ,運動,支援
eldercare-facility||介護施設の暮らし||health||a bright accessible generic care-facility lounge||supporting respectful independent daily activity||fictional healthy senior residents and adult care workers||介護,シニア,福祉
home-care-visit||訪問介護||health||a safe accessible home living space||providing respectful non-emergency home-care support||fictional care recipients, family and adult care workers||訪問介護,在宅,支援
mental-wellness-counseling||心の健康相談||health||a quiet welcoming generic counseling room||having a calm supportive conversation about wellbeing||fictional adults and counselors, no crisis depiction||メンタルヘルス,相談,支援
health-checkup||健康診断||health||a clean generic health-check area with blank forms||completing routine non-invasive health measurements||fictional adults and healthcare staff||健康診断,予防,検査
laboratory-team||研究・検査チーム||health||a clean generic laboratory with unlabeled glassware||conducting safe general research and checking observations||fictional diverse adult laboratory professionals||研究,検査,チーム
nursing-care||看護の現場||health||a clean generic care room and nurse station||providing respectful routine nursing support||fictional adult nurses and adult patients||看護,医療,支援
healthy-sleep||睡眠と健康||health||a serene generic bedroom with plain bedding||following a calm healthy bedtime routine||fictional adults and couples in modest sleepwear||睡眠,健康,夜
nutrition-counseling||栄養相談||health||a bright nutrition consultation space with fresh foods and blank charts||discussing balanced everyday eating||fictional adult clients and nutrition professionals||栄養,食事,相談
telemedicine-call||オンライン診療||health||connected home and generic clinic environments with unreadable screens||holding a routine remote healthcare consultation||fictional patients, supporters and healthcare professionals||オンライン診療,医療,通話
emergency-preparedness-health||医療の備え||health||a calm preparedness room with plain first-aid supplies||organizing non-emergency first-aid readiness||fictional healthcare workers and community volunteers||救護,備え,地域
elementary-classroom||小学校の教室||education||a bright generic elementary classroom with a blank board||learning and asking questions in an age-appropriate lesson||fictional elementary-school children and an adult teacher||小学校,授業,子ども
high-school-classroom||高校の授業||education||a modern generic high-school classroom||participating in a focused class discussion||fictional teenagers and adult teachers||高校,授業,学生
university-lecture||大学の講義||education||a generic university lecture room with a blank screen||listening, taking notes and discussing an academic topic||fictional adult university students and lecturers||大学,講義,学生
online-learning-family||家庭のオンライン学習||education||a quiet home study area with generic devices||learning online and taking notes at home||fictional adult learners, parents and school children||オンライン学習,家庭,教育
exam-preparation||試験勉強||education||a calm library-like and home study environment||preparing steadily for an exam or qualification||fictional teenagers, students and adult learners||試験,勉強,資格
group-study||グループ学習||education||a bright generic study room with blank notes||solving a learning task collaboratively||fictional diverse teenage or adult students||グループ学習,学生,協働
teacher-one-on-one||教師との個別相談||education||a quiet generic classroom corner||discussing learning progress supportively||fictional students, adult teachers and optional parents||教師,相談,学習
school-club-activity||学校の部活動||education||a safe generic school activity room and practice area||practicing a non-contact school club activity||fictional teenagers and adult supervisors||部活動,学校,チーム
childcare-daycare||保育園の一日||education||a bright safe generic childcare room with plain toys||playing, reading and tidying under supervision||fictional preschool-age children and adult childcare workers||保育,子ども,遊び
science-experiment-school||学校の科学実験||education||a clean generic school science room||performing a safe classroom observation||fictional teenage students and an adult teacher||科学,実験,学校
art-class||美術の授業||education||a bright generic art classroom with blank paper||creating original art without copying known work||fictional children, teenagers or adult learners||美術,制作,授業
music-lesson||音楽のレッスン||education||a generic music practice room with unbranded instruments||practicing simple original music||fictional students and adult music teachers||音楽,レッスン,楽器
language-learning||語学学習||education||a bright generic language classroom with blank cards||practicing everyday conversation||fictional diverse teenage and adult learners||語学,会話,学習
graduation-day||卒業の日||education||a generic bright graduation venue with plain decorations||celebrating completion of an educational stage||fictional graduates, families and teachers||卒業,お祝い,教育
library-study-people||図書館で学ぶ人々||education||a quiet generic library with unmarked books||reading, researching and studying quietly||fictional students, adults and seniors||図書館,読書,学習
home-cooking-family||家庭料理||food||a bright safe home kitchen with fresh ingredients||preparing an everyday balanced meal together||fictional adults and older school-age family members||料理,家族,キッチン
restaurant-dining||レストランの食事||food||a tasteful generic casual restaurant||enjoying a meal and natural conversation||fictional adult diners and service staff||レストラン,食事,外食
cafe-customers||カフェの客||food||a quiet independent-style generic cafe||drinking coffee, working or talking calmly||fictional adult customers and staff||カフェ,会話,飲み物
bakery-workday||パン屋の一日||food||a warm generic bakery with original breads||baking, arranging and selling fresh bread||fictional adult bakery workers and customers||パン屋,店舗,仕事
chef-kitchen-team||厨房の料理チーム||food||a clean professional generic kitchen||preparing and plating food safely||fictional diverse adult chefs||料理人,厨房,チーム
grocery-store-shopping||スーパーの買い物||food||a clean generic grocery store||choosing fresh and pantry food thoughtfully||fictional adults, seniors and families||スーパー,買い物,食品
convenience-store-scene||コンビニの利用||food||a clean generic small convenience-style store||purchasing ordinary unbranded items||fictional adult customers and retail staff||コンビニ,小売,接客
food-delivery-service||フードデリバリー||food||generic restaurant pickup and residential entrance settings||preparing, carrying and handing over food safely||fictional couriers, restaurant workers and customers||配達,食品,サービス
farmers-market||朝市とマルシェ||food||an outdoor generic farmers market with plain stalls||selling and choosing fresh local produce||fictional adult growers, families and customers||市場,野菜,買い物
meal-prep-week||作り置き料理||food||a clean home kitchen with reusable containers||preparing simple meals for coming days||fictional adults and family members||作り置き,料理,時短
breakfast-routine-people||朝食の時間||food||a bright home or cafe breakfast setting||starting the day with a simple breakfast||fictional adults, couples and families||朝食,朝,食事
lunch-break-office||職場の昼休み||food||a generic office break area and outdoor seating||taking a balanced lunch break||fictional diverse adult office workers||昼食,休憩,仕事
dinner-friends||友人との夕食||food||a warm home dining room with shared dishes||sharing dinner and conversation with friends||fictional diverse adult friend groups||夕食,友人,食事
cooking-class||料理教室||food||a bright generic teaching kitchen||learning safe everyday cooking techniques||fictional adult learners and an instructor||料理教室,学習,食事
coffee-making-cafe||カフェのコーヒー作り||food||a warm generic cafe counter||preparing and serving coffee carefully||fictional adult cafe staff and customers||コーヒー,カフェ,接客
airport-departure||空港の出発||travel||a bright generic airport departure concourse||checking luggage and beginning a trip||fictional adult travelers, families and friends||空港,旅行,出発
train-commute-people||電車通勤||travel||a generic modern station platform and train interior||commuting calmly during a weekday||fictional diverse adult commuters||電車,通勤,交通
bus-stop-people||バス停の人々||travel||a generic urban and suburban bus stop||waiting for public transport calmly||fictional adults, seniors and families||バス,待つ,交通
hotel-checkin||ホテルのチェックイン||travel||a tasteful generic hotel lobby and reception desk||arriving and completing check-in||fictional travelers, families and hotel staff||ホテル,旅行,接客
city-tourists||街を巡る旅行者||travel||a generic walkable city district||exploring streets and finding a destination||fictional diverse adult travelers||観光,街,旅行
beach-vacation-family||海辺の家族旅行||travel||a clean quiet generic beach||enjoying a safe family day by the sea||a fictional family in modest beach clothing||海,家族,旅行
mountain-hiking-group||山歩き||travel||a safe generic mountain trail||hiking together with practical preparation||fictional adults of varied ages||山,ハイキング,旅行
camping-weekend||週末キャンプ||travel||a clean generic campsite with plain tents||setting up and cooking safely||fictional diverse adult friends and families||キャンプ,休日,友人
road-trip-friends||友人とのドライブ旅行||travel||a generic scenic roadside stop with an unbranded vehicle||taking a safe road trip||fictional diverse adult friends||ドライブ,友人,旅行
business-trip||出張||travel||generic terminals, hotel room and meeting destination||traveling for work||fictional adult professionals with plain luggage||出張,仕事,移動
station-arrival||駅への到着||travel||a generic bright railway station concourse||arriving and finding companions||fictional adults, families and friends||駅,到着,旅行
rainy-city-commute||雨の街の通勤||travel||a generic city street and station entrance in rain||commuting safely in wet weather||fictional adults and seniors with plain umbrellas||雨,通勤,街
cycling-city||街の自転車移動||travel||a safe generic urban cycling path||cycling responsibly for transport||fictional adults with correctly fitted helmets||自転車,街,移動
accessible-travel||誰もが楽しめる旅行||travel||a generic accessible terminal and destination||traveling independently with respectful support||fictional adult travelers including wheelchair users||旅行,バリアフリー,移動
local-neighborhood-walk||近所を歩く人々||travel||a quiet generic neighborhood||walking and running everyday errands||fictional adults, seniors and families||街歩き,日常,地域
video-editing-team||動画編集チーム||creator||a realistic generic editing room with abstract monitors||editing, reviewing and finishing a video||fictional diverse adult editors and producers||動画編集,制作,チーム
creator-home-studio||クリエイターの自宅スタジオ||creator||a modest bright home creator studio||planning and recording original content||fictional adult creators of varied backgrounds||クリエイター,撮影,自宅
podcast-recording||ポッドキャスト収録||creator||a generic acoustic recording room||recording an original conversational podcast||fictional diverse adult hosts and guests||ポッドキャスト,音声,対談
livestream-production||ライブ配信の制作||creator||a generic small livestream studio||producing a live online program||fictional adult presenters and crew||ライブ配信,制作,スタジオ
smartphone-content-creation||スマホでのコンテンツ制作||creator||ordinary home, cafe and outdoor settings||filming short original content on a phone||fictional adult creators of varied ages||スマホ,撮影,SNS
photography-shoot||写真撮影の現場||creator||a generic studio and simple location setup||composing and photographing an original subject||fictional photographers, assistants and fictional models||写真,撮影,カメラ
design-studio-team||デザイン制作チーム||creator||a bright generic design studio||creating and reviewing an original visual concept||fictional diverse adult designers||デザイン,制作,チーム
software-development-team||ソフトウェア開発チーム||creator||a modern generic development workspace||building and reviewing a software project||fictional diverse adult software workers||開発,IT,チーム
cybersecurity-operations||セキュリティ運用||creator||a generic security operations workspace||monitoring a routine digital-security issue||fictional adult cybersecurity professionals||セキュリティ,IT,監視
ai-workshop||AI活用ワークショップ||creator||a bright generic workshop room||learning responsible uses of artificial intelligence||fictional adult instructors and participants||AI,研修,テクノロジー
ecommerce-product-shoot||EC商品の撮影||creator||a clean generic tabletop product studio||styling and photographing a fictional product||fictional small-business and production staff||EC,商品撮影,制作
music-production-studio||音楽制作スタジオ||creator||a generic music-production room||creating original instrumental music||fictional composers, performers and engineers||音楽制作,スタジオ,チーム
video-call-team||チームのビデオ会議||creator||connected home and office workspaces||holding a productive remote team conversation||fictional diverse adult professionals||ビデオ会議,オンライン,チーム
social-media-planning||SNS企画||creator||a bright generic content-planning workspace||planning an original content calendar||fictional adult content planners and creators||SNS,企画,制作
online-course-recording||オンライン講座の収録||creator||a generic small educational recording studio||recording an original practical online lesson||fictional instructors, learners and production staff||オンライン講座,収録,教育
warehouse-logistics-team||倉庫の物流チーム||industry||a bright organized generic warehouse||checking and organizing inventory safely||fictional diverse adult warehouse workers||倉庫,物流,チーム
delivery-last-mile||街の配送||industry||generic residential entrances and an unbranded vehicle||sorting and delivering plain parcels safely||fictional adult couriers and recipients||配送,物流,宅配
construction-project-people||建設プロジェクト||industry||a safe controlled generic construction site||reviewing plans and inspecting work safely||fictional diverse adult construction professionals||建設,現場,チーム
factory-production-line||工場の生産ライン||industry||a clean generic light-manufacturing facility||monitoring a production process safely||fictional adult factory workers||工場,製造,仕事
quality-inspection||品質検査||industry||a clean generic inspection workspace||checking product quality||fictional adult quality workers||品質,検査,製造
maintenance-engineer-team||設備保守チーム||industry||a safe generic industrial facility||maintaining equipment safely||fictional diverse adult maintenance engineers||保守,技術者,点検
agriculture-harvest-team||農作物の収穫||industry||a healthy generic working field||harvesting and sorting produce||fictional adult farm workers||農業,収穫,仕事
greenhouse-work||温室の仕事||industry||a bright generic greenhouse||planting and checking crops||fictional adult growers and technicians||温室,農業,植物
renewable-energy-workers||再生可能エネルギーの現場||industry||generic solar and wind energy facilities||inspecting equipment safely||fictional diverse adult energy workers||再生可能エネルギー,環境,技術
recycling-facility-team||リサイクル施設||industry||a clean organized generic recycling facility||sorting reusable materials||fictional adult facility workers||リサイクル,環境,施設
research-development-team||研究開発チーム||industry||a clean generic research-and-development workspace||testing an original generic prototype||fictional diverse adult researchers and engineers||研究開発,技術,チーム
vehicle-repair-workshop||自動車整備工場||industry||a clean generic repair workshop||repairing an unbranded vehicle safely||fictional adult mechanics||整備,車,工具
cleaning-service-team||清掃サービス||industry||a generic office and public interior||cleaning a shared space safely||fictional diverse adult cleaning staff||清掃,サービス,仕事
security-staff-work||施設警備||industry||a generic building entrance and control desk||monitoring routine facility safety||fictional adult security staff in non-police uniforms||警備,施設,仕事
disaster-preparedness-community||地域の防災準備||industry||a calm generic community room with plain emergency supplies||organizing preparedness supplies||fictional adults, seniors, families and volunteers||防災,地域,備え
fitness-gym-people||ジムで運動する人々||culture||a bright generic fitness studio||performing safe strength and mobility exercises||fictional adults of varied ages and body types||ジム,運動,健康
running-community||ランニング仲間||culture||a safe generic park running path||running, warming up and recovering together||fictional adults of varied ages and body types||ランニング,仲間,運動
yoga-class||ヨガクラス||culture||a calm bright generic movement studio||practicing safe gentle stretching and breathing||fictional adults of varied ages and body types||ヨガ,ストレッチ,クラス
youth-sports-practice||子どものスポーツ練習||culture||a safe generic school sports field or gym||practicing a non-contact sports drill||fictional school-age children and adult coaches||子ども,スポーツ,練習
beauty-salon-customers||美容室の客とスタッフ||culture||a clean generic hair salon||consulting and styling an original hairstyle||fictional adult customers and hairstylists||美容室,接客,美容
skincare-consultation||スキンケア相談||culture||a bright generic beauty consultation space||discussing everyday skincare without medical claims||fictional adult clients and beauty staff||美容,スキンケア,相談
wedding-guests||結婚式の人々||culture||a simple original modern ceremony space||celebrating a fictional adult couple respectfully||a fictional adult couple and diverse adult guests||結婚式,カップル,お祝い
community-festival-generic||地域の催し||culture||a generic neighborhood outdoor gathering||enjoying a small community event||fictional adults, seniors and families||地域,イベント,交流
craft-workshop-people||手作りワークショップ||culture||a bright generic craft workshop||creating original handmade objects||fictional adults, seniors and older children||工作,ワークショップ,趣味
public-speaking-event||登壇イベント||culture||a generic modern event room with a blank stage screen||giving an original practical talk||fictional adult speakers and audience members||登壇,イベント,講演
`;

const SHOTS = [
  { tag: '背景のみ', instruction: (s: Seed) => `A wide establishing background of ${s.scene}. Exactly zero people. Generic props clearly suggest ${s.activity}, with generous clean negative space.` },
  { tag: '1人・左配置', instruction: (s: Seed) => `Exactly one newly invented fictional person alone from this cast: ${s.cast}. Show that single person preparing for, pausing during, or reflecting after ${s.activity}, positioned on the left third, with clean Japanese-caption space on the right, in a plausible variation of ${s.scene}. No other people, partial bodies, background figures, portraits or human images anywhere.` },
  { tag: '1人・右配置', instruction: (s: Seed) => `Exactly one different newly invented fictional person alone from this cast: ${s.cast}. Show that single person preparing for, pausing during, or reflecting after ${s.activity}, positioned on the right third, with clean Japanese-caption space on the left, in another variation of ${s.scene}. No other people, partial bodies, background figures, portraits or human images anywhere.` },
  { tag: '2人', instruction: (s: Seed) => `Exactly two newly invented fictional people from this cast: ${s.cast}. Show a credible interaction while ${s.activity}, with separated bodies and natural eye lines in ${s.scene}.` },
  { tag: '3〜5人', instruction: (s: Seed) => `Exactly three to five newly invented fictional people from this cast: ${s.cast}. Each person does a believable part of ${s.activity}, in a wide environmental view of ${s.scene}.` },
  { tag: '手元・寄り', instruction: (s: Seed) => `A close editorial detail of anatomically correct hands and a relevant unbranded tool, material or object involved in ${s.activity}, with physically plausible contact in ${s.scene}. Avoid a full face.` },
] as const;

const ORIGINALITY = 'Create a fully original composition from generic concepts only. Do not imitate, reproduce, trace, or closely reference any existing stock asset, photo, video frame, illustration, artist, illustrator, website, social-media post, thumbnail, brand campaign, mascot, copyrighted character, or named visual style.';
const SAFETY = 'Every person must be newly invented and fictional, with no resemblance to any identifiable real individual. Use respectful, non-stereotyped representation. Faces, hands, fingers, limbs and joints must be anatomically natural; no duplicated limbs or merged bodies. Children must be fully clothed, age-appropriate and safe.';
const RIGHTS = 'No readable text, letters, numbers, signatures, labels, logos, brands, watermarks, flags, trademarks, characters, recognizable user interfaces, QR codes, license plates, addresses, patient information or personal data.';

const SERIES: Seed[] = ROWS.trim().split('\n').map((line, index) => {
  const fields = line.split('||');
  if (fields.length !== 7) throw new Error(`row ${index + 1}: expected 7 fields, got ${fields.length}`);
  const [slug, title, clusterRaw, scene, activity, cast, tags] = fields as [string, string, string, string, string, string, string];
  const cluster = clusterRaw as Cluster;
  if (!(cluster in CLUSTERS)) throw new Error(`unknown cluster: ${clusterRaw}`);
  return { slug, title, cluster, scene, activity, cast, tags: tags.split(',') };
});

function prompt(seed: Seed, shot: typeof SHOTS[number]): string {
  const c = CLUSTERS[seed.cluster];
  return [
    'Use case: photorealistic-natural.',
    `Asset type: original KAKERA ${c.label} stock image set for professional video editing and thumbnails.`,
    `Primary request: ${shot.instruction(seed)}`,
    `Style: ${c.style}.`,
    'Composition: wide 16:9 landscape, 35mm or 50mm editorial framing, intentional Japanese-caption-safe negative space.',
    `Lighting: ${c.lighting}.`,
    `Palette: ${c.palette}.`,
    'Output: opaque high-resolution PNG source, no transparent background and no cutout-on-empty-canvas look.',
    `Originality and rights: ${ORIGINALITY}`,
    `People safety: ${SAFETY}`,
    `Rights constraints: ${RIGHTS}`,
  ].join('\n');
}

function definition(seed: Seed) {
  const c = CLUSTERS[seed.cluster];
  return {
    slug: seed.slug,
    title: seed.title,
    description: `${seed.title}について、背景のみ、1人の左右配置、2人、3〜5人、手元・寄りをそろえた動画編集用素材です。`,
    audience: ['editor', 'thumbnail'], creator: '@fuuuuuuma', license: 'kakera-free', tone: c.tone,
    generator: { service: 'openai-imagegen', model: 'built-in-imagegen', version: '2026-09' }, promptPublic: true,
    pieces: SHOTS.map((shot, i) => {
      const id = `${seed.slug}-${String(i + 1).padStart(2, '0')}`;
      return { id, kind: 'still', file: `pieces/${id}.png`, alpha: false, forThumbnail: true, useTags: [...new Set([c.label, ...seed.tags, shot.tag])], prompt: prompt(seed, shot) };
    }),
  };
}

function validate(): void {
  if (SERIES.length !== 140) throw new Error(`expected 140 series, got ${SERIES.length}`);
  if (new Set(SERIES.map((s) => s.slug)).size !== 140) throw new Error('duplicate slug');
  if (new Set(SERIES.map((s) => s.title)).size !== 140) throw new Error('duplicate title');
  const expected: Record<Cluster, number> = { business: 20, lifestyle: 20, health: 15, education: 15, food: 15, travel: 15, creator: 15, industry: 15, culture: 10 };
  for (const [cluster, count] of Object.entries(expected)) {
    const actual = SERIES.filter((s) => s.cluster === cluster).length;
    if (actual !== count) throw new Error(`${cluster}: expected ${count}, got ${actual}`);
  }
  const prompts = SERIES.flatMap((s) => SHOTS.map((shot) => prompt(s, shot)));
  if (new Set(prompts).size !== 840) throw new Error('duplicate prompt');
}

async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
async function writeDefinitions(): Promise<void> {
  const refresh = process.argv.includes('--refresh');
  for (const seed of SERIES) {
    const dir = join('series', seed.slug);
    const path = join(dir, 'series.json');
    const content = JSON.stringify(definition(seed), null, 2) + '\n';
    if (await exists(path)) {
      if (await readFile(path, 'utf8') !== content) {
        if (!refresh) throw new Error(`refusing to overwrite ${path}; rerun with --refresh for an intentional definition sync`);
        await writeFile(path, content);
      }
      continue;
    }
    await mkdir(join(dir, 'pieces'), { recursive: true });
    await writeFile(path, content, { flag: 'wx' });
  }
}

validate();
const promptIndex = process.argv.indexOf('--prompts');
if (promptIndex >= 0) {
  const seed = SERIES.find((s) => s.slug === process.argv[promptIndex + 1]);
  if (!seed) throw new Error('unknown slug');
  console.log(JSON.stringify(SHOTS.map((shot) => prompt(seed, shot))));
  process.exit(0);
}
if (process.argv.includes('--stats')) {
  console.log(JSON.stringify({ series: SERIES.length, pieces: 840, composition: SHOTS.map((s) => s.tag), stats: Object.fromEntries(Object.keys(CLUSTERS).map((c) => [c, SERIES.filter((s) => s.cluster === c).length])) }, null, 2));
  process.exit(0);
}
if (process.argv.includes('--slugs')) { console.log(JSON.stringify(SERIES.map((s) => s.slug))); process.exit(0); }
await writeDefinitions();
console.log('140 genre-based series definitions and 840 prompts prepared');
