local wezterm = require("wezterm")

local MO_BIN = "/etc/profiles/per-user/" .. (os.getenv("USER") or "") .. "/bin/mo"

wezterm.on("gui-startup", function()
  local _, _, window = wezterm.mux.spawn_window({})
  local w = window:gui_window()
  w:maximize()
  w:toggle_fullscreen()
end)

wezterm.on("window-config-reloaded", function(window)
  window:toast_notification("wezterm", "Configuration reloaded!", nil, 4000)
end)

wezterm.on("open-uri", function(window, pane, uri)
  local target = uri:match("^mo:(.+)$")
  if not target then
    return
  end

  target = target:gsub(":%d+:%d+$", ""):gsub(":%d+$", "")

  if target:sub(1, 2) == "~/" then
    target = (os.getenv("HOME") or "") .. target:sub(2)
  end

  if target:sub(1, 1) ~= "/" then
    local cwd = pane:get_current_working_dir()
    if cwd then
      -- 新しい WezTerm は Url userdata の file_path を返す。空文字の場合に備え string fallback も保持
      local cwd_path = (cwd.file_path and cwd.file_path ~= "") and cwd.file_path
        or tostring(cwd):gsub("^file://[^/]*", "")
      if cwd_path and cwd_path ~= "" then
        target = cwd_path:gsub("/$", "") .. "/" .. target
      end
    end
  end

  -- 制御バイト混入を拒否（OSC 8 / passthrough 経由で与えられた攻撃ペイロードを弾く）
  if target:find("[%z\1-\31\127]") then
    return false
  end

  -- 絶対パスでない場合は `./` 接頭辞で先頭の `-` を中和する。さらに `--` 区切りで mo の
  -- 引数パーサが target を以降の値として確実に扱うようにする
  if target:sub(1, 1) ~= "/" then
    target = "./" .. target
  end

  wezterm.background_child_process({ MO_BIN, "--open", "--", target })
  return false
end)

return {
  audible_bell = "SystemBeep",
  notification_handling = "AlwaysShow",

  -- disable ligatures: https://wezfurlong.org/wezterm/config/font-shaping.html#advanced-font-shaping-options
  harfbuzz_features = { "calt=0", "clig=0", "liga=0" },

  font = wezterm.font_with_fallback({
    { family = "CaskaydiaCove Nerd Font Mono" },
    { family = "CaskaydiaCove Nerd Font Mono", assume_emoji_presentation = true },
    { family = "Noto Sans CJK JP" },
  }),

  font_size = 13.0,

  color_scheme = "dogrun",

  enable_tab_bar = false,
  enable_scroll_bar = false,

  window_close_confirmation = "NeverPrompt",
  window_decorations = "RESIZE",
  window_padding = {
    left = "1cell",
    right = "1cell",
    top = "0.5cell",
    bottom = "0.5cell",
  },

  initial_cols = 190,
  initial_rows = 60,

  macos_forward_to_ime_modifier_mask = "ALT|CTRL|SHIFT",
  disable_default_key_bindings = true,
  keys = {
    {
      key = "q",
      mods = "SUPER",
      action = wezterm.action.QuitApplication,
    },
    {
      key = "w",
      mods = "SUPER",
      action = wezterm.action.CloseCurrentPane({ confirm = true }),
    },
    {
      key = "n",
      mods = "SUPER",
      action = wezterm.action.SpawnWindow,
    },
    {
      key = "r",
      mods = "SUPER",
      action = wezterm.action.ReloadConfiguration,
    },
    {
      key = "v",
      mods = "SUPER",
      action = wezterm.action.PasteFrom("Clipboard"),
    },
    {
      key = "Enter",
      mods = "SUPER",
      action = wezterm.action.ToggleFullScreen,
    },
    {
      key = "Enter",
      mods = "SHIFT",
      action = wezterm.action.SendString("\n"),
    },
    {
      key = "-",
      mods = "SUPER",
      action = wezterm.action.DecreaseFontSize,
    },
    {
      key = "+",
      mods = "SUPER|SHIFT",
      action = wezterm.action.IncreaseFontSize,
    },
    {
      key = "0",
      mods = "SUPER",
      action = wezterm.action.ResetFontSize,
    },
    {
      key = "u",
      mods = "SUPER",
      action = wezterm.action_callback(function(window)
        local config = window:get_config_overrides() or {}
        if not config.text_background_opacity then
          config.window_background_opacity = 0.9
          config.text_background_opacity = 0.9
        else
          config.window_background_opacity = nil
          config.text_background_opacity = nil
        end
        window:set_config_overrides(config)
      end),
    },
    -- fix wezterm can't send `<C-Q>` key.
    {
      key = "q",
      mods = "CTRL",
      action = wezterm.action.SendString("\x11"),
    },
  },

  disable_default_mouse_bindings = true,
  mouse_bindings = {
    -- Bind 'Up' event of SUPER-Click to open hyperlinks
    {
      event = { Down = { streak = 1, button = "Left" } },
      mods = "SUPER",
      action = wezterm.action.OpenLinkAtMouseCursor,
    },
    -- Disable the 'Down' event of SUPER-Click to avoid weird program behaviors
    {
      event = { Up = { streak = 1, button = "Left" } },
      mods = "SUPER",
      action = wezterm.action.Nop,
    },
  },

  hyperlink_rules = {
    -- Localhost links
    {
      regex = "\\b\\w+://[\\w.-]+\\S*\\b",
      format = "$0",
    },
    -- Markdown file paths: abs / rel / ~/ / bare / with :line[:col]
    -- (?!\.\w) で .md.bak 等の誤マッチを除外
    {
      regex = [[[\w./@+~\-]+\.md(?!\.\w)(?::\d+(?::\d+)?)?]],
      format = "mo:$0",
    },
  },
}
