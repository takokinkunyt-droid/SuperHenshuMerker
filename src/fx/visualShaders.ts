// 描いた絵そのものを加工する映像エフェクト（加工・装飾・合成・配置と、一部の登場退場・アニメーション）。
// それぞれ `vec4 fx(vec2 uv)` を定義する GLSL で書く。色は「アルファを掛けた状態（premultiplied）」で扱う。
//
// GLSL から使えるもの（glRunner.ts が用意する）：
//   S(uv)      加工前の絵（画面の外は透明）     O(uv)  このエフェクトをかける前の絵（複数回かけるとき用）
//   u_res      キャンバスの大きさ(px)           u_k    プロジェクト座標1あたりのキャンバスのpx数
//   u_t, u_d   アイテム内の時刻・長さ(秒)       u_pass 何回目か      u_seed アイテムごとの乱数の種
//   u_box      アイテムの外枠（x, y, 幅, 高さ。uv 単位）
//   p_名前     設定項目の値（色は vec3、チェックと選択は float）
import { B, C, IO_PARAMS, N, S, ioAmount, type ParamDef } from './params';
import type { VisualDef } from './visualTypes';

const num = (v: unknown) => Number(v) || 0;

const DIRS: [string, string][] = [
  ['left', '左から'],
  ['right', '右から'],
  ['top', '上から'],
  ['bottom', '下から'],
];
/** 方向の選択肢を (x, y) にする */
const dirVec = (d: unknown): [number, number] => (d === 'left' ? [-1, 0] : d === 'right' ? [1, 0] : d === 'top' ? [0, -1] : [0, 1]);

const CENTER: ParamDef[] = [N('cx', '中心 X', 0, -2000, 2000, 5, 'px'), N('cy', '中心 Y', 0, -2000, 2000, 5, 'px')];
/** 外枠の中心＋ずらし量（uv） */
const CENTER_GLSL = 'vec2 ctr(){ return u_box.xy + u_box.zw*0.5 + vec2(p_cx,p_cy)*u_k/u_res; }';

// ---- 共通の GLSL ----

const BLUR = 'vec4 fx(vec2 uv){ return gblur(uv, x_r*u_k, passDir()); }';
const MOSAIC = `vec4 fx(vec2 uv){ float b=max(1.,x_size*u_k); if(b<1.5) return S(uv); vec2 q=(floor(uv*u_res/b)+0.5)*b/u_res; return S(q); }`;
/** 境界ぼかし：ぼかしたアルファで縁を削る（1・2回目でぼかし、3回目で元の絵に掛ける） */
const EDGE_BLUR = `vec4 fx(vec2 uv){ if(u_pass<1.5) return gblur(uv, x_r*u_k, passDir()); float m=clamp((S(uv).a-0.5)*2.,0.,1.); vec4 o=O(uv); float a=min(o.a, m); return o.a>0.? o*(a/o.a) : vec4(0.); }`;
/** かけら（三角形）ごとに飛び散る。x_k が進み具合 */
const SHATTER = `
vec2 cellDisp(vec2 id, float tri){
  vec2 r=vec2(hash(id+tri*7.3+u_seed), hash(id.yx+tri*3.1+u_seed+5.))-0.5;
  vec2 c=u_box.xy+u_box.zw*0.5;
  vec2 cp=(id+0.5)*x_cell/u_res;
  vec2 dir=normalize((cp-c)*u_res+r*40.+vec2(0.001));
  float sp=0.6+hash(id+tri+9.)*0.9;
  return (dir*sp*x_dist + vec2(0., x_grav*x_k))*x_k*u_k/u_res + r*x_k*0.02;
}
vec4 fx(vec2 uv){
  if(x_k<=0.) return S(uv);
  vec2 src=uv; vec2 id=vec2(0.); float tri=0.;
  for(int i=0;i<6;i++){
    vec2 g=src*u_res/x_cell; id=floor(g); vec2 f=fract(g); tri=(f.x+f.y>1.)?1.:0.;
    src=uv-cellDisp(id,tri);
  }
  vec2 g=src*u_res/x_cell; vec2 id2=floor(g); vec2 f=fract(g); float tri2=(f.x+f.y>1.)?1.:0.;
  if(id2!=id||tri2!=tri) return vec4(0.);
  return S(src)*(1.-x_k*x_fade);
}`;

const sh = (type: string, name: string, cat: VisualDef['cat'], params: ParamDef[], glsl: string, extra: Partial<VisualDef> = {}): VisualDef => ({
  type,
  name,
  cat,
  params,
  glsl,
  ...extra,
});

export const SHADER_FX: VisualDef[] = [
  // ======================= 登場退場（絵を加工するもの） =======================
  sh('regionInOut', '領域外から登場退場', 'inout', [S('dir', '方向', 'left', DIRS), ...IO_PARAMS],
    `vec4 fx(vec2 uv){ vec2 b=u_box.xy; vec2 e=u_box.xy+u_box.zw; if(uv.x<b.x||uv.y<b.y||uv.x>e.x||uv.y>e.y) return vec4(0.); return S(uv - x_d*u_box.zw*x_k); }`,
    { u: (p, c) => { const k = ioAmount(p, c.local, c.dur); return k > 0 ? { x_k: k, x_d: dirVec(p.dir) } : null; } }),
  sh('clipInOut', 'クリッピングを解除しながら登場退場', 'inout', [S('dir', '方向', 'left', DIRS), N('soft', '境界のぼかし', 0, 0, 300, 1, 'px'), ...IO_PARAMS],
    `vec4 fx(vec2 uv){ vec2 q=(uv-u_box.xy)/u_box.zw; float t = x_d.x<0.? q.x : x_d.x>0.? 1.-q.x : x_d.y<0.? q.y : 1.-q.y;
      float len = (x_d.x!=0.? u_box.z*u_res.x : u_box.w*u_res.y); float s=max(p_soft*u_k/len, 0.0001);
      float edge=(1.-x_k)*(1.+s); float m=1.-smoothstep(edge-s, edge, t); return S(uv)*m; }`,
    { kw: 'ワイプ wipe', u: (p, c) => { const k = ioAmount(p, c.local, c.dur); return k > 0 ? { x_k: k, x_d: dirVec(p.dir) } : null; } }),
  sh('blurInOut', 'ぼかしを解除しながら登場退場', 'inout', [N('r', 'ぼかし', 30, 0, 200, 1, 'px'), ...IO_PARAMS], BLUR,
    { passes: 2, u: (p, c) => { const k = ioAmount(p, c.local, c.dur); return k > 0 ? { x_r: num(p.r) * k } : null; } }),
  sh('mosaicInOut', 'モザイクを解除しながら登場退場', 'inout', [N('size', 'マスの大きさ', 60, 1, 300, 1, 'px'), ...IO_PARAMS], MOSAIC,
    { u: (p, c) => { const k = ioAmount(p, c.local, c.dur); return k > 0 ? { x_size: num(p.size) * k } : null; } }),
  sh('edgeBlurInOut', '境界ぼかしを解除しながら登場退場', 'inout', [N('r', 'ぼかし', 60, 0, 300, 1, 'px'), ...IO_PARAMS], EDGE_BLUR,
    { passes: 3, u: (p, c) => { const k = ioAmount(p, c.local, c.dur); return k > 0 ? { x_r: num(p.r) * k } : null; } }),
  sh('shatterInOut', '砕け散りながら登場退場', 'inout',
    [N('cell', 'かけらの大きさ', 60, 8, 400, 1, 'px'), N('dist', '飛ぶ距離', 600, 0, 3000, 10, 'px'), N('grav', '落ちる量', 300, -2000, 2000, 10, 'px'), ...IO_PARAMS], SHATTER,
    { u: (p, c) => { const k = ioAmount(p, c.local, c.dur); return k > 0 ? { x_k: k, x_cell: Math.max(4, num(p.cell)), x_dist: num(p.dist), x_grav: num(p.grav), x_fade: 1 } : null; } }),
  sh('pageTurnInOut', 'ページをめくりながら登場退場', 'inout', IO_PARAMS,
    `vec4 fx(vec2 uv){ float xf=u_box.x+u_box.z*(1.-x_k); if(uv.x>xf+0.0001) return vec4(0.); vec4 base=S(uv);
      float wf=u_box.x+u_box.z-xf; float d=xf-uv.x; if(d<wf){ vec4 fl=S(vec2(xf+d, uv.y)); float shade=0.55+0.45*(d/max(wf,0.0001));
        vec4 back=vec4(mix(fl.rgb, vec3(fl.a), 0.55)*shade, fl.a); base=back+base*(1.-back.a); }
      return base; }`,
    { kw: 'ページめくり', u: (p, c) => { const k = ioAmount(p, c.local, c.dur); return k > 0 ? { x_k: k } : null; } }),
  sh('reelInOut', 'リール回転しながら登場退場', 'inout', [N('n', '回る回数', 4, 1, 30, 1, '回'), ...IO_PARAMS],
    `vec4 fx(vec2 uv){ vec2 b=u_box.xy; vec2 e=b+u_box.zw; if(uv.x<b.x||uv.y<b.y||uv.x>e.x||uv.y>e.y) return vec4(0.);
      float y=b.y+mod(uv.y-b.y+x_k*p_n*u_box.w, u_box.w); vec4 a=vec4(0.); float bl=x_k*0.08*u_box.w;
      for(int i=-4;i<=4;i++){ float yy=b.y+mod(y-b.y+float(i)/4.*bl, u_box.w); a+=S(vec2(uv.x,yy)); } return a/9.; }`,
    { kw: 'スロット', u: (p, c) => { const k = ioAmount(p, c.local, c.dur); return k > 0 ? { x_k: k } : null; } }),

  // ======================= アニメーション（絵を加工するもの） =======================
  sh('wave', '波打ち', 'anim', [N('amp', '揺れ幅', 20, 0, 500, 1, 'px'), N('len', '波の長さ', 200, 5, 3000, 5, 'px'), N('speed', '速さ', 1, -20, 20, 0.1, '回/秒'), S('dir', '向き', 'h', [['h', '横に揺れる'], ['v', '縦に揺れる']])],
    `vec4 fx(vec2 uv){ vec2 px=uv*u_res; float ph=u_t*p_speed*6.2831853; vec2 q=uv;
      if(p_dir<0.5) q.x+=sin(px.y/(p_len*u_k)*6.2831853+ph)*p_amp*u_k/u_res.x; else q.y+=sin(px.x/(p_len*u_k)*6.2831853+ph)*p_amp*u_k/u_res.y; return S(q); }`,
    { kw: 'ウェーブ ゆらゆら' }),
  sh('ripple', '波紋', 'anim', [N('amp', '揺れ幅', 15, 0, 300, 1, 'px'), N('len', '波の長さ', 120, 5, 2000, 5, 'px'), N('speed', '速さ', 1, -20, 20, 0.1, '回/秒'), ...CENTER],
    `${CENTER_GLSL}
    vec4 fx(vec2 uv){ vec2 d=(uv-ctr())*u_res; float r=length(d); if(r<0.001) return S(uv); float o=sin(r/(p_len*u_k)*6.2831853-u_t*p_speed*6.2831853)*p_amp*u_k; return S(uv+normalize(d)*o/u_res); }`),
  sh('shatter', '砕け散る', 'anim',
    [N('k', '進み具合', 50, 0, 100, 1, '%'), N('cell', 'かけらの大きさ', 60, 8, 400, 1, 'px'), N('dist', '飛ぶ距離', 600, 0, 3000, 10, 'px'), N('grav', '落ちる量', 300, -2000, 2000, 10, 'px')], SHATTER,
    { u: (p) => (num(p.k) > 0 ? { x_k: num(p.k) / 100, x_cell: Math.max(4, num(p.cell)), x_dist: num(p.dist), x_grav: num(p.grav), x_fade: 0 } : null) }),
  sh('particle', '粒子化', 'anim', [N('k', '進み具合', 50, 0, 100, 1, '%'), N('cell', '粒の大きさ', 8, 2, 100, 1, 'px'), N('dist', '飛ぶ距離', 400, 0, 3000, 10, 'px')], SHATTER,
    { kw: '粒 ちりになる', u: (p) => (num(p.k) > 0 ? { x_k: num(p.k) / 100, x_cell: Math.max(2, num(p.cell)), x_dist: num(p.dist), x_grav: -80, x_fade: 1 } : null) }),

  // ======================= 描画（絵を加工するもの） =======================
  sh('rot3d', '3D回転', 'draw', [N('rx', 'X軸', 0, -720, 720, 1, '度'), N('ry', 'Y軸', 45, -720, 720, 1, '度'), N('rz', 'Z軸', 0, -720, 720, 1, '度'), N('persp', '遠近感', 50, 0, 100, 1, '%')],
    `mat3 rotm(vec3 a){ vec3 c=cos(a), s=sin(a);
      mat3 X=mat3(1.,0.,0., 0.,c.x,s.x, 0.,-s.x,c.x); mat3 Y=mat3(c.y,0.,-s.y, 0.,1.,0., s.y,0.,c.y); mat3 Z=mat3(c.z,s.z,0., -s.z,c.z,0., 0.,0.,1.); return Z*Y*X; }
    vec4 fx(vec2 uv){ vec2 c=(u_box.xy+u_box.zw*0.5)*u_res; vec2 q=uv*u_res-c; mat3 R=rotm(radians(vec3(p_rx,p_ry,p_rz)));
      float f=max(u_res.x,u_res.y)*mix(40., 0.9, p_persp/100.); vec3 n=R*vec3(0.,0.,1.); vec3 eye=vec3(0.,0.,-f); vec3 dir=vec3(q, f);
      float den=dot(n,dir); if(abs(den)<1e-5) return vec4(0.); float t=-dot(n,eye)/den; if(t<=0.) return vec4(0.);
      vec3 P=eye+t*dir; vec3 pl=transpose(R)*P; return S((pl.xy+c)/u_res); }`,
    { kw: '立体 奥行き', u: (p) => (num(p.rx) % 360 === 0 && num(p.ry) % 360 === 0 && num(p.rz) % 360 === 0 ? null : {}) }),
  sh('tile', '敷き詰め', 'draw', [N('nx', '横の数', 3, 1, 30, 1, '個'), N('ny', '縦の数', 3, 1, 30, 1, '個'), N('gx', '横のすき間', 0, -1000, 2000, 5, 'px'), N('gy', '縦のすき間', 0, -1000, 2000, 5, 'px')],
    `vec4 fx(vec2 uv){ vec2 cell=u_box.zw+vec2(p_gx,p_gy)*u_k/u_res; vec2 n=floor(vec2(p_nx,p_ny)+0.5); vec2 c=u_box.xy+u_box.zw*0.5;
      vec2 rel=(uv-c)/cell + n*0.5; vec2 id=floor(rel); if(id.x<0.||id.y<0.||id.x>=n.x||id.y>=n.y) return vec4(0.);
      vec2 f=(fract(rel)-0.5)*cell; if(abs(f.x)>u_box.z*0.5||abs(f.y)>u_box.w*0.5) return vec4(0.); return S(c+f); }`,
    { kw: 'タイル 並べる 複製' }),
  sh('mirror', '複製して反転', 'draw', [S('dir', '向き', 'down', [['down', '下に映す'], ['right', '右に映す'], ['up', '上に映す'], ['left', '左に映す']]), N('gap', 'すき間', 0, -500, 1000, 1, 'px'), N('op', '映った絵の濃さ', 50, 0, 100, 1, '%'), B('fade', 'だんだん薄くする', true)],
    `vec4 fx(vec2 uv){ vec4 a=S(uv); vec2 b=u_box.xy; vec2 e=b+u_box.zw; vec2 g=vec2(p_gap)*u_k/u_res; vec2 q=uv; float t=0.;
      if(p_dir<0.5){ q.y=2.*e.y+g.y-uv.y; t=(uv.y-e.y-g.y)/u_box.w; } else if(p_dir<1.5){ q.x=2.*e.x+g.x-uv.x; t=(uv.x-e.x-g.x)/u_box.z; }
      else if(p_dir<2.5){ q.y=2.*b.y-g.y-uv.y; t=(b.y-g.y-uv.y)/u_box.w; } else { q.x=2.*b.x-g.x-uv.x; t=(b.x-g.x-uv.x)/u_box.z; }
      if(t<0.||t>1.) return a; vec4 m=S(q)*(p_op/100.)*(p_fade>0.5? 1.-t : 1.); return a+m*(1.-a.a); }`,
    { kw: 'ミラー 反射 水面' }),
  sh('polar', '極座標変換', 'draw', [B('inv', '逆変換（円を帯にする）'), N('rot', '回転', 0, -360, 360, 1, '度')],
    `vec4 fx(vec2 uv){ vec2 c=u_box.xy+u_box.zw*0.5; vec2 d=(uv-c)*u_res; float R=min(u_box.z*u_res.x,u_box.w*u_res.y)*0.5;
      if(p_inv<0.5){ float r=length(d)/R; if(r>1.) return vec4(0.); float a=atan(d.y,d.x)/6.2831853+0.5+p_rot/360.; return S(u_box.xy+vec2(fract(a), 1.-r)*u_box.zw); }
      vec2 q=(uv-u_box.xy)/u_box.zw; if(q.x<0.||q.y<0.||q.x>1.||q.y>1.) return vec4(0.); float a=(q.x-0.5+p_rot/360.)*6.2831853; float r=(1.-q.y)*R; return S(c+vec2(cos(a),sin(a))*r/u_res); }`),

  // ======================= 加工 =======================
  sh('blur', 'ぼかし', 'filter', [N('r', 'ぼかし', 10, 0, 200, 1, 'px')], BLUR, { kw: 'ガウス', passes: 2, u: (p) => (num(p.r) > 0 ? { x_r: num(p.r) } : null) }),
  sh('dirBlur', '方向ブラー', 'filter', [N('len', '長さ', 40, 0, 600, 1, 'px'), N('angle', '角度', 0, -180, 180, 1, '度')],
    `vec4 fx(vec2 uv){ float a=radians(p_angle); vec2 d=vec2(cos(a),sin(a))*p_len*u_k/u_res; vec4 s=vec4(0.); for(int i=-16;i<=16;i++) s+=S(uv+d*float(i)/32.); return s/33.; }`,
    { kw: 'モーションブラー 残像' }),
  sh('radialBlur', '放射ブラー', 'filter', [N('amt', '強さ', 20, 0, 100, 1, '%'), ...CENTER],
    `${CENTER_GLSL}
    vec4 fx(vec2 uv){ vec2 c=ctr(); vec4 s=vec4(0.); for(int i=0;i<32;i++){ float k=1.-p_amt/100.*float(i)/31.; s+=S(c+(uv-c)*k); } return s/32.; }`,
    { kw: 'ズームブラー 集中' }),
  sh('spinBlur', '回転ブラー', 'filter', [N('angle', '角度', 15, 0, 360, 1, '度'), ...CENTER],
    `${CENTER_GLSL}
    vec4 fx(vec2 uv){ vec2 c=ctr()*u_res; vec2 d=uv*u_res-c; vec4 s=vec4(0.); for(int i=-12;i<=12;i++){ float a=radians(p_angle)*float(i)/24.; float cs=cos(a), sn=sin(a); s+=S((c+vec2(d.x*cs-d.y*sn, d.x*sn+d.y*cs))/u_res); } return s/25.; }`),
  sh('edgeBlur', '境界ぼかし', 'filter', [N('r', 'ぼかし', 30, 0, 300, 1, 'px')], EDGE_BLUR, { kw: 'ふち フェザー', passes: 3, u: (p) => (num(p.r) > 0 ? { x_r: num(p.r) } : null) }),
  sh('sharpen', 'シャープ化', 'filter', [N('amt', '強さ', 100, 0, 500, 5, '%'), N('r', '半径', 1, 0.5, 10, 0.5, 'px')],
    `vec4 fx(vec2 uv){ vec2 d=p_r*u_k/u_res; vec4 c=S(uv); vec4 b=(S(uv+vec2(d.x,0.))+S(uv-vec2(d.x,0.))+S(uv+vec2(0.,d.y))+S(uv-vec2(0.,d.y)))*0.25; vec4 o=c+(c-b)*p_amt/100.; o.a=c.a; o.rgb=clamp(o.rgb,0.,c.a); return o; }`,
    { kw: 'くっきり' }),
  sh('mosaic', 'モザイク', 'filter', [N('size', 'マスの大きさ', 20, 1, 300, 1, 'px')], MOSAIC, { kw: 'ピクセル化 ドット絵', u: (p) => ({ x_size: num(p.size) }) }),
  sh('noise', 'ノイズ', 'filter', [N('amt', '強さ', 30, 0, 100, 1, '%'), B('color', '色つき'), N('speed', '変わる速さ', 30, 0, 60, 1, '回/秒'), N('size', '粒の大きさ', 1, 1, 50, 1, 'px')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); if(c.a<=0.) return c; vec2 q=floor(uv*u_res/max(1.,p_size*u_k)); float t=floor(u_t*p_speed);
      vec3 n=vec3(hash(q+t*1.3)); if(p_color>0.5) n=vec3(n.r, hash(q+t*1.3+17.), hash(q+t*1.3+31.)); vec3 r=un(c)+(n-0.5)*p_amt/50.; return pm(clamp(r,0.,1.), c.a); }`,
    { kw: 'ざらざら グレイン 砂嵐' }),
  sh('noiseShift', 'ノイズ色ずれ', 'filter', [N('amt', 'ずれる量', 30, 0, 500, 1, 'px'), N('size', '帯の太さ', 12, 1, 300, 1, 'px'), N('speed', '変わる速さ', 12, 0, 60, 1, '回/秒'), N('rate', '起きる割合', 40, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ float row=floor(uv.y*u_res.y/max(1.,p_size*u_k)); float t=floor(u_t*p_speed); float h=hash(vec2(row, t+u_seed*91.));
      float o=h<p_rate/100.? (hash(vec2(row+5., t))-0.5)*2.*p_amt*u_k/u_res.x : 0.; vec4 r=S(uv+vec2(o,0.)), g=S(uv), b=S(uv-vec2(o,0.)); return vec4(r.r,g.g,b.b,max(g.a,max(r.a,b.a))); }`),
  sh('noiseWarp', 'ノイズ歪み', 'filter', [N('amt', 'ゆがむ量', 20, 0, 500, 1, 'px'), N('size', '模様の大きさ', 100, 2, 2000, 2, 'px'), N('speed', '速さ', 1, 0, 20, 0.1)],
    `vec4 fx(vec2 uv){ vec2 q=uv*u_res/(p_size*u_k); vec2 o=vec2(vnoise(q+vec2(u_t*p_speed, 3.7)), vnoise(q+vec2(11.3, u_t*p_speed)))-0.5; return S(uv+o*2.*p_amt*u_k/u_res); }`,
    { kw: 'ゆがみ' }),
  sh('chromAb', '色ズレ', 'filter', [N('amt', 'ずれる量', 8, 0, 300, 1, 'px'), N('angle', '角度', 0, -180, 180, 1, '度')],
    `vec4 fx(vec2 uv){ float a=radians(p_angle); vec2 d=vec2(cos(a),sin(a))*p_amt*u_k/u_res; vec4 r=S(uv+d), g=S(uv), b=S(uv-d); return vec4(r.r,g.g,b.b,max(g.a,max(r.a,b.a))); }`,
    { kw: '色収差 RGBずれ' }),
  sh('colorAdj', '色調補正', 'filter', [N('bri', '明るさ', 0, -100, 100, 1), N('con', 'コントラスト', 0, -100, 100, 1), N('sat', '彩度', 0, -100, 100, 1), N('hue', '色相', 0, -180, 180, 1, '度')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); if(c.a<=0.) return c; vec3 r=un(c); r+=p_bri/100.; r=(r-0.5)*(1.+p_con/100.)*(p_con>0.? 1.+p_con/100. : 1.)+0.5;
      vec3 h=rgb2hsv(clamp(r,0.,1.)); h.x=fract(h.x+p_hue/360.); h.y=clamp(h.y*(1.+p_sat/100.),0.,1.); return pm(hsv2rgb(h), c.a); }`,
    { kw: '明るさ コントラスト 彩度 色相' }),
  sh('invert', '色反転', 'filter', [N('amt', '強さ', 100, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec3 r=un(c); return pm(mix(r, 1.-r, p_amt/100.), c.a); }`, { kw: 'ネガ' }),
  sh('mono', '単色化', 'filter', [C('col', '色', '#ff8800'), N('amt', '強さ', 100, 0, 100, 1, '%'), B('keep', '明るさを残す', true)],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec3 r=un(c); vec3 t=p_keep>0.5? p_col*luma(r)*1.6 : p_col; return pm(mix(r, clamp(t,0.,1.), p_amt/100.), c.a); }`, { kw: 'カラー化 色をつける' }),
  sh('gray', 'モノクロ', 'filter', [N('amt', '強さ', 100, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec3 r=un(c); return pm(mix(r, vec3(luma(r)), p_amt/100.), c.a); }`, { kw: 'グレースケール 白黒' }),
  sh('sepia', 'セピア', 'filter', [N('amt', '強さ', 100, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec3 r=un(c); vec3 s=vec3(dot(r,vec3(.393,.769,.189)), dot(r,vec3(.349,.686,.168)), dot(r,vec3(.272,.534,.131))); return pm(mix(r, min(s,1.), p_amt/100.), c.a); }`, { kw: '古い写真' }),
  sh('threshold', '二値化', 'filter', [N('th', 'しきい値', 50, 0, 100, 1, '%'), C('c1', '暗い部分の色', '#000000'), C('c2', '明るい部分の色', '#ffffff')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); return pm(luma(un(c))>p_th/100.? p_c2 : p_c1, c.a); }`, { kw: '白黒 2値' }),
  sh('poster', '階調化', 'filter', [N('n', '色の段階', 4, 2, 32, 1, '段')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); float n=max(2.,p_n); return pm(floor(un(c)*n)/(n-1.), c.a); }`, { kw: 'ポスタリゼーション ポスター' }),
  sh('gamma', 'ガンマ補正', 'filter', [N('g', 'ガンマ', 1.5, 0.1, 5, 0.05)],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); return pm(pow(un(c), vec3(1./max(0.01,p_g))), c.a); }`),
  sh('levels', 'レベル補正', 'filter', [N('black', '黒の位置', 0, 0, 100, 1, '%'), N('white', '白の位置', 100, 0, 100, 1, '%'), N('g', '中間の明るさ', 1, 0.1, 5, 0.05)],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec3 r=clamp((un(c)-p_black/100.)/max(0.001,(p_white-p_black)/100.),0.,1.); return pm(pow(r, vec3(1./max(0.01,p_g))), c.a); }`),
  sh('temp', '色温度', 'filter', [N('t', '暖かさ', 30, -100, 100, 1), N('tint', '緑 ↔ 赤紫', 0, -100, 100, 1)],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec3 r=un(c); r.r+=p_t/400.; r.b-=p_t/400.; r.g-=p_tint/500.; r.r+=p_tint/1000.; r.b+=p_tint/1000.; return pm(clamp(r,0.,1.), c.a); }`, { kw: '暖色 寒色 ホワイトバランス' }),
  sh('tritone', 'トライトーン', 'filter', [C('c1', '暗い部分', '#1b1464'), C('c2', '中間', '#e84393'), C('c3', '明るい部分', '#fff9c4'), N('amt', '強さ', 100, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec3 r=un(c); float l=luma(r); vec3 t=l<0.5? mix(p_c1,p_c2,l*2.) : mix(p_c2,p_c3,(l-0.5)*2.); return pm(mix(r,t,p_amt/100.), c.a); }`, { kw: 'グラデーションマップ 3色' }),
  sh('colorBlind', '色覚異常', 'filter', [S('type', '種類', 'p', [['p', 'P型（1型）'], ['d', 'D型（2型）'], ['t', 'T型（3型）']]), N('amt', '強さ', 100, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec3 r=un(c); mat3 m = p_type<0.5? mat3(.567,.558,0., .433,.442,.242, 0.,0.,.758) : p_type<1.5? mat3(.625,.7,0., .375,.3,.3, 0.,0.,.7) : mat3(.95,0.,0., .05,.433,.475, 0.,.567,.525);
      return pm(mix(r, clamp(m*r,0.,1.), p_amt/100.), c.a); }`, { kw: '色覚シミュレーション' }),
  sh('abstract', '抽象化', 'filter', [N('r', '筆の太さ', 4, 1, 6, 1, 'px')],
    `vec4 fx(vec2 uv){ vec2 px=u_k/u_res*1.5; float r=floor(p_r+0.5); vec4 best=S(uv); float bv=1e9;
      for(int q=0;q<4;q++){ vec2 sg=vec2(q==0||q==2? -1.:1., q<2? -1.:1.); vec4 m=vec4(0.); vec3 m2=vec3(0.); float n=0.;
        for(int i=0;i<=6;i++){ for(int j=0;j<=6;j++){ if(float(i)>r||float(j)>r) continue; vec4 s=S(uv+vec2(float(i),float(j))*sg*px); m+=s; m2+=s.rgb*s.rgb; n+=1.; } }
        m/=n; vec3 v=m2/n-m.rgb*m.rgb; float var=v.r+v.g+v.b; if(var<bv){ bv=var; best=m; } }
      return best; }`, { kw: '油絵 絵画風 水彩' }),
  sh('hatch', 'クロスハッチ陰影', 'filter', [N('size', '線の間隔', 8, 3, 60, 1, 'px'), C('ink', '線の色', '#000000'), C('paper', '紙の色', '#ffffff')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); float l=luma(un(c)); vec2 px=uv*u_res; float sp=max(3.,p_size*u_k); float w=max(1.,sp*0.18); float k=0.;
      if(l<0.8 && mod(px.x+px.y, sp)<w) k=1.; if(l<0.6 && mod(px.x-px.y+sp*100., sp)<w) k=1.; if(l<0.4 && mod(px.x+px.y+sp*0.5, sp)<w) k=1.; if(l<0.2 && mod(px.x-px.y+sp*100.5, sp)<w) k=1.;
      return pm(mix(p_paper, p_ink, k), c.a); }`, { kw: 'スケッチ 鉛筆 漫画' }),
  sh('edge', '輪郭抽出', 'filter', [N('amt', '強さ', 200, 0, 1000, 10, '%'), C('line', '線の色', '#ffffff'), C('bg', '地の色', '#000000'), B('trans', '地を透明にする')],
    `float lm(vec2 uv){ vec4 c=S(uv); return luma(c.rgb)+c.a*0.5; }
    vec4 fx(vec2 uv){ vec2 d=u_k/u_res; float gx=lm(uv+vec2(d.x,-d.y))+2.*lm(uv+vec2(d.x,0.))+lm(uv+d)-lm(uv+vec2(-d.x,-d.y))-2.*lm(uv-vec2(d.x,0.))-lm(uv+vec2(-d.x,d.y));
      float gy=lm(uv+vec2(-d.x,d.y))+2.*lm(uv+vec2(0.,d.y))+lm(uv+d)-lm(uv-d)-2.*lm(uv-vec2(0.,d.y))-lm(uv+vec2(d.x,-d.y));
      float e=clamp(length(vec2(gx,gy))*p_amt/100.,0.,1.); float a=S(uv).a; if(p_trans>0.5) return vec4(p_line*e, e); float al=max(a,e); return pm(mix(p_bg,p_line,e), al); }`, { kw: 'エッジ 線画' }),
  sh('emboss', 'エンボス', 'filter', [N('amt', '強さ', 100, 0, 500, 5, '%'), N('angle', '光の向き', 135, -180, 180, 1, '度')],
    `vec4 fx(vec2 uv){ float a=radians(p_angle); vec2 d=vec2(cos(a),sin(a))*1.5*u_k/u_res; vec4 c=S(uv); float e=(luma(S(uv+d).rgb)-luma(S(uv-d).rgb))*p_amt/100.; return pm(clamp(vec3(0.5+e),0.,1.), c.a); }`, { kw: '浮き彫り' }),
  sh('round', '角丸め', 'filter', [N('r', '丸み', 40, 0, 2000, 1, 'px')],
    `vec4 fx(vec2 uv){ vec2 h=u_box.zw*u_res*0.5; vec2 q=abs((uv-u_box.xy-u_box.zw*0.5)*u_res); float r=min(p_r*u_k, min(h.x,h.y)); float d=length(max(q-h+r,0.))-r; return S(uv)*clamp(0.5-d,0.,1.); }`, { kw: '角丸 丸くする' }),
  sh('fog', '霧', 'filter', [N('amt', '濃さ', 60, 0, 100, 1, '%'), C('col', '色', '#ffffff'), N('size', '模様の大きさ', 300, 10, 3000, 10, 'px'), N('speed', '流れる速さ', 0.3, -5, 5, 0.05), B('all', 'アイテムの外にもかける')],
    `float fbm(vec2 p){ float a=0.5, s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.+7.3; a*=0.5; } return s; }
    vec4 fx(vec2 uv){ vec4 c=S(uv); float f=fbm(uv*u_res/(p_size*u_k)+vec2(u_t*p_speed,0.))*p_amt/100.*1.6; f=clamp(f,0.,1.); float m=p_all>0.5? 1. : c.a; vec4 fg=vec4(p_col*f*m, f*m); return fg+c*(1.-fg.a); }`, { kw: 'もや 煙 スモーク' }),
  sh('heat', '熱揺らぎ', 'filter', [N('amp', 'ゆらぎの量', 6, 0, 100, 1, 'px'), N('size', 'ゆらぎの細かさ', 60, 5, 1000, 5, 'px'), N('speed', '速さ', 2, 0, 20, 0.1)],
    `vec4 fx(vec2 uv){ vec2 q=uv*u_res/(p_size*u_k); float n=vnoise(vec2(q.x*0.6, q.y-u_t*p_speed)); float o=sin(q.y*3.+u_t*p_speed*4.+n*6.2831853)*p_amp*u_k/u_res.x; return S(uv+vec2(o, 0.)); }`, { kw: '陽炎 かげろう' }),
  sh('rays', '放射光', 'filter', [N('amt', '強さ', 100, 0, 400, 5, '%'), N('len', '長さ', 40, 0, 100, 1, '%'), ...CENTER],
    `${CENTER_GLSL}
    vec4 fx(vec2 uv){ vec2 c=ctr(); vec4 s=vec4(0.); float w=0.; for(int i=0;i<40;i++){ float f=float(i)/39.; float k=1.-p_len/100.*f; float g=1.-f; s+=S(c+(uv-c)*k)*g; w+=g; } vec4 o=S(uv); vec4 r=s/w*p_amt/100.; return o+r*(1.-o.a*0.5); }`, { kw: '光 輝き' }),
  sh('godray', 'ゴッドレイ', 'filter', [N('amt', '強さ', 150, 0, 600, 5, '%'), N('len', '長さ', 60, 0, 100, 1, '%'), N('th', '光る明るさ', 60, 0, 100, 1, '%'), C('col', '光の色', '#fff2c8'), ...CENTER],
    `${CENTER_GLSL}
    vec4 fx(vec2 uv){ vec2 c=ctr(); float s=0.; float w=0.; for(int i=0;i<48;i++){ float f=float(i)/47.; float k=1.-p_len/100.*f; vec4 q=S(c+(uv-c)*k); float g=1.-f; s+=smoothstep(p_th/100., 1., luma(q.rgb))*g; w+=g; }
      vec4 o=S(uv); float r=clamp(s/w*p_amt/100.,0.,1.); return vec4(min(o.rgb+p_col*r, 1.), max(o.a, r)); }`, { kw: '光芒 薄明光線 天使のはしご' }),
  sh('streak', '光条', 'filter', [N('len', '長さ', 200, 0, 2000, 5, 'px'), N('angle', '角度', 0, -180, 180, 1, '度'), N('th', '光る明るさ', 70, 0, 100, 1, '%'), N('amt', '強さ', 150, 0, 600, 5, '%'), B('cross', '十字にする')],
    `vec3 stk(vec2 uv, vec2 d){ vec3 s=vec3(0.); for(int i=-20;i<=20;i++){ float f=float(i)/20.; vec4 q=S(uv+d*f); s+=q.rgb*smoothstep(p_th/100.,1.,luma(q.rgb))*(1.-abs(f)); } return s/20.; }
    vec4 fx(vec2 uv){ float a=radians(p_angle); vec2 d=vec2(cos(a),sin(a))*p_len*u_k/u_res; vec3 s=stk(uv,d); if(p_cross>0.5) s+=stk(uv, vec2(-d.y*u_res.y/u_res.x, d.x*u_res.x/u_res.y));
      vec4 o=S(uv); vec3 r=s*p_amt/100.; return vec4(min(o.rgb+r,1.), max(o.a, clamp(luma(r)*1.5,0.,1.))); }`, { kw: 'クロスフィルター キラキラ レンズフレア' }),
  sh('vignette', '周辺減光', 'filter', [N('amt', '強さ', 70, 0, 100, 1, '%'), N('r', '明るい範囲', 60, 0, 150, 1, '%'), N('soft', 'ぼかし', 50, 1, 100, 1, '%'), C('col', '色', '#000000')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec2 q=(uv-u_box.xy-u_box.zw*0.5)/(u_box.zw*0.5); float d=length(q)/1.4142; float v=smoothstep(p_r/100.*0.7, p_r/100.*0.7+p_soft/100., d)*p_amt/100.; return pm(mix(un(c), p_col, v), c.a); }`, { kw: 'ビネット 四隅を暗く' }),
  sh('glitch', 'グリッチ', 'filter', [N('amt', '強さ', 50, 0, 100, 1, '%'), N('speed', '変わる速さ', 12, 1, 60, 1, '回/秒'), N('size', '帯の太さ', 40, 2, 400, 1, 'px')],
    `vec4 fx(vec2 uv){ float t=floor(u_t*p_speed)+u_seed*31.; float k=p_amt/100.; float row=floor(uv.y*u_res.y/(p_size*u_k*(0.3+hash(vec2(t,1.))*1.4)));
      float h=hash(vec2(row,t)); float o=h<k*0.6? (hash(vec2(row+3.,t))-0.5)*0.3*k : 0.; float cs=(hash(vec2(t,7.))-0.5)*0.02*k;
      vec2 q=uv+vec2(o,0.); vec4 r=S(q+vec2(cs,0.)), g=S(q), b=S(q-vec2(cs,0.)); vec4 c=vec4(r.r,g.g,b.b,max(g.a,max(r.a,b.a)));
      vec2 bl=floor(uv*u_res/(p_size*u_k*2.)); if(hash(bl+t)<k*0.06) c.rgb=c.a-c.rgb; return c; }`, { kw: 'バグ 壊れた映像 デジタルノイズ' }),
  sh('scanline', '走査線', 'filter', [N('size', '線の間隔', 6, 2, 100, 1, 'px'), N('amt', '濃さ', 40, 0, 100, 1, '%'), N('speed', '流れる速さ', 0, -500, 500, 5, 'px/秒')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); float sp=max(2.,p_size*u_k); float y=uv.y*u_res.y+u_t*p_speed*u_k; float l=step(0.5, fract(y/sp)); return pm(un(c)*(1.-l*p_amt/100.), c.a); }`, { kw: 'ブラウン管 スキャンライン テレビ' }),
  sh('vhs', 'VHS風', 'filter', [N('amt', '強さ', 60, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ float k=p_amt/100.; float t=u_t; float j=(vnoise(vec2(uv.y*u_res.y/(40.*u_k), t*8.))-0.5)*0.006*k; float band=fract(uv.y*1.3-t*0.23);
      j+=smoothstep(0.96,1.,band)*0.03*k*(hash(vec2(floor(t*30.),2.))-0.3); vec2 q=uv+vec2(j,0.); float cs=0.004*k;
      vec4 r=S(q+vec2(cs,0.)), g=S(q), b=S(q-vec2(cs,0.)); vec4 c=vec4(r.r,g.g,b.b,max(g.a,max(r.a,b.a))); vec3 u=un(c);
      u=mix(u, vec3(luma(u)), 0.25*k); u+= (hash(uv*u_res+floor(t*30.))-0.5)*0.12*k; u*=1.-0.15*k*step(0.5,fract(uv.y*u_res.y/(3.*u_k)));
      return pm(clamp(u,0.,1.), c.a); }`, { kw: 'ビデオテープ レトロ 昔のビデオ' }),
  sh('oldFilm', '古いフィルム', 'filter', [N('amt', '強さ', 70, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ float k=p_amt/100.; vec4 c=S(uv); if(c.a<=0.) return c; vec3 r=un(c); float t=floor(u_t*18.);
      vec3 s=vec3(dot(r,vec3(.393,.769,.189)), dot(r,vec3(.349,.686,.168)), dot(r,vec3(.272,.534,.131))); r=mix(r,min(s,1.),k);
      r+=(hash(uv*u_res+t)-0.5)*0.18*k; r*=1.-0.12*k*hash(vec2(t,3.));
      float sx=hash(vec2(t,11.)); float sc=1.-smoothstep(0.,0.0015,abs(uv.x-sx)); r+=sc*0.35*k*step(0.6,hash(vec2(t,5.)));
      vec2 q=(uv-u_box.xy-u_box.zw*0.5)/(u_box.zw*0.5); r*=1.-0.5*k*smoothstep(0.5,1.5,length(q)); return pm(clamp(r,0.,1.), c.a); }`, { kw: '映写機 レトロ 8ミリ' }),
  sh('fisheye', 'レンズ歪み', 'filter', [N('amt', '強さ', 50, -100, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec2 c=u_box.xy+u_box.zw*0.5; vec2 h=u_box.zw*0.5; vec2 q=(uv-c)/h; float r2=dot(q,q); float k=p_amt/100.; vec2 w=q*(1.+k*0.5*(r2-1.)*(k>0.?1.:0.6)); if(k<0.) w=q*(1.-k*0.5*r2); return S(c+w*h); }`, { kw: '魚眼 たる型 糸巻き' }),
  sh('swirl', '渦巻き', 'filter', [N('angle', 'ねじる角度', 180, -1440, 1440, 5, '度'), N('r', '範囲', 100, 1, 300, 1, '%'), ...CENTER],
    `${CENTER_GLSL}
    vec4 fx(vec2 uv){ vec2 c=ctr()*u_res; vec2 d=uv*u_res-c; float R=min(u_box.z*u_res.x,u_box.w*u_res.y)*0.5*p_r/100.; float f=clamp(1.-length(d)/R,0.,1.); float a=radians(p_angle)*f*f; float cs=cos(a), sn=sin(a); return S((c+vec2(d.x*cs-d.y*sn, d.x*sn+d.y*cs))/u_res); }`, { kw: 'うず ツイスト' }),
  sh('bulge', '膨張・収縮', 'filter', [N('amt', '強さ', 50, -100, 100, 1, '%'), N('r', '範囲', 100, 1, 300, 1, '%'), ...CENTER],
    `${CENTER_GLSL}
    vec4 fx(vec2 uv){ vec2 c=ctr()*u_res; vec2 d=uv*u_res-c; float R=min(u_box.z*u_res.x,u_box.w*u_res.y)*0.5*p_r/100.; float l=length(d)/R; if(l>=1.) return S(uv); float k=p_amt/100.; float f=k>0.? pow(l, 1.+k*1.5)/max(l,1e-4) : pow(l, 1./(1.-k*1.5))/max(l,1e-4); return S((c+d*f)/u_res); }`, { kw: 'ふくらむ へこむ' }),
  sh('halftone', '網点化', 'filter', [N('size', '点の間隔', 12, 3, 100, 1, 'px'), N('angle', '角度', 45, -90, 90, 1, '度'), B('mono', '黒い点にする'), C('paper', '紙の色', '#ffffff')],
    `vec4 fx(vec2 uv){ float a=radians(p_angle); mat2 R=mat2(cos(a),sin(a),-sin(a),cos(a)); float sp=max(3.,p_size*u_k); vec2 px=R*(uv*u_res); vec2 cell=(floor(px/sp)+0.5)*sp; vec2 cu=(transpose(R)*cell)/u_res;
      vec4 c=S(cu); float l=luma(un(c)); float rad=(p_mono>0.5? sqrt(1.-l) : sqrt(c.a))*sp*0.72; float d=length(px-cell); float m=clamp(rad-d+0.5,0.,1.);
      if(p_mono>0.5){ float al=S(uv).a; return pm(mix(p_paper, vec3(0.), m), max(al, c.a*m)); } return pm(un(c), m*step(0.001,c.a)); }`, { kw: 'ドット 漫画 印刷' }),

  // ======================= 装飾 =======================
  sh('shadow', '影', 'deco', [N('x', '横のずれ', 10, -500, 500, 1, 'px'), N('y', '縦のずれ', 10, -500, 500, 1, 'px'), N('blur', 'ぼかし', 10, 0, 200, 1, 'px'), C('col', '色', '#000000'), N('op', '濃さ', 70, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec2 o=vec2(p_x,p_y)*u_k/u_res; float r=p_blur*u_k; float a=0.; for(int i=0;i<40;i++){ float f=sqrt((float(i)+0.5)/40.); float th=float(i)*2.39996; a+=S(uv-o+vec2(cos(th),sin(th))*f*r/u_res).a; }
      a=a/40.*p_op/100.; vec4 s=vec4(p_col*a, a); return c+s*(1.-c.a); }`, { kw: 'ドロップシャドウ' }),
  sh('longShadow', '伸びる影', 'deco', [N('len', '長さ', 200, 0, 3000, 5, 'px'), N('angle', '角度', 45, -180, 180, 1, '度'), C('col', '色', '#000000'), N('op', '濃さ', 50, 0, 100, 1, '%'), B('fade', '先を薄くする', true)],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); float a=radians(p_angle); vec2 d=vec2(cos(a),sin(a))*p_len*u_k/u_res; float m=0.; for(int i=1;i<=80;i++){ float f=float(i)/80.; float s=S(uv-d*f).a; m=max(m, s*(p_fade>0.5? 1.-f : 1.)); }
      m*=p_op/100.; vec4 sh=vec4(p_col*m, m); return c+sh*(1.-c.a); }`, { kw: 'ロングシャドウ' }),
  sh('extrude', '立体化', 'deco', [N('len', '厚み', 30, 0, 500, 1, 'px'), N('angle', '角度', 45, -180, 180, 1, '度'), C('col', '側面の色', '#444444')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); float a=radians(p_angle); vec2 d=vec2(cos(a),sin(a))*p_len*u_k/u_res; float m=0.; for(int i=1;i<=64;i++){ m=max(m, S(uv-d*float(i)/64.).a); } vec4 sd=vec4(p_col*m, m); return c+sd*(1.-c.a); }`, { kw: '3D 厚み 押し出し' }),
  sh('outline', '縁取り', 'deco', [N('w', '太さ', 8, 0, 200, 1, 'px'), C('col', '色', '#000000'), N('soft', 'ぼかし', 0, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); float r=p_w*u_k; if(r<=0.) return c; float m=0.; for(int i=0;i<48;i++){ float th=float(i)*0.1308997; vec2 d=vec2(cos(th),sin(th))/u_res; m=max(m, S(uv+d*r).a); m=max(m, S(uv+d*r*0.5).a*(1.-p_soft/100.*0.5)); if(p_soft>0.) m=max(m, S(uv+d*r*1.5).a*(1.-p_soft/100.)*p_soft/100.); }
      vec4 o=vec4(p_col*m, m); return c+o*(1.-c.a); }`, { kw: 'ふちどり 枠 ストローク' }),
  sh('innerOutline', '縁取り（内側）', 'deco', [N('w', '太さ', 8, 0, 200, 1, 'px'), C('col', '色', '#ffffff')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); float r=p_w*u_k; if(r<=0.||c.a<=0.) return c; float mn=1.; for(int i=0;i<32;i++){ float th=float(i)*0.19634954; vec2 d=vec2(cos(th),sin(th))/u_res; mn=min(mn, S(uv+d*r).a); mn=min(mn, S(uv+d*r*0.5).a); } float b=1.-mn; return pm(mix(un(c), p_col, b), c.a); }`),
  sh('glow', 'グロー', 'deco', [N('r', '広がり', 30, 0, 300, 1, 'px'), N('amt', '強さ', 150, 0, 600, 5, '%'), B('tint', '色を指定する'), C('col', '光の色', '#ffffff')],
    `vec4 fx(vec2 uv){ if(u_pass<1.5) return gblur(uv, p_r*u_k, passDir()); vec4 b=S(uv); vec4 o=O(uv); vec3 g=p_tint>0.5? p_col*b.a : b.rgb; vec4 gl=vec4(g, b.a)*p_amt/100.; gl=min(gl, vec4(1.)); return vec4(min(o.rgb+gl.rgb*(1.-o.a*0.7), 1.), max(o.a, gl.a)); }`,
    { kw: '発光 光彩 ネオン', passes: 3 }),
  sh('frame', '枠線', 'deco', [N('w', '太さ', 10, 0, 300, 1, 'px'), C('col', '色', '#ffffff'), N('pad', '余白', 0, -500, 1000, 1, 'px'), N('r', '角の丸み', 0, 0, 1000, 1, 'px')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec2 h=u_box.zw*u_res*0.5+p_pad*u_k; vec2 q=abs((uv-u_box.xy-u_box.zw*0.5)*u_res); float r=min(p_r*u_k, min(h.x,h.y)); float d=length(max(q-h+r,0.))+min(max(q.x-h.x+r, q.y-h.y+r),0.)-r;
      float w=p_w*u_k; float m=clamp(0.5-d,0.,1.)*clamp(d+w+0.5,0.,1.); vec4 f=vec4(p_col*m, m); return f+c*(1.-m); }`, { kw: '囲む ボーダー' }),
  sh('bgFill', '背景塗りつぶし', 'deco', [C('col', '色', '#000000'), N('op', '濃さ', 60, 0, 100, 1, '%'), N('pad', '余白', 20, -500, 2000, 1, 'px'), N('r', '角の丸み', 10, 0, 1000, 1, 'px')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec2 h=u_box.zw*u_res*0.5+p_pad*u_k; vec2 q=abs((uv-u_box.xy-u_box.zw*0.5)*u_res); float r=min(p_r*u_k, min(h.x,h.y)); float d=length(max(q-h+r,0.))+min(max(q.x-h.x+r, q.y-h.y+r),0.)-r;
      float m=clamp(0.5-d,0.,1.)*p_op/100.; vec4 b=vec4(p_col*m, m); return c+b*(1.-c.a); }`, { kw: '座布団 帯 下地' }),
  sh('fgFill', '前景塗りつぶし', 'deco', [C('col', '色', '#ffffff'), N('amt', '強さ', 100, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); return pm(mix(un(c), p_col, p_amt/100.), c.a); }`, { kw: 'シルエット 単色' }),
  sh('gradient', 'グラデーション', 'deco', [C('c1', '色1', '#ffe259'), C('c2', '色2', '#ff5e62'), N('angle', '角度', 90, -180, 180, 1, '度'), N('amt', '強さ', 100, 0, 100, 1, '%'), S('mode', '形', 'linear', [['linear', '直線'], ['radial', '円形']]), S('mix', '重ね方', 'normal', [['normal', '通常'], ['mul', '乗算'], ['screen', 'スクリーン']])],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec2 q=(uv-u_box.xy-u_box.zw*0.5)/u_box.zw; float a=radians(p_angle); float t=p_mode<0.5? clamp(dot(q, vec2(cos(a),sin(a)))+0.5,0.,1.) : clamp(length(q)*1.4142,0.,1.);
      vec3 g=mix(p_c1,p_c2,t); vec3 r=un(c); vec3 o=p_mix<0.5? g : p_mix<1.5? r*g : 1.-(1.-r)*(1.-g); return pm(mix(r,o,p_amt/100.), c.a); }`, { kw: 'グラデ 虹' }),
  sh('halftoneShadow', '網点影', 'deco', [N('x', '横のずれ', 16, -500, 500, 1, 'px'), N('y', '縦のずれ', 16, -500, 500, 1, 'px'), N('size', '点の間隔', 10, 3, 100, 1, 'px'), C('col', '色', '#000000')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); vec2 o=vec2(p_x,p_y)*u_k/u_res; float sp=max(3.,p_size*u_k); vec2 px=uv*u_res; vec2 pr=vec2(px.x+px.y, px.x-px.y)*0.7071; vec2 cell=(floor(pr/sp)+0.5)*sp; float d=length(pr-cell);
      float a=S(uv-o).a; float m=clamp(sp*0.36-d+0.5,0.,1.)*a; vec4 s=vec4(p_col*m, m); return c+s*(1.-c.a); }`, { kw: 'ドット影 漫画' }),
  sh('stripe', 'しま模様', 'deco', [C('col', '色', '#ffffff'), N('size', '間隔', 40, 2, 1000, 1, 'px'), N('angle', '角度', 45, -180, 180, 1, '度'), N('amt', '濃さ', 50, 0, 100, 1, '%'), N('speed', '流れる速さ', 0, -1000, 1000, 5, 'px/秒')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); float a=radians(p_angle); float v=dot(uv*u_res, vec2(cos(a),sin(a)))+u_t*p_speed*u_k; float m=step(0.5, fract(v/(p_size*u_k)))*p_amt/100.; return pm(mix(un(c), p_col, m), c.a); }`, { kw: 'ストライプ 縞' }),

  // ======================= 合成 =======================
  sh('clip', 'クリッピング', 'comp', [N('t', '上', 0, 0, 4000, 1, 'px'), N('b', '下', 0, 0, 4000, 1, 'px'), N('l', '左', 0, 0, 4000, 1, 'px'), N('r', '右', 0, 0, 4000, 1, 'px')],
    `vec4 fx(vec2 uv){ vec2 k=u_k/u_res; vec2 lo=u_box.xy+vec2(p_l,p_t)*k; vec2 hi=u_box.xy+u_box.zw-vec2(p_r,p_b)*k; if(uv.x<lo.x||uv.y<lo.y||uv.x>hi.x||uv.y>hi.y) return vec4(0.); return S(uv); }`, { kw: '切り抜き トリミング クロップ' }),
  sh('diagClip', '斜めクリッピング', 'comp', [N('angle', '角度', 45, -180, 180, 1, '度'), N('pos', '位置', 0, -3000, 3000, 5, 'px'), N('soft', '境界のぼかし', 0, 0, 500, 1, 'px')],
    `vec4 fx(vec2 uv){ float a=radians(p_angle); vec2 d=(uv-u_box.xy-u_box.zw*0.5)*u_res; float v=dot(d, vec2(cos(a),sin(a)))-p_pos*u_k; float s=max(p_soft*u_k,0.5); return S(uv)*clamp(0.5-v/s,0.,1.); }`),
  sh('shapeClip', '図形切り抜き', 'comp',
    [S('shape', '形', 'circle', [['circle', '円'], ['rect', '四角'], ['round', '角丸四角'], ['tri', '三角'], ['star', '星'], ['heart', 'ハート'], ['dia', 'ひし形'], ['hex', '六角形']]),
      N('size', '大きさ', 100, 0, 400, 1, '%'), N('x', 'X', 0, -2000, 2000, 5, 'px'), N('y', 'Y', 0, -2000, 2000, 5, 'px'), N('soft', '境界のぼかし', 0, 0, 300, 1, 'px'), B('inv', '反転（図形の外を残す）'), B('fitw', '縦横の比を外枠に合わせる')],
    `float sdStar(vec2 p, float r){ const vec2 k1=vec2(0.809016994,-0.587785252); const vec2 k2=vec2(-k1.x,k1.y); p.x=abs(p.x); p-=2.*max(dot(k1,p),0.)*k1; p-=2.*max(dot(k2,p),0.)*k2; p.x=abs(p.x); p.y-=r; vec2 ba=0.45*vec2(-k1.y,k1.x)-vec2(0.,1.); float h=clamp(dot(p,ba)/dot(ba,ba),0.,r); return length(p-ba*h)*sign(p.y*ba.x-p.x*ba.y); }
    float sdHeart(vec2 p){ p.y=-p.y+0.55; p.x=abs(p.x); if(p.y+p.x>1.) return sqrt(dot(p-vec2(0.25,0.75),p-vec2(0.25,0.75)))-0.35355; return sqrt(min(dot(p-vec2(0.,1.),p-vec2(0.,1.)), dot(p-0.5*max(p.x+p.y,0.),p-0.5*max(p.x+p.y,0.))))*sign(p.x-p.y); }
    vec4 fx(vec2 uv){ vec2 h=u_box.zw*u_res*0.5; float R=min(h.x,h.y); vec2 d=(uv-u_box.xy-u_box.zw*0.5)*u_res-vec2(p_x,p_y)*u_k; vec2 q=p_fitw>0.5? d/h : d/R; q/=max(0.0001,p_size/100.); float sd;
      if(p_shape<0.5) sd=length(q)-1.; else if(p_shape<1.5) sd=max(abs(q.x),abs(q.y))-1.; else if(p_shape<2.5){ vec2 w=abs(q)-0.75; sd=length(max(w,0.))+min(max(w.x,w.y),0.)-0.25; }
      else if(p_shape<3.5){ vec2 t=vec2(abs(q.x), q.y); sd=max(t.x*0.866+t.y*0.5, -t.y)-0.5; sd*=1.3; } else if(p_shape<4.5) sd=sdStar(vec2(q.x,-q.y), 1.); else if(p_shape<5.5) sd=sdHeart(q*0.62);
      else if(p_shape<6.5) sd=(abs(q.x)+abs(q.y)-1.)*0.7071; else { vec2 a=abs(q); sd=max(a.x*0.866+a.y*0.5, a.y)-0.866; }
      float px=sd*R*p_size/100.; float s=max(p_soft*u_k,0.75); float m=clamp(0.5-px/s,0.,1.); if(p_inv>0.5) m=1.-m; return S(uv)*m; }`, { kw: 'マスク 丸く切り抜く' }),
  sh('chroma', 'クロマキー', 'comp', [C('col', '透明にする色', '#00ff00'), N('range', '範囲', 30, 0, 100, 1, '%'), N('soft', '境界', 10, 0, 100, 1, '%'), B('spill', '色かぶりを消す', true)],
    `vec2 cbcr(vec3 c){ return vec2(-0.168736*c.r-0.331264*c.g+0.5*c.b, 0.5*c.r-0.418688*c.g-0.081312*c.b); }
    vec4 fx(vec2 uv){ vec4 c=S(uv); if(c.a<=0.) return c; vec3 r=un(c); float d=distance(cbcr(r), cbcr(p_col)); float lo=p_range/100.*0.5; float m=smoothstep(lo, lo+p_soft/100.*0.5+0.0001, d);
      if(p_spill>0.5){ vec3 k=p_col; float mx=max(k.r,max(k.g,k.b)); if(k.g>=mx-0.001) r.g=min(r.g, max(r.r,r.b)*1.05+0.02); else if(k.b>=mx-0.001) r.b=min(r.b, max(r.r,r.g)*1.05+0.02); }
      return pm(r, c.a*m); }`, { kw: 'グリーンバック GB BB 透過' }),
  sh('colorKey', 'カラーキー', 'comp', [C('col', '透明にする色', '#ffffff'), N('range', '範囲', 10, 0, 100, 1, '%'), N('soft', '境界', 5, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); if(c.a<=0.) return c; float d=distance(un(c), p_col)/1.732; float lo=p_range/100.; return c*smoothstep(lo, lo+p_soft/100.+0.0001, d); }`, { kw: '色を抜く 透過' }),
  sh('lumaKey', 'ルミナンスキー', 'comp', [S('mode', '透明にする部分', 'dark', [['dark', '暗い部分'], ['bright', '明るい部分']]), N('th', 'しきい値', 30, 0, 100, 1, '%'), N('soft', '境界', 10, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 c=S(uv); if(c.a<=0.) return c; float l=luma(un(c)); float m=p_mode<0.5? smoothstep(p_th/100., p_th/100.+p_soft/100.+0.0001, l) : 1.-smoothstep(p_th/100.-p_soft/100.-0.0001, p_th/100., l); return c*m; }`, { kw: '黒を抜く 白を抜く 輝度 透過' }),
  sh('alphaInv', '透明部分の反転', 'comp', [C('col', '塗る色', '#000000')],
    `vec4 fx(vec2 uv){ float a=1.-S(uv).a; return vec4(p_col*a, a); }`, { kw: 'くり抜き 穴' }),

  // ======================= 配置 =======================
  sh('circleLayout', '円形配置', 'layout', [N('n', '個数', 6, 1, 32, 1, '個'), N('r', '半径', 300, 0, 3000, 5, 'px'), N('rot', '回転', 0, -3600, 3600, 1, '度'), B('face', '外側を向ける')],
    `vec4 fx(vec2 uv){ vec4 acc=vec4(0.); vec2 c=(u_box.xy+u_box.zw*0.5)*u_res; float n=floor(p_n+0.5);
      for(int i=0;i<32;i++){ if(float(i)>=n) break; float a=radians(p_rot)+float(i)/n*6.2831853; vec2 o=vec2(cos(a),sin(a))*p_r*u_k; vec2 d=uv*u_res-c-o;
        if(p_face>0.5){ float t=-(a+1.5707963); float cs=cos(t), sn=sin(t); d=vec2(d.x*cs-d.y*sn, d.x*sn+d.y*cs); } vec4 s=S((c+d)/u_res); acc=s+acc*(1.-s.a); }
      return acc; }`, { kw: '複製 並べる 円' }),
  sh('randLayout', 'ランダム配置', 'layout', [N('n', '個数', 8, 1, 32, 1, '個'), N('x', 'X の範囲', 600, 0, 4000, 10, 'px'), N('y', 'Y の範囲', 300, 0, 4000, 10, 'px'), N('seed', 'パターン', 1, 1, 999, 1), N('zoom', '大きさのばらつき', 0, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 acc=vec4(0.); vec2 c=(u_box.xy+u_box.zw*0.5)*u_res; float n=floor(p_n+0.5);
      for(int i=0;i<32;i++){ if(float(i)>=n) break; float fi=float(i)+p_seed*13.; vec2 o=(vec2(hash(vec2(fi,1.)), hash(vec2(fi,2.)))-0.5)*2.*vec2(p_x,p_y)*u_k; float z=1.+(hash(vec2(fi,3.))-0.5)*2.*p_zoom/100.;
        vec4 s=S((c+(uv*u_res-c-o)/max(z,0.05))/u_res); acc=s+acc*(1.-s.a); }
      return acc; }`, { kw: '複製 ばらまく' }),
  sh('gridLayout', '格子配置', 'layout', [N('nx', '横の数', 3, 1, 12, 1, '個'), N('ny', '縦の数', 2, 1, 12, 1, '個'), N('gx', '横の間隔', 400, 0, 4000, 10, 'px'), N('gy', '縦の間隔', 300, 0, 4000, 10, 'px')],
    `vec4 fx(vec2 uv){ vec4 acc=vec4(0.); vec2 n=floor(vec2(p_nx,p_ny)+0.5); for(int j=0;j<12;j++){ if(float(j)>=n.y) break; for(int i=0;i<12;i++){ if(float(i)>=n.x) break;
        vec2 o=(vec2(float(i),float(j))-(n-1.)*0.5)*vec2(p_gx,p_gy)*u_k/u_res; vec4 s=S(uv-o); acc=s+acc*(1.-s.a); } } return acc; }`, { kw: '複製 並べる' }),
  sh('afterimage', '残像', 'layout', [N('n', '個数', 5, 1, 16, 1, '個'), N('x', '横のずれ', -40, -1000, 1000, 5, 'px'), N('y', '縦のずれ', 0, -1000, 1000, 5, 'px'), N('fade', '薄くなる速さ', 60, 0, 100, 1, '%')],
    `vec4 fx(vec2 uv){ vec4 acc=vec4(0.); float n=floor(p_n+0.5); for(int i=16;i>=1;i--){ if(float(i)>n) continue; vec4 s=S(uv-vec2(p_x,p_y)*float(i)*u_k/u_res)*pow(1.-p_fade/100., float(i)); acc=s+acc*(1.-s.a); } vec4 c=S(uv); return c+acc*(1.-c.a); }`, { kw: 'ゴースト 軌跡 分身' }),
];

/** 重ね方（合成モード）の選択肢 */
export const BLEND_MODES: [GlobalCompositeOperation, string][] = [
  ['source-over', '通常'],
  ['lighter', '加算'],
  ['multiply', '乗算'],
  ['screen', 'スクリーン'],
  ['overlay', 'オーバーレイ'],
  ['lighten', '比較（明）'],
  ['darken', '比較（暗）'],
  ['difference', '差の絶対値'],
  ['exclusion', '除外'],
  ['color-dodge', '覆い焼き'],
  ['color-burn', '焼き込み'],
  ['hard-light', 'ハードライト'],
  ['soft-light', 'ソフトライト'],
  ['hue', '色相'],
  ['saturation', '彩度'],
  ['color', 'カラー'],
  ['luminosity', '輝度'],
];

export const BLEND_FX: VisualDef = {
  type: 'blend',
  name: '合成モード',
  cat: 'comp',
  kw: 'ブレンド 加算 乗算 スクリーン オーバーレイ',
  params: [S('mode', '重ね方', 'lighter', BLEND_MODES)],
  x: (st, p) => void (st.blend = p.mode as GlobalCompositeOperation),
};
