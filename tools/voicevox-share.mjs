#!/usr/bin/env node
// VOICEVOX 共有サーバー：自分のパソコンの VOICEVOX を、友達がスーパー編集メーカーから使えるようにする。
//
// しくみ：
//   友達のブラウザ ──https──▶ Cloudflare のトンネル ──▶ このサーバー（合言葉を確認）──▶ VOICEVOX
//
// - 合言葉（自動で作って voicevox-share.json に保存）を知っている人だけが使える
// - 読み上げに必要な機能（声の一覧・読み上げ）だけを通し、VOICEVOX の設定変更などは通さない
// - cloudflared があればトンネルも自動で開き、友達に送る「共有リンク」を表示する
//
// 使い方：VOICEVOX を起動してから  node tools/voicevox-share.mjs
//   オプション：--no-tunnel（トンネルを開かない） / --port 50080 / --engine http://127.0.0.1:50021
//              --new-key（合言葉を作り直す。前の共有リンクは使えなくなる）
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_URL = 'https://takokinkunyt-droid.github.io/SuperHenshuMerker/';
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(opt('--port', '50080'));
const ENGINE = opt('--engine', 'http://127.0.0.1:50021').replace(/\/+$/, '');
const NO_TUNNEL = args.includes('--no-tunnel');
/** 1回の読み上げで受け付ける文字数の上限 */
const MAX_TEXT = 500;
/** 同時に処理する読み上げの数（パソコンが重くならないように） */
const MAX_CONCURRENT = 2;

// ---------- 合言葉 ----------
const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, 'voicevox-share.json');
let config = {};
try {
  if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch {
  config = {};
}
if (!config.key || args.includes('--new-key')) {
  config.key = randomBytes(12).toString('base64url');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}
const KEY = config.key;

// ---------- 中継サーバー ----------
/** 通してよい機能だけ（メソッド＋パス） */
const ALLOWED = new Set(['GET /version', 'GET /speakers', 'POST /audio_query', 'POST /synthesis']);
let running = 0;

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  // Chrome の「ローカルネットワークへのアクセス」の事前確認に答える
  if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function send(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'スーパー編集メーカー VOICEVOX 共有サーバー');

  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${KEY}`) {
    console.log(`🔒 合言葉が違うアクセスがありました（${url.pathname}）`);
    return send(res, 401, '合言葉が違います');
  }
  if (!ALLOWED.has(`${req.method} ${url.pathname}`)) return send(res, 403, 'この機能は共有していません');
  if (url.pathname === '/audio_query' && (url.searchParams.get('text') ?? '').length > MAX_TEXT) {
    return send(res, 413, `一度に読み上げられるのは${MAX_TEXT}文字までです`);
  }
  if (running >= MAX_CONCURRENT) return send(res, 429, '混み合っています。少し待ってからもう一度試してください');

  running++;
  const started = Date.now();
  try {
    const body = req.method === 'POST' ? await readBody(req, 2_000_000) : undefined;
    const upstream = await fetch(`${ENGINE}${url.pathname}${url.search}`, {
      method: req.method,
      headers: body ? { 'Content-Type': req.headers['content-type'] ?? 'application/json' } : {},
      body,
    });
    const data = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream' });
    res.end(data);
    if (url.pathname === '/speakers') console.log('📱 友達のアプリが接続しました（声の一覧を送りました）');
    if (url.pathname === '/synthesis') console.log(`🗣 読み上げました（${(Date.now() - started) / 1000}秒）`);
  } catch (err) {
    send(res, 502, `VOICEVOX に接続できません（${ENGINE}）。VOICEVOX が起動しているか確認してください`);
    console.error('VOICEVOX に接続できません:', err.message);
  } finally {
    running--;
  }
});

// ---------- 起動 ----------
async function checkEngine() {
  try {
    const r = await fetch(`${ENGINE}/version`);
    const version = r.ok ? (await r.text()).replace(/"/g, '') : '';
    console.log(`✅ VOICEVOX に接続できました${version ? `（バージョン ${version}）` : ''}`);
  } catch {
    console.log(`⚠️  VOICEVOX が見つかりません（${ENGINE}）。VOICEVOX を起動してください（起動すればそのまま使えます）`);
  }
}

/** トンネルの URL がインターネットから実際に使えるようになるまで待つ（作成直後は数十秒つながらないことがある） */
async function waitUntilReachable(publicUrl) {
  console.log(`トンネルができました：${publicUrl}`);
  console.log('インターネットからつながるか確認しています…');
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${publicUrl}/`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        console.log('✅ インターネットからつながることを確認しました');
        return;
      }
    } catch {
      // まだ準備中
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('⚠️  インターネットからつながることを確認できませんでした。友達が使えない場合は、このウィンドウを閉じてもう一度起動してください。');
}

function showLink(publicUrl) {
  const link = `${APP_URL}#voicevox=${encodeURIComponent(publicUrl)}&key=${encodeURIComponent(KEY)}`;
  console.log('\n==================== 友達に送る共有リンク ====================');
  console.log(link);
  console.log('==============================================================');
  console.log('このリンクを開くと、スーパー編集メーカーの「🗣 読み上げ」があなたの VOICEVOX につながります。');
  console.log('※ LINE で受け取ったら、右上のメニューから「ブラウザで開く」（Safari／Chrome）で開いてもらってください。');
  console.log('  または、アプリの「🗣 読み上げ」→「共有リンクを貼り付け」にリンクを貼り付けても設定できます。');
  console.log(`※ 確認用：${publicUrl} をスマホのブラウザで開いて「共有サーバー」と表示されればつながっています。`);
  console.log('このウィンドウを閉じる（Ctrl+C）と共有は止まります。リンクは合言葉入りなので、知らない人には送らないでください。\n');
}

function startTunnel() {
  const cmd = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const child = spawn(cmd, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let shown = false;
  const onData = (buf) => {
    // api.trycloudflare.com はトンネル作成用の窓口なので除く
    const m = buf.toString().match(/https:\/\/(?!api\.)[-a-z0-9]+\.trycloudflare\.com/);
    if (m && !shown) {
      shown = true;
      void waitUntilReachable(m[0]).then(() => showLink(m[0]));
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', () => {
    console.log('\n⚠️  cloudflared が見つかりません。インターネット越しに共有するには、次のどちらかでインストールしてください：');
    console.log('   Windows: PowerShell で  winget install --id Cloudflare.cloudflared');
    console.log('   Mac:     brew install cloudflared');
    console.log('   インストール後、このウィンドウを開き直してください（見つからないときはパソコンを再起動）。\n');
  });
  child.on('exit', (code) => {
    if (shown) console.log(`トンネルが終了しました（${code}）。もう一度起動すると新しい共有リンクになります。`);
  });
  const stop = () => {
    child.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`スーパー編集メーカー VOICEVOX 共有サーバー（http://127.0.0.1:${PORT} → ${ENGINE}）`);
  await checkEngine();
  if (NO_TUNNEL) {
    console.log('トンネルなしで起動しました。');
    showLink(`http://127.0.0.1:${PORT}`);
  } else {
    console.log('Cloudflare のトンネルを開いています…（10秒ほどかかります）');
    startTunnel();
  }
});
