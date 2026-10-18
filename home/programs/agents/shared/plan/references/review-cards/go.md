# Go review card
Trigger: `.go` among the changed files.
Scope: idiomatic correctness for `code-reviewer`: goroutines, context, errors, interfaces, nil values.

## Check
**Goroutines and context**
- Every goroutine has an exit path: a context cancellation or a channel that is closed; a goroutine blocked on a channel nobody closes is a leak.
- `context.Context` passed as the first argument down the call chain; `context.Background()` / `TODO()` only at entry points; `ctx.Done()` checked in long loops.
- No goroutine started while holding a lock; `defer mu.Unlock()` in the function that locked; lock order consistent across paths.
**Errors**
- Wrapping with `fmt.Errorf("...: %w", err)` (not `%v`); callers use `errors.Is` / `errors.As`.
- `_ = err` without a stated reason; `panic` for a condition user input can cause.
- Sentinel errors vs error types chosen for how callers branch.
**Data and channels**
- Writes to a nil map; slices pre-sized with `make([]T, 0, n)` when `n` is known.
- Map iteration order assumed; range variable captured by a closure on Go < 1.22.
- Channel direction in signatures (`chan<-`, `<-chan`); close on the sending side only; `range` over a channel that is never closed.
**Interfaces**
- Interfaces defined on the consumer side (accept an interface, return a struct); a single-implementation interface that adds nothing; `any` where a concrete type fits.

## Do not flag
- Style the formatter already settles; `gofmt` output is not a finding.
- Pre-existing patterns the diff only touches: NIT only.
