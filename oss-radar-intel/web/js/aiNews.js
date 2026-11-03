/* aiNews.js — 每日 AI 新闻页面渲染
 * ES module · import { initAiNewsPage } from './aiNews.js'
 * 消费 GET /api/ai-news?limit=30 · 按 _id (YMD) 倒序展示日期分组
 * 每 item 一张卡片 · sources 列表在 footer badge
 * 严格 h() + textContent · 无 innerHTML = str
 */

import { h, $, progress, renderLoading } from './util.js';
import { resolveTeamContext, mountTopNav } from './teamHeader.js';
import { renderPager } from './main.js';

/* ---------- fetch wrapper · 顶栏进度条 ---------- */
async function api(path) {
  progress.start();
  try {
    const rel = path.replace(/^\//, '');
    const res = await fetch(rel, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body && body.ok === false) throw new Error(body.error || 'API error');
    return body && 'data' in body ? body.data : body;
  } finally {
    progress.done();
  }
}

/* ---------- states · 与 main.js 保持一致 ---------- */
// renderLoading 从 util.js 统一导入 · 保留 renderEmpty/renderError 就地实现(文案差异化)
function renderEmpty(root, msg) {
  root.innerHTML = '';
  root.appendChild(h('div', { class: 'state' }, [
    h('div', { class: 'icon' }, '·  ·  ·'),
    h('div', {}, msg || '暂无 AI 新闻记录 · 每天 10:00 联网自动生成'),
  ]));
}
function renderError(root, err) {
  root.innerHTML = '';
  root.appendChild(h('div', { class: 'state error' }, [
    h('div', { class: 'icon' }, '×'),
    h('div', {}, 'API 拉取失败'),
    h('div', {
      style: {
        marginTop: '8px',
        fontSize: '12px',
        color: 'var(--text-tertiary)',
        fontFamily: 'var(--font-mono)',
      },
    }, String(err && err.message || err)),
  ]));
}

/* ---------- item card · 一条 AI 新闻 ---------- */
function renderNewsItem(item, idx) {
  const title = item && item.title || '(未命名)';
  const summary = item && item.summary || '';
  const sources = Array.isArray(item && item.sources) ? item.sources : [];

  // 标题 · 首条 source 作为主链接 · 不然纯文本
  const primaryUrl = sources.find((s) => s && s.url && /^https?:/.test(s.url));
  const titleEl = primaryUrl
    ? h('div', { class: 'repo-name' }, [
        h('a', { href: primaryUrl.url, target: '_blank', rel: 'noopener' }, [
          h('span', { class: 'owner' }, `${idx + 1}. `),
          title,
        ]),
      ])
    : h('div', { class: 'repo-name' }, [
        h('span', { class: 'owner' }, `${idx + 1}. `),
        title,
      ]);

  const head = h('div', { class: 'repo-head' }, [titleEl]);
  const body = [head];
  if (summary) body.push(h('div', { class: 'repo-oneliner' }, summary));

  if (sources.length) {
    const footer = h('div', { class: 'repo-footer' });
    sources.forEach((s) => {
      if (!s) return;
      const name = s.name || '来源';
      if (s.url && /^https?:/.test(s.url)) {
        footer.appendChild(h('a', {
          class: 'badge',
          href: s.url,
          target: '_blank',
          rel: 'noopener',
        }, name));
      } else {
        footer.appendChild(h('span', { class: 'badge' }, name));
      }
    });
    body.push(footer);
  }

  return h('div', { class: 'repo-card' }, [h('div', { class: 'repo-body' }, body)]);
}

/* ---------- day section · 一天所有条目 ---------- */
function renderDaySection(doc) {
  // ponytail: _id 是 `${chatId}:${ymd}` 复合键 · 不能显示给用户 · 用 date 字段(老数据兜底截 _id 后 10 位)
  const ymd = (doc && doc.date) || (doc && typeof doc._id === 'string' ? doc._id.slice(-10) : '');
  const overview = doc && doc.overview || '';
  const items = Array.isArray(doc && doc.items) ? doc.items : [];
  // ponytail: capturedAt 是 UTC ISO · 展示统一转北京 · +8h 后 slice(11,16)
  const captured = doc && doc.capturedAt
    ? new Date(new Date(doc.capturedAt).getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16)
    : '';

  const wrap = document.createDocumentFragment();

  const titleText = captured ? `${ymd} · ${captured}` : ymd;
  wrap.appendChild(h('h2', { class: 'section-subtitle' }, titleText));

  if (overview) {
    wrap.appendChild(h('div', {
      class: 'page-meta',
      style: { marginBottom: '12px' },
    }, overview));
  }

  if (!items.length) {
    wrap.appendChild(h('div', { class: 'state' }, [
      h('div', {}, '当天无条目'),
    ]));
    return wrap;
  }

  const list = h('div', { class: 'repo-list' });
  items.forEach((it, i) => list.appendChild(renderNewsItem(it, i)));
  wrap.appendChild(list);

  // 论文推荐 · 每篇复用新闻卡片 · footer 放论文 / 代码 / 点赞
  const papers = Array.isArray(doc && doc.papers) ? doc.papers : [];
  if (papers.length) {
    wrap.appendChild(h('h2', { class: 'section-subtitle' }, '📄 论文推荐'));
    const paperList = h('div', { class: 'repo-list' });
    papers.forEach((p, i) => {
      const sources = [{ name: '论文', url: p.url }];
      if (p.githubRepo) sources.push({ name: p.githubStars ? `代码 ★${p.githubStars}` : '代码', url: p.githubRepo });
      if (p.upvotes) sources.push({ name: `${p.upvotes} 赞` });
      paperList.appendChild(renderNewsItem({ title: p.title, summary: p.summary, sources }, i));
    });
    wrap.appendChild(paperList);
  }

  return wrap;
}

/* ---------- archive · 分页历史列表 · 点击行展开当日 ---------- */
const ARCHIVE_PAGE_SIZE = 12;

function renderArchiveRow(day, teamQ, onOpen) {
  const ymd = day.date || '';
  const cnt = Number(day.itemCount) || 0;
  const overview = String(day.overview || '');
  const overviewShort = overview.length > 60 ? overview.slice(0, 60) + '…' : overview;
  const href = `ai-news.html?date=${encodeURIComponent(ymd)}${teamQ ? '&' + teamQ.slice(1) : ''}`;
  return h('tr', {
    style: { cursor: 'pointer' },
    onclick: (e) => {
      // 中键 / 修饰键 → 让浏览器走 <a> 打开新 tab · 阻止 row click
      if (e.target && e.target.tagName === 'A') return;
      if (typeof onOpen === 'function') onOpen(ymd);
    },
  }, [
    h('td', { class: 'week-col' }, h('a', { href }, ymd || '(无日期)')),
    h('td', { class: 'count-col' }, String(cnt)),
    h('td', {}, overviewShort || h('span', { style: { color: 'var(--text-tertiary)' } }, '(无摘要)')),
  ]);
}

async function renderArchive(root, team, onOpenDay) {
  const teamQ = team ? `?team=${encodeURIComponent(team)}` : '';
  let page = 1;

  async function loadPage(p) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'state', style: { padding: '20px' } }, [h('div', {}, '加载中…')]));
    const offset = (p - 1) * ARCHIVE_PAGE_SIZE;
    const q = `limit=${ARCHIVE_PAGE_SIZE}&offset=${offset}` + (team ? `&team=${encodeURIComponent(team)}` : '');
    try {
      const data = await api(`/api/ai-news/list?${q}`);
      const days = (data && data.days) || [];
      const total = Number(data && data.total) || 0;
      root.innerHTML = '';
      if (!days.length && p === 1) {
        root.appendChild(h('div', { class: 'state' }, [h('div', {}, '暂无归档记录')]));
        return;
      }
      const table = h('table', { class: 'archive-table' }, [
        h('thead', {}, h('tr', {}, [
          h('th', {}, '日期'),
          h('th', { style: { textAlign: 'right' } }, '条数'),
          h('th', {}, '概述'),
        ])),
        h('tbody', {}, days.map((d) => renderArchiveRow(d, teamQ, onOpenDay))),
      ]);
      root.appendChild(table);
      root.appendChild(renderPager(total, p, ARCHIVE_PAGE_SIZE, (np) => {
        page = np;
        loadPage(np);
      }, '天'));
    } catch (err) {
      renderError(root, err);
    }
  }
  await loadPage(page);
}

/* ---------- boot ---------- */
export async function initAiNewsPage() {
  const root = $('#ai-news-root');
  const meta = $('#ai-news-meta');
  if (!root) return;

  renderLoading(root, 3);
  // 先挂顶栏 · 团队 chip 与 nav 立刻就位 · 不等 API
  let teamCtx = { chatId: null, myTeams: [] };
  try {
    teamCtx = await resolveTeamContext();
  } catch (_) { /* SSO/API 未通 · 空 teamCtx 兜底 */ }
  mountTopNav({ page: 'ai-news', teamCtx });

  const params = new URLSearchParams(location.search);
  const focusDate = params.get('date') || '';

  try {
    // 若指定 ?date= · 只拉那天 · 归档展开在下方
    // 未指定 · 拉最新一天完整展开 · 归档默认收起
    let focusDoc = null;
    if (focusDate) {
      focusDoc = await api(`/api/ai-news/${encodeURIComponent(focusDate)}?team=${encodeURIComponent(teamCtx.chatId || '')}`);
    } else {
      const latest = await api(`/api/ai-news/latest?team=${encodeURIComponent(teamCtx.chatId || '')}`);
      focusDoc = latest;
    }

    if (meta) {
      if (!teamCtx.chatId) {
        meta.textContent = '未选团队';
      } else if (!focusDoc) {
        meta.textContent = '暂无记录';
      } else {
        const ymd = (focusDoc.date) || (typeof focusDoc._id === 'string' ? focusDoc._id.slice(-10) : '');
        const captured = focusDoc.capturedAt
          ? new Date(new Date(focusDoc.capturedAt).getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16)
          : '';
        const bits = [];
        if (ymd) bits.push(ymd);
        if (captured) bits.push(`${captured} 更新`);
        meta.textContent = bits.join(' · ');
      }
    }

    if (!teamCtx.chatId) {
      renderEmpty(root, '未匹配到团队 · 请从首页选择你所在的团队');
      return;
    }

    root.innerHTML = '';

    // 顶部:聚焦当日完整视图(最新或 ?date=)
    if (focusDoc) {
      root.appendChild(renderDaySection(focusDoc));
    } else {
      root.appendChild(h('div', { class: 'state' }, [h('div', {}, focusDate ? '当日无记录' : '暂无 AI 新闻记录 · 每天 10:00 联网自动生成')]));
    }

    // 归档区(默认收起)· <details>
    const archiveDetails = document.createElement('details');
    archiveDetails.className = 'ai-news-archive';
    if (focusDate) archiveDetails.open = true; // 从归档链过来时 · 默认展开归档便于换日期
    const archiveSummary = document.createElement('summary');
    archiveSummary.className = 'section-title';
    archiveSummary.textContent = '归档 · 按日期浏览';
    archiveDetails.appendChild(archiveSummary);

    const archiveBody = h('div', { class: 'ai-news-archive-body', style: { marginTop: '12px' } });
    archiveDetails.appendChild(archiveBody);
    root.appendChild(archiveDetails);

    // 懒加载:第一次展开时才发请求 · 已加载则不重复
    let loaded = false;
    const loadArchiveOnce = async () => {
      if (loaded) return;
      loaded = true;
      await renderArchive(archiveBody, teamCtx.chatId, (ymd) => {
        // 点行 → 跳到 ?date= · 顶部聚焦切换到那天 · 归档保持展开
        const url = new URL(location.href);
        url.searchParams.set('date', ymd);
        location.href = url.toString();
      });
    };
    if (archiveDetails.open) loadArchiveOnce();
    archiveDetails.addEventListener('toggle', () => {
      if (archiveDetails.open) loadArchiveOnce();
    });
  } catch (err) {
    if (meta) meta.textContent = '加载失败';
    renderError(root, err);
  }
}

// 分派入口由 main.js boot() 负责 · 本模块只 export initAiNewsPage
