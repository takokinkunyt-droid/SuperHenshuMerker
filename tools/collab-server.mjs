// 共同作業の中継：プロジェクトの最新の内容と素材をこのパソコンに置き、参加している全員に変更を届ける。
// voicevox-share.mjs から読み込んで使う（合言葉の確認は呼び出し側で済ませておく）。
//
//   PUT  /collab/<room>/project            プロジェクトを丸ごと置く（共同作業を始めるとき）
//   GET  /collab/<room>/project            今のプロジェクト
//   GET  /collab/<room>/events?client=…    変更のお知らせ（Server-Sent Events）
//   POST /collab/<room>/ops                変更を送る → 全員に届ける
//   POST /collab/<room>/presence           名前・選んでいるアイテムを知らせる
//   PUT  /collab/<room>/assets/<id>?offset=&total=   素材を分けてアップロード
//   GET  /collab/<room>/assets/<id>        素材をダウンロード
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ROOM_RE = /^[A-Za-z0-9_-]{8,80}$/;
const ASSET_RE = /^[A-Za-z0-9_-]{4,80}$/;
/** 素材1つの上限（2GB） */
const MAX_ASSET = 2 * 1024 ** 3;
const COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#20c997', '#f06595'];

/** 変更をプロジェクトに当てはめる（src/collab/ops.ts の applyOps と同じ動き） */
function applyOps(project, ops) {
  const items = [...project.items];
  const assets = { ...project.assets };
  let meta = {};
  for (const o of ops) {
    if (o.op === 'item' && o.item?.id) {
      const i = items.findIndex((it) => it.id === o.item.id);
      if (i >= 0) items[i] = o.item;
      else items.push(o.item);
    } else if (o.op === 'delItem') {
      const i = items.findIndex((it) => it.id === o.id);
      if (i >= 0) items.splice(i, 1);
    } else if (o.op === 'asset' && o.asset?.id) {
      assets[o.asset.id] = o.asset;
    } else if (o.op === 'delAsset') {
      delete assets[o.id];
    } else if (o.op === 'meta' && o.fields) {
      meta = { ...meta, ...o.fields };
    }
  }
  return { ...project, ...meta, items, assets, updatedAt: Date.now() };
}

export function createCollab(dataDir, log = console.log) {
  mkdirSync(dataDir, { recursive: true });
  /** room → { project, rev, clients: Map<id, {res, name, color, selected}>, saveTimer } */
  const rooms = new Map();

  const roomDir = (room) => join(dataDir, room);
  const assetPath = (room, id) => join(roomDir(room), 'assets', id);

  function getRoom(room) {
    let r = rooms.get(room);
    // まだプロジェクトが無ければ、ほかの起動で保存されたものが無いか読み直す
    if (!r || !r.project) {
      let project = null;
      let rev = 0;
      const file = join(roomDir(room), 'project.json');
      if (existsSync(file)) {
        try {
          ({ project, rev } = JSON.parse(readFileSync(file, 'utf8')));
        } catch {
          project = null;
        }
      }
      if (r) Object.assign(r, { project, rev });
      else {
        r = { project, rev, clients: new Map(), saveTimer: null };
        rooms.set(room, r);
      }
    }
    return r;
  }

  function save(room, r) {
    clearTimeout(r.saveTimer);
    r.saveTimer = setTimeout(() => {
      mkdirSync(roomDir(room), { recursive: true });
      const tmp = join(roomDir(room), 'project.json.tmp');
      writeFileSync(tmp, JSON.stringify({ project: r.project, rev: r.rev }));
      renameSync(tmp, join(roomDir(room), 'project.json'));
    }, 500);
  }

  function emit(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(r, event, data) {
    for (const c of r.clients.values()) emit(c.res, event, data);
  }

  function presence(r) {
    return [...r.clients.entries()].map(([id, c]) => ({ id, name: c.name, color: c.color, selected: c.selected ?? null }));
  }

  function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  function readJson(req, limit) {
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
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  /** /collab/ で始まる要求を処理する。処理したら true */
  async function handle(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // ['collab', room, ...]
    if (parts[0] !== 'collab') return false;
    const room = parts[1];
    if (!room || !ROOM_RE.test(room)) {
      json(res, 400, { error: 'bad room' });
      return true;
    }
    const r = getRoom(room);
    const what = parts[2];

    try {
      if (what === 'project' && req.method === 'PUT') {
        const { project } = await readJson(req, 20_000_000);
        if (!project || !Array.isArray(project.items)) return json(res, 400, { error: 'bad project' }), true;
        r.project = project;
        r.rev++;
        save(room, r);
        broadcast(r, 'snapshot', { project: r.project, rev: r.rev });
        log(`👥 共同作業のプロジェクト「${project.name}」を受け取りました`);
        json(res, 200, { rev: r.rev });
        return true;
      }
      if (what === 'project' && req.method === 'GET') {
        if (!r.project) return json(res, 404, { error: 'no project' }), true;
        json(res, 200, { project: r.project, rev: r.rev });
        return true;
      }
      if (what === 'events' && req.method === 'GET') {
        if (!r.project) return json(res, 404, { error: 'no project' }), true;
        const client = String(url.searchParams.get('client') ?? '').slice(0, 64) || Math.random().toString(36).slice(2);
        const name = String(url.searchParams.get('name') ?? '').slice(0, 30) || 'ゲスト';
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        const color = COLORS[[...r.clients.values()].length % COLORS.length];
        r.clients.set(client, { res, name, color, selected: null });
        emit(res, 'snapshot', { project: r.project, rev: r.rev });
        broadcast(r, 'presence', presence(r));
        log(`👥 ${name} さんが共同作業に参加しました（${r.clients.size}人）`);
        // Cloudflare などの途中経路で切られないよう、定期的に空のメッセージを送る
        const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);
        req.on('close', () => {
          clearInterval(keepAlive);
          if (r.clients.get(client)?.res === res) r.clients.delete(client);
          broadcast(r, 'presence', presence(r));
          log(`👥 ${name} さんが共同作業から抜けました（${r.clients.size}人）`);
        });
        return true;
      }
      if (what === 'ops' && req.method === 'POST') {
        if (!r.project) return json(res, 404, { error: 'no project' }), true;
        const { client, ops } = await readJson(req, 20_000_000);
        if (!Array.isArray(ops)) return json(res, 400, { error: 'bad ops' }), true;
        r.project = applyOps(r.project, ops);
        r.rev++;
        save(room, r);
        broadcast(r, 'ops', { rev: r.rev, ops, from: client });
        json(res, 200, { rev: r.rev });
        return true;
      }
      if (what === 'presence' && req.method === 'POST') {
        const { client, name, selected } = await readJson(req, 10_000);
        const c = r.clients.get(client);
        if (c) {
          if (typeof name === 'string' && name.trim()) c.name = name.trim().slice(0, 30);
          c.selected = typeof selected === 'string' ? selected : null;
          broadcast(r, 'presence', presence(r));
        }
        json(res, 200, { ok: true });
        return true;
      }
      if (what === 'assets' && parts[3] && ASSET_RE.test(parts[3])) {
        const id = parts[3];
        const final = assetPath(room, id);
        if (req.method === 'GET') {
          if (!existsSync(final)) return json(res, 404, { error: 'not yet' }), true;
          const size = statSync(final).size;
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size), 'Cache-Control': 'no-cache' });
          createReadStream(final).pipe(res);
          return true;
        }
        if (req.method === 'PUT') {
          const offset = Number(url.searchParams.get('offset') ?? 0);
          const total = Number(url.searchParams.get('total') ?? 0);
          if (!Number.isFinite(offset) || !Number.isFinite(total) || total <= 0 || total > MAX_ASSET || offset < 0 || offset >= total) {
            return json(res, 400, { error: 'bad range' }), true;
          }
          if (existsSync(final) && statSync(final).size === total) {
            req.resume();
            return json(res, 200, { done: true }), true;
          }
          mkdirSync(join(roomDir(room), 'assets'), { recursive: true });
          const part = `${final}.part`;
          const fh = await open(part, existsSync(part) ? 'r+' : 'w+');
          let pos = offset;
          try {
            for await (const chunk of req) {
              if (pos + chunk.length > total) throw new Error('too large');
              await fh.write(chunk, 0, chunk.length, pos);
              pos += chunk.length;
            }
          } finally {
            await fh.close();
          }
          const done = pos >= total && statSync(part).size >= total;
          if (done) renameSync(part, final);
          json(res, 200, { done, received: pos });
          return true;
        }
        if (req.method === 'DELETE') {
          await rm(final, { force: true });
          json(res, 200, { ok: true });
          return true;
        }
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: String(err?.message ?? err) });
    }
    return true;
  }

  return { handle };
}
