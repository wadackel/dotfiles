{
  config,
  pkgs,
  lib,
  ...
}:

{
  # Shell-independent CLI tools
  home.packages = with pkgs; [
    # JSON/YAML/XML Processing
    jq # JSON processor
    yq-go # YAML/JSON/XML processor (Go version)

    # Text Editors
    neovim # Hyperextensible Vim-based text editor
    vim # Vi IMproved - advanced text editor

    # Terminal Utilities
    htop # Interactive process viewer
    tmux # Terminal multiplexer
    tree # Display directory tree structure
    procps # Process monitoring utilities (includes watch)

    # Code Analysis & Development Tools
    ast-grep # Fast and polyglot tool for code searching, linting, rewriting
    just # Handy way to save and run project-specific commands
    tokei # Fast code statistics tool
    tig # Text-mode interface for git

    # Repository Management
    ghq # Remote repository management made easy

    # Security & Certificates
    mkcert # Simple tool for making locally-trusted development certificates

    # Container & Cloud Tools
    dive # Docker image layer analyzer
    cloudflared # Cloudflare Tunnel client

    # Media Processing
    ffmpeg # Complete solution to record, convert and stream audio and video
    imagemagick # Image manipulation tool
    vhs # CLI tool for generating terminal GIFs
    libjpeg_turbo # JPEG image codec (provides cjpeg, djpeg)
    pngpaste # Paste PNG images from clipboard to file
    vips # Image processing library

    # Build Tools
    cmake # Cross-platform make

    # Network Tools
    curl # Get a file from an HTTP, HTTPS or FTP server
    wget # Internet file retriever

    # System Utilities
    gawk # GNU awk utility
    gnused # GNU implementation of the sed stream editor
    watchman # File watching service
  ];

  # Shell-independent PATH additions
  home.sessionPath = [
    "${config.home.homeDirectory}/.local/bin"
    "${config.home.homeDirectory}/.cargo/bin"
    "${config.home.homeDirectory}/.wasmtime/bin"
    "${config.home.homeDirectory}/Library/pnpm"
    "${config.home.homeDirectory}/.poetry/bin"
    "${config.home.homeDirectory}/.yarn/bin"
    "${config.home.homeDirectory}/Library/Android/sdk/platform-tools"
    "${config.home.homeDirectory}/flutter/bin"
    "${config.home.homeDirectory}/fvm/default/bin"
    "${config.home.homeDirectory}/.rbenv/bin"
    "${config.home.homeDirectory}/.pub-cache/bin"
  ];
}
