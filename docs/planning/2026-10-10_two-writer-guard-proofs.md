# Two-writer guard proofs (2026-10-10)

Base aaa15f3b. Each guard was removed on a branch, the named test ran RED, the file was restored and the test ran green.

| Pair | Guard (file:line) | Edit made | Test title | Red line | Backend |
|---|---|---|---|---|---|
| S1 | apps/web/lib/platform/saved-projects-store.ts:320 | `const conflict = await db.transaction(async (tx) => {` -> `const conflict = await ((fn: (t: typeof db) => Promise<boolean>) => fn(db))(async (tx) => {` | two creates started together get different positions, and a repeated id conflicts once | `FAIL  lib/platform/__tests__/saved-projects-store.test.ts > SavedProjectsPersistencePort (sqlite > two creates started together get different positions, and a repeated id conflicts once` | sqlite only (postgres stayed green with the guard removed, as the source comment predicts: the pooled backend does not interleave on the one-connection seam) |
