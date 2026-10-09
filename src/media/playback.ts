// プレビュー再生。音声をWeb Audioで鳴らし、その時計を基準に再生位置を進める。
import { editorState } from '../state/store';
import { projectDuration } from '../state/timeline';
import { scheduleAudio } from './audioMix';
import { media } from './mediaCache';

class Playback {
  private ctx: AudioContext | null = null;
  private nodes: AudioBufferSourceNode[] = [];
  private startCtxTime = 0;
  private startTime = 0;
  private raf = 0;

  get isPlaying() {
    return editorState().playing;
  }

  /** 再生中の現在位置（AudioContextの時計から計算） */
  now(): number {
    if (!this.ctx || !this.isPlaying) return editorState().currentTime;
    return this.startTime + Math.max(0, this.ctx.currentTime - this.startCtxTime);
  }

  async play() {
    const s = editorState();
    if (s.playing) return;
    const duration = projectDuration(s.project);
    let from = s.currentTime;
    if (from >= duration - 0.01) from = 0;

    this.ctx ??= new AudioContext();
    await this.ctx.resume();
    await media.ensureAll(Object.values(s.project.assets));

    this.startTime = from;
    this.startCtxTime = this.ctx.currentTime + 0.05;
    this.nodes = scheduleAudio(this.ctx, s.project, from, this.startCtxTime);
    s.setTime(from);
    s.setPlaying(true);

    const tick = () => {
      const t = this.now();
      const end = projectDuration(editorState().project);
      if (t >= end) {
        this.pause();
        editorState().setTime(end);
        return;
      }
      editorState().setTime(t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    cancelAnimationFrame(this.raf);
    const t = this.now();
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        // 開始前のノードは止める必要がない
      }
    }
    this.nodes = [];
    const s = editorState();
    s.setPlaying(false);
    s.setTime(t);
    for (const [, v] of media.allVideos()) v.pause();
  }

  toggle() {
    if (this.isPlaying) this.pause();
    else void this.play();
  }

  /** 再生中に位置を変えたら、音を並べ直す */
  seek(t: number) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();
    editorState().setTime(t);
    if (wasPlaying) void this.play();
  }

  /** 1つの音声だけを試聴する（セリフの確認用） */
  async audition(buffer: AudioBuffer, offset = 0, duration?: number) {
    this.ctx ??= new AudioContext();
    await this.ctx.resume();
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.ctx.destination);
    node.start(0, offset, duration);
  }
}

export const playback = new Playback();
