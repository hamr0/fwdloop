import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideSend } from './decide.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
test('local folder -> write, whatever the shas', () => {
  assert.equal(decideSend({ destinationLeavesMachine: false, acceptedSha: null, outgoingSha: A }), 'write');
  assert.equal(decideSend({ destinationLeavesMachine: false, acceptedSha: A, outgoingSha: B }), 'write');
});
test('outside + same sha -> send', () => {
  assert.equal(decideSend({ destinationLeavesMachine: true, acceptedSha: A, outgoingSha: A }), 'send');
});
test('outside + different sha -> stop-changed', () => {
  assert.equal(decideSend({ destinationLeavesMachine: true, acceptedSha: A, outgoingSha: B }), 'stop-changed');
});
test('outside + no accept -> stop-unseen', () => {
  assert.equal(decideSend({ destinationLeavesMachine: true, acceptedSha: null, outgoingSha: A }), 'stop-unseen');
  assert.equal(decideSend({ destinationLeavesMachine: true, acceptedSha: '', outgoingSha: A }), 'stop-unseen');
});
