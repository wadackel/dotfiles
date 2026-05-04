{ dotfiles, ... }:
{
  programs.opencode = {
    enable = true;
  };

  home.file.".config/opencode/opencode.json".source = dotfiles.linkHere ./. "opencode.json";
  # plugin.ts (Bun) imports `./plugin_logic.ts` and `./agent-presence.ts` via
  # URL-based relative resolution — symlink realpath is not followed — so both
  # helpers must land in the same ~/.config/opencode/ directory as siblings.
  # agent-presence.ts は claude / codex と共有しており、実体は
  # home/programs/tmux/agent-presence.ts にある。worktree 内では
  # home/programs/opencode/agent-presence.ts が in-worktree symlink で指している。
  home.file.".config/opencode/plugin.ts".source = dotfiles.linkHere ./. "plugin.ts";
  home.file.".config/opencode/plugin_logic.ts".source = dotfiles.linkHere ./. "plugin_logic.ts";
  home.file.".config/opencode/agent-presence.ts".source = dotfiles.linkHere ./. "agent-presence.ts";
}
