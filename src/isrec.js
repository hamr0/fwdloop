// one owner for the plain-object predicate (fwd's own files; borrowed copies keep theirs)
export const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
