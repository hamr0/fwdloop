import { check, honoursAsk1 } from './checker.mjs';
const bad = '- Collect points on every color of loaf\n- Organize group orders with the center team\n- It is very simple to join and the favorite choice\n- Rewards arrive quickly';
const good = '- Collect a stamp on every loaf you buy\n- Organise group orders with our centre team\n- Joining is simple and quick for everyone\n- Rewards arrive in your favourite flavours';
const out = {
  bad: check(bad), good: check(good),
  badWithUsRuleDisabled: check('- one two\n- Color three\n- four five\n- six seven', { skip: [] }),
  usRuleBroken: check('- one two\n- color three\n- four five\n- six seven', { skip: ['us'] }),
  veryRuleBroken: check('- one two\n- very three\n- four five\n- six seven', { skip: ['very'] }),
  wordsRuleBroken: check('- one two\n- a b c d e f g h i j k l m n o p\n- four five\n- six seven', { skip: ['words'] }),
  countRuleBroken: check('- one two\n- three four', { skip: ['count'] }),
  honoursBad: honoursAsk1(bad), honoursGood: honoursAsk1(good),
};
console.log(JSON.stringify(out, null, 1));
const ok = !out.bad.green && out.good.green && !out.badWithUsRuleDisabled.green && out.usRuleBroken.green && out.veryRuleBroken.green && out.wordsRuleBroken.green && out.countRuleBroken.green && !out.honoursBad && out.honoursGood;
console.log(ok ? 'SELFTEST OK' : 'SELFTEST FAIL'); process.exit(ok ? 0 : 1);
