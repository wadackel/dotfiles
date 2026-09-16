# Security reviewer triggers

`/gate` dispatches `security-auditor` when any of these match the diff. Over-triggering is cheap and under-triggering ships a vulnerability, so the lists are broad; tune here, not in SKILL.md.

- **Path** (case-insensitive substring): `scripts/`, `hooks/`, `auth`, `session`, `cookie`, `credential`, `secret`, `token`, `jwt`, `api/`, `webhook`, `oauth`, `sso`, `crypto`, `encrypt`, `decrypt`.
- **Added or removed lines** (regex): `child_process|spawn|execFile|execSync|execFileSync|exec\(|eval\(|new Function\(|Deno\.Command|Deno\.run|SELECT .* FROM|INSERT INTO|UPDATE .* SET|DELETE FROM|\.query\(|\.run\(|password|passwd|passphrase|process\.env\.[A-Z_]+|api[_-]?key|secret[_-]?key|access[_-]?token|os/exec|exec\.Command|unsafe\b|\.unwrap\(\)|fetch\([^)]*\$\{|http\.(Get|Post)\(.*\+`.
- **Configuration files**: `settings.json`, `.claude/**`, `permissions.allow*`, `.env*`, `auth*.config*`, `cors*.config*`, `secrets*.{yml,yaml,json,toml}`.

Security re-reviews are always full: a security fix changes the shape of an attack surface, not one call site. `CRITICAL` / `HIGH` block; `MEDIUM` / `LOW` go to the reader as decisions. A dotfiles repository changes `~/.claude/scripts/` and `settings.json` constantly; those are exactly the surfaces this list protects, so a "known safe" exclusion is a future blind spot.
