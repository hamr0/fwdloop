// F166 prompt rebuild (POC, NOT the product). $0: FAKE provider, no network, no keys. Runs the real draft() on a saved F165 draft's prose + saved page + saved page-map answer
// and writes the drafter's system prompt, so arm A and arm B prompts can be diffed.
// usage: node prompt.mjs <draftDir (a draft/ or draft-1/ dir)> <outFile> [carry=1]   (carry=1 passes picks-record.json as carriedPicks)
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const root = process.cwd();
const { draft } = await import(path.join(root, 'src/drafter.js'));
const { fakeProvider, toolReply, textReply, RATES, MODEL } = await import(path.join(root, 'test/drafter-fixture.mjs'));
const [dd, out] = process.argv.slice(2);
const rd = (f) => fs.readFileSync(path.join(dd, f), 'utf8');
const prose = rd('prose.txt');
const page = rd('pages/flights.txt');
const mapping = JSON.parse(rd('page-look.json')).pages[0].mapping;
const carry = process.argv.includes('carry=1');
const carriedPicks = carry ? JSON.parse(rd('picks-record.json')).picks : [];
const stub = { steps: [], guardrailClasses: {}, unjudgeable: {}, refused: [], notChecked: [] };
const prov = fakeProvider([{ ...textReply(JSON.stringify(mapping)), usage: { inputTokens: 1000, outputTokens: 200 } }, toolReply(stub), toolReply(stub), toolReply(stub)]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f166-'));
try {
  await draft({ proseText: prose, provider: prov, rates: RATES, modelId: MODEL, draftDir: path.join(tmp, 'd'), fetchPage: async (url) => ({ ok: true, text: page, url }), offerQuestions: false, carriedPicks });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
const i = prov.calls.findIndex((c) => c.tools.includes('emit_declaration'));
fs.writeFileSync(out, i >= 0 ? prov.calls[i].messages[0].content : '(no drafting call)');
console.log(path.basename(out), i >= 0 ? 'ok' : 'no drafting call');
