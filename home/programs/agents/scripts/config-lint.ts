#!/usr/bin/env -S deno run --allow-read --no-prompt

// No import on purpose: the flake check (checks.config-lint) passes --no-remote, and a
// sandboxed builder cannot resolve jsr: specifiers, so the glob translation is copied
// from shell-utils.ts and the yaml reader only understands `- pattern: "<glob>"`.
// Unlike bash-policy.ts, a fence line is matched whole: no bash-AST segment split, no
// heredoc skipping, no `exclude:` support — a lint that is narrower than the hook by
// design, so `cd x && git -C y` passes here and is still blocked at run time.

const POLICY_YAML = "home/programs/claude/scripts/bash-policy.yaml";
const SKIP_DIRS = new Set([
  ".git",
  ".claude",
  ".direnv",
  "result",
  "node_modules",
]);
const FENCE_LANGS = new Set(["bash", "sh", "shell", "zsh"]);
const LITERAL_EXTENSIONS = new Set([".nix", ".yaml", ".yml", ".json"]);
const ALLOW_MARKER = "config-lint: allow";
// `path:line` entries exempt from home-literal where a line comment cannot be
// written (strict JSON). Empty until a literal has to stay.
const HOME_LITERAL_ALLOW: ReadonlySet<string> = new Set();
// `$`, `*` and `{` are outside the character class, so `/Users/$USER`, `/Users/*` and
// `/Users/${username}` fall through without a lookahead.
const HOME_LITERAL = /\/Users\/[A-Za-z0-9._-]+/;

type Finding = { path: string; line: number; rule: string; message: string };

// Same translation as shell-utils.ts globToRegex: anchored, `*` spans anything.
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    "^" + escaped.replace(/\*/g, "[\\s\\S]*").replace(/\?/g, "[\\s\\S]") + "$",
  );
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries: Deno.DirEntry[] = [];
  for await (const entry of Deno.readDir(dir)) entries.push(entry);
  // A vendored skill directory carries a `.<vendor>-source` marker; its upstream
  // fences are not ours to annotate, so the whole directory is skipped.
  if (entries.some((e) => e.isFile && /^\..*-source$/.test(e.name))) return;
  for (const entry of entries) {
    if (entry.isSymlink) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path);
    } else if (entry.isFile) {
      yield path;
    }
  }
}

function relative(root: string, path: string): string {
  return path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
}

async function loadPatterns(
  root: string,
  findings: Finding[],
): Promise<RegExp[]> {
  const path = `${root}/${POLICY_YAML}`;
  const lines = (await Deno.readTextFile(path)).split("\n");
  const patterns: RegExp[] = [];
  lines.forEach((line, i) => {
    if (!/^\s*-\s*pattern:/.test(line)) return;
    const m = line.match(/^\s*-\s*pattern:\s*"(.*)"\s*$/);
    if (m) {
      patterns.push(globToRegex(m[1]));
    } else {
      findings.push({
        path: POLICY_YAML,
        line: i + 1,
        rule: "policy-parse",
        message:
          'pattern must be written as `- pattern: "<glob>"` (double quotes)',
      });
    }
  });
  if (
    patterns.length === 0 && findings.every((f) => f.rule !== "policy-parse")
  ) {
    findings.push({
      path: POLICY_YAML,
      line: 0,
      rule: "policy-parse",
      message: "no rule found; the policy would silently pass everything",
    });
  }
  return patterns;
}

function lintFences(
  path: string,
  text: string,
  patterns: RegExp[],
  findings: Finding[],
): void {
  const lines = text.split("\n");
  let marker: string | null = null;
  let active = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (marker === null) {
      const open = trimmed.match(/^(`{3,}|~{3,})\s*(\S*)/);
      if (!open) continue;
      marker = open[1];
      const allowed = i > 0 && lines[i - 1].includes(ALLOW_MARKER);
      active = FENCE_LANGS.has(open[2]) && !allowed;
      continue;
    }
    if (trimmed.startsWith(marker) && /^(`+|~+)\s*$/.test(trimmed)) {
      marker = null;
      active = false;
      continue;
    }
    if (!active) continue;
    const command = trimmed;
    if (command === "" || command.startsWith("#")) continue;
    for (const re of patterns) {
      if (!re.test(command)) continue;
      findings.push({
        path,
        line: i + 1,
        rule: "skill-policy-conflict",
        message:
          `command matches bash-policy pattern ${re.source}; the hook would block it — fence it as text or put <!-- ${ALLOW_MARKER} --> on the line directly above the fence`,
      });
      break;
    }
  }
}

function lintHomeLiteral(
  path: string,
  text: string,
  findings: Finding[],
): void {
  text.split("\n").forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    if (!HOME_LITERAL.test(line)) return;
    if (HOME_LITERAL_ALLOW.has(`${path}:${i + 1}`)) return;
    findings.push({
      path,
      line: i + 1,
      rule: "home-literal",
      message:
        "home directory literal; use ~/, $HOME, ${config.home.homeDirectory} or mkHomeDir so both profiles work",
    });
  });
}

export async function lintRepo(root: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const patterns = await loadPatterns(root, findings);
  for await (const path of walk(root)) {
    const rel = relative(root, path);
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    const inReferences = /(^|\/)references\/[^/]+\.md$/.test(rel);
    if (
      rel.startsWith("home/programs/") && (base === "SKILL.md" || inReferences)
    ) {
      lintFences(rel, await Deno.readTextFile(path), patterns, findings);
    }
    const ext = base.slice(base.lastIndexOf("."));
    if (LITERAL_EXTENSIONS.has(ext) && !/(^|\/)fixtures?\//.test(rel)) {
      lintHomeLiteral(rel, await Deno.readTextFile(path), findings);
    }
  }
  return findings.sort((a, b) =>
    a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)
  );
}

if (import.meta.main) {
  const root = (Deno.args[0] ?? ".").replace(/\/+$/, "");
  if (root === "") {
    console.error("config-lint: the repository root cannot be /");
    Deno.exit(2);
  }
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(root);
    await Deno.stat(`${root}/${POLICY_YAML}`);
  } catch (e) {
    console.error(`config-lint: cannot read ${root}: ${(e as Error).message}`);
    Deno.exit(2);
  }
  if (!stat.isDirectory) {
    console.error(`config-lint: ${root} is not a directory`);
    Deno.exit(2);
  }
  const findings = await lintRepo(root);
  for (const f of findings) {
    console.log(`${f.path}:${f.line}:[error] ${f.rule}: ${f.message}`);
  }
  console.log(`${findings.length} errors`);
  Deno.exit(findings.length > 0 ? 1 : 0);
}
