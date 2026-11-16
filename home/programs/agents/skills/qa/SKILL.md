---
name: qa
description: Checks that a change just made actually works by running it where it runs (the app, CLI, hook, or device) and reports pass, fail, and open questions with the evidence observed. Use after implementing or fixing something, or when asked to verify or QA a change.
argument-hint: "[what changed, how to run it, what to watch]"
---

# QA

Show, by running the changed thing where it runs, whether it does what it should, and say plainly what was not shown. The person reading the result decides from it hours later; a pass they cannot trust costs more than an honest "not tested".

## Aim the checks

- Work out what changed from the request and from the repository (`git status`, recent commits, the diff), and what it should do from the spec it answers to: the README, docs, the issue or plan, tests that pin behavior, the previous behavior. Expected results come from those, never from what the code happens to do.
- Aim where this change can break: each new or changed behavior; each documented input rule at and just past its limit, broken one at a time while every other rule holds; the states a flow moves through (edit then cancel, delete while filtered, reload); what worked before and must still work. When the old behavior is the oracle, run the previous commit beside the new one and compare.
- Size the work to the risk: a copy change needs one look, a new flow needs its paths and edges.
- When asked only what to test, return the checks with their expected results and stop.

## Run it for real

- Drive the product with what the repository already provides (its e2e suite, dev scripts, emulator setup, a skill that launches it). For a web page with nothing better, use the **agent-browser** skill.
- Test the instance the request points to (the running server, the device). Change data only where it is disposable: a scratch copy, a temporary directory or HOME, a test account; remove what you added to a shared instance. Past runs wrote into the user's own notes while testing. When a check can only run against real data or a shared account, skip it and say what it would need.
- Close what you opened (browser sessions, servers you started) before you finish.
- Put a timeout on everything you wait for: servers, emulators, background jobs, page waits. A past run waited four hours on a dead connection.
- Pass a check only on what you observed after the action: read the screenshot, the response, the file, the exit code. A value read from the DOM or the code is not an observation of what the user sees. Anything unexpected on screen (an error message, a stale number) fails the check even when the value you were looking for is right.
- Try each interaction the way it gets misused once: repeat it fast, cancel halfway, reload, go back.
- Every tool call re-reads the whole conversation, so in a long session batch commands into one script and read only the images you need to judge.

## Judge

- **Fail**: observed behavior contradicts the spec or the previous behavior. Reading the code tells you where to look; it never decides a pass or a fail on its own.
- **Question**: behavior that looks wrong where nothing written or previous decides it. Report it for the user to decide instead of counting it as a fail.
- **Not tested**: what you did not run, why, and what it would take.
- When something fails strangely, suspect the setup first (a stale build, the wrong port, leftover state), then retest.

## Report

Write the report to `<repo root>/.wadackel/qa/<YYYY-MM-DD_HH-MM>[_slug]/report.md`, with screenshots under `screenshots/` beside it and linked by relative path (`.wadackel/` is ignored globally). Shell variables do not survive between Bash calls, so carry the literal path.

The report holds: one result line (passed / failed / questions / not tested), how it was run (commands, mode, data), each failure with expected, actual, evidence (embedded screenshot or output), and likely cause, the questions, and what was not tested.

In chat, give only the digest: the result line, one line per failure and per question, what was not tested, and the report path. Do not repeat the report.

When the request is open-ended bug hunting with no particular change to check, say that `/exploratory-testing` exists for that (the user starts it), and check what you can of the recent changes.
