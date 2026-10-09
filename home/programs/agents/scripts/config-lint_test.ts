import { test } from "bun:test";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as runCommand } from "../lib/proc.ts";

const SCRIPT = join(import.meta.dirname, "config-lint.ts");
const POLICY = 'rules:\n  - pattern: "git -C *"\n    message: "no"\n';

type Outcome = { code: number; stdout: string; stderr: string };

async function withRepo(
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "config-lint-test-"));
  try {
    const all = {
      "home/programs/claude/scripts/bash-policy.yaml": POLICY,
      ...files,
    };
    for (const [rel, body] of Object.entries(all)) {
      const path = `${root}/${rel}`;
      await mkdir(path.slice(0, path.lastIndexOf("/")), {
        recursive: true,
      });
      await writeFile(path, body);
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true });
  }
}

async function run(root: string): Promise<Outcome> {
  const out = await runCommand(SCRIPT, [root]);
  return { code: out.code, stdout: out.stdout, stderr: out.stderr };
}

const SKILL = "home/programs/agents/skills/x/SKILL.md";

test("a bash fence command matching a policy pattern is an error, in SKILL.md and references", async () => {
  await withRepo({
    [SKILL]: "# x\n\n```bash\ngit -C /tmp status\n```\n",
    "home/programs/agents/skills/x/references/how.md":
      "```sh\ngit -C . log\n```\n",
  }, async (root) => {
    const r = await run(root);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(r.stdout, `${SKILL}:4:[error] skill-policy-conflict:`);
    assertStringIncludes(
      r.stdout,
      "references/how.md:2:[error] skill-policy-conflict:",
    );
    assertStringIncludes(r.stdout, "2 errors");
  });
});

test("yaml and text fences, comments, and blank lines are not commands", async () => {
  await withRepo({
    [SKILL]:
      '```yaml\n- pattern: "git -C *"\n```\n\n```text\ngit -C x status\n```\n\n```bash\n# git -C x status\n\ngit status\n```\n',
  }, async (root) => {
    const r = await run(root);
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertStringIncludes(r.stdout, "0 errors");
  });
});

test("an allow marker on the line above the fence skips it", async () => {
  await withRepo({
    [SKILL]: "<!-- config-lint: allow -->\n```bash\ngit -C x status\n```\n",
  }, async (root) => {
    const r = await run(root);
    assertEquals(r.code, 0, r.stdout + r.stderr);
  });
});

test("a vendored skill directory with a source marker is skipped", async () => {
  await withRepo({
    "home/programs/agents/skills/v/.figma-source": "upstream: x\n",
    "home/programs/agents/skills/v/SKILL.md": "```bash\ngit -C x status\n```\n",
  }, async (root) => {
    const r = await run(root);
    assertEquals(r.code, 0, r.stdout + r.stderr);
  });
});

test("home literals are errors; templates, wildcards, allow lines, and fixtures pass", async () => {
  await withRepo({
    "home/programs/claude/settings.json": [
      '{"a": "Read(//Users/alice/Documents/**)",',
      ' "b": "Bash(dscl . -read /Users/alice GeneratedUID)",',
      ' "c": "Bash(rm -rf /Users/*)",',
      ' "d": "/Users/$USER/x",',
      ' "e": "/Users/${username}/x"}',
    ].join("\n"),
    "darwin/x.nix": "# /Users/alice/x  config-lint: allow\n",
    "home/programs/x/fixtures/f.json": '{"p": "/Users/alice"}',
  }, async (root) => {
    const r = await run(root);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(
      r.stdout,
      "home/programs/claude/settings.json:1:[error] home-literal:",
    );
    assertStringIncludes(
      r.stdout,
      "home/programs/claude/settings.json:2:[error] home-literal:",
    );
    assertStringIncludes(r.stdout, "2 errors");
  });
});

test("a single-quoted pattern is a policy-parse error", async () => {
  await withRepo({
    "home/programs/claude/scripts/bash-policy.yaml":
      "rules:\n  - pattern: 'git -C *'\n    message: no\n",
  }, async (root) => {
    const r = await run(root);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(r.stdout, "bash-policy.yaml:2:[error] policy-parse:");
  });
});

test("a policy with no rule is a policy-parse error", async () => {
  await withRepo({
    "home/programs/claude/scripts/bash-policy.yaml": "rules: []\n",
  }, async (root) => {
    const r = await run(root);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(
      r.stdout,
      "bash-policy.yaml:0:[error] policy-parse: no rule found",
    );
  });
});

test("symlinks are not followed", async () => {
  await withRepo({
    "outside/skills/y/SKILL.md": "```bash\ngit -C x status\n```\n",
  }, async (root) => {
    await mkdir(`${root}/home/programs/claude/skills`, {
      recursive: true,
    });
    await symlink(
      `${root}/outside/skills/y`,
      `${root}/home/programs/claude/skills/y`,
    );
    const r = await run(root);
    assertEquals(r.code, 0, r.stdout + r.stderr);
  });
});

test("the script imports only node: modules so it runs without node_modules", async () => {
  const src = await readFile(SCRIPT, "utf8");
  const specifiers = [
    ...src.matchAll(/^import\s[^;]*?from\s+"([^"]+)";$/gm),
    ...src.matchAll(/^import\s+"([^"]+)";$/gm),
    ...src.matchAll(/\bimport\(\s*"([^"]+)"/g),
  ].map((m) => m[1]);
  assert(specifiers.length > 0, "the import scan found nothing");
  for (const specifier of specifiers) {
    assert(
      specifier.startsWith("node:"),
      `config-lint.ts must import only node: modules, found ${specifier}`,
    );
  }
  assertEquals(src.match(/^import\b/gm)?.length, specifiers.length);
});
