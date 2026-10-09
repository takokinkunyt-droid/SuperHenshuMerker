// 音を鳴らすアイテム（セリフ・BGM・動画の音声）をAudioContextに並べる。
// プレビュー再生（AudioContext）と書き出し（OfflineAudioContext）で共通。
import type { Project } from '../types';
import { itemEnd } from '../state/timeline';
import { media } from './mediaCache';

export function scheduleAudio(
  ctx: BaseAudioContext,
  project: Project,
  fromTime: number,
  when: number,
): AudioBufferSourceNode[] {
  const nodes: AudioBufferSourceNode[] = [];
  for (const item of project.items) {
    let assetId: string | null = null;
    let offset = 0;
    let volume = 1;
    if (item.kind === 'voice') {
      assetId = item.audioAssetId;
      offset = item.audioOffset;
      volume = item.volume;
    } else if (item.kind === 'audio' || item.kind === 'video') {
      assetId = item.assetId;
      offset = item.sourceOffset;
      volume = item.volume;
    }
    if (!assetId || volume <= 0 || itemEnd(item) <= fromTime) continue;
    const buffer = media.audioBuffer(assetId);
    if (!buffer) continue;

    const skip = Math.max(0, fromTime - item.start);
    const sourceStart = offset + skip;
    const length = Math.min(item.duration - skip, buffer.duration - sourceStart);
    if (length <= 0) continue;

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    node.connect(gain).connect(ctx.destination);
    node.start(when + Math.max(0, item.start - fromTime), sourceStart, length);
    nodes.push(node);
  }
  return nodes;
}
