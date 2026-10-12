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

**"Automate this job — it has humans in it."**

There is no perfect workflow. The best one does the job by the shortest path, says plainly when it couldn't, and stops at the right places for a person to look.

fwdloop builds that workflow for you. Write the job in plain language, as steps. Under each step, say what counts as done and what it must never do, and where it must stop and ask you. The agent works out the steps and the tools; every step is checked before the next one starts, and the run pauses wherever you said a person decides.

The harness (budget, time, what it may touch, where results may go) and the checks sit outside the agent loop. The agent can't judge itself or change its own limits. Every run is recorded, so you can see exactly what happened, step by step, and what it cost.

## Three kinds of steps

**Machine-checked:** code decides. The file exists, the numbers add up, every row is there.
> "Total each customer's open invoices." · "Bucket these invoices by age."

**Shape-checked:** a shape you declared decides. Three sections, each under 200 words, every heading present. No second AI grades the first.
> "Summarize my resume against this job ad, three sections."

**You check:** a person decides. The run stops, shows you the work, and waits. Accept and it continues; push back and it redoes the step with your note.
> "Check it with me before anything goes out."

## Runs on its own, stops for you

Accept a job once, then let it run again on a trigger: by hand, on a schedule, when a file is updated, or when a new file arrives in a folder *(triggers: planned)*. Every run stays under the money cap you signed, and a month that can't pay for a whole run doesn't start one. When it reaches a step you check, it waits in the panel for you.

## What it won't do

fwdloop never sends anything out unless you named the destination and said yes in the same run. When a job needs no person at any point, that's [bareloop](https://github.com/hamr0/bareloop)'s job.

Small tools, all local. Built on the bare suite (bareagent, bareguard, litectx), always LLM-agnostic, always on your machine, with a simple panel UI.

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

Work in progress. Published on npm as `fwdloop`; the API has no stability promise yet.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
