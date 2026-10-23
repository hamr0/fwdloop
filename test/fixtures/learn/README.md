Real archived runs for the learnings (cross-run lessons) tests. Nothing here is authored.

- `<runid>.jsonl`  the run's own spine, cut to the record types `buildCards` reads (job-start, plan-accepted, step-start/end,
  iteration-start, fix-loop, attempt-diff, check-run, exit-eval, close-verdict, outer-close, escalation, job-end, leg-resume,
  review-door). Every kept record is byte-for-byte the archived one; the worker-round / tool noise is left out.
- `<runid>-audit.jsonl`  the run's gate audit, cut to `phase: gate`, `decision: allow`, write/edit rows (the rows a card reads).
- `manifest.json`  run id -> workflow key and the patient path the audit's absolute paths sit under.
- `mvk2e4uy-spec.json`  that run's resolved signed spec (its close declaration names the checks).

Runs: mvk2e4uy (deepseek-flash, green, a typecheck red fixed on the 2nd try and a no-suppressions red fixed in the fix loop;
the only one with attempt-diff), mvh72jo0 (a rubric job: its writes are `output/steps/1.json`), mshcpdg4 (a typecheck red
never fixed), battery-A3-mrnepkvq (provider-red), l2poc-B3-mrugee8z (no close spoke), ms2c0ls7 / ms7flkok / mszi97jd /
ms2ddxjc / mszcfaof (one job, the same lesson across runs), mv3sconb / mv1j01sl / mties136 / mv2i30bf (a generic
`tree-changed` red in four different jobs).
