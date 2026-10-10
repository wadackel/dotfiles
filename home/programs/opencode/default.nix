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

  # RTK plugin: opencode の bash/shell tool.execute.before を `rtk rewrite` に通す。
  home.file.".config/opencode/plugins/rtk.ts".source = dotfiles.linkHere ./. "plugins/rtk.ts";

  # opencode-memo worker (Bun script). plugin.ts は session.idle 時に
  # `new URL("./scripts/opencode-memo.ts", import.meta.url)` で兄弟解決し、
  # そのパスを直接実行する（shebang が bun を起動する）ため、scripts/
  # ディレクトリごと ~/.config/opencode/scripts/ に out-of-store symlink で
  # 公開する。opencode-memo.ts は共有ライブラリ（agents/memo、agents/scripts、
  # agents/lib）を実体の相対パスで import する。Bun はスクリプトを実体パスで
  # 解決するので、公開先に兄弟 symlink は要らない。
  home.file.".config/opencode/scripts".source = dotfiles.linkHere ./. "scripts";
}
