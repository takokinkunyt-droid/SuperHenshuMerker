# スーパー編集メーカー

ブラウザだけで動く動画編集ツールです。インストール不要で、パソコンでもスマホでも使えます。編集・保存・書き出しはすべてブラウザの中で行われ、素材が外部に送信されることはありません。

**公開先：** https://takokinkunyt-droid.github.io/SuperHenshuMerker/

最初の開発計画は [docs/development-plan.md](docs/development-plan.md) にあります（キャラクター・立ち絵・台本の機能は、その後の方針変更で削除しました。合成音声は「読み上げ」として残しています）。

## できること

| 機能 | 内容 |
| --- | --- |
| 画面の比率 | 16:9（横長）・9:16（縦長・ショート動画）・1:1（正方形）。途中で切り替えても、中央の素材は中央、下の文字は下のまま |
| 素材 | 動画（MP4・MOV・WebM）、画像（PNG・JPG など）、音楽・音声（MP3・WAV・M4A・AAC・OGG など）。ボタンまたはドラッグ＆ドロップで追加 |
| テキスト | フォント（同梱の日本語フォント13種＋端末のフォント）・サイズ・色・縁取り・影・背景（帯）・位置・折り返し幅 |
| 読み上げ（合成音声） | PC で起動した VOICEVOX に接続し、文章を1行ずつ音声にして再生位置から並べる（字幕も同時に追加可）。あとから文字や声を変えて作り直し。使った声のクレジット表記を書き出し画面に表示 |
| プレビューで直接操作 | タップ／クリックで選択、ドラッグで移動、四隅のつまみで拡大縮小、丸いつまみで回転（0°・90°などに吸着、Shiftで15°刻み）、スマホは2本指ピンチで拡大縮小＋回転。テキストはダブルクリック／ダブルタップでその場で編集 |
| 位置合わせ | プレビュー上のドラッグで画面の中央・端・余白（5%）・ほかのアイテムに吸着（ガイド線表示、Altで解除）。「そろえる」ボタンで左右・上下にワンタッチ整列 |
| 映像エフェクト | ぼかし、モザイク、フェードイン・アウト、画面外からスライドイン（上下左右）、拡大縮小しながら入場 |
| 音声エフェクト | 低音強化、ピー音、ノイズ、フェードイン・アウト |
| タイムライン | レイヤー、移動、端での伸縮、再生位置での分割、吸着。上のバーに「複製」「コピー」「ペースト（再生位置に貼り付け）」「戻す」「やり直す」 |
| 再生位置（赤い線） | 目盛り・つまみ・線そのもののドラッグ、クリック／タップで移動、長押ししたまま動かして移動 |
| プレビュー | 再生位置の画面をリアルタイム表示。プレビュー上のドラッグで位置を調整。「全体を表示」「画面いっぱい」ボタン |
| 書き出し | WebCodecs ＋ Mediabunny によるブラウザ内エンコード。MP4（H.264＋AAC）、フルHD／HD・30fps。スマホは「共有・写真に保存」 |
| 共同作業 | 招待リンクを送ると、同じプロジェクトを複数人で同時に編集できる（変更はすぐ相手の画面に反映、素材も自動でやりとり、相手が選んでいるアイテムに名前を表示）。共有サーバー（下記）を使う |
| 保存 | IndexedDB（プロジェクト）＋ OPFS（素材）に自動保存。ZIP での書き出し・読み込み |
| スマホ | アプリのような固定画面（プレビュー大きめ → タイムライン → 下のタブ）。「素材」「編集」は下から出るパネルで、プレビューを見ながら操作できる。タイムラインのアイテムはタップで選んでからドラッグで移動（未選択のものは長押しで移動、すぐ動かすとスクロール） |
| PWA | 一度開けばオフラインでも起動 |

### ブラウザごとの書き出し形式

| 環境 | 映像 | 音声 | 形式 |
| --- | --- | --- | --- |
| Chrome / Edge / Safari | H.264 | AAC（ネイティブ） | MP4 |
| Firefox、Linux の各ブラウザ | H.264 | AAC（`@mediabunny/aac-encoder` の WASM で補完、必要なときだけ読み込み） | MP4 |
| H.264 エンコード非対応の環境 | VP9 / VP8 | Opus | WebM |

### VOICEVOX との接続（読み上げを使う場合）

VOICEVOX エンジン（既定 `http://127.0.0.1:50021`）にブラウザから直接接続します。GitHub Pages など `localhost` 以外から使う場合は、最初に1回だけ次の設定が必要です。

1. VOICEVOX を起動したまま、ブラウザで `http://127.0.0.1:50021/setting` を開く
2. 「Allow Origin」に `https://takokinkunyt-droid.github.io` を入れて保存する
3. VOICEVOX を再起動する

ブラウザに「ローカルネットワークへのアクセス」の確認が出たら許可してください。VOICEVOX の音声を使った動画には `VOICEVOX:キャラ名` のクレジット表記が必要です。

### 友達と VOICEVOX を共有する（スマホから読み上げを使う）

`tools/voicevox-share.bat`（Windows、Mac・Linux は `node tools/voicevox-share.mjs`）を起動すると、自分の VOICEVOX を合言葉付きの共有サーバー＋ Cloudflare のトンネルで公開し、**友達に送る共有リンク**を表示します。友達はそのリンクを開くだけで、スマホからでも「🗣 読み上げ」が使えます。詳しい手順は [docs/voicevox-share.md](docs/voicevox-share.md) を見てください。

### 友達と一緒に編集する（共同作業）

共有サーバーを起動して共有リンクを開いたあと、上のバーの「👥 共同作業」→「共同作業を始める」を押すと**招待リンク**ができます。招待リンクを開いた人は、同じプロジェクトを一緒に編集できます（スマホからも可）。プロジェクトと素材は共有サーバーを動かしているパソコンの `tools/collab-data` に置かれ、変更は全員の画面にすぐ反映されます。同じアイテムを同時に変えたときは、あとから変えた方が残ります。「戻す」で戻るのは自分の変更だけです。

## 使い方

1. 何も選んでいない状態のプロジェクト設定で「画面の比率」を選ぶ（新規作成時にも選べます）
2. 「🎞 動画・画像」「🎵 音楽」「T テキスト」で素材を追加する
3. タイムラインで並べ替え・長さ調整・分割をする
4. 「書き出し」から保存する

### ショートカット（パソコン）

| キー | 動作 |
| --- | --- |
| Space | 再生／停止 |
| ← / →（Shift で 1 秒） | 1 フレーム移動 |
| S | 再生位置で分割 |
| Delete / Backspace | 選択アイテムを削除 |
| Ctrl+D | 複製 |
| Ctrl+C / Ctrl+V | コピー／再生位置に貼り付け |
| Ctrl+Z / Ctrl+Shift+Z（Ctrl+Y） | 元に戻す／やり直す |
| Ctrl+ホイール | タイムラインの拡大・縮小 |

## 開発

```sh
npm install
npm run dev        # 開発サーバー
npm test           # 単体テスト（Vitest）
npm run typecheck  # 型チェック
npm run build      # dist/ に静的ファイルを出力
```

Windows の PowerShell で `npm` が「スクリプトの実行が無効」と言われる場合は、`npm.cmd install` のように `npm.cmd` を使ってください。

### 公開（GitHub Pages）

`.github/workflows/deploy-pages.yml` により、デフォルトブランチへプッシュするたびにテスト・ビルドして GitHub Pages に公開します。リポジトリの Settings → Pages の Source は「GitHub Actions」にしておく必要があります。

### 構成

```
src/
  types.ts              プロジェクトのデータモデル
  state/
    store.ts            Zustand＋Immer のストア（Undo/Redo、ドラッグは1操作にまとめる）
    timeline.ts         分割・伸縮・空きレイヤー探索・比率変更時の位置調整などの純粋関数
    actions.ts          UI から呼ぶ編集操作
  render/
    renderer.ts         1フレームの描画（プレビューと書き出しで共通、エフェクト込み）
    effects.ts          エフェクトの時間変化・外枠・吸着の計算
    transform.ts        プレビュー上の選択・拡大縮小・回転の幾何計算
    previewSource.ts    プレビュー用の素材取り出し（HTMLVideoElement 同期）
  media/
    mediaCache.ts       デコード済み画像・音声・動画要素のキャッシュ（動画の音声は Mediabunny で少しずつデコード）
    audioMix.ts         音声の配置と音声エフェクト（再生と書き出しで共通）
    playback.ts         Web Audio の時計を基準にした再生
    importer.ts         ファイルの取り込みとメタ情報の取得
  voice/                VOICEVOX エンジンとの通信
  collab/               共同作業（変更の差分・適用、共有サーバーとのやりとり）
  export/exporter.ts    WebCodecs＋Mediabunny による書き出し
  persist/              IndexedDB / OPFS / ZIP / 自動保存 / 旧形式からの変換
  ui/                   React コンポーネント
tests/                  Vitest の単体テスト
```

## ライセンスについて

依存ライブラリ：React・Zustand・Immer・fflate（MIT）、Mediabunny・@mediabunny/aac-encoder（MPL-2.0）。
同梱フォント（Fontsource 経由、すべて SIL Open Font License 1.1）：Noto Sans JP、Noto Serif JP、M PLUS Rounded 1c、Zen Maru Gothic、Kosugi Maru、Dela Gothic One、RocknRoll One、Reggae One、Mochiy Pop One、Hachi Maru Pop、Yusei Magic、Zen Kurenaido、DotGothic16。日本語とラテン文字のサブセットの woff2 だけを公開物に含め、使ったときに読み込みます。
使った音楽・映像の利用条件（著作権・クレジット表記など）は、それぞれの提供元の規約に従ってください。
