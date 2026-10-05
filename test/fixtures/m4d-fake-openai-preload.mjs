// `node --import <this>`: install the fake OpenAI network call in a spawned CLI child (usage from M4D_FAKE_USAGE JSON).
// A no-op without that variable (node --test also loads every file under test/ as a test file).
import { install } from './m4d-fake-openai.mjs';

if (process.env.M4D_FAKE_USAGE) install(JSON.parse(process.env.M4D_FAKE_USAGE));
