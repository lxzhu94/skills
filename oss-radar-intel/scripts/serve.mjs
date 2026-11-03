#!/usr/bin/env node
// 本地网页 · 直接复用 oss-radar 前端(web/)，用本地生成的报告充当数据源
//
//   node scripts/serve.mjs
//   PORT=8091 node scripts/serve.mjs --no-open
//
// 不需要 MongoDB、不需要 LLM。只读 ~/.oss-radar-intel/out/*.json。
'use strict';

import http from 'node:http';
import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, CONFIG_DIR } from './lib/config.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = path.join(SKILL_DIR, 'web');
const DATA_DIR = path.join(CONFIG_DIR, 'out');
const TEAM_ID = 'local';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') out.noOpen = true;
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--dir') out.dir = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'cmd' : 'xdg-open');
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(cmd, args, () => {});
}

const dataDirOf = (args) => path.resolve(args.dir || DATA_DIR);

async function listReports(dir) {
  let names = [];
  try { names = await readdir(dir); } catch { return []; }
  const dates = names
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .map((n) => n.slice(0, 10))
    .sort()
    .reverse();
  const out = [];
  for (const date of dates) {
    try {
      out.push(JSON.parse(await readFile(path.join(dir, `${date}.json`), 'utf8')));
    } catch { /* 跳过坏文件 */ }
  }
  return out;
}

function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fd = (first.getUTCDay() + 6) % 7;
  first.setUTCDate(first.getUTCDate() - fd + 3);
  const w = 1 + Math.round((t - first) / (7 * 86400000));
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

const dateOf = (r) => (r.generatedAtBeijing || '').slice(0, 10) || (r.generatedAt || '').slice(0, 10);

function splitRepo(r) {
  if (r.owner && r.name) return { owner: r.owner, name: r.name };
  const id = String(r.id || '');
  const [owner, name] = id.split('/');
  return { owner: owner || 'unknown', name: name || id };
}

function repoItem(r, i, total) {
  const { owner, name } = splitRepo(r);
  const column = i < Math.min(8, Math.ceil(total * 0.7)) ? 'work' : 'toy';
  const score = Math.max(5, Math.min(10, 9.5 - i * 0.2));
  return {
    id: r.id || `${owner}/${name}`,
    source: r.source || 'github',
    name,
    owner,
    url: r.url,
    description: r.description || '',
    stars: r.stars || 0,
    forks: r.forks || 0,
    language: r.language || '',
    topics: r.topics || [],
    license: r.license || '',
    createdAt: r.createdAt || null,
    pushedAt: r.pushedAt || null,
    finalScore: Number(score.toFixed(1)),
    finalColumn: column,
    column,
    tags: [],
    signals: null,
    llm: {
      column,
      score: Number(score.toFixed(1)),
      tags: [],
      oneLiner: r.description || '',
      highlight: '',
      useCase: '',
    },
    verdict: 'pass',
  };
}

function latestShape(report) {
  const repos = (report.repos || []).map((r, i, arr) => repoItem(r, i, arr.length));
  const date = dateOf(report);
  return {
    week: isoWeek(date),
    teamId: TEAM_ID,
    capturedAt: report.generatedAt || null,
    stats: { total: repos.length },
    total: repos.length,
    items: repos,
    workTopIds: repos.filter((x) => x.column === 'work').map((x) => x.id),
    toyTopIds: repos.filter((x) => x.column === 'toy').map((x) => x.id),
  };
}

function newsShape(report) {
  const date = dateOf(report);
  const items = (report.news || []).map((n) => (
    Array.isArray(n.sources)
      ? { title: n.title || '', summary: n.summary || '', sources: n.sources }
      : {
        title: n.title || '',
        summary: n.summary || n.snippet || '',
        sources: n.url ? [{ name: n.source || '来源', url: n.url }] : [],
      }
  ));
  const papers = report.papers || [];
  return {
    _id: `${TEAM_ID}:${date}`,
    teamId: TEAM_ID,
    date,
    overview: report.overview || `新闻 ${items.length} 条 · 论文 ${papers.length} 篇 · 项目 ${(report.repos || []).length} 个`,
    items,
    papers,
    itemCount: items.length,
    capturedAt: report.generatedAt || null,
  };
}

function teamShape(report) {
  const date = dateOf(report);
  return {
    _id: TEAM_ID,
    displayName: '本地雷达',
    aiNews: { enabled: true, keywords: (report.query && report.query.keywords) || [] },
    ossRadar: { enabled: true, keywords: (report.query && report.query.keywords) || [] },
    latest: { aiNewsAt: date, ossRadarWeek: isoWeek(date) },
  };
}

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ ok: true, data }));
}

async function handleApi(url, res, dir) {
  const reports = await listReports(dir);
  const latest = reports[0] || null;
  const p = url.pathname;

  if (p === '/api/health') return json(res, { status: 'ok', mode: 'local' });
  if (p === '/api/team/list') {
    const team = latest ? teamShape(latest) : { _id: TEAM_ID, displayName: '本地雷达', aiNews: null, ossRadar: null, latest: {} };
    return json(res, { teams: [team], email: 'local@localhost' });
  }
  if (p === '/api/latest') return json(res, latest ? latestShape(latest) : null);
  if (p === '/api/ai-news/latest') return json(res, latest ? newsShape(latest) : null);
  if (p === '/api/ai-news/list') {
    const limit = Math.max(1, Number(url.searchParams.get('limit')) || 12);
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const days = reports.map((r) => {
      const n = newsShape(r);
      return { date: n.date, itemCount: n.itemCount, overview: n.overview, capturedAt: n.capturedAt };
    });
    return json(res, { days: days.slice(offset, offset + limit), total: days.length, offset, limit });
  }
  if (p.startsWith('/api/ai-news/')) {
    const date = decodeURIComponent(p.slice('/api/ai-news/'.length));
    const r = reports.find((x) => dateOf(x) === date);
    return json(res, r ? newsShape(r) : null);
  }
  if (p === '/api/archive') {
    const limit = Math.max(1, Number(url.searchParams.get('limit')) || 12);
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const weeks = reports.map((r) => {
      const l = latestShape(r);
      return {
        week: l.week,
        from: dateOf(r),
        to: dateOf(r),
        count: l.total,
        top3: l.items.slice(0, 3).map((x) => ({ id: x.id, title: x.id, url: x.url, stars: x.stars })),
      };
    });
    return json(res, { weeks: weeks.slice(offset, offset + limit), total: weeks.length });
  }
  if (p.startsWith('/api/douyin-feeds')) return json(res, { feeds: [], total: 0 });
  if (p.startsWith('/api/week/')) {
    const week = decodeURIComponent(p.slice('/api/week/'.length));
    const r = reports.find((x) => isoWeek(dateOf(x)) === week);
    return json(res, r ? { ...latestShape(r), week } : null);
  }
  if (p.startsWith('/api/repo/')) {
    const rest = decodeURIComponent(p.slice('/api/repo/'.length));
    const id = rest.replace(/^github:/, '');
    const r = latest;
    if (!r) return json(res, null);
    const found = (r.repos || []).find((x) => String(x.id || '').toLowerCase() === id.toLowerCase());
    return json(res, found ? repoItem(found, 0, Math.max(1, (r.repos || []).length)) : null);
  }
  return json(res, null);
}

async function serveStatic(urlPath, res) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(WEB_ROOT, rel);
  if (!file.startsWith(WEB_ROOT + path.sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`用法:
  node scripts/serve.mjs                 # 启动并打开浏览器
  node scripts/serve.mjs --no-open
  PORT=8092 node scripts/serve.mjs
`);
    return;
  }
  await loadConfig();
  const dir = dataDirOf(args);
  const port = args.port || Number(process.env.PORT) || 8091;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/api/')) return await handleApi(url, res, dir);
      return await serveStatic(decodeURIComponent(url.pathname), res);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    process.stdout.write(`oss-radar 网页：${url}\n数据目录：${dir}\nCtrl-C 退出\n`);
    if (!args.noOpen) openBrowser(url);
  });

  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => { process.stderr.write(`失败：${e.message}\n`); process.exit(1); });
