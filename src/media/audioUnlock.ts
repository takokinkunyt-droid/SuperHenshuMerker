// iPhone・iPad は、マナーモード（消音スイッチ）のとき Web Audio の音を消してしまう。
// 再生ボタンを押したときに「音楽などのメディア再生」として扱わせ、マナーモードでも聞こえるようにする。

let silent: HTMLAudioElement | null = null;

const isApple = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** 無音の短いWAV（ループ再生用） */
function silentWavUrl(): string {
  const rate = 8000;
  const samples = rate / 10;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** 再生ボタンを押した直後（ユーザーの操作の中）に呼ぶ */
export function keepAudioAudible(): void {
  // Safari 16.4 以降：音の扱いを「再生（playback）」にすると、マナーモードでも鳴る
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    // 対応していないブラウザでは何もしない
  }
  // それより古い iPhone では、無音の audio 要素を鳴らしておくと同じ扱いになる
  if (!isApple()) return;
  if (!silent) {
    silent = new Audio(silentWavUrl());
    silent.loop = true;
    silent.setAttribute('playsinline', '');
  }
  void silent.play().catch(() => undefined);
}

export function releaseAudio(): void {
  silent?.pause();
}
