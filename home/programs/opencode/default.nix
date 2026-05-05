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
  # pane-shared.ts は claude/codex/opencode 共通の SSOT。worktree 内では
  # home/programs/opencode/pane-shared.ts が ../tmux/pane-shared.ts への
  # in-worktree symlink。agent-presence.ts と同形の 2 段階 symlink chain。
  home.file.".config/opencode/pane-shared.ts".source = dotfiles.linkHere ./. "pane-shared.ts";
}
