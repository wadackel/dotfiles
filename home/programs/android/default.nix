{
  config,
  lib,
  pkgs,
  inputs,
  profile ? null,
  ...
}:

let
  # A separate nixpkgs instead of widening the flake's allowUnfreePredicate:
  # the SDK's archives are named `platforms`, `tools`, `emulator` and `cmake`,
  # so allowing them by name would allow any package that shares those names.
  androidPkgs = import inputs.nixpkgs {
    inherit (pkgs.stdenv.hostPlatform) system;
    config = {
      allowUnfree = true;
      android_sdk.accept_license = true;
    };
  };

  sdk =
    (androidPkgs.androidenv.composeAndroidPackages {
      platformVersions = [ "36" ];
      buildToolsVersions = [ "35.0.0" ];
      includeEmulator = true;
      includeSystemImages = true;
      systemImageTypes = [ "google_apis" ];
      abiVersions = [ "arm64-v8a" ];
    }).androidsdk;

  sdkLink = "${config.home.homeDirectory}/Library/Android/sdk";
in
{
  config = lib.mkIf (profile == "private") {
    # adb and emulator already resolve through this link (packages/, zsh/);
    # the package is on PATH for avdmanager and sdkmanager.
    home.packages = [ sdk ];

    home.file."Library/Android/sdk".source = "${sdk}/libexec/android-sdk";

    # The emulator otherwise derives the SDK root from its own resolved path,
    # which is the emulator-only store package with no system images in it.
    home.sessionVariables.ANDROID_HOME = sdkLink;
  };
}
