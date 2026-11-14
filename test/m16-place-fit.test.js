// borrowed-from: bareloop tests/place-fit.test.js@v0.56.0 (3383cce + f148028e for the agree-follower tests), imports pointed at fwd's files, fixtures under test/fixtures/m16-block/
// (the block's own use of the fit is tested in tests/checkblock-place.test.js)
// PLACE RULES, P1 (docs/product/ITEM33-BUILD.md, "Place rules build spec"): at drafting, code tries to fit a place rule to a phrase whose words hold a
// version or an ISO date, instead of refusing it as week-only. Frozen order: 27 candidates; the strict first-heading read on the fact's own input must return
// exactly the words. No fit = refused exactly as today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as PR from '../src/placerule.js';

const LOG = '# Changelog\n\n## [Unreleased]\n\n## [0.55.0] - 2026-11-04\n\n### Fixed\n- one\n\n## [0.54.1] - 2026-11-01\n';

test('P1 fit: the version words fit the first candidate that reads them, in the frozen order (## [ and ] before the rest)', () => {
  assert.deepEqual(PR.fitPlaceRule('0.55.0', LOG), { kind: 'headingBetween', prefix: '## [', end: ']', shape: 'semver', skip: ['Unreleased'] });
  assert.equal(PR.PLACE_CANDIDATES.length, 27);
  assert.deepEqual(PR.PLACE_CANDIDATES.slice(0, 4).map((c) => `${c.prefix}|${c.end}`), ['## [|]', '## [| ', '## [|$EOL', '## v|]']);
});

test('P1 fit: the date words fit as headingDateAfter on the same heading', () => {
  assert.deepEqual(PR.fitPlaceRule('2026-11-04', LOG), { kind: 'headingDateAfter', prefix: '## [', end: ']', shape: 'semver', skip: ['Unreleased'] });
});

test('P1 fit: no fit stays a null: words that are not the newest value, other date forms, version and date together, extra words, a mixed-level file, no text', () => {
  assert.equal(PR.fitPlaceRule('0.54.1', LOG), null, 'the older release is not what the newest heading reads');
  assert.equal(PR.fitPlaceRule('Nov 4, 2026', LOG), null, 'only an ISO date is handled');
  assert.equal(PR.fitPlaceRule('0.55.0 2026-11-04', LOG), null, 'two values in one phrase: ambiguous, refused');
  assert.equal(PR.fitPlaceRule('release 0.55.0', LOG), null, 'the phrase must be exactly the value');
  assert.equal(PR.fitPlaceRule('0.55.0', '# [1.0.0] x\n\n## [0.55.0] - 2026-11-04\n'), null, 'mixed levels');
  assert.equal(PR.fitPlaceRule('0.55.0', ''), null);
  assert.equal(PR.fitPlaceRule('0.55.0', null), null);
});
