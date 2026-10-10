// キャンバスに文字を描く前にフォントを読み込んでおく（キャンバスはフォントの読み込みを待ってくれないため）。
import type { Project } from '../types';
import { fontOf } from '../render/renderer';

const loaded = new Set<string>();
const pending = new Map<string, Promise<void>>();

function load(font: string, text: string): Promise<void> {
  if (loaded.has(font) || typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  let p = pending.get(font);
  if (!p) {
    // 日本語と英数字の両方のサブセットを読み込ませる
    p = document.fonts
      .load(font, `${text}あ亜A1`)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        loaded.add(font);
        pending.delete(font);
      });
    pending.set(font, p);
  }
  return p;
}

/** プロジェクトのテキストに使われているフォントをすべて読み込む（書き出し前に使う） */
export function ensureProjectFonts(project: Project): Promise<void> {
  const jobs = project.items.filter((it) => it.kind === 'text').map((it) => load(fontOf(it.style), it.text));
  return Promise.all(jobs).then(() => undefined);
}

/** まだ読み込んでいないフォントがあれば読み込みを始め、読み終わったら onLoaded を呼ぶ（プレビュー用） */
export function requestProjectFonts(project: Project, onLoaded: () => void): void {
  let started = false;
  for (const it of project.items) {
    if (it.kind !== 'text') continue;
    const font = fontOf(it.style);
    if (loaded.has(font) || pending.has(font)) continue;
    started = true;
    void load(font, it.text);
  }
  if (started) void Promise.all(pending.values()).then(onLoaded);
}
