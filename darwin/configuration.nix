{
  config,
  pkgs,
  username,
  homeDir,
  profile,
  ...
}:

{
  # システム情報
  system.stateVersion = 5;

  # Touch ID for sudo を有効化（tmux内でも動作）
  security.pam.services.sudo_local = {
    touchIdAuth = true;
    reattach = true; # tmux/screen内でTouch IDを有効化
  };

  # プライマリユーザー設定（Dock など per-user 設定に必要）
  system.primaryUser = username;

  nix.settings = {
    experimental-features = "nix-command flakes";
    # ビルドキャッシュを有効化
    substituters = [ "https://cache.nixos.org/" ];
    trusted-public-keys = [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
    ];
  };

  # システムパッケージ（必要最小限）
  environment.systemPackages = [ pkgs.vim ];

  # Homebrew package management
  homebrew = {
    enable = true;

    # Cleanup mode enabled - remove packages not in configuration
    onActivation = {
      cleanup = "uninstall"; # Remove packages not in configuration
      autoUpdate = false; # Keep stable during migration
      upgrade = false; # Prevent automatic upgrades
    };

    # Global Homebrew settings
    global = {
      # brewfile = true; # Temporarily disabled due to formula lookup issue
      lockfiles = false; # Don't write lockfiles to Nix store
    };

    # Tap configuration (13 repositories after cleanup)
    taps = [
      "homebrew/bundle"
      "homebrew/cask-fonts"
      "homebrew/cask-versions"
      "wadackel/tap"
      "github/gh"
      "hashicorp/tap"
    ];

    # Formula configuration
    brews = [
      # Custom Tap Tools
      "ofsht"
      "pinact"
      "gemini-cli"

      # Python Ecosystem
      "python@3.14"
      "python-packaging"
      "mpdecimal"
      "pillow"
      "numpy"

      # CLI Tools (essential only)
      "cask"
      "z3"
    ];

    # Cask configuration
    casks = [
      # Applications
      "1password-cli"
      "arc"
      "chromium"
      "claude-code"
      "codex"
      "google-chrome@canary"
      "karabiner-elements"
      "kap"
      "keycastr"
      "raycast"
      "wezterm"
      "xcodes-app"
      "imageoptim"

      # Fonts (Nerd Fonts)
      "font-caskaydia-cove-nerd-font"
      "font-hack-nerd-font"
      "font-jetbrains-mono-nerd-font"
      "font-monoid-nerd-font"
      "font-roboto-mono-nerd-font"
      "font-sauce-code-pro-nerd-font"
      "font-ubuntu-mono-nerd-font"
    ];

    # Cask installation arguments
    caskArgs = {
      appdir = "/Applications"; # Use absolute path (tilde may not expand)
    };
  };

  # シェル設定
  programs.zsh.enable = true; # /etc/zshenv, /etc/zprofile を Nix 管理に
  environment.shells = [
    pkgs.bash
    pkgs.zsh
  ]; # /etc/shells に Nix の bash, zsh を登録

  # ユーザー設定
  users.users.${username} = {
    name = username;
    home = homeDir;
    shell = pkgs.zsh; # デフォルトシェルを Nix の zsh に変更
  };

  # === macOS キーボード設定 ===
  system.keyboard = {
    enableKeyMapping = true;
    remapCapsLockToControl = true;
  };

  # === macOS システム設定 ===
  system.defaults = {
    # キーボード・入力設定
    NSGlobalDomain = {
      # キーリピート設定
      KeyRepeat = 2; # キーリピート速度
      InitialKeyRepeat = 15; # リピート開始までの遅延

      # フルキーボードアクセス
      AppleKeyboardUIMode = 3; # すべてのコントロールにTab/Shift+Tabでアクセス可能

      # プレス&ホールド無効化（vim/nvim用）
      ApplePressAndHoldEnabled = false; # キー長押しでアクセント文字メニューを無効化

      # 自動変換の無効化（コーディング用）
      NSAutomaticSpellingCorrectionEnabled = false; # 自動スペル修正無効化
      NSAutomaticCapitalizationEnabled = false; # 自動大文字化無効化
      NSAutomaticQuoteSubstitutionEnabled = false; # 引用符の自動変換OFF
      NSAutomaticDashSubstitutionEnabled = false; # -- を — に変換しない
      NSAutomaticPeriodSubstitutionEnabled = false; # スペース2回で . 挿入しない

      # Function Keys 設定
      "com.apple.keyboard.fnState" = true; # F1-F12を標準機能キーとして使用

      # スワイプナビゲーション
      AppleEnableSwipeNavigateWithScrolls = true; # 2本指スワイプでブラウザの戻る/進む

      # ファイル保存設定
      NSDocumentSaveNewDocumentsToCloud = false; # 新規ドキュメントをiCloudではなくローカルに保存

      # 外観・アニメーション設定
      # work profile: 常時表示、private profile: スクロール時のみ表示
      AppleShowScrollBars = if profile == "work" then "Always" else "Automatic";
      NSAutomaticWindowAnimationsEnabled = true; # ウィンドウ開閉アニメーション
      NSScrollAnimationEnabled = true; # スムーズスクロール
      NSWindowResizeTime = 0.2; # ウィンドウリサイズ速度

      # トラックパッド速度・スクロール設定
      "com.apple.trackpad.scaling" = 1.5; # トラックパッド速度（0-3の範囲）
      "com.apple.swipescrolldirection" = true; # ナチュラルスクロール
      "com.apple.trackpad.forceClick" = true; # Force Click
    };

    # トラックパッド設定
    trackpad = {
      # 基本機能
      Clicking = true; # タップでクリック
      TrackpadRightClick = true; # 2本指クリック（副ボタン）
      TrackpadThreeFingerDrag = true; # 3本指ドラッグ

      # スクロールとジェスチャー
      TrackpadMomentumScroll = true; # 慣性スクロール

      # 2本指ジェスチャー
      TrackpadPinch = true; # ピンチでズーム
      TrackpadRotate = true; # 2本指回転
      TrackpadTwoFingerDoubleTapGesture = true; # スマートズーム
      TrackpadTwoFingerFromRightEdgeSwipeGesture = 3; # 通知センター

      # 3本指ジェスチャー
      TrackpadThreeFingerTapGesture = 2; # 「調べる」機能
      TrackpadThreeFingerHorizSwipeGesture = 2; # フルスクリーン間のスワイプ
      TrackpadThreeFingerVertSwipeGesture = 2; # Mission Control/App Exposé

      # 4本指ジェスチャー
      TrackpadFourFingerHorizSwipeGesture = 2; # デスクトップ間の切り替え
      TrackpadFourFingerVertSwipeGesture = 2; # Mission Control/デスクトップ表示
      TrackpadFourFingerPinchGesture = 2; # Launchpad

      # 触覚フィードバック
      FirstClickThreshold = 1; # 通常クリックの圧：中
      SecondClickThreshold = 1; # Force Touch の圧：中
    };

    # Finder 設定
    finder = {
      # 基本表示設定
      AppleShowAllExtensions = true; # すべての拡張子を表示
      ShowPathbar = true; # パスバーを表示
      ShowStatusBar = true; # ステータスバーを表示
      FXEnableExtensionChangeWarning = false; # 拡張子変更の警告を無効化

      # デスクトップアイコン表示
      ShowExternalHardDrivesOnDesktop = true; # 外部ドライブをデスクトップに表示
      ShowRemovableMediaOnDesktop = true; # リムーバブルメディアをデスクトップに表示

      # Finder詳細設定
      QuitMenuItem = true; # Finderの「終了」メニューを有効化
      FXDefaultSearchScope = "SCcf"; # 検索デフォルトスコープを「現在のフォルダ」に
      FXPreferredViewStyle = "clmv"; # デフォルトビューをカラム表示に
      _FXSortFoldersFirst = true; # 名前順ソート時にフォルダを先頭に
      _FXSortFoldersFirstOnDesktop = true; # デスクトップでもフォルダを先頭に
      NewWindowTarget = "Home"; # 新規ウィンドウでホームフォルダを開く
      FXRemoveOldTrashItems = false; # ゴミ箱の30日後自動削除を無効化（手動管理を優先）

      # 開発者向け設定
      AppleShowAllFiles = true; # 隠しファイルを表示（.gitなどが見える）
    };

    # Dock 設定
    dock = {
      # 基本設定
      autohide = true;
      tilesize = 28;
      show-recents = false;
      mineffect = "scale";
      minimize-to-application = true;

      # 拡大・表示設定
      launchanim = true; # アプリ起動時のアニメーション
      magnification = false; # マウスオーバー時のアイコン拡大
      show-process-indicators = true; # 実行中アプリのインジケータ表示
      showhidden = true; # 非表示アプリを半透明で表示
      expose-group-apps = true; # Mission Controlでアプリごとにグループ化

      # Spaces設定
      mru-spaces = false; # 最近使った順ではなく固定順でSpacesを並べる

      # ジェスチャー設定
      showAppExposeGestureEnabled = true; # App Exposé ジェスチャー
      showMissionControlGestureEnabled = true; # Mission Control ジェスチャー
      showDesktopGestureEnabled = true; # デスクトップ表示ジェスチャー
      showLaunchpadGestureEnabled = true; # Launchpad ジェスチャー
    };

    # スクリーンショット設定
    screencapture = {
      location = "~/Desktop"; # 保存先
      type = "png"; # ファイル形式
      disable-shadow = false; # ウィンドウショット時の影を保持
      show-thumbnail = true; # プレビューサムネイル表示
      include-date = false; # ファイル名に日時を含めない
    };

    # Spaces設定
    spaces = {
      spans-displays = false; # ディスプレイごとに個別のSpaces
    };

    # メニューバー時計設定
    menuExtraClock = {
      Show24Hour = true; # 24時間表示
      ShowDate = 0; # 日付非表示（コンパクトに）
      ShowDayOfWeek = false; # 曜日非表示
      ShowSeconds = false; # 秒非表示（CPU負荷軽減）
      IsAnalog = false; # デジタル時計
    };

    # コントロールセンター設定
    controlcenter = {
      BatteryShowPercentage = true; # バッテリー残量を%表示
      Bluetooth = true; # Bluetoothアイコン表示
      Sound = true; # 音量アイコン表示
    };

    # ウィンドウマネージャ設定
    WindowManager = {
      EnableStandardClickToShowDesktop = true; # 壁紙クリックでデスクトップ表示
      StandardHideDesktopIcons = false; # デスクトップアイコンを常に表示
      HideDesktop = false; # デスクトップを隠さない
      AppWindowGroupingBehavior = false; # ウィンドウを個別に扱う
    };

    # カスタム設定
    CustomUserPreferences = {
      # TimeMachine自動確認の無効化
      "com.apple.TimeMachine" = {
        DoNotOfferNewDisksForBackup = true;
      };

      # .DS_Store作成の抑制
      "com.apple.desktopservices" = {
        DSDontWriteNetworkStores = true; # ネットワークドライブ
        DSDontWriteUSBStores = true; # USBドライブ
      };

      # アクセシビリティ: スクロールズーム設定
      "com.apple.universalaccess" = {
        HIDScrollZoomModifierMask = 262144; # Control (^) キー
        closeViewScrollWheelToggle = true; # スクロールでズーム有効化
      };
    };
  };

  # 設定反映スクリプト
  system.activationScripts.postActivation.text = ''
    # Dock設定を即座に反映
    killall Dock 2>/dev/null || true

    # Finder設定を即座に反映
    killall Finder 2>/dev/null || true
  '';
}
