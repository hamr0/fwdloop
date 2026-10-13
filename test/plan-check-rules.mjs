// The page gets the plain-words rules from the server (PLAN_CHECK_RULES, src/panel/server.js); a test that cuts a page function out of
// index.html defines the same variable from the same source.
import { pageRules } from '../src/plain-checks.js';

export const RULES_PRELUDE = `var PLAN_CHECK_RULES = ${JSON.stringify(pageRules())};`;
