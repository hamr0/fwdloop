// F118 marker server: if it ever starts, it writes $F118_MARKER. Proves a bad cwd spawns nothing.
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.F118_MARKER, 'spawned');
setTimeout(() => process.exit(0), 500);
