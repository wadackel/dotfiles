{
  description = "Home Manager and nix-darwin configuration for multiple environments";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix-darwin = {
      url = "github:LnL7/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    treefmt-nix.url = "github:numtide/treefmt-nix";
    zellij-tab-name = {
      url = "https://github.com/Cynary/zellij-tab-name/releases/download/v0.4.1/zellij-tab-name.wasm";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      nix-darwin,
      treefmt-nix,
      zellij-tab-name,
      ...
    }:
    let
      system = "aarch64-darwin";

      # Store root path for relative path calculation
      storeRoot = self.outPath;

      # Reconstruct inputs for passing to modules
      inputs = {
        inherit
          self
          nixpkgs
          home-manager
          nix-darwin
          treefmt-nix
          zellij-tab-name
          ;
      };

      # treefmt 設定の評価
      treefmtEval = treefmt-nix.lib.evalModule nixpkgs.legacyPackages.${system} ./treefmt.nix;

      overlays = [
        (final: prev: {
          zellij-tab-name = zellij-tab-name;
        })
      ];

      # Profile definitions - Single source of truth for all configurations
      profiles = {
        private = {
          username = "wadackel";
          hostname = "wadackels-MacBook-Air";
        };
        work = {
          username = "tsuyoshi.wada";
          hostname = "tsuyoshiwadas-MacBook-Pro";
        };
      };

      # Helper to derive homeDir from username (macOS convention)
      mkHomeDir = username: "/Users/${username}";

      # Helper function to create home-manager configuration
      mkHome =
        { username, homeDir }:
        home-manager.lib.homeManagerConfiguration {
          pkgs = nixpkgs.legacyPackages.${system};
          extraSpecialArgs = {
            inherit
              inputs
              username
              homeDir
              storeRoot
              ;
          };
          modules = [
            ./lib/dotfiles-path.nix
            ./home/home.nix
            { nixpkgs.overlays = overlays; }
          ];
        };

      # Helper function to create nix-darwin configuration
      mkDarwin =
        {
          hostname,
          username,
          homeDir,
          profile,
        }:
        nix-darwin.lib.darwinSystem {
          inherit system;
          specialArgs = {
            inherit
              username
              homeDir
              hostname
              profile
              ;
          };
          modules = [
            ./darwin/configuration.nix
            home-manager.darwinModules.home-manager
            {
              nixpkgs.overlays = overlays;
              networking.hostName = hostname;
              system.primaryUser = username;
              users.users.${username} = {
                name = username;
                home = homeDir;
              };
              home-manager.useGlobalPkgs = true;
              home-manager.useUserPackages = true;
              home-manager.backupFileExtension = "backup";
              home-manager.users.${username} = {
                imports = [
                  ./lib/dotfiles-path.nix
                  ./home/home.nix
                ];
              };
              home-manager.extraSpecialArgs = {
                inherit
                  inputs
                  username
                  homeDir
                  storeRoot
                  ;
              };
            }
          ];
        };
    in
    {
      formatter.${system} = treefmtEval.config.build.wrapper;

      # フォーマットチェック（CI用）
      checks.${system} = {
        formatting = treefmtEval.config.build.check self;
      };

      # Home Manager configurations (standalone, optional)
      # Generated from profiles map (keys = username)
      homeConfigurations =
        let
          toHomeConfig = _name: profile: {
            name = profile.username;
            value = mkHome {
              username = profile.username;
              homeDir = mkHomeDir profile.username;
            };
          };
        in
        builtins.listToAttrs (
          builtins.map (name: toHomeConfig name profiles.${name}) (builtins.attrNames profiles)
        );

      # nix-darwin configurations (includes home-manager)
      # Generated from profiles map
      darwinConfigurations = builtins.mapAttrs (
        name: profile:
        mkDarwin {
          hostname = profile.hostname;
          username = profile.username;
          homeDir = mkHomeDir profile.username;
          profile = name;
        }
      ) profiles;
    };
}
