// M20 am3b item 2 (loop map): the plain reasons code gives, moved verbatim out of src/checkblock.js so the words that quote them (src/pagedropwords.js) need not import the block.

/** the plain reasons code gives, in one place (the card, the Job tab and the Audit read them from the row) */
export const REASON = Object.freeze({
  left: 'You chose to leave it Not checked, so you judge it at Accept.',
  nothingOnPage: 'Your own words are on the line; the machine has no check for them, so you judge it at Accept.',
  noRule: 'No rule can check this, so you judge it at Accept.',
  waitingPick: 'waiting for your answer on the proposed check',
  waitingReading: 'waiting for your answer on the reading',
  onePerLine: 'this line finds facts, so it has no text to quote',
  manyInputs: 'the job has more than one input and code cannot pick which one the claims quote',
  oneSidedTime: 'a time limit the AI proposes must be a range, so you judge it at Accept.',
  countNeedsFact: 'a result count needs a fact to count; this line has none',
  countNeedsSuggested: 'a result count needs a fact to count; add the suggested fact on this line to count its results',
  lookNoWords: "the page does not hold the words of the look's fact for this rule",
  afterLast: 'no more tries: Start over (rows are never changed by the AI after the last try)',
  noPick: 'No check was picked for it, so you judge it at Accept.',
  itemCountByRule: 'your rule on this line sets the item count',
  negated: 'it says what is not needed, so there is nothing to check',
  dropped: 'You dropped it.',
  suggested: 'Suggested: not in your job, so it is not checked unless you add it.',
  sheetLine: 'this line reads a sheet and its rules are checked by the sheet checks, so a row edit about it is not used',
  sheetFacts: 'this line reads a sheet, so it is checked by its sheet checks and not by page facts',
  columnRule: "this rule only names a column; the agent's checks on this line use it",
});
