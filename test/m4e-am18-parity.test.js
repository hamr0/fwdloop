// M4e amendment 18 item 5: the permanent parity test. The table below was generated ONCE from fwdloop's own
// pre-switch closeSoftgreen (commit before the bareguard switch) and is frozen: a red today stays red after the
// switch, with the same sentences; a green stays green. 142 synthetic inputs, defined in m4e-am18-parity-cases.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cases } from './m4e-am18-parity-cases.js';
import { closeSoftgreen } from '../src/closers.js';

// The runner strips done/blocker once before any close (src/runner.js); mirror that here.
const strip = (a) => {
  if (a && typeof a === 'object' && !Array.isArray(a)) { const o = { ...a }; delete o.done; delete o.blocker; return o; }
  return a;
};

// { id: "<pair> | <label>", verdict, red, reds } as the pre-switch code returned them.
const FROZEN = [
  {"id": "sectionWords | N=1 lo-1=0 (float0.8=0.8 float1.2=1.2)", "verdict": "red", "red": "Alpha: 0 words, about 1 asked (1-1)", "reds": ["Alpha: 0 words, about 1 asked (1-1)"]},
  {"id": "sectionWords | N=1 lo=1 (float0.8=0.8 float1.2=1.2)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=1 N=1 (float0.8=0.8 float1.2=1.2)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=1 hi=1 (float0.8=0.8 float1.2=1.2)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=1 hi+1=2 (float0.8=0.8 float1.2=1.2)", "verdict": "red", "red": "Alpha: 2 words, about 1 asked (1-1)", "reds": ["Alpha: 2 words, about 1 asked (1-1)"]},
  {"id": "sectionWords | N=5 lo-1=3 (float0.8=4 float1.2=6)", "verdict": "red", "red": "Alpha: 3 words, about 5 asked (4-6)", "reds": ["Alpha: 3 words, about 5 asked (4-6)"]},
  {"id": "sectionWords | N=5 lo=4 (float0.8=4 float1.2=6)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=5 N=5 (float0.8=4 float1.2=6)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=5 hi=6 (float0.8=4 float1.2=6)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=5 hi+1=7 (float0.8=4 float1.2=6)", "verdict": "red", "red": "Alpha: 7 words, about 5 asked (4-6)", "reds": ["Alpha: 7 words, about 5 asked (4-6)"]},
  {"id": "sectionWords | N=15 lo-1=11 (float0.8=12 float1.2=18)", "verdict": "red", "red": "Alpha: 11 words, about 15 asked (12-18)", "reds": ["Alpha: 11 words, about 15 asked (12-18)"]},
  {"id": "sectionWords | N=15 lo=12 (float0.8=12 float1.2=18)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=15 N=15 (float0.8=12 float1.2=18)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=15 hi=18 (float0.8=12 float1.2=18)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=15 hi+1=19 (float0.8=12 float1.2=18)", "verdict": "red", "red": "Alpha: 19 words, about 15 asked (12-18)", "reds": ["Alpha: 19 words, about 15 asked (12-18)"]},
  {"id": "sectionWords | N=180 lo-1=143 (float0.8=144 float1.2=216)", "verdict": "red", "red": "Alpha: 143 words, about 180 asked (144-216)", "reds": ["Alpha: 143 words, about 180 asked (144-216)"]},
  {"id": "sectionWords | N=180 lo=144 (float0.8=144 float1.2=216)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=180 N=180 (float0.8=144 float1.2=216)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=180 hi=216 (float0.8=144 float1.2=216)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=180 hi+1=217 (float0.8=144 float1.2=216)", "verdict": "red", "red": "Alpha: 217 words, about 180 asked (144-216)", "reds": ["Alpha: 217 words, about 180 asked (144-216)"]},
  {"id": "sectionWords | N=250 lo-1=199 (float0.8=200 float1.2=300)", "verdict": "red", "red": "Alpha: 199 words, about 250 asked (200-300)", "reds": ["Alpha: 199 words, about 250 asked (200-300)"]},
  {"id": "sectionWords | N=250 lo=200 (float0.8=200 float1.2=300)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=250 N=250 (float0.8=200 float1.2=300)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=250 hi=300 (float0.8=200 float1.2=300)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | N=250 hi+1=301 (float0.8=200 float1.2=300)", "verdict": "red", "red": "Alpha: 301 words, about 250 asked (200-300)", "reds": ["Alpha: 301 words, about 250 asked (200-300)"]},
  {"id": "sectionWords | case-differing headings", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | hash tokens in section", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | hash only lines", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | missing section Beta", "verdict": "red", "red": "no line is exactly the heading \"Beta\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Beta\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "sectionWords | missing both", "verdict": "red", "red": "no line is exactly the heading \"Alpha\" (a heading is a line that is only that text, optionally after #); no line is exactly the heading \"Beta\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Alpha\" (a heading is a line that is only that text, optionally after #)", "no line is exactly the heading \"Beta\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "sectionWords | duplicate heading Alpha", "verdict": "red", "red": "Alpha: 14 words, about 10 asked (8-12)", "reds": ["Alpha: 14 words, about 10 asked (8-12)"]},
  {"id": "sectionWords | duplicate heading Beta", "verdict": "red", "red": "Beta: 51 words, about 10 asked (8-12)", "reds": ["Beta: 51 words, about 10 asked (8-12)"]},
  {"id": "sectionWords | text before first heading", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | out of order", "verdict": "red", "red": "section heading \"Beta\" is out of order", "reds": ["section heading \"Beta\" is out of order"]},
  {"id": "sectionWords | unlisted heading inside section", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | 1,000-style numbers", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | empty text", "verdict": "red", "red": "no line is exactly the heading \"Alpha\" (a heading is a line that is only that text, optionally after #); no line is exactly the heading \"Beta\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Alpha\" (a heading is a line that is only that text, optionally after #)", "no line is exactly the heading \"Beta\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "sectionWords | whitespace text", "verdict": "red", "red": "no line is exactly the heading \"Alpha\" (a heading is a line that is only that text, optionally after #); no line is exactly the heading \"Beta\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Alpha\" (a heading is a line that is only that text, optionally after #)", "no line is exactly the heading \"Beta\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "sectionWords | CRLF", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | colon headings w/ trailing ws", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | indented heading", "verdict": "red", "red": "no line is exactly the heading \"Alpha\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Alpha\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "sectionWords | NBSP words", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionWords | non-object (null)", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got null", "reds": null},
  {"id": "sectionWords | non-object (array)", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got [\"x\"]", "reds": null},
  {"id": "sectionWords | string artifact", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got \"# Alpha\\nw0 w1 w2 w3 w4 w5 w6 w7 w8 w9\"", "reds": null},
  {"id": "sectionWords | text not string", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got {\"text\":42}", "reds": null},
  {"id": "sectionWords | no text key", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got {\"body\":\"x\"}", "reds": null},
  {"id": "sectionWords | heading only text Beta only", "verdict": "red", "red": "no line is exactly the heading \"Alpha\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Alpha\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "sectionOrder+maxWords | ok", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionOrder+maxWords | case differs", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionOrder+maxWords | mixed case colon", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionOrder+maxWords | missing Skills", "verdict": "red", "red": "no line is exactly the heading \"Skills\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Skills\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "sectionOrder+maxWords | missing both", "verdict": "red", "red": "no line is exactly the heading \"Summary\" (a heading is a line that is only that text, optionally after #); no line is exactly the heading \"Skills\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Summary\" (a heading is a line that is only that text, optionally after #)", "no line is exactly the heading \"Skills\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "sectionOrder+maxWords | out of order", "verdict": "red", "red": "section heading \"Skills\" is out of order", "reds": ["section heading \"Skills\" is out of order"]},
  {"id": "sectionOrder+maxWords | duplicate heading", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionOrder+maxWords | dup then order", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionOrder+maxWords | text before heading", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionOrder+maxWords | heading with extra words", "verdict": "red", "red": "no line is exactly the heading \"Summary\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Summary\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "sectionOrder+maxWords | hash words: 20 real + hashes", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionOrder+maxWords | 21 words", "verdict": "red", "red": "21 words, limit 20", "reds": ["21 words, limit 20"]},
  {"id": "sectionOrder+maxWords | 20 words exactly", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionOrder+maxWords | hash not a word: tight", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionOrder+maxWords | 1,000 numbers", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionOrder+maxWords | empty text", "verdict": "red", "red": "no line is exactly the heading \"Summary\" (a heading is a line that is only that text, optionally after #); no line is exactly the heading \"Skills\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Summary\" (a heading is a line that is only that text, optionally after #)", "no line is exactly the heading \"Skills\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "sectionOrder+maxWords | non-object", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got \"plain string\"", "reds": null},
  {"id": "sectionOrder+maxWords | non-object number", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got 5", "reds": null},
  {"id": "sectionOrder+maxWords | text null", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got {\"text\":null}", "reds": null},
  {"id": "sectionOrder+maxWords | done/blocker present (stripped)", "verdict": "green", "red": null, "reds": []},
  {"id": "sectionOrder+maxWords | indented #", "verdict": "red", "red": "no line is exactly the heading \"Summary\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Summary\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "sectionOrder+maxWords | only hashes", "verdict": "red", "red": "no line is exactly the heading \"Summary\" (a heading is a line that is only that text, optionally after #); no line is exactly the heading \"Skills\" (a heading is a line that is only that text, optionally after #)", "reds": ["no line is exactly the heading \"Summary\" (a heading is a line that is only that text, optionally after #)", "no line is exactly the heading \"Skills\" (a heading is a line that is only that text, optionally after #)"]},
  {"id": "maxWords | 5 words", "verdict": "green", "red": null, "reds": []},
  {"id": "maxWords | 6 words", "verdict": "red", "red": "6 words, limit 5", "reds": ["6 words, limit 5"]},
  {"id": "maxWords | hash not word", "verdict": "green", "red": null, "reds": []},
  {"id": "maxWords | ## not word", "verdict": "green", "red": null, "reds": []},
  {"id": "maxWords | #tag glued", "verdict": "green", "red": null, "reds": []},
  {"id": "maxWords | hash mid-line", "verdict": "green", "red": null, "reds": []},
  {"id": "maxWords | hash mid-line 6", "verdict": "red", "red": "6 words, limit 5", "reds": ["6 words, limit 5"]},
  {"id": "maxWords | empty", "verdict": "green", "red": null, "reds": []},
  {"id": "maxWords | multi hash lines", "verdict": "green", "red": null, "reds": []},
  {"id": "maxWords | 1,000 style", "verdict": "green", "red": null, "reds": []},
  {"id": "maxWords | 6 numbers", "verdict": "red", "red": "6 words, limit 5", "reds": ["6 words, limit 5"]},
  {"id": "maxWords | CRLF 6", "verdict": "red", "red": "6 words, limit 5", "reds": ["6 words, limit 5"]},
  {"id": "maxWords | tabs", "verdict": "red", "red": "6 words, limit 5", "reds": ["6 words, limit 5"]},
  {"id": "maxWords | blank lines", "verdict": "green", "red": null, "reds": []},
  {"id": "maxWords | indented hash 5", "verdict": "red", "red": "6 words, limit 5", "reds": ["6 words, limit 5"]},
  {"id": "maxWords | indented hash 4+", "verdict": "green", "red": null, "reds": []},
  {"id": "allowedKeys | text only", "verdict": "green", "red": null, "reds": []},
  {"id": "allowedKeys | extra lines", "verdict": "red", "red": "softgreen artifact has key(s) \"lines\" besides \"text\"; the check reads \"text\" only, so put the whole answer in \"text\"", "reds": ["extra key(s): lines"]},
  {"id": "allowedKeys | extra a,b order", "verdict": "red", "red": "softgreen artifact has key(s) \"a\", \"b\" besides \"text\"; the check reads \"text\" only, so put the whole answer in \"text\"", "reds": ["extra key(s): a, b"]},
  {"id": "allowedKeys | extra b,a order", "verdict": "red", "red": "softgreen artifact has key(s) \"b\", \"a\" besides \"text\"; the check reads \"text\" only, so put the whole answer in \"text\"", "reds": ["extra key(s): b, a"]},
  {"id": "allowedKeys | extra first", "verdict": "red", "red": "softgreen artifact has key(s) \"zeta\", \"alpha\" besides \"text\"; the check reads \"text\" only, so put the whole answer in \"text\"", "reds": ["extra key(s): zeta, alpha"]},
  {"id": "allowedKeys | extra only, no text", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got {\"lines\":\"x\"}", "reds": null},
  {"id": "allowedKeys | extra undefined value", "verdict": "red", "red": "softgreen artifact has key(s) \"x\" besides \"text\"; the check reads \"text\" only, so put the whole answer in \"text\"", "reds": ["extra key(s): x"]},
  {"id": "allowedKeys | done/blocker stripped", "verdict": "green", "red": null, "reds": []},
  {"id": "allowedKeys | done + extra", "verdict": "red", "red": "softgreen artifact has key(s) \"lines\" besides \"text\"; the check reads \"text\" only, so put the whole answer in \"text\"", "reds": ["extra key(s): lines"]},
  {"id": "allowedKeys | numeric-like key", "verdict": "red", "red": "softgreen artifact has key(s) \"2\", \"10\" besides \"text\"; the check reads \"text\" only, so put the whole answer in \"text\"", "reds": ["extra key(s): 2, 10"]},
  {"id": "allowedKeys | key with quote", "verdict": "red", "red": "softgreen artifact has key(s) \"a\"b\" besides \"text\"; the check reads \"text\" only, so put the whole answer in \"text\"", "reds": ["extra key(s): a\"b"]},
  {"id": "allowedKeys | empty key", "verdict": "red", "red": "softgreen artifact has key(s) \"\" besides \"text\"; the check reads \"text\" only, so put the whole answer in \"text\"", "reds": ["extra key(s): "]},
  {"id": "allowedKeys | non-object string", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got \"ok\"", "reds": null},
  {"id": "allowedKeys | null", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got null", "reds": null},
  {"id": "allowedKeys | array", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got [\"a\"]", "reds": null},
  {"id": "allowedKeys | number", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got 7", "reds": null},
  {"id": "allowedKeys | boolean", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got true", "reds": null},
  {"id": "allowedKeys | empty obj", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got {}", "reds": null},
  {"id": "allowedKeys | text non-string + extra", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got {\"text\":3,\"lines\":1}", "reds": null},
  {"id": "allowedKeys | unicode key", "verdict": "red", "red": "softgreen artifact has key(s) \"é\" besides \"text\"; the check reads \"text\" only, so put the whole answer in \"text\"", "reds": ["extra key(s): é"]},
  {"id": "blockLines+mustCarry | ok", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry | case differs", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry | mixed case", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry | carry across lines of block", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry | missing total in block 2", "verdict": "red", "red": "invoice block starting at line 3 is missing \"total\"", "reds": ["invoice block starting at line 3 is missing \"total\""]},
  {"id": "blockLines+mustCarry | missing Acme block 1", "verdict": "red", "red": "invoice block starting at line 1 is missing \"Acme\"", "reds": ["invoice block starting at line 1 is missing \"Acme\""]},
  {"id": "blockLines+mustCarry | not multiple (3 lines)", "verdict": "red", "red": "text has 3 non-empty line(s), not a multiple of linesPerInvoice 2; invoice block starting at line 3 is missing \"total\"", "reds": ["text has 3 non-empty line(s), not a multiple of linesPerInvoice 2", "invoice block starting at line 3 is missing \"total\""]},
  {"id": "blockLines+mustCarry | not multiple + missing", "verdict": "red", "red": "text has 3 non-empty line(s), not a multiple of linesPerInvoice 2; invoice block starting at line 3 is missing \"Acme\"; invoice block starting at line 3 is missing \"total\"", "reds": ["text has 3 non-empty line(s), not a multiple of linesPerInvoice 2", "invoice block starting at line 3 is missing \"Acme\"", "invoice block starting at line 3 is missing \"total\""]},
  {"id": "blockLines+mustCarry | zero lines empty", "verdict": "red", "red": "text has no non-empty lines to check against linesPerInvoice", "reds": ["text has no non-empty lines to check against linesPerInvoice"]},
  {"id": "blockLines+mustCarry | zero lines whitespace", "verdict": "red", "red": "text has no non-empty lines to check against linesPerInvoice", "reds": ["text has no non-empty lines to check against linesPerInvoice"]},
  {"id": "blockLines+mustCarry | blank lines ignored", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry | CRLF", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry | substring inside word", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry | 1,000 numbers", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry | hash lines count as lines", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry | one line", "verdict": "red", "red": "text has 1 non-empty line(s), not a multiple of linesPerInvoice 2", "reds": ["text has 1 non-empty line(s), not a multiple of linesPerInvoice 2"]},
  {"id": "blockLines+mustCarry | 5 lines", "verdict": "red", "red": "text has 5 non-empty line(s), not a multiple of linesPerInvoice 2; invoice block starting at line 5 is missing \"total\"", "reds": ["text has 5 non-empty line(s), not a multiple of linesPerInvoice 2", "invoice block starting at line 5 is missing \"total\""]},
  {"id": "blockLines+mustCarry | non-object", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got \"Acme\\ntotal\"", "reds": null},
  {"id": "blockLines+mustCarry | text not string", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got {\"text\":[\"Acme\"]}", "reds": null},
  {"id": "blockLines+mustCarry | extra key + ok", "verdict": "red", "red": "softgreen artifact has key(s) \"foo\" besides \"text\"; the check reads \"text\" only, so put the whole answer in \"text\"", "reds": ["extra key(s): foo"]},
  {"id": "blockLines+mustCarry(size1) | unicode case", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry(size1) | unicode miss", "verdict": "red", "red": "invoice block starting at line 1 is missing \"Ünï\"", "reds": ["invoice block starting at line 1 is missing \"Ünï\""]},
  {"id": "blockLines+mustCarry(size1) | ok", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry(size1) | two lines", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry(size1) | one miss of two", "verdict": "red", "red": "invoice block starting at line 2 is missing \"Ünï\"", "reds": ["invoice block starting at line 2 is missing \"Ünï\""]},
  {"id": "blockLines+mustCarry(size1) | empty", "verdict": "red", "red": "text has no non-empty lines to check against linesPerInvoice", "reds": ["text has no non-empty lines to check against linesPerInvoice"]},
  {"id": "blockLines+mustCarry(size1) | dotless I", "verdict": "red", "red": "invoice block starting at line 1 is missing \"Ünï\"", "reds": ["invoice block starting at line 1 is missing \"Ünï\""]},
  {"id": "blockLines+mustCarry(size1) | sharp s", "verdict": "red", "red": "invoice block starting at line 1 is missing \"Ünï\"", "reds": ["invoice block starting at line 1 is missing \"Ünï\""]},
  {"id": "blockLines+mustCarry(size1) | multi", "verdict": "red", "red": "invoice block starting at line 1 is missing \"Ünï\"; invoice block starting at line 2 is missing \"Ünï\"; invoice block starting at line 3 is missing \"Ünï\"", "reds": ["invoice block starting at line 1 is missing \"Ünï\"", "invoice block starting at line 2 is missing \"Ünï\"", "invoice block starting at line 3 is missing \"Ünï\""]},
  {"id": "blockLines+mustCarry(size1) | ok2", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry(size1) | hash", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry(size1) | crlf", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry(size1) | 3", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry(size1) | tab", "verdict": "green", "red": null, "reds": []},
  {"id": "blockLines+mustCarry(size1) | x", "verdict": "red", "red": "invoice block starting at line 1 is missing \"Ünï\"", "reds": ["invoice block starting at line 1 is missing \"Ünï\""]},
  {"id": "blockLines+mustCarry(size1) | non-object", "verdict": "unparseable", "red": "softgreen artifact must be an object shaped {text: string}, got null", "reds": null},
];

test('am18 parity: the table covers exactly the 142 inputs, ids unique', () => {
  assert.equal(cases.length, 142);
  assert.equal(FROZEN.length, 142);
  assert.deepEqual(cases.map((c) => `${c.pair} | ${c.label}`), FROZEN.map((f) => f.id));
  assert.equal(new Set(FROZEN.map((f) => f.id)).size, 142);
});

test('am18 parity: every input gives the SAME verdict and the SAME reds strings as before the switch', async () => {
  const diffs = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const f = FROZEN[i];
    const r = await closeSoftgreen(strip(c.input), c.shape);
    const got = { id: f.id, verdict: r.verdict, red: r.red ?? null, reds: r.reds ?? null };
    try { assert.deepEqual(got, f); } catch { diffs.push({ want: f, got }); }
  }
  assert.equal(diffs.length, 0, `${142 - diffs.length}/142 same; first diff: ${JSON.stringify(diffs[0])}`);
});
