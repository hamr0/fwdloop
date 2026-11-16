// F201 arm B: the page-look prompt rewritten around intent and "the page can't show it". Harness-side only: src/pagemap.js is unchanged.
// B keeps A's answer form, so parseMapAnswer (src/pagemap.js) reads it: it checks only the fields it knows and ignores `why` and `cannot`.
import { lineRules } from '../../src/pagebits.js';

export const MAP_SYSTEM_B = 'You map a person\'s job to the exact words of ONE saved web page. You never grade and never invent words: every string you return must be copied from the page text, character for character.';

export function mapPromptB({ jobLines, label, text }) {
  const job = jobLines.map((l) => `LINE ${l.n}: ${l.text}${lineRules(l).map((r, i) => `\n~ rule ${i + 1}: ${r}`).join('')}`).join('\n');
  return `THE JOB (each ~ rule applies to the line above it):\n${job}\n\n`
    + 'Your goal: the ~ rules are the person\'s intent. For each rule, say which words on the page would let code check that every result keeps it. Code will look for the words you give, and the person will see them and can drop them.\n\n'
    + 'A "result" is one item the page lists (one flight, one stay, one row).\n\n'
    + 'For each job line and for each ~ rule, do ONE of two things:\n'
    + '1. The page can show the rule. Give a fact: the PAGE\'S OWN WORDS that a result carries when it keeps the rule. The words do not have to be the rule\'s words, but they must carry the rule\'s MEANING. Add a one-line "why" that says what those words on a result mean for the rule.\n'
    + '2. The page cannot show the rule: how the answer is written, its tone or style, or anything the page does not hold. Give NO fact for it. Put it in "cannot" with its line and rule number and a one-line "why".\n'
    + 'Never tie a rule to page words that do not carry its meaning. A rule with no fact is a correct answer when the page cannot show it.\n\n'
    + 'Return ONLY a JSON object, no prose, no code fence:\n'
    + '{"facts":[{"name":"<letters and spaces only>","from":"<line N | line N rule M>","shape":"place|money|time|phrase","words":["<page words>", ...],"why":"<one line>","currency":["<symbol>"],"unit":["<words after the amount>"],"reading":<optional, see below>}],"cannot":[{"from":"line N rule M","why":"<one line>"}]}\n\n'
    + 'shape meanings:\n'
    + '- place: words = ways the page writes the place (a city, an airport name), copied from the page.\n'
    + '- money: words = the label(s) written right BEFORE the amount, copied from the page. currency / unit = how the page writes the currency ("$") and/or the words after the amount ("US dollars"); give every spelling the page uses, as lists.\n'
    + '- time: words = the label(s) written right BEFORE the time that is the one the rule is about, copied from the page.\n'
    + '- phrase: words = fixed words a result\'s text must contain, copied from the page.\n'
    + 'Several words in one list are alternatives for the same fact. Put the best one first.\n'
    + 'reading (optional, only on a time or money fact): when a ~ rule is a limit on that fact that the page cannot hold in words (for example "not a red-eye" is a limit on the departure time), give your own best reading of the rule as that limit: {"op":"between","lo":<bound>,"hi":<bound>} or {"op":"lt|lte|gt|gte","value":<bound>}. A time bound is a "HH:MM" string on a 24-hour clock; a money bound is a number. Leave reading out when a page word already carries the rule.\n\n'
    + `PAGE TEXT (the input "${label}"):\n${text}`;
}
