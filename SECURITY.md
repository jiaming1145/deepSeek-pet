# Security

## Reporting

Please report anything security-related privately through
[GitHub's private vulnerability reporting](https://github.com/jiaming1145/deepSeek-pet/security/advisories/new)
rather than a public issue. The maintainer reads those first.

## What she does and does not do

- Her language-model brain runs **only in the Electron main process**. The API key is read there from
  `DEEPSEEK_API_KEY` or `~/.ds/deepseek.key` and never reaches the page that renders her.
- Without a key she is fully functional and makes **no network requests**.
- With a key, the only network traffic is to `api.deepseek.com`: her current state (needs, mood, how long
  since you touched her) and, when you use the chat box, what you typed. Nothing else on your screen is read.
- She does **not** install keyboard hooks, read keystrokes, read the clipboard, read window titles or take
  screenshots. The only system signal she uses is how long since you last touched the keyboard or mouse, from
  Electron's `powerMonitor`, so she can tell "busy" from "gone".
- Her memory is one small JSON file in Electron's user-data folder (`whalechan-memory.json`): when you first
  met, how long you have spent together, how often she was petted or thrown, and her needs at shutdown.
- A versioned pre-commit hook rejects staged lines that look like API keys, so a key cannot be committed by
  accident.

If you find a gap between this list and what the code does, that is a security report.
