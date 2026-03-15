{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  # Neovim configuration
  xdg.configFile = {
    "nvim/init.lua".source = dotfiles.linkHere ./. "init.lua";
  };

  # Tools used by Neovim (LSP servers, linters, formatters)
  home.packages = with pkgs; [
    # LSP servers
    astro-language-server
    gopls
    lua-language-server
    terraform-ls
    typos-lsp
    vim-language-server

    # Linters
    eslint_d
    oxlint
    stylelint

    # Formatters
    biome
    gofumpt
    gotools # goimports
    prettierd
    stylua
  ];
}
