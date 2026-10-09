// M4e amendment 28 POC — 10 synthetic jobs, each with ONE guardrail of mixed numbers and a known right answer.
// No PII, no input files. POC code: never shipped.
//   maxWords        = the guardrail's ceiling for the whole output
//   wordsPerSection = the guardrail's size for each section (null = the guardrail gives none; the model must leave it out)

const TAIL = `
Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/am28-word-limit/out
`;

function job(id, task, guardrail, maxWords, wordsPerSection, trap) {
  const prose = `1. Read the source notes,\n2. ${task},\n   guardrail: ${guardrail}\n3. ask 30m: check it with me,\n   guardrail: nothing goes out before I accept\n4. and send it once I accept.\n${TAIL}`;
  return { id, guardrailLine: 2, guardrail, expect: { maxWords, wordsPerSection }, trap, prose };
}

export const JOBS = [
  job('w01', 'write the summary', 'under 600 words, each heading at most 3 words', 600, null, 'heading limit after the ceiling'),
  job('w02', 'write the summary', 'each heading at most 3 words, under 600 words', 600, null, 'heading limit BEFORE the ceiling'),
  job('w03', 'write the briefing in 3 sections', '3 sections, about 150 words each, under 600 words', 600, 150, 'size per section vs whole ceiling'),
  job('w04', 'write the review', 'under 400 words, quote at most 2 lines of 20 words', 400, null, 'quote limit is a word count too'),
  job('w05', 'write the article', 'a 5-word title, body under 300 words', 300, null, 'title length'),
  job('w06', 'write the update', 'under 1,000 words, bullets of at most 12 words', 1000, null, 'comma in the number; bullet limit'),
  job('w07', 'write the plan in 4 sections', 'no more than 250 words, 4 sections, at most 50 words per section', 250, 50, 'per-section stated after the count'),
  job('w08', 'write the note in 3 sections', '3 sections, 120 words each, 400 words in total', 400, 120, '"in total" ceiling after a per-section size'),
  job('w09', 'write the report', 'the report is 800 words at most; each paragraph 5 sentences max; headings Intro, Body, Close', 800, null, 'number words and sentence counts'),
  job('w10', 'write the memo', 'keep it to 2 pages, under 500 words, sign off with a 10-word line', 500, null, 'pages and a sign-off line'),
];
