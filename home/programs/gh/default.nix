{
  pkgs,
  ...
}:

let
  # nixpkgs still ships 0.1.1 (NixOS/nixpkgs#571486 is open); drop this once it lands.
  gh-stack = pkgs.gh-stack.overrideAttrs (
    finalAttrs: old: {
      version = "0.2.1";

      src = pkgs.fetchFromGitHub {
        owner = "github";
        repo = "gh-stack";
        tag = "v${finalAttrs.version}";
        hash = "sha256-Mq4jAqeSHDuCiDYSa40okrq06UhC3dZGjgCXJKMbgzU=";
      };

      vendorHash = "sha256-TC1mSXYjOQo00fb2yuGdk1rl6z6rp0WT3AmzXomPzis=";

      # the go-modules derivation inherits the installAgentSkills hook but has no pname
      passthru = old.passthru // {
        overrideModAttrs = _: _: {
          dontInstallAgentSkills = true;
        };
      };

      # some tests resolve branches through git and need to run inside a repository
      preCheck = (old.preCheck or "") + ''
        git init --quiet
      '';
    }
  );
in
{
  programs.gh = {
    enable = true;

    extensions = [
      pkgs.gh-poi
      gh-stack
    ];

    settings = {
      git_protocol = "ssh";
      prompt = "enabled";

      aliases = {
        co = "pr checkout";
      };
    };
  };
}
