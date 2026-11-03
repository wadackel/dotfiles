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

      # the git-driven test suite runs past go test's 10-minute limit in internal/modify
      doCheck = false;
    }
  );

  # nixpkgs still ships 0.2.0, whose --verify disagrees with the v0.4.0 that CI pins; bump them together.
  gh-actions-lock = pkgs.gh-actions-lock.overrideAttrs (
    finalAttrs: _: {
      version = "0.4.0";

      src = pkgs.fetchFromGitHub {
        owner = "github";
        repo = "gh-actions-lock";
        tag = "v${finalAttrs.version}";
        hash = "sha256-+J5nA1kzwmjY98u0HoJ2rsYD5hLNBhNnwmIT34Gxha4=";
      };

      vendorHash = "sha256-MS0GDAo/COikI5LwfgNPR83MhY6fAFg+Lpmzkv86X3M=";
    }
  );
in
{
  programs.gh = {
    enable = true;

    extensions = [
      pkgs.gh-poi
      gh-stack
      gh-actions-lock
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
