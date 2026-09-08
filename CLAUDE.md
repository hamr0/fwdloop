# fwdloop

**"Automate this job — it has humans in it."** Describe a flow as steps + guardrails; an agent
builds it; dry-run, accept once, rerun on a trigger under caps the flow cannot touch. Every
step has an effect check. Humans verify; the machine makes sure it happened.

Ground truth: `docs/product/PRD.md` (DRAFT until hamr signs it). Follow
`.claude/remember/AGENT_RULES.md` (our agent rules, tracked in this repo) and
`~/PycharmProjects/hamr0/LIBRARY_CONVENTIONS.md`.

## Standing dev rule — borrow, never import

Before building anything, check whether the problem is already solved, in this order:

1. **bareloop** (`../bareloop`): `docs/wiki/`, `docs/logs/FINDINGS.md` (F1–F137), `docs/product/`.
   Copy the code you need into this tree with a header `// borrowed-from: bareloop <path>@<commit>`
   and adjust it to fwdloop's shape. Never `import` from bareloop. Complete separation.
2. **litectx** context engineering: `~/Documents/PycharmProjects/litectx/docs/02-engineering/build-studies.md`.
3. **multis** (`../multis`) for memory shape (it runs litectx; its own store was deleted — learn why).
4. The bare suite is a dependency, not a borrow: bareagent, bareguard, litectx first; barebrowse,
   baremobile, beeperbox, mailproof as optional peers unlocked by a signed skill.

## Hard lines (inherited from bareloop, verbatim in spirit)

- The agent authors steps; it never authors the trigger, the cap, an ask's position, an ask's
  TTL, the egress allow-list, or what "done" means. Those are signed by a human, tighten-only.
- Nothing leaves the machine without a signed destination and a human accept in the same run.
- Secrets load from the environment; never the tree, never the spine, never the audit.
- Unknown cost is never rendered as 0. A pause spends nothing.
- POC first; one module at a time; the test must be able to fail; never fit to pass.
- Code goes on a branch; `main` is PR-protected. Review, then release, per branch.

## Dev Rules

**Spec first.** Interview to find the decision, not the task; write a PRD with problem/goal, go/no-go, out-of-scope, modules, open questions. POCs refine it.

**POC first, one module at a time.** Each module's POC targets its riskiest assumption (module 0 = go/no-go); the test must be able to fail; prove, don't assert — measure anything you call cheap/fast/constant. No fitting to pass. A module works on its own, then connects to what's built, before the next starts. Never ship the POC.

**Dependency hierarchy — follow strictly:** vanilla language → standard library → external (only when stdlib can't do it in <100 lines). External deps must be maintained, lightweight, and widely adopted. Exception: always use vetted libraries for security-critical code (crypto, auth, sanitization).

**Lightweight over complex.** Fewer moving parts, fewer deps, less config. Express over NestJS, Flask over Django, unless the project genuinely needs the framework. Simple > clever. Readable > elegant.

**Open-source only.** No vendor lock-in. Every line of code earns its place — if you can't say what breaks when it's deleted, delete it. No speculative code, no premature abstractions.

**One writer per piece of state.** One function assigns each field; everything else calls it. Grep who writes it before you write it — and if a write can land from a callback, thread, or lifecycle, the reader must tell stale from fresh.

**Surgical changes only.** Touch what the task requires. Dead code, nits, bugs you pass: if it's inside or affects the code you're already changing and the fix changes no behavior, fix it and say so — otherwise report it and say what it costs to leave it. A problem you don't fix goes in the report, never in a comment.

**Responsive web UI is mandatory.** Any web UI must work on mobile by default — fluid layouts, viewport meta, breakpoints, no horizontal scroll. Verify in DevTools device emulation before claiming a UI task is done. POCs exempt; real projects are not.

For full development and testing standards, see `.claude/remember/AGENT_RULES.md`.

<!-- DOCS_INDEX:START -->
Docs map: `docs/index.md` — every doc in this project, with line counts.
Search this corpus instead of reading it whole: `/docs-builder search <query words>`
<!-- DOCS_INDEX:END -->
