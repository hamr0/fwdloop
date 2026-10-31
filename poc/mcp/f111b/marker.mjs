// F111 marker server: if it ever starts, it writes $F111_MARKER. Used to prove a bad passEnv spawns nothing.
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.F111_MARKER, 'spawned');
setTimeout(() => process.exit(0), 500);
