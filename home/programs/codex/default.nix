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
  # `apply-managed.ts` overwrites only these keys in ~/.codex/config.toml; others
  # (e.g. [projects.*], [notice], the desktop app's [desktop]) are kept, since
  # Codex and the desktop app mutate them at runtime.
  managed = {
    model = "gpt-6-astra";
    model_context_window = 872000;
    model_reasoning_effort = "xhigh";
    model_reasoning_summary = "concise";
    sandbox_mode = "danger-full-access";
    notify = [
      "${pkgs.bun}/bin/bun"
      "--no-env-file"
      "--no-install"
      "--config=/dev/null"
      "${config.home.homeDirectory}/.codex/scripts/codex-notify.ts"
      "send"
    ];
    personality = "pragmatic";
    web_search = "live";

    features = {
      streamable_shell = true;
      view_image_tool = true;
      external_migration = true;
      hooks = true;
    };

    tui = {
      terminal_title = [
        "app-name"
        "thread-id"
        "activity"
        "thread-name"
        "project-name"
      ];
      status_line = [
        "model-with-reasoning"
        "project-name"
        "git-branch"
        "context-used"
        "five-hour-limit"
        "weekly-limit"
      ];
    };
  };

  managedToml = tomlFormat.generate "codex-managed.toml" managed;
in
{
  home.packages = [ pkgs.codex ];

  # Codex injects AGENTS.md verbatim into <INSTRUCTIONS> without expanding @file
  # references (verified against session rollouts), so the conventions must be
  # inlined as text rather than referenced; editing the source file therefore
  # requires a darwin-rebuild.
  home.file.".codex/AGENTS.md".text =
    "@${config.home.homeDirectory}/.codex/RTK.md\n\n"
    + builtins.readFile ../agents/shared/comment-conventions.md
    + "\n"
    + builtins.readFile ./subagent-policy.md
    + "\n"
    + builtins.readFile ../agents/shared/vault-policy.md;
  home.file.".codex/RTK.md".source = dotfiles.linkHere ./. "RTK.md";
  home.file.".codex/hooks.json".source = ./hooks.json;
  home.file.".codex/scripts".source = dotfiles.linkHere ./. "scripts";
  home.file.".codex/agents".source = dotfiles.linkHere ./. "agents";
  home.file.".agents/skills".source = dotfiles.linkHere ./. "skills";

  # Intentionally NOT terminated with `|| true` (unlike mise/default.nix):
  # a merge failure means ~/.codex/config.toml is in an unknown state, so
  # darwin-rebuild should fail loudly rather than complete with a silent broken config.
  # The script is the one in the worktree, not a store copy: it needs the
  # node_modules that installDotfilesDeps puts there.
  home.activation.codexConfig = lib.hm.dag.entryAfter [ "installDotfilesDeps" ] ''
    run ${pkgs.bun}/bin/bun --no-env-file --no-install --config=/dev/null \
      "${dotfiles.pathHere ./scripts "apply-managed.ts"}" \
      ${managedToml} "$HOME/.codex/config.toml"
  '';
}
