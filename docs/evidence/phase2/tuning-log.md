# Phase 2 persona tuning log

Bounded to 3 iterations (rulings R8). Thresholds are contracts.md 7.3 plus P2, as shipped in
Task 9's `eval/lib/aggregate.mjs` (`AXIS_SPECS` + `SHAPE_SPECS`) and reproduced in the task brief.
The fixture is 46 prompts x 3 runs = 138 turns. Whatever the numbers are after iteration 3, they
are reported unchanged — there is no fourth pass and no threshold is moved.

Only `characters/haru/character.json` -> `card` field *values* were edited. New wording is drawn
from `docs/research/2026-08-29-persona-load-research.md` (the persona source Task 3 used) and from
the remedy table in the Task 10 brief, never invented at the keyboard.

| iteration | report | gates that failed | card fields edited | card tokens |
|---|---|---|---|---|
| — | — | NOT MEASURED (insufficient balance) | none | 673 / 700 |

## Zero iterations were run, and why

The tuning loop is driven by a **judged, live** `pnpm --filter @ds/eval run eval` run. On
2026-08-29 the owner's DeepSeek account returns HTTP 402 for every chat completion:

```
DeepSeekError: {"error":{"message":"Insufficient Balance","type":"unknown_error",
"param":null,"code":"invalid_request_error"}}
```

The key itself authenticates — a bad key returns 401 and our code maps it to the `auth` hint;
this is the `balance` hint. Reproduced here with the cheapest possible call (one prompt, one run,
no judge):

```
$env:DEEPSEEK_API_KEY = (Get-Content $HOME\.ds\deepseek.key -Raw).Trim()
pnpm --filter @ds/eval run eval -- --limit 1 --runs 1 --no-judge
# -> DeepSeekError ... "Insufficient Balance"
```

Without a live report there is no list of failing gates, so there is nothing the remedy table can
map to an edit. `characters/haru/character.json` is therefore **byte-identical to its Task 3
state**: no `card` field value was changed, and `cardTokens` is still 673 / 700 with
`staticSystemTokens` 994 / 1100 (`task-3-card-tokens.txt`, regenerated and unchanged).

Tuning against anything other than a live judged run — the `--dry` recorded corpus, the
`DS_FAKE_BRAIN` echo brain, or a guess — would be tuning the persona against text the persona
did not produce. It was not done. See [`not-measured.md`](not-measured.md) for the exact commands
to re-run once the balance is topped up.
