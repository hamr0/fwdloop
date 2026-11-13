// borrowed-from: bareloop src/declaredclose.js@v0.56.0 (3383cce) (SIGNED_ROW_FIELDS only: the constant the check block names; the rest of that module (kinds, judged, ralph, validate) is not wanted here)

/** the fields of a row of the one check list that the signed close carries (`closeDecl.list`); the row's own words are never signed */
export const SIGNED_ROW_FIELDS = Object.freeze(['line', 'key', 'from', 'by', 'kind', 'state', 'rule', 'part', 'reason', 'facts']);
