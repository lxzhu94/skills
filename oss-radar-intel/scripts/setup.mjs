#!/usr/bin/env node
// 首次配置向导 · 人机都能用
//
// 人工交互:
//   node scripts/setup.mjs
//
// agent 非交互(把用户回答转成参数):
//   node scripts/setup.mjs --yes \
//     --keywords "AI,Agent,MCP" --daily 11:00 \
//     --feishu-app-id "cli_xxx" --feishu-app-secret "xxx" --feishu-chat-id "oc_xxx"
//
// 推送方式:
//   默认机器人应用(appId/appSecret + 群 chatId)
//   也可以用自定义机器人 webhook:--feishu-webhook URL
//   不推送:--no-push
'use strict';

import readline from 'node:readline/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, loadFeishuEnv, CONFIG_PATH } from './lib/config.mjs';
import { listChats, deliver, buildTestCard } from './lib/feishu.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_KEYWORDS = ['AI', 'Agent', 'MCP'];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { out.help = true; continue; }
    if (a === '--yes' || a === '--no-push' || a === '--no-test' || a === '--no-run' || a === '--install-schedule' || a === '--paper-filter') {
      out[a.slice(2)] = true;
      continue;
    }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    out[a.slice(2)] = argv[++i];
  }
  return out;
}

function splitKeywords(v) {
  return String(v || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
}

function validTime(t) {
  return /^([01]?\d|2[0-3]):([0-5]\d)$/.test(String(t || ''));
}

function validWebhook(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return false;
    const host = x.hostname;
    return /(^|\.)(feishu\.cn|larksuite\.com)$/.test(host)
      || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch { return false; }
}

function validAppId(v) {
  return /^cli_[A-Za-z0-9]+$/.test(String(v || ''));
}

async function chooseChat({ appId, appSecret, current }) {
  process.stdout.write('\n尝试列出机器人所在的群……\n');
  try {
    const chats = await listChats({ appId, appSecret });
    if (chats.length) {
      chats.forEach((c, i) => process.stdout.write(`  ${i + 1}. ${c.name || '(无名字)'}  ${c.id}\n`));
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const pick = String(await rl.question('输入编号，或直接粘贴 chat_id：')).trim();
        if (/^\d+$/.test(pick) && chats[Number(pick) - 1]) return chats[Number(pick) - 1].id;
        return pick || current || '';
      } finally { rl.close(); }
    }
    process.stdout.write('机器人还没加入任何群。请先把机器人拉进群，或手动粘贴 chat_id。\n');
  } catch (e) {
    process.stdout.write(`自动列群失败：${e.message}\n`);
    process.stdout.write('常见原因：应用还没开 im:chat:readonly 权限，或机器人没进群。可以手动粘贴 chat_id。\n');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return String(await rl.question('粘贴群 chat_id（oc_ 开头）：')).trim() || current || '';
  } finally { rl.close(); }
}

async function askInteractive(cfg) {
  const envCred = await loadFeishuEnv();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, def) => {
    const a = String(await rl.question(`${q}${def ? `（默认 ${def}）` : ''}：`)).trim();
    return a || def;
  };
  try {
    process.stdout.write('配置 oss-radar-intel。回车直接用默认值。\n\n');
    const kw = await ask('新闻关注什么方向？多个用逗号分隔', (cfg.keywords || DEFAULT_KEYWORDS).join(','));
    const newsKw = splitKeywords(kw);
    const paperDefault = cfg.paperFilter ? (cfg.paperKeywords || []).join(',') : '';
    const paperAns = await ask('论文关注什么方向？回车=和新闻一样，输入 all=全部热榜', paperDefault);
    const repoDefault = (cfg.repoKeywords || []).length ? cfg.repoKeywords.join(',') : '';
    const repoAns = await ask('开源项目关注什么方向？回车=和新闻一样', repoDefault);
    const daily = await ask('每天几点跑？格式 HH:MM', (cfg.schedule && cfg.schedule.time) || '11:00');
    const limit = await ask('新闻和项目每类最多几条', String(cfg.limit || 20));
    const paperLimit = await ask('论文每天最多几篇', String(cfg.paperLimit || 2));


    const cur = cfg.delivery || {};
    const defaultPush = cur.type === 'none' ? '3' : (cur.type === 'feishu-webhook' ? '2' : '1');
    const push = await ask('结果发到哪里？1 机器人应用（默认）2 自定义机器人 webhook 3 只存本地', defaultPush);
    let delivery = { type: 'none' };
    if (push === '1') {
      const appId = await ask('机器人应用 appId（cli_ 开头）', cur.appId || envCred.appId || process.env.FEISHU_APP_ID || '');
      const secretDefault = cur.appSecret || envCred.appSecret || process.env.FEISHU_APP_SECRET || '';
      const secretAns = String(await rl.question(`机器人应用 appSecret${secretDefault ? '（按回车使用已保存的值，不会回显）' : ''}：`)).trim();
      const appSecret = secretAns || secretDefault;
      process.stdout.write('\n先把机器人拉进目标群，并确认应用已开 im:message:send_as_bot 权限。\n');
      const chatId = await chooseChat({ appId, appSecret, current: cur.chatId || envCred.chatId });
      delivery = { type: 'feishu-app', appId, appSecret, chatId };
    } else if (push === '2') {
      process.stdout.write('\n获取飞书 webhook：群设置 → 群机器人 → 添加机器人 → 自定义机器人 → 复制 webhook 地址。\n\n');
      const webhookUrl = await ask('粘贴飞书 webhook 地址', cur.webhookUrl);
      delivery = { type: 'feishu-webhook', webhookUrl };
    }

    const paperKw = paperAns && paperAns.toLowerCase() !== 'all' ? splitKeywords(paperAns) : [];
    const sameAsNews = paperKw.join(',') === newsKw.join(',');
    const repoKw = repoAns ? splitKeywords(repoAns) : [];
    return {
      keywords: newsKw,
      daily,
      paperLimit: Number(paperLimit),
      delivery,
      limit: Number(limit),
      paperFilter: paperKw.length > 0 && !sameAsNews,
      paperKeywords: paperKw.length > 0 && !sameAsNews ? paperKw : [],
      repoKeywords: repoKw.join(',') === newsKw.join(',') ? [] : repoKw,
    };
  } finally {
    rl.close();
  }
}

async function buildNonInteractiveDelivery(args, cfg) {
  if (args['no-push']) return { type: 'none' };
  const cur = cfg.delivery || {};
  const envCred = await loadFeishuEnv();
  const appId = args['feishu-app-id'] || envCred.appId || process.env.FEISHU_APP_ID || cur.appId || '';
  const appSecret = args['feishu-app-secret'] || envCred.appSecret || process.env.FEISHU_APP_SECRET || cur.appSecret || '';
  const chatId = args['feishu-chat-id'] || envCred.chatId || process.env.FEISHU_CHAT_ID || cur.chatId || '';
  const webhookUrl = args['feishu-webhook'] || (cur.type === 'feishu-webhook' ? cur.webhookUrl : '') || '';

  if (appId || appSecret || chatId) {
    if (!appId || !appSecret || !chatId) {
      throw new Error('机器人应用推送需要同时提供 --feishu-app-id、--feishu-app-secret、--feishu-chat-id');
    }
    return { type: 'feishu-app', appId, appSecret, chatId };
  }
  if (webhookUrl) return { type: 'feishu-webhook', webhookUrl };
  if (cur.type === 'feishu-app' && cur.appId && cur.appSecret && cur.chatId) return cur;
  if (cur.type === 'feishu-webhook' && cur.webhookUrl) return cur;
  throw new Error('要推送需要机器人应用凭据（--feishu-app-id/--feishu-app-secret/--feishu-chat-id），或 --feishu-webhook，或加 --no-push 只存本地');
}

function validateDelivery(d) {
  if (d.type === 'feishu-app') {
    if (!validAppId(d.appId)) throw new Error('appId 格式不对，应以 cli_ 开头');
    if (!d.appSecret || String(d.appSecret).length < 10) throw new Error('appSecret 看起来不对');
    if (!d.chatId) throw new Error('缺群 chatId');
    return;
  }
  if (d.type === 'feishu-webhook' && !validWebhook(d.webhookUrl)) {
    throw new Error('飞书 webhook 地址无效。可以先用 --no-push 只存本地，或粘贴机器人给的完整地址');
  }
}

function describeDelivery(d) {
  if (d.type === 'feishu-app') return `机器人应用 → 群 ${d.chatId}`;
  if (d.type === 'feishu-webhook') return '自定义机器人 webhook';
  return '只存本地';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`用法:
  node scripts/setup.mjs                 # 交互式配置
  node scripts/setup.mjs --yes --keywords "AI,Agent" --daily 11:00 \\
    --feishu-app-id "cli_xxx" --feishu-app-secret "xxx" --feishu-chat-id "oc_xxx"

参数:
  --keywords a,b / --daily HH:MM / --type all / --limit 20 / --paper-limit 2 / --days 7
  --feishu-app-id / --feishu-app-secret / --feishu-chat-id   机器人应用推送(默认方式)
  --feishu-webhook URL                                        自定义机器人 webhook
  --no-push / --no-test / --no-run / --install-schedule
  --paper-filter / --paper-keywords a,b / --repo-keywords a,b
  --yes
`);
    return;
  }

  const cfg = await loadConfig();
  let answers;
  if (args.yes || !process.stdin.isTTY) {
    answers = {
      keywords: splitKeywords(args.keywords).length ? splitKeywords(args.keywords) : (cfg.keywords || DEFAULT_KEYWORDS),
      daily: String(args.daily || (cfg.schedule && cfg.schedule.time) || '11:00'),
      delivery: await buildNonInteractiveDelivery(args, cfg),
      limit: Number(args.limit || cfg.limit || 20),
      paperLimit: Number(args['paper-limit'] || cfg.paperLimit || 2),
      paperFilter: args['paper-filter'] === true || cfg.paperFilter === true || splitKeywords(args['paper-keywords']).length > 0,
      paperKeywords: splitKeywords(args['paper-keywords']).length
        ? splitKeywords(args['paper-keywords'])
        : (cfg.paperKeywords || []),
      repoKeywords: splitKeywords(args['repo-keywords']).length
        ? splitKeywords(args['repo-keywords'])
        : (cfg.repoKeywords || []),
    };
  } else {
    answers = await askInteractive(cfg);
  }

  if (!answers.keywords.length) throw new Error('至少需要一个关键词');
  if (!validTime(answers.daily)) throw new Error('时间格式应为 HH:MM，例如 11:00');
  validateDelivery(answers.delivery);

  const next = {
    ...cfg,
    keywords: answers.keywords,
    days: Number(args.days || cfg.days || 7),
    limit: answers.limit,
    paperLimit: answers.paperLimit != null ? answers.paperLimit : 2,
    delivery: answers.delivery,
    schedule: {
      time: answers.daily,
      type: args.type || (cfg.schedule && cfg.schedule.type) || 'all',
    },
    paperFilter: answers.paperFilter === true,
    ...(answers.paperKeywords && answers.paperKeywords.length ? { paperKeywords: answers.paperKeywords } : {}),
    ...(answers.repoKeywords && answers.repoKeywords.length ? { repoKeywords: answers.repoKeywords } : {}),
  };
  await saveConfig(next);

  process.stdout.write(`\n已保存配置：${CONFIG_PATH}\n`);
  process.stdout.write(`新闻方向：${next.keywords.join('、')}\n`);
  process.stdout.write(`论文方向：${next.paperFilter ? `${(next.paperKeywords || []).join('、')}（只看相关）` : 'HuggingFace 全站热榜'}\n`);
  process.stdout.write(`项目方向：${(next.repoKeywords && next.repoKeywords.length ? next.repoKeywords : next.keywords).join('、')}\n`);
  process.stdout.write(`每天：${next.schedule.time} · ${next.schedule.type} · 新闻/项目 ${next.limit} 条 · 论文 ${next.paperLimit} 篇\n`);
  process.stdout.write(`推送：${describeDelivery(next.delivery)}${process.env.GITHUB_TOKEN ? '' : '（建议设置 GITHUB_TOKEN，GitHub 结果会更稳）'}\n`);

  if (next.delivery.type !== 'none' && !args['no-test']) {
    process.stdout.write('\n发送测试消息……\n');
    try {
      await deliver(next.delivery, buildTestCard());
      process.stdout.write('测试消息已发送，去群里看看。\n');
    } catch (e) {
      process.stdout.write(`测试消息发送失败：${e.message}\n配置已保存，修好推送设置后重跑 setup。\n`);
      process.exitCode = 2;
      return;
    }
  }

  if (!args['no-run']) {
    process.stdout.write('\n马上跑一次，给你看结果……\n');
    execFileSync(process.execPath, [path.join(SKILL_DIR, 'scripts/run-daily.mjs')], { stdio: 'inherit' });
    process.stdout.write(`\n想用网页看完整结果：node "${path.join(SKILL_DIR, 'scripts/serve.mjs')}"\n`);
  }

  if (args['install-schedule']) {
    process.stdout.write('\n安装定时任务……\n');
    execFileSync(process.execPath, [path.join(SKILL_DIR, 'scripts/schedule.mjs'), '--install', '--daily', next.schedule.time], { stdio: 'inherit' });
  } else {
    process.stdout.write(`\n想让它每天自动跑时，再执行：\nnode "${path.join(SKILL_DIR, 'scripts/schedule.mjs')}" --install\n`);
  }
}

main().catch((e) => { process.stderr.write(`失败：${e.message}\n`); process.exit(1); });
