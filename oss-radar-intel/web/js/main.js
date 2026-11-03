/* main.js — page detection + fetch + render
 * ES module · loaded as <script type="module" src="/js/main.js"></script>
 * Pages detected by presence of specific containers:
 *   #team-list-root  → index.html   (团队情报流 · 我的团队 + 全部团队)
 *   #archive-root    → archive.html (归档周列表)
 *   #week-root       → week.html    (单周详情)
 *   #douyin-root     → douyin.html  (抖音精选 feed)
 *   #ai-news-root    → ai-news.html (转 aiNews.js)
 */

import {
  h, $, $$, fmtStars, fmtAgo, fmtScore, colClass, colLabel, ghAvatar, fmtBjTime, progress,
  loadPref, savePref, renderTags, langChip, weekRange, renderLoading,
} from './util.js';
import { resolveTeamContext, mountTopNav } from './teamHeader.js';

/* ---------------- topbar helpers ---------------- */
function setTopStatus(text) {
  const el = document.querySelector('.topbar .topbar-status');
  if (!el) return;
  el.textContent = text || '';
  el.style.display = text ? '' : 'none';
}
function setTopSub(nodes) {
  const el = document.querySelector('.topbar .topbar-sub');
  if (!el) return;
  el.innerHTML = '';
  if (!nodes) { el.style.display = 'none'; return; }
  if (Array.isArray(nodes)) nodes.forEach((n) => el.appendChild(n));
  else if (typeof nodes === 'string') el.textContent = nodes;
  else el.appendChild(nodes);
  el.style.display = '';
}

/* ---------------- theme ---------------- */
function initTheme() {
  const saved = loadPref('theme', 'light');
  document.documentElement.setAttribute('data-theme', saved);
  const btn = $('#theme-toggle');
  if (btn) {
    btn.textContent = saved === 'light' ? '深色' : '浅色';
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      const next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      savePref('theme', next);
      btn.textContent = next === 'light' ? '深色' : '浅色';
    });
  }
}

/* ---------------- fetch wrapper ----------------
 * 相对路径 · 顶栏进度条自动 start/done
 * 相对路径走 /api/xxx
 */
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
// 兼容 aiNews.js 直接引用 · 导出供其他模块共享
export { api };

/* ---------------- states ---------------- */
// renderLoading 从 util.js 统一导入 · main/aiNews/repo 共用一套骨架

// 首屏全屏 loader · 页面 init 完成前遮住 main · 避免布局跳变
// 用法:pageReady() 在每页 init 结束时调
export function pageReady() {
  document.documentElement.classList.remove('page-loading');
  const loader = document.getElementById('page-loader');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => { if (loader.parentNode) loader.parentNode.removeChild(loader); }, 200);
  }
}
if (typeof document !== 'undefined' && document.readyState !== 'complete') {
  document.documentElement.classList.add('page-loading');
  // 若 5s 内没 pageReady() · 强制取消 loading · 别锁死用户
  setTimeout(() => document.documentElement.classList.remove('page-loading'), 5000);
}
function renderEmpty(root, msg = '暂无数据', extraEl) {
  root.innerHTML = '';
  const box = h('div', { class: 'state' }, [
    h('div', { class: 'icon' }, '·  ·  ·'),
    h('div', {}, msg),
  ]);
  if (extraEl) box.appendChild(extraEl);
  root.appendChild(box);
}
function renderError(root, err) {
  root.innerHTML = '';
  root.appendChild(h('div', { class: 'state error' }, [
    h('div', { class: 'icon' }, '×'),
    h('div', {}, 'API 拉取失败'),
    h('div', { style: { marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' } }, String(err && err.message || err)),
    h('div', { style: { marginTop: '12px', fontSize: '12px' } }, [
      '本地跑 ', h('code', {}, 'npm run dev'), ' 起 Koa · 或直接查看 ',
      h('a', { href: 'archive.html' }, '归档周列表'),
    ]),
  ]));
}

/* ---------------- 首页 · 团队情报流 ---------------- */
function renderTeamCard(t) {
  const chatId = t.chatId || t._id || '';
  const dn = t.displayName || chatId;
  const latest = t.latest || {};
  const aiTime = latest.aiNewsAt ? fmtBjTime(latest.aiNewsAt, 'md_hm') : '—';
  const ossWeek = latest.ossRadarWeek || '—';
  const teamQ = encodeURIComponent(chatId);

  const head = h('div', { class: 'team-card-head' }, [
    h('div', { class: 'team-card-name' }, dn),
    h('div', { class: 'team-card-id mono' }, chatId),
  ]);
  const meta = h('dl', { class: 'team-card-meta' }, [
    h('dt', {}, '最新 AI 新闻'), h('dd', {}, aiTime),
    h('dt', {}, '最新 OSS 雷达'), h('dd', {}, ossWeek),
  ]);
  const actions = h('div', { class: 'team-card-actions' }, [
    h('a', { href: `ai-news.html?team=${teamQ}` }, 'AI 新闻'),
    h('a', { href: `archive.html?team=${teamQ}` }, '归档'),
    h('a', { href: `team-config.html?team=${teamQ}` }, '配置 / 试跑'),
  ]);
  return h('div', { class: 'team-card' }, [head, meta, actions]);
}

function renderTeamSection(root, title, subtitle, teams, emptyMsg) {
  root.appendChild(h('h2', { class: 'section-subtitle' }, title));
  if (subtitle) {
    root.appendChild(h('div', { class: 'page-meta', style: { marginBottom: '12px' } }, subtitle));
  }
  if (!teams || !teams.length) {
    root.appendChild(h('div', { class: 'state', style: { padding: '30px 0' } }, [
      h('div', {}, emptyMsg),
    ]));
    return;
  }
  const grid = h('div', { class: 'team-grid' });
  teams.forEach((t) => grid.appendChild(renderTeamCard(t)));
  root.appendChild(grid);
}

async function initHomePage() {
  const root = $('#team-list-root');
  const teamCtx = await resolveTeamContext();
  mountTopNav({ page: 'radar', teamCtx });

  renderLoading(root, 3);
  try {
    const [mineRes, allRes] = await Promise.all([
      api('/api/team/list?mine=true').catch((e) => ({ __err: e })),
      api('/api/team/list?all=true').catch((e) => ({ __err: e })),
    ]);
    root.innerHTML = '';

    const mine = mineRes && !mineRes.__err ? (mineRes.teams || []) : [];
    const all = allRes && !allRes.__err ? (allRes.teams || []) : [];
    const isLocal = mine.some((t) => (t.chatId || t._id) === 'local');
    setTopStatus(isLocal ? '' : (mine.length ? `${mine.length} 个团队` : (all.length ? '未加入任何团队' : '')));

    // 顶部 CTA · 本地报告模式不显示建团队入口
    if (!isLocal) {
      const cta = h('div', { class: 'home-cta' }, [
        h('div', { class: 'home-cta-text' },
          mine.length ? '想接入更多群 · 或帮别的团队开通?'
                      : '你还不在任何团队里 · 拉机器人到你的群 · 然后建立团队接入 oss-radar'),
        h('a', { href: 'team-create.html', class: 'btn-primary' }, mine.length ? '+ 新建团队' : '+ 建立我的第一个团队'),
      ]);
      root.appendChild(cta);
    }

    if (!isLocal) {
      renderTeamSection(
        root,
        '我的团队',
        '你所在的飞书群 · 每日 3:00 全量同步 · 首次登录补建',
        mine,
        '未识别到你在任何配置了 oss-radar 的群里 · 上方"建立团队"或让 TL 把你加进群',
      );
    }

    // 两栏内容一样时(mine == all)合并 · 避免重复视觉
    const mineIds = new Set(mine.map((t) => t.chatId || t._id));
    const allIds = new Set(all.map((t) => t.chatId || t._id));
    const sameSet = mineIds.size === allIds.size && [...mineIds].every((id) => allIds.has(id));
    if (!isLocal && !sameSet) {
      // 只列 mine 之外的团队 · 折叠起来 · 不占首屏(用户主要用「我的团队」· 全部只是发现渠道)
      const others = all.filter((t) => !mineIds.has(t.chatId || t._id));
      if (others.length) {
        const details = h('details', { class: 'other-teams' }, [
          h('summary', {}, `发现更多 · 其他 ${others.length} 个团队(可查看 · 只有群成员或群主能改配置)`),
          h('div', { class: 'team-grid', style: { marginTop: '12px' } },
            others.map(renderTeamCard)),
        ]);
        root.appendChild(details);
      }
    }

    if (mineRes && mineRes.__err) {
      root.appendChild(h('div', {
        class: 'state error',
        style: { padding: '20px 0', textAlign: 'left', fontSize: '12px' },
      }, `拉「我的团队」失败:${mineRes.__err.message || mineRes.__err}`));
    }

    // 主视觉:优先匹配 URL ?team= 指定的团队 · 顶栏 picker 切队后主区随之刷
    // teamCtx.chatId 来源:URL query > 上次 localStorage > 空。为空时退回 mine[0]
    const wantId = teamCtx && teamCtx.chatId;
    const cur = (wantId && (mine.find((t) => (t.chatId || t._id) === wantId)
                        || all.find((t) => (t.chatId || t._id) === wantId)))
              || mine[0];
    await renderLatestRadar(cur);
  } catch (err) {
    renderError(root, err);
  }
}

/* ---------------- 首页 · 默认团队的最新 OSS 雷达 ---------------- */
async function renderLatestRadar(defaultTeam) {
  const root = $('#latest-radar-root');
  if (!root) return;
  root.innerHTML = '';

  if (!defaultTeam) {
    // 无团队 · 提示先建团队
    root.appendChild(h('div', { class: 'state', style: { padding: '32px 0' } }, [
      h('div', { class: 'icon' }, '· · ·'),
      h('div', {}, '还没接入团队 · 建团队后这里会展示每周 OSS 雷达 top 项目'),
    ]));
    return;
  }

  const chatId = defaultTeam.chatId || defaultTeam._id;
  const displayName = defaultTeam.displayName || chatId;
  const teamQ = `?team=${encodeURIComponent(chatId)}`;

  let data;
  try { data = await api(`/api/latest${teamQ}`); }
  catch (err) {
    root.appendChild(h('div', { class: 'state error' }, [
      h('div', { class: 'icon' }, '×'),
      h('div', {}, '拉本周数据失败:' + (err && err.message)),
    ]));
    return;
  }

  if (!data || !data.items || !data.items.length) {
    root.appendChild(h('div', { class: 'state', style: { padding: '32px 0' } }, [
      h('div', { class: 'icon' }, '· · ·'),
      h('div', {}, '本周 OSS 雷达还没跑 · 周五 10 点后出结果'),
    ]));
    return;
  }

  const meta = h('div', { class: 'section-heading' }, [
    h('h2', { class: 'section-heading-title' }, '本周雷达'),
    h('span', { class: 'section-heading-sub' },
      `${displayName} · ${data.week} · 共 ${data.items.length} 个项目`),
  ]);
  root.appendChild(meta);

  // 一列平铺 · 12 条 = workTop 8 + toyTop 4 · 无 subtitle 无查看全部
  // topIds 存的是 `${source}:${owner}/${name}` · items[i].id 是 `${owner}/${name}` · 补前缀 match
  const workIds = new Set(data.workTopIds || []);
  const toyIds = new Set(data.toyTopIds || []);
  const items = data.items || [];
  const keyOf = (r) => `${r.source || 'github'}:${r.id || `${r.owner}/${r.name}`}`;
  // 排序:workTop 顺序在前 · toyTop 顺序在后 · 未在 topIds 里的 fallback 兜底
  const inWork = items.filter(r => workIds.has(keyOf(r)));
  const inToy = items.filter(r => toyIds.has(keyOf(r)));
  let ordered = [...inWork, ...inToy];
  if (!ordered.length) {
    // topIds 空 · 用 column 兜底
    const w = items.filter(r => (r.finalColumn || r.column) === 'work');
    const t = items.filter(r => (r.finalColumn || r.column) === 'toy');
    ordered = [...w, ...t];
  }
  if (!ordered.length) ordered = items;

  if (ordered.length) {
    const list = h('div', { class: 'repo-list' });
    ordered.forEach(r => list.appendChild(renderRepoCard(r, { team: chatId })));
    root.appendChild(list);
  } else {
    root.appendChild(h('div', { class: 'state' }, '本周暂无收录 · 周五 10 点后出结果 · 或去团队配置页手动试跑'));
  }
}

/* ---------------- repo card (归档/单周页复用) ---------------- */
function renderRepoCard(repo, ctx) {
  const owner = repo.owner || (repo.id && repo.id.split('/')[0]) || 'unknown';
  const name = repo.name || (repo.id && repo.id.split('/')[1]) || repo.id || 'unknown';
  const url = repo.url || (repo.source === 'hn' ? repo.hnUrl : `https://github.com/${owner}/${name}`);
  const team = ctx && ctx.team;
  // douyin 无 repo 详情页 · owner/name 无效时也跳过
  const hasDetail = repo.source !== 'douyin' && owner !== 'unknown' && name !== 'unknown';
  const detailHref = hasDetail
    ? `repo.html?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}&source=${encodeURIComponent(repo.source || 'github')}${team ? `&team=${encodeURIComponent(team)}` : ''}`
    : null;
  const llm = repo.llm || repo;
  const col = repo.finalColumn || llm.column || repo.column || 'skip';
  const score = repo.finalScore != null ? repo.finalScore : (llm.score != null ? llm.score : repo.ruleScore);

  const avatarSrc = repo.source === 'douyin' && repo.douyinCover
    ? repo.douyinCover
    : ghAvatar(owner);
  const avatar = h('img', {
    class: 'repo-avatar' + (repo.source === 'douyin' ? ' repo-avatar-douyin' : ''),
    src: avatarSrc,
    alt: owner,
    loading: 'lazy',
    referrerpolicy: repo.source === 'douyin' ? 'no-referrer' : undefined,
    onerror: (e) => { e.target.style.visibility = 'hidden'; },
  });

  const nameEl = h('div', { class: 'repo-name' }, [
    h('a', { href: url, target: '_blank', rel: 'noopener' }, [
      h('span', { class: 'owner' }, owner + '/'),
      name,
    ]),
  ]);
  if (detailHref) {
    nameEl.appendChild(h('a', {
      href: detailHref,
      class: 'repo-detail-link',
      title: '查看该项目历史打分 · 元数据',
    }, '详情'));
  }
  const head = h('div', { class: 'repo-head' }, [
    nameEl,
    repo.source === 'douyin'
      ? h('span', { class: 'repo-stars' }, repo.owner || '')
      : h('span', { class: 'repo-stars' }, '★ ' + fmtStars(repo.stars)),
    h('span', { class: `repo-score ${colClass(col)}` }, `${colLabel(col)} ${fmtScore(score)}`),
  ]);

  const oneLiner = llm.oneLiner || repo.description || '';
  const body = [head];
  if (oneLiner) body.push(h('div', { class: 'repo-oneliner' }, oneLiner));

  if (llm.highlight) {
    body.push(h('div', { class: 'repo-detail' }, [
      h('span', { class: 'label' }, '亮点'),
      llm.highlight,
    ]));
  }
  if (llm.useCase) {
    body.push(h('div', { class: 'repo-detail repo-usecase' }, [
      h('span', { class: 'label' }, '场景'),
      llm.useCase,
    ]));
  }

  const footer = h('div', { class: 'repo-footer' });
  footer.appendChild(h('span', { class: 'badge src-' + (repo.source || 'github') }, repo.source || 'github'));
  if (repo.pushedAt || repo.updatedAt) {
    footer.appendChild(h('span', {}, fmtAgo(repo.pushedAt || repo.updatedAt)));
  }
  if (repo.language) footer.appendChild(langChip(repo.language));
  if (repo.license) footer.appendChild(h('span', { class: 'badge' }, repo.license));
  if (repo.source === 'hn' && repo.hnPoints != null) {
    footer.appendChild(h('span', {}, `▲ ${repo.hnPoints} · ${repo.hnComments || 0} 评`));
  }
  const tagEl = renderTags(llm.tags || [], ctx && ctx.activeTags, ctx && ctx.onTagClick);
  if (tagEl) footer.appendChild(tagEl);
  body.push(footer);

  return h('div', { class: 'repo-card' }, [avatar, h('div', { class: 'repo-body' }, body)]);
}

/* ---------------- archive list page ---------------- */
const ARCHIVE_PAGE_SIZE = 12;

async function initArchivePage() {
  const root = $('#archive-root');
  const teamCtx = await resolveTeamContext();
  mountTopNav({ page: 'archive', teamCtx });
  const team = teamCtx.chatId;

  const params = new URLSearchParams(location.search);
  let page = Math.max(1, Number(params.get('page')) || 1);

  async function loadPage(p) {
    renderLoading(root, 3);
    const offset = (p - 1) * ARCHIVE_PAGE_SIZE;
    const q = `limit=${ARCHIVE_PAGE_SIZE}&offset=${offset}` + (team ? `&team=${encodeURIComponent(team)}` : '');
    try {
      const data = await api(`/api/archive?${q}`);
      const weeks = data.weeks || [];
      const total = Number(data.total) || 0;
      setTopStatus(total ? `共 ${total} 周` : '');
      if (weeks.length === 0 && p === 1) return renderEmpty(root, '暂无归档 · 首个周报周一上午生成');

      const teamQ = team ? `&team=${encodeURIComponent(team)}` : '';
      const table = h('table', { class: 'archive-table' }, [
        h('thead', {}, h('tr', {}, [
          h('th', {}, '周'),
          h('th', {}, '日期区间'),
          h('th', {}, 'Top 3'),
          h('th', { style: { textAlign: 'right' } }, '数量'),
        ])),
        h('tbody', {}, weeks.map(w => {
          const link = `week.html?week=${encodeURIComponent(w.week)}${teamQ}`;
          const top3 = h('span', { class: 'top3' });
          (w.top3 || []).forEach((r, i) => {
            if (i > 0) top3.appendChild(document.createTextNode(' · '));
            const id = r.id || r.name || '';
            const [owner, name] = String(id).split('/');
            const repoHref = owner && name
              ? `repo.html?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}${teamQ}`
              : link;
            top3.appendChild(h('a', { href: repoHref, onclick: (e) => e.stopPropagation() }, id));
          });
          return h('tr', {
            onclick: () => { location.href = link; },
            style: { cursor: 'pointer' },
          }, [
            h('td', { class: 'week-col' }, h('a', { href: link }, w.week)),
            h('td', {}, w.from ? `${w.from} → ${w.to}` : weekRange(w.week)),
            h('td', {}, top3),
            h('td', { class: 'count-col' }, String(w.count || 0)),
          ]);
        })),
      ]);
      root.innerHTML = '';
      root.appendChild(table);
      root.appendChild(renderPager(total, p, ARCHIVE_PAGE_SIZE, (np) => {
        page = np;
        const url = new URL(location.href);
        url.searchParams.set('page', String(np));
        history.replaceState(null, '', url.toString());
        loadPage(np);
      }));
    } catch (err) {
      renderError(root, err);
    }
  }

  loadPage(page);
}

/** 通用分页器 · total/page/pageSize + onGo(nextPage) + unit(默认 '周') */
export function renderPager(total, page, pageSize, onGo, unit = '周') {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return h('div');
  const pager = h('div', { class: 'archive-pager' });
  const btn = (label, target, disabled, active) => h('button', {
    class: 'archive-pager-btn' + (active ? ' active' : ''),
    disabled: disabled ? 'disabled' : undefined,
    onclick: () => { if (!disabled && target !== page) onGo(target); },
  }, label);
  pager.appendChild(btn('‹ 上一页', page - 1, page === 1));
  // 页码窗口 · 当前 ± 2
  const win = 2;
  const from = Math.max(1, page - win);
  const to = Math.min(totalPages, page + win);
  if (from > 1) {
    pager.appendChild(btn('1', 1, false, page === 1));
    if (from > 2) pager.appendChild(h('span', { class: 'archive-pager-dots' }, '…'));
  }
  for (let i = from; i <= to; i++) pager.appendChild(btn(String(i), i, false, i === page));
  if (to < totalPages) {
    if (to < totalPages - 1) pager.appendChild(h('span', { class: 'archive-pager-dots' }, '…'));
    pager.appendChild(btn(String(totalPages), totalPages, false, page === totalPages));
  }
  pager.appendChild(btn('下一页 ›', page + 1, page === totalPages));
  pager.appendChild(h('span', { class: 'archive-pager-info' }, `共 ${total} ${unit}`));
  return pager;
}

/* ---------------- week detail page ---------------- */
async function initWeekPage() {
  const root = $('#week-root');
  const params = new URLSearchParams(location.search);
  const week = params.get('week');
  if (!week) {
    return renderError(root, new Error('缺少 ?week=YYYY-Www 参数'));
  }
  const teamCtx = await resolveTeamContext();
  mountTopNav({ page: 'week', teamCtx });
  const team = teamCtx.chatId;
  const teamQ = team ? `?team=${encodeURIComponent(team)}` : '';
  // 面包屑:归档 › 2026-W38
  setTopSub([
    h('a', { href: 'archive.html' + teamQ, class: 'crumb' }, '归档'),
    h('span', { class: 'crumb-sep' }, ' › '),
    h('span', { class: 'crumb-current' }, week),
  ]);

  renderLoading(root);
  try {
    const q = team ? `?team=${encodeURIComponent(team)}` : '';
    const data = await api(`/api/week/${encodeURIComponent(week)}${q}`);
    const items = data.items || [];
    const top10 = data.top10 || items.slice(0, 10);
    const workCount = Array.isArray(data.workTop)
      ? data.workTop.length
      : items.filter(r => (r.finalColumn || (r.llm && r.llm.column) || r.column) === 'work').length;
    const toyCount = Array.isArray(data.toyTop)
      ? data.toyTop.length
      : items.filter(r => (r.finalColumn || (r.llm && r.llm.column) || r.column) === 'toy').length;

    const summary = $('#week-summary');
    if (summary) {
      summary.innerHTML = '';
      summary.appendChild(h('div', { class: 'stat' }, [
        h('span', { class: 'num' }, String(items.length)),
        h('span', { class: 'label' }, '收录'),
      ]));
      summary.appendChild(h('div', { class: 'stat' }, [
        h('span', { class: 'num' }, String(workCount)),
        h('span', { class: 'label' }, '工作可用'),
      ]));
      summary.appendChild(h('div', { class: 'stat' }, [
        h('span', { class: 'num' }, String(toyCount)),
        h('span', { class: 'label' }, '玩具尝鲜'),
      ]));
      summary.appendChild(h('div', { class: 'stat' }, [
        h('span', { class: 'num' }, data.from ? `${data.from} → ${data.to}` : weekRange(week)),
        h('span', { class: 'label' }, '日期区间'),
      ]));
    }

    root.innerHTML = '';
    // 一列平铺 · workTop 8 + toyTop 4 = 12 · 无 subtitle 无查看全部
    const top = data.top10 || data.items?.slice(0, 12) || [];
    if (!top.length) {
      root.appendChild(h('div', { class: 'state' }, '本周暂无收录'));
    } else {
      const list = h('div', { class: 'repo-list' });
      top.forEach(r => list.appendChild(renderRepoCard(r, { team })));
      root.appendChild(list);
    }
  } catch (err) {
    renderError(root, err);
  }
}

/* ---------------- douyin · LLM 分析页(未变 · 与 team 无关) ---------------- */
async function postDouyinProcess(feedId) {
  const res = await fetch(`api/douyin-feeds/${encodeURIComponent(feedId)}/process?reprocess=1`, {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
  return body.data;
}

function renderDouyinAnalysisTable(root, feed) {
  root.innerHTML = '';
  const scores = feed.video_scores || [];
  if (!scores.length) {
    renderEmpty(root, feed.processing
      ? 'AI 分析进行中… 请稍后刷新'
      : '尚无 LLM 分析结果 · 上报后会自动异步分析,或点上方「全量重跑」');
    return;
  }
  const kept = scores.filter((s) => s.inPool).length;
  root.appendChild(h('p', { class: 'page-meta' }, [
    `共 ${scores.length} 条 · 进入本周池 ${kept} 条 · `,
    h('a', { href: 'index.html' }, '回首页'),
    ' · 来源筛选 douyin',
  ]));

  const rows = scores.map((s) => h('tr', {}, [
    h('td', {}, s.inPool ? '✓' : '—'),
    h('td', { class: 'mono' }, s.column || '—'),
    h('td', { class: 'mono' }, s.finalScore != null ? String(s.finalScore) : '—'),
    h('td', {}, s.dropReason || ''),
    h('td', {}, [
      h('a', { href: s.video_url || '#', target: '_blank', rel: 'noopener' },
        (s.title || s.aweme_id || '').slice(0, 48)),
    ]),
    h('td', {}, s.oneLiner || ''),
    h('td', {}, s.highlight || ''),
  ]));

  root.appendChild(h('table', { class: 'archive-table douyin-analysis-table' }, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, '入池'),
      h('th', {}, 'column'),
      h('th', {}, '分'),
      h('th', {}, '淘汰原因'),
      h('th', {}, '标题'),
      h('th', {}, 'oneLiner'),
      h('th', {}, 'highlight'),
    ])),
    h('tbody', {}, rows),
  ]));
}

async function loadDouyinFeedById(id) {
  return api(`/api/douyin-feeds/${encodeURIComponent(id)}`);
}

async function refreshDouyinPage(feedId) {
  const root = $('#douyin-root');
  const meta = $('#douyin-meta');
  const countEl = $('#douyin-count');
  const statusEl = $('#douyin-process-status');

  const feed = await loadDouyinFeedById(feedId);
  if (!feed) {
    renderEmpty(root, 'feed 不存在');
    return null;
  }

  if (meta) {
    const ps = feed.process_stats || {};
    const bits = [feed.mode || 'unknown'];
    if (feed.processed_at) bits.push(`分析完成 ${feed.processed_at.slice(0, 19)}`);
    else if (feed.processing) bits.push('分析中…');
    if (ps.kept != null) bits.push(`入池 ${ps.kept}/${ps.rawVideos || '?'}`);
    meta.textContent = bits.join(' · ');
  }
  if (countEl) {
    countEl.textContent = `${(feed.video_scores || []).length || feed.video_count || 0} 条 LLM 记录`;
  }
  if (statusEl) {
    statusEl.textContent = feed.processing ? '后台分析进行中…' : '';
  }

  renderDouyinAnalysisTable(root, feed);
  return feed;
}

async function initDouyinPage() {
  const root = $('#douyin-root');
  const historyBar = $('#douyin-history');
  const reprocessBtn = $('#douyin-reprocess');

  renderLoading(root, 4);

  try {
    const list = await api('/api/douyin-feeds?limit=12');
    const feeds = list.feeds || [];
    const params = new URLSearchParams(location.search);
    let feedId = params.get('id');
    if (!feedId && feeds.length > 0) feedId = feeds[0].id;
    if (!feedId) {
      return renderEmpty(root, '暂无抖音 feed · 客户端正常上报即可,服务端会自动异步分析');
    }

    if (historyBar && feeds.length > 1) {
      historyBar.style.display = '';
      historyBar.innerHTML = '';
      historyBar.appendChild(h('span', { class: 'toolbar-label' }, '批次'));
      feeds.forEach((f) => {
        const label = `${(f.received_at || f.scraped_at || '').slice(0, 16)} · ${f.video_count} 条`;
        historyBar.appendChild(h('a', {
          class: 'chip' + (f.id === feedId ? ' active' : ''),
          href: `douyin.html?id=${encodeURIComponent(f.id)}`,
        }, label));
      });
    }

    if (reprocessBtn) {
      reprocessBtn.onclick = async () => {
        reprocessBtn.disabled = true;
        try {
          await postDouyinProcess(feedId);
          const statusEl = $('#douyin-process-status');
          if (statusEl) statusEl.textContent = '已提交重跑 · 约 1–3 分钟';
          setTimeout(() => refreshDouyinPage(feedId).catch(() => {}), 8000);
        } catch (e) {
          alert(String(e.message || e));
        } finally {
          reprocessBtn.disabled = false;
        }
      };
    }

    let feed = await refreshDouyinPage(feedId);
    if (feed && feed.processing) {
      const timer = setInterval(async () => {
        feed = await refreshDouyinPage(feedId);
        if (feed && !feed.processing && (feed.video_scores || []).length) clearInterval(timer);
      }, 5000);
      setTimeout(() => clearInterval(timer), 600000);
    }
  } catch (err) {
    renderError(root, err);
  }
}

/* ---------------- boot ---------------- */
async function boot() {
  initTheme();
  try {
    if ($('#team-list-root')) await initHomePage();
    else if ($('#douyin-root')) await initDouyinPage();
    else if ($('#archive-root')) await initArchivePage();
    else if ($('#week-root')) await initWeekPage();
    else if ($('#ai-news-root')) {
      const m = await import('./aiNews.js');
      await m.initAiNewsPage();
    }
  } catch (e) {
    console.error('boot error', e);
  } finally {
    pageReady();
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
