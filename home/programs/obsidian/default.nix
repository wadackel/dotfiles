{ ... }:
{
  # Obsidian ships its CLI as the app binary itself; nothing lands on PATH by default.
  # A symlink to the binary makes Electron resolve helper apps from the link's own
  # directory, which fails with "Unable to find helper app"; exec keeps argv[0] on the
  # real bundle path.
  home.file.".local/bin/obsidian" = {
    executable = true;
    text = ''
      #!/bin/sh
      exec /Applications/Obsidian.app/Contents/MacOS/Obsidian "$@"
    '';
  };
}
