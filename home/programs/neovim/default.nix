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

  # Neovim and tools (LSP servers, linters, formatters)
  home.packages = with pkgs; [
    neovim

    # LSP servers
    astro-language-server
    (lib.hiPrio gopls) # gotools も bin/modernize を提供するため優先度を上げて衝突回避
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
