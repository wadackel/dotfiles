-- =============================================================
-- Basic
-- =============================================================

vim.loader.enable()

local function keymap(modes, lhs, rhs, options)
  local opts = vim.tbl_extend("force", { noremap = true, silent = true }, options or {})
  for _, mode in pairs(modes) do
    vim.keymap.set(mode, lhs, rhs, opts)
  end
end

local function escape_pattern(text)
  local matches = {
    ["^"] = "%^",
    ["$"] = "%$",
    ["("] = "%(",
    [")"] = "%)",
    ["%"] = "%%",
    ["."] = "%.",
    ["["] = "%[",
    ["]"] = "%]",
    ["*"] = "%*",
    ["+"] = "%+",
    ["-"] = "%-",
    ["?"] = "%?",
  }
  return (text:gsub(".", matches))
end

local function remove_prefix(path, prefix)
  -- パスの先頭にプレフィックスがある場合にのみ置換を行う
  local escaped_prefix = escape_pattern(prefix)
  if string.sub(path, 1, string.len(prefix)) == prefix then
    return string.gsub(path, "^" .. escaped_prefix, "")
  else
    return path
  end
end

local function find_nearest_dir(patterns)
  local fpath = vim.api.nvim_buf_get_name(0)
  local dir = vim.fn.fnamemodify(fpath, ":p:h")

  while dir ~= "/" do
    for _, pattern in ipairs(patterns) do
      local target = dir .. "/" .. pattern
      if vim.fn.filereadable(target) == 1 then
        return dir
      end
    end
    dir = vim.fn.fnamemodify(dir, ":h")
  end

  return nil
end

-- providers
-- vim.g.python3_host_prog = "/usr/local/bin/python3"
vim.g.loaded_python3_provider = 0
vim.g.loaded_node_provider = 0
vim.g.loaded_perl_provider = 0
vim.g.loaded_ruby_provider = 0

-- <Leader>を`,`に設定
vim.g.mapleader = ","

-- 各種基本設定
vim.opt.backup = false
vim.opt.encoding = "utf-8"
vim.opt.fileencoding = "utf-8"
vim.opt.fileencodings = { "utf-8", "cp932", "iso-2022-jp", "sjis", "euc-jp", "latin1" }
vim.opt.completeopt = { "menu", "menuone", "noselect" }
vim.opt.autoread = true
vim.opt.termguicolors = true
vim.opt.hlsearch = true
vim.opt.incsearch = true
vim.opt.formatoptions:append("mM")
vim.opt.display:append("lastline")
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.wrapscan = true
vim.opt.showmatch = true
vim.opt.showmode = false
vim.opt.title = true
vim.opt.ruler = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.signcolumn = "yes"
vim.opt.autoindent = true
vim.opt.smartindent = true
vim.opt.expandtab = true
vim.opt.wrap = true
vim.opt.laststatus = 3
vim.opt.clipboard = "unnamedplus"
vim.opt.wildmenu = true
vim.opt.wildmode = { "longest", "full" }
vim.opt.iminsert = 0
vim.opt.imsearch = 0
vim.opt.backspace = { "indent", "eol", "start" }
vim.opt.matchpairs:append("<:>")
vim.opt.lazyredraw = true
vim.opt.nrformats = ""
vim.opt.guicursor = {
  "n-v-ve-o-r-c-cr-sm:block",
  "i-ci:block-blinkwait300-blinkon200-blinkoff150",
}
vim.opt.shortmess:append("I")
vim.opt.formatoptions:remove({ "r", "o" })
vim.opt.visualbell = true
vim.opt.list = true
vim.opt.listchars = {
  tab = ">.",
  trail = "_",
  extends = ">",
  precedes = "<",
  nbsp = "%",
}
vim.opt.mouse = ""

-- 基本キーマップ
-- leader を \ に退避
keymap({ "n", "v" }, "\\", ",", { silent = false })

-- <C-c> の動作を <Esc> に合わせる
keymap({ "i" }, "<C-c>", "<Esc>", { silent = false })

-- -- クリップボード連携は gy で行う
-- keymap({ "n", "v" }, "gy", '"+y', { silent = true })

-- j, k による移動を折り返されたテキストでも自然に振る舞うように変更
keymap({ "n", "v" }, "j", "gj", { silent = false })
keymap({ "n", "v" }, "k", "gk", { silent = false })

-- x でレジスタを使わずに切り取り
keymap({ "n" }, "x", '"_x', { silent = true })

-- 行頭, 文末の移動
keymap({ "n", "v" }, "M", "g^", { silent = false })
keymap({ "n", "v" }, "H", "g0", { silent = false })
keymap({ "n", "v" }, "L", "g$", { silent = false })
keymap({ "n", "v" }, "mH", "0", { silent = false })
keymap({ "n", "v" }, "mL", "$", { silent = false })

-- スクリーン内での移動
keymap({ "n", "v" }, "gh", "H", { silent = false })
keymap({ "n", "v" }, "gm", "M", { silent = false })
keymap({ "n", "v" }, "gl", "L", { silent = false })

-- 検索後の位置調整
keymap({ "n" }, "n", "nzz", { silent = false })
keymap({ "n" }, "N", "Nzz", { silent = false })
keymap({ "n" }, "*", "*zz", { silent = false })
keymap({ "n" }, "#", "#zz", { silent = false })
keymap({ "n" }, "g*", "g*zz", { silent = false })
keymap({ "n" }, "g#", "g#zz", { silent = false })

-- command モードは Emacs 風に
keymap({ "c" }, "<C-f>", "<Right>", { silent = false })
keymap({ "c" }, "<C-b>", "<Left>", { silent = false })
keymap({ "c" }, "<C-a>", "<Home>", { silent = false })
keymap({ "c" }, "<C-e>", "<End>", { silent = false })
keymap({ "c" }, "<C-d>", "<Del>", { silent = false })
keymap({ "c" }, "<C-h>", "<BackSpace>", { silent = false })

-- QuickFix の移動
keymap({ "n" }, "[q", ":cprevious<CR>")
keymap({ "n" }, "]q", ":cnext<CR>")
keymap({ "n" }, "[Q", ":<C-u>cfirst<CR>")
keymap({ "n" }, "]Q", ":<C-u>clast<CR>")

-- locationlist の移動
keymap({ "n" }, "[w", ":lprevious<CR>")
keymap({ "n" }, "]w", ":lnext<CR>")
keymap({ "n" }, "[W", ":<C-u>lfirst<CR>")
keymap({ "n" }, "]W", ":<C-u>llast<CR>")

-- argument list の移動
keymap({ "n" }, "[a", ":previous<CR>")
keymap({ "n" }, "]a", ":next<CR>")
keymap({ "n" }, "[A", ":<C-u>first<CR>")
keymap({ "n" }, "]A", ":<C-u>last<CR>")

-- ; と :
keymap({ "n", "v" }, ";", ":", { silent = false })
keymap({ "n", "v" }, ":", ";", { silent = false })
keymap({ "n", "v" }, "@;", "@:", { silent = false })
keymap({ "n", "v" }, "@:", "@;", { silent = false })

-- Toggle系オプション
keymap({ "n" }, "\\w", ":<C-u>setl wrap! wrap?<CR>")

local function toggle_syntax()
  if vim.g.syntax_on then
    vim.cmd("syntax off")
    vim.cmd("TSDisable highlight")
    vim.cmd("redraw")
    print("syntax off")
  else
    vim.cmd("syntax on")
    vim.cmd("TSEnable highlight")
    vim.cmd("redraw")
    print("syntax on")
  end
end

local function toggle_number()
  if vim.wo.number then
    vim.wo.number = false
    print("number off")
  else
    vim.wo.number = true
    print("number on")
  end
end

local function toggle_mouse()
  if vim.o.mouse == "a" then
    vim.o.mouse = ""
    print("mouse off")
  else
    vim.o.mouse = "a"
    print("mouse on")
  end
end

keymap({ "n" }, "\\s", "", { callback = toggle_syntax })
keymap({ "n" }, "\\n", "", { callback = toggle_number })
keymap({ "n" }, "\\m", "", { callback = toggle_mouse })
keymap({ "n" }, "\\h", ":<C-u>setl hlsearch!<CR>")

-- remap
keymap({ "n" }, "<<", "<<", { noremap = true })

-- 選択範囲内をExpressionレジスタで評価 -> 置換
keymap({ "v" }, "Q", "y:g/^.*$//e")

-- 指定データをクリップボードにつながるレジスタへ保存
local function clip(data, use_cwd)
  local root
  local cwd = vim.fn.getcwd()
  if use_cwd then
    root = cwd
  else
    root = find_nearest_dir({ ".git", "package.json", "pubspec.yaml" }) or cwd
  end
  local result = remove_prefix(data, root):gsub("^/", "")
  vim.fn.setreg("*", result)
  print("[clipped] " .. result)
end

vim.api.nvim_create_user_command("ClipPath", function()
  clip(vim.fn.expand("%:p"), false)
end, {})

vim.api.nvim_create_user_command("ClipPathCwd", function()
  clip(vim.fn.expand("%:p"), true)
end, {})

vim.api.nvim_create_user_command("ClipFile", function()
  clip(vim.fn.expand("%:t"))
end, {})

vim.api.nvim_create_user_command("ClipDir", function()
  clip(vim.fn.expand("%:p:h"), false)
end, {})

vim.api.nvim_create_user_command("ClipDirCwd", function()
  clip(vim.fn.expand("%:p:h"), true)
end, {})

keymap({ "n" }, "<Leader>cf", ":ClipFile<CR>")
keymap({ "n" }, "<Leader>cp", ":ClipPathCwd<CR>")

-- QuickFix の設定
vim.api.nvim_create_augroup("QuickfixConfigure", {})
vim.api.nvim_create_autocmd({ "FileType" }, {
  group = "QuickfixConfigure",
  pattern = { "help", "qf" },
  command = "nnoremap <buffer> q <C-w>c",
})
vim.api.nvim_create_autocmd({ "FileType" }, {
  group = "QuickfixConfigure",
  pattern = "qf",
  command = "setlocal nowrap signcolumn=no",
})
vim.api.nvim_create_autocmd({ "QuickfixCmdPost" }, {
  group = "QuickfixConfigure",
  pattern = { "make", "grep", "grepadd", "vimgrep", "vim" },
  nested = true,
  command = "if len(getqflist()) != 0 | copen | endif",
})

-- ペースト時のオートインデントを無効化
if vim.fn.has("term") == 1 then
  vim.o.t_ti = vim.o.t_ti .. "\\e[?2004h"
  vim.o.t_te = vim.o.t_te .. "\\e[?2004l"
  vim.o.pastetoggle = "\\e[201~"

  function XTermPasteBegin(ret)
    vim.o.paste = true
    return ret
  end

  vim.keymap.set("n", "<Esc>[200~", function()
    return XTermPasteBegin("0i")
  end, { expr = true })
  vim.keymap.set("i", "<Esc>[200~", function()
    return XTermPasteBegin("")
  end, { expr = true })
  vim.keymap.set("c", "<Esc>[200~", "<nop>")
  vim.keymap.set("c", "<Esc>[201~", "<nop>")
end

-- ファイルタイプショートカット
vim.api.nvim_create_autocmd({ "FileType" }, {
  pattern = "md",
  command = "setlocal filetype=markdown",
})

vim.api.nvim_create_autocmd({ "FileType" }, {
  pattern = "js",
  command = "setlocal filetype=javascript",
})

-- カーソル位置の復元
vim.api.nvim_create_augroup("restoreCursorPosition", {})
vim.api.nvim_create_autocmd({ "BufReadPost" }, {
  group = "restoreCursorPosition",
  pattern = "*",
  callback = function()
    if vim.fn.line("'\"") > 1 and vim.fn.line("'\"") <= vim.fn.line("$") then
      vim.cmd('normal! g`"')
    end
  end,
})

-- タブの操作、移動
vim.opt.showtabline = 2 -- 常にタブラインを表示

keymap({ "n" }, "[Tag]", "<Nop>", { silent = false })
keymap({ "n" }, "t", "[Tag]", { silent = false })

-- 画面分割用のキーマップ
keymap({ "n" }, "s", "<Nop>", { silent = false })
keymap({ "n" }, "sj", "<C-w>j", { silent = false })
keymap({ "n" }, "sk", "<C-w>k", { silent = false })
keymap({ "n" }, "sl", "<C-w>l", { silent = false })
keymap({ "n" }, "sh", "<C-w>h", { silent = false })
keymap({ "n" }, "sN", ":<C-u>bn<CR>", { silent = false })
keymap({ "n" }, "sP", ":<C-u>bp<CR>", { silent = false })
keymap({ "n" }, "sn", "gt", { silent = false })
keymap({ "n" }, "sp", "gT", { silent = false })
keymap({ "n" }, "sw", "<C-w>w", { silent = false })
keymap({ "n" }, "st", ":<C-u>tabnew<CR>", { silent = false })

-- quickfix/locationlist の open/close
keymap({ "n" }, "<Space>co", ":copen<CR>", { silent = false })
keymap({ "n" }, "<Space>cc", ":cclose<CR>", { silent = false })
keymap({ "n" }, "<Space>lo", ":lopen<CR>", { silent = false })
keymap({ "n" }, "<Space>lc", ":lclose<CR>", { silent = false })

-- 現在のタブページ以外全て閉じる
keymap({ "n" }, "<C-w>O", ":<C-u>tabo<CR>", { silent = false })

-- Switches to tab with specific number.
for i = 1, 9 do
  keymap({ "n" }, "<Leader>" .. i, i .. "gt", { silent = false })
end

-- Terminal
vim.api.nvim_create_augroup("terminal-config", {})
vim.api.nvim_create_autocmd({ "TermOpen" }, {
  group = "terminal-config",
  pattern = "*",
  command = "startinsert",
})
vim.api.nvim_create_autocmd({ "TermOpen" }, {
  group = "terminal-config",
  pattern = "*",
  command = "setlocal signcolumn=no",
})

keymap({ "t" }, "<C-[>", "<C-\\><C-n>", { silent = false })
keymap({ "t" }, "<Esc>", "<C-\\><C-n>", { silent = false })

-- Neovim in Neovim を避ける
if vim.fn.executable("nvr") == 1 then
  vim.env.EDITOR = 'nvr -cc split -c "set bufhidden=delete" --remote-wait'
end

-- コマンドラインモード
vim.api.nvim_create_user_command("AutoUpdateColorscheme", function(args)
  local interval = args.args and tonumber(args.args) or 3000
  vim.opt_local.autoread = true
  vim.opt_local.swapfile = false
  vim.fn.timer_start(interval, function()
    vim.cmd("checktime")
  end, { ["repeat"] = -1 })
  vim.api.nvim_create_autocmd({ "BufReadPost" }, {
    buffer = args.bufnr,
    callback = function()
      vim.cmd("source $MYVIMRC")
    end,
  })
end, { nargs = "?" })

-- ripgrep
vim.opt.grepprg = "rg --vimgrep --no-heading --hidden -g !.git"
vim.opt.grepformat = { "%f:%l:%c:%m", "%f:%l:%m" }

-- ファイル置換時に BufWritePost 処理をトグル
local function enableBufWritePost()
  vim.cmd("LspStart")
  vim.cmd("FormatEnable")
  vim.cmd("Gitsigns attach")
end

local function disableBufWritePost()
  vim.cmd("LspStop")
  vim.cmd("FormatDisable")
  vim.cmd("Gitsigns detach_all")
end

vim.api.nvim_create_user_command("EnableBufWritePost", enableBufWritePost, {})
vim.api.nvim_create_user_command("DisableBufWritePost", disableBufWritePost, {})

-- =============================================================
-- Filetypes
-- =============================================================
vim.api.nvim_create_augroup("fileTypeDetect", {})
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile", "BufNewFile" }, {
  group = "fileTypeDetect",
  pattern = "*.mdx",
  command = "setlocal filetype=markdown",
})
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile", "BufNewFile" }, {
  group = "fileTypeDetect",
  pattern = "*.ejs",
  command = "setlocal ft=html",
})
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile", "BufNewFile" }, {
  group = "fileTypeDetect",
  pattern = "gitconfig",
  command = "setlocal ft=gitconfig",
})
for _, pattern in ipairs({ ".eslintrc", ".stylelintrc", ".prettierrc", ".textlintrc", "*.arb" }) do
  vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile", "BufNewFile" }, {
    group = "fileTypeDetect",
    pattern = pattern,
    command = "setlocal ft=json",
  })
end

-- =============================================================
-- Plugins
-- =============================================================
local has_config_file = function(bufnr, files)
  local opts = {
    upward = true,
    path = vim.api.nvim_buf_get_name(bufnr),
  }
  return vim.fs.find(files, opts)[1] ~= nil
end

local function lsp_on_init(client)
  if client.server_capabilities then
    -- Disable LSP Semantic tokens
    client.server_capabilities.semanticTokensProvider = false
  end
end

local function lsp_on_attach(_, bufnr)
  local function kmap(modes, lhs, rhs)
    keymap(modes, lhs, rhs, { buffer = bufnr })
  end

  -- Enable completion triggered by <C-x><C-o>
  vim.api.nvim_buf_set_option(bufnr, "omnifunc", "v:lua.vim.lsp.omnifunc")

  -- Mappings
  keymap({ "n" }, "<Leader>ee", "<cmd>lua vim.diagnostic.open_float()<CR>")
  keymap({ "n" }, "[g", "<cmd>lua vim.diagnostic.goto_prev()<CR>")
  keymap({ "n" }, "]g", "<cmd>lua vim.diagnostic.goto_next()<CR>")
  keymap({ "n" }, "<Space>q", "<cmd>lua vim.diagnostic.setloclist()<CR>")

  kmap({ "n" }, "<C-]>", "<cmd>lua vim.lsp.buf.definition()<CR>")
  kmap({ "n" }, "<C-w><C-]>", "<cmd>Lspsaga peek_definition<CR>")
  kmap({ "n" }, "K", "<cmd>Lspsaga goto_type_definition<CR>")
  kmap({ "n" }, "<Leader>i", "<cmd>Lspsaga hover_doc<CR>")
  kmap({ "n" }, "<C-^>", "<cmd>lua vim.lsp.buf.references()<CR>")
  kmap({ "n" }, "<Leader>r", "<cmd>lua vim.lsp.buf.rename()<CR>")
  kmap({ "n" }, "<Leader>a", "<cmd>lua vim.lsp.buf.code_action()<CR>")
  kmap({ "n" }, "<Space>wa", "<cmd>lua vim.lsp.buf.add_workspace_folder()<CR>")
  kmap({ "n" }, "<Space>wr", "<cmd>lua vim.lsp.buf.remove_workspace_folder()<CR>")
  kmap({ "n" }, "<Space>wl", "<cmd>lua vim.print(vim.lsp.buf.list_workspace_folders())<CR>")
end

-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
  local lazyrepo = "https://github.com/folke/lazy.nvim.git"
  vim.fn.system({ "git", "clone", "--filter=blob:none", "--branch=stable", lazyrepo, lazypath })
end
vim.opt.rtp:prepend(lazypath)

-- Setup lazy.nvim
require("lazy").setup({
  defaults = {
    lazy = true,
  },

  install = {
    colorscheme = {
      "habamax",
    },
  },

  ui = {
    border = "rounded",
    backdrop = 100,
  },

  rocks = {
    enabled = false,
  },

  checker = {
    enabled = false,
  },

  change_detection = {
    enabled = false,
  },

  performance = {
    cache = {
      enabled = true,
    },
    reset_packpath = true,
    rtp = {
      reset = true,
      disabled_plugins = {
        "gzip",
        "man",
        "matchit",
        "matchparen",
        "netrwPlugin",
        "shada",
        "spellfile",
        "tarPlugin",
        "tohtml",
        "tutor",
        "zipPlugin",
      },
    },
  },

  profiling = {
    loader = false,
    require = false,
  },

  spec = {
    -- =============================================================
    -- Colorscheme
    -- =============================================================
    {
      "wadackel/vim-dogrun",
      dir = "~/develop/github.com/wadackel/vim-dogrun",
      lazy = false,
      init = function()
        vim.cmd("colorscheme dogrun")

        local function patch_colors()
          vim.cmd("highlight Normal guibg=NONE")
        end

        patch_colors()

        vim.api.nvim_create_user_command("ReloadDogrun", function()
          vim.cmd.colorscheme("default")
          vim.cmd.colorscheme("dogrun")
          patch_colors()
        end, {})
      end,
    },

    -- =============================================================
    -- LSP x Completion
    -- =============================================================
    {
      "neovim/nvim-lspconfig",
      lazy = false,
      init = function()
        require("lspconfig.ui.windows").default_options.border = "rounded"

        -- Base
        vim.diagnostic.config({
          float = { border = "rounded" },
          signs = {
            text = {
              [vim.diagnostic.severity.ERROR] = "•",
              [vim.diagnostic.severity.WARN] = "•",
              [vim.diagnostic.severity.INFO] = "•",
              [vim.diagnostic.severity.HINT] = "•",
            },
          },
        })

        vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, { border = "rounded" })

        vim.lsp.handlers["textDocument/publishDiagnostics"] = vim.lsp.with(vim.lsp.diagnostic.on_publish_diagnostics, {
          virtual_text = {
            prefix = "",
            spacing = 0,
          },
          signs = {
            active = {
              { name = "DiagnosticSignError", text = "•" },
              { name = "DiagnosticSignWarn", text = "•" },
              { name = "DiagnosticSignHint", text = "•" },
              { name = "DiagnosticSignInfo", text = "•" },
            },
          },
        })
      end,
    },

    {
      "williamboman/mason.nvim",
      opts = {
        ui = {
          border = "rounded",
        },
      },
    },

    {
      "WhoIsSethDaniel/mason-tool-installer.nvim",
      cmd = {
        "MasonToolsInstall",
        "MasonToolsInstallSync",
        "MasonToolsUpdate",
        "MasonToolsUpdateSync",
        "MasonToolsClean",
      },
      dependencies = {
        { "williamboman/mason.nvim" },
      },
      opts = {
        ensure_installed = {
          -- LSP
          "astro",
          "rust_analyzer",
          "terraformls",
          "lua_ls",
          "vimls",
          "gopls",
          "ts_ls",
          "denols",

          -- Linter
          "actionlint",
          "eslint_d",
          "oxlint",
          "stylelint",
          "textlint",
          "typos-lsp",

          -- Formatter
          "prettierd",
          "biome",
          "gofumpt",
          "goimports",
          "stylua",
        },
        run_on_start = false,
      },
    },

    {
      "williamboman/mason-lspconfig.nvim",
      lazy = false,
      config = function()
        vim.lsp.config("*", {
          capabilities = require("blink.cmp").get_lsp_capabilities(),
          on_init = lsp_on_init,
          on_attach = lsp_on_attach,
        })

        vim.lsp.config("lua_ls", {
          settings = {
            Lua = {
              runtime = {
                version = "LuaJIT",
              },
              diagnostics = {
                globals = {
                  "vim",
                  "require",
                },
              },
            },
          },
        })

        vim.lsp.config("typos_lsp", {
          init_options = {
            config = "~/.config/typos.toml",
            diagnosticSeverity = "Info",
          },
        })

        vim.lsp.config("denols", {
          workspace_required = true,
          root_markers = {
            "deno.json",
            "deno.jsonc",
            "deps.ts",
          },
        })

        require("mason-lspconfig").setup({
          automatic_enable = {
            exclude = {
              -- Use typescript-tools.nvim
              "ts_ls",
              -- Use rustaceanvim
              "rust_analyzer",
            },
          },
        })

        -- See:
        -- `xcrun --sdk iphonesimulator --show-sdk-path`
        -- lspconfig.sourcekit.setup({
        --   cmd = {
        --     "sourcekit-lsp",
        --     "-Xswiftc",
        --     "-sdk",
        --     "-Xswiftc",
        --     "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator17.2.sdk",
        --     "-Xswiftc",
        --     "-target",
        --     "-Xswiftc",
        --     "x86_64-apple-ios17.2-simulator",
        --   },
        --   capabilities = {
        --     workspace = {
        --       didChangeWatchedFiles = {
        --         dynamicRegistration = true,
        --       },
        --     },
        --   },
        --   on_init = lsp_on_init,
        --   on_attach = lsp_on_attach,
        -- })
      end,
    },

    {
      "pmizio/typescript-tools.nvim",
      lazy = false,
      -- @see https://github.com/pmizio/typescript-tools.nvim/issues/343
      version = "e0887c1e336edbb01243e9f1e60d74b0bc0a2bed",
      dependencies = {
        "nvim-lua/plenary.nvim",
        "neovim/nvim-lspconfig",
      },
      config = function()
        local lspconfig = require("lspconfig")

        require("typescript-tools").setup({
          on_init = lsp_on_init,
          on_attach = lsp_on_attach,
          single_file_support = false,
          root_dir = function(fname)
            if lspconfig.util.root_pattern("deno.json", "deno.jsonc")(fname) then
              return nil
            end
            return lspconfig.util.root_pattern("package.json")(fname)
          end,
          settings = {
            expose_as_code_action = "all",
            tsserver_max_memory = 8192,
          },
        })
      end,
    },

    {
      "mrcjkb/rustaceanvim",
      lazy = false,
      init = function()
        vim.g.rustaceanvim = {
          tools = {
            float_win_config = {
              border = "rounded",
            },
          },
          server = {
            on_init = lsp_on_init,
            on_attach = lsp_on_attach,
            settings = {
              ["rust-analyzer"] = {
                check = {
                  command = "clippy",
                },
              },
            },
          },
        }
      end,
    },

    {
      "nvim-flutter/flutter-tools.nvim",
      lazy = false,
      commit = "818ad42b204cda5317baa399377ea30b35f6f8be",
      dependencies = {
        "nvim-lua/plenary.nvim",
        "stevearc/dressing.nvim",
      },
      config = function()
        local dev_log_open_cmd = "rightbelow vertical split"

        require("flutter-tools").setup({
          flutter_path = nil,
          flutter_lookup_cmd = "mise where flutter",
          fvm = false,
          ui = {
            border = "rounded",
          },
          decorations = {
            statusline = {
              app_version = false,
              device = false,
              project_config = false,
            },
          },
          closing_tags = {
            prefix = "∙ ",
          },
          dev_log = {
            enabled = true,
            notify_errors = false,
            open_cmd = dev_log_open_cmd,
          },
          lsp = {
            on_init = lsp_on_init,
            on_attach = function(client, bufnr)
              lsp_on_attach(client, bufnr)

              local dev_log = "__FLUTTER_DEV_LOG__$"

              local get_win = function(buf)
                for _, win in ipairs(vim.api.nvim_list_wins()) do
                  if vim.api.nvim_win_get_buf(win) == buf then
                    return win
                  end
                end
                return nil
              end

              local find_dev_log = function()
                for _, buf in ipairs(vim.api.nvim_list_bufs()) do
                  local bufname = vim.api.nvim_buf_get_name(buf)
                  if string.match(bufname, dev_log) then
                    local win = get_win(buf)
                    return buf, win
                  end
                end
                return nil
              end

              local open_dev_log = function()
                local log = require("flutter-tools.log")
                local buf, win = find_dev_log()

                if not buf then
                  vim.notify("Flutter Dev Log not found", "warn")
                  return
                end

                if win then
                  vim.api.nvim_set_current_win(win)
                else
                  vim.api.nvim_command(dev_log_open_cmd)
                  vim.api.nvim_set_current_buf(buf)
                  win = vim.api.nvim_get_current_win()

                  -- Move to the end of the buffer
                  local line_count = vim.api.nvim_buf_line_count(buf)
                  if line_count > 0 then
                    vim.api.nvim_win_set_cursor(0, { line_count, 0 })
                  else
                    vim.api.nvim_win_set_cursor(0, { 1, 0 })
                  end
                end

                -- Reset module state
                log.win = win
                log.buf = buf
              end

              local close_dev_log = function()
                local _, win = find_dev_log()
                if not win then
                  vim.notify("Flutter Dev Log not found", "warn")
                  return
                end
                vim.api.nvim_win_close(win, true)
              end

              keymap({ "n" }, "<Space>f", "<cmd>lua require('telescope').extensions.flutter.commands()<CR>")
              keymap({ "n" }, "<Space>do", open_dev_log)
              keymap({ "n" }, "<Space>dc", close_dev_log)

              vim.api.nvim_create_autocmd("FileType", {
                pattern = "log",
                callback = function()
                  local bufname = vim.api.nvim_buf_get_name(0)
                  if string.match(bufname, dev_log) then
                    keymap({ "n" }, "q", close_dev_log, { buffer = 0 })
                  end
                end,
              })
            end,
            settings = {
              analysisExcludedFolders = {
                vim.fn.expand("$HOME/.pub-cache"),
                vim.fn.expand("$HOME/.local/share/mise/installs/flutter"),
                vim.fn.expand("$HOME/.local/share/mise/installs/dart"),
              },
              completeFunctionCalls = false,
              showTodos = false,
            },
          },
          debugger = {
            enabled = true,
            exception_breakpoints = {},
            register_configurations = function(paths)
              local dap = require("dap")
              dap.adapters.dart = {
                type = "executable",
                command = paths.flutter_bin,
                args = { "debug_adapter" },
              }
              dap.configurations.dart = {}
              require("dap.ext.vscode").load_launchjs()
            end,
          },
        })

        require("telescope").load_extension("flutter")
      end,
    },

    {
      "nvimdev/lspsaga.nvim",
      event = "LspAttach",
      opts = {
        ui = {
          code_action = "",
        },
        lightbulb = {
          enable = false,
        },
        beacon = {
          enable = false,
        },
        symbol_in_winbar = {
          enable = false,
        },
        definition = {
          width = 0.8,
          keys = {
            edit = "o",
            vsplit = "vv",
            split = "ss",
            tabe = "<C-t>",
            quit = "q",
            close = "<C-c>",
          },
        },
      },
    },

    {
      "saghen/blink.cmp",
      dependencies = {
        {
          "Kaiser-Yang/blink-cmp-git",
          dependencies = {
            "nvim-lua/plenary.nvim",
          },
        },
        "Kaiser-Yang/blink-cmp-avante",
        "olimorris/codecompanion.nvim",
        "onsails/lspkind-nvim",
      },
      version = "1.*",
      build = "cargo build --release",
      opts_extend = {
        "sources.default",
      },
      config = function()
        -- Workaround for `<C-x><C-o>` in insert mode
        -- see: https://github.com/Saghen/blink.cmp/issues/453
        keymap({ "i", "s" }, "<C-x><C-o>", function()
          require("blink.cmp").show()
          require("blink.cmp").show_documentation()
          require("blink.cmp").hide_documentation()
        end, { silent = false })

        require("blink.cmp").setup({
          keymap = {
            preset = "default",
            ["<C-e>"] = {},
            ["<F5>"] = { "show", "show_documentation", "hide_documentation" },
          },

          appearance = {
            nerd_font_variant = "mono",
          },

          sources = {
            default = {
              "lsp",
              "path",
              "buffer",
              -- "avante",
              "codecompanion",
            },
            providers = {
              cmdline = {
                enabled = function()
                  return vim.fn.getcmdtype() ~= ":" or not vim.fn.getcmdline():match("^[%%0-9,'<>%-]*!")
                end,
              },
              git = {
                module = "blink-cmp-git",
                name = "Git",
                opts = {},
              },
              avante = {
                module = "blink-cmp-avante",
                name = "Avante",
                opts = {},
              },
            },
          },

          completion = {
            trigger = {
              show_on_insert_on_trigger_character = true,
              show_on_trigger_character = true,
              show_on_blocked_trigger_characters = {},
            },
            documentation = {
              auto_show = true,
              window = {
                border = "rounded",
              },
            },
            menu = {
              border = "rounded",
              draw = {
                columns = {
                  { "kind_icon" },
                  { "label", "label_description", gap = 1 },
                  { "source_name" },
                },
                components = {
                  kind_icon = {
                    text = function(ctx)
                      local icon = ctx.kind_icon
                      if vim.tbl_contains({ "Path" }, ctx.source_name) then
                        local dev_icon, _ = require("nvim-web-devicons").get_icon(ctx.label)
                        if dev_icon then
                          icon = dev_icon
                        end
                      else
                        icon = require("lspkind").symbolic(ctx.kind, {
                          mode = "symbol",
                        })
                      end

                      return icon .. ctx.icon_gap
                    end,
                    highlight = function(ctx)
                      local hl = ctx.kind_hl
                      if vim.tbl_contains({ "Path" }, ctx.source_name) then
                        local dev_icon, dev_hl = require("nvim-web-devicons").get_icon(ctx.label)
                        if dev_icon then
                          hl = dev_hl
                        end
                      end
                      return hl
                    end,
                  },
                },
              },
            },
          },

          fuzzy = {
            implementation = "prefer_rust_with_warning",
          },
        })
      end,
    },

    {
      "j-hui/fidget.nvim",
      event = "LspAttach",
      opts = {
        progress = {
          display = {
            render_limit = 5,
            done_ttl = 2,
          },
        },
        notification = {
          window = {
            winblend = 0,
          },
        },
        integration = {
          ["nvim-tree"] = {
            enable = true,
          },
        },
      },
    },

    {
      "stevearc/dressing.nvim",
      event = "LspAttach",
      opts = {
        input = {
          enabled = true,
          default_prompt = "Input:",
          prompt_align = "left",
          insert_only = true,
          start_in_insert = true,
          border = "rounded",
          relative = "cursor",
          prefer_width = 40,
          width = nil,
          max_width = { 140, 0.9 },
          min_width = { 20, 0.2 },
          buf_options = {},
          win_options = {
            winblend = 0,
            wrap = false,
          },
          mappings = {
            n = {
              ["<Esc>"] = "Close",
              ["<CR>"] = "Confirm",
            },
            i = {
              ["<C-c>"] = "Close",
              ["<C-b>"] = "<Left>",
              ["<C-f>"] = "<Right>",
              ["<C-a>"] = "<Home>",
              ["<C-e>"] = "<End>",
              ["<C-d>"] = "<Del>",
              ["<CR>"] = "Confirm",
              ["<C-p>"] = "HistoryPrev",
              ["<Up>"] = "HistoryPrev",
              ["<C-n>"] = "HistoryNext",
              ["<Down>"] = "HistoryNext",
            },
          },
          get_config = nil,
        },
        select = {
          enabled = true,
          backend = { "telescope", "builtin" },
          trim_prompt = true,
          telescope = nil,
          builtin = {
            border = "rounded",
            relative = "editor",
            buf_options = {},
            win_options = {
              winblend = 10,
            },
            width = nil,
            max_width = { 140, 0.8 },
            min_width = { 40, 0.2 },
            height = nil,
            max_height = 0.9,
            min_height = { 10, 0.2 },
            mappings = {
              ["<Esc>"] = "Close",
              ["<C-c>"] = "Close",
              ["<CR>"] = "Confirm",
            },
          },
          format_item_override = {},
          get_config = nil,
        },
      },
    },

    -- {
    --   "nvimtools/none-ls.nvim",
    --   lazy = false,
    --   dependencies = {
    --     "williamboman/mason-lspconfig.nvim",
    --     "neovim/nvim-lspconfig",
    --   },
    --   config = function()
    --     local null_ls = require("null-ls")
    --     local augroup = vim.api.nvim_create_augroup("LspFormatting", {})
    --     vim.print("test1")
    --
    --     null_ls.setup({
    --       -- debug = false,
    --       sources = {
    --         -- Linter
    --         -- null_ls.builtins.diagnostics.eslint_d,
    --         -- null_ls.builtins.diagnostics.oxlint,
    --         null_ls.builtins.diagnostics.actionlint,
    --         null_ls.builtins.diagnostics.textlint,
    --         -- null_ls.builtins.diagnostics.typos_lsp,
    --
    --         -- Formatter
    --         null_ls.builtins.formatting.prettierd,
    --         -- TODO: condition
    --         -- null_ls.builtins.formatting.biome,
    --         null_ls.builtins.formatting.gofumpt,
    --         null_ls.builtins.formatting.goimports,
    --         null_ls.builtins.formatting.stylua,
    --       },
    --       -- you can reuse a shared lspconfig on_attach callback here
    --       on_attach = function(client, bufnr)
    --         vim.print("test")
    --         if client.supports_method("textDocument/formatting") then
    --           vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })
    --           vim.api.nvim_create_autocmd("BufWritePre", {
    --             group = augroup,
    --             buffer = bufnr,
    --             callback = function()
    --               vim.lsp.buf.format({
    --                 bufnr = bufnr,
    --                 async = false,
    --                 timeout_ms = 5000,
    --               })
    --             end,
    --           })
    --
    --           keymap({ "n" }, "<Leader>p", function()
    --             vim.lsp.buf.format({
    --               async = true,
    --               timeout_ms = 5000,
    --             })
    --           end)
    --         end
    --       end,
    --     })
    --   end,
    -- },

    {
      "mfussenegger/nvim-lint",
      event = {
        "BufReadPost",
        "BufWritePost",
        "InsertLeave",
        "TextChanged",
      },
      config = function()
        local lint = require("lint")

        local eslint_d = lint.linters.eslint_d
        lint.linters.eslint_d = vim.tbl_extend("force", eslint_d, {
          parser = function(output, bufnr)
            -- Suppress "No ESLint found" error
            local result = eslint_d.parser(output, bufnr)
            if #result == 1 then
              local msg = result[1].message
              if string.match(msg, "No ESLint found") then
                return {}
              end
              if string.match(msg, "Could not find config file") then
                return {}
              end
            end
            return result
          end,
        })

        local oxlint = lint.linters.oxlint
        lint.linters.oxlint = vim.tbl_extend("force", oxlint, {
          parser = function(output, bufnr, linter_cwd)
            local has_oxlint = has_config_file(bufnr, {
              ".oxlintrc.json",
            })
            vim.print(linter_cwd)
            if has_oxlint then
              return oxlint.parser(output, bufnr, linter_cwd)
            end
            return {}
          end,
        })

        local actionlint = lint.linters.actionlint
        lint.linters.actionlint = vim.tbl_extend("force", actionlint, {
          parser = function(output, bufnr)
            -- Only GHA files
            local fpath = vim.api.nvim_buf_get_name(bufnr)
            if fpath:match("^.*%.github/.+%.y[a]?ml$") == nil then
              return {}
            end
            return actionlint.parser(output, bufnr)
          end,
        })

        lint.linters_by_ft = {
          -- TODO: Support Deno
          javascript = { "eslint_d", "oxlint" },
          typescript = { "eslint_d", "oxlint" },
          javascriptreact = { "eslint_d", "oxlint" },
          typescriptreact = { "eslint_d", "oxlint" },
          css = { "stylelint" },
          yaml = { "actionlint" },
          terraform = { "tflint" },
        }

        local check_local = {
          "eslint_d",
          "stylelint",
          "oxlint",
        }

        local function contains(table, elements)
          for _, value in ipairs(table) do
            for _, element in ipairs(elements) do
              if value == element then
                return true
              end
            end
          end
          return false
        end

        vim.api.nvim_create_autocmd({ "BufReadPost", "BufWritePost", "InsertLeave", "TextChanged" }, {
          callback = function()
            local names = lint.linters_by_ft[vim.bo.filetype]
            if names and contains(names, check_local) then
              lint.try_lint(nil, {
                cwd = find_nearest_dir({ "package.json" }),
              })
            else
              lint.try_lint()
            end
          end,
        })
      end,
    },

    {
      "stevearc/conform.nvim",
      event = "BufWritePre",
      dependencies = {
        "nvim-lua/plenary.nvim",
      },
      keys = {
        {
          "<Leader>p",
          function()
            require("conform").format({
              async = true,
            })
          end,
          mode = "n",
          noremap = true,
          silent = true,
        },
      },
      config = function()
        local conform = require("conform")

        local js_formatter = function(bufnr)
          local has_eslint = has_config_file(bufnr, {
            "eslint.config.js",
            "eslint.config.mjs",
            "eslint.config.cjs",
            ".eslintrc.js",
            ".eslintrc.cjs",
          })
          local has_prettier = has_config_file(bufnr, {
            ".prettierrc",
            ".prettierrc.json",
            ".prettierrc.js",
            ".prettierrc.cjs",
            "prettier.config.js",
            "prettier.config.cjs",
          })
          local has_biome = has_config_file(bufnr, { "biome.json" })

          local formatters = {}
          if has_eslint then
            table.insert(formatters, "eslint_d")
          end
          if has_prettier then
            table.insert(formatters, "prettierd")
          end
          if has_biome then
            table.insert(formatters, "biome")
          end
          return formatters
        end

        conform.setup({
          timeout_ms = 5000,
          formatters_by_ft = {
            javascript = js_formatter,
            javascriptreact = js_formatter,
            typescript = js_formatter,
            typescriptreact = js_formatter,
            css = {
              "stylelint",
              "prettierd",
            },
            json = { "prettierd" },
            markdown = { "prettierd" },
            yaml = { "prettierd" },
            html = { "prettierd" },
            rust = { "rustfmt" },
            go = { "gofumpt", "goimports" },
            terraform = { "terraform_fmt" },
            dart = { "dart_format" },
            lua = { "stylua" },
          },
        })

        vim.api.nvim_create_autocmd("BufWritePre", {
          pattern = "*",
          callback = function(args)
            if vim.g.disable_autoformat then
              return
            end
            conform.format({
              bufnr = args.buf,
              timeout_ms = 5000,
            })
          end,
        })

        vim.api.nvim_create_user_command("FormatDisable", function()
          vim.g.disable_autoformat = true
        end, {
          desc = "Disable autoformat-on-save",
          bang = true,
        })

        vim.api.nvim_create_user_command("FormatEnable", function()
          vim.g.disable_autoformat = false
        end, {
          desc = "Re-enable autoformat-on-save",
        })
      end,
    },

    {
      "mfussenegger/nvim-dap",
      event = "LspAttach",
      dependencies = {
        "nvim-neotest/nvim-nio",
        {
          "rcarriga/nvim-dap-ui",
          opts = {
            icons = { expanded = "▾", collapsed = "▸" },
            layouts = {
              elements = {
                { id = "scopes", size = 0.25 },
                "breakpoints",
                "stacks",
                "watches",
              },
              size = 10, -- columns
              position = "bottom",
            },
          },
        },
      },
    },

    -- =============================================================
    -- AI Integration
    -- =============================================================
    {
      "zbirenbaum/copilot.lua",
      lazy = false,
      opts = {
        copilot_node_command = vim.fn.expand("$HOME") .. "/.local/share/mise/shims/node",
        suggestion = {
          auto_trigger = true,
          keymap = {
            accept = "<Tab>",
          },
        },
      },
    },

    -- {
    --   "ravitemer/mcphub.nvim",
    --   dependencies = {
    --     "nvim-lua/plenary.nvim",
    --   },
    --   cmd = "MCPHub",
    --   build = "npm install -g mcp-hub@latest",
    --   config = function()
    --     vim.g.mcphub_auto_approve = true
    --
    --     require("mcphub").setup({
    --       auto_approve = true,
    --       ui = {
    --         window = {
    --           width = 0.8,
    --           height = 0.8,
    --           relative = "editor",
    --           zindex = 50,
    --           border = "rounded",
    --         },
    --       },
    --     })
    --   end,
    -- },

    {
      "olimorris/codecompanion.nvim",
      dependencies = {
        "nvim-lua/plenary.nvim",
        "nvim-treesitter/nvim-treesitter",
      },
      keys = {
        {
          "<Space>ct",
          ":CodeCompanionChat Toggle<CR>",
          mode = "n",
          noremap = true,
        },
        {
          "<Space>cn",
          ":CodeCompanionChat<CR>",
          mode = "n",
          noremap = true,
        },
        {
          "<Space>ca",
          ":CodeCompanionActions<CR>",
          mode = { "n", "v" },
          noremap = true,
        },
        {
          "<Space>cm",
          ":CodeCompanion<CR>",
          mode = { "v", "n" },
          noremap = true,
        },
      },
      config = function()
        vim.g.codecompanion_auto_tool_mode = true

        require("codecompanion").setup({
          opts = {
            language = "Japanese",
          },
          adapters = {
            copilot = function()
              return require("codecompanion.adapters").extend("copilot", {
                schema = {
                  model = {
                    default = "claude-3.7-sonnet",
                  },
                  max_tokens = {
                    default = 128000,
                  },
                },
              })
            end,
            anthropic = function()
              return require("codecompanion.adapters").extend("anthropic", {
                env = {
                  api_key = "NVIM_ANTHROPIC_API_KEY",
                },
                schema = {
                  model = {
                    default = "claude-sonnet-4-20250514",
                  },
                  max_tokens = {
                    default = 64000,
                  },
                },
              })
            end,
          },
          strategies = {
            chat = {
              adapter = "anthropic",
              roles = {
                llm = function(adapter)
                  return " CodeCompanion (" .. adapter.formatted_name .. ")"
                end,
                user = " Me",
              },
              tools = {
                opts = {
                  auto_submit_errors = true,
                  auto_submit_success = true,
                },
              },
              keymaps = {
                send = {
                  modes = {
                    n = { "<CR>" },
                    i = "<Nop>",
                  },
                  index = 2,
                  -- callback = "keymaps.send",
                  -- @see https://github.com/olimorris/codecompanion.nvim/discussions/640#discussioncomment-12866279
                  callback = function(chat)
                    vim.cmd("stopinsert")
                    chat:add_buf_message({ role = "llm", content = "" })
                    chat:submit()
                  end,
                  description = "Send",
                },
                close = {
                  modes = {
                    n = "q",
                    i = "<Nop>",
                  },
                  index = 4,
                  callback = "keymaps.close",
                  description = "Close Chat",
                },
                stop = {
                  modes = {
                    n = "<Nop>",
                  },
                  index = 5,
                  callback = "keymaps.stop",
                  description = "Stop Request",
                },
              },
            },
            inline = {
              adapter = "anthropic",
            },
          },
          display = {
            chat = {
              show_header_separator = true,
              show_settings = true,
              window = {
                position = "right",
              },
            },
          },
          extensions = {
            -- mcphub = {
            --   callback = "mcphub.extensions.codecompanion",
            --   opts = {
            --     show_result_in_chat = true,
            --     make_vars = true,
            --     make_slash_commands = true,
            --   },
            -- },
          },
        })

        -- inline spinner
        -- https://codecompanion.olimorris.dev/usage/ui.html
        local spinner = {
          processing = false,
          spinner_index = 1,
          namespace_id = nil,
          timer = nil,
          spinner_symbols = {
            "⠋",
            "⠙",
            "⠹",
            "⠸",
            "⠼",
            "⠴",
            "⠦",
            "⠧",
            "⠇",
            "⠏",
          },
          filetype = "codecompanion",
        }

        local function get_buf(filetype)
          for _, buf in ipairs(vim.api.nvim_list_bufs()) do
            if vim.api.nvim_buf_is_valid(buf) and vim.bo[buf].filetype == filetype then
              return buf
            end
          end
          return nil
        end

        local function stop_spinner()
          spinner.processing = false

          if spinner.timer then
            spinner.timer:stop()
            spinner.timer:close()
            spinner.timer = nil
          end

          local buf = get_buf(spinner.filetype)
          if buf == nil then
            return
          end

          vim.api.nvim_buf_clear_namespace(buf, spinner.namespace_id, 0, -1)
        end

        local function update_spinner()
          if not spinner.processing then
            stop_spinner()
            return
          end

          spinner.spinner_index = (spinner.spinner_index % #spinner.spinner_symbols) + 1

          local buf = get_buf(spinner.filetype)
          if buf == nil then
            return
          end

          -- Clear previous virtual text
          vim.api.nvim_buf_clear_namespace(buf, spinner.namespace_id, 0, -1)

          local last_line = vim.api.nvim_buf_line_count(buf) - 1
          vim.api.nvim_buf_set_extmark(buf, spinner.namespace_id, last_line, 0, {
            virt_lines = { { { spinner.spinner_symbols[spinner.spinner_index] .. " Processing...", "Comment" } } },
            virt_lines_above = true, -- false means below the line
          })
        end

        local function start_spinner()
          spinner.processing = true
          spinner.spinner_index = 0

          if spinner.timer then
            spinner.timer:stop()
            spinner.timer:close()
            spinner.timer = nil
          end

          spinner.timer = vim.loop.new_timer()
          spinner.timer:start(
            0,
            100,
            vim.schedule_wrap(function()
              update_spinner()
            end)
          )
        end

        spinner.namespace_id = vim.api.nvim_create_namespace("CodeCompanionSpinner")

        vim.api.nvim_create_augroup("CodeCompanionHooks", { clear = true })
        local group = vim.api.nvim_create_augroup("CodeCompanionHooks", {})

        vim.api.nvim_create_autocmd({ "User" }, {
          pattern = "CodeCompanionRequest*",
          group = group,
          callback = function(request)
            if request.match == "CodeCompanionRequestStarted" then
              start_spinner()
            elseif request.match == "CodeCompanionRequestFinished" then
              stop_spinner()
            end
          end,
        })
      end,
    },

    -- =============================================================
    -- Syntax Extension
    -- =============================================================
    {
      "nvim-treesitter/nvim-treesitter",
      dependencies = {
        "nvim-treesitter/nvim-treesitter-textobjects",
        "yioneko/nvim-yati",
      },
      lazy = false,
      build = ":TSUpdate",
      config = function()
        local configs = require("nvim-treesitter.configs")

        configs.setup({
          ensure_installed = {
            "astro",
            "bash",
            "c",
            "c_sharp",
            "cmake",
            "comment",
            "commonlisp",
            "cpp",
            "css",
            "dart",
            "diff",
            "dockerfile",
            "dot",
            "ebnf",
            "elm",
            "embedded_template",
            "erlang",
            "fish",
            "git_config",
            "git_rebase",
            "gitattributes",
            "gitcommit",
            "gitignore",
            "go",
            "godot_resource",
            "gomod",
            "gosum",
            "gowork",
            "graphql",
            "haskell",
            "hjson",
            "hlsl",
            "html",
            "http",
            "ini",
            "java",
            "javascript",
            "jq",
            "jsdoc",
            "json",
            "json5",
            "jsonc",
            "kotlin",
            "latex",
            "llvm",
            "lua",
            "luadoc",
            "luap",
            "luau",
            "make",
            "markdown",
            "markdown_inline",
            "mermaid",
            "nix",
            "ocaml",
            "ocaml_interface",
            "ocamllex",
            "perl",
            "php",
            "phpdoc",
            "prisma",
            "proto",
            "pug",
            "python",
            "query",
            "regex",
            "rust",
            "scala",
            "scheme",
            "scss",
            "sql",
            "svelte",
            "swift",
            "terraform",
            "todotxt",
            "toml",
            "tsx",
            "typescript",
            "ungrammar",
            "verilog",
            "vim",
            "vimdoc",
            "vue",
            "yaml",
            "zig",
          },
          sync_install = false,
          auto_install = false,
          highlight = {
            enable = true,
            additional_vim_regex_highlighting = false,
            disable = function(_, buf)
              local max_filesize = 100 * 1024 -- 100 KB
              local ok, stats = pcall(vim.loop.fs_stat, vim.api.nvim_buf_get_name(buf))
              if ok and stats and stats.size > max_filesize then
                return true
              end
            end,
          },
          indent = {
            enable = false,
          },
          yati = {
            enable = true,
            disable = {
              "typescript",
              "javascript",
              "tsx",
              "jsx",
            },
            default_lazy = true,
            default_fallback = "auto",
          },
          matchup = {
            enable = true,
          },
          textobjects = {
            select = {
              enable = true,
              keymaps = {
                ["af"] = "@function.outer",
                ["if"] = "@function.inner",
              },
              include_surrounding_whitespace = true,
            },
          },
        })
      end,
    },

    {
      "Wansmer/treesj",
      keys = {
        {
          "<Leader>m",
          '<cmd>lua require"treesj".toggle()<CR>',
          mode = "n",
          noremap = true,
        },
      },
      opts = {
        use_default_keymaps = false,
        check_syntax_error = true,
        max_join_length = 120,
        cursor_behavior = "hold",
        notify = true,
        dot_repeat = true,
        on_error = nil,
      },
    },

    {
      "windwp/nvim-autopairs",
      event = { "BufReadPre", "BufNewFile" },
      config = function()
        local npairs = require("nvim-autopairs")

        npairs.setup({
          check_ts = true,
          map_c_h = true,
          map_c_w = true,
        })
      end,
    },

    {
      "windwp/nvim-ts-autotag",
      event = { "BufReadPre", "BufNewFile" },
      opts = {},
    },

    -- =============================================================
    -- Filer
    -- =============================================================
    {
      "nvim-tree/nvim-tree.lua",
      dependencies = {
        "nvim-tree/nvim-web-devicons",
        "kwkarlwang/bufresize.nvim",
        "b0o/nvim-tree-preview.lua",
      },
      keys = {
        {
          "<C-j>",
          function()
            local api = require("nvim-tree.api")
            local bufresize = require("bufresize")

            bufresize.block_register()

            if api.tree.is_visible() then
              api.tree.close()
              bufresize.resize_close()
            else
              api.tree.open({ update_root = true, find_file = true })
              bufresize.resize_open()
            end
          end,
          mode = "n",
        },
      },
      opts = {
        sort_by = "case_sensitive",
        respect_buf_cwd = true,
        view = {
          width = 40,
          centralize_selection = true,
        },
        ui = {
          confirm = {
            remove = false,
          },
        },
        renderer = {
          highlight_git = true,
          highlight_opened_files = "all",
          highlight_modified = "all",
          indent_markers = {
            enable = true,
          },
          icons = {
            git_placement = "signcolumn",
            symlink_arrow = " ➜ ",
            glyphs = {
              symlink = "",
              bookmark = "󰄲",
              modified = "∙",
              git = {
                unstaged = "∙",
                staged = "∙",
                unmerged = "",
                renamed = "➜",
                untracked = "∙",
                deleted = "",
                ignored = "◌",
              },
            },
          },
        },
        actions = {
          file_popup = {
            open_win_config = {
              col = 1,
              row = 1,
              relative = "cursor",
              border = "rounded",
              style = "minimal",
            },
          },
          open_file = {
            resize_window = false,
            window_picker = {
              enable = false,
            },
          },
        },
        diagnostics = {
          enable = true,
        },
        git = {
          enable = false,
        },
        on_attach = function(bufnr)
          local api = require("nvim-tree.api")

          local function opts(desc)
            return {
              desc = "nvim-tree: " .. desc,
              buffer = bufnr,
              noremap = true,
              silent = true,
              nowait = true,
            }
          end

          -- root to global
          local function change_root_to_global_cwd()
            local global_cwd = vim.fn.getcwd(-1, -1)
            api.tree.change_root(global_cwd)
          end

          -- mark operation
          local mark_move_j = function()
            api.marks.toggle()
            vim.cmd("norm j")
          end

          -- marked files operation
          local mark_remove = function()
            local marks = api.marks.list()
            if #marks == 0 then
              table.insert(marks, api.tree.get_node_under_cursor())
            end
            vim.ui.input({ prompt = string.format("Delete %s files? [y/n] ", #marks) }, function(input)
              if input == "y" then
                for _, node in ipairs(marks) do
                  api.fs.remove(node)
                end
                api.marks.clear()
                api.tree.reload()
              end
            end)
          end

          local mark_copy = function()
            local marks = api.marks.list()
            if #marks == 0 then
              table.insert(marks, api.tree.get_node_under_cursor())
            end
            for _, node in pairs(marks) do
              api.fs.copy.node(node)
            end
            api.marks.clear()
            api.tree.reload()
          end

          local mark_cut = function()
            local marks = api.marks.list()
            if #marks == 0 then
              table.insert(marks, api.tree.get_node_under_cursor())
            end
            for _, node in pairs(marks) do
              api.fs.cut(node)
            end
            api.marks.clear()
            api.tree.reload()
          end

          local mark_rename = function()
            local marks = api.marks.list()
            if #marks == 0 then
              table.insert(marks, api.tree.get_node_under_cursor())
            end
            if #marks == 1 then
              api.fs.rename_node(marks[1])
            else
              local args = ""
              for _, node in pairs(marks) do
                args = args .. " " .. node.absolute_path
              end
              local Terminal = require("toggleterm.terminal").Terminal
              local term = Terminal:new({
                cmd = "mmv" .. args,
                direction = "horizontal",
                count = 9,
                start_in_insert = false,
                close_on_exit = true,
                on_open = function()
                  vim.cmd("startinsert!")
                end,
              })
              term:toggle()
            end
            api.marks.clear()
            api.tree.reload()
          end

          keymap({ "n" }, "q", api.tree.close, opts("Close"))
          keymap({ "n" }, ".", api.tree.toggle_gitignore_filter, opts("Toggle Gitignore"))
          keymap({ "n" }, "h", api.node.navigate.parent_close, opts("Parent"))
          keymap({ "n" }, "H", api.tree.change_root_to_parent, opts("Change Root To Parent"))
          keymap({ "n" }, "l", api.node.open.edit, opts("Edit Or Open"))
          keymap({ "n" }, "L", api.tree.change_root_to_node, opts("Change Root To Current Node"))
          keymap({ "n" }, "o", api.node.open.edit, opts("Edit Or Open"))
          keymap({ "n" }, "<CR>", api.node.open.edit, opts("Edit Or Open"))
          keymap({ "n" }, "<C-]>", api.tree.change_root_to_node, opts("CD"))
          keymap({ "n" }, "<C-t>", api.tree.change_root_to_parent, opts("Change Root To Parent"))
          keymap({ "n" }, "<C-h>", api.tree.change_root_to_parent, opts("Change Root To Parent"))
          keymap({ "n" }, "t", api.node.open.tab, opts("Open: New Tab"))
          keymap({ "n" }, "O", api.node.open.vertical, opts("Open: Vertical Split"))
          keymap({ "n" }, "~", change_root_to_global_cwd, opts("Change Root To Global CWD"))
          keymap({ "n" }, "E", api.tree.expand_all, opts("Expand All"))
          keymap({ "n" }, "W", api.tree.collapse_all, opts("Collapse All"))
          keymap({ "n" }, "-", api.tree.change_root_to_parent, opts("Up"))
          keymap({ "n" }, ")", api.node.navigate.sibling.next, opts("Next Sibling"))
          keymap({ "n" }, "(", api.node.navigate.sibling.prev, opts("Previous Sibling"))
          keymap({ "n" }, "]c", api.node.navigate.git.next, opts("Next Git"))
          keymap({ "n" }, "[c", api.node.navigate.git.prev, opts("Previous Git"))
          keymap({ "n" }, "N", api.fs.create, opts("Create New File"))
          keymap({ "n" }, "c", mark_copy, opts("Copy File"))
          keymap({ "n" }, "C", mark_cut, opts("Cut File"))
          keymap({ "n" }, "p", api.fs.paste, opts("Copy File"))
          keymap({ "n" }, "d", mark_remove, opts("Delete File"))
          keymap({ "n" }, "m", api.marks.bulk.move, opts("Move Marked"))
          keymap({ "n" }, "r", mark_rename, opts("Rename File"))
          keymap({ "n" }, "x", api.node.run.system, opts("Run System"))
          keymap({ "n" }, "y", api.fs.copy.filename, opts("Copy Name"))
          keymap({ "n" }, "Y", api.fs.copy.relative_path, opts("Copy Relative Path"))
          keymap({ "n" }, "<Space>", mark_move_j, opts("Toggle Mark"))
          keymap({ "n" }, "<C-[>", api.marks.clear, opts("Clear Marks"))
          keymap({ "n" }, "i", api.node.show_info_popup, opts("Show Info Node"))
          keymap({ "n" }, "f", api.live_filter.start, opts("Filter"))
          keymap({ "n" }, "F", api.live_filter.start, opts("Clean Filter"))
          keymap({ "n" }, "<C-l>", api.tree.reload, opts("Reload Tree"))
          keymap({ "n" }, "?", api.tree.toggle_help, opts("Help"))

          -- Preview
          local preview = require("nvim-tree-preview")

          local feedkey = function(mode, key)
            vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(key, true, true, true), mode, true)
          end

          local preview_watch = function()
            if preview.is_open() then
              preview.unwatch()
            else
              preview.watch()
            end
          end

          local preview_scroll_forward = function()
            if preview.is_open() then
              preview.scroll(10)
            else
              feedkey("n", "<C-f>")
            end
          end

          local preview_scroll_backward = function()
            if preview.is_open() then
              preview.scroll(-10)
            else
              feedkey("n", "<C-b>")
            end
          end

          keymap({ "n" }, "<Tab>", preview_watch, opts("Preview"))
          keymap({ "n" }, "<C-c>", preview.unwatch, opts("Close Preview / Unwatch"))
          keymap({ "n" }, "<C-f>", preview_scroll_forward, opts("Scroll Forward"))
          keymap({ "n" }, "<C-b>", preview_scroll_backward, opts("Scroll Backward"))
        end,
      },
    },

    {
      "antosha417/nvim-lsp-file-operations",
      event = "LspAttach",
      dependencies = {
        "nvim-lua/plenary.nvim",
      },
      opts = {
        debug = false,
        operations = {
          willRenameFiles = true,
          didRenameFiles = true,
          willCreateFiles = true,
          didCreateFiles = true,
          willDeleteFiles = true,
          didDeleteFiles = true,
        },
        timeout_ms = 10000,
      },
    },

    {
      "folke/snacks.nvim",
      priority = 1000,
      lazy = false,
      opts = {
        bigfile = { enabled = true },
        dashboard = { enabled = false },
        explorer = { enabled = false },
        indent = { enabled = false },
        notifier = { enabled = false },
        quickfile = { enabled = false },
        scope = { enabled = false },
        scroll = { enabled = false },
        statuscolumn = { enabled = false },
        words = { enabled = false },
        input = { enabled = false },
        picker = {
          enabled = true,
          layouts = {
            default = {
              layout = {
                width = 0.9,
                height = 0.7,
              },
            },
            select = {
              layout = {
                width = 0.75,
              },
            },
          },
          sources = {
            command_history = {
              layout = {
                preset = "select",
              },
            },
          },
          win = {
            input = {
              keys = (function()
                local function code(keys)
                  return vim.api.nvim_replace_termcodes(keys, true, true, true)
                end
                local function feed(keys)
                  return function()
                    vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(keys, true, false, true), "i", false)
                    return ""
                  end
                end
                return {
                  ["<C-a>"] = { feed("<Home>"), mode = "i", expr = true, nowait = true },
                  ["<C-e>"] = { feed("<End>"), mode = "i", expr = true, nowait = true },
                  ["<C-b>"] = { feed("<Left>"), mode = "i", expr = true, nowait = true },
                  ["<C-f>"] = { feed("<Right>"), mode = "i", expr = true, nowait = true },
                  ["<C-d>"] = { feed("<Del>"), mode = "i", expr = true, nowait = true },
                  ["<C-u>"] = { code("<C-u>"), mode = "i", expr = true, nowait = true },
                  ["<C-n>"] = { "history_forward", mode = { "i", "n" } },
                  ["<C-p>"] = { "history_back", mode = { "i", "n" } },
                }
              end)(),
            },
          },
        },
      },
      keys = {
        -- picker
        {
          "<C-p>",
          function()
            Snacks.picker.files({
              hidden = true,
            })
          end,
          mode = "n",
          noremap = true,
        },
        {
          "<Leader>gg",
          function()
            Snacks.picker.grep()
          end,
          mode = "n",
          noremap = true,
        },
        {
          "z/",
          function()
            Snacks.picker.grep_buffers()
          end,
          mode = "n",
          noremap = true,
        },
        {
          "<Leader>bb",
          function()
            Snacks.picker.buffers()
          end,
          mode = "n",
          noremap = true,
        },
        {
          "<Leader>cc",
          function()
            Snacks.picker.commands()
          end,
          mode = "n",
          noremap = true,
        },
        {
          "<Leader>cl",
          function()
            Snacks.picker.command_history()
          end,
          mode = "n",
          noremap = true,
        },
        {
          "<Leader>gb",
          function()
            -- Custom action for multiple branch deletion
            local function git_branch_del_multiple(picker)
              -- Get selected items (or current item if none selected)
              local items = picker:selected({ fallback = true })

              -- Collect branch names to delete
              local branches = {}
              local current_branch = vim.trim(vim.fn.system("git branch --show-current"))

              for _, item in ipairs(items) do
                if item and item.branch and item.branch ~= current_branch then
                  table.insert(branches, item.branch)
                end
              end

              -- Check if trying to delete current branch
              if #branches == 0 then
                if #items > 0 and items[1].branch == current_branch then
                  Snacks.notify.error("Cannot delete the current branch", { title = "Snacks Picker" })
                end
                return
              end

              -- Confirm deletion
              local msg = #branches == 1 and string.format("Delete branch %q?", branches[1])
                or string.format("Delete %d branches? (%s)", #branches, table.concat(branches, ", "))

              Snacks.picker.select({ "Yes", "No" }, { prompt = msg }, function(choice)
                if choice ~= "Yes" then
                  return
                end

                -- Delete branches
                local deleted = {}
                local failed = {}
                local completed = 0

                local function finish()
                  -- Notify results
                  if #deleted > 0 then
                    local notify_msg = #deleted == 1 and string.format("Deleted branch: %s", deleted[1])
                      or string.format("Deleted %d branches: %s", #deleted, table.concat(deleted, ", "))
                    Snacks.notify(notify_msg, { title = "Snacks Picker" })
                  end

                  if #failed > 0 then
                    Snacks.notify.error(
                      string.format("Failed to delete: %s", table.concat(failed, ", ")),
                      { title = "Snacks Picker" }
                    )
                  end

                  -- Update picker (same as original git_branch_del)
                  vim.cmd.checktime()
                  picker.list:set_selected()
                  picker.list:set_target()
                  picker:find()
                end

                -- Delete each branch
                for _, branch in ipairs(branches) do
                  Snacks.picker.util.cmd({ "git", "branch", "-D", branch }, function(_, code)
                    if code == 0 then
                      table.insert(deleted, branch)
                    else
                      table.insert(failed, branch)
                    end
                    completed = completed + 1
                    if completed == #branches then
                      finish()
                    end
                  end, { cwd = picker:cwd() })
                end
              end)
            end

            Snacks.picker.git_branches({
              actions = {
                git_branch_del_multiple = git_branch_del_multiple,
              },
              win = {
                input = {
                  keys = {
                    ["<C-x>"] = { "git_branch_del_multiple", mode = { "n", "i" } },
                  },
                },
              },
            })
          end,
          mode = "n",
          noremap = true,
        },
        {
          "<Leader>gl",
          function()
            Snacks.picker.git_log_file()
          end,
          mode = "n",
          noremap = true,
        },
      },
    },

    {
      "nvim-telescope/telescope.nvim",
      event = "VeryLazy",
      dependencies = {
        "nvim-lua/plenary.nvim",
        { "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
        "nvim-telescope/telescope-live-grep-args.nvim",
        "rcarriga/nvim-notify",
      },
      keys = {
        -- { "<C-p>", "<cmd>Telescope find_files<CR>", mode = "n", noremap = true },
        -- { "z/", "<cmd>Telescope current_buffer_fuzzy_find<CR>", mode = "n", noremap = true },
        -- {
        --   "<Leader>gg",
        --   ":lua require('telescope').extensions.live_grep_args.live_grep_args()<CR>",
        --   mode = "n",
        --   noremap = true,
        -- },
        -- { "<Leader>bb", "<cmd>Telescope buffers<CR>", mode = "n", noremap = true },
        -- { "<Leader>cc", "<cmd>Telescope commands<CR>", mode = "n", noremap = true },
        -- { "<Leader>cl", "<cmd>Telescope command_history<CR>", mode = "n", noremap = true },
        -- { "<Leader>gb", "<cmd>Telescope git_branches<CR>", mode = "n", noremap = true },
        -- { "<Leader>gl", "<cmd>Telescope git_commits<CR>", mode = "n", noremap = true },
        -- { "<Leader>gc", "<cmd>Telescope git_bcommits<CR>", mode = "n", noremap = true },
        -- { "<Leader>gp", "<cmd>Telescope gh pull_request<CR>", mode = "n", noremap = true },
        -- { "<Leader>hl", "<cmd>Telescope highlights<CR>", mode = "n", noremap = true },
        -- { "<Leader>el", "<cmd>Telescope diagnostics<CR>", mode = "n", noremap = true },
        -- { "<Leader>nh", "<cmd>Telescope notify<CR>", mode = "n", noremap = true },
      },
      config = function()
        local telescope = require("telescope")
        local action = require("telescope.actions")
        local action_state = require("telescope.actions.state")
        local action_layout = require("telescope.actions.layout")
        local lga_actions = require("telescope-live-grep-args.actions")

        local function action_yank()
          local selection = action_state.get_selected_entry()
          vim.fn.setreg("*", selection.value)
          print("Yanked!")
        end

        local function wrap_dropdown_opts(opts)
          opts = opts or {}
          opts.theme = "dropdown"
          opts.layout_config = {
            width = 0.9,
            height = 0.7,
          }
          return opts
        end

        telescope.setup({
          defaults = {
            prompt_prefix = "❯ ",
            selection_caret = " ",
            multi_icon = "󰄲 ",
            path_display = { "truncate" },
            layout_config = {
              width = 0.8,
              height = 0.6,
            },
            preview = {
              hide_on_startup = false,
            },
            mappings = {
              i = {
                ["<C-u>"] = false,
                ["<C-w>"] = false,
                ["<C-d>"] = { "<Del>", type = "command" },
                ["<C-h>"] = { "<BS>", type = "command" },
                ["<C-a>"] = { "<Home>", type = "command" },
                ["<C-e>"] = { "<End>", type = "command", opts = { nowait = true } },
                ["<C-f>"] = { "<Right>", type = "command" },
                ["<C-b>"] = { "<Left>", type = "command" },
                ["<C-j>"] = "move_selection_next",
                ["<C-k>"] = "move_selection_previous",
                ["<C-p>"] = "cycle_history_prev",
                ["<C-n>"] = "cycle_history_next",
                ["<C-q>"] = action.smart_send_to_qflist + action.open_qflist,
                ["<C-y>"] = action_yank,
                ["<Up>"] = "preview_scrolling_up",
                ["<Down>"] = "preview_scrolling_down",
                ["<C-\\>"] = action_layout.toggle_preview,
              },
              n = {
                ["<C-k>"] = "preview_scrolling_up",
                ["<C-j>"] = "preview_scrolling_down",
                ["<C-\\>"] = action_layout.toggle_preview,
              },
            },
            vimgrep_arguments = {
              "rg",
              "--color=never",
              "--no-heading",
              "--with-filename",
              "--line-number",
              "--column",
              "--smart-case",
              "--trim",
            },
          },
          pickers = {
            find_files = wrap_dropdown_opts({
              find_command = {
                "fd",
                "--type",
                "f",
                "--strip-cwd-prefix",
                "--hidden",
                "-E",
                ".git",
              },
            }),
            live_grep = wrap_dropdown_opts({
              additional_args = function()
                return {
                  "--hidden",
                  "-g",
                  "!.git",
                }
              end,
            }),
            buffers = wrap_dropdown_opts({
              only_cwd = true,
              sort_lastused = true,
              sort_mru = true,
              ignore_current_buffer = true,
            }),
            commands = wrap_dropdown_opts({}),
            command_history = wrap_dropdown_opts({
              attach_mappings = function(_, map)
                map({ "i" }, "<C-e>", function()
                  local key = vim.api.nvim_replace_termcodes("<End>", true, true, true)
                  vim.api.nvim_feedkeys(key, "m", true)
                end, { nowait = true })

                map({ "i" }, "<C-i>", action.edit_command_line)

                return true
              end,
            }),
            git_commits = {
              mappings = {
                i = {
                  ["<C-y>"] = action_yank,
                },
              },
            },
            git_bcommits = {
              mappings = {
                i = {
                  ["<C-y>"] = action_yank,
                },
              },
            },
            git_branches = {
              show_remote_tracking_branches = false,
              mappings = {
                i = {
                  ["<CR>"] = "git_checkout",
                  ["<C-y>"] = action_yank,
                  ["<C-m>"] = "git_merge_branch",
                },
              },
            },
          },
          extensions = {
            fzf = {
              fuzzy = true,
              override_generic_sorter = true,
              override_file_sorter = true,
              case_mode = "smart_case",
            },
            live_grep_args = wrap_dropdown_opts({
              auto_quoting = true,
              mappings = {
                i = {
                  ["<C-i>"] = lga_actions.quote_prompt(),
                },
              },
              additional_args = function()
                return {
                  "--hidden",
                  "-g",
                  "!.git",
                }
              end,
            }),
          },
        })

        telescope.load_extension("fzf")
        telescope.load_extension("live_grep_args")
        telescope.load_extension("notify")
      end,
    },

    -- =============================================================
    -- Layout
    -- =============================================================
    {
      "kwkarlwang/bufresize.nvim",
      event = "VeryLazy",
      dependencies = {
        { "kana/vim-submode" },
      },
      config = function()
        require("bufresize").setup({
          register = {
            keys = {
              { "n", "sJ", "<C-w>J", { noremap = true, silent = true } },
              { "n", "sK", "<C-w>K", { noremap = true, silent = true } },
              { "n", "sL", "<C-w>L", { noremap = true, silent = true } },
              { "n", "sH", "<C-w>H", { noremap = true, silent = true } },
              { "n", "ss", ":sp<CR>", { noremap = true, silent = true } },
              { "n", "sv", ":vs<CR>", { noremap = true, silent = true } },
              { "n", "sq", ":q<CR>", { noremap = true, silent = true } },
              { "n", "sQ", ":bd<CR>", { noremap = true, silent = true } },
              { "n", "so", "<C-w>_<C-w><Bar>", { noremap = true, silent = true } },
              { "n", "sO", "<C-w>=", { noremap = true, silent = true } },
              { "n", "<C-w>o", "<C-w>o", { noremap = true, silent = true } },
            },
            trigger_events = { "BufWinEnter", "WinEnter" },
          },
          resize = {
            keys = {},
            trigger_events = { "VimResized" },
            increment = 5,
          },
        })

        local function enter(submode, mode, lhs, rhs)
          vim.fn["submode#enter_with"](submode, mode, "", lhs, rhs .. '<cmd>lua require("bufresize").register()<CR>')
        end

        local function kmap(submode, mode, lhs, rhs)
          vim.fn["submode#map"](submode, mode, "", lhs, rhs .. '<cmd>lua require("bufresize").register()<CR>')
        end

        enter("winsize", "n", "s>", "4<C-w>>")
        kmap("winsize", "n", ">", "4<C-w>>")

        enter("winsize", "n", "s<", "4<C-w><")
        kmap("winsize", "n", "<", "4<C-w><")

        enter("winsize", "n", "s+", "4<C-w>+")
        kmap("winsize", "n", "+", "4<C-w>+")

        enter("winsize", "n", "s-", "4<C-w>-")
        kmap("winsize", "n", "-", "4<C-w>-")
      end,
    },

    -- =============================================================
    -- Terminal
    -- =============================================================
    {
      "akinsho/toggleterm.nvim",
      event = "VeryLazy",
      dependencies = {
        "kwkarlwang/bufresize.nvim",
      },
      config = function()
        local bufresize = require("bufresize")

        require("toggleterm").setup({
          size = function(term)
            if term.direction == "horizontal" then
              return vim.o.lines * 0.4
            elseif term.direction == "vertical" then
              return vim.o.columns * 0.5
            end
          end,
          shade_terminals = false,
          float_opts = {
            border = "rounded",
          },
          highlights = {
            FloatBorder = {
              link = "FloatBorder",
            },
          },
          auto_scroll = false,
          start_in_insert = false,
          winbar = {
            enabled = false,
          },
          on_open = function(term)
            -- Disable LSP diagnostics in terminal
            vim.diagnostic.enable(false, { bufnr = term.bufnr })
            for _, c in ipairs(vim.lsp.get_clients({ bufnr = term.bufnr })) do
              vim.lsp.buf_detach_client(term.bufnr, c.id)
            end
          end,
        })

        local function find_toggleterm_buffer()
          local windows = vim.api.nvim_tabpage_list_wins(0)
          for _, win in ipairs(windows) do
            local buf = vim.api.nvim_win_get_buf(win)
            local filetype = vim.api.nvim_buf_get_option(buf, "filetype")
            if filetype == "toggleterm" then
              return buf
            end
          end
          return nil
        end

        ToggleTerm = function(direction)
          local command = 'exe v:count1 "ToggleTerm'
          if direction == "float" then
            command = command .. " direction=float"
          elseif direction == "horizontal" then
            command = command .. " direction=horizontal"
          elseif direction == "vertical" then
            command = command .. " direction=vertical"
          end
          command = command .. '"'

          bufresize.block_register()
          if find_toggleterm_buffer() ~= nil then
            vim.api.nvim_command(command)
            bufresize.resize_close()
          else
            vim.api.nvim_command(command)
            bufresize.resize_open()
          end
        end

        keymap({ "n" }, "<Leader>tt", function()
          ToggleTerm("float")
        end)

        keymap({ "n" }, "<Leader>ts", function()
          ToggleTerm("horizontal")
        end)

        keymap({ "n" }, "<Leader>tv", function()
          ToggleTerm("vertical")
        end)

        keymap({ "n" }, "<Leader>tl", function()
          vim.cmd("TermSelect")
        end)

        keymap(
          { "t" },
          "<C-q>",
          "<C-\\><C-n>"
            .. ':lua require("bufresize").block_register()<CR>'
            .. "<C-w>c"
            .. ':lua require("bufresize").resize_close()<CR>'
        )
      end,
    },

    -- =============================================================
    -- Session
    -- =============================================================
    {
      "folke/persistence.nvim",
      event = "VeryLazy",
      keys = {
        {
          "<Leader>ql",
          function()
            require("persistence").select()
          end,
          mode = "n",
          noremap = true,
        },
        {
          "<Leader>qs",
          function()
            require("persistence").load()
          end,
          mode = "n",
          noremap = true,
        },
        {
          "<Leader>qd",
          function()
            require("persistence").stop()
          end,
          mode = "n",
          noremap = true,
        },
      },
      opts = {},
    },

    -- =============================================================
    -- UI
    -- =============================================================
    {
      "nvim-lualine/lualine.nvim",
      event = "VeryLazy",
      config = function()
        local colors = {
          purple = "#929be5",
          teal = "#73c1a9",
          pink = "#b871b8",
          red = "#dc6f7a",
          bg = "#282a3a",
          fg = "#4b4e6d",
          inactive = {
            bg = "#282a3a",
            fg = "#4b4e6d",
          },
        }

        local dogrun_theme = {
          normal = {
            a = { fg = colors.bg, bg = colors.purple },
            b = { fg = colors.purple, bg = colors.bg },
            c = { fg = colors.fg, bg = colors.bg },
            x = { fg = colors.inactive.fg, bg = colors.inactive.bg },
            y = { fg = colors.inactive.fg, bg = colors.inactive.bg },
          },
          insert = {
            a = { fg = colors.bg, bg = colors.teal },
            b = { fg = colors.teal, bg = colors.bg },
            x = { fg = colors.inactive.fg, bg = colors.inactive.bg },
            y = { fg = colors.inactive.fg, bg = colors.inactive.bg },
          },
          visual = {
            a = { fg = colors.bg, bg = colors.pink },
            b = { fg = colors.pink, bg = colors.bg },
            x = { fg = colors.inactive.fg, bg = colors.inactive.bg },
            y = { fg = colors.inactive.fg, bg = colors.inactive.bg },
          },
          replace = {
            a = { fg = colors.bg, bg = colors.red },
            b = { fg = colors.red, bg = colors.bg },
            x = { fg = colors.inactive.fg, bg = colors.inactive.bg },
            y = { fg = colors.inactive.fg, bg = colors.inactive.bg },
          },
          command = {
            a = { fg = colors.bg, bg = colors.teal },
            b = { fg = colors.teal, bg = colors.bg },
            x = { fg = colors.inactive.fg, bg = colors.inactive.bg },
            y = { fg = colors.inactive.fg, bg = colors.inactive.bg },
          },
          terminal = {
            a = { fg = colors.bg, bg = colors.teal },
            b = { fg = colors.teal, bg = colors.bg },
            x = { fg = colors.inactive.fg, bg = colors.inactive.bg },
            y = { fg = colors.inactive.fg, bg = colors.inactive.bg },
          },
          inactive = {
            a = { fg = colors.inactive.fg, bg = colors.inactive.bg },
            b = { fg = colors.inactive.fg, bg = colors.inactive.bg },
            c = { fg = colors.inactive.fg, bg = colors.inactive.bg },
          },
        }

        require("lualine").setup({
          options = {
            theme = dogrun_theme,
            component_separators = "",
            section_separators = { left = "", right = "" },
            globalstatus = true,
            always_divide_middle = false,
          },
          sections = {
            lualine_a = {
              {
                "mode",
                separator = { left = "", right = "" },
              },
            },
            lualine_b = {
              {
                "branch",
                padding = { left = 2 },
              },
              {
                "diagnostics",
                padding = { left = 2 },
                sources = {
                  "nvim_diagnostic",
                },
                sections = {
                  "error",
                  "warn",
                  "info",
                },
                symbols = {
                  error = " ",
                  warn = " ",
                  info = "כֿ ",
                },
              },
            },
            lualine_c = {},
            lualine_x = {},
            lualine_y = {
              {
                "filetype",
                padding = { right = 2 },
                colored = false,
              },
              {
                "encoding",
                padding = { right = 2 },
              },
              {
                "fileformat",
                padding = { right = 2 },
              },
            },
            lualine_z = {
              {
                "location",
                padding = 1,
                icon = { "¶", align = "right" },
                separator = { left = "", right = "" },
              },
            },
          },
          inactive_sections = {
            lualine_a = {
              "filename",
            },
            lualine_b = {},
            lualine_c = {},
            lualine_x = {},
            lualine_y = {},
            lualine_z = {
              "location",
            },
          },
          tabline = {
            lualine_a = {},
            lualine_b = {},
            lualine_c = {
              {
                "tabs",
                separator = { right = "" },
                mode = 1,
                path = 1,
                max_length = function()
                  return vim.o.columns
                end,
                tabs_color = {
                  active = "lualine_a_normal",
                  inactive = "lualine_a_inactive",
                },
                show_modified_status = false,
                fmt = function(name, context)
                  local buflist = vim.fn.tabpagebuflist(context.tabnr)
                  local winnr = vim.fn.tabpagewinnr(context.tabnr)
                  local bufnr = buflist[winnr]
                  local mod = vim.fn.getbufvar(bufnr, "&mod")
                  return name .. (mod == 1 and " ∙" or "")
                end,
              },
            },
            lualine_x = {},
            lualine_y = {},
            lualine_z = {},
          },
          extensions = {
            "nvim-tree",
            "fugitive",
            "toggleterm",
          },
        })
      end,
    },

    {
      "rcarriga/nvim-notify",
      event = "VeryLazy",
      config = function()
        local notify = require("notify")
        notify.setup({
          background_colour = "NotifyBackground",
          render = "wrapped-compact",
          stages = "fade",
          top_down = false,
          -- max_width = function()
          --   return vim.o.columns / 2
          -- end,
        })
        vim.notify = notify
      end,
    },

    -- =============================================================
    -- Git
    -- =============================================================
    {
      "tpope/vim-fugitive",
      keys = {
        { "<Leader>gs", "<cmd>Git<CR>", mode = "n", noremap = true, silent = true },
        { "<Leader>gd", "<cmd>Gvdiffsplit<CR>", mode = "n", noremap = true, silent = true },
      },
      cmd = {
        "Git",
        "Gread",
        "Gdiff",
        "Gblame",
      },
      init = function()
        -- augroupを設定
        local augroup = vim.api.nvim_create_augroup("fugitive_setup", { clear = true })

        vim.api.nvim_create_autocmd("FileType", {
          group = augroup,
          pattern = "fugitive",
          callback = function()
            vim.api.nvim_buf_set_keymap(0, "n", "q", "<C-w>c", { noremap = true, silent = true })
            vim.api.nvim_buf_set_keymap(0, "n", "s", "<C-w>", { noremap = false, silent = true })
          end,
        })

        vim.api.nvim_create_autocmd("FileType", {
          group = augroup,
          pattern = "fugitiveblame",
          callback = function()
            vim.api.nvim_buf_set_keymap(0, "n", "q", "gq", { noremap = false, silent = true })
            vim.api.nvim_buf_set_keymap(0, "n", "gp", "", {
              noremap = true,
              silent = true,
              callback = function()
                local line = vim.fn.getline(".")
                local pos = string.find(line, " ")
                local hash = string.sub(line, 1, pos - 1)
                local number = 0

                -- squash merge
                local job1 = vim
                  .system({
                    "gh",
                    "pr",
                    "list",
                    "--search",
                    hash,
                    "--state",
                    "merged",
                    "--json",
                    "number,mergeCommit",
                    "--jq",
                    string.format('.[] | select(.mergeCommit.oid | startswith("%s")) | .number', hash),
                  }, {
                    text = true,
                  })
                  :wait()

                if job1.code == 0 then
                  local n = tonumber(job1.stdout)
                  if n ~= nil then
                    number = n
                  end
                end

                -- merge commit
                if number == 0 then
                  local job2 = vim
                    .system({
                      "git",
                      "log",
                      "--merges",
                      "--oneline",
                      "--reverse",
                      "--ancestry-path",
                      string.format("%s...origin", hash),
                    }, {
                      text = true,
                    })
                    :wait()

                  if job2.code == 0 then
                    local ln = vim.split(job2.stdout, "\n")[1]
                    local raw = string.match(ln, "Merge pull request #(%d+)")
                    local n = tonumber(raw)
                    if n ~= nil then
                      number = n
                    end
                  end
                end

                -- open web
                if number > 0 then
                  vim
                    .system({
                      "gh",
                      "pr",
                      "view",
                      "--web",
                      number,
                    })
                    :wait()
                end
              end,
            })
          end,
        })
      end,
    },

    {
      "rhysd/conflict-marker.vim",
      event = "BufReadPost",
    },

    {
      "lewis6991/gitsigns.nvim",
      event = "BufReadPost",
      opts = {
        signs = {
          add = { text = "│" },
          change = { text = "│" },
          delete = { text = "│" },
          topdelete = { text = "│" },
          changedelete = { text = "│" },
          untracked = { text = "│" },
        },
        signcolumn = true, -- Toggle with `:Gitsigns toggle_signs`
        numhl = false, -- Toggle with `:Gitsigns toggle_numhl`
        linehl = false, -- Toggle with `:Gitsigns toggle_linehl`
        word_diff = false, -- Toggle with `:Gitsigns toggle_word_diff`
        watch_gitdir = {
          interval = 1000,
          follow_files = true,
        },
        attach_to_untracked = true,
        current_line_blame = true, -- Toggle with `:Gitsigns toggle_current_line_blame`
        current_line_blame_opts = {
          virt_text = true,
          virt_text_pos = "eol", -- 'eol' | 'overlay' | 'right_align'
          delay = 1000,
          ignore_whitespace = false,
        },
        current_line_blame_formatter = " <author>, <author_time:%Y-%m-%d> - <summary>",
        sign_priority = 6,
        update_debounce = 100,
        status_formatter = nil, -- Use default
        max_file_length = 10000,
        preview_config = {
          -- Options passed to nvim_open_win
          border = "single",
          style = "minimal",
          relative = "cursor",
          row = 0,
          col = 1,
        },
        on_attach = function(bufnr)
          local gs = package.loaded.gitsigns
          local function map(mode, l, r, opts)
            opts = opts or {}
            opts.buffer = bufnr
            vim.keymap.set(mode, l, r, opts)
          end

          -- Navigation
          map("n", "]c", function()
            if vim.wo.diff then
              return "]c"
            end
            vim.schedule(function()
              gs.next_hunk()
            end)
            return "<Ignore>"
          end, { expr = true })

          map("n", "[c", function()
            if vim.wo.diff then
              return "[c"
            end
            vim.schedule(function()
              gs.prev_hunk()
            end)
            return "<Ignore>"
          end, { expr = true })

          -- Actions
          map("n", "<Space>gp", gs.preview_hunk)
          map("n", "<Space>gb", gs.toggle_current_line_blame)

          -- Text object
          map({ "o", "x" }, "ih", ":<C-U>Gitsigns select_hunk<CR>")
        end,
      },
    },

    {
      "sindrets/diffview.nvim",
      keys = {
        { "<Leader>gD", "<cmd>DiffviewOpen<CR>", mode = "n", noremap = true },
        { "<Leader>gh", "<cmdfDiffviewFileHistory<CR>", mode = "n", noremap = true },
      },
      config = function()
        local actions = require("diffview.actions")

        require("diffview").setup({
          diff_binaries = false, -- Show diffs for binaries
          enhanced_diff_hl = false, -- See ':h diffview-config-enhanced_diff_hl'
          git_cmd = { "git" }, -- The git executable followed by default args.
          hg_cmd = { "hg" }, -- The hg executable followed by default args.
          use_icons = true, -- Requires nvim-web-devicons
          show_help_hints = true, -- Show hints for how to open the help panel
          watch_index = true, -- Update views and index buffers when the git index changes.
          icons = { -- Only applies when use_icons is true.
            folder_closed = "",
            folder_open = "",
          },
          signs = {
            fold_closed = "",
            fold_open = "",
            done = "✓",
          },
          view = {
            default = {
              layout = "diff2_horizontal",
              winbar_info = false,
            },
            merge_tool = {
              layout = "diff3_horizontal",
              disable_diagnostics = true,
              winbar_info = true,
            },
            file_history = {
              layout = "diff2_horizontal",
              winbar_info = false,
            },
          },
          file_panel = {
            listing_style = "tree",
            tree_options = {
              flatten_dirs = true,
              folder_statuses = "only_folded",
            },
            win_config = {
              position = "top",
              width = 35,
              height = 10,
              win_opts = {},
            },
          },
          file_history_panel = {
            log_options = {
              git = {
                single_file = {
                  diff_merges = "combined",
                },
                multi_file = {
                  diff_merges = "first-parent",
                },
              },
            },
            win_config = {
              position = "bottom",
              height = 16,
              win_opts = {},
            },
          },
          commit_log_panel = {
            win_config = {
              win_opts = {},
            },
          },
          keymaps = {
            disable_defaults = true,
            view = {
              {
                "n",
                "<Tab>",
                actions.select_next_entry,
                { desc = "Open the diff for the next file" },
              },
              {
                "n",
                "<s-tab>",
                actions.select_prev_entry,
                { desc = "Open the diff for the previous file" },
              },
              {
                "n",
                "gf",
                actions.goto_file_edit,
                { desc = "Open the file in the previous tabpage" },
              },
              {
                "n",
                "<C-w><C-f>",
                actions.goto_file_split,
                { desc = "Open the file in a new split" },
              },
              {
                "n",
                "<C-w>gf",
                actions.goto_file_tab,
                { desc = "Open the file in a new tabpage" },
              },
              {
                "n",
                "<Leader>e",
                actions.focus_files,
                { desc = "Bring focus to the file panel" },
              },
              {
                "n",
                "<Leader>b",
                actions.toggle_files,
                { desc = "Toggle the file panel." },
              },
              {
                "n",
                "g<C-x>",
                actions.cycle_layout,
                { desc = "Cycle through available layouts." },
              },
              {
                "n",
                "[x",
                actions.prev_conflict,
                { desc = "In the merge-tool: jump to the previous conflict" },
              },
              {
                "n",
                "]x",
                actions.next_conflict,
                { desc = "In the merge-tool: jump to the next conflict" },
              },
              {
                "n",
                "<Leader>co",
                actions.conflict_choose("ours"),
                { desc = "Choose the OURS version of a conflict" },
              },
              {
                "n",
                "<Leader>ct",
                actions.conflict_choose("theirs"),
                { desc = "Choose the THEIRS version of a conflict" },
              },
              {
                "n",
                "<Leader>cb",
                actions.conflict_choose("base"),
                { desc = "Choose the BASE version of a conflict" },
              },
              {
                "n",
                "<Leader>ca",
                actions.conflict_choose("all"),
                { desc = "Choose all the versions of a conflict" },
              },
              {
                "n",
                "dx",
                actions.conflict_choose("none"),
                { desc = "Delete the conflict region" },
              },
              {
                "n",
                "<Leader>cO",
                actions.conflict_choose_all("ours"),
                { desc = "Choose the OURS version of a conflict for the whole file" },
              },
              {
                "n",
                "<Leader>cT",
                actions.conflict_choose_all("theirs"),
                { desc = "Choose the THEIRS version of a conflict for the whole file" },
              },
              {
                "n",
                "<Leader>cB",
                actions.conflict_choose_all("base"),
                { desc = "Choose the BASE version of a conflict for the whole file" },
              },
              {
                "n",
                "<Leader>cA",
                actions.conflict_choose_all("all"),
                { desc = "Choose all the versions of a conflict for the whole file" },
              },
              {
                "n",
                "dX",
                actions.conflict_choose_all("none"),
                { desc = "Delete the conflict region for the whole file" },
              },
            },
            diff1 = {
              { "n", "g?", actions.help({ "view", "diff1" }), { desc = "Open the help panel" } },
            },
            diff2 = {
              { "n", "g?", actions.help({ "view", "diff2" }), { desc = "Open the help panel" } },
            },
            diff3 = {
              {
                { "n", "x" },
                "2do",
                actions.diffget("ours"),
                { desc = "Obtain the diff hunk from the OURS version of the file" },
              },
              {
                { "n", "x" },
                "3do",
                actions.diffget("theirs"),
                { desc = "Obtain the diff hunk from the THEIRS version of the file" },
              },
              {
                "n",
                "g?",
                actions.help({ "view", "diff3" }),
                { desc = "Open the help panel" },
              },
            },
            diff4 = {
              {
                { "n", "x" },
                "1do",
                actions.diffget("base"),
                { desc = "Obtain the diff hunk from the BASE version of the file" },
              },
              {
                { "n", "x" },
                "2do",
                actions.diffget("ours"),
                { desc = "Obtain the diff hunk from the OURS version of the file" },
              },
              {
                { "n", "x" },
                "3do",
                actions.diffget("theirs"),
                { desc = "Obtain the diff hunk from the THEIRS version of the file" },
              },
              {
                "n",
                "g?",
                actions.help({ "view", "diff4" }),
                { desc = "Open the help panel" },
              },
            },
            file_panel = {
              {
                "n",
                ")",
                actions.next_entry,
                { desc = "Bring the cursor to the next file entry" },
              },
              {
                "n",
                "j",
                actions.next_entry,
                { desc = "Bring the cursor to the next file entry" },
              },
              {
                "n",
                "<Down>",
                actions.next_entry,
                { desc = "Bring the cursor to the next file entry" },
              },
              {
                "n",
                "(",
                actions.prev_entry,
                { desc = "Bring the cursor to the previous file entry" },
              },
              {
                "n",
                "k",
                actions.prev_entry,
                { desc = "Bring the cursor to the previous file entry" },
              },
              {
                "n",
                "<Up>",
                actions.prev_entry,
                { desc = "Bring the cursor to the previous file entry" },
              },
              {
                "n",
                "<CR>",
                actions.select_entry,
                { desc = "Open the diff for the selected entry" },
              },
              {
                "n",
                "o",
                actions.select_entry,
                { desc = "Open the diff for the selected entry" },
              },
              {
                "n",
                "l",
                actions.select_entry,
                { desc = "Open the diff for the selected entry" },
              },
              {
                "n",
                "-",
                actions.toggle_stage_entry,
                { desc = "Stage / unstage the selected entry" },
              },
              {
                "n",
                "S",
                actions.stage_all,
                { desc = "Stage all entries" },
              },
              {
                "n",
                "U",
                actions.unstage_all,
                { desc = "Unstage all entries" },
              },
              {
                "n",
                "X",
                actions.restore_entry,
                { desc = "Restore entry to the state on the left side" },
              },
              {
                "n",
                "L",
                actions.open_commit_log,
                { desc = "Open the commit log panel" },
              },
              { "n", "zo", actions.open_fold, { desc = "Expand fold" } },
              { "n", "h", actions.close_fold, { desc = "Collapse fold" } },
              { "n", "za", actions.toggle_fold, { desc = "Toggle fold" } },
              { "n", "zR", actions.open_all_folds, { desc = "Expand all folds" } },
              {
                "n",
                "zM",
                actions.close_all_folds,
                { desc = "Collapse all folds" },
              },
              {
                "n",
                "<C-b>",
                actions.scroll_view(-0.25),
                { desc = "Scroll the view up" },
              },
              {
                "n",
                "<C-f>",
                actions.scroll_view(0.25),
                { desc = "Scroll the view down" },
              },
              {
                "n",
                "<Tab>",
                actions.select_next_entry,
                { desc = "Open the diff for the next file" },
              },
              {
                "n",
                "<S-tab>",
                actions.select_prev_entry,
                { desc = "Open the diff for the previous file" },
              },
              {
                "n",
                "O",
                actions.goto_file_edit,
                { desc = "Open the file in the previous tabpage" },
              },
              {
                "n",
                "<C-t>",
                actions.goto_file_tab,
                { desc = "Open the file in a new tabpage" },
              },
              {
                "n",
                "i",
                actions.listing_style,
                { desc = 'Toggle between "list" and "tree" views' },
              },
              {
                "n",
                "f",
                actions.toggle_flatten_dirs,
                { desc = "Flatten empty subdirectories in tree listing style" },
              },
              {
                "n",
                "R",
                actions.refresh_files,
                { desc = "Update stats and entries in the file list" },
              },
              {
                "n",
                "<Leader>e",
                actions.focus_files,
                { desc = "Bring focus to the file panel" },
              },
              {
                "n",
                "<Leader>b",
                actions.toggle_files,
                { desc = "Toggle the file panel" },
              },
              {
                "n",
                "g<C-x>",
                actions.cycle_layout,
                { desc = "Cycle available layouts" },
              },
              {
                "n",
                "[x",
                actions.prev_conflict,
                { desc = "Go to the previous conflict" },
              },
              {
                "n",
                "]x",
                actions.next_conflict,
                { desc = "Go to the next conflict" },
              },
              {
                "n",
                "g?",
                actions.help("file_panel"),
                { desc = "Open the help panel" },
              },
              {
                "n",
                "<Leader>cO",
                actions.conflict_choose_all("ours"),
                { desc = "Choose the OURS version of a conflict for the whole file" },
              },
              {
                "n",
                "<Leader>cT",
                actions.conflict_choose_all("theirs"),
                { desc = "Choose the THEIRS version of a conflict for the whole file" },
              },
              {
                "n",
                "<Leader>cB",
                actions.conflict_choose_all("base"),
                { desc = "Choose the BASE version of a conflict for the whole file" },
              },
              {
                "n",
                "<Leader>cA",
                actions.conflict_choose_all("all"),
                { desc = "Choose all the versions of a conflict for the whole file" },
              },
              {
                "n",
                "dX",
                actions.conflict_choose_all("none"),
                { desc = "Delete the conflict region for the whole file" },
              },
              { "n", "q", actions.close, { desc = "Close the panel" } },
              {
                "n",
                "gq",
                function()
                  vim.cmd("DiffviewClose")
                end,
                { desc = "Finish the Diffview" },
              },
            },
            file_history_panel = {
              {
                "n",
                "g!",
                actions.options,
                { desc = "Open the option panel" },
              },
              {
                "n",
                "<C-A-d>",
                actions.open_in_diffview,
                { desc = "Open the entry under the cursor in a diffview" },
              },
              {
                "n",
                "y",
                actions.copy_hash,
                { desc = "Copy the commit hash of the entry under the cursor" },
              },
              { "n", "L", actions.open_commit_log, { desc = "Show commit details" } },
              { "n", "zR", actions.open_all_folds, { desc = "Expand all folds" } },
              { "n", "zM", actions.close_all_folds, { desc = "Collapse all folds" } },
              {
                "n",
                "j",
                actions.next_entry,
                { desc = "Bring the cursor to the next file entry" },
              },
              {
                "n",
                "<Down>",
                actions.next_entry,
                { desc = "Bring the cursor to the next file entry" },
              },
              {
                "n",
                "k",
                actions.prev_entry,
                { desc = "Bring the cursor to the previous file entry." },
              },
              {
                "n",
                "<Up>",
                actions.prev_entry,
                { desc = "Bring the cursor to the previous file entry." },
              },
              {
                "n",
                "<CR>",
                actions.select_entry,
                { desc = "Open the diff for the selected entry." },
              },
              {
                "n",
                "o",
                actions.select_entry,
                { desc = "Open the diff for the selected entry." },
              },
              {
                "n",
                "l",
                actions.select_entry,
                { desc = "Open the diff for the selected entry." },
              },
              {
                "n",
                "h",
                actions.close_fold,
                { desc = "Close the diff for the selected entry." },
              },
              { "n", "<C-b>", actions.scroll_view(-0.25), { desc = "Scroll the view up" } },
              {
                "n",
                "<C-f>",
                actions.scroll_view(0.25),
                { desc = "Scroll the view down" },
              },
              {
                "n",
                "(",
                actions.select_prev_entry,
                { desc = "Open the diff for the previous file" },
              },
              {
                "n",
                ")",
                actions.select_next_entry,
                { desc = "Open the diff for the next file" },
              },
              {
                "n",
                "gf",
                actions.goto_file_edit,
                { desc = "Open the file in the previous tabpage" },
              },
              {
                "n",
                "<C-w><C-f>",
                actions.goto_file_split,
                { desc = "Open the file in a new split" },
              },
              {
                "n",
                "<C-w>gf",
                actions.goto_file_tab,
                { desc = "Open the file in a new tabpage" },
              },
              {
                "n",
                "<Leader>e",
                actions.focus_files,
                { desc = "Bring focus to the file panel" },
              },
              {
                "n",
                "<Leader>b",
                actions.toggle_files,
                { desc = "Toggle the file panel" },
              },
              {
                "n",
                "g<C-x>",
                actions.cycle_layout,
                { desc = "Cycle available layouts" },
              },
              { "n", "g?", actions.help("file_history_panel"), { desc = "Open the help panel" } },
              {
                "n",
                "gq",
                function()
                  vim.cmd("DiffviewClose")
                end,
                { desc = "Finish the Diffview" },
              },
            },
            option_panel = {
              { "n", "<Tab>", actions.select_entry, { desc = "Change the current option" } },
              { "n", "q", actions.close, { desc = "Close the panel" } },
              { "n", "g?", actions.help("option_panel"), { desc = "Open the help panel" } },
            },
            help_panel = {
              { "n", "q", actions.close, { desc = "Close help menu" } },
            },
          },
        })
      end,
    },

    {
      "tyru/open-browser.vim",
      event = "VeryLazy",
    },

    -- =============================================================
    -- Quickfix
    -- =============================================================
    {
      "kevinhwang91/nvim-bqf",
      ft = "qf",
      opts = {
        preview = {
          winblend = 0,
          show_title = false,
          should_preview_cb = function(bufnr, _)
            local ret = true
            local bufname = vim.api.nvim_buf_get_name(bufnr)
            local fsize = vim.fn.getfsize(bufname)
            if fsize > 100 * 1024 then
              -- skip file size greater than 100k
              ret = false
            elseif bufname:match("^fugitive://") then
              -- skip fugitive buffer
              ret = false
            end
            return ret
          end,
        },
      },
    },

    {
      "thinca/vim-qfreplace",
      ft = "qf",
    },

    {
      "itchyny/vim-qfedit",
      ft = "qf",
    },

    -- =============================================================
    -- Coding
    -- =============================================================
    {
      "deton/jasegment.vim",
      event = "VeryLazy",
    },

    {
      "monaqa/dial.nvim",
      keys = {
        {
          "<C-a>",
          function()
            require("dial.map").manipulate("increment", "normal")
          end,
          mode = "n",
        },
        {
          "<C-x>",
          function()
            require("dial.map").manipulate("decrement", "normal")
          end,
          mode = "n",
        },
        {
          "g<C-a>",
          function()
            require("dial.map").manipulate("increment", "gnormal")
          end,
          mode = "n",
        },
        {
          "g<C-x>",
          function()
            require("dial.map").manipulate("decrement", "gnormal")
          end,
          mode = "n",
        },
        {
          "<C-a>",
          function()
            require("dial.map").manipulate("increment", "visual")
          end,
          mode = "v",
        },
        {
          "<C-x>",
          function()
            require("dial.map").manipulate("decrement", "visual")
          end,
          mode = "v",
        },
        {
          "g<C-a>",
          function()
            require("dial.map").manipulate("increment", "gvisual")
          end,
          mode = "v",
        },
        {
          "g<C-x>",
          function()
            require("dial.map").manipulate("decrement", "gvisual")
          end,
          mode = "v",
        },
      },
      config = function()
        local augend = require("dial.augend")
        require("dial.config").augends:register_group({
          default = {
            augend.integer.alias.decimal,
            augend.integer.alias.hex,
            augend.date.alias["%Y/%m/%d"],
            augend.constant.alias.bool,
          },
        })
      end,
    },

    {
      "kazhala/close-buffers.nvim",
      keys = {
        { "<Leader>bda", "<cmd>BDelete! all<CR>", mode = "n", noremap = true, silent = true },
        { "<Leader>bdh", "<cmd>BDelete! hidden<CR>", mode = "n", noremap = true, silent = true },
      },
      opts = {
        filetype_ignore = {},
        file_glob_ignore = {},
        file_regex_ignore = {},
        preserve_window_layout = { "this", "nameless" },
        next_buffer_cmd = nil,
      },
    },

    {
      "echasnovski/mini.ai",
      event = "VeryLazy",
      opts = {
        custom_textobjects = {
          ["j"] = function()
            local ok, val = pcall(vim.fn.getchar)
            if not ok then
              return
            end
            local char = vim.fn.nr2char(val)

            local dict = {
              ["("] = { "（().-()）" },
              ["{"] = { "｛().-()｝" },
              ["["] = { "「().-()」" },
              ["]"] = { "『().-()』" },
              ["<"] = { "＜().-()＞" },
              ['"'] = { "”().-()”" },
            }

            if char == "b" then
              local ret = {}
              for _, v in pairs(dict) do
                table.insert(ret, v)
              end
              return { ret }
            end

            if dict[char] then
              return dict[char]
            end

            error("%s is unsupported textobjects in Japanese")
          end,
        },
      },
    },

    {
      "echasnovski/mini.surround",
      event = "VeryLazy",
      opts = {
        mappings = {
          highlight = "<Nop>",
          update_n_lines = "<Nop>",
        },
        custom_surroundings = {
          ["("] = { output = { left = "(", right = ")" } },
          [")"] = { output = { left = "( ", right = " )" } },
          ["["] = { output = { left = "[", right = "]" } },
          ["]"] = { output = { left = "[ ", right = " ]" } },
          ["{"] = { output = { left = "{", right = "}" } },
          ["}"] = { output = { left = "{ ", right = " }" } },
          ["<"] = { output = { left = "<", right = ">" } },
          [">"] = { output = { left = "< ", right = " >" } },
          ["j"] = {
            input = function()
              local ok, val = pcall(vim.fn.getchar)
              if not ok then
                return
              end
              local char = vim.fn.nr2char(val)

              local dict = {
                ["("] = { "（().-()）" },
                ["{"] = { "｛().-()｝" },
                ["["] = { "「().-()」" },
                ["]"] = { "『().-()』" },
                ["<"] = { "＜().-()＞" },
                ['"'] = { "”().-()”" },
              }

              if char == "b" then
                local ret = {}
                for _, v in pairs(dict) do
                  table.insert(ret, v)
                end
                return { ret }
              end

              if dict[char] then
                return dict[char]
              end

              error("%s is unsupported surroundings in Japanese")
            end,
            output = function()
              local ok, val = pcall(vim.fn.getchar)
              if not ok then
                return
              end
              local char = vim.fn.nr2char(val)

              local dict = {
                ["("] = { left = "（", right = "）" },
                ["{"] = { left = "｛", right = "｝" },
                ["["] = { left = "「", right = "」" },
                ["]"] = { left = "『", right = "』" },
                ["<"] = { left = "＜", right = "＞" },
                ['"'] = { left = "”", right = "”" },
              }

              if not dict[char] then
                error("%s is unsupported surroundings in Japanese")
              end

              return dict[char]
            end,
          },
        },
      },
    },

    {
      "junegunn/vim-easy-align",
      keys = {
        { "ga", "<Plug>(LiveEasyAlign)", mode = { "n", "x" } },
      },
    },

    {
      "andymass/vim-matchup",
      dependencies = {
        "nvim-treesitter/nvim-treesitter",
      },
      init = function()
        vim.g.matchup_matchparen_offscreen = {}
      end,
    },

    {
      "mattn/emmet-vim",
      submodules = false,
      keys = {
        { "<C-e>,", "<Plug>(emmet-expand-abbr)", mode = "i" },
      },
      init = function()
        vim.g.user_emmet_mode = "iv"
        vim.g.user_emmet_leader_key = "<C-e>"
        vim.g.use_emmet_complete_tag = 1
        vim.g.user_emmet_settings = {
          lang = "en",
          html = {
            filters = "html",
            snippets = {
              ["html:5"] = table.concat({
                "<!doctype html>",
                '<html lang="en">',
                "<head>",
                '  <meta charset="${charset}">',
                '  <meta http-equiv="X-UA-Compatible" content="IE=edge">',
                '  <meta name="viewport" content="width=device-width,initial-scale=1.0">',
                '  <meta name="format-detection" content="telephone=no,address=no,email=no">',
                '  <meta name="description" content="">',
                '  <link rel="shortcut icon" href="/favicon.ico">',
                '  <link rel="stylesheet" href="/style.css">',
                "  <title></title>",
                "</head>",
                "<body>",
                "  ${child}|",
                "</body>",
                "</html>",
              }, "\n"),
            },
          },
          css = {
            filters = "fc",
          },
          php = {
            extends = "html",
            filters = "html",
          },
        }
      end,
    },

    {
      "David-Kunz/treesitter-unit",
      keys = {
        { "iu", '<cmd>lua require"treesitter-unit".select()<CR>', mode = "x", noremap = true },
        { "au", '<cmd>lua require"treesitter-unit".select(true)<CR>', mode = "x", noremap = true },
        { "iu", '<cmd><C-u>lua require"treesitter-unit".select()<CR>', mode = "o", noremap = true },
        { "au", '<cmd><C-u>lua require"treesitter-unit".select(true)<CR>', mode = "o", noremap = true },
      },
    },

    {
      "gbprod/substitute.nvim",
      event = "VeryLazy",
      config = function()
        local substitute = require("substitute")

        substitute.setup({
          highlight_substituted_text = {
            enabled = false,
          },
        })

        keymap({ "n" }, "r", substitute.operator)
        keymap({ "n" }, "rr", substitute.line)
        keymap({ "x" }, "r", substitute.visual)
        keymap({ "n", "x" }, "R", "r")
      end,
    },

    {
      "numToStr/Comment.nvim",
      dependencies = {
        "JoosepAlviste/nvim-ts-context-commentstring",
      },
      keys = {
        { "<C-k>", "<Plug>(comment_toggle_linewise_current)", mode = "n", noremap = true, silent = true },
        { "<C-k>", "<Plug>(comment_toggle_linewise_visual)", mode = "v", noremap = true, silent = true },
      },
      opts = {
        mappings = {
          basic = false,
          extra = false,
        },
        pre_hook = function(ctx)
          return require("ts_context_commentstring.integrations.comment_nvim").create_pre_hook()(ctx)
        end,
      },
    },

    {
      "rhysd/clever-f.vim",
      event = "VeryLazy",
      config = function()
        vim.g.clever_f_use_migemo = 1
        vim.g.clever_f_fix_key_direction = 1
      end,
    },

    {
      "smoka7/hop.nvim",
      keys = {
        { "<Leader>f", "<cmd>HopChar1<CR>", mode = { "n", "v" }, noremap = true, silent = true },
        { "<Leader>l", "<cmd>HopLine<CR>", mode = { "n", "v" }, noremap = true, silent = true },
      },
      config = true,
    },

    {
      "haya14busa/vim-asterisk",
      dependencies = {
        { "haya14busa/is.vim" },
      },
      init = function()
        vim.g.asterisk_keeppos = 1
      end,
    },

    {
      "kevinhwang91/nvim-hlslens",
      dependencies = {
        "haya14busa/vim-asterisk",
      },
      keys = {
        {
          "n",
          [[<Cmd>execute('normal! ' . v:count1 . 'n')<CR><Cmd>lua require('hlslens').start()<CR>]],
          mode = "n",
          noremap = true,
          silent = true,
        },
        {
          "N",
          [[<Cmd>execute('normal! ' . v:count1 . 'N')<CR><Cmd>lua require('hlslens').start()<CR>]],
          mode = "n",
          noremap = true,
          silent = true,
        },
        {
          "*",
          [[<Plug>(asterisk-z*)<Cmd>lua require('hlslens').start()<CR>]],
          mode = { "n", "x" },
          noremap = true,
          silent = true,
        },
        {
          "#",
          [[<Plug>(asterisk-z#)<Cmd>lua require('hlslens').start()<CR>]],
          mode = { "n", "x" },
          noremap = true,
          silent = true,
        },
        {
          "g*",
          [[<Plug>(asterisk-gz*)<Cmd>lua require('hlslens').start()<CR>]],
          mode = { "n", "x" },
          noremap = true,
          silent = true,
        },
        {
          "g#",
          [[<Plug>(asterisk-gz#)<Cmd>lua require('hlslens').start()<CR>]],
          mode = { "n", "x" },
          noremap = true,
          silent = true,
        },
      },
      opts = {
        calm_down = true,
        override_lens = function(render, posList, nearest, idx)
          local lnum, col = unpack(posList[idx])
          local text = ("[%d/%d]"):format(idx, #posList)
          local chunks
          if nearest then
            chunks = { { " " }, { text, "HlSearchLensNear" } }
          else
            chunks = { { " " }, { text, "HlSearchLens" } }
          end
          render.setVirt(0, lnum - 1, col - 1, chunks, nearest)
        end,
      },
    },

    {
      "otavioschwanck/arrow.nvim",
      event = "VeryLazy",
      opts = {
        show_icons = true,
        always_show_path = true,
        leader_key = "m",
        buffer_leader_key = "<Nop>",
        mappings = {
          toggle = "m",
          open_horizontal = "s",
          clear_all_items = "c",
        },
        window = {
          border = "rounded",
        },
      },
    },

    {
      "thinca/vim-partedit",
      cmd = {
        "Partedit",
      },
      init = function()
        vim.g["partedit#opener"] = "split"
      end,
    },

    -- =============================================================
    -- Debug
    -- =============================================================
    {
      "thinca/vim-quickrun",
      keys = {
        { "<Leader>q", ":<C-u>QuickRun<CR>", mode = "n", noremap = true, silent = true },
        { "<Leader>q", ":QuickRun<CR>", mode = "v", noremap = true, silent = true },
      },
      init = function()
        vim.g.quickrun_no_default_key_mappings = 1
      end,
    },

    -- =============================================================
    -- WebAssembly
    -- =============================================================
    {
      "rhysd/vim-wasm",
      event = "VeryLazy",
    },

    -- =============================================================
    -- Markdown
    -- =============================================================
    {
      "plasticboy/vim-markdown",
      ft = "markdown",
      init = function()
        vim.g.vim_markdown_no_default_key_mappings = 1
        vim.g.vim_markdown_folding_disabled = 1
      end,
    },

    {
      "rhysd/vim-gfm-syntax",
      ft = "markdown",
    },

    {
      "toppair/peek.nvim",
      event = { "VeryLazy" },
      build = "deno task --quiet build:fast",
      config = function()
        require("peek").setup({
          theme = "light",
        })
        vim.api.nvim_create_user_command("PeekOpen", require("peek").open, {})
        vim.api.nvim_create_user_command("PeekClose", require("peek").close, {})
      end,
    },

    {
      "epwalsh/obsidian.nvim",
      dependencies = {
        "nvim-lua/plenary.nvim",
      },
      ft = "markdown",
      keys = {
        { "<Leader>ot", "<cmd>ObsidianToday<CR>", mode = "n", noremap = true, silent = true },
        { "<Leader>oo", "<cmd>ObsidianQuickSwitch<CR>", mode = "n", noremap = true, silent = true },
        { "<Leader>og", "<cmd>ObsidianSearch<CR>", mode = "n", noremap = true, silent = true },
      },
      opts = {
        workspaces = {
          {
            name = "Main",
            path = "~/Documents/Main",
          },
        },
        mappings = {
          ["<C-]>"] = {
            action = function()
              return require("obsidian").util.gf_passthrough()
            end,
            opts = { noremap = false, expr = true, buffer = true },
          },
          ["<CR>"] = {
            action = function()
              return require("obsidian").util.smart_action()
            end,
            opts = { buffer = true, expr = true },
          },
        },
        ui = {
          enable = false,
        },
        new_notes_location = "00_Inbox",
        daily_notes = {
          folder = "99_Tracking/Daily",
          template = "Templates/Daily_Template.md",
        },
        templates = {
          folder = "Templates",
        },
        open_app_foreground = true,
        disable_frontmatter = true,
        attachments = {
          img_folder = "Extra",
        },
      },
    },
  },
})
