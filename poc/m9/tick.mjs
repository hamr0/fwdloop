// Child: one clock tick in a fresh process. argv: ledger schedule nowISO [naive]
import { tick, fireCount } from './lib.mjs';
const [file, schedule, nowISO, naive] = process.argv.slice(2);
const d = tick({ file, schedule, nowISO, naive: naive === 'naive' });
process.stdout.write(JSON.stringify({ d, fires: fireCount(file), tz: process.env.TZ }));
