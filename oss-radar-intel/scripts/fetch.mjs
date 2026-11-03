#!/usr/bin/env node
// oss-radar-intel CLI · 抓取 AI 新闻 / 论文 / 新开源项目
//
// 用法：
//   node scripts/fetch.mjs news   --keywords "AI Coding,MCP" --days 1
//   node scripts/fetch.mjs papers --days 7 --min-upvotes 10
//   node scripts/fetch.mjs repos  --keywords "AI Coding,MCP" --days 7 --limit 20
//   node scripts/fetch.mjs all    --keywords "..." --days 7 --out ./out

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { searchNews, matchesKeywords } from './lib/news.mjs';
import { fetchPapers } from './lib/hf.mjs';
import { searchRepos, fetchOssInsightTrending } from './lib/github.mjs';
import { renderMarkdown, bjNow } from './lib/format.mjs';
import { loadConfig, saveConfig, resetConfig, pickCliConfig, CONFIG_PATH } from './lib/config.mjs';
import { printSchedule } from './schedule.mjs';

const HELP = `oss-radar-intel · AI 新闻 / 论文 / 开源项目抓取

用法:
  node scripts/fetch.mjs <news|papers|repos|all> [options]
  node scripts/fetch.mjs config [options]        # 记住默认参数
  node scripts/fetch.mjs schedule [type] --daily 11:00   # 打印定时任务配置

参数:
  --keywords <a,b>      关键词，逗号分隔。默认 AI
  --days <n>            回溯天数。news 默认 1，papers / repos 默认 7
  --limit <n>           新闻/项目输出条数。默认 20
  --paper-limit <n>     论文输出条数。默认 2
  --min-stars <n>       GitHub 项目 star 门槛，默认 30
  --min-upvotes <n>     论文点赞门槛，默认 10
  --min-points <n>      HN 新闻热度门槛，默认 5
  --include-trending    叠加 OSSInsight trending（上游常不可用）
  --paper-filter        论文也按关键词过滤（默认取 HF 热榜全部方向）
  --paper-keywords a,b  论文单独用的关键词，默认跟 --keywords 一样
  --repo-keywords a,b   开源项目单独用的关键词，默认跟 --keywords 一样
  --json                输出 JSON
  --out <dir>           写入文件而不是 stdout
  -h, --help            显示帮助

配置:
  node scripts/fetch.mjs config --keywords "AI,Agent,MCP" --days 1
  node scripts/fetch.mjs config --show      # 查看当前配置
  node scripts/fetch.mjs config --reset     # 清空
  配置存在 ~/.oss-radar-intel/config.json · 命令行参数优先

环境变量:
  GITHUB_TOKEN          可选。带上后 GitHub 搜索额度从 10 次/分钟提升到 30 次/分钟。

示例:
  node scripts/fetch.mjs news --keywords "AI Coding,MCP" --days 1 --limit 10
  node scripts/fetch.mjs all --keywords "AI,Agent" --days 7 --out ./out
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      out.help = true;
      continue;
    }
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (key === 'json' || key === 'include-trending' || key === 'paper-filter' || key === 'show' || key === 'reset') {
      out[key] = true;
      continue;
    }
    const val = argv[i + 1];
    if (val == null || val.startsWith('--')) {
      throw new Error(`参数 --${key} 缺少值`);
    }
    out[key] = val;
    i++;
  }
  return out;
}

function num(v, fallback) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseKeywords(v) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function stamp() {
  // 北京时间的 YYYY-MM-DD-HH-mm-ss，避免同一分钟内重复运行覆盖文件
  return new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-');
}

async function runNews(q) {
  const r = await searchNews(q);
  return { news: r.items, papers: [], repos: [], sources: r.sources, warnings: r.warnings };
}

function paperKeywordsOf(q) {
  return (Array.isArray(q.paperKeywords) && q.paperKeywords.length) ? q.paperKeywords : q.keywords;
}

function filterPaperItems(items, q) {
  if (!q.paperFilter) return { items };
  const kws = paperKeywordsOf(q);
  if (!Array.isArray(kws) || !kws.length) return { items };
  const matched = items.filter((p) => matchesKeywords(p.title, p.summary, kws));
  if (matched.length) return { items: matched.slice(0, paperCount(q)) };
  return {
    items: [],
    warning: `论文没有命中关键词「${kws.join('、')}」，今天不显示论文（不会拿不相关的凑数）`,
  };
}

/** 开了论文过滤就多拉一些候选再筛，避免只看热榜前 20 导致命中为 0 */
function paperCount(q) {
  return Number(q.paperLimit) > 0 ? Number(q.paperLimit) : 2;
}

function paperFetchLimit(q) {
  return q.paperFilter ? Math.max(paperCount(q) * 10, 100) : paperCount(q);
}

async function runPapers(q) {
  const r = await fetchPapers({ ...q, limit: paperFetchLimit(q) });
  const f = filterPaperItems(r.items, q);
  if (f.warning) r.warnings.push(f.warning);
  const src = r.sources['hf-daily-papers'];
  if (src && q.paperFilter) { src.raw = src.count; src.count = f.items.length; }
  return { news: [], papers: f.items, repos: [], sources: r.sources, warnings: r.warnings };
}

function repoKeywordsOf(q) {
  return (Array.isArray(q.repoKeywords) && q.repoKeywords.length) ? q.repoKeywords : q.keywords;
}

async function runRepos(q) {
  const r = await searchRepos({ ...q, keywords: repoKeywordsOf(q) });
  let repos = r.items;
  const sources = { ...r.sources };
  const warnings = [...r.warnings];

  if (q.includeTrending) {
    const t = await fetchOssInsightTrending({ limit: q.limit });
    const seen = new Set(repos.map((x) => x.id));
    repos = repos.concat(t.items.filter((x) => !seen.has(x.id)));
    Object.assign(sources, t.sources);
    warnings.push(...t.warnings);
  }

  return { news: [], papers: [], repos, sources, warnings };
}

async function runAll(q) {
  const [news, papers, repos] = await Promise.all([
    searchNews(q).catch((err) => ({
      items: [],
      sources: { news: { ok: false, note: err.message } },
      warnings: [`新闻抓取失败：${err.message}`],
    })),
    fetchPapers({ ...q, limit: paperFetchLimit(q) }).catch((err) => ({
      items: [],
      sources: {},
      warnings: [`论文抓取失败：${err.message}`],
    })),
    runRepos(q).catch((err) => ({
      repos: [],
      sources: {},
      warnings: [`项目抓取失败：${err.message}`],
    })),
  ]);

  const paperFiltered = filterPaperItems(papers.items, q);
  if (paperFiltered.warning) papers.warnings.push(paperFiltered.warning);
  const paperSrc = papers.sources['hf-daily-papers'];
  if (paperSrc && q.paperFilter) { paperSrc.raw = paperSrc.count; paperSrc.count = paperFiltered.items.length; }

  return {
    news: news.items,
    papers: paperFiltered.items,
    repos: repos.repos,
    sources: { ...news.sources, ...papers.sources, ...repos.sources },
    warnings: [...news.warnings, ...papers.warnings, ...repos.warnings],
  };
}

async function runConfigCmd(args) {
  if (args.reset) {
    await resetConfig();
    process.stdout.write(`已清空 ${CONFIG_PATH}\n`);
    return;
  }
  const patch = pickCliConfig(args);
  if (args.show || Object.keys(patch).length === 0) {
    const cfg = await loadConfig();
    process.stdout.write(`${JSON.stringify(cfg, null, 2)}\n${CONFIG_PATH}\n`);
    return;
  }
  const next = { ...(await loadConfig()), ...patch };
  await saveConfig(next);
  process.stdout.write(`已保存到 ${CONFIG_PATH}\n${JSON.stringify(next, null, 2)}\n`);
}

export async function execute(type, query) {
  const runners = { news: runNews, papers: runPapers, repos: runRepos, all: runAll };
  const result = await runners[type](query);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const type = args._[0] || 'all';

  if (type === 'config') {
    await runConfigCmd(args);
    return;
  }
  if (type === 'schedule') {
    await printSchedule(args);
    return;
  }
  if (!['news', 'papers', 'repos', 'all'].includes(type)) {
    throw new Error(`未知子命令：${type}。可用：news / papers / repos / all / config / schedule`);
  }

  const cfg = await loadConfig();
  const cli = pickCliConfig(args);
  const keywords = (cli.keywords && cli.keywords.length)
    ? cli.keywords
    : (Array.isArray(cfg.keywords) && cfg.keywords.length ? cfg.keywords : parseKeywords(args.keywords));
  const days = num(args.days, cfg.days != null ? cfg.days : (type === 'news' ? 1 : 7));
  const limit = num(args.limit, cfg.limit != null ? cfg.limit : 20);

  const query = {
    type,
    keywords: keywords.length ? keywords : ['AI'],
    days,
    limit,
    minStars: num(args['min-stars'], cfg.minStars != null ? cfg.minStars : 30),
    minUpvotes: num(args['min-upvotes'], cfg.minUpvotes != null ? cfg.minUpvotes : 10),
    minPoints: num(args['min-points'], cfg.minPoints != null ? cfg.minPoints : 5),
    includeTrending: !!args['include-trending'] || cfg.includeTrending === true,
    paperFilter: !!args['paper-filter'] || cfg.paperFilter === true,
    paperKeywords: parseKeywords(args['paper-keywords']).length
      ? parseKeywords(args['paper-keywords'])
      : (Array.isArray(cfg.paperKeywords) && cfg.paperKeywords.length ? cfg.paperKeywords : keywords),
    repoKeywords: parseKeywords(args['repo-keywords']).length
      ? parseKeywords(args['repo-keywords'])
      : (Array.isArray(cfg.repoKeywords) && cfg.repoKeywords.length ? cfg.repoKeywords : keywords),
  };

  const result = await execute(type, query);

  const payload = {
    type,
    generatedAt: new Date().toISOString(),
    generatedAtBeijing: bjNow(),
    query,
    ...result,
  };

  const content = args.json
    ? `${JSON.stringify(payload, null, 2)}\n`
    : renderMarkdown(payload);

  if (args.out) {
    const dir = path.resolve(args.out);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `oss-radar-${type}-${stamp()}.${args.json ? 'json' : 'md'}`);
    await writeFile(file, content, 'utf8');
    process.stderr.write(`已写入 ${file}\n`);
  } else {
    process.stdout.write(content);
  }
}

import { pathToFileURL } from 'node:url';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`失败：${err.message}\n`);
    process.exit(1);
  });
}
