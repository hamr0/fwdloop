// M4e amendment 2: the job as it is TYPED in the card's job box, and the job file it must become (the fixture's own first 7 lines).
export const BOX_JOB = [
  'Read my resume,',
  'and read the JD to compare it against,',
  'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,',
  '~3 sections, all under 600 words',
  'Ask 30m: check it with me,',
  '~nothing goes out before I accept',
  'and once I accept, write it out.',
].join('\n');

/** The job file `fwdloop draft` reads for BOX_JOB with an ask wait that is never used (the only ask sets its own). */
export const BOX_JOB_FILE = [
  '1. Read my resume,',
  '2. and read the JD to compare it against,',
  '3. write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,',
  '   guardrail: 3 sections, all under 600 words',
  '4. ask 30m: check it with me,',
  '   guardrail: nothing goes out before I accept',
  '5. and once I accept, write it out.',
].join('\n');

/** `name: path` lines for the inputs box. @param {[string, string][]} pairs */
export const inputsText = (pairs) => pairs.map(([n, p]) => `${n}: ${p}`).join('\n');
