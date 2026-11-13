// プレビュー再生。音声をWeb Audioで鳴らし、その時計を基準に再生位置を進める。
import { editorState } from '../state/store';
import { projectDuration } from '../state/timeline';
import { pumpFeeds, scheduleAudio, stopScheduled, type Scheduled } from './audioMix';
import { ensureWorklets } from '../fx/audio';
import { media } from './mediaCache';
import { keepAudioAudible, releaseAudio } from './audioUnlock';

class Playback {
  private ctx: AudioContext | null = null;
  private sched: Scheduled | null = null;
  private pumpTimer = 0;
  /** 再生を始めるたびに増やす番号（古い再生の読み込み結果を捨てるため） */
  private session = 0;
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

    // iPhone のマナーモードでも音が出るようにする（ボタンを押した操作の中で呼ぶ必要がある）
    keepAudioAudible();
    this.ctx ??= new AudioContext();
    await this.ctx.resume();
    // 読み込みに時間のかかる素材があっても再生は始める（読み込めたものから鳴る）
    await Promise.race([Promise.all([media.ensureAll(Object.values(s.project.assets)), ensureWorklets(this.ctx)]), new Promise((r) => setTimeout(r, 3000))]);
    // 待っている間に止められたり、もう一度押されたりしたら何もしない
    if (editorState().playing) return;
    const session = ++this.session;

    // 長い素材は、最初に鳴る部分を先に読んでおく（頭が欠けないように）
    const probe = scheduleAudio(this.ctx, s.project, from, this.ctx.currentTime + 1);
    const first = pumpFeeds(probe, () => undefined, this.ctx.currentTime + 1.5);
    stopScheduled(probe);
    await Promise.race([Promise.all(first.map((c) => media.stream(c.assetId)?.load(c.idx))), new Promise((r) => setTimeout(r, 4000))]);
    if (session !== this.session || editorState().playing) return;

    this.startTime = from;
    this.startCtxTime = this.ctx.currentTime + 0.05;
    this.sched = scheduleAudio(this.ctx, s.project, from, this.startCtxTime);
    this.pump(session);
    this.pumpTimer = window.setInterval(() => this.pump(session), 500);
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

  /** 長い素材の、これから8秒以内に鳴る部分をつなぐ。読み込めていない部分は読み込んでからつなぐ */
  private pump(session: number) {
    if (session !== this.session || !this.sched || !this.ctx) return;
    const missing = pumpFeeds(this.sched, (id, idx) => media.stream(id)?.cached(idx), this.ctx.currentTime + 8);
    for (const c of missing) {
      void media
        .stream(c.assetId)
        ?.load(c.idx)
        .then(() => this.pump(session));
    }
  }

  pause() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.pumpTimer);
    this.session++;
    releaseAudio();
    const t = this.now();
    stopScheduled(this.sched);
    this.sched = null;
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

}

export const playback = new Playback();
