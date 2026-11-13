// 同梱フォントの一覧（下の FONTS）から、次の2つを作り直す開発用スクリプト。
//   src/fonts.ts      … @fontsource の CSS の読み込み（日本語・英数字のサブセット）
//   src/fontList.ts   … アプリの中で選べるフォントの一覧
// フォントを足したいときは、npm install @fontsource/◯◯ のあと FONTS に1行足して `node tools/gen-fonts.mjs` を実行する。
// フォント選択画面の見本（public/font-previews）は `python3 tools/gen-font-previews.py` で作る。
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// [パッケージ名, font-family, 日本語の説明, 分類, かな・英数だけ（漢字なし）か]
const FONTS = [
  ['noto-sans-jp', 'Noto Sans JP', 'ゴシック（標準）', 'gothic'],
  ['zen-kaku-gothic-new', 'Zen Kaku Gothic New', 'すっきりしたゴシック', 'gothic'],
  ['zen-kaku-gothic-antique', 'Zen Kaku Gothic Antique', '昔ふうのゴシック', 'gothic'],
  ['biz-udpgothic', 'BIZ UDPGothic', '読みやすいUDゴシック', 'gothic'],
  ['biz-udgothic', 'BIZ UDGothic', 'UDゴシック（等幅）', 'gothic'],
  ['line-seed-jp', 'LINE Seed JP', 'LINEのゴシック', 'gothic'],
  ['ibm-plex-sans-jp', 'IBM Plex Sans JP', 'かっちりしたゴシック', 'gothic'],
  ['m-plus-1p', 'M PLUS 1p', 'M+ ゴシック', 'gothic'],
  ['m-plus-1', 'M PLUS 1', 'M+ 1', 'gothic'],
  ['m-plus-2', 'M PLUS 2', 'M+ 2', 'gothic'],
  ['murecho', 'Murecho', 'やわらかいゴシック', 'gothic'],
  ['sawarabi-gothic', 'Sawarabi Gothic', 'さわらびゴシック', 'gothic'],
  ['kosugi', 'Kosugi', '小杉ゴシック', 'gothic'],
  ['m-plus-1-code', 'M PLUS 1 Code', 'プログラム向け等幅', 'gothic'],

  ['m-plus-rounded-1c', 'M PLUS Rounded 1c', '丸ゴシック', 'round'],
  ['zen-maru-gothic', 'Zen Maru Gothic', 'やわらか丸ゴシック', 'round'],
  ['kosugi-maru', 'Kosugi Maru', '小杉丸ゴシック', 'round'],
  ['kiwi-maru', 'Kiwi Maru', 'キウイ丸（やさしい）', 'round'],
  ['tsukimi-rounded', 'Tsukimi Rounded', '月見丸', 'round', true],

  ['noto-serif-jp', 'Noto Serif JP', '明朝（標準）', 'mincho'],
  ['shippori-mincho', 'Shippori Mincho', 'しっぽり明朝', 'mincho'],
  ['shippori-mincho-b1', 'Shippori Mincho B1', 'しっぽり明朝（にじみ）', 'mincho'],
  ['zen-old-mincho', 'Zen Old Mincho', 'オールド明朝', 'mincho'],
  ['biz-udpmincho', 'BIZ UDPMincho', '読みやすいUD明朝', 'mincho'],
  ['biz-udmincho', 'BIZ UDMincho', 'UD明朝（等幅）', 'mincho'],
  ['sawarabi-mincho', 'Sawarabi Mincho', 'さわらび明朝', 'mincho'],
  ['hina-mincho', 'Hina Mincho', 'ひな明朝（上品）', 'mincho'],
  ['kaisei-opti', 'Kaisei Opti', '解星オプティ', 'mincho'],
  ['kaisei-tokumin', 'Kaisei Tokumin', '解星 特ミン（太め）', 'mincho'],
  ['kaisei-harunoumi', 'Kaisei HarunoUmi', '解星 春の海', 'mincho'],
  ['kaisei-decol', 'Kaisei Decol', '解星デコール（おしゃれ）', 'mincho'],
  ['zen-antique', 'Zen Antique', 'アンチック（漫画のセリフ風）', 'mincho'],
  ['zen-antique-soft', 'Zen Antique Soft', 'アンチック（やわらか）', 'mincho'],
  ['shippori-antique', 'Shippori Antique', 'しっぽりアンチック', 'mincho'],
  ['shippori-antique-b1', 'Shippori Antique B1', 'しっぽりアンチック（にじみ）', 'mincho'],

  ['yusei-magic', 'Yusei Magic', 'マジックで書いた字', 'hand'],
  ['zen-kurenaido', 'Zen Kurenaido', 'ペン字風', 'hand'],
  ['klee-one', 'Klee One', 'クレー（教科書の手書き風）', 'hand'],
  ['yomogi', 'Yomogi', 'よもぎ（ゆるい手書き）', 'hand'],
  ['hachi-maru-pop', 'Hachi Maru Pop', 'はちまるポップ（かわいい丸文字）', 'hand'],
  ['yuji-syuku', 'Yuji Syuku', '佑字 肅（筆の楷書）', 'hand'],
  ['yuji-boku', 'Yuji Boku', '佑字 朴（筆）', 'hand'],
  ['yuji-mai', 'Yuji Mai', '佑字 舞（やわらかい筆）', 'hand'],
  ['new-tegomin', 'New Tegomin', 'てごみん（手書き明朝）', 'hand'],
  ['slackside-one', 'Slackside One', 'ゆるい走り書き', 'hand', true],
  ['darumadrop-one', 'Darumadrop One', 'だるまドロップ（筆ペンのポップ）', 'hand', true],

  ['dela-gothic-one', 'Dela Gothic One', '極太ゴシック', 'pop'],
  ['rocknroll-one', 'RocknRoll One', 'ロックンロール（太字ポップ）', 'pop'],
  ['reggae-one', 'Reggae One', 'レゲエ（インパクト）', 'pop'],
  ['mochiy-pop-one', 'Mochiy Pop One', 'もちいポップ', 'pop'],
  ['mochiy-pop-p-one', 'Mochiy Pop P One', 'もちいポップ（詰め）', 'pop'],
  ['potta-one', 'Potta One', 'ポッタ（太い筆ポップ）', 'pop'],
  ['cherry-bomb-one', 'Cherry Bomb One', 'チェリーボム（ぷっくり）', 'pop', true],
  ['aoboshi-one', 'Aoboshi One', '青星（レトロな見出し）', 'pop', true],

  ['dotgothic16', 'DotGothic16', 'ドット文字', 'design'],
  ['stick', 'Stick', 'スティック（細い棒）', 'design'],
  ['train-one', 'Train One', 'トレイン（線路の模様）', 'design'],
  ['rampart-one', 'Rampart One', 'ランパート（立体の袋文字）', 'design'],
  ['wdxl-lubrifont-jp-n', 'WDXL Lubrifont JP N', '縦長のレトロ文字', 'design'],
  ['monomaniac-one', 'Monomaniac One', 'モノマニアック（未来風）', 'design', true],
  ['palette-mosaic', 'Palette Mosaic', 'モザイク文字', 'design', true],
  ['shizuru', 'Shizuru', 'しずる（立体）', 'design', true],
  ['rock-3d', 'Rock 3D', 'ロック3D（岩）', 'design', true],
  ['chokokutai', 'Chokokutai', '彫刻体', 'design', true],
];

const FALLBACK = { gothic: 'sans-serif', round: 'sans-serif', mincho: 'serif', hand: 'sans-serif', pop: 'sans-serif', design: 'sans-serif' };

let css = '// 同梱フォントの登録。日本語とラテン文字のサブセットだけを読み込む（実際のダウンロードは使ったときだけ）。\n// このファイルは tools/gen-fonts.mjs が作る。直接書き換えないこと。\n';
let list = `// アプリに同梱しているフォントの一覧。このファイルは tools/gen-fonts.mjs が作る。直接書き換えないこと。
export type FontCat = 'gothic' | 'round' | 'mincho' | 'hand' | 'pop' | 'design' | 'system';

export interface FontOption {
  /** 一覧に出す名前 */
  label: string;
  /** CSSの font-family の値 */
  family: string;
  cat: FontCat;
  /** 見本用フォント（public/font-previews）のファイル名。端末のフォントには無い */
  preview?: string;
  /** 太字のデータがあるか（無いフォントはブラウザが線を太らせて描く） */
  bold?: boolean;
  /** ひらがな・カタカナ・英数字だけ（漢字はほかのフォントで表示される） */
  kanaOnly?: boolean;
}

export const FONT_CATS: [FontCat, string][] = [
  ['gothic', 'ゴシック'],
  ['round', '丸ゴシック'],
  ['mincho', '明朝・アンチック'],
  ['hand', '手書き・筆'],
  ['pop', 'ポップ・太字'],
  ['design', 'デザイン'],
  ['system', '端末のフォント'],
];

/** 見本に使う文字（tools/gen-font-previews.py と同じにすること） */
export const FONT_SAMPLE = 'あア永Aa12';

/** アプリに同梱しているフォント（どの端末でも同じ見た目になる。使うときに読み込む） */
export const BUNDLED_FONTS: FontOption[] = [
`;
for (const [pkg, family, note, cat, kana] of FONTS) {
  const dir = join(root, 'node_modules/@fontsource', pkg);
  if (!existsSync(join(dir, 'japanese-400.css'))) throw new Error(`${pkg}: japanese-400.css がありません（npm install @fontsource/${pkg}）`);
  const bold = existsSync(join(dir, 'japanese-700.css'));
  for (const w of bold ? [400, 700] : [400]) css += `import '@fontsource/${pkg}/japanese-${w}.css';\nimport '@fontsource/${pkg}/latin-${w}.css';\n`;
  list += `  { label: '${family}（${note}）', family: '"${family}", ${FALLBACK[cat]}', cat: '${cat}', preview: '${pkg}'${bold ? ', bold: true' : ''}${kana ? ', kanaOnly: true' : ''} },\n`;
}
list += '];\n';
writeFileSync(join(root, 'src/fonts.ts'), css);
writeFileSync(join(root, 'src/fontList.ts'), list);
console.log(`${FONTS.length} fonts`);
