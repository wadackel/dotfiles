// ANSI escape sanitization + ANSI-aware line truncation.
// Pure module — extracted from picker.tsx so that non-React tooling and
// e2e harnesses can import these helpers without dragging in npm:react /
// npm:ink at parse time.

// tmux capture-pane -e emits ANSI. ink <Text> passes SGR (color) through
// cleanly, but cursor-move CSI corrupts the layout AND OSC/DCS/APC/PM can
// smuggle titles, hyperlinks, and device control into the host terminal
// (terminal-injection surface). Strip every ESC sequence except SGR CSI.
//
// Order matters: handle string-terminated families (OSC/DCS/APC/PM) first
// because their payload may incidentally contain `[` that would otherwise be
// eaten by the CSI matcher. Then strip non-SGR CSI. Then strip simple
// single-char escapes that are neither CSI introducer nor string intros.
// Parameter byte range per ECMA-48 is 0x30-0x3F (covers `<`, `=`, `>`, `?`
// in addition to digits and `;:`). Using the full range prevents e.g.
// `\x1b[>0c` (primary device attributes request) from bypassing the sanitizer.
// deno-lint-ignore no-control-regex
export const OSC_LIKE = /\x1b[\]P_^][\s\S]*?(?:\x07|\x1b\\)/g;
// deno-lint-ignore no-control-regex
export const CSI_SEQUENCE = /\x1b\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g;
// deno-lint-ignore no-control-regex
export const SIMPLE_ESC = /\x1b[^\[\]P_^]/g;

export function sanitizeAnsi(input: string): string {
  return input
    .replace(OSC_LIKE, "")
    .replace(CSI_SEQUENCE, (match) => (match.endsWith("m") ? match : ""))
    .replace(SIMPLE_ESC, "");
}

// ANSI-aware line truncation. After sanitizeAnsi, only SGR CSI sequences
// remain; if a raw .slice(0, N) happens to cut mid-escape, Ink would render
// a dangling ESC and leak terminal control into the host. This truncator
// counts only printable characters toward the column budget while passing
// escape sequences through intact. If truncation occurs mid-SGR-span, a
// reset `\x1b[0m` is appended so no color leaks to the next line.
export function truncateAnsiLine(line: string, maxCols: number): string {
  let out = "";
  let printable = 0;
  let hasOpenSgr = false;
  let i = 0;
  while (i < line.length && printable < maxCols) {
    const ch = line[i];
    if (ch === "\x1b") {
      const rest = line.slice(i);
      const m = rest.match(/^\x1b\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/);
      if (m) {
        out += m[0];
        // Track open SGR: any SGR other than a plain reset opens a span.
        if (m[0].endsWith("m")) {
          const params = m[0].slice(2, -1);
          hasOpenSgr = params !== "" && params !== "0";
        }
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    out += ch;
    printable++;
    i++;
  }
  if (hasOpenSgr) out += "\x1b[0m";
  return out;
}
