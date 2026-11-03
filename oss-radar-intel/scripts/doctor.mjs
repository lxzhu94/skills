#!/usr/bin/env node
// 环境体检 · 装之前先看这台机器能不能跑
//
//   node scripts/doctor.mjs
'use strict';

import path from 'node:path';
import os from 'node:os';
import { access, constants } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadConfig, CONFIG_PATH, CONFIG_DIR } from './lib/config.mjs';

function nodeOk() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 20 || (major === 20 && minor >= 11);
}

async function checkUrl(name, url, init) {
  const t0 = Date.now();
  try {
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    return { name, ok: resp.ok || resp.status < 500, status: resp.status, ms: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, error: e.name === 'TimeoutError' ? '超时' : e.message, ms: Date.now() - t0 };
  }
}

export async function runDoctor() {
  const report = { node: {}, network: [], config: {}, scheduler: {}, dirs: {} };

  report.node = {
    ok: nodeOk(),
    version: process.versions.node,
    hint: nodeOk() ? '' : '需要 Node 20.11 或更高版本',
  };

  report.network = await Promise.all([
    checkUrl('GitHub API', 'https://api.github.com/rate_limit', { headers: { 'User-Agent': 'oss-radar-intel' } }),
    checkUrl('HuggingFace', 'https://huggingface.co/api/daily_papers?limit=1'),
    checkUrl('Hacker News', 'https://hn.algolia.com/api/v1/search?query=test&hitsPerPage=1'),
  ]);

  const cfg = await loadConfig();
  report.config = {
    exists: Object.keys(cfg).length > 0,
    path: CONFIG_PATH,
    keywords: cfg.keywords || [],
    delivery: cfg.delivery && cfg.delivery.type === 'feishu-app' ? '飞书机器人应用'
      : (cfg.delivery && cfg.delivery.type === 'feishu-webhook' ? '飞书 webhook' : '只存本地'),
    schedule: cfg.schedule && cfg.schedule.time ? `${cfg.schedule.installed ? '已安装' : '未安装'} · 计划每天 ${cfg.schedule.time}` : '未设置',
    githubToken: !!process.env.GITHUB_TOKEN,
  };

  try {
    await access(CONFIG_DIR, constants.W_OK);
    report.dirs = { ok: true, path: CONFIG_DIR };
  } catch {
    try {
      await access(path.dirname(CONFIG_DIR), constants.W_OK);
      report.dirs = { ok: true, path: CONFIG_DIR, hint: '尚未创建，首次保存时自动建' };
    } catch {
      report.dirs = { ok: false, path: CONFIG_DIR, hint: '目录不可写' };
    }
  }

  if (process.platform === 'darwin') {
    try {
      execFileSync('launchctl', ['version'], { stdio: 'ignore' });
      report.scheduler = { ok: true, name: 'launchd' };
    } catch {
      report.scheduler = { ok: false, name: 'launchd', hint: 'launchctl 不可用' };
    }
  } else if (process.platform === 'linux') {
    try {
      execFileSync('crontab', ['-l'], { stdio: 'ignore' });
      report.scheduler = { ok: true, name: 'crontab' };
    } catch {
      report.scheduler = { ok: true, name: 'crontab', hint: '尚未创建 crontab，安装时会自动建' };
    }
  } else {
    report.scheduler = { ok: false, name: process.platform, hint: '自动安装定时任务仅支持 macOS / Linux' };
  }

  report.ok = report.node.ok && report.network.some((n) => n.ok) && report.dirs.ok;
  return report;
}

export function formatDoctor(r) {
  const lines = [];
  lines.push(`环境检查 · Node ${r.node.version} · ${process.platform}`);
  lines.push('');
  lines.push(`${r.node.ok ? '✓' : '✗'} Node 版本${r.node.ok ? '' : `：${r.node.hint}`}`);
  for (const n of r.network) {
    lines.push(`${n.ok ? '✓' : '✗'} ${n.name}${n.ok ? `（${n.status}，${n.ms}ms）` : `：${n.error || n.status}`}`);
  }
  lines.push(`${r.dirs.ok ? '✓' : '✗'} 配置目录 ${r.dirs.path}${r.dirs.ok ? '' : `：${r.dirs.hint}`}`);
  lines.push('✓ 数据库：不需要（结果以 Markdown / JSON 存在本地目录）');
  lines.push(`${r.scheduler.ok ? '✓' : '✗'} 定时任务：${r.scheduler.name}${r.scheduler.hint ? `（${r.scheduler.hint}）` : ''}`);
  lines.push('');
  if (r.config.exists) {
    lines.push(`配置已存在：关键词 ${r.config.keywords.join('、') || '(空)'} · ${r.config.delivery} · ${r.config.schedule}`);
  } else {
    lines.push('还没有配置。运行 node scripts/setup.mjs 开始。');
  }
  if (!r.config.githubToken && r.network.some((n) => n.name === 'GitHub API' && n.ok)) {
    lines.push('提示：没有设置 GITHUB_TOKEN，GitHub 搜索额度较低，项目结果可能变少。');
  }
  return lines.join('\n');
}

async function main() {
  const r = await runDoctor();
  process.stdout.write(`${formatDoctor(r)}\n`);
  if (!r.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().catch((e) => { process.stderr.write(`失败：${e.message}\n`); process.exit(1); });
