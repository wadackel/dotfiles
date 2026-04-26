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
    model = "gpt-5.4";
    model_reasoning_effort = "high";
    model_reasoning_summary = "detailed";
    sandbox_mode = "workspace-write";
    notify = [
      "bash"
      "${config.home.homeDirectory}/.codex/notify.sh"
    ];
    personality = "pragmatic";
    web_search = "live";

    features = {
      streamable_shell = true;
      view_image_tool = true;
    };

    sandbox_workspace_write = {
      exclude_tmpdir_env_var = false;
      exclude_slash_tmp = false;
      network_access = true;
    };
  };

  managedToml = tomlFormat.generate "codex-managed.toml" managed;
in
{
  home.packages = [ pkgs.codex ];

  # Intentionally NOT terminated with `|| true` (unlike mise/default.nix):
  # a splice failure means ~/.codex/config.toml is in an unknown state, so
  # darwin-rebuild should fail loudly rather than complete with a silent broken config.
  home.activation.codexConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    run ${pkgs.deno}/bin/deno run --allow-read --allow-write \
      ${./apply-managed.ts} ${managedToml} "$HOME/.codex/config.toml"
  '';
}
