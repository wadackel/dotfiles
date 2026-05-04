{
  config,
  lib,
  pkgs,
  ...
}:

let
  tomlFormat = pkgs.formats.toml { };

  # Codex CLI config keys/sections that we want to fix declaratively.
  # Anything NOT in this attrset (e.g. [projects.*], [notice], [notice.model_migrations])
  # is left untouched by `apply-managed.ts` between rebuilds — Codex CLI mutates
  # those at runtime as the user trusts new project directories or dismisses
  # migration prompts.
  managed = {
    model = "gpt-5.5";
    model_reasoning_effort = "high";
    model_reasoning_summary = "detailed";
    sandbox_mode = "danger-full-access";
    notify = [
      "${pkgs.deno}/bin/deno"
      "run"
      "--allow-read"
      "--allow-write"
      "--allow-env=HOME,TMPDIR,TMUX_PANE"
      "--allow-run"
      "${config.home.homeDirectory}/.codex/codex-notify.ts"
      "send"
    ];
    personality = "pragmatic";
    web_search = "live";

    features = {
      streamable_shell = true;
      view_image_tool = true;
      external_migration = true;
      codex_hooks = true;
    };
  };

  managedToml = tomlFormat.generate "codex-managed.toml" managed;
in
{
  home.packages = [ pkgs.codex ];

  home.file.".codex/hooks.json".source = ./hooks.json;
  home.file.".codex/codex-pane-status.ts" = {
    source = ./codex-pane-status.ts;
    executable = true;
  };
  home.file.".codex/codex-hook-log.ts" = {
    source = ./codex-hook-log.ts;
    executable = true;
  };
  home.file.".codex/codex-notify.ts" = {
    source = ./codex-notify.ts;
    executable = true;
  };
  home.file.".codex/codex-memo.ts" = {
    source = ./codex-memo.ts;
    executable = true;
  };
  home.file.".codex/codex-plan-gate.ts" = {
    source = ./codex-plan-gate.ts;
    executable = true;
  };
  home.file.".codex/codex-impl-approval-tracker.ts" = {
    source = ./codex-impl-approval-tracker.ts;
    executable = true;
  };

  # Intentionally NOT terminated with `|| true` (unlike mise/default.nix):
  # a splice failure means ~/.codex/config.toml is in an unknown state, so
  # darwin-rebuild should fail loudly rather than complete with a silent broken config.
  home.activation.codexConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    run ${pkgs.deno}/bin/deno run --allow-read --allow-write \
      ${./apply-managed.ts} ${managedToml} "$HOME/.codex/config.toml"
  '';
}
