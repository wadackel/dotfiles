#!/usr/bin/env -S deno run --allow-read --allow-run=git

// Checks that the changes parked in a WIP commit by the rebase skill are still
// in the working tree after the rebase was unwound.
//
// Usage:
//   rebase-guard.ts verify <wip-sha>
//
// Exit 0: every file of the WIP commit is PRESENT (or already IN_HEAD).
// Exit 1: at least one file is LOST or UNCONFIRMED.
// Exit 2: the guard could not run (bad sha, not a WIP commit, rebase in
//         progress, or an internal git failure) — never reported as a loss.
//
// The verdict comes from `git apply --reverse --check` of the per-file patch
// against the working tree rather than from comparing +/- line sets: a line
// that also exists elsewhere in the file would make a lost hunk look absorbed,
// and the reverse-apply demands the surrounding context too.

const WIP_SUBJECT = "wip: auto-commit before rebase";

type GitResult = { code: number; stdout: Uint8Array; stderr: string };

async function git(
  cwd: string,
  args: string[],
  stdin?: Uint8Array,
): Promise<GitResult> {
  // The LOST/PRESENT split reads git's English messages, so a translated locale
  // would turn a dropped mode into a false PRESENT.
  const cmd = new Deno.Command("git", {
    args,
    cwd,
    env: { LC_ALL: "C" },
    stdin: stdin ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  // Start draining stdout before writing stdin: a child that fills its pipe
  // buffer while we are still writing would deadlock the write.
  const output = child.output();
  if (stdin) {
    const writer = child.stdin.getWriter();
    await writer.write(stdin);
    await writer.close();
  }
  const out = await output;
  return {
    code: out.code,
    stdout: out.stdout,
    stderr: new TextDecoder().decode(out.stderr),
  };
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

function fail(message: string): never {
  console.error(`rebase-guard: ${message}`);
  Deno.exit(2);
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

type State = "PRESENT" | "IN_HEAD" | "LOST" | "UNCONFIRMED";

async function classify(
  top: string,
  wip: string,
  path: string,
): Promise<State> {
  const spec = `:(top,literal)${path}`;
  const patch = await git(top, [
    "diff",
    "--binary",
    "--no-renames",
    "--no-textconv",
    "--no-ext-diff",
    `${wip}~1`,
    wip,
    "--",
    spec,
  ]);
  if (patch.code !== 0) fail(`git diff failed for ${path}: ${patch.stderr}`);
  if (patch.stdout.length === 0) fail(`empty patch for ${path}`);

  const apply = await git(
    top,
    ["apply", "--reverse", "--check"],
    patch.stdout,
  );
  if (apply.code === 0) {
    // git only warns on a mode mismatch, so a dropped chmod would otherwise
    // pass as present.
    if (apply.stderr.includes("has type")) return "LOST";
    const clean = await git(top, ["diff", "--quiet", "HEAD", "--", spec]);
    const untracked = await git(top, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      spec,
    ]);
    return clean.code === 0 && untracked.stdout.length === 0
      ? "IN_HEAD"
      : "PRESENT";
  }
  if (apply.code === 1) {
    return apply.stderr.includes("No such file or directory")
      ? "LOST"
      : "UNCONFIRMED";
  }
  return fail(`git apply failed for ${path}: ${apply.stderr}`);
}

async function verify(wip: string): Promise<number> {
  const topResult = await git(Deno.cwd(), ["rev-parse", "--show-toplevel"]);
  if (topResult.code !== 0) fail("not inside a git repository");
  // Pathspecs are cwd-relative while --name-status prints root-relative
  // paths, so every git call runs from the toplevel.
  const top = text(topResult.stdout);

  const commit = await git(top, ["cat-file", "-e", `${wip}^{commit}`]);
  if (commit.code !== 0) fail(`${wip} is not a commit`);
  const subjectResult = await git(top, ["log", "-1", "--format=%s", wip]);
  if (subjectResult.code !== 0) fail(`cannot read the subject of ${wip}`);
  const subject = text(subjectResult.stdout);
  if (subject !== WIP_SUBJECT) {
    fail(`${wip} is not a WIP commit (subject: ${subject})`);
  }
  // In a linked worktree `.git` is a file, so the rebase state lives under
  // the main repository; --git-path with absolute output resolves both.
  const gitPathsResult = await git(top, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "rebase-merge",
    "--git-path",
    "rebase-apply",
  ]);
  if (gitPathsResult.code !== 0) fail("cannot resolve the rebase state path");
  const gitPaths = text(gitPathsResult.stdout).split("\n");
  for (const p of gitPaths) {
    if (await exists(p)) fail(`rebase in progress (${p} exists)`);
  }

  // -z keeps non-ASCII paths unquoted (core.quotePath would C-escape them).
  const listing = await git(top, [
    "diff",
    "--name-status",
    "-z",
    "--no-renames",
    `${wip}~1`,
    wip,
  ]);
  if (listing.code !== 0) {
    fail(`git diff --name-status failed: ${listing.stderr}`);
  }
  const fields = new TextDecoder().decode(listing.stdout).split("\0").filter((
    f,
  ) => f.length > 0);
  const paths: string[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) paths.push(fields[i + 1]);
  if (paths.length === 0) fail(`${wip} changes no files`);

  const counts: Record<State, number> = {
    PRESENT: 0,
    IN_HEAD: 0,
    LOST: 0,
    UNCONFIRMED: 0,
  };
  const bad: string[] = [];
  for (const path of paths) {
    const state = await classify(top, wip, path);
    counts[state] += 1;
    if (state === "UNCONFIRMED") {
      console.log(
        `rebase-guard: UNCONFIRMED ${path} (patch does not reverse-apply; inspect: git show ${wip} -- ${path})`,
      );
    } else {
      console.log(`rebase-guard: ${state} ${path}`);
    }
    if (state === "LOST" || state === "UNCONFIRMED") bad.push(path);
  }
  if (bad.length === 0) {
    console.log(
      `rebase-guard: OK (${counts.PRESENT} present, ${counts.IN_HEAD} already in HEAD)`,
    );
    return 0;
  }
  console.log(
    `rebase-guard: could not confirm ${bad.length} file(s); recover with: git show ${wip} -- <path>`,
  );
  return 1;
}

if (import.meta.main) {
  const [command, sha] = Deno.args;
  if (command !== "verify" || !sha || !/^[0-9a-f]{4,64}$/i.test(sha)) {
    fail("usage: rebase-guard.ts verify <wip-sha> (hex object id)");
  }
  // An unexpected exception must not fall through to Deno's default exit 1,
  // which the rebase skill reads as "changes could not be confirmed".
  try {
    Deno.exit(await verify(sha));
  } catch (e) {
    fail(`internal failure: ${e instanceof Error ? e.message : String(e)}`);
  }
}
