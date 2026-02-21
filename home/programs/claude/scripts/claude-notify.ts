#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME,TMPDIR,TMUX_PANE,TMUX --allow-run

// --- Types ---

interface HookData {
  hook_event_name?: string;
  transcript_path?: string;
  session_id?: string;
  message?: string;
}

interface TmuxContext {
  session: string;
  window: string;
  pane: string;
  paneTitle: string;
}

// --- Constants ---

const LOG_FILE = `${Deno.env.get("TMPDIR") ?? "/tmp"}/claude-notify.log`;
const MAX_LOG_LINES = 1000;

// --- Logging ---

async function log(msg: string): Promise<void> {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  await Deno.writeTextFile(LOG_FILE, `[${ts}] ${msg}\n`, { append: true });
}

async function rotateLog(): Promise<void> {
  try {
    const content = await Deno.readTextFile(LOG_FILE);
    const lines = content.split("\n");
    if (lines.length > MAX_LOG_LINES) {
      await Deno.writeTextFile(
        LOG_FILE,
        lines.slice(-MAX_LOG_LINES).join("\n") + "\n",
      );
    }
  } catch {
    // File doesn't exist yet — no rotation needed
  }
}

// --- Command execution ---

async function runCommand(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await proc.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout).trim(),
    stderr: new TextDecoder().decode(stderr).trim(),
  };
}

async function resolveCommandPath(name: string): Promise<string> {
  const { code, stdout } = await runCommand("which", [name]);
  return code === 0 ? stdout : name;
}

// --- Transcript parsing ---

function getLastAssistantMessage(transcriptPath: string): string {
  const content = Deno.readTextFileSync(transcriptPath);
  const lines = content.split("\n").slice(-50);

  let lastMessage = "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "assistant") continue;
      const blocks = entry.message?.content;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          lastMessage = block.text;
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return lastMessage.replace(/\n/g, " ").slice(0, 200);
}

// --- Tmux context ---

async function getTmuxContext(tmuxPane: string): Promise<TmuxContext | null> {
  const fields = [
    "session_name",
    "window_index",
    "pane_index",
    "pane_title",
  ] as const;
  const results: string[] = [];

  for (const field of fields) {
    const { code, stdout, stderr } = await runCommand("tmux", [
      "display-message",
      "-t",
      tmuxPane,
      "-p",
      `#{${field}}`,
    ]);
    if (code !== 0) {
      await log(`ERROR: failed to get ${field}: ${stderr}`);
      return null;
    }
    results.push(stdout);
  }

  return {
    session: results[0],
    window: results[1],
    pane: results[2],
    paneTitle: results[3],
  };
}

// --- Subcommands ---

async function send(sound: string): Promise<void> {
  await rotateLog();
  await log("--- send start ---");
  await log(`ARGS: sound=${sound}`);
  await log(
    `ENV: TMUX_PANE=${Deno.env.get("TMUX_PANE") ?? "<unset>"} TMUX=${Deno.env.get("TMUX") ?? "<unset>"}`,
  );

  const stdinData = await new Response(Deno.stdin.readable).text();
  await log(`STDIN: ${stdinData}`);

  let hookData: HookData;
  try {
    hookData = JSON.parse(stdinData);
  } catch {
    await log("ERROR: failed to parse stdin JSON");
    return;
  }

  const hookEventName = hookData.hook_event_name ?? "unknown";
  await log(`HOOK_EVENT: ${hookEventName}`);

  const tmuxPane = Deno.env.get("TMUX_PANE");

  if (tmuxPane) {
    const ctx = await getTmuxContext(tmuxPane);
    if (!ctx) {
      await log("ERROR: failed to get tmux context");
      return;
    }

    const title = `Claude Code · ${ctx.paneTitle}`;
    let subtitle: string;
    let message = "";

    if (hookEventName === "Stop") {
      subtitle = "作業が完了しました";
      const transcriptPath = hookData.transcript_path ?? "";
      await log(`TRANSCRIPT_PATH: ${transcriptPath}`);

      if (transcriptPath) {
        try {
          message = getLastAssistantMessage(transcriptPath);
          await log(`LAST_MESSAGE: ${message.slice(0, 100)}...`);
        } catch {
          message = "(メッセージを取得できませんでした)";
          await log("TRANSCRIPT_NOT_FOUND or EMPTY");
        }
      } else {
        message = "(メッセージを取得できませんでした)";
        await log("TRANSCRIPT_NOT_FOUND or EMPTY");
      }
    } else if (hookEventName === "Notification") {
      subtitle = hookData.message ?? "通知";
      await log(`NOTIFICATION_MESSAGE: ${subtitle}`);
    } else {
      subtitle = "Claude Code";
      await log("UNKNOWN_HOOK_TYPE");
    }

    const group = `claude-${ctx.session}-${ctx.window}-${ctx.pane}`;
    const tmuxPath = await resolveCommandPath("tmux");
    await log(`TMUX_PATH: ${tmuxPath}`);

    // Resolve deno path for the -execute callback (launchd won't have deno in PATH)
    const denoPath = Deno.execPath();
    const scriptPath = `${Deno.env.get("HOME")}/.claude/scripts/claude-notify.ts`;
    const executeCmd =
      `${denoPath} run --allow-run --allow-write --allow-env=TMPDIR --allow-read ${scriptPath} activate '${ctx.session}' '${ctx.window}' '${ctx.pane}' '${tmuxPath}'`;
    await log(`EXECUTE_CMD: ${executeCmd}`);

    const notifyArgs = [
      "-title",
      title,
      "-subtitle",
      subtitle,
      "-sound",
      sound,
      "-group",
      group,
      "-execute",
      executeCmd,
    ];
    if (message) {
      notifyArgs.push("-message", message);
    }

    const { code, stderr } = await runCommand("terminal-notifier", notifyArgs);
    if (code === 0) {
      await log("NOTIFY: success");
    } else {
      await log(`NOTIFY_ERROR: exit=${code} output=${stderr}`);
    }
  } else {
    await log("NO_TMUX: sending without execute");
    const { code } = await runCommand("terminal-notifier", [
      "-title",
      "Claude Code",
      "-subtitle",
      "通知",
      "-sound",
      sound,
    ]);
    if (code !== 0) {
      await log(`NOTIFY_ERROR: exit=${code}`);
    }
  }

  await log("--- send end ---");
}

async function activate(
  session: string,
  window: string,
  pane: string,
  tmuxCmd: string,
): Promise<void> {
  await log("--- activate start ---");
  await log(
    `ARGS: session=${session} window=${window} pane=${pane} tmux_cmd=${tmuxCmd}`,
  );

  const { code: osCode, stderr: osErr } = await runCommand("/usr/bin/osascript", [
    "-e",
    'tell application "WezTerm" to activate',
  ]);
  if (osCode === 0) {
    await log("WEZTERM_ACTIVATE: success");
  } else {
    await log(`WEZTERM_ACTIVATE_ERROR: exit=${osCode} output=${osErr}`);
  }

  // Wait for WezTerm to come to front (replaces `sleep 0.1`)
  await new Promise((resolve) => setTimeout(resolve, 100));

  const target = `${session}:${window}.${pane}`;
  await log(`TARGET: ${target}`);

  const { stdout: clientsOutput } = await runCommand(tmuxCmd, [
    "list-clients",
    "-F",
    "#{client_name}",
  ]);
  await log(`CLIENTS: ${clientsOutput}`);

  for (const client of clientsOutput.split("\n")) {
    if (!client.trim()) continue;
    await log(`PROCESSING_CLIENT: ${client}`);
    const { code, stderr } = await runCommand(tmuxCmd, [
      "switch-client",
      "-c",
      client,
      "-t",
      target,
    ]);
    if (code === 0) {
      await log(`SWITCH_TO_TARGET: success for ${client}`);
    } else {
      await log(`SWITCH_TO_TARGET_ERROR: client=${client} output=${stderr}`);
    }
  }

  await log("--- activate end ---");
}

async function debug(): Promise<void> {
  try {
    const content = await Deno.readTextFile(LOG_FILE);
    const lines = content.split("\n");
    const last50 = lines.slice(-50).join("\n");
    console.log("=== claude-notify.ts debug log ===");
    console.log(`Log file: ${LOG_FILE}`);
    console.log("");
    console.log(last50);
  } catch {
    console.log(`No log file found at ${LOG_FILE}`);
  }
}

// --- Main ---

const [subcommand, ...args] = Deno.args;

switch (subcommand) {
  case "send":
    await send(args[0] ?? "default");
    break;
  case "activate":
    await activate(args[0], args[1], args[2], args[3] ?? "tmux");
    break;
  case "debug":
    await debug();
    break;
  default:
    console.error("Usage: claude-notify.ts {send|activate|debug}");
    Deno.exit(1);
}
