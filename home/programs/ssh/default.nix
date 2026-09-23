{ ... }:

{
  programs.ssh = {
    enable = true;
    enableDefaultConfig = false;

    settings."*" = {
      # UseKeychain は macOS の /usr/bin/ssh 専用 (package を null のままにしてシステムの ssh を使う)
      AddKeysToAgent = "yes";
      UseKeychain = "yes";
      IdentityFile = "~/.ssh/id_ed25519";
    };
  };
}
