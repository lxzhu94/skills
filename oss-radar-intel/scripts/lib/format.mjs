// Markdown / 控制台格式化 · 面向人的时间一律北京时间（UTC+8）

const SOURCE_LABELS = {
  hn: 'Hacker News',
  bing: 'Bing News RSS',
  infoq: 'InfoQ',
  sspai: '少数派',
  ifanr: '爱范儿',
  techcrunch: 'TechCrunch',
  github: 'GitHub',
  ossinsight: 'OSSInsight',
  'hf-daily-papers': 'HuggingFace Daily Papers',
  release: '产品 Release',
  trending: 'GitHub Trending',
};

/** UTC ISO → 北京时间 "YYYY-MM-DD HH:mm" */
export function bjDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
}

/** UTC ISO → 北京时间 "YYYY-MM-DD" */
export function bjDate(iso) {
  const s = bjDateTime(iso);
  return s ? s.slice(0, 10) : '';
}

/** 当前北京时间 "YYYY-MM-DD HH:mm" */
export function bjNow() {
  return bjDateTime(new Date().toISOString());
}

function mdText(s) {
  return String(s || '').replace(/[\r\n]+/g, ' ').replace(/[[\]]/g, '\\$&').trim();
}

function mdUrl(u) {
  return String(u || '').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
}

function fmtNum(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function sourceLabel(key) {
  return SOURCE_LABELS[key] || key;
}

function renderNews(items) {
  if (!items.length) return ['_无结果_'];
  const lines = [];
  for (const it of items) {
    if (Array.isArray(it.sources) && it.sources.length) {
      lines.push(`- **${mdText(it.title)}**`);
      if (it.summary) lines.push(`  ${mdText(it.summary)}`);
      const src = it.sources.map((x) => `[${x.name || x.url}](<${mdUrl(x.url)}>)`).join('｜');
      if (src) lines.push(`  来源：${src}`);
      lines.push('');
      continue;
    }
    const meta = [`\`${sourceLabel(it.source)}\``];
    if (it.score) meta.push(`${it.score} 分`);
    if (it.publishedAt) meta.push(bjDateTime(it.publishedAt));
    lines.push(`- **[${mdText(it.title)}](<${mdUrl(it.url)}>)** · ${meta.join(' · ')}`);
    if (it.snippet) lines.push(`  > ${mdText(it.snippet)}`);
    lines.push('');
  }
  return lines;
}

function renderPapers(items) {
  if (!items.length) return ['_无结果_'];
  const lines = [];
  for (const p of items) {
    const meta = [`👍 ${p.upvotes}`];
    if (p.org) meta.push(mdText(p.org));
    if (p.authors && p.authors.length) {
      const a = p.authors.slice(0, 3).join(', ');
      meta.push(p.authors.length > 3 ? `${a} 等` : a);
    }
    lines.push(`- **[${mdText(p.title)}](<${mdUrl(p.url)}>)** · ${meta.join(' · ')}`);
    if (p.githubRepo) {
      const stars = p.githubStars == null ? '' : ` · ★ ${fmtNum(p.githubStars)}`;
      lines.push(`  GitHub：${mdUrl(p.githubRepo)}${stars}`);
    }
    if (p.summary) {
      const s = p.summary.length > 400 ? `${p.summary.slice(0, 400)}…` : p.summary;
      lines.push(`  > ${mdText(s)}`);
    }
    lines.push('');
  }
  return lines;
}

function renderRepos(items) {
  if (!items.length) return ['_无结果_'];
  const lines = [];
  for (const r of items) {
    const meta = [`★ ${fmtNum(r.stars)}`];
    if (r.language) meta.push(mdText(r.language));
    if (r.license) meta.push(mdText(r.license));
    lines.push(`- **[${mdText(r.id)}](<${mdUrl(r.url)}>)** · ${meta.join(' · ')}`);
    const facts = [];
    if (r.createdAt) facts.push(`创建于 ${bjDate(r.createdAt)}`);
    if (r.pushedAt) facts.push(`最近推送 ${bjDate(r.pushedAt)}`);
    if (r.topics && r.topics.length) {
      facts.push(r.topics.slice(0, 5).map((t) => `\`${t}\``).join(' '));
    }
    if (r.description) lines.push(`  > ${mdText(r.description)}`);
    if (facts.length) lines.push(`  ${facts.join(' · ')}`);
    lines.push('');
  }
  return lines;
}

function renderSources(sources) {
  const entries = Object.entries(sources || {});
  if (!entries.length) return ['_无_'];
  return entries.map(([key, s]) => {
    const label = `${sourceLabel(key)}（\`${key}\`）`;
    const count = s.count ?? 0;
    if (s.ok === false && count > 0) return `- ${label}：部分可用 — 已取 ${count} 条 · ${mdText(s.note || '部分关键词失败')}`;
    if (s.ok === false) return `- ${label}：不可用 — ${mdText(s.note || '未知原因')}`;
    if (count === 0) {
      const rawHint = s.raw > 0 ? `候选 ${s.raw} 条` : '源返回 0 条';
      return `- ${label}：0 条命中（${rawHint}）`;
    }
    if (s.raw > count) return `- ${label}：${count} 条（候选 ${s.raw} 条）`;
    return `- ${label}：${count} 条`;
  });
}

/**
 * @param {{type:string, query:object, generatedAt:string, news?:Array, papers?:Array, repos?:Array, sources?:object, warnings?:string[]}} payload
 */
export function renderMarkdown(payload) {
  const q = payload.query || {};
  const kws = (q.keywords || []).map((k) => `\`${k}\``).join('、');
  const scope = q.days ? `近 ${q.days} 天` : '';
  const lines = [];

  lines.push(`# AI 情报雷达 · ${bjNow()}（北京时间）`);
  lines.push('');
  lines.push([kws ? `关键词：${kws}` : '', scope].filter(Boolean).join(' ｜ '));
  if (q.days && (payload.type === 'all' || payload.type === 'news')) {
    lines.push('');
    lines.push('_注：RSS 新闻源只取最新条目，不受回溯天数限制。_');
  }
  lines.push('');

  if (payload.type === 'all' || payload.type === 'news') {
    lines.push(`## 新闻 · ${payload.news.length} 条`);
    lines.push('');
    lines.push(...renderNews(payload.news));
    lines.push('');
  }
  if (payload.type === 'all' || payload.type === 'papers') {
    lines.push(`## 论文 · ${payload.papers.length} 篇`);
    lines.push('');
    lines.push(...renderPapers(payload.papers));
    if (q.paperFilter !== true && q.keywords && q.keywords.length) {
      lines.push('_论文来自 HuggingFace 热榜，未按关键词过滤；只想看相关方向可加 --paper-filter。_');
    } else if (q.paperFilter === true && q.paperKeywords && q.paperKeywords.length) {
      lines.push(`_论文已按关键词 ${q.paperKeywords.map((k) => `\`${k}\``).join('、')} 过滤。_`);
    }
    lines.push('');
  }
  if (payload.type === 'all' || payload.type === 'repos') {
    lines.push(`## 开源项目 · ${payload.repos.length} 个`);
    lines.push('');
    lines.push(...renderRepos(payload.repos));
    lines.push('');
  }

  lines.push('## 源状态');
  lines.push('');
  lines.push(...renderSources(payload.sources));
  const newsKeys = new Set(['hn', 'bing', 'infoq', 'sspai', 'ifanr', 'techcrunch']);
  const newsHits = Object.entries(payload.sources || {})
    .filter(([k]) => newsKeys.has(k))
    .reduce((n, [, v]) => n + (v.count || 0), 0);
  if (payload.news && newsHits > payload.news.length) {
    lines.push('');
    lines.push(`_源状态是关键词命中数;本次按 --limit 输出 ${payload.news.length} 条。_`);
  }
  if ((payload.type === 'news' || payload.type === 'all') && payload.news && payload.news.length === 0) {
    lines.push('');
    lines.push('_没有命中。可以换更宽的关键词(如 AI、Agent),或加大 --days。_');
  }

  const warnings = [...new Set(payload.warnings || [])];
  if (warnings.length) {
    lines.push('');
    lines.push('## 提示');
    lines.push('');
    for (const w of warnings) lines.push(`- ${mdText(w)}`);
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
