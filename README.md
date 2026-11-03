# Agent Skills

个人在用的 Agent Skills 集合。每个子目录是一个独立 skill，可以单独安装。

## 目录

| Skill | 说明 |
| --- | --- |
| [oss-radar-intel](./oss-radar-intel/) | 每天 AI 新闻、HuggingFace 热门论文、GitHub 新开源项目，可定时推飞书 |

## 安装

安装全部：

```bash
bash install.sh
```

或者只装某一个：

```bash
cp -R oss-radar-intel ~/.claude/skills/
```

装好后在 Claude Code 里输入 `/oss-radar-intel`，或者直接说“帮我看看今天有什么 AI 新闻”。

## 新增一个 skill

在仓库根目录新建目录，放 `SKILL.md`，然后重跑 `install.sh`。
