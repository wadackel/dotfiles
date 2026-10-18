# Deno review card
Trigger: a `Deno.` API, a `deno.json` / `deno.jsonc`, or a `jsr:` specifier among the changed lines.
Scope: Deno runtime behavior for `code-reviewer`. Language-level TypeScript checks are the typescript card. This repository moved its own scripts to Bun; the card applies to Deno code still in a reviewed repository.

## Check
**Permissions**
- Flags in the shebang or invocation are the smallest set the code uses: `--allow-write=/path`, `--allow-net=host`, `--allow-env=VAR` over bare flags; no `--allow-all` without a stated reason.
- A flag no code path uses (`--allow-run=claude` with no spawn, `--allow-env` for a variable never read); a flag a test passes that makes it pass on the old code too.
- A permission the code needs but the flags omit (`Deno.realPath` needs read): a crash at the first run outside tests.
**Child processes and errors**
- `stderr: "null"` on a `Deno.Command`, `.catch(() => {})`, or a failure mapped to `null` without reading stderr: a failure becomes a wrong answer with no diagnosis.
- SIGTERM sent to a child does not reach its grandchildren; a shell wrapper or `bun` / `node` launcher needs its own handling.
- Unknown CLI arguments silently ignored.
**Runtime APIs**
- `Deno.realPath` / `Deno.stat` throw on a missing path; `Deno.env.get` returns `undefined`, never `""`.
- Stdin read with `new Response(Deno.stdin.readable).text()`, parsed after the whole body; a hook payload's schema checked before fields are used.
- Imports pinned (`jsr:@std/...@version`, not a floating `std/` URL).
**Tests**
- Setup outside the `try` whose `finally` restores it; `HOME`, cwd or env changed and not restored.
- Temp dirs scoped (`--allow-write=/tmp`, `Deno.makeTempDir({ dir })`).

## Do not flag
- A broad flag with a comment naming why the narrow form does not work.
- Deprecated std paths in code the diff does not touch: NIT only.
