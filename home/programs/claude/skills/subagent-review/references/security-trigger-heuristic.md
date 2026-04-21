# Security Reviewer Dispatch Heuristic

`/subagent-review` Step 7 reads this file to decide whether to dispatch the `security-auditor` agent.

The heuristic is intentionally **lenient** (over-trigger is cheap; under-trigger ships a vulnerability). When in doubt, dispatch.

## Trigger Conditions

`/subagent-review` runs `security-auditor` when ANY of the following match the diff (`git diff <baseline_sha>..HEAD`):

### A. Path heuristics

A changed file path matches any of:

```
scripts/
hooks/
auth/ | authn/ | authz/
session/
cookie/
credential | credentials
secret | secrets
token | jwt
api/
webhook
oauth | sso
crypto | encrypt | decrypt
```

Match is case-insensitive substring on the full path. Examples that trigger:
- `home/programs/claude/scripts/plan-gate.ts`
- `src/auth/login.ts`
- `.github/workflows/oauth.yml`

### B. Content patterns in changed lines

`git diff` (added or removed lines, but only within changed files) contains any of:

```
child_process | spawn | execFile | execSync | execFileSync
exec(  | eval(
new Function(
SELECT .* FROM | INSERT INTO | UPDATE .* SET | DELETE FROM
\.query\(  | \.exec\(  | \.run\(
password | passwd | passphrase
process\.env\.[A-Z_]+
api[_-]?key | secret[_-]?key | access[_-]?token
os/exec  // Go
exec\.Command  // Go
unsafe\b  // Rust
\.unwrap\(\)  // Rust (warn level only)
fetch\([^)]*\$\{  // template-literal URL — likely user input
http\.(Get|Post)\(.*\+  // string concat URL — potential SSRF
```

Match is case-sensitive regex on diff hunks (lines starting with `+` or `-`).

### C. Configuration file changes

A changed file is one of:

```
settings.json
.claude/**
**/permissions.allow*
**/auth*.config*
**/cors*.config*
.env*  (warn even if intentional)
**/secrets*.{yml,yaml,json,toml}
```

These are sensitive surfaces — an inappropriate `Bash(*)` permission rule or a leaked `.env` is a real incident.

## Dispatch Implementation

`/subagent-review` Step 7 should run a single bash check (Grep tool can also do this):

```bash
DISPATCH=0
DIFF_FILES=$(git diff --name-only "${BASELINE_SHA}..HEAD")
DIFF_HUNKS=$(git diff "${BASELINE_SHA}..HEAD" -- $DIFF_FILES)

# A. Path heuristic
if printf '%s\n' "$DIFF_FILES" | rg -qi 'scripts/|hooks/|auth|session|cookie|credential|secret|token|api/|webhook|oauth|sso|crypto|encrypt|decrypt'; then
  DISPATCH=1
fi

# B. Content pattern
if printf '%s' "$DIFF_HUNKS" | rg -q 'child_process|spawn|execFile|exec\(|eval\(|new Function\(|SELECT .* FROM|INSERT INTO|UPDATE .* SET|DELETE FROM|password|process\.env\.[A-Z_]+|api[_-]?key|secret[_-]?key|access[_-]?token|os/exec|exec\.Command|fetch\([^)]*\$\{|http\.(Get|Post)\(.*\+'; then
  DISPATCH=1
fi

# C. Configuration files
if printf '%s\n' "$DIFF_FILES" | rg -q '^settings\.json$|^\.claude/|^\.env|permissions\.allow|secrets?\.(yml|yaml|json|toml)$'; then
  DISPATCH=1
fi

if [ "$DISPATCH" = "1" ]; then
  # Launch security-auditor agent (subagent_type: security-auditor)
  echo "DISPATCH security-auditor"
fi
```

## Anti-Patterns

- **Skipping dispatch on dotfiles repo**: dotfiles change `~/.claude/scripts/` and `settings.json` constantly — these are exactly the surfaces this heuristic protects
- **Treating false positives as bugs**: if the security-auditor returns "no issues found" on a benign change, that is the *correct* outcome — the heuristic did its job by checking
- **Adding exclusions for "known safe" files**: every exclusion is a future blind spot. Prefer letting security-auditor run and quickly conclude

## Tuning

This heuristic is intentionally a starting point. After observing dispatch frequency and signal quality:
- If dispatch fires too rarely on real security-relevant changes → broaden trigger conditions here
- If `security-auditor` consistently returns "no issues" on a specific pattern → consider whether to narrow that specific trigger (with a comment explaining why)

Tune in this file, not in the SKILL.md, so the change is localized and reviewable.

## Related

- `~/.claude/agents/security-auditor.md` — the dispatched agent
- `~/.claude/skills/subagent-review/SKILL.md` Step 7 — the orchestrator
