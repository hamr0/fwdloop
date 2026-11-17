// F202 (f): the rule of hamr's design as one pure function. POC only, never shipped.
// destinationLeavesMachine: false = a local folder (write, never stops).
// acceptedSha: the sha256 recorded when the person accepted at the last Ask THIS run (null/'' = no accept this run).
// outgoingSha: the sha256 of what is about to leave.
export function decideSend({ destinationLeavesMachine, acceptedSha, outgoingSha }) {
  if (!destinationLeavesMachine) return 'write';
  if (typeof acceptedSha !== 'string' || acceptedSha.length === 0) return 'stop-unseen';
  if (typeof outgoingSha !== 'string' || outgoingSha.length === 0) return 'stop-unseen';
  return acceptedSha === outgoingSha ? 'send' : 'stop-changed';
}
