---
name: nvim-verify
description: >-
  Verifies Neovim configuration (init.lua) in headless mode. Checks startup
  errors, plugin loading, keymaps, and option values without requiring a
  terminal UI. Use this skill after editing init.lua or any Neovim
  configuration, when asked to "check nvim config", "verify neovim setup",
  "nvim動作確認", "init.lua確認", "設定チェック", "neovimが壊れてないか確認",
  or when you want to validate that a Neovim config change works correctly.
  Also use proactively after making any changes to init.lua — even if the
  user doesn't explicitly ask for verification, running at least the startup
  check catches errors before the user opens Neovim.
allowed-tools: Bash(*nvim-verify.ts*)
argument-hint: "[all|startup|plugins [name]|keymaps [lhs]|options [name...]]"
---

# nvim-verify

Verify Neovim configuration in headless mode. Load init.lua and run
structured checks, returning results as JSON to stdout.

## Quick Start

```bash
# Startup check (minimum — always run after editing init.lua)
nvim-verify.ts startup

# Run all checks
nvim-verify.ts all
```

## Workflow

### Step 1: Choose check scope

Select the appropriate subcommand based on the type of change.

| Change | Check to run |
|---|---|
| init.lua syntax or settings | `startup` (required) |
| Plugin added, removed, or reconfigured | `startup` + `plugins [name]` |
| Keymap added or changed | `startup` + `keymaps "<lhs>"` |
| Option value changed | `startup` + `options <name>` |
| Unclear or large-scale change | `all` |

init.lua is symlinked, so verification runs immediately after editing
(no darwin-rebuild needed).

### Step 2: Run the check

```bash
# Startup check
nvim-verify.ts startup

# Verify a specific plugin (forces lazy-loaded plugins to load)
nvim-verify.ts plugins telescope.nvim

# Verify a specific keymap (use Neovim internal notation)
nvim-verify.ts keymaps "<Space>cc"

# Check option values
nvim-verify.ts options number tabstop shiftwidth

# Run all checks
nvim-verify.ts all
```

### Step 3: Interpret the result

The script outputs JSON to stdout.

**Success example:**
```json
{
  "check": "startup",
  "ok": true,
  "details": { "errmsg": "", "message_count": 0 },
  "errors": [],
  "warnings": []
}
```

**Failure example:**
```json
{
  "check": "startup",
  "ok": false,
  "details": { "errmsg": "E5108: Error executing lua..." },
  "errors": ["E5108: Error executing lua [string \":lua\"]:1: unexpected symbol"],
  "warnings": []
}
```

**Reading the result:**

- `ok: true` — Check passed. Report to the user that the configuration loaded successfully.
- `ok: false` — Errors found. Share the `errors` array with the user and propose fixes.
- `warnings` — Non-fatal but noteworthy items. Share as informational.

### Step 4: Report to user

Summarize check results concisely.

**Success report example:**
> Startup check passed — no errors. 72 plugins recognized, telescope.nvim loaded successfully.

**Failure report example:**
> Startup check detected an error:
> `E5108: Error executing lua: unexpected symbol near '!'`
> Investigating and fixing the issue.

On failure, identify the root cause and attempt a fix, then re-run `startup`
to confirm the fix.

## Limitations

The following cannot be verified in headless mode. Request manual confirmation
from the user when relevant:

- **Visual rendering**: Colorschemes, highlights, UI plugin appearance
- **LSP**: LSP servers do not connect in headless mode
- **Buffer-local keymaps**: Keymaps set by plugins on buffer open are not
  available in headless context
- **Local options**: `vim.wo`/`vim.bo` (window/buffer-local) are out of scope
  due to headless context constraints

## Notes

- Plugins with `lazy = true` (default) show `loaded: false` at startup — this
  is normal. Use `plugins <name>` to force-load and verify.
- After adding a new plugin, the first `startup` check may exit with code 1
  because lazy.nvim clones the plugin during the run. A second run produces
  a clean result.
- Keymap lhs uses Neovim internal notation (e.g., `<Space>cc`, `<C-k>`, `<Leader>f`).
- `all` runs startup → plugins → keymaps → options sequentially, each in a
  separate process to avoid side-effect contamination.
