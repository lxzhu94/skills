// Hacker News Algolia · 按关键词搜近 N 天 story · 免鉴权

import { getJson, sleep } from './http.mjs';

const API = 'https://hn.algolia.com/api/v1/search';
const DEFAULT_MIN_POINTS = 5;

function hnItemUrl(objectID) {
  return `https://news.ycombinator.com/item?id=${objectID}`;
}

function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n =
        code[1].toLowerCase() === 'x'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return named[code.toLowerCase()] ?? m;
  });
}

/**
 * @param {{keywords?:string[], days?:number, limit?:number, minPoints?:number}} opts
 * @returns {Promise<{items:Array, sources:object, warnings:string[]}>}
 */
export async function searchHn(opts = {}) {
  const keywords = (opts.keywords && opts.keywords.length ? opts.keywords : ['AI']);
  const days = opts.days ?? 1;
  const limit = Math.min(opts.limit ?? 20, 100);
  const minPoints = opts.minPoints ?? DEFAULT_MIN_POINTS;
  const since = Math.floor((Date.now() - days * 86400 * 1000) / 1000);

  const warnings = [];
  const sources = { hn: { ok: true, count: 0 } };
  const byId = new Map();

  for (let i = 0; i < keywords.length; i++) {
    if (i > 0) await sleep(400); // HN 无明确限流，少量间隔避免激怒上游
    const url =
      `${API}?query=${encodeURIComponent(keywords[i])}&tags=story` +
      `&numericFilters=created_at_i>${since},points>=${minPoints}` +
      `&hitsPerPage=${Math.min(limit, 50)}`;
    try {
      const body = await getJson(url);
      for (const h of body.hits || []) {
        const id = String(h.objectID || '');
        if (!id || byId.has(id)) continue;
        byId.set(id, {
          source: 'hn',
          id: `hn-${id}`,
          title: decodeEntities(h.title || h.story_title || '').trim(),
          url: h.url || hnItemUrl(id),
          hnUrl: hnItemUrl(id),
          score: Number(h.points) || 0,
          snippet: decodeEntities(
            String(h.story_text || '').replace(/<[^>]+>/g, '')
          ).trim().slice(0, 200),
          publishedAt: h.created_at || null,
          author: h.author || '',
          matchedKeyword: keywords[i],
        });
      }
    } catch (err) {
      sources.hn.ok = false;
      sources.hn.note = err.message;
      warnings.push(`HN 搜索失败（${keywords[i]}）：${err.message}`);
    }
  }

  const items = [...byId.values()]
    .filter((x) => x.title)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  sources.hn.count = items.length;
  return { items, sources, warnings };
}
