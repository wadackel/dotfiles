{ config, lib, ... }:

{
  programs.starship = {
    enable = true;

    # Shell-independent configuration
    settings = {
      add_newline = true;

      format = lib.concatStrings [
        "$username"
        "$hostname"
        "$directory"
        "$git_branch"
        "$git_commit"
        "$git_state"
        "$cmd_duration"
        "$custom"
        "$line_break"
        "$jobs"
        "$time"
        "$character"
      ];

      command_timeout = 800;

      character = {
        success_symbol = "[❯](bold fg:79)";
        error_symbol = "[❯](bold fg:170)";
        vicmd_symbol = "[❮](bold fg:79)";
      };

      battery.disabled = true;

      directory = {
        truncate_to_repo = false;
        style = "bold fg:104";
      };

      git_branch.style = "fg:103";
      git_state.style = "fg:104";
      git_status.style = "fg:104";
    };
  };
}
