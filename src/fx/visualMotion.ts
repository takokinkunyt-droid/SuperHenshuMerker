// 位置・大きさ・回転・不透明度を変える映像エフェクト（描画・アニメーション・登場退場・カメラ）。
import { slideOffset, type SlideDirection } from '../render/effects';
import { B, IO_PARAMS, N, NF, S, ioAmount, rand, smoothNoise, type ParamDef } from './params';
import type { VisualDef } from './visualTypes';

const num = (v: unknown) => Number(v) || 0;
const TAU = Math.PI * 2;

const DIRS: [string, string][] = [
  ['left', '左から'],
  ['right', '右から'],
  ['top', '上から'],
  ['bottom', '下から'],
];

const PERIOD = (def = 1): ParamDef => NF('period', '周期', def, 0.05, 20, 0.05, '秒');

/** 0→1→0 と行き来する波（周期ごとに1往復） */
const swing = (local: number, period: number) => Math.sin((local / Math.max(0.01, period)) * TAU);

export const MOTION_FX: VisualDef[] = [
  // ---------------- 登場退場 ----------------
  {
    type: 'fadeInOut',
    name: 'フェードイン・アウト',
    cat: 'inout',
    kw: 'fade 透明',
    params: IO_PARAMS,
    x: (st, p, c) => void (st.alpha *= 1 - ioAmount(p, c.local, c.dur)),
  },
  {
    type: 'moveInOut',
    name: '移動しながら登場退場',
    cat: 'inout',
    kw: 'スライド slide',
    params: [N('x', 'X', -300, -3000, 3000, 10, 'px'), N('y', 'Y', 0, -3000, 3000, 10, 'px'), ...IO_PARAMS],
    x: (st, p, c) => {
      const k = ioAmount(p, c.local, c.dur);
      st.dx += num(p.x) * k;
      st.dy += num(p.y) * k;
    },
  },
  {
    type: 'offscreenInOut',
    name: '画面外から登場退場',
    cat: 'inout',
    kw: 'スライドイン slide',
    params: [S('dir', '方向', 'left', DIRS), ...IO_PARAMS],
    x: (st, p, c) => {
      const k = ioAmount(p, c.local, c.dur);
      const off = slideOffset(p.dir as SlideDirection, c.box, { width: c.W, height: c.H });
      st.dx += off.dx * k;
      st.dy += off.dy * k;
    },
  },
  {
    type: 'rotateInOut',
    name: '回転しながら登場退場',
    cat: 'inout',
    params: [N('angle', '回転', 360, -1440, 1440, 5, '度'), ...IO_PARAMS],
    x: (st, p, c) => void (st.rot += num(p.angle) * ioAmount(p, c.local, c.dur)),
  },
  {
    type: 'zoomInOut',
    name: '拡大縮小しながら登場退場',
    cat: 'inout',
    kw: 'ズーム zoom',
    params: [N('scale', '大きさ', 0, 0, 500, 5, '%'), ...IO_PARAMS],
    x: (st, p, c) => {
      const k = ioAmount(p, c.local, c.dur);
      const s = 1 + (num(p.scale) / 100 - 1) * k;
      st.sx *= s;
      st.sy *= s;
    },
  },
  {
    type: 'riseInOut',
    name: '起き上がりながら登場退場',
    cat: 'inout',
    params: IO_PARAMS,
    x: (st, p, c) => {
      // 下端を軸にして、寝ている状態から起き上がる
      const k = ioAmount(p, c.local, c.dur);
      st.sy *= 1 - k;
      st.dy += (c.box.h / 2) * k;
    },
  },
  {
    type: 'bounceInOut',
    name: '跳ねながら登場退場',
    cat: 'inout',
    kw: 'バウンド bounce',
    params: [N('h', '高さ', 300, 0, 2000, 10, 'px'), NF('tin', '登場の時間', 0.8, 0, 5, 0.05, '秒'), NF('tout', '退場の時間', 0, 0, 5, 0.05, '秒')],
    x: (st, p, c) => {
      const k = ioAmount({ ...p, ease: 'bounce' }, c.local, c.dur);
      st.dy -= num(p.h) * k;
    },
  },
  {
    type: 'skewInOut',
    name: '傾斜変形しながら登場退場',
    cat: 'inout',
    params: [N('angle', '傾き', 60, -85, 85, 1, '度'), ...IO_PARAMS],
    x: (st, p, c) => void (st.skx += num(p.angle) * ioAmount(p, c.local, c.dur)),
  },
  {
    type: 'shuffleInOut',
    name: 'テキストをシャッフルしながら登場退場',
    cat: 'inout',
    textOnly: true,
    params: IO_PARAMS,
    x: (st, p, c) => void (st.shuffle = Math.max(st.shuffle, ioAmount(p, c.local, c.dur))),
  },

  // ---------------- アニメーション ----------------
  {
    type: 'loopMove',
    name: '反復移動',
    cat: 'anim',
    kw: 'ゆらゆら 往復',
    params: [N('x', 'X', 0, -2000, 2000, 5, 'px'), N('y', 'Y', 30, -2000, 2000, 5, 'px'), PERIOD(1)],
    x: (st, p, c) => {
      const w = swing(c.local, num(p.period));
      st.dx += num(p.x) * w;
      st.dy += num(p.y) * w;
    },
  },
  {
    type: 'randMove',
    name: 'ランダム移動',
    cat: 'anim',
    params: [N('x', 'X の範囲', 50, 0, 2000, 5, 'px'), N('y', 'Y の範囲', 50, 0, 2000, 5, 'px'), NF('period', '間隔', 0.5, 0.02, 10, 0.02, '秒')],
    x: (st, p, c) => {
      const t = c.local / Math.max(0.01, num(p.period));
      st.dx += num(p.x) * smoothNoise(t, c.seed);
      st.dy += num(p.y) * smoothNoise(t, c.seed + 0.37);
    },
  },
  {
    type: 'loopRotate',
    name: '反復回転',
    cat: 'anim',
    params: [N('angle', '角度', 15, -360, 360, 1, '度'), PERIOD(1)],
    x: (st, p, c) => void (st.rot += num(p.angle) * swing(c.local, num(p.period))),
  },
  {
    type: 'randRotate',
    name: 'ランダム回転',
    cat: 'anim',
    params: [N('angle', '範囲', 20, 0, 360, 1, '度'), NF('period', '間隔', 0.5, 0.02, 10, 0.02, '秒')],
    x: (st, p, c) => void (st.rot += num(p.angle) * smoothNoise(c.local / Math.max(0.01, num(p.period)), c.seed + 0.11)),
  },
  {
    type: 'spin',
    name: '回転し続ける',
    cat: 'anim',
    kw: '連続回転',
    params: [N('speed', '速さ', 90, -1440, 1440, 5, '度/秒')],
    x: (st, p, c) => void (st.rot += num(p.speed) * c.local),
  },
  {
    type: 'loopZoom',
    name: '反復拡大縮小',
    cat: 'anim',
    kw: '鼓動',
    params: [N('amount', '大きさの変化', 10, -90, 300, 1, '%'), PERIOD(1)],
    x: (st, p, c) => {
      const s = Math.max(0, 1 + (num(p.amount) / 100) * (0.5 - 0.5 * Math.cos((c.local / Math.max(0.01, num(p.period))) * TAU)));
      st.sx *= s;
      st.sy *= s;
    },
  },
  {
    type: 'loopSkew',
    name: '反復傾斜変形',
    cat: 'anim',
    params: [N('angle', '傾き', 10, -80, 80, 1, '度'), PERIOD(1)],
    x: (st, p, c) => void (st.skx += num(p.angle) * swing(c.local, num(p.period))),
  },
  {
    type: 'blink',
    name: '反復透過',
    cat: 'anim',
    kw: '点滅',
    params: [N('min', '一番うすいとき', 0, 0, 100, 1, '%'), PERIOD(1), B('hard', 'パッと切り替える')],
    x: (st, p, c) => {
      const w = 0.5 + 0.5 * Math.cos((c.local / Math.max(0.01, num(p.period))) * TAU);
      const k = p.hard ? (w > 0.5 ? 1 : 0) : w;
      st.alpha *= num(p.min) / 100 + (1 - num(p.min) / 100) * k;
    },
  },
  {
    type: 'bounce',
    name: '跳ねる',
    cat: 'anim',
    kw: 'ジャンプ ぴょんぴょん',
    params: [N('h', '高さ', 60, 0, 2000, 5, 'px'), PERIOD(0.5), N('squash', 'つぶれ具合', 0, 0, 50, 1, '%')],
    x: (st, p, c) => {
      const ph = (c.local / Math.max(0.01, num(p.period))) % 1;
      const y = 4 * ph * (1 - ph); // 放物線
      st.dy -= num(p.h) * y;
      const sq = (num(p.squash) / 100) * (1 - y);
      st.sy *= 1 - sq;
      st.sx *= 1 + sq;
      st.dy += (c.box.h / 2) * sq;
    },
  },
  {
    type: 'shake',
    name: '振動',
    cat: 'anim',
    kw: 'ガタガタ 揺れ',
    params: [N('x', 'X', 10, 0, 500, 1, 'px'), N('y', 'Y', 10, 0, 500, 1, 'px'), NF('rate', '速さ', 30, 1, 60, 1, '回/秒')],
    x: (st, p, c) => {
      const i = Math.floor(c.local * num(p.rate));
      st.dx += num(p.x) * (rand(i, c.seed) * 2 - 1);
      st.dy += num(p.y) * (rand(i, c.seed + 0.5) * 2 - 1);
    },
  },
  {
    type: 'floaty',
    name: 'ふわふわ浮かぶ',
    cat: 'anim',
    params: [N('amount', '動く量', 20, 0, 500, 1, 'px'), PERIOD(3)],
    x: (st, p, c) => {
      const t = c.local / Math.max(0.01, num(p.period));
      st.dy += num(p.amount) * Math.sin(t * TAU);
      st.dx += num(p.amount) * 0.4 * Math.sin(t * TAU * 0.5 + 1);
      st.rot += 2 * Math.sin(t * TAU * 0.7);
    },
  },

  // ---------------- 描画 ----------------
  {
    type: 'opacity',
    name: '不透明度',
    cat: 'draw',
    kw: '透明度',
    params: [N('v', '不透明度', 100, 0, 100, 1, '%')],
    x: (st, p) => void (st.alpha *= Math.min(1, Math.max(0, num(p.v) / 100))),
  },
  {
    type: 'pos',
    name: '描画位置',
    cat: 'draw',
    kw: '座標 移動',
    params: [N('x', 'X', 0, -4000, 4000, 5, 'px'), N('y', 'Y', 0, -4000, 4000, 5, 'px')],
    x: (st, p) => {
      st.dx += num(p.x);
      st.dy += num(p.y);
    },
  },
  {
    type: 'polarPos',
    name: '描画位置（極座標）',
    cat: 'draw',
    kw: '円運動',
    params: [N('r', '距離', 100, 0, 4000, 5, 'px'), N('angle', '角度', 0, -3600, 3600, 5, '度')],
    x: (st, p) => {
      const a = (num(p.angle) * Math.PI) / 180;
      st.dx += num(p.r) * Math.cos(a);
      st.dy += num(p.r) * Math.sin(a);
    },
  },
  {
    type: 'zoom',
    name: '拡大縮小',
    cat: 'draw',
    kw: 'ズーム',
    params: [N('all', '全体', 100, 0, 1000, 1, '%'), N('x', '横', 100, 0, 1000, 1, '%'), N('y', '縦', 100, 0, 1000, 1, '%')],
    x: (st, p) => {
      st.sx *= (num(p.all) / 100) * (num(p.x) / 100);
      st.sy *= (num(p.all) / 100) * (num(p.y) / 100);
    },
  },
  {
    type: 'zoomPx',
    name: '拡大縮小（ピクセル）',
    cat: 'draw',
    params: [N('w', '幅（0で縦に合わせる）', 500, 0, 8000, 10, 'px'), N('h', '高さ（0で幅に合わせる）', 0, 0, 8000, 10, 'px')],
    x: (st, p, c) => {
      const w = num(p.w);
      const h = num(p.h);
      if (c.box.w <= 0 || c.box.h <= 0 || (w <= 0 && h <= 0)) return;
      const kx = w > 0 ? w / c.box.w : h / c.box.h;
      const ky = h > 0 ? h / c.box.h : w / c.box.w;
      st.sx *= kx;
      st.sy *= ky;
    },
  },
  {
    type: 'rot',
    name: '回転',
    cat: 'draw',
    params: [N('angle', '角度', 0, -3600, 3600, 1, '度')],
    x: (st, p) => void (st.rot += num(p.angle)),
  },
  {
    type: 'skew',
    name: '傾斜変形',
    cat: 'draw',
    kw: '斜め',
    params: [N('x', '横の傾き', 15, -85, 85, 1, '度'), N('y', '縦の傾き', 0, -85, 85, 1, '度')],
    x: (st, p) => {
      st.skx += num(p.x);
      st.sky += num(p.y);
    },
  },
  {
    type: 'flip',
    name: '上下左右反転',
    cat: 'draw',
    kw: 'ミラー 鏡',
    params: [B('h', '左右反転', true), B('v', '上下反転')],
    x: (st, p) => {
      if (p.h) st.sx *= -1;
      if (p.v) st.sy *= -1;
    },
  },
  {
    type: 'anchor',
    name: '中心位置',
    cat: 'draw',
    kw: '回転の中心 基準点',
    params: [N('x', 'X', 0, -4000, 4000, 5, 'px'), N('y', 'Y', 0, -4000, 4000, 5, 'px')],
    x: (st, p) => {
      st.ax += num(p.x);
      st.ay += num(p.y);
    },
  },
  {
    type: 'fit',
    name: '画面内に収まるように拡大縮小',
    cat: 'draw',
    params: [S('mode', '合わせ方', 'contain', [['contain', '全体が見える'], ['cover', '画面いっぱい']]), B('center', '画面の中央に置く', true)],
    x: (st, p, c) => {
      if (c.box.w <= 0 || c.box.h <= 0) return;
      const kx = c.W / c.box.w;
      const ky = c.H / c.box.h;
      const k = p.mode === 'cover' ? Math.max(kx, ky) : Math.min(kx, ky);
      st.sx *= k;
      st.sy *= k;
      if (p.center) {
        st.dx += c.W / 2 - (c.box.x + c.box.w / 2);
        st.dy += c.H / 2 - (c.box.y + c.box.h / 2);
      }
    },
  },

  // ---------------- カメラ ----------------
  {
    type: 'camera',
    name: 'カメラ位置',
    cat: 'camera',
    kw: 'パン ズーム',
    params: [N('x', 'X', 0, -4000, 4000, 5, 'px'), N('y', 'Y', 0, -4000, 4000, 5, 'px'), N('zoom', 'ズーム', 100, 10, 1000, 1, '%'), N('rot', '回転', 0, -360, 360, 1, '度')],
    x: (st, p, c) => {
      // 画面の中央を基準に、カメラが動いたように見せる
      const z = num(p.zoom) / 100;
      const cx = c.box.x + c.box.w / 2 - c.W / 2;
      const cy = c.box.y + c.box.h / 2 - c.H / 2;
      const a = (-num(p.rot) * Math.PI) / 180;
      const px = (cx - num(p.x)) * z;
      const py = (cy - num(p.y)) * z;
      st.dx += px * Math.cos(a) - py * Math.sin(a) - cx;
      st.dy += px * Math.sin(a) + py * Math.cos(a) - cy;
      st.sx *= z;
      st.sy *= z;
      st.rot -= num(p.rot);
    },
  },
  {
    type: 'handheld',
    name: '手ぶれカメラ',
    cat: 'camera',
    kw: '手持ち 揺れ',
    params: [N('amount', '揺れの大きさ', 15, 0, 300, 1, 'px'), N('rot', '傾きの揺れ', 1, 0, 30, 0.1, '度'), NF('speed', '速さ', 2, 0.1, 20, 0.1, '回/秒')],
    x: (st, p, c) => {
      const t = c.local * num(p.speed);
      st.dx += num(p.amount) * smoothNoise(t, 0.13);
      st.dy += num(p.amount) * smoothNoise(t, 0.71);
      st.rot += num(p.rot) * smoothNoise(t * 0.7, 0.29);
    },
  },
  {
    type: 'zoomCamera',
    name: '注目カメラ',
    cat: 'camera',
    kw: 'ズームイン 寄る',
    params: [N('zoom', 'ズーム', 150, 100, 800, 1, '%'), N('x', '注目する位置 X', 0, -2000, 2000, 5, 'px'), N('y', '注目する位置 Y', 0, -2000, 2000, 5, 'px')],
    x: (st, p, c) => {
      const z = num(p.zoom) / 100;
      const cx = c.box.x + c.box.w / 2 - c.W / 2;
      const cy = c.box.y + c.box.h / 2 - c.H / 2;
      st.dx += (cx - num(p.x)) * z - cx;
      st.dy += (cy - num(p.y)) * z - cy;
      st.sx *= z;
      st.sy *= z;
    },
  },
];
