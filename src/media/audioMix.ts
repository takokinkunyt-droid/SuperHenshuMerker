// 音を鳴らすアイテム（音楽・効果音・動画の音声）をAudioContextに並べる。
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
    if (item.kind !== 'audio' && item.kind !== 'video') continue;
    const { assetId, sourceOffset: offset, volume } = item;
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
