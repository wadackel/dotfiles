# React review card
Trigger: `.jsx` `.tsx`, or an added line importing `react` / `react-dom`, among the changed files.
Scope: React behavior for `code-reviewer`. Types belong to the typescript card, markup and ARIA to the a11y card.

## Check
**Effects and async**
- A stale async answer or timer tick that overwrites newer state: check the latest request wins, or the effect cleanup cancels the old one.
- Missing cleanup for `addEventListener`, `setInterval`, `setTimeout`, subscriptions, `AbortController`: a leak that fires state updates after unmount.
- Derived state kept in `useEffect` + `useState` instead of computed in the render body; an effect standing in for an event handler.
- Exit or unmount that does not wait for pending work (a process exit cutting off an in-flight action).
**Hooks and rendering**
- A hook inside a condition, loop or nested function; hook order that changes between renders.
- A dependency array missing a value the closure reads (stale closure), or a `react-hooks/exhaustive-deps` disable with no reason.
- An inline object, array or function handed to a `React.memo` child or a Context `Provider value`: every parent render re-renders the consumers.
- A `.map` without `key`, or `key={index}` on a list that reorders or inserts.
- Repeated output when nothing changed: an extra render, notification or log per tick while state is identical.
**Terminal UIs (Ink)**
- `console.error` or stderr writes while a frame is mounted draw over the frame; route them to a log file.

## Do not flag
- `useEffect` syncing with an external system (DOM focus, a chart or map widget, an imperative canvas).
- `key={index}` on a strictly static list.
- Manual `useMemo` / `useCallback` when `babel-plugin-react-compiler` is active in `infer` mode; when activation is uncertain, NIT at most.
- Client-side fetching in `useEffect` for client-only data; functions crossing the Server→Client boundary with `"use server"`.
- `forwardRef` on React < 19; a `"use client"` directive missing on a file only reached through an existing client file.
