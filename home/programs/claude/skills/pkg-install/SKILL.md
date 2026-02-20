---
name: pkg-install
description: ツールやパッケージを dotfiles リポジトリに追加する。home-manager（Nix）を優先し、なければ Homebrew で導入する。「xxxをインストールして」「xxxを追加して」「xxxを入れて」「xxxを導入して」「install xxx」「set up xxx」などのリクエストで使用。
argument-hint: [package-name]
---

# Package Install

`$ARGUMENTS` をこの dotfiles リポジトリに追加する。

## Quick Start

/pkg-install <package-name>

## 判断フロー

```
GUI アプリか？
  YES -> homebrew.casks (darwin/configuration.nix)
  NO  -> `nix search nixpkgs#<name>` で見つかるか？
           NO  -> homebrew.brews (darwin/configuration.nix)
           YES -> home-manager に programs.<name> があるか？
                    YES -> home/programs/<name>/default.nix (新規モジュール)
                    NO  -> home/programs/packages/default.nix (home.packages)
```

## ワークフロー

### 1. 分類と検索

- **GUI アプリ** → Step 3 (Homebrew)
- **CLI ツール** → `nix search nixpkgs#<name>` で nixpkgs を確認

見つからない場合は一般的な別名も試す（例: `rg` → `ripgrep`）。それでもなければ Step 3 へ。

### 2. Nix インストール方法の選択

home-manager に `programs.<name>` モジュールがあるか判断する。不確かな場合は Web 検索で確認。

**専用モジュールがある場合** → `home/programs/<name>/default.nix` を新規作成:

```nix
{ config, lib, ... }:
{
  programs.<name> = {
    enable = true;
    # シェル統合がある場合:
    # enableZshIntegration = lib.mkIf (config.programs.zsh.enable or false) true;
    # enableFishIntegration = lib.mkIf (config.programs.fish.enable or false) true;
    # enableBashIntegration = lib.mkIf (config.programs.bash.enable or false) true;
  };
}
```

auto-discovery により import 登録は不要。設定ファイルは同ディレクトリに配置。

**専用モジュールがない場合** → `home/programs/packages/default.nix` の適切なカテゴリに追加:

```nix
<package-name> # 短い説明
```

### 3. Homebrew でインストール

`darwin/configuration.nix` の該当セクションに追加:

- **CLI formula** → `homebrew.brews`
- **GUI app** → `homebrew.casks`

### 4. 検証と適用

1. 新規ファイルがあれば `git add home/programs/<name>/`
2. `nix fmt` && `nix flake check`
3. `whoami` でプロファイル判定（`wadackel` → `.#private`、`tsuyoshi.wada` → `.#work`）
4. `sudo darwin-rebuild switch --flake .#<profile>`
5. `which <name>` や `<name> --version` で動作確認

## 注意事項

- ユーザーが「Homebrew で」と明示した場合はその指示を優先
- mise 管理のツール（Node.js, Go, Rust 等）は `home/programs/mise/default.nix` を先に確認し重複を避ける
- `darwin-rebuild` が失敗した場合は優先順位の次の方法にフォールバック
