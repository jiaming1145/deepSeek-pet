# Phase 2 â€” resource samples (whole Electron process tree)

Bar (addendum section 0): <= 4 % CPU and <= 250 MB at 30 Hz idle; <= 0.5 % CPU while hidden.
CPU is the summed TotalProcessorTime delta / window / logical cores, so 100 % means one full core.

| label | processes | window (s) | CPU % | working set (MB) |
|---|---|---|---|---|
| idle | 7 | 10 | 1.27 | 750.3 |
| speaking | 7 | 5 | 3.36 | 742.2 |
