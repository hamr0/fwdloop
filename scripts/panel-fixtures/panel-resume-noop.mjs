// Stand-in for `bin/fwdloop` in panel tests that only check the answer door:
// it never touches a book, a key or a provider — it just exits. Used as the
// injected `resume.bin` so a test POST cannot start a real resume.
process.exit(0);
