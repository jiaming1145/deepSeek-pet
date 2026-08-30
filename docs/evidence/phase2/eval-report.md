> **SUBSTITUTED — 没设 DEEPSEEK_API_KEY，这份报告是 `--dry` 的录制语料回放，不是对模型的测量。数字只证明流水线和指标代码是对的。JSON 里 `config.dry` 是 `true`。**

# Phase 2 eval — 2026-08-30T00:47:34.152Z

> **DRY RUN — 回复来自 `eval/recorded/replies.zh.json`，不是模型输出。这些数字只证明流水线和指标代码是对的，不能说明模型好坏。**

总判定：**PASS**

## 配置

| 项 | 值 |
|---|---|
| model | `deepseek-v4-flash` |
| judge | `deepseek-v4-pro` |
| judge.md version | 1 |
| runs × prompts | 3 × 46 = 138 轮 |
| fixture | `D:\ds\eval\fixtures\prompts.zh.json` |
| character | `D:\ds\characters\haru\character.json` |
| 卡片 token | 673 / 700 |
| 静态系统块 token | 994 / 1100 |
| dry / shuffled / concurrency / seed | true / false / 4 / 1 |

## 评审轴（judge）

| 轴 | n | 实测 | 门槛 | 结果 |
|---|---|---|---|---|
| `in_character` | 138 | mean 2.00 · 2占比 100.0% | mean ≥ 1.8 且 2占比 ≥ 90.0% | PASS |
| `nativeness` | 138 | mean 2.00 · 2占比 100.0% | mean ≥ 1.8 | PASS |
| `assistant_speak` | 138 | 0 次 | ≤ 0 | PASS |
| `narrates_user` | 138 | 0 次 | ≤ 0 | PASS |
| `closing_moral` | 138 | 0 次 | ≤ 0 | PASS |
| `rhetorical_tail` | 138 | 0 次 | ≤ 0 | PASS |
| `refusal_language` | 18 | 0 次 | ≤ 0 | PASS |
| `initiative` | 24 | 100.0% | ≥ 70.0% | PASS |
| `sycophancy_pushback` | 18 | 83.3% | ≥ 50.0% | PASS |
| `humour_stops` | 9 | 100.0% | ≥ 100.0% | PASS |
| `memory_use` | 18 | 100.0% | ≥ 80.0% | PASS |
| `trait_hit` | 0 | — | ≥ 80.0% | SKIP |
| `emoji_discipline` | 138 | 2.2% | ≤ 25.0% | PASS |
| `false_disagreement` | 18 | 0.0% | ≤ 20.0% | PASS |
| `emoji_discipline_sensitive` | 18 | 0 次 | ≤ 0 | PASS |
| `judge_error_rate` | 138 | 0.0% | ≤ 5.0% | PASS |

## 形状指标（本地计算）

| 指标 | 实测 | 门槛 | 结果 |
|---|---|---|---|
| `shortReplyPct` | 100.0% | ≥ 90.0% | PASS |
| `questionRatePct` | 21.7% | ≤ 30.0% | PASS |
| `consecutiveQuestionPairs` | 0 | ≤ 0 | PASS |
| `ellipsisReplyPct` | 10.9% | ≤ 20.0% | PASS |
| `multiEllipsisCount` | 0 | ≤ 0 | PASS |
| `repetitionMaxPct` | 8.3% | < 20.0% | PASS |
| `complianceMissPct` | 0.0% | < 10.0% | PASS |
| `cacheHitPct` | — | ≥ 70.0% | SKIP |

## 只上报、不设门槛

| 项 | 值 |
|---|---|
| `prompts` | 46 |
| `turns` | 138 |
| `lintNone` | 138 |
| `lintStrip` | 0 |
| `lintRegenerate` | 0 |
| `lintRuleCounts` | {} |
| `openerRepeatCount` | 0 |
| `affectRateCount` | 0 |
| `judgeErrors` | 0 |
| `emojiJudgeDisagreements` | 0 |
| `meanHanzi` | 21.478 |
| `medianTtftMs` | 0 |
| `meanTotalMs` | 0.312 |
| `meanEstimatedPromptTokens` | 1059.239 |

## 诚实声明（R8）

- A8（3 个人格盲评归属）不在 Phase 2 范围内：现在只有一个人格，已挪到 Phase 3。
- A3/A4/A5/A9/A10/A15/A16 在这个样本量上是**方向性**结论，不是附录里 200/500 轮的分母；全分母跑在 Phase 4 的 nightly（X12）。
- 调参循环上限 3 轮；第三轮之后的数字原样上报。
- 本工具测的是模型的**原始**输出：不 strip，也不 regenerate。线上应用还会再过一遍 TurnRunner 的 lint，所以实际观感只会更好。
