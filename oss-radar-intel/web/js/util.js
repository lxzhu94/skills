/* util.js — formatting + XSS-safe DOM helpers · no external deps */

/** create element with props/children · safe alternative to innerHTML strings */
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // caller responsibility · used only for trusted static
    else el.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

/** 1234 -> "1.2k" · 12345 -> "12.3k" · 1200000 -> "1.2M" */
export function fmtStars(n) {
  if (n == null || isNaN(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}

/** ISO(UTC) -> 北京时间显示 · mode:
 *   'time'   -> "14:32"        (仅时分)
 *   'md_hm'  -> "09-20 14:32"  (月-日 时:分)
 *   'ymd'    -> "2026-09-20"   (年-月-日)
 *   'ymd_hm' -> "2026-09-20 14:32"
 * 严禁 toLocaleString · 手工 +8h 才稳(见 CLAUDE.md § 三·D-2)
 */
export function fmtBjTime(iso, mode = 'time') {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const bj = new Date(t + 8 * 3600 * 1000).toISOString();
  if (mode === 'ymd') return bj.slice(0, 10);
  if (mode === 'md_hm') return bj.slice(5, 16).replace('T', ' ');
  if (mode === 'ymd_hm') return bj.slice(0, 16).replace('T', ' ');
  return bj.slice(11, 16);
}

/** 顶栏 nprogress 风格 · 单例 · start()/done() 引用计数
 * 用法:progress.start() 前 · progress.done() 后(finally 保证)
 */
export const progress = (() => {
  let bar = null;
  let active = 0;
  let pct = 0;
  let timer = 0;
  function ensure() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'topbar-progress';
    document.body.appendChild(bar);
    return bar;
  }
  function set(p) {
    pct = Math.max(0, Math.min(100, p));
    const el = ensure();
    el.style.width = pct + '%';
    el.style.opacity = pct === 0 || pct >= 100 ? '0' : '1';
  }
  return {
    start() {
      active++;
      if (active === 1) {
        set(15);
        clearInterval(timer);
        timer = setInterval(() => {
          const delta = (90 - pct) * 0.06;
          if (delta > 0.1) set(pct + delta);
        }, 200);
      }
    },
    done() {
      active = Math.max(0, active - 1);
      if (active === 0) {
        clearInterval(timer);
        set(100);
        setTimeout(() => set(0), 300);
      }
    },
  };
})();

/** ISO date -> "3d ago" / "5h ago" / "2mo ago" */
export function fmtAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + 'd ago';
  if (diff < 86400 * 365) return Math.floor(diff / (86400 * 30)) + 'mo ago';
  return Math.floor(diff / (86400 * 365)) + 'y ago';
}

/** YYYY-MM-DD -> "8月31日" */
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** column -> css class · 'work'|'toy'|'skip' */
export function colClass(col) {
  return col === 'work' || col === 'toy' || col === 'skip' ? col : 'skip';
}

/** column -> 面向用户的中文标签 · css class 仍走 colClass 保持不变 */
const COL_LABEL = { work: '工作可用', toy: '玩具尝鲜', skip: '略过' };
export function colLabel(col) {
  return COL_LABEL[col] || COL_LABEL.skip;
}

/** ISO week "2026-W38" -> "9月15日 - 9月21日"(周一到周日) */
export function weekRange(w) {
  if (!w || typeof w !== 'string') return '';
  const m = w.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return '';
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO 周一是每周第 1 天 · 第 1 周含 1 月 4 日
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;   // 周日算 7
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1) + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d) => `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  return `${fmt(monday)} - ${fmt(sunday)}`;
}

/** score number formatting · always 1 decimal */
export function fmtScore(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(1);
}

/** github avatar url · fallback identicon */
export function ghAvatar(owner) {
  if (!owner) return '';
  return `https://github.com/${encodeURIComponent(owner)}.png?size=80`;
}

/** localStorage getter with default */
export function loadPref(key, dflt) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? dflt : JSON.parse(v);
  } catch { return dflt; }
}
export function savePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/** debounce · used for search box if added later */
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** render a set of tag chips as clickable spans · onclick receives tag string */
export function renderTags(tags, activeSet, onclick) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const wrap = h('span', { class: 'tag-inline' });
  tags.forEach((t, i) => {
    if (i > 0) wrap.appendChild(document.createTextNode(' '));
    const chip = h('span', {
      class: 'tag',
      onclick: (e) => { e.stopPropagation(); onclick && onclick(t); },
    }, '#' + t);
    if (activeSet && activeSet.has(t)) chip.style.color = 'var(--accent-toy)';
    wrap.appendChild(chip);
  });
  return wrap;
}

/** loading 骨架 · 统一 skel-list/skel-card 结构 · 各页共用
 * 用法:renderLoading(root, rows)
 * 想要文本 loading 用 renderState / renderEmpty · 骨架保持 CSS 一致
 */
export function renderLoading(root, rows = 5) {
  if (!root) return;
  root.innerHTML = '';
  const list = h('div', { class: 'skel-list' });
  for (let i = 0; i < rows; i++) {
    list.appendChild(h('div', { class: 'skel-card' }, [
      h('div', { class: 'skel-avatar' }),
      h('div', { class: 'skel-lines' }, [
        h('div', { class: 'skel-line w-30' }),
        h('div', { class: 'skel-line w-80' }),
        h('div', { class: 'skel-line w-60' }),
        h('div', { class: 'skel-line w-50' }),
      ]),
    ]));
  }
  root.appendChild(list);
}

/** language color chip · minimal · GitHub-ish common colors */
const LANG_COLOR = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Go: '#00ADD8',
  Rust: '#dea584', Java: '#b07219', C: '#555555', 'C++': '#f34b7d', Ruby: '#701516',
  Swift: '#F05138', Kotlin: '#A97BFF', PHP: '#4F5D95', Shell: '#89e051', HTML: '#e34c26',
  CSS: '#563d7c', Vue: '#41b883', Dart: '#00B4AB', Zig: '#ec915c',
};
export function langChip(lang) {
  if (!lang) return null;
  const color = LANG_COLOR[lang] || '#8b949e';
  return h('span', { class: 'lang-chip', style: { color } }, '● ' + lang);
}
