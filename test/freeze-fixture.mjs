// A test helper: what `runFlow` does at a run's start for the inputs - freeze them (`freezeInputs`), then record the manifest in `run.json` with the ONE writer
// (`writeRunStart`, M8b) - for a test that calls the freezer on its own and then reads the run's inputs back through the readers.
import { freezeInputs } from '../src/runner.js';
import { writeRunStart } from '../src/runfile.js';

/** @param {string} runDir @param {Parameters<typeof freezeInputs>[1]} sources @param {Parameters<typeof freezeInputs>[2]} [opts] */
export async function freezeAndRecord(runDir, sources, opts) {
  const r = await freezeInputs(runDir, sources, opts);
  if (r.ok) writeRunStart(runDir, { model: null, thinking: false, inputs: r.manifest });
  return r;
}
