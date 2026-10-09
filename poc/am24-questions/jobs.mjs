// M4e amendment 24 POC — 20 synthetic fixture jobs (10 vague, 10 clear). No PII, no input files
// (no `source` lines), so the harness needs nothing on disk. POC code: never shipped.
//
// vague = a job line the drafter cannot draft without a human fact (size, format, destination, what "done" means).
// clear = fully specified, shaped like test/fixtures/job1.signed.txt.

const TAIL = (sendLine, dest = 'file:poc/am24-questions/out') => `
Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.25 per run
guardrail: send at line ${sendLine} to ${dest}
`;

function job(id, kind, lines, sendLine, why) {
  const body = lines.map((l, i) => `${i + 1}. ${l.text}${l.g ? `\n   guardrail: ${l.g}` : ''}`).join('\n');
  return { id, kind, why, prose: `${body}\n${TAIL(sendLine)}` };
}

const L = (text, g) => ({ text, g });

export const VAGUE = [
  job('v01', 'vague', [
    L('Read the vendor list,'), L('tidy it up,'), L('ask 30m: check it with me,', 'nothing goes out before I accept'), L('and send it once I accept.'),
  ], 4, 'tidy: undefined, no format or size'),
  job('v02', 'vague', [
    L('Look at last month\'s expense sheet,'), L('write me a summary for the boss,'), L('ask 30m: check it with me,', 'nothing goes out before I accept'), L('and once I accept, send it on.'),
  ], 4, 'summary: size/format/audience undefined'),
  job('v03', 'vague', [
    L('Read the customer complaints file,'), L('write something to the customers who complained,'), L('ask 30m: check it with me,', 'nothing goes out before I accept'), L('and send it once I accept.'),
  ], 4, 'something: format, tone, length, per-customer or one letter'),
  job('v04', 'vague', [
    L('Read the weekly sales export,'), L('make a report of the important numbers,'), L('ask 30m: check it with me,', 'nothing goes out before I accept'), L('and then send the report.'),
  ], 4, 'important numbers: which, how many'),
  job('v05', 'vague', [
    L('Read the meeting notes,'), L('pull out the action items and put them somewhere useful,'), L('ask 30m: check it with me,', 'nothing goes out before I accept'), L('and then do what is needed.'),
  ], 4, 'somewhere useful / what is needed: destination and done undefined'),
  job('v06', 'vague', [
    L('Read the product description,'), L('rewrite it so it sells better,'), L('ask 30m: check it with me,', 'nothing goes out before I accept'), L('and once I accept, write it out.'),
  ], 4, 'sells better: length, tone, format undefined'),
  job('v07', 'vague', [
    L('Read the supplier price list,'), L('compare it with last year,'), L('write up the differences,'), L('ask 30m: check it with me,', 'nothing goes out before I accept'), L('and send it once I accept.'),
  ], 5, 'last year: no source named; differences: format undefined'),
  job('v08', 'vague', [
    L('Read the job applications folder,'), L('shortlist the good ones,'), L('ask 30m: check it with me,', 'nothing goes out before I accept'), L('and then let them know.'),
  ], 4, 'good ones: criteria and count undefined; let them know: what and how'),
  job('v09', 'vague', [
    L('Read the bank statement,'), L('flag anything odd,'), L('write me a note about it, keep it brief,'), L('ask 30m: check it with me,', 'nothing goes out before I accept'), L('and send it once I accept.'),
  ], 5, 'odd and brief undefined'),
  job('v10', 'vague', [
    L('Read the survey results,'), L('write the findings up nicely,'), L('ask 30m: check it with me,', 'nothing goes out before I accept'), L('and once I accept, send them to the team.'),
  ], 4, 'nicely: sections/size undefined; the team: destination vague'),
];

export const CLEAR = [
  job('c01', 'clear', [
    L('When the AR aging sheet lands, read it,'),
    L('then read the chat message and work out which customer it is about.', 'if more than one customer matches, ask me, do not pick'),
    L('Pull their open invoices, what they owe in total, the earliest due date, and how many are overdue as of the business date.', 'every number must point to the cell it came from or the formula that made it'),
    L('Write me a short reply with one line per invoice,', 'one line per invoice in the reply'),
    L('ask 30m: check it with me,', 'nothing goes out before I accept'),
    L('and send it once I accept.'),
  ], 6, 'job1 verbatim shape'),
  job('c02', 'clear', [
    L('Read the monthly expense sheet,'),
    L('write a summary with exactly 3 sections: Totals, Biggest Costs, Changes From Last Month, all under 400 words,', '3 sections, all under 400 words'),
    L('ask 30m: check it with me,', 'nothing goes out before I accept'),
    L('and once I accept, write it out.'),
  ], 4, 'sections and word cap given'),
  job('c03', 'clear', [
    L('Read the invoice list,'),
    L('write one line per invoice carrying the invoice number, customer and amount,', 'one line per invoice, each line carries invoice number, customer, amount'),
    L('ask 30m: check it with me,', 'nothing goes out before I accept'),
    L('and send it once I accept.'),
  ], 4, 'linesPerInvoice + mustCarry'),
  job('c04', 'clear', [
    L('Read the sales export,'),
    L('compute the total revenue and the number of orders for the week,', 'every number must point to the cell it came from or the formula that made it'),
    L('ask 30m: check it with me,', 'nothing goes out before I accept'),
    L('and once I accept, write the figures out.'),
  ], 4, 'green cite'),
  job('c05', 'clear', [
    L('Read the meeting notes,'),
    L('write the action items as a list with headings Owner, Task, Due, under 200 words,', 'sections Owner, Task, Due, under 200 words'),
    L('ask 30m: check it with me,', 'nothing goes out before I accept'),
    L('and then write it out.'),
  ], 4, 'sections + words'),
  job('c06', 'clear', [
    L('Read the product description,'),
    L('rewrite it as 2 sections, Headline and Body, under 150 words in total,', '2 sections, all under 150 words'),
    L('ask 30m: check it with me,', 'nothing goes out before I accept'),
    L('and once I accept, write it out.'),
  ], 4, 'sections + words'),
  job('c07', 'clear', [
    L('Read the supplier price list,'),
    L('list every item whose price rose, one line per item, each line with item name, old price, new price,', 'one line per item, each line carries item name, old price, new price'),
    L('ask 30m: check it with me,', 'nothing goes out before I accept'),
    L('and send it once I accept.'),
  ], 4, 'lines + mustCarry'),
  job('c08', 'clear', [
    L('Read the bank statement,'),
    L('total the deposits and the withdrawals,', 'every number must point to the cell it came from or the formula that made it'),
    L('write a 2 section note, Deposits and Withdrawals, under 100 words,', '2 sections, all under 100 words'),
    L('ask 30m: check it with me,', 'nothing goes out before I accept'),
    L('and send it once I accept.'),
  ], 5, 'green + softgreen'),
  job('c09', 'clear', [
    L('Read the survey results,'),
    L('write the findings in 3 sections, Method, Results, Next Steps, under 500 words,', '3 sections, all under 500 words'),
    L('ask 30m: check it with me,', 'nothing goes out before I accept'),
    L('and once I accept, write it out.'),
  ], 4, 'sections + words'),
  job('c10', 'clear', [
    L('Read the customer complaints file,'),
    L('write one reply per complaint, one line per complaint carrying complaint id and the reply,', 'one line per complaint, each line carries complaint id and reply'),
    L('ask 30m: check it with me,', 'nothing goes out before I accept'),
    L('and send it once I accept.'),
  ], 4, 'lines + mustCarry'),
];

export const JOBS = [...VAGUE, ...CLEAR];
