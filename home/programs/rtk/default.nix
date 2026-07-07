{ config, dotfiles, ... }:
{
  # rtk (Rust Token Killer) declarative configuration
  # - config file: rtk reads dirs::config_dir(), which on macOS is
  #   ~/Library/Application Support/rtk/config.toml — NOT the XDG path
  # - telemetry: disabled via env (rtk README "Override via environment")
  home.file."Library/Application Support/rtk/config.toml".source =
    dotfiles.linkHere ./. "config.toml";

  home.sessionVariables = {
    RTK_TELEMETRY_DISABLED = "1";
  };
}
