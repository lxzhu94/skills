#!/usr/bin/env node
// 定时任务 · 生成 / 安装 / 移除
//
//   node scripts/schedule.mjs                 # 打印配置，不动系统
//   node scripts/schedule.mjs --install       # 安装(macOS launchd / Linux crontab)
//   node scripts/schedule.mjs --remove        # 移除
//   node scripts/schedule.mjs all --daily 11:00
//
// 定时任务实际执行的是 run-daily.mjs：抓取 → 存文件 → 推飞书。
'use strict';

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, saveConfig, CONFIG_DIR, CONFIG_PATH } from './lib/config.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_SCRIPT = path.join(SKILL_DIR, 'scripts', 'run-daily.mjs');
const LABEL = 'com.oss-radar-intel.daily';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const CRON_MARKER = '# oss-radar-intel';
const TYPES = ['news', 'papers', 'repos', 'all'];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { out.help = true; continue; }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    if (key === 'install' || key === 'remove' || key === 'print') { out[key] = true; continue; }
    const val = argv[i + 1];
    if (val == null || val.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
    out[key] = val;
    i++;
  }
  return out;
}

async function resolveOptions(args) {
  const cfg = await loadConfig();
  const posType = args._.find((x) => TYPES.includes(x));
  const type = posType || (cfg.schedule && cfg.schedule.type) || 'all';
  const daily = String(args.daily || (cfg.schedule && cfg.schedule.time) || '11:00');
  const m = daily.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) throw new Error('--daily 格式应为 HH:MM，例如 11:00');
  return { type, daily, hour: Number(m[1]), minute: Number(m[2]), outDir: path.join(CONFIG_DIR, 'out'), logPath: path.join(CONFIG_DIR, 'run.log') };
}

const PATH_ENV = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin';

function cronLine({ hour, minute, outDir, logPath }) {
  return `${minute} ${hour} * * * OSS_RADAR_INTEL_HOME="${CONFIG_DIR}" PATH="${PATH_ENV}" "${process.execPath}" "${RUN_SCRIPT}" --out "${outDir}" >> "${logPath}" 2>&1 ${CRON_MARKER}`;
}

function plist({ hour, minute, outDir, logPath }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${process.execPath}</string>
    <string>${RUN_SCRIPT}</string>
    <string>--out</string><string>${outDir}</string>
  </array>
  <key>WorkingDirectory</key><string>${SKILL_DIR}</string>
  <key>EnvironmentVariables</key><dict>
    <key>OSS_RADAR_INTEL_HOME</key><string>${CONFIG_DIR}</string>
    <key>PATH</key><string>${PATH_ENV}</string>
  </dict>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict></plist>`;
}

export async function printSchedule(args = {}) {
  const o = await resolveOptions(args);
  process.stdout.write(`每天 ${o.daily} 运行 ${o.type}，输出到 ${o.outDir}

## 方式一：crontab（Linux / macOS）
${cronLine(o)}

## 方式二：launchd（macOS 推荐）
保存为 ${PLIST_PATH} 后执行：
launchctl load -w "${PLIST_PATH}"

${plist(o)}

配置好关键词后，也可以在 agent 里说「帮我装定时任务」，由 agent 执行：
node "${path.join(SKILL_DIR, 'scripts/schedule.mjs')}" --install

注意：定时任务跑的是 run-daily.mjs，会读 ${CONFIG_PATH} 里的关键词和推送设置。
`);
}

async function markInstalled(installed, time, type) {
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, schedule: { ...(cfg.schedule || {}), time, type, installed } });
}

async function install(args) {
  const o = await resolveOptions(args);
  if (process.platform === 'darwin') {
    await mkdir(path.dirname(PLIST_PATH), { recursive: true });
    await writeFile(PLIST_PATH, plist(o), 'utf8');
    try { execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' }); } catch { /* 未加载过 */ }
    execFileSync('launchctl', ['load', '-w', PLIST_PATH], { stdio: 'pipe' });
    await markInstalled(true, o.daily, o.type);
    process.stdout.write(`已安装 launchd：${PLIST_PATH}\n每天 ${o.daily} 运行 ${o.type}\n`);
    return;
  }
  if (process.platform === 'linux') {
    let current = '';
    try { current = execFileSync('crontab', ['-l'], { encoding: 'utf8' }); } catch { /* 无 crontab */ }
    const lines = current.split('\n').filter((l) => l.trim() && !l.includes(CRON_MARKER));
    lines.push(cronLine(o));
    execFileSync('crontab', ['-'], { input: `${lines.join('\n')}\n` });
    await markInstalled(true, o.daily, o.type);
    process.stdout.write(`已写入 crontab，每天 ${o.daily} 运行 ${o.type}\n`);
    return;
  }
  process.stdout.write('当前系统不自动安装。请参考下面的配置手动设置：\n\n');
  await printSchedule(args);
}

async function remove() {
  if (process.platform === 'darwin') {
    try { execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' }); } catch { /* ignore */ }
    await rm(PLIST_PATH, { force: true });
    const cfg = await loadConfig();
    await saveConfig({ ...cfg, schedule: { ...(cfg.schedule || {}), installed: false } });
    process.stdout.write(`已移除 launchd：${PLIST_PATH}\n`);
    return;
  }
  if (process.platform === 'linux') {
    let current = '';
    try { current = execFileSync('crontab', ['-l'], { encoding: 'utf8' }); } catch { /* ignore */ }
    const lines = current.split('\n').filter((l) => l.trim() && !l.includes(CRON_MARKER));
    execFileSync('crontab', ['-'], { input: lines.length ? `${lines.join('\n')}\n` : '' });
    const cfg = await loadConfig();
    await saveConfig({ ...cfg, schedule: { ...(cfg.schedule || {}), installed: false } });
    process.stdout.write('已从 crontab 移除\n');
    return;
  }
  process.stdout.write('当前系统无需移除，或请手动检查定时任务。\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`用法:
  node scripts/schedule.mjs                 # 打印配置
  node scripts/schedule.mjs --install       # 安装
  node scripts/schedule.mjs --remove        # 移除
  node scripts/schedule.mjs all --daily 11:00

定时任务执行 run-daily.mjs：抓取 → 存文件 → 推飞书。
`);
    return;
  }
  if (args.remove) return remove();
  if (args.install) return install(args);
  return printSchedule(args);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => { process.stderr.write(`失败：${e.message}\n`); process.exit(1); });
}
