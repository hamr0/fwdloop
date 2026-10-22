// Test-only preload (node --import): an exit listener registered BEFORE bin/fwdloop's own, so the process lingers (files on disk, hold not yet
// settled by the exit hook) for M4D_EXIT_DELAY_MS before the real exit hook runs. Sync sleep: exit listeners cannot await.
const ms = Number(process.env.M4D_EXIT_DELAY_MS ?? 0);
if (ms > 0) process.on('exit', () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
