// 用户级配置 · ~/.oss-radar-intel/config.json
//
// 目的:让 agent 不用每次重复传关键词和参数。
// 优先级:命令行参数 > 配置文件 > 默认值。
'use strict';

import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const CONFIG_DIR = process.env.OSS_RADAR_INTEL_HOME || path.join(os.homedir(), '.oss-radar-intel');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

/** 读配置 · 文件不存在或损坏都返回空对象 */
export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch {
    return {};
  }
}

/** 写配置 · 目录自动创建 · 权限 600 */
export async function saveConfig(cfg) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  await chmod(CONFIG_PATH, 0o600).catch(() => {});
  return CONFIG_PATH;
}

export async function resetConfig() {
  await rm(CONFIG_PATH, { force: true });
}

/** 可选的凭证文件 ~/.oss-radar-intel/feishu.env · 避免把 secret 贴进聊天 */
export async function loadFeishuEnv() {
  try {
    const raw = await readFile(path.join(CONFIG_DIR, 'feishu.env'), 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return {
      appId: out.FEISHU_APP_ID || '',
      appSecret: out.FEISHU_APP_SECRET || '',
      chatId: out.FEISHU_CHAT_ID || '',
    };
  } catch {
    return { appId: '', appSecret: '', chatId: '' };
  }
}

/** 把命令行里出现的参数挑出来 · 没出现的返回 undefined(交给下一级兜底) */
export function pickCliConfig(args) {
  const out = {};
  if (args.keywords != null) out.keywords = String(args.keywords).split(',').map((s) => s.trim()).filter(Boolean);
  if (args.days != null) out.days = Number(args.days);
  if (args.limit != null) out.limit = Number(args.limit);
  if (args['min-stars'] != null) out.minStars = Number(args['min-stars']);
  if (args['min-upvotes'] != null) out.minUpvotes = Number(args['min-upvotes']);
  if (args['min-points'] != null) out.minPoints = Number(args['min-points']);
  return out;
}
