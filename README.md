# スーパー編集メーカー

ブラウザだけで「立ち絵＋字幕＋読み上げ音声」の解説動画を作れる編集ツールです。インストール不要で、Windows 以外（Mac・Chromebook・iPad など）でも動きます。

> 本ツールは「ゆっくりMovieMaker4（YMM4）」とは無関係の独自ツールです。ゆっくりボイス（AquesTalk）は搭載していません。

開発計画は [docs/development-plan.md](docs/development-plan.md) を参照してください。

## できること（MVP）

| 機能 | 内容 |
| --- | --- |
| セリフ入力 | キャラを選んでセリフを入力すると、音声・字幕・立ち絵がまとめてタイムラインに追加される。台本の一括貼り付け（`キャラ名：セリフ` 形式）にも対応 |
| 音声 | ① PC で起動した VOICEVOX エンジンに接続して合成 ② 外部で作った WAV/MP3 をセリフに割り当て（ファイル名順の一括割り当てあり） |
| 立ち絵 | 透過 PNG パーツ（体・目開／目閉・口閉／半開き／開）を重ね、音量（RMS）による口パクと自動の目パチ。未設定時は仮キャラを表示 |
| 字幕・テキスト | フォント・サイズ・色・縁取り・位置・折り返し幅 |
| タイムライン | レイヤー、ドラッグ移動、端での伸縮、再生位置での分割、複製、吸着、Undo/Redo |
| プレビュー | 再生位置の画面をリアルタイム表示。プレビュー上のドラッグで位置調整 |
| 素材 | PNG/JPG、MP4/WebM、MP3/WAV（ドラッグ＆ドロップ可） |
| 書き出し | WebCodecs ＋ Mediabunny によるブラウザ内エンコード。MP4（H.264＋AAC）、1080p/720p・30fps。VOICEVOX のクレジット表記を自動生成 |
| 保存 | IndexedDB（プロジェクト）＋ OPFS（素材）に自動保存。ZIP での書き出し・読み込み。永続ストレージを要求 |
| PWA | 静的ファイルのみで動作し、一度開けばオフラインでも起動 |

### ブラウザごとの書き出し形式

起動時と書き出し画面で対応状況を判定し、自動で切り替えます。

| 環境 | 映像 | 音声 | 形式 |
| --- | --- | --- | --- |
| Chrome / Edge / Safari（Windows・Mac） | H.264 | AAC（ネイティブ） | MP4 |
| Firefox、Linux の各ブラウザ | H.264 | AAC（`@mediabunny/aac-encoder` の WASM で補完、必要なときだけ読み込み） | MP4 |
| H.264 エンコード非対応の環境 | VP9 / VP8 | Opus | WebM |

## 使い方

1. 「キャラクター」タブで、キャラごとに VOICEVOX の話者や立ち絵パーツを設定します。
2. 画面下の入力欄でキャラを選んでセリフを入力し Enter（Alt+1〜9 でキャラ切り替え）。まとめて入れるときは「台本」タブに貼り付けます。
3. 背景画像や BGM は「素材」タブか、画面へのドラッグ＆ドロップで追加します。
4. 「書き出し」から動画を保存します。

### VOICEVOX との接続

VOICEVOX エンジン（既定 `http://127.0.0.1:50021`）にブラウザから直接接続します。公開サイトから使う場合は、エンジンがそのページのオリジンからのアクセスを許可している必要があります。

```sh
# 例：エンジンをコマンドで起動する場合
run --allow_origin https://<このツールを置いたオリジン>
# または
run --cors_policy_mode all
```

VOICEVOX の音声を使った動画には `VOICEVOX:キャラ名` のクレジット表記が必要です。各キャラクターの利用規約も確認してください。読み込んだ音声ファイルの利用条件は、その音声の作成元の規約に従ってください。

### ショートカット

| キー | 動作 |
| --- | --- |
| Space | 再生／停止 |
| ← / →（Shift で 1 秒） | 1 フレーム移動 |
| S | 再生位置で分割 |
| Delete / Backspace | 選択アイテムを削除 |
| Ctrl+D | 複製 |
| Ctrl+Z / Ctrl+Shift+Z（Ctrl+Y） | 元に戻す／やり直す |
| Ctrl+ホイール | タイムラインの拡大・縮小 |

## 開発

```sh
npm install
npm run dev        # 開発サーバー
npm test           # 単体テスト（Vitest）
npm run typecheck  # 型チェック
npm run build      # dist/ に静的ファイルを出力（任意の静的ホスティングに置ける）
```

### 構成

```
src/
  types.ts              プロジェクトのデータモデル
  state/
    store.ts            Zustand＋Immer のストア（スナップショット方式の Undo/Redo、ドラッグは1操作にまとめる）
    timeline.ts         分割・伸縮・空きレイヤー探索・台本解析などの純粋関数
    actions.ts          UI から呼ぶ編集操作（音声合成・素材取り込みを含む）
  render/
    renderer.ts         1フレームの描画（プレビューと書き出しで共通）
    previewSource.ts    プレビュー用の素材取り出し（HTMLVideoElement 同期）
  media/
    mediaCache.ts       デコード済み画像・音声・動画要素のキャッシュ
    lipsync.ts          RMS による口パク、目パチ
    audioMix.ts         音声アイテムの配置（再生と書き出しで共通）
    playback.ts         Web Audio の時計を基準にした再生
    importer.ts         ファイルの取り込みとメタ情報の取得
  voice/                VOICEVOX エンジンとの通信
  export/exporter.ts    WebCodecs＋Mediabunny による書き出し
  persist/              IndexedDB / OPFS / ZIP / 自動保存
  ui/                   React コンポーネント
tests/                  Vitest の単体テスト
```

- 外部の音声はすべて素材としてプロジェクトに取り込んでから使います。
- レンダラーはプレビューと書き出しで同じ描画コードを使うため、見た目のずれが起きません。
- 書き出しは、全音声を `OfflineAudioContext` で 1 本にミックスしてから、映像フレームと 1 秒ずつ交互に Mediabunny へ渡します。動画素材のフレームは `CanvasSink.canvasesAtTimestamps` で時刻順にデコードします。保存先を選んだ場合は `StreamTarget` でディスクへ逐次書き込みます。

## 計画との対応と今後

- フェーズ1の検証：ヘッドレス Chromium で 15 秒・720p の動画を約 3.5 秒（実時間の約 0.2 倍）で書き出せることを確認済み。ゲートA（実時間の 2 倍以内）の目安を満たしています。
- 計画からの変更：描画は MVP ではメインスレッドの Canvas 2D で行っています（プレビュー画質の切り替えで負荷を調整）。重いエフェクトを入れる段階で Worker＋OffscreenCanvas に移します。
- AAC 非対応環境の扱い（計画の未決事項）：WASM の AAC エンコーダーで補い、MP4 にそろえる方式にしました。
- フェーズ2以降：PSD 立ち絵、映像エフェクト（フェード・スライド・拡大縮小）、図形・トランジション、テンプレート、マイク録音、クラウド TTS。

## ライセンスについて

依存ライブラリ：React・Zustand・Immer・fflate（MIT）、Mediabunny・@mediabunny/aac-encoder（MPL-2.0）。
