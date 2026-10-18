# TypeScript review card
Trigger: `.ts` `.tsx` `.mts` `.cts` among the changed files.
Scope: language-level checks for `code-reviewer`. Injection and secrets belong to `security-auditor`; React to the react card; a11y to the a11y card.

## Check
**Runtime boundary**
- `JSON.parse(...) as T`, `await res.json() as T`, `structured_output` or env / argv read and then cast: external data trusted at compile time only. Expect a runtime guard (zod, a hand-written check) or a reason it is internal.
- `as unknown as T` chains and `as any` on an exported signature.
**Async and shared state**
- A read-modify-write of a shared file or store outside the lock the rest of the module uses (`withStateLock` and friends); a write that lands once at the end and drops concurrent writes.
- Missing `await` in a condition or a hot path; a fire-and-forget promise with no `.catch`; `Promise.all` where one rejection should not drop the rest.
- A stale result overwriting newer state: an async answer applied without checking it is still the latest.
- An id or key truncated for display reused as a storage key (`sessionId.slice(0, 8)`): collisions across sources.
**Types and structure**
- The same type or constant defined in two places (a zod schema and a hand-written type, a tab list and its union) instead of derived from one source.
- A `switch` over a discriminated union with no exhaustive `never` branch; `?.` chains hiding a nullability the type could carry.
- `import type` missing for a type-only import; side effects at module top level.
**Tests**
- A spy, `process.env`, `HOME`, cwd or temp dir changed and not restored in `finally`; setup outside the `try` that owns the cleanup.
- An assertion that passes on the old code too (vacuous), or a test whose name promises a behavior the body does not observe.

## Do not flag
- `as any` or loose types inside `*_test.ts` / `*.test.ts` mocks: downgrade type-looseness findings there one level; the Tests items above keep their severity.
- A cast at a typed library boundary with an explanatory comment, or a `// @ts-expect-error` with a reason.
- Issues already in the baseline: report as NIT only, since only what this diff introduces may block.
