// 新闻源 · HN + 中文/英文 RSS + Bing News RSS（失效时自动标注）
//
// 所有条目保留真实 URL 和 source 字段。

import { httpGet, looksLikeXml } from './http.mjs';
import { searchHn } from './hn.mjs';
import { ghGet, hasGithubToken } from './github.mjs';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// RSS 源 · 都返回真实文章链接
const FEEDS = [
  { key: 'infoq', label: 'InfoQ', url: 'https://www.infoq.cn/feed' },
  { key: 'sspai', label: '少数派', url: 'https://sspai.com/feed' },
  { key: 'ifanr', label: '爱范儿', url: 'https://www.ifanr.com/feed' },
  { key: 'techcrunch', label: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
];

const SOURCE_ORDER = ['release', 'trending', 'hn', 'bing', 'infoq', 'sspai', 'ifanr', 'techcrunch'];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n =
        code[1].toLowerCase() === 'x'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function cleanText(s) {
  return decodeEntities(String(s || '').replace(/<!\[CDATA\[|\]\]>/g, ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSnippet(desc) {
  const s = cleanText(desc)
    .replace(/#?欢迎关注[^。\n]*公众号[^。\n]*。?/g, '')
    .replace(/更多精彩内容第一时间为您奉上。?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!s || /^点击查看原文/.test(s)) return '';
  return s;
}

function pick(block, re) {
  return (block.match(re) || [])[1] || '';
}

function toIso(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  let t = d.getTime();
  // 部分中文 RSS（如 InfoQ）把本地时间标成 GMT，解析后会比当前时间晚 8 小时。
  // 超前 2 小时以上的日期按“误标 GMT”回退 8 小时。
  if (t > Date.now() + 2 * 3600 * 1000) t -= 8 * 3600 * 1000;
  return new Date(t).toISOString();
}

/** 解析 RSS 2.0 / Atom · 返回 {title,url,snippet,publishedAt} */
export function parseRss(xml) {
  const out = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of items) {
    const title = cleanText(pick(block, /<title[^>]*>([\s\S]*?)<\/title>/i));
    const url = cleanText(
      pick(block, /<link[^>]*>([\s\S]*?)<\/link>/i) ||
        pick(block, /<link[^>]*href="([^"]+)"/i)
    );
    const desc =
      pick(block, /<description[^>]*>([\s\S]*?)<\/description>/i) ||
      pick(block, /<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
    const date = pick(block, /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    if (title && url) {
      out.push({ title, url, snippet: cleanSnippet(desc), publishedAt: toIso(date) });
    }
  }
  if (out.length) return out;

  const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const block of entries) {
    const title = cleanText(pick(block, /<title[^>]*>([\s\S]*?)<\/title>/i));
    const url = cleanText(pick(block, /<link[^>]*href="([^"]+)"/i));
    const desc =
      pick(block, /<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
      pick(block, /<content[^>]*>([\s\S]*?)<\/content>/i);
    const date =
      pick(block, /<published[^>]*>([\s\S]*?)<\/published>/i) ||
      pick(block, /<updated[^>]*>([\s\S]*?)<\/updated>/i);
    if (title && url) {
      out.push({ title, url, snippet: cleanSnippet(desc), publishedAt: toIso(date) });
    }
  }
  return out;
}

/** 关键词匹配
 *  - 中文关键词：子串匹配
 *  - 多词英文关键词：整句短语匹配(AI Coding 不会再因为命中了 AI 就算)
 *  - 单词英文关键词：按单词边界匹配,允许 agents / agentic 这类后缀
 */
export function matchesKeywords(title, snippet, keywords) {
  if (!keywords || keywords.length === 0) return true;
  const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ');
  const t = norm(title);
  const all = `${t} ${norm(snippet)}`;
  const hitWord = (hay, w) => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const suffix = w.length >= 3 ? '(?:s|es|ic|ing)?' : '';
    return new RegExp(`(^|[^a-z0-9])${escaped}${suffix}([^a-z0-9]|$)`, 'i').test(hay);
  };
  const hitOne = (kw) => {
    if (!kw) return false;
    if (/[\u4e00-\u9fff]/.test(kw)) return all.includes(kw);
    const words = kw.split(' ').filter(Boolean);
    if (words.length > 1) {
      // 多词:整句短语命中,或所有词都出现在标题里(避免正文里零散出现两个词就算命中)
      return all.includes(words.join(' ')) || words.every((w) => hitWord(t, w));
    }
    return hitWord(all, words[0]);
  };
  return keywords.some((k) => hitOne(k.toLowerCase().trim()));
}

/** Bing News 的跳转链接还原成真实文章地址 */
function unwrapBingUrl(u) {
  try {
    const real = new URL(u).searchParams.get('url');
    return real || u;
  } catch {
    return u;
  }
}

async function fetchFeed(feed) {
  const res = await httpGet(feed.url, {
    timeoutMs: 20000,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!looksLikeXml(res.text)) throw new Error('返回内容不是 XML');
  return parseRss(res.text).map((x) => ({ ...x, source: feed.key }));
}

async function fetchBingNews(keywords) {
  const sources = { bing: { ok: true, count: 0 } };
  const warnings = [];
  const items = [];
  for (const kw of keywords.length ? keywords : ['AI']) {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(kw)}&format=rss`;
    const res = await httpGet(url, {
      timeoutMs: 15000,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml' },
    });
    if (!res.ok) {
      sources.bing.ok = false;
      sources.bing.note = `HTTP ${res.status}`;
      continue;
    }
    if (!looksLikeXml(res.text)) {
      sources.bing.ok = false;
      sources.bing.note = 'RSS 接口已返回 HTML（上游不再提供 RSS）';
      break;
    }
    for (const x of parseRss(res.text)) {
      items.push({ ...x, source: 'bing', url: unwrapBingUrl(x.url) });
    }
  }
  sources.bing.count = items.length;
  if (!sources.bing.ok) warnings.push(`Bing News RSS 不可用：${sources.bing.note}`);
  return { items, sources, warnings };
}

function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) {
      if (/^(utm_|from|spm|share)/i.test(k)) x.searchParams.delete(k);
    }
    return x.toString().replace(/\/$/, '');
  } catch {
    return String(u || '');
  }
}

function normTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, '');
}

/** 按来源优先级轮流取，避免某一源把 limit 占满 */
function interleave(groups, limit) {
  const out = [];
  const max = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < max && out.length < limit; i++) {
    for (const g of groups) {
      if (i < g.length && out.length < limit) out.push(g[i]);
    }
  }
  return out;
}

// 关注的产品 / 模型 repo · 有新 release 当高信号新闻
const TRACKED_REPOS = [
  'anthropics/claude-code',
  'openai/codex',
  'getcursor/cursor',
  'deepseek-ai/DeepSeek-V3',
  'deepseek-ai/DeepSeek-Coder',
  'QwenLM/Qwen2.5',
  'meta-llama/llama',
  'modelcontextprotocol/servers',
];

// 新项目发现 · 打上这些 topic 且近期创建、star 涨起来的自动进候选
const AI_TOPICS = ['llm', 'ai-agent', 'large-language-model', 'mcp', 'ai-coding'];

const ghDelay = () => (hasGithubToken() ? 250 : 1200);

async function searchGithubReleases(days, warnings, repos = TRACKED_REPOS) {
  const since = Date.now() - days * 86400 * 1000;
  const items = [];
  for (const repo of repos) {
    try {
      const releases = await ghGet(`/repos/${repo}/releases?per_page=3`);
      if (Array.isArray(releases)) {
        for (const rel of releases) {
          if (rel.prerelease) continue;
          const ts = rel.published_at ? new Date(rel.published_at).getTime() : 0;
          if (!ts || ts < since) continue;
          items.push({
            title: `${repo.split('/')[1]} ${rel.tag_name || ''} release`.trim(),
            url: rel.html_url,
            source: 'release',
            snippet: String(rel.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300),
            publishedAt: rel.published_at,
            score: 1000 - items.length,
          });
        }
      }
    } catch (e) {
      warnings.push(`GitHub Release ${repo} 拉取失败：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, ghDelay()));
  }
  return items;
}

async function searchTrendingAiRepos(days, minStars, warnings, topics = AI_TOPICS) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);
  const items = [];
  for (const topic of topics) {
    try {
      const q = encodeURIComponent(`topic:${topic} created:>${since} stars:>=${minStars}`);
      const body = await ghGet(`/search/repositories?q=${q}&sort=stars&order=desc&per_page=5`);
      for (const r of (body && body.items) || []) {
        items.push({
          title: r.full_name,
          url: r.html_url,
          source: 'trending',
          snippet: r.description || '',
          publishedAt: r.created_at,
          score: r.stargazers_count || 0,
        });
      }
    } catch (e) {
      warnings.push(`GitHub Trending ${topic} 拉取失败：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, ghDelay()));
  }
  return items;
}

/**
 * @param {{keywords?:string[], days?:number, limit?:number, minPoints?:number}} opts
 * @returns {Promise<{items:Array, sources:object, warnings:string[]}>}
 */
export async function searchNews(opts = {}) {
  const keywords = opts.keywords && opts.keywords.length ? opts.keywords : ['AI'];
  const days = opts.days ?? 1;
  const limit = opts.limit ?? 20;
  const minPoints = opts.minPoints ?? 5;

  const warnings = [];
  const sources = {};
  const feedJobs = FEEDS.map(async (f) => {
    try {
      const items = await fetchFeed(f);
      return { key: f.key, items, ok: true };
    } catch (err) {
      return { key: f.key, items: [], ok: false, note: err.message };
    }
  });

  const [hn, bing, releases, trending, ...feedResults] = await Promise.all([
    searchHn({ keywords, days, limit, minPoints }).catch((err) => ({
      items: [],
      sources: { hn: { ok: false, note: err.message } },
      warnings: [`HN 搜索失败：${err.message}`],
    })),
    fetchBingNews(keywords).catch((err) => ({
      items: [],
      sources: { bing: { ok: false, note: err.message } },
      warnings: [`Bing News RSS 不可用：${err.message}`],
    })),
    searchGithubReleases(days, warnings, opts.trackedRepos),
    searchTrendingAiRepos(days, 50, warnings, opts.aiTopics),
    ...feedJobs,
  ]);

  if (sources.hn) sources.hn.raw = sources.hn.count ?? hn.items.length;
  if (sources.bing) sources.bing.raw = sources.bing.count ?? bing.items.length;
  Object.assign(sources, hn.sources, bing.sources);
  sources.release = { ok: true, count: releases.length, label: 'GitHub Releases' };
  sources.trending = { ok: true, count: trending.length, label: 'GitHub Trending' };
  if (sources.hn) sources.hn.raw = sources.hn.count ?? hn.items.length;
  if (sources.bing) sources.bing.raw = sources.bing.count ?? bing.items.length;
  warnings.push(...hn.warnings); // Bing 失败只写源状态,不重复塞进提示

  const groups = new Map();
  const addItem = (key, item) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  };

  for (const it of releases) addItem('release', it);
  for (const it of trending) addItem('trending', it);
  for (const it of hn.items) {
    // Algolia 是 OR 匹配，命中词可能只出现在正文；再按标题 + 摘要收一遍
    if (matchesKeywords(it.title, it.snippet, keywords)) addItem('hn', it);
  }
  for (const it of bing.items) {
    if (matchesKeywords(it.title, it.snippet, keywords)) addItem('bing', it);
  }
  for (const r of feedResults) {
    sources[r.key] = { ok: r.ok, count: 0, raw: r.items.length, ...(r.note ? { note: r.note } : {}) };
    if (!r.ok) {
      warnings.push(`${r.key} RSS 拉取失败：${r.note}`);
      continue;
    }
    for (const it of r.items) {
      if (matchesKeywords(it.title, it.snippet, keywords)) {
        addItem(r.key, { ...it, score: 0 });
      }
    }
    sources[r.key].count = (groups.get(r.key) || []).length;
  }

  // 源状态里的 count 统一成"过滤后命中数"，避免和最终结果条数对不上
  if (sources.hn) sources.hn.count = (groups.get('hn') || []).length;
  if (sources.bing) sources.bing.count = (groups.get('bing') || []).length;

  // 组内排序：HN 按热度，RSS 按发布时间
  for (const [key, arr] of groups) {
    arr.sort((a, b) => {
      if (key === 'hn' || key === 'trending') return (b.score || 0) - (a.score || 0);
      return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
    });
  }

  // 全局去重（URL + 标题），按来源优先级
  const seenUrl = new Set();
  const seenTitle = new Set();
  const orderedGroups = [];
  for (const key of SOURCE_ORDER) {
    const arr = groups.get(key) || [];
    const kept = [];
    for (const it of arr) {
      const u = normUrl(it.url);
      const t = normTitle(it.title);
      if (!u || seenUrl.has(u) || (t && seenTitle.has(t))) continue;
      seenUrl.add(u);
      if (t) seenTitle.add(t);
      kept.push(it);
    }
    if (kept.length) orderedGroups.push(kept);
  }

  const items = interleave(orderedGroups, limit);
  return { items, sources, warnings };
}
