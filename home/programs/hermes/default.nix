{
  config,
  lib,
  pkgs,
  inputs,
  dotfiles,
  profile ? null,
  ...
}:

let
  homeDir = config.home.homeDirectory;
  hermesHome = config.services.hermes-agent.hermesHome;
  googleDir = "${homeDir}/.config/hermes-google";
  dailyDir = "${homeDir}/Documents/Main/99_Tracking/Daily";
  feedsDir = "${homeDir}/.config/hermes-feeds";
  literatureDir = "${homeDir}/Documents/Main/04_Literature";
  secretsFile = "${homeDir}/.config/hermes/secrets.env";
  # The owner's DM with the Hermes bot, where every report and digest goes.
  dmChannel = "D0C3V6SQABC";
  webClip = dotfiles.pathHere ../agents/skills/web-clip/scripts "web-clip.ts";
  appsScript = [
    "script.google.com"
    "script.googleusercontent.com"
  ];
  # Both platform_toolsets.slack and mcpServers use this name. Hermes hands
  # Slack every server when none of the listed names is defined, so a rename
  # on one side only would silently expose gcal's create_event.
  slackMcpServer = "agenda";
  deno = "${pkgs.deno}/bin/deno";
  denoRun =
    {
      # null allows every host: feeds live on arbitrary sites.
      net ? [ ],
      read ? [ ],
      write ? [ ],
      run ? [ ],
      env ? [ "HOME" ],
      script,
      args ? [ ],
    }:
    [
      deno
      "run"
      "--no-prompt"
      "--allow-env=${lib.concatStringsSep "," env}"
    ]
    ++ lib.optional (net == null) "--allow-net"
    ++ lib.optional (net != null && net != [ ]) "--allow-net=${lib.concatStringsSep "," net}"
    ++ lib.optional (read != [ ]) "--allow-read=${lib.concatStringsSep "," read}"
    ++ lib.optional (write != [ ]) "--allow-write=${lib.concatStringsSep "," write}"
    ++ lib.optional (run != [ ]) "--allow-run=${lib.concatStringsSep "," run}"
    # The worktree copy, not a store copy: a script edit then reaches the next
    # run without a rebuild, and whatever sits in ~/dotfiles is what runs.
    ++ [ (dotfiles.pathHere ./scripts script) ]
    ++ args;
  feedAction = denoRun {
    net = [ "slack.com" ];
    read = [
      feedsDir
      secretsFile
    ];
    write = [ feedsDir ];
    run = [ deno ];
    env = [
      "HOME"
      "PATH"
      "HERMES_WEB_CLIP"
      "HERMES_DENO"
    ];
    script = "feed-action.ts";
  };
  mcpServer = args: {
    command = builtins.head (denoRun args);
    args = builtins.tail (denoRun args);
  };
  cronScript = args: ''
    #!/usr/bin/env bash
    exec ${lib.escapeShellArgs (denoRun args)}
  '';
  claudeStateDir = "${homeDir}/.config/hermes-claude";
  explorePrompt = dotfiles.pathHere ./prompts "explore-web-clip.md";
  claudeWorkDir = "${homeDir}/.local/share/hermes-claude";
  # Absolute paths: the gateway runs under launchd, whose PATH has none of these.
  claudeBin = "${
    inputs.nix-claude-code.packages.${pkgs.stdenv.hostPlatform.system}.default
  }/bin/claude";
  ghBin = "${pkgs.gh}/bin/gh";
  gitBin = "${pkgs.git}/bin/git";
  claudeTask =
    args:
    denoRun {
      net = [ "slack.com" ];
      read = [
        claudeStateDir
        claudeWorkDir
        secretsFile
        explorePrompt
      ];
      write = [
        claudeStateDir
        claudeWorkDir
      ];
      run = [
        claudeBin
        ghBin
        gitBin
      ];
      env = [
        "HOME"
        "USER"
        "TMPDIR"
      ];
      script = "claude-task.ts";
      args = [
        "--channel"
        dmChannel
        "--owners"
        (lib.concatStringsSep "," [
          "wadackel"
          "reg-viz"
        ])
        "--claude"
        claudeBin
        "--gh"
        ghBin
        "--git"
        gitBin
      ]
      ++ args;
    };
in
{
  imports = [ inputs.hermes-agent.homeManagerModules.default ];

  # The upstream module is imported on every profile because imports cannot
  # depend on config; only the private Mac mini turns anything on.
  config = lib.mkIf (profile == "private") {
    programs.hermes-agent.enable = true;

    services.hermes-agent = {
      enable = true;
      gateway.enable = true;
      package = inputs.hermes-agent.packages.${pkgs.stdenv.hostPlatform.system}.minimal;
      extraDependencyGroups = [ "slack" ];
      extraPackages = [ pkgs.docker-client ];

      environment.DOCKER_HOST = "unix://${homeDir}/.colima/default/docker.sock";
      # SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_ALLOWED_USERS and
      # OPENROUTER_API_KEY. Kept out of the repo and the world-readable store.
      environmentFiles = [ "${homeDir}/.config/hermes/secrets.env" ];

      settings = {
        model = {
          provider = "openrouter";
          default = "deepseek/deepseek-v4.1-flash";
        };
        # The cheapest OpenRouter hosts for this model serve an fp4 quant, and
        # DeepSeek's own endpoint is dropped by the account's no-training
        # policy. `sort = "price"` is avoided because it disables Auto
        # Exacto's tool-call-quality routing.
        provider_routing.models."deepseek/deepseek-v4.1-flash".only = [
          "deepinfra"
          "fireworks"
          "together"
        ];

        terminal = {
          backend = "docker";
          container_persistent = false;
          docker_volumes = [ ];
        };

        # Every job reports straight to the owner's DM, so the default
        # "Cronjob Response: <name> (job_id: …)" header and footer are noise.
        cron.wrap_response = false;

        plugins.enabled = [ "claude-task" ];

        platform_toolsets = {
          # Listing no MCP server would hand every server, gcal included, to
          # Slack sessions; naming one makes the list an allowlist, so Slack
          # reads the calendar through agenda and calendar writes stay cron-only.
          slack = [
            "web"
            "terminal"
            "file"
            "todo"
            "memory"
            slackMcpServer
          ];
          cron = [ "gcal" ];
        };
      };

      mcpServers = {
        gcal =
          mcpServer {
            net = appsScript;
            read = [ googleDir ];
            script = "gcal-mcp.ts";
          }
          // {
            tools.include = [ "create_event" ];
          };
        ${slackMcpServer} =
          mcpServer {
            net = appsScript;
            read = [
              googleDir
              dailyDir
            ];
            script = "agenda-mcp.ts";
          }
          // {
            tools.include = [
              "list_events"
              "read_todos"
            ];
          };
        daily =
          mcpServer {
            read = [ dailyDir ];
            write = [ dailyDir ];
            script = "daily-mcp.ts";
          }
          // {
            tools.include = [ "set_briefing" ];
          };
        feeds =
          mcpServer {
            net = [ "slack.com" ];
            read = [
              feedsDir
              secretsFile
            ];
            write = [ feedsDir ];
            script = "feeds-mcp.ts";
            args = [
              "--channel"
              dmChannel
            ];
          }
          // {
            tools.include = [ "post_digest" ];
          };
      };

      # Cron pre-run scripts must resolve inside $HERMES_HOME/scripts, and the
      # module copies these files there rather than linking into the store.
      hermesHomeFiles = {
        "scripts/fetch-new-mail.sh" = cronScript {
          net = appsScript;
          read = [ googleDir ];
          write = [ googleDir ];
          script = "fetch-new-mail.ts";
        };
        "scripts/prepare-daily.sh" = cronScript {
          net = appsScript;
          read = [
            googleDir
            dailyDir
          ];
          write = [ dailyDir ];
          script = "prepare-daily.ts";
        };
        "scripts/collect-feeds.sh" = cronScript {
          net = null;
          read = [
            feedsDir
            literatureDir
          ];
          write = [ feedsDir ];
          script = "collect-feeds.ts";
        };
        "scripts/suggest-feeds.sh" = cronScript {
          net = null;
          read = [
            feedsDir
            literatureDir
            secretsFile
          ];
          write = [ feedsDir ];
          script = "suggest-feeds.ts";
          args = [
            "--channel"
            dmChannel
          ];
        };
        "hooks/feed-reactions/HOOK.yaml" = ''
          name: feed-reactions
          description: Act on reactions to feed digest messages in the owner's DM
          events:
            - reaction:added
        '';
        # Runs inside the gateway's event loop, so it only checks the event and
        # hands the work to a detached process. The child gets a minimal
        # environment: the gateway's own holds every Hermes secret.
        "hooks/feed-reactions/handler.py" = ''
          import os
          import subprocess

          ACTIONS = {"paperclip", "+1", "-1", "heavy_plus_sign", "mute"}
          CHANNEL = "${dmChannel}"
          COMMAND = ${builtins.toJSON feedAction}
          LOG = os.path.expanduser("~/Library/Logs/hermes-feed-action.log")


          def handle(event_type, context):
              if context.get("channel_id") != CHANNEL or context.get("reaction") not in ACTIONS:
                  return
              allowed = {u.strip() for u in os.environ.get("SLACK_ALLOWED_USERS", "").split(",") if u.strip()}
              if context.get("user_id") not in allowed:
                  return
              env = {
                  "HOME": os.environ["HOME"],
                  "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                  "HERMES_WEB_CLIP": "${webClip}",
                  "HERMES_DENO": "${deno}",
              }
              with open(LOG, "a") as log:
                  subprocess.Popen(
                      COMMAND + [context["reaction"], CHANNEL, context["message_ts"]],
                      env=env,
                      stdin=subprocess.DEVNULL,
                      stdout=log,
                      stderr=log,
                      start_new_session=True,
                  )
        '';
        "scripts/claude-explore-web-clip.sh" = ''
          #!/usr/bin/env bash
          exec ${
            lib.escapeShellArgs (claudeTask [
              "explore"
              "wadackel/obsidian-web-clip"
              explorePrompt
            ])
          }
        '';
        # A plugin rather than a file hook: only `pre_gateway_dispatch` can keep
        # a message from reaching the model, and a `!claude` request or a reply
        # in its thread must go to Claude Code, not to the cheap model.
        "plugins/claude-task/plugin.yaml" = ''
          name: claude-task
          description: Hand DM requests starting with !claude, and replies in their threads, to Claude Code
        '';
        "plugins/claude-task/__init__.py" = ''
          import os
          import subprocess

          CHANNEL = "${dmChannel}"
          COMMAND = ${builtins.toJSON (claudeTask [ ])}
          TASKS = "${claudeStateDir}/tasks"
          LOG = os.path.expanduser("~/Library/Logs/hermes-claude-task.log")


          def _spawn(args):
              env = {
                  "HOME": os.environ["HOME"],
                  "USER": os.environ.get("USER", ""),
                  "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
                  "PATH": "/usr/bin:/bin",
              }
              with open(LOG, "a") as log:
                  subprocess.Popen(
                      COMMAND + args,
                      env=env,
                      stdin=subprocess.DEVNULL,
                      stdout=log,
                      stderr=log,
                      start_new_session=True,
                  )


          # Runs on the gateway event loop before the model and before auth, so
          # it checks the sender itself and only hands work to a detached process.
          def on_dispatch(event=None, **_):
              source = getattr(event, "source", None)
              if source is None or getattr(source, "chat_id", None) != CHANNEL:
                  return None
              allowed = {u.strip() for u in os.environ.get("SLACK_ALLOWED_USERS", "").split(",") if u.strip()}
              if getattr(source, "user_id", None) not in allowed:
                  return None
              raw = getattr(event, "raw_message", None) or {}
              text = (raw.get("text") or getattr(event, "text", "") or "").strip()
              thread = raw.get("thread_ts")
              # A thread that already holds a task takes every message as a reply,
              # even one that starts with !claude.
              if thread and os.path.exists(os.path.join(TASKS, thread + ".json")):
                  _spawn(["reply", thread, text])
                  return {"action": "skip", "reason": "claude-task reply"}
              if text.startswith("!claude"):
                  _spawn(["start", thread or getattr(event, "message_id", "") or raw.get("ts", ""), text])
                  return {"action": "skip", "reason": "claude-task request"}
              return None


          def register(ctx):
              ctx.register_hook("pre_gateway_dispatch", on_dispatch)
        '';
      };
    };

    # Pushes and redeploys ../gas without hand-pasting in the Apps Script
    # editor. Its login token (~/.clasprc.json) lives outside HERMES_HOME.
    home.packages = [ pkgs.google-clasp ];

    # Hermes runs its terminal in Docker, so colima has to be up before the
    # gateway needs it. The VM sees only HERMES_HOME: a mistaken
    # `docker_volumes` entry then cannot reach the vault.
    launchd.agents.colima = {
      enable = true;
      config = {
        ProgramArguments = [
          "${config.home.profileDirectory}/bin/colima"
          "start"
          "--foreground"
          "--mount"
          "${hermesHome}:w"
        ];
        EnvironmentVariables.PATH = "${config.home.profileDirectory}/bin:/usr/bin:/bin:/usr/sbin:/sbin";
        RunAtLoad = true;
        KeepAlive = true;
        ProcessType = "Background";
        StandardOutPath = "${homeDir}/Library/Logs/colima.log";
        StandardErrorPath = "${homeDir}/Library/Logs/colima.log";
      };
    };
  };
}
