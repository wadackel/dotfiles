{ profile, lib, ... }:
{
  # Tailscale CLI wrapper for private profile only
  # The App Store / direct-download Tailscale binary requires Bundle.main to resolve correctly,
  # which fails when invoked via symlink (argv[0] points to symlink, not the real bundle path).
  # A shell script wrapper uses exec so argv[0] = real binary path, fixing Bundle.main lookup.
  home.file.".local/bin/tailscale" = lib.mkIf (profile == "private") {
    executable = true;
    text = ''
      #!/bin/sh
      exec /Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"
    '';
  };
}
