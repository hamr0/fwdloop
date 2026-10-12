// M7 POC: the in-run tools stash/peek/recall/get over a per-run litectx store.
// borrowed-from: bareloop src/tools.js@dc06660 (createCtxTools: ctx_stash, ctx_peek,
// ctx_recall, ctx_get; ISOLATE_MAX_BYTES = 64 KB). Trimmed to what the POC needs and
// renamed from ctx_<verb> to the bare verb, as fwdloop's tools are named by verb
// (src/primitives.js). Not carried here (build pieces): redactSecrets on id/body,
// the emit/spine seam, the readshim, the full recall output shape.
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LiteCtx } = require('litectx');

export const ISOLATE_MAX_BYTES = 65536;

/** One fresh store per run: the db lives under THIS run's dir, so a different
 *  runDir is a different store by construction. `storeRoot` is only overridden by
 *  the red variant that deliberately shares one store across runs. */
export function openRunStore(runDir, storeRoot = runDir) {
  return new LiteCtx({ root: runDir, dbPath: join(storeRoot, '.ctx', 'index.db') });
}

export function makeCtxTools(lc, onExecute = () => {}) {
  const wrap = (name, fn) => async (args) => { onExecute(name, args); return fn(args); };
  return {
    stash: {
      name: 'stash',
      description: `Park a payload OUT of your context under a key. A payload over ${ISOLATE_MAX_BYTES} bytes is refused unparked.`,
      parameters: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] },
      execute: wrap('stash', async ({ id, text }) => {
        const size = Buffer.byteLength(String(text));
        if (size > ISOLATE_MAX_BYTES) {
          return `stash: text is ${size} bytes - the limit is ${ISOLATE_MAX_BYTES} bytes per payload. Nothing was parked.`;
        }
        lc.stash(String(id), String(text));
        return `parked ${size} bytes under "${id}"`;
      }),
    },
    peek: {
      name: 'peek',
      description: 'Look at the head and tail of a stashed payload.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execute: wrap('peek', async ({ id }) => {
        const p = lc.peek(String(id));
        if (!p) return `nothing stashed under "${id}"`;
        return `stash "${id}": ${p.bytes} bytes\nhead: ${p.head}\ntail: ${p.tail}`;
      }),
    },
    recall: {
      name: 'recall',
      description: 'Search this run\'s indexed text by meaning.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: wrap('recall', async ({ query }) => {
        const r = await lc.recall(String(query), { n: 5 });
        return JSON.stringify(r);
      }),
    },
  };
}
