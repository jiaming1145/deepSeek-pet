# Phase 2 — what could NOT be measured, and the exact commands that will measure it

Every number in this file's scope is **NOT MEASURED**. None of it is estimated, and none of it is
substituted with a `--dry` or `DS_FAKE_BRAIN` figure. This file exists so that no reader can
mistake a missing measurement for a passing one.

## The cause

On 2026-08-29 the owner's DeepSeek account returns HTTP **402 Insufficient Balance** for every chat
completion. The key at `%USERPROFILE%\.ds\deepseek.key` authenticates correctly — an invalid key
returns 401, which the client maps to the `auth` hint; this is the `balance` hint
(`DeepSeek 余额不足了`). Verified with the cheapest call the harness can make:

```powershell
$env:DEEPSEEK_API_KEY = (Get-Content $HOME\.ds\deepseek.key -Raw).Trim()
pnpm --filter @ds/eval run eval -- --limit 1 --runs 1 --no-judge
```

```
DeepSeekError: {"error":{"message":"Insufficient Balance","type":"unknown_error",
"param":null,"code":"invalid_request_error"}}
    at httpError (packages/brain/src/deepseek.ts:194:10)
```

## What that costs

| Bar | Artefact | State |
|---|---|---|
| A9 in-character, A19 nativeness, and the other 14 judged axes | `eval-report-final.json` | **not produced** — a judged report cannot be synthesised, and a `--dry` report copied under this name would be a fake |
| the 8 shape gates over live output | `eval-report-final.json` | **not produced**, same reason |
| R8's bounded 3-iteration persona tuning | `tuning-log.md` | **0 iterations** — see that file |
| R4 amended: first sentence closes ≤ 1.2 s p50 | `session-20-turns.json` | **not produced** |
| X1: prompt-cache hit ≥ 70 % from turn 3 (session) | `session-20-turns.json`, `metrics-cache-hit.txt` | **NOT MEASURED** |
| X1: prompt-cache hit ≥ 70 % (in the shipping app) | `app-20-turns.json` | **not produced** |
| addendum §0: first grapheme painted ≤ 100 ms after the first token | `app-20-turns.json` | **NOT MEASURED** |
| A-bar (the whole judged writing-quality bar) | — | **NOT passed and not failed: unmeasured** |

Everything that does not need the API was completed: the 20-turn session probe runs offline
(`session:dry`, deterministic 78.5 % cache-hit against the scripted client, which proves the
arithmetic and the report writer and nothing about DeepSeek), the whole Electron end-to-end lane
runs on `DS_FAKE_BRAIN=1`, and the light/dark shipping-app sheet, the composited desktop captures,
the resource samples and the four in-app checks are all real measurements of the real app.

## The exact command list to re-run when the balance is topped up

Run all of it from the repo root, on the Task 10 branch, in this order. Each line reads the key
inside the single command that needs it and never prints it.

```powershell
# 0. preconditions
pnpm -r --if-present typecheck
pnpm test
pnpm test:eval
pnpm --filter @ds/desktop build

# 1. the pre-tuning live baseline (Task 9's committed eval-report.{json,md} is a --dry run;
#    replace it, or keep both and say which is which)
$env:DEEPSEEK_API_KEY = (Get-Content $HOME\.ds\deepseek.key -Raw).Trim(); pnpm --filter @ds/eval run eval

# 2. Task 10 Step 12, the bounded tuning loop: at most THREE iterations. After each run, list the
#    failing gates, apply ONLY the mapped edit from the brief's remedy table, re-run `pnpm test`,
#    regenerate the three task-3-*.txt files with Task 3 Step 9's one-liner, append a row to
#    tuning-log.md and commit.
node -e "const fs=require('fs');const f=fs.readdirSync('eval/out').filter(n=>/^\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(n)).sort().pop();const r=JSON.parse(fs.readFileSync('eval/out/'+f,'utf8'));console.log('report',f,'turns',r.informational.turns,'prompts',r.informational.prompts,'pass',r.pass);for(const [k,v] of Object.entries(r.axes)) if(!v.skipped&&!v.pass) console.log('FAIL axis',k,JSON.stringify(v));for(const [k,v] of Object.entries(r.shapeGates)) if(!v.skipped&&!v.pass) console.log('FAIL shape',k,v.value,v.cmp,v.threshold);"

# 3. copy the last report in as the post-tuning result
node -e "const fs=require('fs');const f=fs.readdirSync('eval/out').filter(n=>/^\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(n)).sort().pop();fs.copyFileSync('eval/out/'+f,'docs/evidence/phase2/eval-report-final.json');fs.copyFileSync('eval/out/'+f.replace('.json','.md'),'docs/evidence/phase2/eval-report-final.md');console.log('copied',f)"

# 4. Task 10 Step 13, the 20-turn session probe (R4's first-sentence bar, X1's cache-hit bar)
$env:DEEPSEEK_API_KEY = (Get-Content $HOME\.ds\deepseek.key -Raw).Trim(); pnpm --filter @ds/eval run session
node -e "const fs=require('fs');const f=fs.readdirSync('eval/out').filter(n=>n.startsWith('session-')&&n.endsWith('.json')).sort().pop();fs.copyFileSync('eval/out/'+f,'docs/evidence/phase2/session-20-turns.json');fs.copyFileSync('eval/out/'+f.replace('.json','.md'),'docs/evidence/phase2/session-20-turns.md');const r=JSON.parse(fs.readFileSync('docs/evidence/phase2/session-20-turns.json','utf8'));console.log('firstSentenceP50',r.summary.firstSentenceP50,'firstSentenceP90',r.summary.firstSentenceP90,'firstEmitP50',r.summary.firstEmitP50,'cacheHitFrom3',r.summary.cacheHitFrom3,'pass',r.pass)"

# 5. metrics-cache-hit.txt, derived from the file just copied (Task 10 Step 13's second one-liner)
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('docs/evidence/phase2/session-20-turns.json','utf8'));const rows=r.turns.filter(t=>t.turn>=3);const hit=rows.reduce((a,t)=>a+t.cacheHit,0);const tot=rows.reduce((a,t)=>a+t.promptTokens,0);const out=['prompt_cache_hit_tokens / prompt_tokens - one continuous session, turns 3+','source: docs/evidence/phase2/session-20-turns.json (eval/session.mjs)','model: '+r.model,'started: '+r.startedAt,'turns 3+ cache-hit tokens: '+hit,'turns 3+ prompt tokens: '+tot,'cache-hit ratio: '+(tot===0?0:(hit/tot*100)).toFixed(1)+' % (bar >= 70.0 %, X1)',''].concat(r.turns.map(t=>'turn '+t.turn+' '+t.cacheHit+'/'+t.promptTokens)).join('\n')+'\n';fs.writeFileSync('docs/evidence/phase2/metrics-cache-hit.txt',out,'utf8');process.stdout.write(out.split('\n').slice(0,7).join('\n')+'\n');"

# 6. Task 10 Step 14, the real-API end-to-end run in the shipping app
$env:DEEPSEEK_API_KEY = (Get-Content $HOME\.ds\deepseek.key -Raw).Trim(); pnpm --filter @ds/desktop build; $env:DEEPSEEK_API_KEY = (Get-Content $HOME\.ds\deepseek.key -Raw).Trim(); pnpm --filter @ds/desktop run "test:e2e:electron" -- --grep "20 real turns"
node -e "const r=require('./docs/evidence/phase2/app-20-turns.json');console.log('cacheHitPct',(r.cacheHitPct*100).toFixed(1)+'%','paintP50',r.paintP50.toFixed(0)+'ms','paintSamples',r.paintSamples,'turns',r.turns.length)"

# 7. re-run the WHOLE Electron lane so e2e-report.json records both halves
pnpm --filter @ds/desktop run "test:e2e:electron"
```

After step 7, replace the four `NOT MEASURED` placeholder files
(`eval-report-final.md`, `session-20-turns.md`, `app-20-turns.md`, `metrics-cache-hit.txt`) with the
real artefacts, delete this file's rows from `README.md`'s headline table, and update
`deferred.md`'s shortfall table.
