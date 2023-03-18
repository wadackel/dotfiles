local wezterm = require 'wezterm'

wezterm.on('gui-startup', function()
  local _, _, window = wezterm.mux.spawn_window {}
  local w = window:gui_window()
  w:maximize()
  w:toggle_fullscreen()
end)

wezterm.on('window-config-reloaded', function(window, pane)
  window:toast_notification('wezterm', 'Configuration reloaded!', nil, 4000)
end)

return {
  font = wezterm.font('CaskaydiaCove Nerd Font Mono', {
    weight = 'Regular',
    stretch = 'Normal',
    style = 'Normal',
  }),
  font_size = 17.0,

  -- port from: https://github.com/wadackel/vim-dogrun/blob/main/colors/dogrun.vim
  colors = {
    foreground = '#9ea3c0',
    background = '#222433',
    cursor_fg = '#222433',
    cursor_bg = '#9ea3c0',
    selection_bg = '#363e7f',
    ansi = {
      '#111219',
      '#c2616b',
      '#7cbe8c',
      '#8e8a6f',
      '#4c89ac',
      '#6c75cb',
      '#73c1a9',
      '#9ea3c0',
    },
    brights = {
      '#545c8c',
      '#b871b8',
      '#7cbe8c',
      '#a8a384',
      '#589ec6',
      '#929be5',
      '#59b6b6',
      '#9ea3c0',
    },
  },

  enable_tab_bar = false,
  enable_scroll_bar = false,

  window_close_confirmation = 'NeverPrompt',
  window_decorations = 'RESIZE',
  window_padding = {
    left = '1cell',
    right = '1cell',
    top = '0.5cell',
    bottom = '0.5cell',
  },

  initial_cols = 190,
  initial_rows = 60,

  keys = {
    {
      key = 'r',
      mods = 'SUPER',
      action = wezterm.action.ReloadConfiguration,
    },
    {
      key = 'Enter',
      mods = 'SUPER',
      action = wezterm.action.ToggleFullScreen,
    },
    {
      key = 'u',
      mods = 'SUPER',
      action = wezterm.action_callback(function(window, pane)
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
  },
}
