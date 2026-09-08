# What FDE automations actually look like in the field — and job #1 derived from a real one

**Status: research note, 2026-09-08, on hamr's ask ("check for real what FDE automation use
cases are and derive a real case, simplified that we can use"). Sources are vendor and
industry write-ups, read the same day; numbers quoted are theirs, unverified. The derived case
at the end is a proposal for PRD §3.8 job #1, not a ruling.**

## 1. Where the field says the value is

Three sources agree on the same short list, in the same order:

- **Finance back office** — invoice processing, reconciliation, cash application, collections.
  Named as a "proven ROI leader" alongside support-ticket deflection and code agents
  ([fde.academy](https://fde.academy/blog/which-ai-use-cases-are-best-suited-for-forward-deployed-engineers)).
- **Daily digests to a human** — a scheduled scan of two boards/sheets, discrepancies listed,
  summary mailed or Slacked to the finance lead; "replaces manual daily report creation"
  ([monday.com, workflow 2](https://monday.com/blog/ai-agents/how-finance-teams-use-monday-ai-agents/)).
- **Match-then-approve** — payments matched to invoices by amount / reference / customer
  name; anything unmatched goes to a specialist; the rest posts automatically
  ([monday.com, workflow 1](https://monday.com/blog/ai-agents/how-finance-teams-use-monday-ai-agents/);
  [HighRadius, use case 2](https://www.highradius.com/resources/Blog/ai-in-accounts-receivable/)).

The human gate in every one of these sits at the same place: **after the numbers are worked
out, before anything is sent or posted.** Routine monitoring runs alone; money-touching and
customer-facing steps wait for a person. That is exactly PRD §10's egress rule, observed in
the wild.

Two structural facts worth keeping:

- 88% of enterprise agents reportedly never reach production, failing on "operational
  blockers" rather than model quality ([fde.academy](https://fde.academy/blog/which-ai-use-cases-are-best-suited-for-forward-deployed-engineers)).
  fwdloop's audit trail, caps, and effect checks are aimed at that class, not at the model.
- The recommended starting mode for any AI-written customer communication is "suggest mode":
  every draft approved by a human before it goes out
  ([Kolleno](https://www.kolleno.com/ai-agents-for-accounts-receivable-feature-checklist-for-finance-teams-in-2026/)).
  That is fwdloop's `ask` before `send`, by another name.

## 2. The real case closest to hamr's description: cash application / balance enquiry

HighRadius's "cash application" is: remittance details arrive by **email** (unstructured),
get matched against **open invoices in the AR ledger**, matched items post, exceptions go to a
person. hamr's job #1 ("check inbox for mail from @domain, match the name in this sheet,
summarise name / balance / owed / due, hand it to me, wait for approve, then send") is the same
shape with the direction flipped: the customer writes in, the flow answers.

## 3. Job #1, derived and simplified for M0

**Everyday artifacts, as hamr ruled: what is given is what the agent works with.** Two files,
both real-shaped, both authored by hamr (never by the session that will check them):

| artifact | shape | why this shape |
|---|---|---|
| `ar-aging.xlsx` | one sheet: `Customer`, `Invoice`, `Issued`, `Due`, `Amount`, `Paid`, `Balance` — ~20 rows, 4–6 customers, some paid, some overdue | the standard AR aging report; every bookkeeper has one |
| `enquiry.eml` | one customer email: "Hi, can you tell me what we still owe and when it's due? — Dana, Acme Ltd" | the unstructured half; name must be matched to the sheet |

**Steps, in the human's verbs** (what hamr would type; the drafter turns these into the kind menu):

1. Read the aging sheet.
2. Read the customer's email and work out which customer it is.
3. List their open invoices; total what they owe; find the earliest due date; count how many
   are overdue as of today.
4. Write a short reply with those numbers, one line per invoice.
5. Check with me.
6. On accept, send it.

**Where the numbers come from (this is the citation part):** step 3 has **copied** figures
(each invoice's balance and due date — from a cell) and **derived** figures (the total: a sum
over cited cells; days overdue: today minus a cited date; the count: how many cited rows).
Step 4 restates all of them in prose.

**The M0 plant, hardest first:** the model's output for step 3 is altered so the **total** is
wrong while every invoice line is right and correctly cited. A copied-number plant only tests
that the resolver can open a cell; the derived plant tests whether a wrong sum with perfect
citations can slip through. The close must go red and name the figure ("total owed 1,850 ≠
sum of B4,B7,B9 = 1,750"). A second run with no plant must go green. A third variant plants a
wrong copied number (one invoice balance) and must go red naming the cell.

**What this case needs that the PRD does not yet have:** an xlsx reader (a `.xlsx` is a zip of
XML — not stdlib in Node; this is the first real dependency question under §9b), a citation
form for cells and for a mail's sender line, and a formula grammar for sum / count / date
difference. All three go into the M0 pre-registration.

**What it deliberately leaves out:** no inbox polling (the `.eml` is a file), no live send
(dry-run writes the reply to a file), no memory step, one customer per run.

Sources: [fde.academy](https://fde.academy/blog/which-ai-use-cases-are-best-suited-for-forward-deployed-engineers),
[monday.com finance workflows](https://monday.com/blog/ai-agents/how-finance-teams-use-monday-ai-agents/),
[HighRadius AR use cases](https://www.highradius.com/resources/Blog/ai-in-accounts-receivable/),
[Kolleno AR agent checklist](https://www.kolleno.com/ai-agents-for-accounts-receivable-feature-checklist-for-finance-teams-in-2026/),
[Rocketlane FDE guide](https://www.rocketlane.com/blogs/forward-deployed-engineer).
