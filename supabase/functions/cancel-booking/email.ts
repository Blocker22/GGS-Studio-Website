// The real implementation lives in ../_shared/email.ts — this is the one copy
// worth editing. Edge Functions have no shared runtime, so each deploy carries
// its own flattened copy of that file under this name; re-exporting here keeps
// the `./email.ts` import specifier identical in the repo and in production,
// with a single source of truth.
export * from "../_shared/email.ts";
