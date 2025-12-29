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
    zjstatus.url = "github:dj95/zjstatus";
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      nix-darwin,
      treefmt-nix,
      zjstatus,
      ...
    }:
    let
      system = "aarch64-darwin";

      # treefmt 設定の評価
      treefmtEval = treefmt-nix.lib.evalModule nixpkgs.legacyPackages.${system} ./treefmt.nix;

      # zjstatus overlay を定義
      overlays = [
        (final: prev: {
          zjstatus = zjstatus.packages.${system}.default;
        })
      ];

      # Helper function to create home-manager configuration
      mkHome =
        { username, homeDir }:
        home-manager.lib.homeManagerConfiguration {
          pkgs = nixpkgs.legacyPackages.${system};
          extraSpecialArgs = {
            inherit username homeDir;
          };
          modules = [
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
              home-manager.users.${username} = import ./home/home.nix;
              home-manager.extraSpecialArgs = {
                inherit username homeDir;
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
      homeConfigurations = {
        wadackel = mkHome {
          username = "wadackel";
          homeDir = "/Users/wadackel";
        };
        "tsuyoshi.wada" = mkHome {
          username = "tsuyoshi.wada";
          homeDir = "/Users/tsuyoshi.wada";
        };
      };

      # nix-darwin configurations (includes home-manager)
      darwinConfigurations = {
        private = mkDarwin {
          hostname = "wadackels-MacBook-Air";
          username = "wadackel";
          homeDir = "/Users/wadackel";
          profile = "private";
        };
        work = mkDarwin {
          hostname = "tsuyoshiwadas-MacBook-Pro";
          username = "tsuyoshi.wada";
          homeDir = "/Users/tsuyoshi.wada";
          profile = "work";
        };
      };
    };
}
