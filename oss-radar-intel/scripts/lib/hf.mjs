// HuggingFace Daily Papers · 按天拉近 N 天 · 按论文 id 去重 · 点赞排序
//
// 端点：https://huggingface.co/api/daily_papers?date=YYYY-MM-DD&limit=100
// 免鉴权 · 按 UTC 日期出榜 · 周末可能无新榜

import { getJson } from './http.mjs';

const API = 'https://huggingface.co/api/daily_papers';

function utcYmd(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400 * 1000).toISOString().slice(0, 10);
}

function githubUrl(repo) {
  if (!repo) return '';
  const s = String(repo).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return `https://github.com/${s}`;
  return '';
}

function normalize(entry) {
  const p = (entry && entry.paper) || {};
  if (!p.id || !p.title) return null;
  const org =
    (p.organization && (p.organization.fullname || p.organization.name)) || '';
  return {
    source: 'hf-daily-papers',
    id: String(p.id),
    title: String(p.title).replace(/\s+/g, ' ').trim(),
    url: `https://huggingface.co/papers/${p.id}`,
    upvotes: Number(p.upvotes) || 0,
    summary: String(p.ai_summary || p.summary || '').replace(/\s+/g, ' ').trim(),
    org: String(org),
    authors: Array.isArray(p.authors)
      ? p.authors.map((a) => a.name).filter(Boolean).slice(0, 8)
      : [],
    githubRepo: githubUrl(p.githubRepo),
    githubStars: p.githubStars == null ? null : Number(p.githubStars),
    publishedAt: p.publishedAt || null,
    submittedAt: p.submittedOnDailyAt || null,
    day: '',
  };
}

async function fetchDay(day) {
  const body = await getJson(`${API}?date=${day}&limit=100`, { timeoutMs: 20000 });
  return Array.isArray(body) ? body : [];
}

/**
 * @param {{days?:number, minUpvotes?:number, limit?:number}} opts
 * @returns {Promise<{items:Array, sources:object, warnings:string[]}>}
 */
export async function fetchPapers(opts = {}) {
  const days = opts.days ?? 7;
  const minUpvotes = opts.minUpvotes ?? 10;
  const limit = opts.limit ?? 20;
  const dayList = Array.from({ length: days }, (_, i) => utcYmd(i));

  const warnings = [];
  const sources = { 'hf-daily-papers': { ok: true, count: 0 } };
  const settled = await Promise.allSettled(dayList.map(fetchDay));

  const byId = new Map();
  let okDays = 0;
  settled.forEach((s, i) => {
    if (s.status !== 'fulfilled') {
      warnings.push(`HF ${dayList[i]} 拉取失败：${s.reason.message}`);
      return;
    }
    okDays++;
    for (const entry of s.value) {
      const p = normalize(entry);
      if (!p || p.upvotes < minUpvotes || byId.has(p.id)) continue;
      p.day = dayList[i];
      byId.set(p.id, p);
    }
  });

  if (okDays === 0) {
    sources['hf-daily-papers'].ok = false;
    sources['hf-daily-papers'].note = '近 N 天全部拉取失败';
  }

  const items = [...byId.values()]
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, limit);
  sources['hf-daily-papers'].count = items.length;
  return { items, sources, warnings };
}
