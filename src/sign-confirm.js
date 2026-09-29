// M6a amendment 2 — only a person at a keyboard can sign. The CLI's `sign` verb calls this
// BEFORE signDraft; signDraft itself stays a library (tests) and the CLI has no path around this.
// Raises the bar, is not proof of a person: a determined script can fake a TTY.
import { createInterface } from 'node:readline';

export const NEEDS_TTY = 'sign needs an interactive terminal — run it yourself';
export const NAME_MISMATCH = 'typed name does not match';

/** stdin AND stdout must both be TTYs. */
export function isInteractive(stdin = process.stdin, stdout = process.stdout) {
  return Boolean(stdin && stdin.isTTY && stdout && stdout.isTTY);
}

/** Show the flow name, read one line, compare exactly (trimmed). Empty answer / EOF / mismatch refuse by name. */
export function confirmTypedName({ name, input = process.stdin, output = process.stdout }) {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: false });
    let done = false;
    const finish = (r) => { if (!done) { done = true; rl.close(); resolve(r); } };
    rl.on('close', () => finish({ ok: false, red: `${NAME_MISMATCH} (no answer)` }));
    output.write(`Signing flow "${name}". Type the flow name to confirm: `);
    rl.once('line', (line) => {
      const typed = line.trim();
      finish(typed !== '' && typed === name ? { ok: true } : { ok: false, red: NAME_MISMATCH });
    });
  });
}
