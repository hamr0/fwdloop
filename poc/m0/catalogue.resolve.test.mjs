// Resolution tests for catalogue.mjs (F23, M0b step 1): every CATALOGUE and
// FENCE entry names a package+symbol that actually loads. Nobody had ever
// proven this before F23 found the litectx rows named bareloop's tool-wrapper
// names instead of litectx's own exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGUE, FENCE, resolveEntry,
} from './catalogue.mjs';

test('every CATALOGUE entry resolves against the real installed package', async () => {
  for (const entry of CATALOGUE) {
    await assert.doesNotReject(
      () => resolveEntry(entry),
      undefined,
      `catalogue verb "${entry.verb}" (${entry.package}#${entry.symbol}) did not resolve`,
    );
  }
});

test('every FENCE entry resolves against the real installed package', async () => {
  for (const entry of FENCE) {
    await assert.doesNotReject(
      () => resolveEntry(entry),
      undefined,
      `fence entry "${entry.name}" (${entry.package}#${entry.symbol}) did not resolve`,
    );
  }
});

test('PROOF the test can fail: a made-up named-export symbol is rejected', async () => {
  await assert.rejects(
    () => resolveEntry({
      verb: 'bogus', package: 'litectx', symbol: 'ctx_not_a_real_export',
    }),
    /has no exported function "ctx_not_a_real_export"/,
  );
});

test('PROOF the test can fail: a made-up method on a real exported class is rejected', async () => {
  await assert.rejects(
    () => resolveEntry({
      verb: 'bogus', package: 'litectx', symbol: 'LiteCtx', method: 'notARealMethod',
    }),
    /has no method "notARealMethod"/,
  );
});

test('PROOF the test can fail: a made-up tool name from a real factory is rejected', async () => {
  await assert.rejects(
    () => resolveEntry({
      verb: 'bogus', package: 'bare-agent/tools', symbol: 'createShellTools', tool: 'shell_not_a_real_tool',
    }),
    /does not produce a tool named "shell_not_a_real_tool"/,
  );
});
