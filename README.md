```
                    ╭──────────────────────────────────────╮
                    │  ╔═╗╦ ╦╔╦╗╦  ╔═╗╔═╗╔═╗               │
                    │  ╠╣ ║║║ ║║║  ║ ║║ ║╠═╝               │
                    │  ╚  ╚╩╝═╩╝╩═╝╚═╝╚═╝╩                 │
                    │   describe ──→ build ──→ run         │
                    │       ↑          │                   │
                    │       └── human ─┘                   │
                    ╰──╮───────────────────────────────────╯
                       ╰── workflows with people in the loop
```

<p align="center">
  <img src="https://img.shields.io/github/package-json/v/hamr0/fwdloop?label=version&color=2a4f8c" alt="version (auto from package.json)">
  <img src="https://img.shields.io/badge/license-Apache%202.0-2a4f8c" alt="license: Apache 2.0">
  <img src="https://img.shields.io/badge/status-WIP-orange" alt="status: WIP">
</p>

**"Automate this job — it has humans in it."** [WIP]

fwdloop builds workflows that automate jobs with a human in the loop. You describe the job
as plain steps and a few guardrails: what to gather, what to work out, where to stop and
check with a person, what to send when they say yes. An agent builds the workflow from that
description. You dry-run it, accept it once, and then it runs on its trigger, pausing where
you said, checking that every step actually happened, and staying under budgets it cannot
change.

It is built mainly for that shape of work: gather, decide, pause, hand off, continue. Not a
general agent. Not a chat bot. A workflow that a person can read, approve, rerun, and edit.

## Where it comes from

fwdloop carries forward what the bare suite learned about agentic automation: how to author
a workflow rather than hand-write it, how to gate every action, how to keep a person as the
last word, and how to make cost and outcome honest. It borrows those solved problems and
primitives directly, as a sibling of the suite, and adds the part that was missing: the
pauses, the checks, and the people.

## The bare ecosystem

Local-first, composable agent infrastructure. Same patterns throughout, each module works
standalone.

**Core** — the brain, the gate, the memory.

- **[bareagent](https://npmjs.com/package/bare-agent)** — the think→act→observe loop. *Goal in → coordinated actions out.*
- **[bareguard](https://npmjs.com/package/bareguard)** — the single gate every action passes through. *Action in → allow / deny / ask-a-human out.*
- **[litectx](https://npmjs.com/package/litectx)** — memory and context engineering (write · select · compress · isolate). *Query in → ranked context out.*

**Optional reach** — give the agent hands.

- **[barebrowse](https://npmjs.com/package/barebrowse)** — a real browser for agents.
- **[baremobile](https://npmjs.com/package/baremobile)** — Android + iOS device control.
- **[beeperbox](https://github.com/hamr0/beeperbox)** — 50+ messaging networks via one MCP server.

**Siblings** — workflows on top of the rails.

- **[bareloop](https://github.com/hamr0/bareloop)** — workflows that earn their own design, for repeated, verifiable jobs. Closed loop.
- **fwdloop** — workflows with people in them. Open loop.

## Status

Work in progress. Nothing here is ready to install yet.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
