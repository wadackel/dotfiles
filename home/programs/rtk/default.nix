{ config, dotfiles, ... }:
{
  # rtk (Rust Token Killer) declarative configuration
  # - config file: ~/.config/rtk/config.toml
  # - telemetry: disabled via env (rtk README "Override via environment")
  xdg.configFile."rtk/config.toml".source = dotfiles.linkHere ./. "config.toml";

  home.sessionVariables = {
    RTK_TELEMETRY_DISABLED = "1";
  };
}
