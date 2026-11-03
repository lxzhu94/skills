// Repo 详情 · GET /api/repo/:owner/:name · 展示元数据 + 打分历史
import { h, $, fmtStars, fmtScore, colClass, colLabel, ghAvatar, langChip, renderLoading } from './util.js';
import { resolveTeamContext, mountTopNav } from './teamHeader.js';

async function api(path) {
  const r = await fetch(path.replace(/^\//, ''), { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json();
  if (body && body.ok === false) throw new Error(body.error || 'API error');
  return body && 'data' in body ? body.data : body;
}

function renderState(root, msg, cls) {
  root.innerHTML = '';
  root.appendChild(h('div', { class: 'state' + (cls ? ' ' + cls : '') }, [
    h('div', { class: 'icon' }, cls === 'error' ? '×' : '·  ·  ·'),
    h('div', {}, msg),
  ]));
}

function renderScoringHistory(list, currentTeam) {
  if (!Array.isArray(list) || !list.length) {
    return h('div', { class: 'page-meta' }, '暂无打分历史 · 打分记录会在每次 pipeline 后追加');
  }
  const rows = list.slice(-20).reverse().map((s) => {
    const cls = colClass(s.column);
    return h('tr', {}, [
      h('td', {}, s.week || '—'),
      h('td', {}, s.teamId ? (s.teamId === currentTeam ? '本团队' : s.teamId.slice(0, 12) + '…') : '全局'),
      h('td', {}, h('span', { class: `col-chip col-${cls}` }, s.column ? colLabel(s.column) : '—')),
      h('td', {}, fmtScore(s.finalScore)),
      h('td', {}, fmtScore(s.ruleScore)),
      h('td', {}, fmtScore(s.llmScore)),
    ]);
  });
  return h('table', { class: 'archive-table' }, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, '周'),
      h('th', {}, '团队'),
      h('th', {}, '分类'),
      h('th', {}, 'final'),
      h('th', {}, 'rule'),
      h('th', {}, 'llm'),
    ])),
    h('tbody', {}, rows),
  ]);
}

async function init() {
  const root = $('#repo-root');
  const params = new URLSearchParams(location.search);
  const owner = params.get('owner');
  const name = params.get('name');
  const source = params.get('source') || 'github';

  if (!owner || !name) {
    renderState(root, '缺少 ?owner=xxx&name=yyy 参数', 'error');
    return;
  }

  const teamCtx = await resolveTeamContext();
  mountTopNav({ page: 'repo', teamCtx });
  const teamQ = teamCtx.chatId ? `&team=${encodeURIComponent(teamCtx.chatId)}` : '';
  const teamQ1 = teamCtx.chatId ? `?team=${encodeURIComponent(teamCtx.chatId)}` : '';
  // 面包屑:雷达 › owner/name
  const sub = document.querySelector('.topbar .topbar-sub');
  if (sub) {
    sub.innerHTML = '';
    sub.appendChild(h('a', { href: 'index.html' + teamQ1, class: 'crumb' }, '雷达'));
    sub.appendChild(h('span', { class: 'crumb-sep' }, ' › '));
    sub.appendChild(h('span', { class: 'crumb-current' }, `${owner}/${name}`));
    sub.style.display = '';
  }

  renderLoading(root, 3);
  try {
    const repo = await api(`/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}?source=${source}${teamQ}`);

    // 顶部状态 chip:★ + 语言
    const status = document.querySelector('.topbar .topbar-status');
    if (status) {
      status.innerHTML = '';
      status.appendChild(document.createTextNode(`★ ${fmtStars(repo.stars || 0)}`));
      if (repo.language) {
        status.appendChild(document.createTextNode(' · '));
        status.appendChild(document.createTextNode(repo.language));
      }
    }

    root.innerHTML = '';
    // Hero 卡片
    const hero = h('div', { class: 'repo-hero' }, [
      h('img', { class: 'repo-hero-avatar', src: ghAvatar(repo.owner), alt: '', loading: 'lazy' }),
      h('div', { class: 'repo-hero-body' }, [
        h('div', { class: 'repo-hero-title' }, [
          h('a', { href: repo.url, target: '_blank', rel: 'noopener' }, `${repo.owner}/${repo.name}`),
        ]),
        h('div', { class: 'repo-hero-meta' }, [
          `★ ${fmtStars(repo.stars || 0)}`,
          repo.language ? ' · ' : '',
          repo.language ? langChip(repo.language) : '',
          repo.license ? ` · ${repo.license}` : '',
        ].filter(Boolean)),
        repo.description ? h('div', { class: 'repo-hero-desc' }, repo.description) : null,
      ].filter(Boolean)),
    ]);
    root.appendChild(hero);

    // LLM 卡片
    if (repo.llm && (repo.llm.oneLiner || repo.llm.highlight || repo.llm.useCase)) {
      const llmBlock = h('div', { class: 'settings-card page-block' }, [
        h('div', { class: 'page-block-title' }, `LLM 判定 · 分类 ${repo.llm.column ? colLabel(repo.llm.column) : '—'}`),
      ]);
      if (repo.llm.oneLiner) llmBlock.appendChild(h('div', {}, '一句话:' + repo.llm.oneLiner));
      if (repo.llm.highlight) llmBlock.appendChild(h('div', {}, '亮点:' + repo.llm.highlight));
      if (repo.llm.useCase) llmBlock.appendChild(h('div', {}, '适用:' + repo.llm.useCase));
      if (Array.isArray(repo.llm.tags) && repo.llm.tags.length) {
        llmBlock.appendChild(h('div', {}, '标签:' + repo.llm.tags.map((t) => '#' + t).join(' ')));
      }
      root.appendChild(llmBlock);
    }
    // 打分快照
    if (repo.finalScore != null || repo.ruleScore != null || repo.llmScore != null) {
      root.appendChild(h('div', { class: 'settings-card page-block' }, [
        h('div', { class: 'page-block-title' }, '本轮打分'),
        h('div', {}, `final=${fmtScore(repo.finalScore)} · rule=${fmtScore(repo.ruleScore)} · llm=${fmtScore(repo.llmScore)}`),
      ]));
    }
    // 打分历史
    root.appendChild(h('div', { class: 'settings-card page-block' }, [
      h('div', { class: 'page-block-title' }, '打分历史(最近 20 条)'),
      renderScoringHistory(repo.scoringHistory, teamCtx.chatId),
    ]));
    // seenWeeks
    if (Array.isArray(repo.seenWeeks) && repo.seenWeeks.length) {
      root.appendChild(h('div', { class: 'settings-card page-block' }, [
        h('div', { class: 'page-block-title' }, '出现过的周'),
        h('div', {}, repo.seenWeeks.join(' · ')),
      ]));
    }
  } catch (err) {
    renderState(root, `加载失败:${err.message || err}`, 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);
