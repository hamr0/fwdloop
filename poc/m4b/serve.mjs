// poc/m4b/serve.mjs — runs the answer door as its OWN process (own process
// group when spawned detached), so a test can kill the server's whole group
// and see whether the resume child outlives it. Prints one JSON line.
import { mkdirSync } from 'node:fs';

const mod = await import(process.env.DOOR_MODULE ?? './answer-door.mjs');
mkdirSync(process.env.DOOR_LOGDIR, { recursive: true });
const door = await mod.createAnswerDoor({ root: process.env.DOOR_ROOT, logDir: process.env.DOOR_LOGDIR });
process.stdout.write(`${JSON.stringify({ port: door.port, pid: process.pid })}\n`);
setInterval(() => {}, 1 << 30);
