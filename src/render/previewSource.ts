// プレビュー用の素材取り出し口。動画はHTMLVideoElementを再生位置に合わせて使う。
import type { Project, VideoItem } from '../types';
import { media } from '../media/mediaCache';
import { isActiveAt } from '../state/timeline';
import type { Drawable, FrameSource } from './renderer';

export const previewSource: FrameSource = {
  image(assetId) {
    const img = media.image(assetId);
    return img ? { source: img, width: img.width, height: img.height } : null;
  },
  videoFrame(item: VideoItem) {
    const v = media.video(item.assetId);
    if (!v || v.readyState < 2) return null;
    return { source: v, width: v.videoWidth, height: v.videoHeight } satisfies Drawable;
  },
};

/** 動画要素の再生位置をタイムラインに合わせる */
export function syncVideos(project: Project, t: number, playing: boolean) {
  const active = new Set<string>();
  for (const item of project.items) {
    if (item.kind !== 'video' || !isActiveAt(item, t)) continue;
    const v = media.video(item.assetId);
    if (!v || active.has(item.assetId)) continue;
    active.add(item.assetId);
    const target = t - item.start + item.sourceOffset;
    if (playing) {
      if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
      if (v.paused) void v.play().catch(() => undefined);
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.02 && !v.seeking) v.currentTime = target;
    }
  }
  for (const [id, v] of media.allVideos()) if (!active.has(id) && !v.paused) v.pause();
}
