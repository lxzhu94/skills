#!/usr/bin/env node
// 把 agent 写好的中文内容合并回当天报告
//
//   node scripts/apply-content.mjs /tmp/content.json
//   node scripts/apply-content.mjs /tmp/content.json --date 2026-11-03
//
// content.json 结构（按 url / id 匹配，不需要重复抓取）：
// {
//   "overview": "一句当日综述",
//   "news":   [{ "url": "...", "title": "中文标题", "summary": "两句中文摘要" }],
//   "papers": [{ "url": "...", "title": "中文标题", "summary": "中文摘要" }],
//   "repos":  [{ "id": "owner/name", "description": "中文描述" }]
// }
'use strict';

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_DIR } from './lib/config.mjs';
import { renderMarkdown, bjNow } from './lib/format.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') out.date = argv[++i];
    else out.input = a;
  }
  return out;
}

const OUT_DIR = path.join(CONFIG_DIR, 'out');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    process.stderr.write('用法: node scripts/apply-content.mjs <content.json> [--date YYYY-MM-DD]\n');
    process.exit(1);
  }
  const content = JSON.parse(await readFile(args.input, 'utf8'));
  const date = args.date || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const reportPath = path.join(OUT_DIR, `${date}.json`);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));

  if (content.overview) report.overview = String(content.overview);

  // 新闻按 oss-radar 卡片收敛：只保留 agent 选中的 5-8 条，顺序也按 agent 给的
  if (Array.isArray(content.news) && content.news.length) {
    const rawByUrl = new Map();
    for (const n of report.news || []) {
      const u = n.url || (Array.isArray(n.sources) && n.sources[0] && n.sources[0].url);
      if (u) rawByUrl.set(u, n);
    }
    report.news = content.news
      .slice(0, 8)
      .map((c) => {
        const base = rawByUrl.get(c.url) || {};
        return {
          title: String(c.title || '').trim(),
          summary: String(c.summary || '').trim(),
          snippet: String(c.summary || '').trim(),
          sources: [{ name: c.source || base.source || '来源', url: c.url }],
        };
      })
      .filter((x) => x.title && x.summary && x.sources[0].url);
    if (report.news.length < 5) {
      process.stderr.write(`警告：有效新闻只有 ${report.news.length} 条，建议 5-8 条\n`);
    }
    report.itemCount = report.news.length;
  }

  const paperByUrl = new Map((content.papers || []).map((x) => [x.url, x]));
  for (const p of report.papers || []) {
    const c = paperByUrl.get(p.url);
    if (!c) continue;
    if (c.title) p.title = String(c.title);
    if (c.summary) p.summary = String(c.summary);
  }

  const repoById = new Map((content.repos || []).map((x) => [String(x.id), x]));
  for (const r of report.repos || []) {
    const c = repoById.get(String(r.id));
    if (!c) continue;
    if (c.description) r.description = String(c.description);
  }

  report.generatedAtBeijing = bjNow();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(OUT_DIR, `${date}.md`), renderMarkdown(report), 'utf8');
  process.stdout.write(`已合并中文内容：${reportPath}\n刷新网页即可看到。\n`);
}

main().catch((e) => { process.stderr.write(`失败：${e.message}\n`); process.exit(1); });
