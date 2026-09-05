import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const SCRIPT = new URL("./rebase-guard.ts", import.meta.url).pathname;
const WIP_SUBJECT = "wip: auto-commit before rebase";

type Outcome = { code: number; stdout: string; stderr: string };

// The user's global gitconfig must not leak into the fixtures (hooks path,
// gpg signing, rebase defaults), so every git call gets an empty global
// config and GIT_EDITOR=true for `rebase --continue`.
function gitEnv(root: string): Record<string, string> {
  return {
    GIT_CONFIG_GLOBAL: `${root}/gitconfig`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_EDITOR: "true",
  };
}

async function run(
  cwd: string,
  root: string,
  cmd: string,
  args: string[],
): Promise<Outcome> {
  const out = await new Deno.Command(cmd, {
    args,
    cwd,
    env: gitEnv(root),
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

async function git(
  cwd: string,
  root: string,
  ...args: string[]
): Promise<string> {
  const out = await run(cwd, root, "git", args);
  if (out.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${out.stderr}`);
  }
  return out.stdout.trim();
}

function verify(cwd: string, root: string, sha: string): Promise<Outcome> {
  return run(cwd, root, Deno.execPath(), [
    "run",
    "--allow-read",
    "--allow-run=git",
    SCRIPT,
    "verify",
    sha,
  ]);
}

type Fixture = { root: string; a: string; b: string };

const TRACKED_LINES = Array.from({ length: 30 }, (_, i) => `l${i + 1}`);

async function write(path: string, content: string): Promise<void> {
  await Deno.writeTextFile(path, content);
}

function tracked(edits: Record<number, string> = {}): string {
  return TRACKED_LINES.map((l, i) => edits[i + 1] ?? l).join("\n") + "\n";
}

async function configureUser(dir: string, root: string): Promise<void> {
  await git(dir, root, "config", "user.name", "Test");
  await git(dir, root, "config", "user.email", "test@example.com");
  await git(dir, root, "config", "commit.gpgsign", "false");
}

async function makeFixture(): Promise<Fixture> {
  const root = await Deno.makeTempDir({ prefix: "rebase-guard-test-" });
  await write(`${root}/gitconfig`, "");
  await git(
    root,
    root,
    "init",
    "--bare",
    "--initial-branch=main",
    "origin.git",
  );
  await git(root, root, "clone", "-q", `${root}/origin.git`, "a");
  const a = `${root}/a`;
  await configureUser(a, root);
  await git(a, root, "checkout", "-q", "-b", "main");
  await write(`${a}/tracked.txt`, tracked());
  await write(`${a}/other.txt`, "other\n");
  await write(`${a}/todelete.txt`, "del1\ndel2\n");
  await write(`${a}/staged.txt`, "sA\nsB\n");
  await write(`${a}/modeonly.txt`, "mode\n");
  await Deno.mkdir(`${a}/sub`);
  await write(`${a}/sub/inner.txt`, "inner\n");
  await git(a, root, "add", "-A");
  await git(a, root, "commit", "-q", "-m", "init");
  await git(a, root, "push", "-q", "-u", "origin", "main");
  await git(root, root, "clone", "-q", `${root}/origin.git`, "b");
  const b = `${root}/b`;
  await configureUser(b, root);
  await git(a, root, "checkout", "-q", "-b", "feature");
  await write(`${a}/feat.txt`, "feature\n");
  await git(a, root, "add", "-A");
  await git(a, root, "commit", "-q", "-m", "feature commit");
  return { root, a, b };
}

async function withFixture(
  body: (f: Fixture) => Promise<void>,
): Promise<void> {
  const f = await makeFixture();
  try {
    await body(f);
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
}

async function advanceBase(
  f: Fixture,
  mutate: (b: string) => Promise<void>,
): Promise<void> {
  await mutate(f.b);
  await git(f.b, f.root, "add", "-A");
  await git(f.b, f.root, "commit", "-q", "-m", "base moves");
  await git(f.b, f.root, "push", "-q", "origin", "main");
}

async function wipCommit(f: Fixture): Promise<string> {
  await git(f.a, f.root, "add", "-A");
  await git(f.a, f.root, "commit", "-q", "--no-verify", "-m", WIP_SUBJECT);
  return await git(f.a, f.root, "rev-parse", "HEAD");
}

async function rebase(f: Fixture): Promise<Outcome> {
  await git(f.a, f.root, "fetch", "-q", "origin");
  return await run(f.a, f.root, "git", ["rebase", "origin/main"]);
}

async function headSubject(f: Fixture): Promise<string> {
  return await git(f.a, f.root, "log", "-1", "--format=%s");
}

async function unwindWip(f: Fixture): Promise<void> {
  assertEquals(await headSubject(f), WIP_SUBJECT);
  await git(f.a, f.root, "reset", "-q", "--mixed", "HEAD~1");
}

async function standardRoundTrip(f: Fixture): Promise<string> {
  await write(`${f.a}/tracked.txt`, tracked({ 3: "l3-USER" }));
  await write(`${f.a}/newfile.txt`, "new1\nnew2\n");
  await write(`${f.a}/staged.txt`, "sA\nsB-STAGED\n");
  await git(f.a, f.root, "add", "staged.txt");
  await Deno.remove(`${f.a}/todelete.txt`);
  await write(`${f.a}/日本語ファイル.txt`, "日本語\n");
  const wip = await wipCommit(f);
  await advanceBase(f, async (b) => {
    await write(`${b}/other.txt`, "other\nmore\n");
    await write(`${b}/tracked.txt`, tracked({ 25: "l25-BASE" }));
  });
  const r = await rebase(f);
  assertEquals(r.code, 0, r.stderr);
  await unwindWip(f);
  return wip;
}

Deno.test("verify: all five change kinds are PRESENT after a clean round trip", () =>
  withFixture(async (f) => {
    const wip = await standardRoundTrip(f);
    const out = await verify(f.a, f.root, wip);
    assertEquals(out.code, 0, out.stdout + out.stderr);
    for (
      const p of [
        "tracked.txt",
        "newfile.txt",
        "staged.txt",
        "todelete.txt",
        "日本語ファイル.txt",
      ]
    ) {
      assertStringIncludes(out.stdout, `rebase-guard: PRESENT ${p}\n`);
    }
    assertStringIncludes(
      out.stdout,
      "rebase-guard: OK (5 present, 0 already in HEAD)",
    );
  }));

Deno.test("verify: a deleted untracked file is LOST", () =>
  withFixture(async (f) => {
    const wip = await standardRoundTrip(f);
    await Deno.remove(`${f.a}/newfile.txt`);
    const out = await verify(f.a, f.root, wip);
    assertEquals(out.code, 1, out.stdout + out.stderr);
    assertStringIncludes(out.stdout, "rebase-guard: LOST newfile.txt\n");
    assertStringIncludes(out.stdout, "could not confirm 1 file(s)");
  }));

Deno.test("verify: a WIP skipped as already applied reports IN_HEAD without reset", () =>
  withFixture(async (f) => {
    await write(`${f.a}/tracked.txt`, tracked({ 3: "l3-SAME" }));
    const wip = await wipCommit(f);
    await advanceBase(f, async (b) => {
      await write(`${b}/tracked.txt`, tracked({ 3: "l3-SAME" }));
    });
    const r = await rebase(f);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stderr, "skipped previously applied commit");
    assert((await headSubject(f)) !== WIP_SUBJECT);
    const out = await verify(f.a, f.root, wip);
    assertEquals(out.code, 0, out.stdout + out.stderr);
    assertStringIncludes(out.stdout, "rebase-guard: IN_HEAD tracked.txt\n");
    assertStringIncludes(
      out.stdout,
      "rebase-guard: OK (0 present, 1 already in HEAD)",
    );
  }));

Deno.test("verify: a non-WIP or unknown sha exits 2", () =>
  withFixture(async (f) => {
    const head = await git(f.a, f.root, "rev-parse", "HEAD");
    const notWip = await verify(f.a, f.root, head);
    assertEquals(notWip.code, 2);
    assertStringIncludes(notWip.stderr, "is not a WIP commit");
    const unknown = await verify(
      f.a,
      f.root,
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    );
    assertEquals(unknown.code, 2);
    assertStringIncludes(unknown.stderr, "is not a commit");
    const notHex = await verify(f.a, f.root, "HEAD");
    assertEquals(notHex.code, 2);
    assertStringIncludes(notHex.stderr, "usage:");
  }));

Deno.test("verify: binary and mode changes are PRESENT, and their loss is LOST", () =>
  withFixture(async (f) => {
    const blob = new Uint8Array([0, 1, 2, 255, 254]);
    await Deno.writeFile(`${f.a}/bin.dat`, blob);
    await Deno.chmod(`${f.a}/modeonly.txt`, 0o755);
    const wip = await wipCommit(f);
    await advanceBase(f, async (b) => {
      await write(`${b}/other.txt`, "other\nmore\n");
    });
    const r = await rebase(f);
    assertEquals(r.code, 0, r.stderr);
    await unwindWip(f);

    const ok = await verify(f.a, f.root, wip);
    assertEquals(ok.code, 0, ok.stdout + ok.stderr);
    assertStringIncludes(ok.stdout, "rebase-guard: PRESENT bin.dat\n");
    assertStringIncludes(ok.stdout, "rebase-guard: PRESENT modeonly.txt\n");

    await Deno.remove(`${f.a}/bin.dat`);
    const noBlob = await verify(f.a, f.root, wip);
    assertEquals(noBlob.code, 1, noBlob.stdout + noBlob.stderr);
    assertStringIncludes(noBlob.stdout, "rebase-guard: LOST bin.dat\n");

    await Deno.writeFile(`${f.a}/bin.dat`, blob);
    await Deno.chmod(`${f.a}/modeonly.txt`, 0o644);
    const noMode = await verify(f.a, f.root, wip);
    assertEquals(noMode.code, 1, noMode.stdout + noMode.stderr);
    assertStringIncludes(noMode.stdout, "rebase-guard: LOST modeonly.txt\n");
    assertStringIncludes(noMode.stdout, "rebase-guard: PRESENT bin.dat\n");
  }));

async function conflictingRebase(f: Fixture): Promise<string> {
  await write(`${f.a}/tracked.txt`, tracked({ 3: "l3-USER" }));
  await write(`${f.a}/newfile.txt`, "new1\n");
  const wip = await wipCommit(f);
  await advanceBase(f, async (b) => {
    await write(`${b}/tracked.txt`, tracked({ 3: "l3-BASE" }));
  });
  const r = await rebase(f);
  assertEquals(r.code, 1);
  return wip;
}

Deno.test("verify: exits 2 while a rebase is stopped on a conflict", () =>
  withFixture(async (f) => {
    const wip = await conflictingRebase(f);
    const out = await verify(f.a, f.root, wip);
    assertEquals(out.code, 2, out.stdout + out.stderr);
    assertStringIncludes(out.stderr, "rebase in progress");
    await git(f.a, f.root, "rebase", "--abort");
    assertEquals(await headSubject(f), WIP_SUBJECT);
  }));

Deno.test("verify: a conflict resolved by taking the base side is UNCONFIRMED", () =>
  withFixture(async (f) => {
    const wip = await conflictingRebase(f);
    await write(`${f.a}/tracked.txt`, tracked({ 3: "l3-BASE" }));
    await git(f.a, f.root, "add", "tracked.txt");
    await git(f.a, f.root, "rebase", "--continue");
    await unwindWip(f);
    const out = await verify(f.a, f.root, wip);
    assertEquals(out.code, 1, out.stdout + out.stderr);
    assertStringIncludes(
      out.stdout,
      "rebase-guard: UNCONFIRMED tracked.txt (patch does not reverse-apply",
    );
    assertStringIncludes(out.stdout, "rebase-guard: PRESENT newfile.txt\n");
  }));

Deno.test("verify: works from a subdirectory of the repository", () =>
  withFixture(async (f) => {
    const wip = await standardRoundTrip(f);
    const out = await verify(`${f.a}/sub`, f.root, wip);
    assertEquals(out.code, 0, out.stdout + out.stderr);
    assertStringIncludes(
      out.stdout,
      "rebase-guard: OK (5 present, 0 already in HEAD)",
    );
  }));
