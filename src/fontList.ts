// アプリに同梱しているフォントの一覧。このファイルは tools/gen-fonts.mjs が作る。直接書き換えないこと。
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
  { label: 'Noto Sans JP（ゴシック（標準））', family: '"Noto Sans JP", sans-serif', cat: 'gothic', preview: 'noto-sans-jp', bold: true },
  { label: 'Zen Kaku Gothic New（すっきりしたゴシック）', family: '"Zen Kaku Gothic New", sans-serif', cat: 'gothic', preview: 'zen-kaku-gothic-new', bold: true },
  { label: 'Zen Kaku Gothic Antique（昔ふうのゴシック）', family: '"Zen Kaku Gothic Antique", sans-serif', cat: 'gothic', preview: 'zen-kaku-gothic-antique', bold: true },
  { label: 'BIZ UDPGothic（読みやすいUDゴシック）', family: '"BIZ UDPGothic", sans-serif', cat: 'gothic', preview: 'biz-udpgothic', bold: true },
  { label: 'BIZ UDGothic（UDゴシック（等幅））', family: '"BIZ UDGothic", sans-serif', cat: 'gothic', preview: 'biz-udgothic', bold: true },
  { label: 'LINE Seed JP（LINEのゴシック）', family: '"LINE Seed JP", sans-serif', cat: 'gothic', preview: 'line-seed-jp', bold: true },
  { label: 'IBM Plex Sans JP（かっちりしたゴシック）', family: '"IBM Plex Sans JP", sans-serif', cat: 'gothic', preview: 'ibm-plex-sans-jp', bold: true },
  { label: 'M PLUS 1p（M+ ゴシック）', family: '"M PLUS 1p", sans-serif', cat: 'gothic', preview: 'm-plus-1p', bold: true },
  { label: 'M PLUS 1（M+ 1）', family: '"M PLUS 1", sans-serif', cat: 'gothic', preview: 'm-plus-1', bold: true },
  { label: 'M PLUS 2（M+ 2）', family: '"M PLUS 2", sans-serif', cat: 'gothic', preview: 'm-plus-2', bold: true },
  { label: 'Murecho（やわらかいゴシック）', family: '"Murecho", sans-serif', cat: 'gothic', preview: 'murecho', bold: true },
  { label: 'Sawarabi Gothic（さわらびゴシック）', family: '"Sawarabi Gothic", sans-serif', cat: 'gothic', preview: 'sawarabi-gothic' },
  { label: 'Kosugi（小杉ゴシック）', family: '"Kosugi", sans-serif', cat: 'gothic', preview: 'kosugi' },
  { label: 'M PLUS 1 Code（プログラム向け等幅）', family: '"M PLUS 1 Code", sans-serif', cat: 'gothic', preview: 'm-plus-1-code', bold: true },
  { label: 'M PLUS Rounded 1c（丸ゴシック）', family: '"M PLUS Rounded 1c", sans-serif', cat: 'round', preview: 'm-plus-rounded-1c', bold: true },
  { label: 'Zen Maru Gothic（やわらか丸ゴシック）', family: '"Zen Maru Gothic", sans-serif', cat: 'round', preview: 'zen-maru-gothic', bold: true },
  { label: 'Kosugi Maru（小杉丸ゴシック）', family: '"Kosugi Maru", sans-serif', cat: 'round', preview: 'kosugi-maru' },
  { label: 'Kiwi Maru（キウイ丸（やさしい））', family: '"Kiwi Maru", sans-serif', cat: 'round', preview: 'kiwi-maru' },
  { label: 'Tsukimi Rounded（月見丸）', family: '"Tsukimi Rounded", sans-serif', cat: 'round', preview: 'tsukimi-rounded', bold: true, kanaOnly: true },
  { label: 'Noto Serif JP（明朝（標準））', family: '"Noto Serif JP", serif', cat: 'mincho', preview: 'noto-serif-jp', bold: true },
  { label: 'Shippori Mincho（しっぽり明朝）', family: '"Shippori Mincho", serif', cat: 'mincho', preview: 'shippori-mincho', bold: true },
  { label: 'Shippori Mincho B1（しっぽり明朝（にじみ））', family: '"Shippori Mincho B1", serif', cat: 'mincho', preview: 'shippori-mincho-b1', bold: true },
  { label: 'Zen Old Mincho（オールド明朝）', family: '"Zen Old Mincho", serif', cat: 'mincho', preview: 'zen-old-mincho', bold: true },
  { label: 'BIZ UDPMincho（読みやすいUD明朝）', family: '"BIZ UDPMincho", serif', cat: 'mincho', preview: 'biz-udpmincho', bold: true },
  { label: 'BIZ UDMincho（UD明朝（等幅））', family: '"BIZ UDMincho", serif', cat: 'mincho', preview: 'biz-udmincho', bold: true },
  { label: 'Sawarabi Mincho（さわらび明朝）', family: '"Sawarabi Mincho", serif', cat: 'mincho', preview: 'sawarabi-mincho' },
  { label: 'Hina Mincho（ひな明朝（上品））', family: '"Hina Mincho", serif', cat: 'mincho', preview: 'hina-mincho' },
  { label: 'Kaisei Opti（解星オプティ）', family: '"Kaisei Opti", serif', cat: 'mincho', preview: 'kaisei-opti', bold: true },
  { label: 'Kaisei Tokumin（解星 特ミン（太め））', family: '"Kaisei Tokumin", serif', cat: 'mincho', preview: 'kaisei-tokumin', bold: true },
  { label: 'Kaisei HarunoUmi（解星 春の海）', family: '"Kaisei HarunoUmi", serif', cat: 'mincho', preview: 'kaisei-harunoumi', bold: true },
  { label: 'Kaisei Decol（解星デコール（おしゃれ））', family: '"Kaisei Decol", serif', cat: 'mincho', preview: 'kaisei-decol', bold: true },
  { label: 'Zen Antique（アンチック（漫画のセリフ風））', family: '"Zen Antique", serif', cat: 'mincho', preview: 'zen-antique' },
  { label: 'Zen Antique Soft（アンチック（やわらか））', family: '"Zen Antique Soft", serif', cat: 'mincho', preview: 'zen-antique-soft' },
  { label: 'Shippori Antique（しっぽりアンチック）', family: '"Shippori Antique", serif', cat: 'mincho', preview: 'shippori-antique' },
  { label: 'Shippori Antique B1（しっぽりアンチック（にじみ））', family: '"Shippori Antique B1", serif', cat: 'mincho', preview: 'shippori-antique-b1' },
  { label: 'Yusei Magic（マジックで書いた字）', family: '"Yusei Magic", sans-serif', cat: 'hand', preview: 'yusei-magic' },
  { label: 'Zen Kurenaido（ペン字風）', family: '"Zen Kurenaido", sans-serif', cat: 'hand', preview: 'zen-kurenaido' },
  { label: 'Klee One（クレー（教科書の手書き風））', family: '"Klee One", sans-serif', cat: 'hand', preview: 'klee-one' },
  { label: 'Yomogi（よもぎ（ゆるい手書き））', family: '"Yomogi", sans-serif', cat: 'hand', preview: 'yomogi' },
  { label: 'Hachi Maru Pop（はちまるポップ（かわいい丸文字））', family: '"Hachi Maru Pop", sans-serif', cat: 'hand', preview: 'hachi-maru-pop' },
  { label: 'Yuji Syuku（佑字 肅（筆の楷書））', family: '"Yuji Syuku", sans-serif', cat: 'hand', preview: 'yuji-syuku' },
  { label: 'Yuji Boku（佑字 朴（筆））', family: '"Yuji Boku", sans-serif', cat: 'hand', preview: 'yuji-boku' },
  { label: 'Yuji Mai（佑字 舞（やわらかい筆））', family: '"Yuji Mai", sans-serif', cat: 'hand', preview: 'yuji-mai' },
  { label: 'New Tegomin（てごみん（手書き明朝））', family: '"New Tegomin", sans-serif', cat: 'hand', preview: 'new-tegomin' },
  { label: 'Slackside One（ゆるい走り書き）', family: '"Slackside One", sans-serif', cat: 'hand', preview: 'slackside-one', kanaOnly: true },
  { label: 'Darumadrop One（だるまドロップ（筆ペンのポップ））', family: '"Darumadrop One", sans-serif', cat: 'hand', preview: 'darumadrop-one', kanaOnly: true },
  { label: 'Dela Gothic One（極太ゴシック）', family: '"Dela Gothic One", sans-serif', cat: 'pop', preview: 'dela-gothic-one' },
  { label: 'RocknRoll One（ロックンロール（太字ポップ））', family: '"RocknRoll One", sans-serif', cat: 'pop', preview: 'rocknroll-one' },
  { label: 'Reggae One（レゲエ（インパクト））', family: '"Reggae One", sans-serif', cat: 'pop', preview: 'reggae-one' },
  { label: 'Mochiy Pop One（もちいポップ）', family: '"Mochiy Pop One", sans-serif', cat: 'pop', preview: 'mochiy-pop-one' },
  { label: 'Mochiy Pop P One（もちいポップ（詰め））', family: '"Mochiy Pop P One", sans-serif', cat: 'pop', preview: 'mochiy-pop-p-one' },
  { label: 'Potta One（ポッタ（太い筆ポップ））', family: '"Potta One", sans-serif', cat: 'pop', preview: 'potta-one' },
  { label: 'Cherry Bomb One（チェリーボム（ぷっくり））', family: '"Cherry Bomb One", sans-serif', cat: 'pop', preview: 'cherry-bomb-one', kanaOnly: true },
  { label: 'Aoboshi One（青星（レトロな見出し））', family: '"Aoboshi One", sans-serif', cat: 'pop', preview: 'aoboshi-one', kanaOnly: true },
  { label: 'DotGothic16（ドット文字）', family: '"DotGothic16", sans-serif', cat: 'design', preview: 'dotgothic16' },
  { label: 'Stick（スティック（細い棒））', family: '"Stick", sans-serif', cat: 'design', preview: 'stick' },
  { label: 'Train One（トレイン（線路の模様））', family: '"Train One", sans-serif', cat: 'design', preview: 'train-one' },
  { label: 'Rampart One（ランパート（立体の袋文字））', family: '"Rampart One", sans-serif', cat: 'design', preview: 'rampart-one' },
  { label: 'WDXL Lubrifont JP N（縦長のレトロ文字）', family: '"WDXL Lubrifont JP N", sans-serif', cat: 'design', preview: 'wdxl-lubrifont-jp-n' },
  { label: 'Monomaniac One（モノマニアック（未来風））', family: '"Monomaniac One", sans-serif', cat: 'design', preview: 'monomaniac-one', kanaOnly: true },
  { label: 'Palette Mosaic（モザイク文字）', family: '"Palette Mosaic", sans-serif', cat: 'design', preview: 'palette-mosaic', kanaOnly: true },
  { label: 'Shizuru（しずる（立体））', family: '"Shizuru", sans-serif', cat: 'design', preview: 'shizuru', kanaOnly: true },
  { label: 'Rock 3D（ロック3D（岩））', family: '"Rock 3D", sans-serif', cat: 'design', preview: 'rock-3d', kanaOnly: true },
  { label: 'Chokokutai（彫刻体）', family: '"Chokokutai", sans-serif', cat: 'design', preview: 'chokokutai', kanaOnly: true },
];
