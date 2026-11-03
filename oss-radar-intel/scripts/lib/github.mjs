// GitHub Search API · 近 N 天新建 + star 门槛的关键词项目
//
// 端点：GET https://api.github.com/search/repositories
// 限流：无 token 10 次/分钟，带 token 30 次/分钟
// 只打 Search 一个端点，不逐 repo 拉详情，避免 core API 额度被吃光。

import { getJson, sleep } from './http.mjs';
import { execFileSync } from 'node:child_process';

const API = 'https://api.github.com';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

let _cachedToken;
/** 有 GITHUB_TOKEN 用 env；没有就尝试本机已登录的 gh CLI，避免匿名限流 */
function resolveToken() {
  if (_cachedToken !== undefined) return _cachedToken;
  if (process.env.GITHUB_TOKEN) { _cachedToken = process.env.GITHUB_TOKEN; return _cachedToken; }
  try {
    _cachedToken = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    _cachedToken = '';
  }
  return _cachedToken;
}

/** 直接打 GitHub API · 给 releases / search 用 */
export async function ghGet(path) {
  const token = resolveToken();
  return getJson(`${API}${path}`, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export function hasGithubToken() {
  return !!resolveToken();
}

function normalizeRepo(r, keyword) {
  return {
    source: 'github',
    id: r.full_name,
    name: r.name,
    owner: r.owner && r.owner.login,
    url: r.html_url,
    description: r.description || '',
    stars: Number(r.stargazers_count) || 0,
    forks: Number(r.forks_count) || 0,
    language: r.language || '',
    topics: Array.isArray(r.topics) ? r.topics : [],
    license: (r.license && r.license.spdx_id) || '',
    createdAt: r.created_at || null,
    pushedAt: r.pushed_at || null,
    matchedKeyword: keyword,
  };
}

/**
 * @param {{keywords?:string[], days?:number, minStars?:number, limit?:number, token?:string}} opts
 * @returns {Promise<{items:Array, sources:object, warnings:string[]}>}
 */
export async function searchRepos(opts = {}) {
  const keywords = opts.keywords && opts.keywords.length ? opts.keywords : ['AI'];
  const days = opts.days ?? 7;
  const minStars = opts.minStars ?? 30;
  const limit = opts.limit ?? 20;
  const token = opts.token || resolveToken();
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);

  const warnings = [];
  const sources = { github: { ok: true, count: 0 } };
  const byId = new Map();

  for (let i = 0; i < keywords.length; i++) {
    // 无 token 时留足间隔，贴近 10 次/分钟；有 token 也留一点余量
    if (i > 0) await sleep(token ? 800 : 6500);
    const q = `${keywords[i]} created:>${since} stars:>=${minStars}`;
    const url =
      `${API}/search/repositories?q=${encodeURIComponent(q)}` +
      `&sort=stars&order=desc&per_page=${Math.min(limit, 100)}`;
    try {
      const body = await getJson(url, {
        timeoutMs: 20000,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      for (const r of body.items || []) {
        if (!r.full_name || byId.has(r.full_name)) continue;
        byId.set(r.full_name, normalizeRepo(r, keywords[i]));
      }
    } catch (err) {
      // 403 / 429 限流：立即停止剩余关键词，保留已拿到的结果
      const isRate = /HTTP (403|429)/.test(err.message);
      sources.github.ok = false;
      sources.github.note = isRate
        ? '触发 GitHub 限流，已跳过剩余关键词'
        : err.message;
      warnings.push(
        isRate
          ? `GitHub 限流（关键词「${keywords[i]}」跳过）。设置 GITHUB_TOKEN 可提升额度。`
          : `GitHub 搜索失败（${keywords[i]}）：${err.message}`
      );
      if (isRate) break;
    }
  }

  const items = [...byId.values()]
    .sort((a, b) => b.stars - a.stars)
    .slice(0, limit);
  sources.github.count = items.length;
  return { items, sources, warnings };
}

// OSSInsight trending · 可选补充源
// 端点：GET https://api.ossinsight.io/v1/trends/repos?period=past_week&language=All
// 上游 2026-03 起事件采集停更，常返空；空结果按“不可用”降级，不报错。
export async function fetchOssInsightTrending(opts = {}) {
  const period = opts.period || 'past_week';
  const limit = opts.limit ?? 20;
  const sources = { ossinsight: { ok: true, count: 0 } };
  const warnings = [];
  try {
    const body = await getJson(
      `https://api.ossinsight.io/v1/trends/repos?period=${encodeURIComponent(period)}&language=All`,
      { timeoutMs: 20000, headers: { 'User-Agent': BROWSER_UA } }
    );
    const rows = (body && body.data && body.data.rows) || [];
    if (rows.length === 0) {
      sources.ossinsight.ok = false;
      sources.ossinsight.note = '上游事件采集停更，trending 暂不可用';
      return { items: [], sources, warnings };
    }
    const items = [];
    for (const r of rows.slice(0, limit)) {
      const full = String(r.repo_name || '');
      const idx = full.indexOf('/');
      if (idx < 1) continue;
      const owner = full.slice(0, idx);
      const name = full.slice(idx + 1);
      items.push({
        source: 'ossinsight',
        id: full,
        name,
        owner,
        url: `https://github.com/${owner}/${name}`,
        description: r.description || '',
        stars: Number(r.stars) || 0,
        forks: Number(r.forks) || 0,
        language: r.primary_language || '',
        topics: [],
        license: '',
        createdAt: null,
        pushedAt: null,
        trendScore: Number(r.total_score) || 0,
        matchedKeyword: '',
      });
    }
    sources.ossinsight.count = items.length;
    return { items, sources, warnings };
  } catch (err) {
    sources.ossinsight.ok = false;
    sources.ossinsight.note = err.message;
    warnings.push(`OSSInsight trending 不可用：${err.message}`);
    return { items: [], sources, warnings };
  }
}
