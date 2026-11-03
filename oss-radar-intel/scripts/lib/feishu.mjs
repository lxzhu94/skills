// 飞书推送 · 两种方式
//
// 1. 机器人应用(feishu-app)：appId + appSecret + 群 chatId。需要自建应用、开机器人能力、
//    申请 im:message:send_as_bot 权限，把机器人拉进群。功能最稳，也是默认方式。
// 2. 自定义机器人 webhook(feishu-webhook)：群里加机器人直接拿一条链接，最省事。
'use strict';

import { bjNow } from './format.mjs';

const API_BASE = process.env.FEISHU_API_BASE || 'https://open.feishu.cn';

async function postJson(url, body, headers = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  if (!resp.ok) throw new Error(`飞书返回 HTTP ${resp.status}: ${text.slice(0, 200)}`);
  return { data, text };
}

async function getJson(url, headers = {}) {
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  if (!resp.ok) throw new Error(`飞书返回 HTTP ${resp.status}: ${text.slice(0, 200)}`);
  return data;
}

export async function getTenantToken(appId, appSecret) {
  if (!appId || !appSecret) throw new Error('飞书应用缺 appId / appSecret');
  const { data, text } = await postJson(`${API_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    app_id: appId,
    app_secret: appSecret,
  });
  if (data && data.code != null && Number(data.code) !== 0) {
    throw new Error(`获取 tenant_access_token 失败：${data.code} ${data.msg || ''}`);
  }
  const token = data && data.tenant_access_token;
  if (!token) throw new Error(`获取 tenant_access_token 失败：${String(text).slice(0, 200)}`);
  return token;
}

/** 列出机器人所在的群 · 需要 im:chat:readonly 权限 */
export async function listChats({ appId, appSecret }) {
  const token = await getTenantToken(appId, appSecret);
  const data = await getJson(`${API_BASE}/open-apis/im/v1/chats?page_size=50`, {
    Authorization: `Bearer ${token}`,
  });
  if (data && data.code != null && Number(data.code) !== 0) {
    throw new Error(`列出群失败：${data.code} ${data.msg || ''}`);
  }
  return ((data && data.data && data.data.items) || []).map((x) => ({ id: x.chat_id, name: x.name }));
}

/** 用机器人应用发卡片到群 */
export async function sendAppCard({ appId, appSecret, chatId }, cardPayload, opts = {}) {
  if (!chatId) throw new Error('缺群 chatId');
  if (opts.dryRun) {
    process.stdout.write(`${JSON.stringify(cardPayload, null, 2)}\n`);
    return { ok: true, dryRun: true };
  }
  const token = await getTenantToken(appId, appSecret);
  const card = cardPayload && cardPayload.card ? cardPayload.card : cardPayload;
  const { data } = await postJson(
    `${API_BASE}/open-apis/im/v1/messages?receive_id_type=chat_id`,
    { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) },
    { Authorization: `Bearer ${token}` },
  );
  if (data && data.code != null && Number(data.code) !== 0) {
    throw new Error(`发送消息失败：${data.code} ${data.msg || ''}`);
  }
  return { ok: true, raw: data };
}

/** 按配置分发 · delivery.type: feishu-app | feishu-webhook | none */
export async function deliver(delivery, cardPayload, opts = {}) {
  const d = delivery || { type: 'none' };
  if (d.type === 'feishu-app') return sendAppCard(d, cardPayload, opts);
  if (d.type === 'feishu-webhook') return sendWebhook(d.webhookUrl, cardPayload, opts);
  return { ok: false, skipped: true };
}

function clip(s, n) {
  const t = String(s || '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function itemLine(item) {
  const title = clip(item.title || item.id || '(无标题)', 70);
  const link = item.url ? `[${title}](${item.url})` : title;
  const meta = [];
  if (item.source) meta.push(item.source);
  if (item.score) meta.push(`${item.score} 分`);
  if (item.stars) meta.push(`★${item.stars}`);
  if (item.upvotes) meta.push(`${item.upvotes} 赞`);
  return `**${link}**${meta.length ? ` · ${meta.join(' · ')}` : ''}`;
}

function section(title, items, max) {
  const list = (items || []).slice(0, max);
  if (!list.length) return [];
  const lines = [`**${title}**`];
  for (const it of list) {
    lines.push(`· ${itemLine(it)}`);
    if (it.summary) lines.push(`  ${clip(it.summary, 90)}`);
  }
  return [{ tag: 'div', text: { tag: 'lark_md', content: lines.join('\n') } }, { tag: 'hr' }];
}

export function buildCard(payload) {
  const elements = [];
  const limit = Number(payload.query && payload.query.limit) || 20;
  const overview = payload.overview || `新闻 ${payload.news.length} 条 · 论文 ${payload.papers.length} 篇 · 项目 ${payload.repos.length} 个`;
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: overview } }, { tag: 'hr' });
  elements.push(...section('新闻', payload.news, Math.min(limit, 8)));
  if (payload.papers.length || !(payload.query && payload.query.paperFilter)) {
    elements.push(...section('论文', payload.papers, Math.min(Number(payload.query && payload.query.paperLimit) || 2, 5)));
  } else {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '**论文**\n今天没有命中关键词的论文。' } }, { tag: 'hr' });
  }
  elements.push(...section('开源项目', payload.repos, Math.min(limit, 8)));
  if (payload.warnings && payload.warnings.length) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `_提示：${clip(payload.warnings[0], 100)}_` } });
  }
  elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: `oss-radar-intel · ${bjNow()}` }],
  });
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: 'blue',
        title: { tag: 'plain_text', content: `AI 情报 · ${bjNow().slice(0, 10)}` },
      },
      elements,
    },
  };
}

/** 发送到自定义机器人 webhook · 返回 { ok, raw } */
export async function sendWebhook(url, payload, opts = {}) {
  if (!url) throw new Error('未配置飞书 webhook');
  if (opts.dryRun) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return { ok: true, dryRun: true };
  }
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const text = await resp.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* 非 JSON */ }
  if (!resp.ok) throw new Error(`飞书返回 HTTP ${resp.status}: ${text.slice(0, 200)}`);
  const code = body && (body.code ?? body.StatusCode);
  if (code != null && Number(code) !== 0) {
    throw new Error(`飞书返回错误 ${code}: ${(body && (body.msg || body.StatusMessage)) || text.slice(0, 200)}`);
  }
  return { ok: true, raw: body };
}

export function buildTestCard() {
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: { template: 'green', title: { tag: 'plain_text', content: 'oss-radar-intel 配置成功' } },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: '以后每天会按你设置的时间，把 AI 新闻、论文和新开源项目发到这个群。' } },
        { tag: 'note', elements: [{ tag: 'plain_text', content: bjNow() }] },
      ],
    },
  };
}
