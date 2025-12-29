{
  config,
  pkgs,
  lib,
  ...
}:

{
  programs.fish = {
    enable = true;
    package = pkgs.fish;

    # rustup の環境設定を維持
    interactiveShellInit = ''
      # Cargo environment
      if test -f "$HOME/.cargo/env.fish"
        source "$HOME/.cargo/env.fish"
      end
    '';
  };
}
