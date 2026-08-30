# State machine

Allowed production transitions:

```text
created
  -> brief_approved
  -> canonical_approved
  -> part_plan_approved
  -> parts_approved
  -> psd_validated
  -> cubism_ready
```

Each transition requires:

- all artifacts declared for the stage;
- current artifact hashes;
- a passing machine report;
- manual approval where the stage includes visual judgment;
- no unresolved critical issue.

`blocked` is an overlay state, not a bypass. Record a blocker code, message, evidence paths, and the stage to resume.

Never move backward by mutating accepted artifacts. Create a new revision and invalidate only dependent later stages.
