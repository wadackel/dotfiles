---
name: playwright-cli
description: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Maintains browser sessions to preserve authentication state. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, test web applications, or extract information from web pages.
allowed-tools: Bash(playwright-cli:*)
---

# Browser Automation with playwright-cli

## Quick start

When opening the browser, launch it in headed mode unless there is a specific request from the user.

```bash
# First, check if an existing session is available
playwright-cli session-list

# If no session exists, configure a new one
playwright-cli config --headed

# Open the browser (uses existing session if available)
playwright-cli open https://playwright.dev
playwright-cli click e15
playwright-cli type "page.click"
playwright-cli press Enter
```

## Core workflow

1. Check for existing session: `playwright-cli session-list`
2. Configure if needed: `playwright-cli config --headed`
3. Navigate: `playwright-cli open https://example.com`
4. Interact using refs from the snapshot
5. Re-snapshot after significant changes

## Session Management Best Practices

**IMPORTANT: Preserve existing sessions to maintain authentication state.**

### Before Starting Work

Always check for existing sessions first:

```bash
playwright-cli session-list
```

### When to Create a New Session

Only run `playwright-cli config` when:
- No session exists (empty `session-list` output)
- You need different browser settings (e.g., switching browsers or headed/headless mode)
- You explicitly need to start fresh

### Benefits of Session Reuse

- **Authentication state preserved**: Stay logged in across commands
- **Reduced overhead**: Skip browser initialization
- **Natural workflow**: Continue where you left off

### Example: Working with Authenticated Pages

```bash
# First time: Check and configure if needed
playwright-cli session-list
playwright-cli config --headed

# Login to a site
playwright-cli open https://example.com/login
playwright-cli fill e1 "username"
playwright-cli fill e2 "password"
playwright-cli click e3

# Later: Reuse the authenticated session
# No need to run config again - just open the page
playwright-cli open https://example.com/dashboard
playwright-cli snapshot
```

### Managing Multiple Sessions

Use named sessions for different contexts:

```bash
# Work session for authenticated testing
playwright-cli --session=work config --headed
playwright-cli --session=work open https://app.example.com

# Test session for anonymous browsing
playwright-cli --session=test config --headed --isolated
playwright-cli --session=test open https://example.com
```

## Commands

### Core

```bash
playwright-cli config --headed
playwright-cli open https://example.com/
playwright-cli close
playwright-cli type "search query"
playwright-cli click e3
playwright-cli dblclick e7
playwright-cli fill e5 "user@example.com"
playwright-cli drag e2 e8
playwright-cli hover e4
playwright-cli select e9 "option-value"
playwright-cli upload ./document.pdf
playwright-cli check e12
playwright-cli uncheck e12
playwright-cli snapshot
playwright-cli eval "document.title"
playwright-cli eval "el => el.textContent" e5
playwright-cli dialog-accept
playwright-cli dialog-accept "confirmation text"
playwright-cli dialog-dismiss
playwright-cli resize 1920 1080
```

### Navigation

```bash
playwright-cli go-back
playwright-cli go-forward
playwright-cli reload
```

### Keyboard

```bash
playwright-cli press Enter
playwright-cli press ArrowDown
playwright-cli keydown Shift
playwright-cli keyup Shift
```

### Mouse

```bash
playwright-cli mousemove 150 300
playwright-cli mousedown
playwright-cli mousedown right
playwright-cli mouseup
playwright-cli mouseup right
playwright-cli mousewheel 0 100
```

### Save as

```bash
playwright-cli screenshot
playwright-cli screenshot e5
playwright-cli pdf
```

### Tabs

```bash
playwright-cli tab-list
playwright-cli tab-new
playwright-cli tab-new https://example.com/page
playwright-cli tab-close
playwright-cli tab-close 2
playwright-cli tab-select 0
```

### DevTools

```bash
playwright-cli console
playwright-cli console warning
playwright-cli network
playwright-cli run-code "async page => await page.context().grantPermissions(['geolocation'])"
playwright-cli tracing-start
playwright-cli tracing-stop
playwright-cli video-start
playwright-cli video-stop video.webm
```

### Configuration
```bash
# Configure the session
playwright-cli config my-config.json
# Configure named session
playwright-cli --session=mysession config my-config.json
# Start with configured session
playwright-cli open --config=my-config.json
```

### Sessions

```bash
playwright-cli --session=mysession open example.com
playwright-cli --session=mysession click e6
playwright-cli config --headed --isolated --browser=firefox
playwright-cli session-list
playwright-cli session-stop mysession
playwright-cli session-stop-all
playwright-cli session-delete
playwright-cli session-delete mysession
```

## Example: Form submission

```bash
playwright-cli open https://example.com/form
playwright-cli snapshot

playwright-cli fill e1 "user@example.com"
playwright-cli fill e2 "password123"
playwright-cli click e3
playwright-cli snapshot
```

## Example: Multi-tab workflow

```bash
playwright-cli open https://example.com
playwright-cli tab-new https://example.com/other
playwright-cli tab-list
playwright-cli tab-select 0
playwright-cli snapshot
```

## Example: Debugging with DevTools

```bash
playwright-cli open https://example.com
playwright-cli click e4
playwright-cli fill e7 "test"
playwright-cli console
playwright-cli network
```

```bash
playwright-cli open https://example.com
playwright-cli tracing-start
playwright-cli click e4
playwright-cli fill e7 "test"
playwright-cli tracing-stop
```

## Important Notes

### Working Directory Management

**CRITICAL: Always execute playwright-cli from the current working directory.**

- **DO NOT use `cd` commands**: playwright-cli is available in PATH and can be executed from anywhere
- **Maintain current directory**: All playwright-cli commands should run in the user's current working directory
- **Output file location**: Screenshots, PDFs, and other files are saved to the current directory

**Example of CORRECT usage:**

```bash
# User is in /path/to/project
playwright-cli session-list
playwright-cli open https://example.com
playwright-cli screenshot page.png
# page.png is saved to /path/to/project/page.png
```

**Example of INCORRECT usage:**

```bash
# DO NOT DO THIS
cd /some/other/directory  # ❌ Wrong - never change directory
playwright-cli open https://example.com
```

### Why This Matters

- **Predictable output location**: Users expect files in their current directory
- **Workflow consistency**: Maintains context with other development tools
- **No surprises**: Avoids files being saved to unexpected locations
