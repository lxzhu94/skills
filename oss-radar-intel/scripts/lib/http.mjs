// 极简 HTTP 封装 · 只用 Node 20+ 内置 fetch

const UA = 'oss-radar-intel/0.1 (+https://github.com/)';
const DEFAULT_TIMEOUT_MS = 15000;

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * GET 请求，返回 { ok, status, headers, text }
 * 超时用 AbortController，不抛 fetch 原始 abort 错误。
 */
export async function httpGet(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, headers: res.headers, text };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`请求超时 ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** GET + JSON 解析 */
export async function getJson(url, opts = {}) {
  const res = await httpGet(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error(`非 JSON 响应: ${url}`);
  }
}

/** XML / RSS 粗判，用来识别被重定向到 HTML 的 RSS 接口 */
export function looksLikeXml(text) {
  return /^\s*(<\?xml|<rss|<feed)/i.test(text || '');
}
