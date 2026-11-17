{ dotfiles, ... }:
{
  # agent-browser comes from mise (home/programs/mise). Link the file alone: the daemon
  # writes its .pid, .sock and sessions/ into ~/.agent-browser itself.
  # Unlike the built-in 1h default, an explicit timeout also reaches headed and attached
  # (--cdp / --auto-connect) browsers: a --headed window closes after 20 idle minutes,
  # while an attached one is only disconnected, so the user's own Chrome stays open.
  home.file.".agent-browser/config.json".source = dotfiles.linkHere ./. "config.json";
}
