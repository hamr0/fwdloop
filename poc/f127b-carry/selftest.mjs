import { check, factsIn } from './checker.mjs';
const good = '- Mrs Okafor, the project is on track.\n- The deadline is 14 March.\n- Kind regards, Tom';
const bad = '- Dear customer, it is very good\n- Another one that is far too long to ever fit under the fifteen word limit set here ok\n- x';
const cases = {
  good: check(good), bad: check(bad),
  // each rule broken once: a text that violates only that rule must be red with the rule on, green with it skipped
  count: [check('- Mrs Okafor, 14 March.\n- Kind regards, Tom\n- c\n- d'), check('- Mrs Okafor, 14 March.\n- Kind regards, Tom\n- c\n- d', { skip: ['count'] })],
  words: [check(`- Mrs Okafor ${'w '.repeat(15)}\n- 14 March\n- Kind regards, Tom`), check(`- Mrs Okafor ${'w '.repeat(15)}\n- 14 March\n- Kind regards, Tom`, { skip: ['words'] })],
  very: [check('- Mrs Okafor, very good\n- 14 March\n- Kind regards, Tom'), check('- Mrs Okafor, very good\n- 14 March\n- Kind regards, Tom', { skip: ['very'] })],
  okafor: [check('- Dear Ms Smith\n- 14 March\n- Kind regards, Tom'), check('- Dear Ms Smith\n- 14 March\n- Kind regards, Tom', { skip: ['okafor'] })],
  tom: [check('- Mrs Okafor\n- 14 March\n- Best, Tom'), check('- Mrs Okafor\n- 14 March\n- Best, Tom', { skip: ['tom'] })],
  deadline: [check('- Mrs Okafor\n- 15 March\n- Kind regards, Tom'), check('- Mrs Okafor\n- 15 March\n- Kind regards, Tom', { skip: ['deadline'] })],
};
console.log(JSON.stringify({ cases, facts: factsIn(good) }, null, 1));
const ok = cases.good.green && !cases.bad.green
  && ['count', 'words', 'very', 'okafor', 'tom', 'deadline'].every((r) => !cases[r][0].green && cases[r][1].green)
  && Object.values(factsIn(good)).every(Boolean) && !Object.values(factsIn(bad)).some(Boolean);
console.log(ok ? 'SELFTEST OK' : 'SELFTEST FAIL'); process.exit(ok ? 0 : 1);
