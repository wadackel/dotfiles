{
  config,
  lib,
  pkgs,
  dotfiles,
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
  # codex-pane-status.ts は同階層の `./agent-presence.ts` を import する。
  # Deno は relative import を URL ベースで解決し symlink の realpath を辿らない
  # ため、helper を ~/.codex/ 直下に sibling として共置する必要がある。
  # 実体は home/programs/tmux/agent-presence.ts にあり、worktree 内では
  # home/programs/codex/agent-presence.ts が in-worktree symlink で指している。
  # ここではその worktree シンボリックリンクごと out-of-store symlink で公開する。
  home.file.".codex/codex-pane-status.ts".source = dotfiles.linkHere ./. "codex-pane-status.ts";
  home.file.".codex/agent-presence.ts".source = dotfiles.linkHere ./. "agent-presence.ts";
  # pane-shared.ts は claude/codex/opencode 共通の SSOT (型 / キー / formatter /
  # transition builder)。worktree 内では home/programs/codex/pane-shared.ts が
  # ../tmux/pane-shared.ts への in-worktree symlink。agent-presence.ts と同形。
  home.file.".codex/pane-shared.ts".source = dotfiles.linkHere ./. "pane-shared.ts";
  home.file.".codex/codex-hook-log.ts".source = dotfiles.linkHere ./. "codex-hook-log.ts";
  home.file.".codex/codex-notify.ts".source = dotfiles.linkHere ./. "codex-notify.ts";
  home.file.".codex/codex-memo.ts".source = dotfiles.linkHere ./. "codex-memo.ts";
  home.file.".codex/codex-plan-gate.ts".source = dotfiles.linkHere ./. "codex-plan-gate.ts";
  home.file.".codex/codex-impl-approval-tracker.ts".source =
    dotfiles.linkHere ./. "codex-impl-approval-tracker.ts";

  # Intentionally NOT terminated with `|| true` (unlike mise/default.nix):
  # a splice failure means ~/.codex/config.toml is in an unknown state, so
  # darwin-rebuild should fail loudly rather than complete with a silent broken config.
  home.activation.codexConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    run ${pkgs.deno}/bin/deno run --allow-read --allow-write \
      ${./apply-managed.ts} ${managedToml} "$HOME/.codex/config.toml"
  '';
}
