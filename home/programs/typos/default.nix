{
  dotfiles,
  ...
}:

{
  # Typos spell checker configuration
  xdg.configFile."typos.toml".source = dotfiles.linkHere ./. "typos.toml";
}
