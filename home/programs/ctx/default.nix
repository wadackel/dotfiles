{ config, ... }:

{
  # Nix でのインストールでは ctx 自身が LaunchAgent を登録できないため、ログイン時に setup を
  # 1 回だけ実行してデーモンを起こさせる。launchd でデーモンを直接常駐させると ctx の自己修復と
  # 二重管理になる。デーモンは別プロセスグループで残るため、ジョブ終了時に巻き込まないようにする。
  launchd.agents.ctx-setup = {
    enable = true;
    config = {
      ProgramArguments = [
        "${config.home.profileDirectory}/bin/ctx"
        "setup"
        "--quiet"
      ];
      RunAtLoad = true;
      AbandonProcessGroup = true;
      ProcessType = "Background";
      StandardOutPath = "${config.home.homeDirectory}/Library/Logs/ctx-setup.log";
      StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/ctx-setup.log";
    };
  };
}
