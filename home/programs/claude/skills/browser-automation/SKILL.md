---
name: browser-automation
description: Provides Chrome MCP browser automation patterns. Use for "ブラウザで確認", "Chromeで開いて", "スクリーンショット", taking screenshots, verifying UI, or any chrome-devtools task. Also use in plan mode when planning browser-based verification to apply correct data extraction strategies and avoid common anti-patterns.
---

# Browser Automation Patterns

Conventions for browser-based testing and verification using Claude Code's built-in Chrome integration (chrome-devtools MCP, claude-in-chrome MCP).

## When This Applies

- Verifying UI rendering, layout, or visual behavior
- Extracting runtime data from SPAs (user info, state, API responses)
- Debugging browser-side issues in plan mode
- Automating browser interactions for testing

## Dynamic Data Derivation

Never hardcode expected values or input data for verification. Derive them from runtime state.

- If identifiable from conversation context, use that
- Otherwise, extract programmatically from DOM elements, API responses, or app state
- As a last resort, ask the user via `AskUserQuestion`

## SPA Runtime Data Extraction

Use this decision tree to choose the most reliable extraction method:

```
Need runtime info from a SPA?
  |
  +-- Can DOM inspection answer it? (img[alt], [aria-label], text content)
  |     YES --> Use DOM inspection (fastest, most reliable)
  |
  +-- Is data in globals/storage? (window.__NEXT_DATA__, localStorage, cookies)
  |     YES --> Use javascript_tool to read it
  |
  +-- Need API response data?
  |     YES --> Use read_network_requests (requires page reload, see constraints below)
  |
  +-- None of the above work?
        --> Explore React fiber / state store (fragile, last resort only)
```

## `read_network_requests` Constraints

- Tracking starts on the **first call** -- requests before that are not captured
- To capture page-load requests, follow this sequence:
  1. `read_network_requests(clear: true)` -- start tracking
  2. Reload or navigate the page
  3. Wait for load
  4. `read_network_requests` -- read results
- If the page is already loaded, prefer DOM inspection over network capture

## MutationObserver Logging in SPAs

When collecting DOM change logs across SPA navigation:

- Store logs on `window.__` prefixed variables (e.g., `window.__mo`, `window.__labelLog`), not `sessionStorage` (which may be non-function in some environments)
- Next.js and similar SPAs preserve `window` variables across client-side navigation, so logs persist across page transitions
- Use `__` prefix to avoid variable name collisions

## Plan Mode Verification

When investigating browser UI or rendering issues in plan mode:

- Perform actual measurement via Chrome integration, not theoretical reasoning
- Capture DOM element sizes, CSS applied state, layout calculations before forming a plan
- Compare against Figma designs or reference pages for visual accuracy

## Anti-patterns

- Do not hardcode user names, IDs, or expected values -- derive from DOM/API
- Do not assume page-load requests are available without initializing `read_network_requests` first
- Do not use `sessionStorage.setItem` for MutationObserver logs -- use `window.__` variables
- Do not rely solely on "it renders" for visual verification -- compare against reference designs
