// 絵を加工するエフェクト（GLSL）を WebGL2 で実行する。
// アイテムを描いたキャンバスをテクスチャにして、エフェクトを順にかけ、結果のキャンバスを返す。
import { rgb, type Resolved } from './params';
import type { Uniforms, VisualDef } from './visualTypes';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface ShaderStep {
  def: VisualDef;
  p: Resolved;
  extra: Uniforms;
}

export interface ShaderEnv {
  /** プロジェクト座標1あたりのキャンバスのピクセル数 */
  k: number;
  t: number;
  d: number;
  seed: number;
  /** アイテムの外枠（uv 単位の x, y, 幅, 高さ） */
  box: [number, number, number, number];
}

const VERT = `#version 300 es
in vec2 a; out vec2 v_uv; uniform float u_flip;
void main(){ vec2 uv=a*0.5+0.5; v_uv=vec2(uv.x, u_flip>0.5? 1.-uv.y : uv.y); gl_Position=vec4(a,0.,1.); }`;

const HEAD = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_src; uniform sampler2D u_orig;
uniform vec2 u_res; uniform float u_k; uniform float u_t; uniform float u_d; uniform float u_pass; uniform float u_seed; uniform vec4 u_box;
vec4 S(vec2 uv){ if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) return vec4(0.); return texture(u_src, uv); }
vec4 O(vec2 uv){ if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) return vec4(0.); return texture(u_orig, uv); }
float hash(vec2 p){ vec3 q=fract(vec3(p.xyx)*0.1031); q+=dot(q, q.yzx+33.33); return fract((q.x+q.y)*q.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x), u.y); }
vec3 un(vec4 c){ return c.a>0.0001? c.rgb/c.a : vec3(0.); }
vec4 pm(vec3 c, float a){ return vec4(c*a, a); }
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz), vec4(c.gb,K.xy), step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r), vec4(c.r,p.yzx), step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx, clamp(p-K.xxx,0.,1.), c.y); }
vec2 passDir(){ return u_pass<0.5? vec2(1.,0.) : vec2(0.,1.); }
vec4 gblur(vec2 uv, float r, vec2 dir){ if(r<0.5) return S(uv); vec2 d=dir/u_res*2.*r; vec4 s=vec4(0.); float w=0.; for(int i=-16;i<=16;i++){ float x=float(i)/16.; float g=exp(-2.*x*x); s+=S(uv+d*x)*g; w+=g; } return s/w; }
`;

interface Program {
  prog: WebGLProgram;
  loc: Map<string, WebGLUniformLocation | null>;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

class Runner {
  canvas: AnyCanvas;
  gl: WebGL2RenderingContext;
  private programs = new Map<string, Program | null>();
  private input: WebGLTexture;
  private targets: Target[] = [];
  private w = 0;
  private h = 0;
  lost = false;

  constructor() {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 が使えません');
    this.gl = gl;
    (this.canvas as HTMLCanvasElement).addEventListener?.('webglcontextlost', () => (this.lost = true));
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.input = this.makeTexture();
  }

  private makeTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private resize(w: number, h: number) {
    if (this.w === w && this.h === h) return;
    const gl = this.gl;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    for (const t of this.targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    this.targets = [];
    for (let i = 0; i < 3; i++) {
      const tex = this.makeTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.targets.push({ tex, fbo });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private program(step: ShaderStep): Program | null {
    const hit = this.programs.get(step.def.type);
    if (hit !== undefined) return hit;
    const gl = this.gl;
    let decl = '';
    for (const d of step.def.params) decl += `uniform ${d.t === 'color' ? 'vec3' : 'float'} p_${d.k};\n`;
    for (const [k, v] of Object.entries(step.extra)) decl += `uniform ${Array.isArray(v) ? `vec${v.length}` : 'float'} ${k};\n`;
    const src = `${HEAD}${decl}${step.def.glsl}\nvoid main(){ outColor=fx(v_uv); }`;
    const compile = (type: number, code: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile error');
      return s;
    };
    let result: Program | null = null;
    try {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, src));
      gl.bindAttribLocation(prog, 0, 'a');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
      result = { prog, loc: new Map() };
    } catch (err) {
      console.error(`エフェクト「${step.def.name}」のシェーダーを作れませんでした`, err);
    }
    this.programs.set(step.def.type, result);
    return result;
  }

  run(layer: TexImageSource, w: number, h: number, steps: ShaderStep[], env: ShaderEnv): AnyCanvas | null {
    const gl = this.gl;
    this.resize(w, h);
    const ready = steps.map((s) => ({ s, prog: this.program(s) })).filter((x): x is { s: ShaderStep; prog: Program } => !!x.prog);
    if (!ready.length) return null;

    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.input);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    let stepInput: WebGLTexture = this.input;
    const total = ready.reduce((n, x) => n + (x.s.def.passes ?? 1), 0);
    let done = 0;
    for (const { s, prog } of ready) {
      gl.useProgram(prog.prog);
      const loc = (name: string) => {
        let l = prog.loc.get(name);
        if (l === undefined) {
          l = gl.getUniformLocation(prog.prog, name);
          prog.loc.set(name, l);
        }
        return l;
      };
      const set = (name: string, v: number | number[]) => {
        const l = loc(name);
        if (!l) return;
        if (typeof v === 'number') gl.uniform1f(l, v);
        else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
        else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
      };
      set('u_res', [w, h]);
      set('u_k', env.k);
      set('u_t', env.t);
      set('u_d', env.d);
      set('u_seed', env.seed);
      set('u_box', env.box);
      for (const d of s.def.params) {
        const v = s.p[d.k];
        if (d.t === 'color') set(`p_${d.k}`, rgb(String(v)));
        else if (d.t === 'bool') set(`p_${d.k}`, v ? 1 : 0);
        else if (d.t === 'sel') set(`p_${d.k}`, Math.max(0, d.opts.findIndex((o) => o[0] === v)));
        else set(`p_${d.k}`, Number(v) || 0);
      }
      for (const [k, v] of Object.entries(s.extra)) set(k, v);
      gl.uniform1i(loc('u_src'), 0);
      gl.uniform1i(loc('u_orig'), 1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, stepInput);

      const passes = s.def.passes ?? 1;
      let src = stepInput;
      for (let j = 0; j < passes; j++) {
        const last = ++done === total;
        const dst = last ? null : this.targets.find((t) => t.tex !== src && t.tex !== stepInput)!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fbo : null);
        set('u_flip', last ? 1 : 0);
        set('u_pass', j);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src);
        if (last) {
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (dst) src = dst.tex;
      }
      stepInput = src;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.canvas;
  }
}

let runner: Runner | null = null;
let unavailable = false;

/**
 * layer（アイテムだけを描いたキャンバス）にエフェクトを順にかけた結果を返す。
 * WebGL2 が使えない環境では null（呼び出し側は加工なしで描く）。
 */
export function runShaders(layer: TexImageSource, w: number, h: number, steps: ShaderStep[], env: ShaderEnv): AnyCanvas | null {
  if (unavailable || !steps.length) return null;
  try {
    if (!runner || runner.lost) runner = new Runner();
    return runner.run(layer, w, h, steps, env);
  } catch (err) {
    console.warn('映像エフェクト（WebGL）が使えません', err);
    unavailable = true;
    return null;
  }
}

export const shadersAvailable = () => !unavailable;
