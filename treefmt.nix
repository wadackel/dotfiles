{ ... }:
{
  # プロジェクトのルートファイルを指定
  projectRootFile = "flake.nix";

  # Vendored 由来のファイルは整形対象から除外する (上流との diff を保つ)
  settings.excludes = [ "home/programs/agents/skills/figma-*/**" ];

  # deadnix の --edit が先に走るよう priority で順序を固定する。逆順だと
  # deadnix の編集結果が nixfmt 正規形にならず --fail-on-change が
  # 1 パスで収束しない。
  programs.nixfmt.enable = true;
  programs.nixfmt.priority = 1;
  programs.deadnix.enable = true;

  # deno fmt は ts/tsx のみ対象にする。既定の includes は md/json 等も含み、
  # vendored スキルの Markdown 折り返しに大量の churn を生む。
  programs.deno.enable = true;
  programs.deno.includes = [
    "*.ts"
    "*.tsx"
  ];

  # ルートの stylua.toml が祖先探索でそのまま尊重される
  programs.stylua.enable = true;
}
