# Rust review card
Trigger: `.rs`, or `Cargo.toml` / a `flake.nix` that builds a crate, among the changed files.
Scope: ownership, errors, concurrency and build packaging for `code-reviewer`.

## Check
**Build and packaging**
- A Nix source filter or `include` list that drops a file the crate reads at compile time (`include_str!`, `include_bytes!`, build.rs inputs): the sandbox build fails where CI with a full checkout passes.
- A feature or target gate that leaves a code path untested on the platform CI runs.
**Errors**
- A `Result<bool>` or `unwrap_or(false)` that collapses the cause into a flag; a fixed warning string where the error carried detail.
- `unwrap()` / `expect()` in library code where the caller could handle the error; `?` with a context that names what failed.
- `anyhow` in a library's public API, `thiserror`-style typed errors in an application that never matches on them.
**Ownership and concurrency**
- `.clone()` or `.to_string()` where a borrow or `&str` suffices on a hot path; `Regex::new` or another compiled artifact rebuilt per call instead of once (`OnceLock`, `LazyLock`).
- `Rc<RefCell<T>>` / `Arc<Mutex<T>>` where a simpler ownership shape exists; a `!Send` value crossing a thread or `tokio::spawn` boundary.
- `unsafe` without a comment stating the invariant, or wider than the lines that need it; FFI types without `#[repr]`.
- Blocking or CPU-heavy work on the async reactor (`spawn_blocking`); a `JoinHandle` dropped unawaited; `select!` branches that miss an exit path.
**Tests**
- An assertion that passes on the old code (a path check that only confirms a prefix, a `!= ""`); a test that constructs the failure it then asserts away.

## Do not flag
- `unwrap()` in tests and `main()`.
- Allocation choices off the hot path; report as NIT.
- Issues already in the baseline: NIT only.
