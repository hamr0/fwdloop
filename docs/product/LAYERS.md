# fwdloop — the layer map (plain language)

> The PRD is the contract; this is the map. One page that states the idea, the flow a person
> experiences, the three ways a step can be proven done, and the rules the machine may never
> touch — in the product's own words. **No package names in the body**; implementation names
> live in the PRD.
>
> The kid/mom framing is borrowed from bareloop `docs/product/LAYERS.md:543`, read 2026-09-10,
> because it made the thing understandable. The cast is re-mapped: fwdloop has no repo and no
> command exit, so what counts as "mom looking" is different here.
>
> Written 2026-09-10. Marks what is BUILT and what is PLANNED, and says which.

---

## The idea in one paragraph

You describe a job you already do by hand — in your own words, in the order you actually do it.
Beside each line you write **how you would know that line was done right**, or you leave it blank.
A drafter turns your description into steps and shows you a table. Nothing happens until you sign
it. After that it runs on a trigger, under a budget it cannot raise, and **every step has to prove
it happened**. Where you left a line blank, it stops and asks you. The machine never decides that
your work is finished — it makes sure that what you said would happen, happened.

---

## The flow

```
YOU: describe the job, numbered lines, in your own words
     beside each line: how you'd know it was done — or nothing
        │
        ▼
SCOUT looks at the real files. Read-only, and read-only BY CONSTRUCTION —
the verbs that could change something are not in its list at all
        │
        ▼
DRAFTER writes steps. It never gets a tool. It cuts one of your lines into
as many steps as it needs, and each step says WHICH OF YOUR LINES it serves
        │
        ▼
THE TABLE: your lines with the steps serving them, and the steps with the
line each one serves. You change things in plain words. Redraft. Repeat.
        │
        ▼
YOU SIGN. That signature IS the agreement. One hash over the whole thing.
        │
        ▼
IT RUNS on a trigger, under a cap, and stops at every line you left blank.
```

---

## The cast

| who | what they do | what they may never do |
|---|---|---|
| **you** | say what the job is; say how each line is proven done; sign | — |
| **the scout** | look at the real files before anyone plans | touch anything — the changing verbs are absent from its list |
| **the drafter** | cut your lines into steps | pick up a tool; choose which of your rules applies to a step; write a trigger, a cap, a budget, or where you get asked |
| **the step worker** | do one step with the tools it was granted | see its own check; see the cap |
| **the close** | decide whether a step is proven done | be written by the machine |

---

## Three ways a step is proven done, and one that always applies

**Always, every step, no exceptions:** *something came out, and it was not empty.* Not nothing, not
zero bytes. This is the only rule that is allowed to be universal, and the reason is worth stating:
**it asks a yes/no question about bytes, not a question about meaning.** A rule that reads meaning
has to decide where it applies, and "mostly applies" is a hole — that is exactly how a live drafter
talked its way into calling an unchecked step *green* (F16). This one has nowhere to bend.

On top of that, one of three:

| | what it means | who does the judging | costs |
|---|---|---|---|
| **green** | every figure points at where it came from, and the sums are recomputed | nobody — arithmetic | $0 |
| **softgreen** | the answer has the SHAPE YOU DESCRIBED, checked mechanically | nobody — a shape you wrote | $0 |
| **hitl** | you look | you | $0 to pause |

**No model ever judges anything.** There is no scoring, no rubric, no second opinion. If a step
fits none of these, it becomes **your** job — never "probably fine".

---

## One line, one rule

Your job is a numbered list. Rule *n* belongs to line *n* and to nothing else.

```
1. read the sheet when it lands
2. work out which customer it's about
   → if more than one matches, ask me, do not pick
3. pull their invoices, total, earliest due date
   → every number must point to the cell it came from
4. write me a reply
   → one line per invoice
5. check it with me
   → nothing goes out before I accept
6. send it
```

A step says **which line it serves**. It does not pick a rule. The rule at that number is whatever
you wrote there, and if you wrote nothing, **you check it**.

This is not tidiness. When steps were allowed to *point* at any rule, a real drafter pointed at the
broadest one to justify calling an unchecked step green — three runs out of three. Taking away the
pointing took away the move (F17).

**Repeating a rule on several lines is correct.** An earlier design let you write a rule once and
mark it "applies to everything". It was dropped for the reason hamr gave: *a rule stops being
generic once it doesn't apply to all* — and the citation rule genuinely does not apply to reading a
file, asking a person, or sending a message. Explicit and repeated beats clever and mostly-true.

**Some rules belong to no line at all** — the budget, the trigger, where the machine may send
things, how long an ask waits. Those are yours, signed, and can only ever be made tighter. No step
can claim one.

---

## What the machine may never author

The steps are the drafter's. **These are yours, always:** the trigger · the cap · where you get
asked · how long an ask waits · where anything may be sent · which skills are unlocked · what
"done" means.

And: **nothing leaves this machine** without a signed destination and your acceptance in the same
run. Secrets come from the environment — never the files, never the record.

---

## The kid version (start here whenever the map stops making sense)

A kid builds a LEGO castle. You pay for the bricks and decide if it goes on the shelf.

- **The toy box** — before anyone plans, someone opens the box and *looks*: which bricks are
  actually in there, what colour, how many. They only look. They cannot take anything out, because
  the taking-out verbs aren't in their vocabulary.
- **The plan** — a helper writes down the steps. It never touches a brick. It reads *your* list of
  what you want and turns each line into as many steps as that line needs.
- **Your list** — beside each thing you asked for, you write how you'd know it was done. *"One
  line per invoice."* If you write nothing beside a line, **you'll be inspecting that one
  yourself**, and the table tells you so before you agree to anything.
- **The build** — the kid does one step at a time. It is handed a goal and some bricks. **It is
  never shown the ruler it will be measured with**, and never shown how much money is left. A kid
  who can see the ruler builds for the ruler.
- **The shelf** — nothing goes on the shelf, and nothing leaves the house, until you say so.

**Why the kid can't see the ruler.** If the kid knows the tower gets measured at exactly 10cm, it
builds a 10cm tower and nothing else. It would pass and the castle would still be wrong. So the kid
hears *"the tower is crooked"* and never *"the third brick from the left is 2mm off"*.

**Why "it looks fine" is never an answer.** Nobody in this story is allowed to squint at the castle
and say it seems okay. Either something measurable was measured, or the shape you described was
checked, or **you looked**. There is no fourth option, and "probably fine" is not one of them.

---

## The layers

| | what it adds | state |
|---|---|---|
| **Layer 0 — the close** | a step can prove it happened, with no repo to measure against | POC built; not closed |
| **Layer 1 — the description** | you describe the job in your words and never name a tool | POC built; holds on two providers |
| **Layer 2 — the signature** | one hash over the whole thing; any edit means agreeing again | planned |
| **Layer 3 — the run** | steps run one at a time, each with fresh context, joined only by what the last one produced | planned |
| **Layer 4 — the ask** | the machine stops where you said, and waits, and spends nothing while waiting | planned |
| **Layer 5 — the screen** | all of it in a browser; someone who has never opened a terminal can do the whole thing | planned — **the crux** |
| **Layer 6 and on** | skills, a library of jobs that worked, triggers, real sending | planned |

**There is no wiring layer, deliberately.** Steps are not plugged into each other. A step produces
one labelled thing, and the next step asks for it by name. Nobody draws the pipes.

---

## The one sentence

**Humans verify; the machine makes sure it happened.**
