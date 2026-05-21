local wezterm = require("wezterm")

local MO_BIN = "/etc/profiles/per-user/" .. (os.getenv("USER") or "") .. "/bin/mo"
local TMUX_BIN = "/etc/profiles/per-user/" .. (os.getenv("USER") or "") .. "/bin/tmux"

local function trim(value)
  return (value or ""):gsub("^%s+", ""):gsub("%s+$", "")
end

local function path_exists(path)
  local success = wezterm.run_child_process({ "/bin/test", "-e", path })
  return success
end

local function tmux(args)
  local command = { TMUX_BIN }
  for _, arg in ipairs(args) do
    table.insert(command, arg)
  end
  local success, stdout = wezterm.run_child_process(command)
  if not success then
    return nil
  end
  return stdout
end

local function tmux_shared_window_cwd()
  local client_count = 0
  local client_session
  for session in (tmux({ "list-clients", "-F", "#{client_session}" }) or ""):gmatch("[^\r\n]+") do
    client_count = client_count + 1
    if client_count > 1 then
      return nil
    end
    client_session = session
  end
  if client_count ~= 1 or client_session == nil then
    return nil
  end

  local active_window = trim(tmux({ "display-message", "-t", client_session, "-p", "#{window_id}" }))
  if active_window == "" then
    return nil
  end

  local shared_cwd
  for cwd in (tmux({ "list-panes", "-t", active_window, "-F", "#{pane_current_path}" }) or ""):gmatch("[^\r\n]+") do
    cwd = trim(cwd)
    if cwd == "" or cwd:sub(1, 1) ~= "/" then
      return nil
    end
    if shared_cwd == nil then
      shared_cwd = cwd
    elseif shared_cwd ~= cwd then
      return nil
    end
  end

  return shared_cwd
end

local function log_mo_error(message)
  message = (message or ""):gsub("^%s+", ""):gsub("%s+$", "")
  if message == "" then
    message = "unknown error"
  end
  if message:match("^mo:") then
    wezterm.log_error(message)
  else
    wezterm.log_error("mo: " .. message)
  end
end

local function is_mo_file_url(url)
  if type(url) ~= "string" then
    return false
  end

  local authority = url:match("^https?://([^/?#]+)")
  local query = url:match("^https?://[^/?#]+[^?#]*%?([^#]*)")
  local is_loopback = authority ~= nil
    and (
      authority:match("^localhost:%d+$") ~= nil
      or authority:match("^127%.0%.0%.1:%d+$") ~= nil
      or authority:match("^%[::1%]:%d+$") ~= nil
    )

  if not is_loopback or query == nil then
    return false
  end
  for param in query:gmatch("[^&]+") do
    if param:match("^file=[0-9a-fA-F]+$") then
      return true
    end
  end
  return false
end

local function resolve_target(pane, raw_target)
  local target = raw_target

  local relative_target = nil
  if target:sub(1, 1) ~= "/" and target:sub(1, 2) ~= "~/" then
    relative_target = target
  end

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

  if relative_target and not path_exists(target) then
    local cwd = tmux_shared_window_cwd()
    if cwd then
      target = cwd:gsub("/$", "") .. "/" .. relative_target
    end
  end

  -- 制御バイト混入を拒否（OSC 8 / passthrough 経由で与えられた攻撃ペイロードを弾く）
  if target:find("[%z\1-\31\127]") then
    return nil, relative_target, "control bytes in target"
  end

  -- 絶対パスでない場合は `./` 接頭辞で先頭の `-` を中和する
  if target:sub(1, 1) ~= "/" then
    target = "./" .. target
  end

  return target, relative_target, nil
end

wezterm.on("gui-startup", function()
  local _, _, window = wezterm.mux.spawn_window({})
  local w = window:gui_window()
  w:maximize()
end)

wezterm.on("window-config-reloaded", function(window)
  window:toast_notification("wezterm", "Configuration reloaded!", nil, 4000)
end)

wezterm.on("open-uri", function(window, pane, uri)
  local mo_target = uri:match("^mo:(.+)$")
  if mo_target then
    -- mo: 固有: 末尾の `:line[:col]` ジャンプ指示を除去してからパス解決
    mo_target = mo_target:gsub(":%d+:%d+$", ""):gsub(":%d+$", "")

    local target, _relative_target, err = resolve_target(pane, mo_target)
    if err then
      return false
    end

    -- `--` 区切りで mo の引数パーサが target を以降の値として確実に扱うようにする
    local success, stdout, stderr = wezterm.run_child_process({ MO_BIN, "--json", "--no-open", "--", target })
    if not success then
      log_mo_error(stderr ~= "" and stderr or stdout)
      return false
    end

    local ok, data = pcall(wezterm.json_parse, stdout)
    if not ok or type(data) ~= "table" then
      log_mo_error("failed to parse open result")
      return false
    end

    local files = data.files
    local file = type(files) == "table" and files[1] or nil
    local url = type(file) == "table" and file.url or nil
    if type(url) ~= "string" or url == "" then
      log_mo_error("no file URL returned")
      return false
    end
    if not is_mo_file_url(url) then
      log_mo_error("unsafe file URL returned")
      return false
    end

    wezterm.open_with(url)
    return false
  end

  local img_target = uri:match("^img:(.+)$")
  if img_target then
    local target, _relative_target, err = resolve_target(pane, img_target)
    if err then
      wezterm.log_error("img: " .. err)
      return false
    end

    -- `open(1)` は LaunchServices に dispatch して即 return するため、同期呼び出しでも UI を阻害しない
    local success, _stdout, stderr = wezterm.run_child_process({ "/usr/bin/open", "-a", "Preview", target })
    if not success then
      wezterm.log_error("img: " .. (stderr ~= "" and stderr or "open failed"))
      return false
    end

    return false
  end
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
    -- Image file paths: jpg / jpeg / png / gif / webp / heic / svg
    -- (?!\.\w) で foo.png.bak 等の誤マッチを除外
    {
      regex = [[[\w./@+~\-]+\.(jpe?g|png|gif|webp|heic|svg)(?!\.\w)]],
      format = "img:$0",
    },
  },
}
