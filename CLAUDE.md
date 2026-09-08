# fwdloop

**"Automate this job — it has humans in it."** Describe a flow as steps + guardrails; an agent
builds it; dry-run, accept once, rerun on a trigger under caps the flow cannot touch. Every
step has an effect check. Humans verify; the machine makes sure it happened.

Ground truth: `docs/product/PRD.md` (DRAFT until hamr signs it). Follow
`~/PycharmProjects/hamr0/AGENT_RULES.md` and `LIBRARY_CONVENTIONS.md`.

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
