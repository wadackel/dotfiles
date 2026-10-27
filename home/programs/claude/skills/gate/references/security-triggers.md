# Security reviewer triggers

`/gate` dispatches `security-auditor` when the added or removed lines alter permission or trust boundaries (`permissions.allow`, hooks, bash-policy), secret or credential handling, authentication or authorization, or the handling of untrusted input reaching commands, SQL, evaluation, paths, or external requests. Inspect the data flow and changed behavior; a path such as `scripts/` or a word such as `spawn` alone is not a security trigger.

Not a trigger: the Markdown part of a diff, a sink call that only moved or was renamed, tests and fixtures. When you can name the input and the sink but not whether the sink is reachable, dispatch; when you can name neither, do not.

A security re-review is full when the fix diff itself trips one of these triggers or the FAIL held a `CRITICAL`; a `HIGH`-only FAIL whose fix stays clear of them gets the diagnostic re-review like any other reviewer. `CRITICAL` / `HIGH` block; `MEDIUM` / `LOW` go to the reader as decisions.
