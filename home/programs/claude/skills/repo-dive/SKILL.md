---
name: repo-dive
description: |
  Clone a GitHub repository to a temporary directory for efficient local code exploration.
  Avoids GitHub API rate limits by using local file tools (Read, Grep, Glob, Agent) instead of
  repeated `gh` API calls. Use when a user provides a GitHub repository URL and asks to
  investigate, analyze, explore, or review the codebase. Triggers include: "investigate this repo",
  "analyze this codebase", "explore this repository", "review this code", "このリポジトリを調査して",
  "コードを見て", "リポジトリを確認して", or when a GitHub repo URL is shared with an exploration intent.
argument-hint: "<repo-url> [branch-or-pr]"
---

# Repo Dive

Clone a GitHub repository locally for efficient code exploration using Claude's native file tools.

## Quick Start

```
/repo-dive https://github.com/owner/repo
/repo-dive https://github.com/owner/repo feature-branch
/repo-dive https://github.com/owner/repo/pull/123
```

## Argument Parsing

Parse `$ARGUMENTS` to extract:

- **Repo URL**: `https://github.com/owner/repo` or `owner/repo`
- **Optional target** (second argument or embedded in URL):
  - Branch name: `main`, `feature/xyz`
  - PR URL: `https://github.com/owner/repo/pull/123`
  - PR shorthand: `#123`

If `$ARGUMENTS` is empty, ask the user for the repository URL.

## Workflow

### Step 1: Clone

Clone to `/tmp/repo-dive/<owner>-<repo>`:

```bash
# Default (shallow clone of default branch)
git clone --depth 1 https://github.com/owner/repo /tmp/repo-dive/owner-repo

# Specific branch
git clone --depth 1 --branch <branch> https://github.com/owner/repo /tmp/repo-dive/owner-repo

# PR — clone then checkout PR ref
git clone --depth 1 https://github.com/owner/repo /tmp/repo-dive/owner-repo
cd /tmp/repo-dive/owner-repo && gh pr checkout <number>
```

**If the directory already exists**, ask the user:
- Reuse the existing clone (skip clone step)
- Remove and re-clone (`rm -rf` then clone fresh)

### Step 2: Explore

Use Claude's native file tools on the cloned directory:

- **Glob** for file discovery (`/tmp/repo-dive/owner-repo/**/*.ts`)
- **Read** for file contents
- **Grep** for content search
- **Agent** (subagent_type=Explore) for deep codebase exploration

For large-scale analysis, use the **gemini-research** skill targeting the cloned directory.

**Do NOT use `gh api` for file contents** — everything is local now.

### Step 3: Report

Summarize findings to the user. Structure depends on the request but typically includes:
- Repository overview (language, framework, structure)
- Key findings relevant to the user's question
- Notable patterns, potential issues, or recommendations

## Cleanup

Do NOT automatically delete the cloned repository after exploration. The user may want to continue investigating in follow-up messages. The `/tmp` directory is cleaned up on system restart.

If the user explicitly asks to clean up:

```bash
rm -rf /tmp/repo-dive/owner-repo
```

## Notes

- For private repositories, `git clone` uses the `gh` CLI's auth context (credential helper). If clone fails, suggest `gh auth status` to verify authentication.
- Shallow clone (`--depth 1`) is the default. If the user needs git history (blame, log), re-clone without `--depth 1`.
- When exploring monorepos or very large repos, ask the user which subdirectory to focus on before diving in.
