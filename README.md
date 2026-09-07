# ds — DeepSeek-driven Live2D desktop companion

Windows desktop pet with a Live2D avatar and a DeepSeek brain. Phase 1 = stage. Phase 2 = 对话.

## Setup
1. `npm i -g pnpm@10`
2. `git submodule update --init`
3. `pnpm install`
4. `pnpm fetch-sdk`  (downloads the Live2D Cubism SDK zip: proprietary Core + sample models; ~21 MB)
5. `pnpm dev`

## Phase 2 — 对话 (brain · 对话框 · 输入)

She talks. Type Chinese in the composer, DeepSeek streams a reply, the stream is parsed into
emotion-tagged sentences and typed into the ADV dialogue band with mouth sync, and every turn is
written to a local SQLite history you can reread. The band sits over her lower third and extends
left from her body, so she stands in its right third and her face stays clear; the composer opens
on the band's own rect.

### API key

Enter it once in the key window (tray → `设置 API Key`). It is encrypted with Electron
`safeStorage` and stored at `%APPDATA%\ds\key.bin`; it is never written in plaintext. Conversations
are sent to DeepSeek, whose servers are in mainland China, and replies are AI-generated.

For development only, `DS_DEV_DEEPSEEK_KEY` is read from the environment when the app is not
packaged; it is held in memory for that run and never persisted. `DEEPSEEK_API_KEY` is reserved for
the tests and the eval harness — the app never reads it. `DS_FAKE_BRAIN=1` swaps in a scripted
client, also unpackaged-only.

### Secrets

`pnpm install` runs the `prepare` script, which sets `core.hooksPath` to the versioned `.githooks/`.
Its `pre-commit` rejects any staged addition matching `sk-[A-Za-z0-9]{20,}` and prints the offending
file, so a real DeepSeek key cannot be committed; screenshots of the key window must use an empty
field, because the hook cannot inspect PNGs.

### Eval harness

```
pnpm --filter @ds/eval run eval:dry                          # offline: fixture, lint, report plumbing
DEEPSEEK_API_KEY=... pnpm --filter @ds/eval run eval         # 46 prompts x 3 runs = 138 turns + judge pass
DEEPSEEK_API_KEY=... pnpm --filter @ds/eval run session      # 20-turn session: latency + cache hit
```

On Windows PowerShell, read the key inside the one command that needs it and never echo it:
`$env:DEEPSEEK_API_KEY = (Get-Content $HOME\.ds\deepseek.key -Raw).Trim(); pnpm --filter @ds/eval run eval`.

Reports land in the gitignored `eval/out/`.

### End-to-end

```
pnpm --filter @ds/desktop build
pnpm --filter @ds/desktop run test:e2e:electron              # launches the real app, writes evidence
```

The `20 real turns` test is skipped unless `DEEPSEEK_API_KEY` is set. The other four run offline on
`DS_FAKE_BRAIN=1` against a throwaway user-data directory, so every one of them is a genuine first
run. The Phase 1 browser harness (`pnpm --filter @ds/desktop run test:e2e`) is a separate config and
is unaffected.

## Credits
This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc. This content itself is created at the author's sole discretion.

See NOTICE for third-party licenses.

