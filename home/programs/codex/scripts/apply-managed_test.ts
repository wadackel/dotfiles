import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@^1";
import { parse } from "npm:smol-toml@1.9.0";
import { apply, spliceContent } from "./apply-managed.ts";

const DENO_NOTIFY = [
  "/nix/store/aaa-deno-2.9.6/bin/deno",
  "run",
  "/Users/me/.codex/scripts/codex-notify.ts",
  "send",
];

const MANAGED_BODY = [
  'model = "gpt-5.4"',
  `notify = ${JSON.stringify(DENO_NOTIFY)}`,
  "",
  "[features]",
  "hooks = true",
  "streamable_shell = true",
  "",
  "[tui]",
  'status_line = ["model", "project-name"]',
  "",
].join("\n");

const MANAGED_PATHS = [
  ["model"],
  ["notify"],
  ["features", "hooks"],
  ["features", "streamable_shell"],
  ["tui", "status_line"],
];

const UNMANAGED_TAIL = [
  '[projects."/Users/me/a.b"]',
  'trust_level = "trusted"',
  "",
  "[notice]",
  '"hide_xyz_migration_prompt" = true',
  "",
].join("\n");

// The shape observed after the desktop app rewrote the file: comments gone,
// arrays reflowed, notify wrapped for Computer Use, and keys of its own.
function wrapped(previous: string[]): string[] {
  return [
    "/Users/me/.codex/computer-use/Client.app/Contents/MacOS/SkyComputerUseClient",
    "turn-ended",
    "--previous-notify",
    JSON.stringify(previous).replaceAll("/", "\\/"),
  ];
}

function tomlArray(values: string[]): string {
  return "[\n" + values.map((v) => `    ${JSON.stringify(v)},\n`).join("") +
    "]";
}

const APP_REWRITTEN = [
  'model = "gpt-5.4"',
  `notify = ${tomlArray(wrapped(DENO_NOTIFY))}`,
  "",
  "[features]",
  "hooks = true",
  "streamable_shell = true",
  "",
  "[tui]",
  `status_line = ${tomlArray(["model", "project-name"])}`,
  "",
  "[desktop]",
  'followUpQueueMode = "steer"',
  "",
  UNMANAGED_TAIL,
].join("\n");

function legacyBlock(body: string): string {
  return "# nix-managed:start\n" + body + "# nix-managed:end\n";
}

Deno.test("absent target -> created with the managed values", () => {
  const { next, action, paths } = spliceContent(null, MANAGED_BODY, []);
  assertEquals(action, "created");
  assertEquals(parse(next), parse(MANAGED_BODY));
  assertEquals(paths, MANAGED_PATHS);
});

Deno.test("legacy marker block -> block dropped, managed values applied, tail kept", () => {
  const current =
    legacyBlock('model = "old-model"\nsandbox_mode = "workspace-write"\n') +
    "\n" + UNMANAGED_TAIL;

  const { next, action } = spliceContent(current, MANAGED_BODY, []);

  assertEquals(action, "updated");
  assertEquals(next.includes("nix-managed"), false);
  const doc = parse(next);
  assertEquals(doc.model, "gpt-5.4");
  assertEquals("sandbox_mode" in doc, false);
  assertEquals(doc.projects, { "/Users/me/a.b": { trust_level: "trusted" } });
  assertEquals(doc.notice, { hide_xyz_migration_prompt: true });
});

Deno.test("legacy block followed by the app's duplicate of it -> one copy of each key", () => {
  // What `darwin-rebuild switch` produced after the app dropped the markers.
  const current = legacyBlock(MANAGED_BODY) + "\n" + APP_REWRITTEN;

  const { next, action } = spliceContent(current, MANAGED_BODY, []);

  assertEquals(action, "updated");
  assertEquals((next.match(/^\[features\]$/gm) ?? []).length, 1);
  assertEquals((next.match(/^model =/gm) ?? []).length, 1);
  const doc = parse(next);
  assertEquals(doc.desktop, { followUpQueueMode: "steer" });
  assertEquals(doc.notify, wrapped(DENO_NOTIFY));
});

Deno.test("app-rewritten file without markers -> managed values win, app keys kept", () => {
  const drifted = APP_REWRITTEN.replace(
    'model = "gpt-5.4"',
    'model = "app-picked"',
  )
    .replace("hooks = true", "hooks = false\nunified_exec = true");

  const { next, action } = spliceContent(drifted, MANAGED_BODY, MANAGED_PATHS);

  assertEquals(action, "updated");
  const doc = parse(next);
  assertEquals(doc.model, "gpt-5.4");
  assertEquals(doc.features, {
    hooks: true,
    unified_exec: true,
    streamable_shell: true,
  });
  assertEquals(doc.desktop, { followUpQueueMode: "steer" });
});

Deno.test("reapplying to its own output -> noop and content unchanged", () => {
  const first = spliceContent(
    APP_REWRITTEN + "\n[notice.more]\nvalue = true\n",
    MANAGED_BODY,
    [],
  );
  const second = spliceContent(first.next, MANAGED_BODY, first.paths);
  assertEquals(second.action, "noop");
  assertEquals(second.next, first.next);
});

Deno.test("unchanged hand-formatted file without a state file -> noop keeps its text", () => {
  const { next, action } = spliceContent(APP_REWRITTEN, MANAGED_BODY, []);
  assertEquals(action, "noop");
  assertEquals(next, APP_REWRITTEN);
});

Deno.test("key dropped from Nix -> removed, emptied ancestor pruned, pre-existing empty table kept", () => {
  const previous = [...MANAGED_PATHS, [
    "sandbox_workspace_write",
    "network_access",
  ]];
  const current = APP_REWRITTEN +
    "\n[sandbox_workspace_write]\nnetwork_access = true\n\n[empty_by_app]\n";

  const { next, action } = spliceContent(current, MANAGED_BODY, previous);

  assertEquals(action, "updated");
  const doc = parse(next);
  assertEquals("sandbox_workspace_write" in doc, false);
  assertEquals(doc.empty_by_app, {});
});

Deno.test("dropped key whose table still holds other keys -> only that key goes", () => {
  const previous = [...MANAGED_PATHS, ["features", "view_image_tool"]];
  const current = APP_REWRITTEN.replace(
    "hooks = true",
    "hooks = true\nview_image_tool = true",
  );

  const doc = parse(spliceContent(current, MANAGED_BODY, previous).next);

  assertEquals(doc.features, { hooks: true, streamable_shell: true });
});

Deno.test("wrapped notify with a stale payload -> wrapper kept, payload replaced", () => {
  const stale = [
    "/nix/store/old-deno-2.9.5/bin/deno",
    ...DENO_NOTIFY.slice(1),
  ];
  const current = APP_REWRITTEN.replace(
    tomlArray(wrapped(DENO_NOTIFY)),
    tomlArray(wrapped(stale)),
  );

  const doc = parse(spliceContent(current, MANAGED_BODY, MANAGED_PATHS).next);

  const notify = doc.notify as string[];
  assertEquals(notify.slice(0, 3), wrapped(DENO_NOTIFY).slice(0, 3));
  assertEquals(JSON.parse(notify[3]), DENO_NOTIFY);
});

Deno.test("notify that is not a wrapper -> managed value", () => {
  for (
    const notify of [["other", "--previous-notify", "not json"], ["other"], "x"]
  ) {
    const current = `notify = ${JSON.stringify(notify)}\n`;
    const doc = parse(spliceContent(current, MANAGED_BODY, []).next);
    assertEquals(doc.notify, DENO_NOTIFY);
  }
});

Deno.test("nested tables, arrays of tables, and datetimes survive a merge", () => {
  const extra = [
    "[tui.model_availability_nux]",
    '"gpt-5.5" = 4',
    "",
    "[[hooks.PreToolUse]]",
    'matcher = "Bash"',
    "",
    "[[hooks.PreToolUse.hooks]]",
    'type = "command"',
    'command = "x"',
    "",
    "[notice]",
    "seen_at = 1979-05-27T07:32:00+09:00",
    "",
  ].join("\n");
  const current = 'model = "old"\n\n' + extra;

  const { next } = spliceContent(current, MANAGED_BODY, []);

  assertStringIncludes(next, "seen_at = 1979-05-27T07:32:00.000+09:00");
  const doc = parse(next);
  assertEquals(doc.tui, {
    status_line: ["model", "project-name"],
    model_availability_nux: { "gpt-5.5": 4 },
  });
  assertEquals(doc.hooks, {
    PreToolUse: [{
      matcher: "Bash",
      hooks: [{ type: "command", command: "x" }],
    }],
  });
});

Deno.test("duplicate keys or invalid TOML -> throws instead of writing", () => {
  for (
    const current of [
      "a = 1\na = 2\n",
      'notify = ["a"]\nnotify = ["b"]\n',
      'x = "unterminated\n',
    ]
  ) {
    assertThrows(() => spliceContent(current, MANAGED_BODY, []));
  }
});

Deno.test("managed key under a non-table value -> throws", () => {
  assertThrows(
    () => spliceContent('features = "on"\n', MANAGED_BODY, []),
    Error,
    "features is not a table",
  );
});

Deno.test("apply writes the state file next to the target and keeps the file mode", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const managedPath = `${dir}/managed.toml`;
    const targetPath = `${dir}/config.toml`;
    await Deno.writeTextFile(managedPath, MANAGED_BODY);
    await Deno.writeTextFile(targetPath, 'model = "old"\n', { mode: 0o600 });
    await Deno.chmod(targetPath, 0o600);

    assertEquals(await apply(managedPath, targetPath), "updated");

    assertEquals((await Deno.stat(targetPath)).mode! & 0o777, 0o600);
    assertEquals(
      JSON.parse(await Deno.readTextFile(`${targetPath}.nix-managed.json`)),
      { paths: MANAGED_PATHS },
    );
    assertEquals(await apply(managedPath, targetPath), "noop");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apply rejects a malformed state file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/managed.toml`, MANAGED_BODY);
    await Deno.writeTextFile(
      `${dir}/config.toml.nix-managed.json`,
      '{"paths": "model"}',
    );
    await assertRejects(() =>
      apply(`${dir}/managed.toml`, `${dir}/config.toml`)
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
