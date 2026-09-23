{
  config,
  lib,
  pkgs,
  inputs,
  profile ? null,
  ...
}:

let
  homeDir = config.home.homeDirectory;
  hermesHome = config.services.hermes-agent.hermesHome;
  googleDir = "${homeDir}/.config/hermes-google";
  dailyDir = "${homeDir}/Documents/Main/99_Tracking/Daily";
  appsScript = [
    "script.google.com"
    "script.googleusercontent.com"
  ];
  denoRun =
    {
      net ? [ ],
      read ? [ ],
      write ? [ ],
      script,
    }:
    [
      "${pkgs.deno}/bin/deno"
      "run"
      "--no-prompt"
      "--allow-env=HOME"
    ]
    ++ lib.optional (net != [ ]) "--allow-net=${lib.concatStringsSep "," net}"
    ++ lib.optional (read != [ ]) "--allow-read=${lib.concatStringsSep "," read}"
    ++ lib.optional (write != [ ]) "--allow-write=${lib.concatStringsSep "," write}"
    ++ [ "${./scripts}/${script}" ];
  mcpServer = args: {
    command = builtins.head (denoRun args);
    args = builtins.tail (denoRun args);
  };
  cronScript = args: ''
    #!/usr/bin/env bash
    exec ${lib.escapeShellArgs (denoRun args)}
  '';
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

        platform_toolsets = {
          # Listing no MCP server would hand every server, gcal included, to
          # Slack sessions; `no_mcp` keeps calendar writes cron-only.
          slack = [
            "web"
            "terminal"
            "file"
            "todo"
            "memory"
            "no_mcp"
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
        daily =
          mcpServer {
            read = [ dailyDir ];
            write = [ dailyDir ];
            script = "daily-mcp.ts";
          }
          // {
            tools.include = [ "set_briefing" ];
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
