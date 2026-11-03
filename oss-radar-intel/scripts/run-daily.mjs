#!/usr/bin/env node
// 定时任务实际入口 · 抓取 → 存文件 → 推飞书
//
//   node scripts/run-daily.mjs
//   node scripts/run-daily.mjs --out ./out --no-push
//
// 配置来自 ~/.oss-radar-intel/config.json(由 setup.mjs 生成)
'use strict';

import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, CONFIG_DIR } from './lib/config.mjs';
import { execute } from './fetch.mjs';
import { renderMarkdown, bjNow } from './lib/format.mjs';
import { buildCard, deliver } from './lib/feishu.mjs';

const KEEP_DAYS = 30;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-push' || a === '--dry-run') { out[a.slice(2)] = true; continue; }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    out[a.slice(2)] = argv[++i];
  }
  return out;
}

function bjDate() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function buildQuery(cfg) {
  const type = (cfg.schedule && cfg.schedule.type) || 'all';
  return {
    type,
    keywords: cfg.keywords,
    days: cfg.days != null ? cfg.days : (type === 'news' ? 1 : 7),
    limit: cfg.limit != null ? cfg.limit : 20,
    paperLimit: cfg.paperLimit != null ? cfg.paperLimit : 2,
    trackedRepos: Array.isArray(cfg.trackedRepos) && cfg.trackedRepos.length ? cfg.trackedRepos : undefined,
    aiTopics: Array.isArray(cfg.aiTopics) && cfg.aiTopics.length ? cfg.aiTopics : undefined,
    minStars: cfg.minStars != null ? cfg.minStars : 30,
    minUpvotes: cfg.minUpvotes != null ? cfg.minUpvotes : 10,
    minPoints: cfg.minPoints != null ? cfg.minPoints : 5,
    includeTrending: cfg.includeTrending === true,
    paperFilter: cfg.paperFilter === true,
    paperKeywords: Array.isArray(cfg.paperKeywords) && cfg.paperKeywords.length ? cfg.paperKeywords : cfg.keywords,
    repoKeywords: Array.isArray(cfg.repoKeywords) && cfg.repoKeywords.length ? cfg.repoKeywords : cfg.keywords,
  };
}

async function prune(dir, keepDays) {
  const cutoff = Date.now() - keepDays * 86400 * 1000;
  let names = [];
  try { names = await readdir(dir); } catch { return; }
  for (const n of names) {
    if (!/^\d{4}-\d{2}-\d{2}\.(md|json|html)$/.test(n)) continue;
    const day = n.slice(0, 10);
    if (new Date(`${day}T00:00:00Z`).getTime() < cutoff) {
      await unlink(path.join(dir, n)).catch(() => {});
    }
  }
}

async function logRun(entry) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await appendFile(path.join(CONFIG_DIR, 'run.log'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await loadConfig();
  if (!Array.isArray(cfg.keywords) || cfg.keywords.length === 0) {
    throw new Error('还没有配置关键词。请先运行 node scripts/setup.mjs（或在 agent 里说「帮我配置 oss-radar-intel」）');
  }

  const query = buildQuery(cfg);
  const started = Date.now();
  const result = await execute(query.type, query);
  const payload = {
    type: query.type,
    generatedAt: new Date().toISOString(),
    generatedAtBeijing: bjNow(),
    query,
    ...result,
  };

  const outDir = path.resolve(args.out || path.join(CONFIG_DIR, 'out'));
  await mkdir(outDir, { recursive: true });
  const date = bjDate();
  const mdPath = path.join(outDir, `${date}.md`);
  const jsonPath = path.join(outDir, `${date}.json`);
  await writeFile(mdPath, renderMarkdown(payload), 'utf8');
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await prune(outDir, KEEP_DAYS);

  const total = payload.news.length + payload.papers.length + payload.repos.length;
  let pushed = false;
  let pushError = null;
  const delivery = cfg.delivery || {};
  if (total === 0) {
    process.stderr.write('本次没有抓到内容，跳过推送。\n');
  } else if (!args['no-push'] && delivery.type && delivery.type !== 'none') {
    try {
      await deliver(delivery, buildCard(payload), { dryRun: args['dry-run'] });
      pushed = true;
    } catch (e) {
      pushError = e.message;
      process.stderr.write(`飞书推送失败：${e.message}\n`);
    }
  }

  await logRun({
    type: query.type, total, news: payload.news.length, papers: payload.papers.length, repos: payload.repos.length,
    pushed, pushError, durationMs: Date.now() - started, mdPath,
  });
  const preview = (label, arr) => {
    if (!arr.length) return;
    process.stdout.write(`\n${label}：\n`);
    arr.slice(0, 3).forEach((x, i) => {
      const title = String(x.title || x.id || '').replace(/\s+/g, ' ').slice(0, 70);
      const link = x.url || (Array.isArray(x.sources) && x.sources[0] && x.sources[0].url) || '';
      process.stdout.write(`  ${i + 1}. ${title}${link ? ` — ${link}` : ''}\n`);
    });
  };
  preview('新闻', payload.news);
  preview('论文', payload.papers);
  preview('开源项目', payload.repos);
  process.stdout.write(`\n完成：新闻 ${payload.news.length} · 论文 ${payload.papers.length} · 项目 ${payload.repos.length}${pushed ? ' · 已推飞书' : ''}\n文件：${mdPath}\n`);
  if (pushError) process.exitCode = 2;
}

main().catch(async (e) => {
  process.stderr.write(`失败：${e.message}\n`);
  await logRun({ error: e.message }).catch(() => {});
  process.exit(1);
});
