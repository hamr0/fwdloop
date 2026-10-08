// M4e amendment 18 item 5: the 142 synthetic inputs the $0 probe compared (all synthetic, nothing personal).
// Each case: { pair, label, shape, input }. The frozen verdicts for them live in m4e-am18-parity.test.js.
const w = (n, p = 'w') => Array.from({ length: n }, (_, i) => `${p}${i}`).join(' ');
export const cases = [];
function pair(name, shape, inputs) {
  for (const [label, input] of inputs) cases.push({ pair: name, label, shape, input });
}

// ---- pair 1: sectionWords band edges + extras
const edge = [];
for (const N of [1, 5, 15, 180, 250]) {
  const lo = Math.floor((N * 8 + 9) / 10), hi = Math.floor((N * 12) / 10); // integer ceil/floor
  for (const [tag, n] of [['lo-1', lo - 1], ['lo', lo], ['N', N], ['hi', hi], ['hi+1', hi + 1]]) {
    if (n < 0) continue;
    edge.push([`N=${N} ${tag}=${n} (float0.8=${N * 0.8} float1.2=${N * 1.2})`, { text: `# Alpha\n${w(n)}\n# Beta\n${w(N)}` }]);
  }
}
const SW = (N) => ({ sections: ['Alpha', 'Beta'], wordsPerSection: N });
for (const N of [1, 5, 15, 180, 250]) pair('sectionWords', SW(N), edge.filter(([l]) => l.startsWith(`N=${N} `)));
const swShape = SW(10);
pair('sectionWords', swShape, [
  ['case-differing headings', { text: 'ALPHA\n' + w(10) + '\nbEtA:\n' + w(10) }],
  ['hash tokens in section', { text: '# Alpha\n## ' + w(9) + '\n# Beta\n### ' + w(10) }],
  ['hash only lines', { text: '# Alpha\n###\n#\n' + w(10) + '\n# Beta\n' + w(10) }],
  ['missing section Beta', { text: '# Alpha\n' + w(10) }],
  ['missing both', { text: w(10) }],
  ['duplicate heading Alpha', { text: '# Alpha\n' + w(10) + '\n# Alpha\n' + w(3) + '\n# Beta\n' + w(10) }],
  ['duplicate heading Beta', { text: '# Alpha\n' + w(10) + '\n# Beta\n' + w(10) + '\n# Beta\n' + w(40) }],
  ['text before first heading', { text: w(50) + '\n# Alpha\n' + w(10) + '\n# Beta\n' + w(10) }],
  ['out of order', { text: '# Beta\n' + w(10) + '\n# Alpha\n' + w(10) }],
  ['unlisted heading inside section', { text: '# Alpha\n' + w(5) + '\n# Other\n' + w(5) + '\n# Beta\n' + w(10) }],
  ['1,000-style numbers', { text: '# Alpha\n1,000 2,500 $3,000.50 ' + w(7) + '\n# Beta\n' + w(10) }],
  ['empty text', { text: '' }],
  ['whitespace text', { text: '   \n\n' }],
  ['CRLF', { text: '# Alpha\r\n' + w(10) + '\r\n# Beta\r\n' + w(10) }],
  ['colon headings w/ trailing ws', { text: 'Alpha:  \n' + w(10) + '\nBeta :\n' + w(10) }],
  ['indented heading', { text: '  # Alpha\n' + w(10) + '\n# Beta\n' + w(10) }],
  ['NBSP words', { text: '# Alpha\n' + 'a b c d e f g h i j' + '\n# Beta\n' + w(10) }],
  ['non-object (null)', null], ['non-object (array)', ['x']], ['string artifact', '# Alpha\n' + w(10)],
  ['text not string', { text: 42 }], ['no text key', { body: 'x' }],
  ['heading only text Beta only', { text: '# Beta\n' + w(10) }],
]);

// ---- pair 2: sections (order/missing) + maxWords
const MS = { maxWords: 20, sections: ['Summary', 'Skills'] };
pair('sectionOrder+maxWords', MS, [
  ['ok', { text: '# Summary\nhi\n# Skills\nx' }],
  ['case differs', { text: '# SUMMARY\nhi\n## skills:\nx' }],
  ['mixed case colon', { text: 'sUmMaRy:\nhi\nSKILLS\nx' }],
  ['missing Skills', { text: '# Summary\nhi' }],
  ['missing both', { text: 'hello world' }],
  ['out of order', { text: '# Skills\nx\n# Summary\ny' }],
  ['duplicate heading', { text: '# Summary\na\n# Summary\nb\n# Skills\nc' }],
  ['dup then order', { text: '# Skills\na\n# Summary\nb\n# Skills\nc' }],
  ['text before heading', { text: 'preamble here\n# Summary\na\n# Skills\nb' }],
  ['heading with extra words', { text: '# Summary of work\na\n# Skills\nb' }],
  ['hash words: 20 real + hashes', { text: '# Summary\n' + w(9) + '\n## Skills\n' + w(9) }],
  ['21 words', { text: '# Summary\n' + w(10) + '\n# Skills\n' + w(9) }],
  ['20 words exactly', { text: '# Summary\n' + w(9) + '\n# Skills\n' + w(8) }],
  ['hash not a word: tight', { text: '# Summary\n' + w(10) + '\n## Skills\n' + w(8) }],
  ['1,000 numbers', { text: '# Summary\n1,000 2,000\n# Skills\n$3,000.00' }],
  ['empty text', { text: '' }],
  ['non-object', 'plain string'], ['non-object number', 5], ['text null', { text: null }],
  ['done/blocker present (stripped)', { text: '# Summary\na\n# Skills\nb', done: true, blocker: null }],
  ['indented #', { text: '  # Summary\na\n# Skills\nb' }],
  ['only hashes', { text: '#\n##\n###' }],
]);
pair('maxWords', { maxWords: 5 }, [
  ['5 words', { text: 'a b c d e' }], ['6 words', { text: 'a b c d e f' }], ['hash not word', { text: '# a b c d e' }], ['## not word', { text: '## a b c d e' }],
  ['#tag glued', { text: '#a b c d e' }], ['hash mid-line', { text: 'a # b c d' }], ['hash mid-line 6', { text: 'a # b c d e' }], ['empty', { text: '' }],
  ['multi hash lines', { text: '#\n#\n#\na b c d e' }], ['1,000 style', { text: '1,000 2,000 3,000 4,000 5,000' }], ['6 numbers', { text: '1,000 2,000 3,000 4,000 5,000 6,000' }],
  ['CRLF 6', { text: 'a b\r\nc d\r\ne f' }], ['tabs', { text: 'a\tb\tc\td\te\tf' }], ['blank lines', { text: '\n\na b c\n\nd e\n' }], ['indented hash 5', { text: '  # a b c d e' }],
  ['indented hash 4+', { text: ' # a b c d' }],
]);

// ---- pair 3: allowedKeys
const AK = { maxWords: 100 };
pair('allowedKeys', AK, [
  ['text only', { text: 'ok' }],
  ['extra lines', { text: 'ok', lines: ['a'] }],
  ['extra a,b order', { text: 'ok', a: 1, b: 2 }],
  ['extra b,a order', { text: 'ok', b: 1, a: 2 }],
  ['extra first', { zeta: 1, text: 'ok', alpha: 2 }],
  ['extra only, no text', { lines: 'x' }],
  ['extra undefined value', { text: 'ok', x: undefined }],
  ['done/blocker stripped', { text: 'ok', done: true, blocker: null }],
  ['done + extra', { text: 'ok', done: true, lines: 1 }],
  ['numeric-like key', { text: 'ok', 10: 1, 2: 1 }],
  ['key with quote', { text: 'ok', 'a"b': 1 }],
  ['empty key', { text: 'ok', '': 1 }],
  ['non-object string', 'ok'], ['null', null], ['array', ['a']], ['number', 7], ['boolean', true], ['empty obj', {}],
  ['text non-string + extra', { text: 3, lines: 1 }],
  ['unicode key', { text: 'ok', 'é': 1 }],
]);

// ---- pair 4: blockLines / mustCarry
const BL = { linesPerInvoice: 2, mustCarry: ['Acme', 'total'] };
pair('blockLines+mustCarry', BL, [
  ['ok', { text: 'Acme inv 1\ntotal 5\nAcme inv 2\ntotal 6' }],
  ['case differs', { text: 'ACME inv 1\nTOTAL 5' }],
  ['mixed case', { text: 'acme\nToTaL' }],
  ['carry across lines of block', { text: 'Acme\ntotal' }],
  ['missing total in block 2', { text: 'Acme 1\ntotal 5\nAcme 2\nnothing' }],
  ['missing Acme block 1', { text: 'x 1\ntotal 5\nAcme 2\ntotal 6' }],
  ['not multiple (3 lines)', { text: 'Acme\ntotal\nAcme' }],
  ['not multiple + missing', { text: 'Acme\ntotal\nfoo' }],
  ['zero lines empty', { text: '' }],
  ['zero lines whitespace', { text: '  \n\n ' }],
  ['blank lines ignored', { text: 'Acme\n\n\ntotal\n\nAcme\ntotal' }],
  ['CRLF', { text: 'Acme\r\ntotal\r\nAcme\r\ntotal' }],
  ['substring inside word', { text: 'Acmex\nsubtotal' }],
  ['1,000 numbers', { text: 'Acme 1,000\ntotal 2,500.00' }],
  ['hash lines count as lines', { text: '# Acme\ntotal' }],
  ['one line', { text: 'Acme total' }],
  ['5 lines', { text: 'Acme\ntotal\nAcme\ntotal\nAcme' }],
  ['non-object', 'Acme\ntotal'], ['text not string', { text: ['Acme'] }],
  ['extra key + ok', { text: 'Acme\ntotal', foo: 1 }],
]);
pair('blockLines+mustCarry(size1)', { linesPerInvoice: 1, mustCarry: ['Ünï'] }, [
  ['unicode case', { text: 'ÜNÏ here' }], ['unicode miss', { text: 'uni here' }], ['ok', { text: 'ünï' }],
  ['two lines', { text: 'ünï\nünï' }], ['one miss of two', { text: 'ünï\nnope' }], ['empty', { text: '' }],
  ['dotless I', { text: 'İ' }], ['sharp s', { text: 'STRASSE' }], ['multi', { text: 'a\nb\nc' }], ['ok2', { text: ' ünï ' }],
  ['hash', { text: '# ünï' }], ['crlf', { text: 'ünï\r\nünï' }], ['3', { text: 'ünï\nünï\nünï' }], ['tab', { text: 'x\tünï' }], ['x', { text: 'x' }], ['non-object', null],
]);

