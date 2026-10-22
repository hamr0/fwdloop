// M7 piece 3 (docs/wiki/the-module-ladder.md, "M7 scope — SIGNED", items 1-3): the
// in-run tools a step can use only if it is granted: recall, get, recent, related,
// impact, compress, peek, stash. Each is a litectx call over THIS run's store
// (src/run-store.js), so nothing carries into the next run.
//
// borrowed-from: bareloop src/tools.js@dc06660 (createCtxTools: ctx_recall, ctx_get,
// ctx_impact, ctx_related, ctx_recent, ctx_compress, ctx_stash, ctx_peek and
// ISOLATE_MAX_BYTES = 64 KB; the readouts are bareloop's). Adjusted to fwdloop's shape:
//   - named by bare verb, like read/write (src/primitives.js);
//   - the store is per run and opened per call (src/run-store.js), the index root is
//     the run dir, and any path a tool is handed goes through the SAME read gate as
//     `read` first (`gatePath`), so the deny rules apply through every door;
//   - `get` also reads a stashed item by id (the catalogue's words for it);
//   - no spine `emit`: model-step already tallies each tool a step called;
//   - `remember`/`forget` are NOT here: memory lasts one run (PRD: no learning
//     between flows), so they stay refused.
//   - redactSecrets lives in src/redact.js (bareloop's src/validate.js@07215d6 inventory).

import path from 'node:path';
import { createRequire } from 'node:module';
import { redactSecrets } from './redact.js';
import { withRunStore } from './run-store.js';

const require = createRequire(import.meta.url);
const { compress: compressNode, StalePointerError } = require('litectx');

/** One stashed item holds at most this many bytes (measured after secrets are masked,
 *  because that is what enters the store). Bareloop's number, signed in M7 item 3. */
export const ISOLATE_MAX_BYTES = 65536;

const LINE_SPACE = 'Line numbers are 0-based; copy them between recall and get as printed.';

/**
 * @param {object} o
 * @param {string} o.runDir
 * @param {(verb: string, rawPath: unknown) => Promise<string>} o.gatePath - the read gate; resolves a model-given path to the absolute path it judged, or throws GateRefusal.
 * @returns {Record<string, {name: string, description: string, parameters: object, execute: (args: any) => Promise<string>}>}
 */
export function makeCtxTools({ runDir, gatePath }) {
  const root = path.resolve(runDir);
  /** Run `fn(lc)` on this run's store, with the run's indexed text brought up to date first. A store failure is
   *  a refusal RESULT naming the cause, never a throw, so it costs one round instead of the run. */
  const indexed = (/** @type {string} */ tool, /** @type {(lc: any) => Promise<string>|string} */ fn) => async () => {
    try {
      return await withRunStore(runDir, async (lc) => { await lc.index(); return fn(lc); });
    } catch (e) {
      return `${tool} failed: ${String(/** @type {Error} */ (e)?.message || e)}`;
    }
  };
  /** A path the gate approved, as litectx spells it: relative to the run dir. @param {string} verb @param {unknown} raw */
  const relOf = async (verb, raw) => {
    const abs = await gatePath(verb, raw);
    return path.relative(root, abs);
  };

  return {
    recall: {
      name: 'recall',
      description: 'Search this run\'s code and markdown files only (its frozen inputs and its out folder; a CSV or Word file is not searched) for a name or phrase. '
        + `Returns POINTERS (path, symbol, line range), not the text; pass one to get to read that part. ${LINE_SPACE}`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A symbol name or a phrase.' },
          n: { type: 'integer', description: 'Max pointers (default 5, max 20).' },
        },
        required: ['query'],
      },
      execute: async ({ query, n }) => indexed('recall', async (lc) => {
        const cap = Math.min(Math.max(Number(n) || 5, 1), 20);
        const grouped = await lc.recall(String(query), { kind: ['code', 'doc'], n: cap });
        const hits = [...(grouped.code ?? []), ...(grouped.doc ?? [])].slice(0, cap);
        const lines = hits.map((/** @type {any} */ h) => (h.chunk
          ? `${h.path}\t${h.chunk.symbol ?? '(anonymous)'}\t${h.chunk.nodeType}\tlines ${h.chunk.startLine}-${h.chunk.endLine}`
          : `${h.path}\t(whole file — no chunk)`));
        return lines.length ? lines.join('\n') : 'no hits';
      })(),
    },
    get: {
      name: 'get',
      description: 'Read ONE thing back: a stashed item by its id, or one chunk of a file by the path and line range recall gave you '
        + `(code plus its doc-comment, without the rest of the file). A range that is not a chunk boundary is refused. ${LINE_SPACE}`,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The key a payload was stashed under.' },
          path: { type: 'string', description: 'Path exactly as recall printed it.' },
          startLine: { type: 'integer', description: 'From recall.' },
          endLine: { type: 'integer', description: 'From recall.' },
        },
      },
      execute: async (args) => {
        if (typeof args?.id === 'string') {
          const key = redactSecrets(args.id);
          return indexed('get', (lc) => (lc.peek(key) ? String(lc.get(key)?.text ?? '') : `nothing stashed under "${key}"`))();
        }
        if (typeof args?.path !== 'string') return 'get: give either an id (a stashed item) or a path with startLine and endLine';
        const rel = await relOf('get', args.path);
        return indexed('get', (lc) => {
          try {
            const item = lc.get(rel, { startLine: Number(args.startLine), endLine: Number(args.endLine) });
            return item?.text || `no chunk at ${args.startLine}-${args.endLine} in "${rel}" — copy a line range from recall, do not compute one`;
          } catch (e) {
            if (e instanceof StalePointerError) return `stale pointer: ${e.message}`;
            throw e;
          }
        })();
      },
    },
    impact: {
      name: 'impact',
      description: 'Before changing a function, see what depends on it: callers, importers and mention sites in code and markdown files only (a CSV or Word file has none). '
        + `${LINE_SPACE}`,
      parameters: {
        type: 'object',
        properties: { symbol: { type: 'string', description: 'A function, class or identifier name.' } },
        required: ['symbol'],
      },
      execute: async ({ symbol }) => indexed('impact', async (lc) => {
        const imp = await lc.impact(String(symbol));
        if (!imp) return `no indexed symbol "${symbol}" — check the spelling with recall first`;
        const lines = [];
        for (const d of imp.defs ?? []) lines.push(`defined\t${d.path}:${d.startLine}`);
        for (const c of imp.callers ?? []) lines.push(`called by\t${c.path}:${c.line}${c.symbol ? ` (in ${c.symbol})` : ''}`);
        for (const c of imp.callees ?? []) lines.push(`calls\t${c}`);
        lines.push(`risk ${imp.risk} — ${imp.confirmed} confirmed caller(s), ${imp.mentions} mention(s)`);
        // the hedges are the other half of the count: "low risk, 0 callers" alone reads as a licence
        for (const h of imp.hedges ?? []) lines.push(`caveat\t${h}`);
        return lines.join('\n');
      })(),
    },
    related: {
      name: 'related',
      description: 'Walk the import links around one code or markdown file: what it imports and what imports it (one hop). Code and markdown files only.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'A path inside this run, e.g. "out/helper.js".' } },
        required: ['path'],
      },
      execute: async ({ path: p }) => {
        const rel = await relOf('related', p);
        return indexed('related', (lc) => {
          const r = lc.related(rel, { dir: 'both', hops: 1 });
          if (!r || !r.items.length) return `no import edges recorded for "${rel}" — the file is isolated or the path is not indexed`;
          return r.items.map((/** @type {any} */ i) => `${i.via === 'in' ? 'imported by' : 'imports'}\t${i.id}`).join('\n');
        })();
      },
    },
    recent: {
      name: 'recent',
      description: 'List recently changed functions among this run\'s code files, most recent first. A run is not a git repository, so it finds nothing inside a run.',
      parameters: { type: 'object', properties: {} },
      execute: async () => indexed('recent', (lc) => {
        const rows = lc.recentActivity() ?? [];
        return rows.length
          ? rows.map((/** @type {any} */ r) => `${r.id ?? r.symbol}\t${r.kind ?? ''}\tedits ${r.edits ?? '?'}`).join('\n')
          : 'no recent edit activity recorded';
      })(),
    },
    compress: {
      name: 'compress',
      description: 'Read a function\'s SIGNATURE: its declaration head plus doc-comment, with the body left out. '
        + 'Far cheaper than the body when you only need what it is. Code only; give the path and the symbol name.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'A path inside this run.' },
          symbol: { type: 'string', description: 'The function or class name inside that file.' },
        },
        required: ['path', 'symbol'],
      },
      execute: async ({ path: p, symbol }) => {
        const rel = await relOf('compress', p);
        return indexed('compress', async (lc) => {
          const node = lc.getNode(rel);
          const chunk = node?.chunks.find((/** @type {any} */ c) => c.symbol === String(symbol));
          if (!chunk) return `no symbol "${symbol}" in "${rel}" — recall the name to find where it lives`;
          const file = lc.get(rel);
          if (!file?.text) return `"${rel}" has no readable body in the index`;
          const body = file.text.split('\n').slice(chunk.startLine, chunk.endLine + 1).join('\n');
          return compressNode({ text: body, format: node.format, symbol: String(symbol) }, { level: 'signature' });
        })();
      },
    },
    stash: {
      name: 'stash',
      description: 'Park a bulky payload OUT of your context under a key; it costs nothing per round while parked. Check it later with peek or read it back with get. '
        + `A payload over ${ISOLATE_MAX_BYTES} bytes is refused unparked. It lasts this run only.`,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The key to park under.' },
          text: { type: 'string', description: 'The payload.' },
        },
        required: ['id', 'text'],
      },
      execute: async ({ id, text }) => {
        // masked BEFORE anything else touches it, and the cap is measured on the masked
        // body: that is the one that enters the store
        const key = redactSecrets(id);
        const body = redactSecrets(text);
        const size = Buffer.byteLength(body);
        if (size > ISOLATE_MAX_BYTES) {
          return `stash: text is ${size} bytes — the limit is ${ISOLATE_MAX_BYTES} bytes per payload. Nothing was parked. Park the part you need later, or write the bulk to a file and stash its path.`;
        }
        try {
          await withRunStore(runDir, (lc) => lc.stash(key, body));
        } catch (e) {
          return `stash failed: ${String(/** @type {Error} */ (e)?.message || e)}`;
        }
        return `parked ${size} bytes under "${key}"`;
      },
    },
    peek: {
      name: 'peek',
      description: 'Look at the head and tail of a stashed payload WITHOUT loading all of it.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The key it was stashed under.' } },
        required: ['id'],
      },
      execute: async ({ id }) => {
        const key = redactSecrets(id);
        try {
          const p = await withRunStore(runDir, (lc) => lc.peek(key));
          return p ? `stash "${key}": ${p.bytes} bytes\nhead: ${p.head}\ntail: ${p.tail}` : `nothing stashed under "${key}"`;
        } catch (e) {
          return `peek failed: ${String(/** @type {Error} */ (e)?.message || e)}`;
        }
      },
    },
  };
}
