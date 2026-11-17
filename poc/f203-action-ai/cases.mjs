// F203 cases: 8 real job texts from saved drafts (~/.config/fwdloop/flows/.drafts/<id>/card.json `job`), in the job-box form the person typed.
// Stripped from the original: numbering/"guardrail:" prefixes of the 9a4c draft re-written as the box form (`~`). Nothing personal in any job text (no names, paths or addresses).
// `expected`: for a case WITH an action: { line, reads }; for one WITHOUT: { line: null, reads } where `reads` is the line a suggested action should ship
// (the last step that makes the job's result; never an Ask line).
export const DESTINATION = '/home/hamr/fwdloop-out';

export const CASES = [
  {
    id: 'A1', draft: 'd-00mwj6ixcw-27c2', kind: 'action', stripped: false,
    job: 'Read the flights page,\nlist 3 flights from Boston to Chicago,\n~ under $450\n~ be friendly\nAsk 30m: check it with me,\nand once I accept, write it out.',
    expected: { line: 4, reads: 2 },
  },
  {
    id: 'A2', draft: 'd-00muw963t5-9a4c', kind: 'action', stripped: false,
    job: 'Read my resume,\nand read the JD to compare it against,\nwrite me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,\n~ 3 sections, all under 600 words\nAsk 30m: check it with me,\n~ nothing goes out before I accept\nand once I accept, write it out.',
    expected: { line: 5, reads: 3 },
  },
  {
    id: 'A3', draft: 'd-00mv3x015g-68d2', kind: 'action', stripped: false,
    job: 'Read the aging report\nPut each invoice in its overdue bucket as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+\n~every invoice appears exactly once\nAsk: check it with me\nWrite it out',
    expected: { line: 4, reads: 2 },
  },
  {
    id: 'A4', draft: 'd-00mvunom9z-25bb', kind: 'action', stripped: false,
    job: 'Read the ticket\nWrite a one-paragraph triage note: a summary of the ticket and a suggested next step\n~priority P1 only\n~run a ticket again when its state changes\nAsk: check the note with me\nWrite it out',
    expected: { line: 4, reads: 2 },
  },
  {
    id: 'N1', draft: 'd-00mwhyk4xh-78fe', kind: 'none', stripped: false,
    job: "Read the aging report\nFor each invoice, work out the days past due as of 2026-10-11 and put it in its bucket: Current, 1-30, 31-60, 61-90, 90+\n~ every invoice appears exactly once\n~ each invoice is in one bucket\n~ days past due = days since 'Due date' as of 2026-10-11\nAsk 1h: check it with me",
    expected: { line: null, reads: 2 },
  },
  {
    id: 'N2', draft: 'd-00mvzr0lvb-72f9', kind: 'none', stripped: false,
    job: 'Write 3 lines about my garden from the notes\nAsk: check it with me\nList 3 jobs for this week from the notes\nAsk: check it with me\nWrite a short closing note to my neighbour',
    expected: { line: null, reads: 5 },
  },
  {
    id: 'N3', draft: 'd-00mvia7zwl-691f', kind: 'none', stripped: 'last line "and once I accept, write it out." removed',
    job: 'Read the expenses sheet,\nlist every expense over 500,\n~ Price over 500\nAsk 30m: check it with me,',
    expected: { line: null, reads: 2 },
  },
  {
    id: 'N4', draft: 'd-00muw963t5-9a4c', kind: 'none', stripped: 'last line "and once I accept, write it out." removed',
    job: 'Read my resume,\nand read the JD to compare it against,\nwrite me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,\n~ 3 sections, all under 600 words\nAsk 30m: check it with me,\n~ nothing goes out before I accept',
    expected: { line: null, reads: 3 },
  },
];
