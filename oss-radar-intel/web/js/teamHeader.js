// 顶栏统一组件 · 全站唯一导航
//   - resolveTeamContext:从 URL/mine 解析当前 team
//   - mountTopNav:注入 tabs(带 ?team) + 团队选择器 chip
//
// 使用姿势:
//   import { resolveTeamContext, mountTopNav } from './teamHeader.js';
//   const teamCtx = await resolveTeamContext();
//   mountTopNav({ page: 'radar', teamCtx });
//
// page 取值:radar / archive / ai-news / config / douyin / week / repo / create
//   radar/archive/ai-news/config/douyin 高亮对应 tab · week/repo/create 无高亮
//
// tabs 顺序:雷达 · 归档 · AI 新闻 · 配置 · 抖音
//   · 每个 tab 自动附上 ?team=<chatId>(除抖音)
//   · 当前无 team 时 tabs 不带 team 参数
//
// 团队选择器:
//   · 无 team → 显示"未选团队 · 建团队"chip · 点跳 team-create.html
//   · 单 team → 显示 chip · 点跳 team-config.html
//   · 多 team → chip 打开下拉切换

import { h } from './util.js';

async function apiJson(path) {
  const rel = path.replace(/^\//, '');
  const r = await fetch(rel, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json();
  if (body && body.ok === false) throw new Error(body.error || 'API error');
  return body && 'data' in body ? body.data : body;
}

/**
 * 解析当前页 team context · URL ?team=xxx 优先 · 缺省取 /api/team/list?mine=true 第一个
 */
export async function resolveTeamContext() {
  const params = new URLSearchParams(location.search);
  const explicit = params.get('team');
  let myTeams = [];
  let email = '';
  try {
    const data = await apiJson('/api/team/list?mine=true');
    myTeams = (data && data.teams) || [];
    email = (data && data.email) || '';
  } catch (_) { /* SSO 未通 · 空 myTeams · 走无 team 分支 */ }

  const findMine = (id) => myTeams.find((t) => (t.chatId || t._id) === id);

  if (explicit) {
    const t = findMine(explicit);
    return {
      chatId: explicit,
      displayName: (t && t.displayName) || explicit,
      source: 'url',
      myTeams,
      hasMine: !!t,
      email,
    };
  }
  if (myTeams.length) {
    const t = myTeams[0];
    return {
      chatId: t.chatId || t._id,
      displayName: t.displayName || (t.chatId || t._id),
      source: 'fallback-mine',
      myTeams,
      hasMine: true,
      email,
    };
  }
  return { chatId: null, displayName: null, source: 'none', myTeams: [], hasMine: false, email };
}

/**
 * 挂顶栏 · 覆盖 html 里静态的 <nav class="nav-tabs">
 * @param {{page:string, teamCtx:object}} opts
 */
export function mountTopNav({ page, teamCtx }) {
  const nav = document.querySelector('.topbar .nav-tabs');
  if (!nav) return;
  const chatId = teamCtx && teamCtx.chatId;
  const hasMine = teamCtx && teamCtx.hasMine !== false;
  const q = chatId ? `?team=${encodeURIComponent(chatId)}` : '';
  // foreign 团队(URL 强指的 chatId 但用户不在群)· 配置页会 403 · tab 改指向建团队
  const configHref = chatId && hasMine ? `team-config.html${q}` : 'team-create.html';
  const configLabel = chatId && hasMine ? '配置' : '建团队';

  const tabDefs = [
    { key: 'radar',    href: 'index.html' + q,        label: '雷达' },
    { key: 'archive',  href: 'archive.html' + q,      label: '归档' },
    { key: 'ai-news',  href: 'ai-news.html' + q,      label: 'AI 新闻' },
    { key: 'config',   href: configHref, label: configLabel },
    { key: 'admin',    href: 'admin.html' + q,        label: '运维' },
    { key: 'douyin',   href: 'douyin.html',           label: '抖音' },
  ];
  nav.innerHTML = '';
  // 本地报告模式只保留展示与归档,不显示配置/运维/抖音
  const visibleTabs = chatId === 'local' ? tabDefs.filter((t) => ['radar', 'archive', 'ai-news'].includes(t.key)) : tabDefs;
  visibleTabs.forEach((t) => {
    const a = h('a', {
      href: t.href,
      class: (t.key === page ? 'active' : ''),
    }, t.label);
    nav.appendChild(a);
  });

  // 本地报告模式:不显示团队选择器
  if (chatId === 'local') {
    const st = document.querySelector('.topbar .topbar-status');
    if (st) st.textContent = '本地报告';
    return;
  }

  // 团队选择器 chip · 挂在 topbar-spacer 前面
  const topbar = document.querySelector('.topbar-inner');
  if (topbar) {
    const old = topbar.querySelector('.top-team-picker');
    if (old) old.remove();
    const picker = renderTeamPicker(teamCtx);
    const spacer = topbar.querySelector('.topbar-spacer');
    if (spacer) topbar.insertBefore(picker, spacer);
    else topbar.appendChild(picker);
  }
}

function renderTeamPicker(teamCtx) {
  const { chatId, displayName, myTeams, hasMine } = teamCtx || {};
  const wrap = h('div', { class: 'top-team-picker' });

  if (!chatId) {
    wrap.appendChild(h('a', {
      href: 'team-create.html',
      class: 'team-picker-chip empty',
      title: '当前没有选中团队',
    }, [
      h('span', { class: 'team-picker-dot' }, '○'),
      h('span', {}, '未选团队 · 建团队'),
    ]));
    return wrap;
  }

  // foreign 团队 · URL 强指的 chatId 但用户不在群 · 只读浏览 · 点击不跳 config(会 403)
  if (hasMine === false) {
    const chip = h('button', {
      type: 'button',
      class: 'team-picker-chip foreign',
      title: `${chatId} · 你不在此团队 · 只读浏览`,
    }, [
      h('span', { class: 'team-picker-dot' }, '◌'),
      h('span', { class: 'team-picker-name' }, chatId),
      h('span', { class: 'team-picker-tag' }, '只读'),
    ]);
    const hint = Array.isArray(myTeams) && myTeams.length
      ? '你不在此团队 · 只读浏览。返回你自己的团队?'
      : '你不在此团队 · 只读浏览。去建一个自己的团队?';
    chip.onclick = () => {
      if (window.confirm(hint)) {
        if (Array.isArray(myTeams) && myTeams.length) {
          const my = myTeams[0];
          const cid = my.chatId || my._id;
          location.href = `index.html?team=${encodeURIComponent(cid)}`;
        } else {
          location.href = 'team-create.html';
        }
      }
    };
    wrap.appendChild(chip);
    return wrap;
  }

  const hasMulti = Array.isArray(myTeams) && myTeams.length >= 2;
  const chip = h('button', {
    type: 'button',
    class: 'team-picker-chip' + (hasMulti ? ' has-multi' : ''),
    title: chatId,
  }, [
    h('span', { class: 'team-picker-dot' }, '●'),
    h('span', { class: 'team-picker-name' }, displayName || chatId),
    hasMulti ? h('span', { class: 'team-picker-caret' }, '▾') : null,
  ].filter(Boolean));

  if (!hasMulti) {
    chip.onclick = () => { location.href = `team-config.html?team=${encodeURIComponent(chatId)}`; };
    wrap.appendChild(chip);
    return wrap;
  }

  // 多群 · 挂下拉
  const menu = h('div', { class: 'team-picker-menu' });
  myTeams.forEach((t) => {
    const cid = t.chatId || t._id;
    const isCurrent = cid === chatId;
    // 切换团队:留在当前 pathname · 只换 team 参数
    const url = new URL(location.href);
    url.searchParams.set('team', cid);
    const item = h('a', {
      href: url.pathname + url.search,
      class: 'team-picker-item' + (isCurrent ? ' current' : ''),
    }, [
      h('span', { class: 'team-picker-item-name' }, t.displayName || cid),
      h('span', { class: 'team-picker-item-id' }, String(cid).slice(0, 14) + '…'),
    ]);
    menu.appendChild(item);
  });
  // 建团队入口
  menu.appendChild(h('a', {
    href: 'team-create.html',
    class: 'team-picker-item new',
  }, '+ 建新团队'));

  wrap.appendChild(chip);
  wrap.appendChild(menu);

  chip.onclick = (e) => {
    e.stopPropagation();
    wrap.classList.toggle('open');
  };
  // 点空白关
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) wrap.classList.remove('open');
  });

  return wrap;
}
