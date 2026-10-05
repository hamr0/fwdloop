// Stand-in for `bin/fwdloop` in the key-scrub test (amendment 1 (e)(3)): a resume that REFUSES (exit 1, non-lock
// refusal) and quotes the provider key from its environment in its refusal, the way a provider error body can.
// It touches no book and no provider.
process.stderr.write(`resume: provider said no — request key=${process.env.DEEPSEEK_API_KEY ?? ''} was rejected\n`);
process.exit(1);
