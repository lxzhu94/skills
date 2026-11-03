#!/usr/bin/env node
// 一键出结果 · 不问任何问题
//
//   node scripts/quick.mjs
//
// 用默认配置抓一次（新闻 / 论文 2 篇 / 项目），生成报告，后台起本地网页并打开浏览器。
// 已有配置就复用，不覆盖。想改方向/推送/定时再跑 setup.mjs。
'use strict';

import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, CONFIG_DIR } from './lib/config.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_KEYWORDS = ['AI', 'Agent', 'MCP'];

async function ensureConfig() {
  const cfg = await loadConfig();
  if (Array.isArray(cfg.keywords) && cfg.keywords.length) return { cfg, created: false };

  const next = {
    keywords: DEFAULT_KEYWORDS,
    days: 7,
    limit: 20,
    paperLimit: 2,
    paperFilter: false,
    delivery: { type: 'none' },
    schedule: { time: '11:00', type: 'all' },
  };
  await saveConfig(next);
  return { cfg: next, created: true };
}

function freePort(start = 8091) {
  // 让 serve 自己试端口不现实，这里简单探测
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const s = net.createServer();
      s.once('error', () => { s.close(); tryPort(p + 1); });
      s.once('listening', () => s.close(() => resolve(p)));
      s.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-open') out.noOpen = true;
    else if (argv[i] === '--port') out.port = Number(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { cfg, created } = await ensureConfig();
  process.stdout.write(created
    ? `已用默认配置：${cfg.keywords.join('、')} · 论文 ${cfg.paperLimit || 2} 篇 · 新闻/项目 ${cfg.limit || 20} 条\n`
    : `复用已有配置：${(cfg.keywords || []).join('、')}\n`);
  process.stdout.write('开始抓取，大概 10-30 秒……\n');

  execFileSync(process.execPath, [path.join(SKILL_DIR, 'scripts/run-daily.mjs'), '--no-push'], { stdio: 'inherit' });

  const port = args.port || await freePort(8091);
  const serveArgs = [path.join(SKILL_DIR, 'scripts/serve.mjs'), '--port', String(port)];
  if (args.noOpen) serveArgs.push('--no-open');
  const child = spawn(process.execPath, serveArgs, {
    cwd: SKILL_DIR,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const resp = await fetch(`${url}api/health`, { signal: AbortSignal.timeout(1000) });
      if (resp.ok) break;
    } catch { /* 等启动 */ }
  }
  process.stdout.write(`\n网页：${url}\n数据：${path.join(CONFIG_DIR, 'out')}\n停掉网页：kill ${child.pid}\n`);
  process.stdout.write('如果你是 agent：先按 SKILL.md 用 apply-content.mjs 精修成中文，再打开上面这个地址给用户看。\n');
}

main().catch((e) => { process.stderr.write(`失败：${e.message}\n`); process.exit(1); });
