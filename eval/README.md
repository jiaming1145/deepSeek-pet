# `@ds/eval` — Phase 2 眼力活儿

跑一遍固定的中文 fixture，量三件事：**判官打分**（`deepseek-v4-pro`，thinking 开着）、**本地形状指标**、**slop linter 的原始命中**。

## 怎么跑

```bash
pnpm install                       # eval 是 workspace 包（R1）
cd /d/ds/eval                      # Git Bash 写法；PowerShell 是 Set-Location D:\ds\eval

node run.mjs --dry                 # 离线：用录好的回复，不联网、不需要 key。CI 跑这个。
node --test lib/*.test.mjs         # 单元测 + golden fixture 测（等价于仓库根目录的 pnpm test:eval）

export DEEPSEEK_API_KEY="sk-..."   # Git Bash；PowerShell 是 $env:DEEPSEEK_API_KEY = "sk-..."
node run.mjs                       # 联网：46 条 × 3 轮 = 138 轮 + 判官
node run.mjs --limit 6 --runs 1    # 冒烟
node run.mjs --no-judge            # 只要形状指标
node run.mjs --ablation            # P5 / 研究 §4.5 E-1 的四路人格消融
```

退出码：`0` 所有生效的门槛都过了 · `1` 有门槛没过（报告照样写） · `2` 用法或配置错误。

> **为什么是 `node --test lib/*.test.mjs` 而不是 `node --test lib/`。** Node v24.17.0 把 `--test` 的位置参数当 glob 展开，`lib/` 只匹配到目录条目本身，于是运行器把 `lib` 当成一个测试**文件**去执行并报 `Cannot find module …\eval\lib`。在仓库外的空目录里同样可复现，与本仓库无关。契约 §7.1 写的 `node --test lib/` 在这个 Node 版本上跑不起来，所以脚本改成上面这一行——语义不变（还是 node:test，还是只跑 `lib/`），只是把 glob 写全。

## 报告

`eval/out/<YYYY-MM-DD>-<HHmm>.json` + `.md`（时间戳按 UTC）。`out/` 是 gitignore 的；要留档就手动 `git add -f` 那两个文件，或者拷到 `docs/evidence/phase2/`。

## fixture

`fixtures/prompts.zh.json`，46 条：R8 的 8 bland · 8 adversarial · 6 sensitive · 6 flawed · 6 memory · 6 humour，加上 P2 要求的 6 条 **valid 对照组**（用户说的是对的，她抬杠就算失败）。`mix` 块声明每个类别的条数，`validateFixture` 会核对，并且硬校验 R8 那六个数字。要加 E-3 的人设特征探针（`trait` 类别 + `trait_hit` 轴），改 `mix` 加条目就行，harness 不用动 —— 那部分归 Task 10。

`axes` 只写这一条**额外**要评的轴；七个通用轴（`in_character` `assistant_speak` `narrates_user` `closing_moral` `rhetorical_tail` `emoji_discipline` `nativeness`）每条都评。

## `--dry` 是什么

`recorded/replies.zh.json` 里是手写的 46 条"好回复"，按种子切成 1–7 个字的小块喂给 `StreamParser`（顺便测它的分块安全）。判官分数来自 `recorded/judgements.json`。**这些数字只证明流水线和指标代码是对的，说明不了模型好坏** —— `.md` 报告顶上会打这个横幅。

## 它**不**做什么

harness 量的是模型的**原始**输出：不 strip，不 regenerate。线上 `TurnRunner` 还会再过一遍 lint（R4），所以实际观感只会比这里的数字好。

`LintContext.recent` = 同一轮里前面最多 5 条已 sanitize 的回复，按 fixture 顺序。fixture **不打乱**：`recent`、`question-streak`、`opener-repeat`、`consecutiveQuestionPairs` 全是顺序相关的，固定顺序才能让两次跑可比。`--seed` 只喂 `--dry` 的分块。

## 诚实声明（R8）

- **A8（3 个人格盲评归属）不在 Phase 2 范围内**：现在只有一个人格，已挪到 Phase 3。
- **A3 / A4 / A5 / A9 / A10 / A15 / A16 在 n = 138 上是方向性结论**，不是附录里 200 / 500 轮的分母。全分母跑在 Phase 4 的 nightly（X12）。
- **调参循环上限 3 轮**（R8）。第三轮之后的数字原样上报，不修门槛。调参本身归 Task 10，这里只给基线。
- 缓存命中率按每轮第 3 条起统计；DeepSeek 的前缀缓存是 best-effort，短会话本来就命中不满。
