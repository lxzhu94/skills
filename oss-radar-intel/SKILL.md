---
name: oss-radar-intel
description: 帮用户盯 AI 新闻、HuggingFace 热门论文和 GitHub 新开源项目，可配置成每天定时抓取并推送飞书。当用户说“帮我配置一个 AI 情报雷达”“每天给我发 AI 新闻/论文/新项目”“看看今天有什么 AI 新闻”“最近有什么值得关注的论文或开源项目”，或要给团队做技术雷达、周报选题时使用。零依赖、不需要数据库、不需要 LLM key。
---

# oss-radar-intel

抓 AI 新闻、HuggingFace 热门论文、GitHub 新开源项目，输出带真实链接的 Markdown，也可以每天定时推到飞书。

**不需要 MongoDB，不需要起服务，不需要 LLM key。** 只需要 Node 20.11+ 和能上公网。

用户问“要不要装数据库 / MongoDB”时，明确回答：这个 skill 不需要。所有结果以 Markdown / JSON 存在 `~/.oss-radar-intel/`。只有想跑完整的网页版雷达（另一个项目 oss-radar）才需要 MongoDB。

## 用户只想先看看效果

不要问配置，直接跑：

```bash
node <skill-dir>/scripts/quick.mjs --no-open
```

它会用默认值抓一次、生成报告、起本地网页，但**先不要打开浏览器**。你先把中文写好、合并，再打开它打印出来的地址给用户看。这样用户不会先看到一个英文页。

## 中文由你自己完成

抓下来的原始内容是英文。**你是 agent，直接翻译和改写，不要让用户配 LLM。**

1. 读最新报告：`~/.oss-radar-intel/out/YYYY-MM-DD.json`
2. 按 oss-radar 的新闻格式，把中文内容写到 `/tmp/content.json`：
```json
{
  "overview": "一句 20-40 字当日综述",
  "news": [{ "url": "原链接", "title": "中文标题", "summary": "第一句事实。第二句影响。" }],
  "papers": [{ "url": "原链接", "title": "中文标题", "summary": "中文摘要" }],
  "repos": [{ "id": "owner/name", "description": "中文描述" }]
}
```
3. 合并回报告：`node <skill-dir>/scripts/apply-content.mjs /tmp/content.json`
4. 刷新网页即可看到中文。

新闻优先选模型/产品发布、版本更新、重要研究和新项目；只写 5-8 条最重要的，不要全部照翻；`apply-content.mjs` 会按你给的顺序只保留前 8 条。摘要两句，不要编造原文没有的事实。正文里顺带提到 AI、但主题不是 AI 的（抢票、涨价、无人机等）不要选。

## 第一次使用：要正式配置时按顺序做

用户明确说“帮我配好 / 要每天推送”时，按下面走。

### 第 1 步：环境检查

```bash
node <skill-dir>/scripts/doctor.mjs
```

看结果：

- Node 版本不达标 → 告诉用户升级到 20.11 以上，停在这里
- 三个网络源都失败 → 告诉用户检查网络/代理，停在这里
- 其它警告（没 GITHUB_TOKEN、目录待创建）可以继续，顺带告诉用户

### 第 2 步：一次问完方向和偏好

**新闻、论文、项目要分开问方向**，否则用户把 RAG 填成统一关键词，新闻会被一起过滤掉。一次性发这几条，并给默认值：

1. **新闻关注什么方向？** 默认 `AI, Agent, MCP`。
2. **论文关注什么方向？** 回车 = 和新闻一样（看全站热榜）；也可以给不同方向，比如 `RAG, retrieval`。
3. **开源项目关注什么方向？** 回车 = 和新闻一样；也可以给不同方向，比如 `MCP, Agent`。
4. **每天几点跑？** 默认 `11:00`，按用户本地时间。
5. **要推到飞书吗？** 默认走机器人应用：需要 appId、appSecret 和群 chatId。也可以用自定义机器人 webhook。只存本地也可以。
6. **每类最多几条？** 默认 20，建议 10-20。

对应 setup 参数：

- 机器人应用 → `--feishu-app-id cli_xxx --feishu-app-secret xxx --feishu-chat-id oc_xxx`
- 自定义机器人 → `--feishu-webhook https://open.feishu.cn/open-apis/bot/v2/hook/xxx`
- 论文方向和新闻不同 → 加 `--paper-filter --paper-keywords "RAG,retrieval"`
- 项目方向和新闻不同 → 加 `--repo-keywords "MCP,Agent"`
- 中文由 agent 用 `apply-content.mjs` 写入；CLI 只抓原始数据，不做翻译

### 飞书机器人应用怎么准备

1. 飞书开放平台 → 创建企业自建应用
2. 添加「机器人」能力
3. 权限：`im:message:send_as_bot`（必须）；想自动列群再加 `im:chat:readonly`
4. 发布版本，等管理员审核通过
5. 把机器人拉进目标群
6. 跑 setup：有 `im:chat:readonly` 会自动列出机器人在的群让你选；没有就手动粘贴群 chat_id（`oc_` 开头）

不确定用户有没有应用凭据时，先问清楚，不要假装能发。

### 第 3 步：写配置并测试

用参数把用户回答传进去，不要自己手写配置文件：

```bash
node <skill-dir>/scripts/setup.mjs --yes \
  --keywords "AI,Agent,MCP" \
  --daily "11:00" \
  --feishu-app-id "cli_xxx" --feishu-app-secret "xxx" --feishu-chat-id "oc_xxx" \
  --limit 20
```

不推送时去掉 `--feishu-webhook`，加 `--no-push`。

看到 `测试消息已发送` 才算配置成功。如果测试失败，把错误原文告诉用户，不要自己编 webhook。

`setup` 默认会在配置成功后**当场跑一次**，并打印新闻/论文/项目各前 3 条。不要加 `--no-run`，除非用户明确说先别跑。

### 第 4 步：把结果直接给用户

从 setup 的输出或 `~/.oss-radar-intel/out/YYYY-MM-DD.md` 里挑重点，用 5-8 条带真实链接的内容汇报。用户要的是当场看到结果，不是一篇配置说明。

### 第 5 步：定时任务只是可选

默认不装定时任务。用户主动说“以后每天自动发”时，再问一次确认，然后执行：

```bash
node <skill-dir>/scripts/schedule.mjs --install
```

macOS 会写 launchd，Linux 会写 crontab。**没得到明确同意不要装。**

## 日常使用

用户已经配置过（存在 `~/.oss-radar-intel/config.json`）后，说“看看今天有什么”时**不要重新配置**，直接：

```bash
node <skill-dir>/scripts/fetch.mjs news
node <skill-dir>/scripts/fetch.mjs papers --days 7
node <skill-dir>/scripts/fetch.mjs repos --days 7
node <skill-dir>/scripts/fetch.mjs all
```

不带参数会自动用配置里的关键词。需要临时换方向时才加 `--keywords`。

## 手动命令

```bash
# 新闻 / 论文 / 项目
node <skill-dir>/scripts/fetch.mjs news   --keywords "AI Coding,MCP" --days 1
node <skill-dir>/scripts/fetch.mjs papers --days 7 --min-upvotes 10
node <skill-dir>/scripts/fetch.mjs repos  --keywords "AI Coding,MCP" --days 7
node <skill-dir>/scripts/fetch.mjs all    --keywords "AI,Agent" --days 7 --out ./out

# 配置
node <skill-dir>/scripts/setup.mjs            # 交互式
node <skill-dir>/scripts/setup.mjs --yes ...  # 非交互
node <skill-dir>/scripts/fetch.mjs config --show  # 查看配置

# 立即执行一次完整流程(抓取 + 存文件 + 推飞书)
node <skill-dir>/scripts/run-daily.mjs

# 一键出结果（默认抓取 + 开网页）
node <skill-dir>/scripts/quick.mjs

# 只开网页
node <skill-dir>/scripts/serve.mjs

# 定时任务
node <skill-dir>/scripts/schedule.mjs           # 打印配置
node <skill-dir>/scripts/schedule.mjs --install # 安装
node <skill-dir>/scripts/schedule.mjs --remove  # 移除
```

## 常用参数

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `--keywords a,b` | 关键词，逗号分隔 | 配置里的值，否则 `AI` |
| `--days n` | 回溯天数 | news 1，papers / repos 7 |
| `--limit n` | 新闻 / 项目条数 | 20 |
| `--paper-limit n` | 论文条数 | 2 |
| `--min-stars n` | GitHub star 门槛 | 30 |
| `--min-upvotes n` | 论文点赞门槛 | 10 |
| `--min-points n` | HN 热度门槛 | 5 |
| `--paper-filter` | 论文也按关键词过滤 | 关（取 HF 热榜全部方向） |
| `--paper-keywords a,b` | 论文单独用的关键词 | 跟 `--keywords` 一样 |
| `--repo-keywords a,b` | 项目单独用的关键词 | 跟 `--keywords` 一样 |
| `--json` | 输出 JSON | 关 |
| `--out <dir>` | 写入文件 | 打印到 stdout |

飞书卡片最多显示新闻 8 条、论文 `--paper-limit` 篇（默认 2）、项目 8 个。完整结果看本地 Markdown。

## 输出说明

- **新闻**：CLI 输出原始英文搜索结果；agent 用 `apply-content.mjs` 写成 oss-radar 同款中文卡片：一句综述 + 5-8 条，每条中文标题、两句摘要、真实来源。中文 RSS 源对英文关键词命中率低，需要中文资讯时建议同时加中文关键词（如 `AI,大模型,智能体,MCP`）。
- **论文**：HuggingFace 每日热榜，按点赞排序。默认不按关键词过滤；加 `--paper-filter` 可以只看命中方向。如果当天没有命中，就不显示论文，不会拿不相关的凑数。带机构、作者、AI 摘要、GitHub 仓库与 star。
- **开源项目**：GitHub Search，按 star 排序，带描述、语言、license、topics。
- **源状态**：每个源拿到多少条、哪个源不可用。

时间统一按北京时间显示。

## 出错怎么办

- **GitHub 403 / 限流**：脚本会先尝试本机 `gh auth token`；仍限流就告诉用户设置 `GITHUB_TOKEN` 或减少关键词。脚本会跳过失败的关键词并保留已有结果。
- **Bing News RSS 不可用**：上游已停止提供 RSS，属于已知情况，不影响其他源。
- **飞书 webhook 报错**：把返回原文告诉用户，让他重新复制 webhook；不要猜。如果机器人开了签名校验，自定义 webhook 方式不支持，需要在飞书机器人设置里关掉，或改用应用机器人。
- **抓不到内容**：先跑 `doctor.mjs`，再看是不是关键词太窄或 `--days` 太小。

## 安全约定

1. 不要擅自安装或修改系统定时任务，必须用户明确同意。
2. 不要自己编造飞书 webhook、关键词或配置值。
3. 引用条目时必须带命令返回里的真实 URL，不要凭记忆补新闻或项目。
4. 配置和运行日志在 `~/.oss-radar-intel/`，生成的日报在 `~/.oss-radar-intel/out/`，保留 30 天。
