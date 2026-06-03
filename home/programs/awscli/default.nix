{
  config,
  pkgs,
  lib,
  ...
}:

{
  # AWS Command Line Interface v2
  home.packages = with pkgs; [
    awscli2
  ];
}
