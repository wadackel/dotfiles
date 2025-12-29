local wezterm = require("wezterm")

wezterm.on("gui-startup", function()
  local _, _, window = wezterm.mux.spawn_window({})
  local w = window:gui_window()
  w:maximize()
  w:toggle_fullscreen()
end)

wezterm.on("window-config-reloaded", function(window)
  window:toast_notification("wezterm", "Configuration reloaded!", nil, 4000)
end)

return {
  audible_bell = "SystemBeep",
  notification_handling = "AlwaysShow",

  -- disable ligatures: https://wezfurlong.org/wezterm/config/font-shaping.html#advanced-font-shaping-options
  harfbuzz_features = { "calt=0", "clig=0", "liga=0" },

  font = wezterm.font_with_fallback({
    { family = "CaskaydiaCove Nerd Font Mono" },
    { family = "CaskaydiaCove Nerd Font Mono", assume_emoji_presentation = true },
    { family = "Noto Sans JP" },
  }),

  font_size = 15.0,

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
  },
}
