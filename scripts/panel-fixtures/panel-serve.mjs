// Lives outside test/ on purpose: `node --test` runs every file under test/ as a test.
// The panel server as its OWN process (a test spawns it detached so it can kill
// the whole process group and check the resume outlives it). Prints one JSON
// line {port, pid}. Root and log dir come from env; the resume child inherits
// this process's env — the production path (no `resume.env` override).
import { createPanelServer } from '../../src/panel/server.js';

const h = await createPanelServer({ port: 0, root: process.env.PANEL_ROOT, resume: { logDir: process.env.PANEL_LOGDIR } });
process.stdout.write(`${JSON.stringify({ port: h.port, pid: process.pid })}\n`);
setInterval(() => {}, 1 << 30);
