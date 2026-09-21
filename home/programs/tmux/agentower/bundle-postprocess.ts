#!/usr/bin/env -S deno run --allow-read --allow-write

// esbuild inlines ink's dynamic import of its devtools module and hoists the
// imports it finds there to the top of the bundle, so `deno compile` fails with
// `Import "react-devtools-core" not a dependency`. --external keeps the
// specifiers out of the graph but leaves the hoisted lines behind. Nothing
// reaches them at runtime — that is the devtools path, which Agentower never
// turns on.
//
// Matched on the specifier rather than the whole statement because --minify
// mangles the local name, drops the space before the specifier, and puts the
// statement on a shared line.

const EXTERNALS: [specifier: string, expected: number][] = [
  ["ws", 2], // ws default plus WebSocket default
  ["react-devtools-core", 1],
];

const INK_VERSION = "ink@7.1.1";

// The leading group anchors the match to a statement boundary: after minify a
// string literal spelling the same import has nothing else to distinguish it.
// The trailing `;` is not optional in the output — minify leaves a neighbour on
// the same line, and dropping it would splice the two statements together.
function importPattern(specifier: string): RegExp {
  return new RegExp(
    `(^|[;}\\n])import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*"${specifier}"\\s*;?`,
    "g",
  );
}

if (import.meta.main) {
  const path = Deno.args[0];
  if (!path) {
    console.error("usage: bundle-postprocess.ts <bundle.js>");
    Deno.exit(2);
  }
  let text = await Deno.readTextFile(path);
  // Counted per specifier, not in total: three hits spread over two specifiers
  // would pass a sum check and leave the third import to break `deno compile`
  // with an error that points nowhere near here.
  const wrong: string[] = [];
  for (const [specifier, expected] of EXTERNALS) {
    let seen = 0;
    text = text.replace(importPattern(specifier), (_m, lead, name) => {
      seen++;
      return `${lead}var ${name}=void 0;`;
    });
    if (seen !== expected) {
      wrong.push(`${seen}x "${specifier}" (want ${expected})`);
    }
  }
  if (wrong.length > 0) {
    console.error(
      `agentower bundle post-process: ${wrong.join("; ")}. Pinned against ` +
        `${INK_VERSION}, and this run is not idempotent — on an already-` +
        `processed bundle every count is 0. A namespace import ` +
        `(\`import*as X from"ws"\`) would also read as 0. If ink moved, ` +
        `re-derive the imports or drop the bundle and post-process stages and ` +
        `compile agentower-main.ts directly (see AGENTS.md).`,
    );
    Deno.exit(1);
  }
  await Deno.writeTextFile(path, text);
  const total = EXTERNALS.reduce((n, [, expected]) => n + expected, 0);
  console.error(
    `agentower bundle post-process: ${total} replacements (${INK_VERSION})`,
  );
}
