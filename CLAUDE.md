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

<!-- DEV_RULES:START -->
## Dev Rules

**Spec first.** Interview for the decision, not the task. Ask in batched rounds — only questions whose prerequisites are settled, each with your recommended answer; look up facts yourself, ask me only the choices that are mine. Pin module 0, ask what is out of scope, write a PRD (problem, go/no-go, out of scope, modules, open questions). One round is not an interview; never build on an assumed prerequisite.

**Reuse before you add.** Before adding a function, class, file, or dependency, search for the one that already does it, and report what you reused. A near-duplicate needs a stated reason the original couldn't be extended. One thing, one name, repo-wide.

**Don't patch a patch.** A third fix on the same spot means the design is wrong — stop and propose the redesign. A new layer must hide more than its interface costs; otherwise inline it.

**POC first, one module at a time.** Aim each POC at its riskiest assumption (module 0 = go/no-go); the test must be able to fail. Prove, don't assert — measure anything you call cheap or fast. No fitting to pass. Gates (/self-review, /branch-review, /release) run the full suite; coding runs targeted tests only — a gate skips the run and cites the last proof when only docs changed since. A module works alone, then connects to what's built, before the next starts. Never ship the POC.

**No dependencies by default.** Start with the language itself, then its standard library. Add an outside package only when the standard library can't do it in under 100 lines, and say why. Outside packages must be maintained, lightweight, widely used and open-source — no vendor lock-in. Security code (crypto, auth, sanitizing) always uses a vetted library.

**Simple > clever.** Fewer moving parts, fewer deps, less config; readable by a junior beats elegant. Call out overcomplication before building. Express over NestJS, Flask over Django, unless the project needs the framework.

**Every line earns its place.** If you can't say what breaks when it's deleted, delete it. No speculative code, no abstraction for one use case.

**One writer per piece of state.** One function assigns each field; everything else calls it. Grep who writes it before you write it — and if a write can land from a callback, thread, or lifecycle, the reader must tell stale from fresh.

**Surgical changes only.** Touch what the task requires; match existing style. Dead code, nits, bugs you pass: if it's inside or affects the code you're already changing and the fix changes no behavior, fix it and say so — otherwise report it and say what it costs to leave it. A problem you don't fix goes in the report, never in a comment.

**Responsive web UI is mandatory.** Any web UI must work on mobile by default — fluid layouts, viewport meta, breakpoints, no horizontal scroll. Verify in DevTools device emulation before claiming a UI task is done. POCs exempt; real projects are not.
<!-- DEV_RULES:END -->

<!-- DOCS_INDEX:START -->
Docs map: `docs/index.md` — every doc in this project, with line counts.
Search this corpus instead of reading it whole: `/docs-builder search <query words>`
<!-- DOCS_INDEX:END -->

<!-- MEMORY:START -->
@.claude/remember/MEMORY.md
<!-- MEMORY:END -->

<!-- AGENT_RULES:START -->
Standards guide (read when designing/building something new, not hot context):
.claude/remember/AGENT_RULES.md
<!-- AGENT_RULES:END -->
