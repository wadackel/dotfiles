-- =============================================================
-- Basic
-- =============================================================

-- debug
vim.api.nvim_create_user_command("Debug", function(args)
  pcall(function()
    vim.cmd("echom " .. args.args .. " : " .. vim.inspect(args.fargs))
  end)
end, { nargs = "*" })

-- python (pyenv)
vim.g.python3_host_prog = "~/.pyenv/versions/py3neovim/bin/python"

-- <Leader>を`,`に設定
vim.g.mapleader = ","

-- 各種基本設定
vim.opt.encoding = "utf-8"
vim.opt.fileencoding = "utf-8"
vim.opt.fileencodings = { "utf-8", "cp932", "iso-2022-jp", "sjis", "euc-jp", "latin1" }
vim.opt.completeopt = { "menu", "menuone", "noselect" }
vim.opt.autoread = true
-- vim.opt.t_ut = ""
vim.opt.termguicolors = true
vim.opt.hlsearch = false
vim.opt.incsearch = true
vim.opt.formatoptions:append("mM")
vim.opt.display:append("lastline")
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.wrapscan = true
vim.opt.showmatch = true
vim.opt.showmode = true
vim.opt.title = true
vim.opt.ruler = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.signcolumn = "yes"
vim.opt.autoindent = true
vim.opt.smartindent = true
vim.opt.expandtab = true
vim.opt.wrap = true
vim.opt.laststatus = 2
if vim.fn.has("mac") == 1 then
  vim.opt.clipboard = "unnamed"
elseif vim.fn.has("unix") == 1 then
  vim.opt.clipboard = "unnamedplus"
end
vim.opt.wildmenu = true
vim.opt.wildmode = { "longest", "full" }
vim.opt.showmode = false
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
vim.keymap.set("n", "\\", ",", { noremap = true })
vim.keymap.set("v", "\\", ",", { noremap = true })

-- <C-c> の動作を <Esc> に合わせる
vim.keymap.set("i", "<C-c>", "<Esc>", { noremap = true })

-- increment, decrement で選択状態を維持
vim.keymap.set("v", "<C-a>", "<C-a>gv", { noremap = true })
vim.keymap.set("v", "<C-x>", "<C-x>gv", { noremap = true })

-- j, k による移動を折り返されたテキストでも自然に振る舞うように変更
vim.keymap.set("n", "j", "gj", { noremap = true })
vim.keymap.set("v", "j", "gj", { noremap = true })
vim.keymap.set("n", "k", "gk", { noremap = true })
vim.keymap.set("v", "k", "gk", { noremap = true })

-- x でレジスタを使わずに切り取り
vim.keymap.set("n", "x", '"_x', { noremap = true })

-- マーク使わないので無効化
vim.keymap.set("n", "m", "<Nop>", { noremap = true })

-- 行頭, 文末の移動
vim.keymap.set("n", "M", "g^", { noremap = true })
vim.keymap.set("v", "M", "g^", { noremap = true })
vim.keymap.set("n", "H", "g0", { noremap = true })
vim.keymap.set("v", "H", "g0", { noremap = true })
vim.keymap.set("n", "L", "g$", { noremap = true })
vim.keymap.set("v", "L", "g$", { noremap = true })
vim.keymap.set("n", "mH", "0", { noremap = true })
vim.keymap.set("v", "mH", "0", { noremap = true })
vim.keymap.set("n", "mL", "$", { noremap = true })
vim.keymap.set("v", "mL", "$", { noremap = true })

-- スクリーン内での移動
vim.keymap.set("n", "gh", "H", { noremap = true })
vim.keymap.set("n", "gm", "M", { noremap = true })
vim.keymap.set("n", "gl", "L", { noremap = true })
vim.keymap.set("v", "gh", "H", { noremap = true })
vim.keymap.set("v", "gm", "M", { noremap = true })
vim.keymap.set("v", "gl", "L", { noremap = true })

-- 検索後の位置調整
vim.keymap.set("n", "n", "nzz", { noremap = true })
vim.keymap.set("n", "N", "Nzz", { noremap = true })
vim.keymap.set("n", "*", "*zz", { noremap = true })
vim.keymap.set("n", "#", "#zz", { noremap = true })
vim.keymap.set("n", "g*", "g*zz", { noremap = true })
vim.keymap.set("n", "g#", "g#zz", { noremap = true })

-- command モードは Emacs 風に
vim.keymap.set("c", "<C-f>", "<Right>", { noremap = true })
vim.keymap.set("c", "<C-b>", "<Left>", { noremap = true })
vim.keymap.set("c", "<C-a>", "<Home>", { noremap = true })
vim.keymap.set("c", "<C-e>", "<End>", { noremap = true })
vim.keymap.set("c", "<C-d>", "<Del>", { noremap = true })
vim.keymap.set("c", "<C-h>", "<BackSpace>", { noremap = true })

-- QuickFix の移動
vim.keymap.set("n", "[q", ":cprevious<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "]q", ":cnext<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "[Q", ":<C-u>cfirst<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "]Q", ":<C-u>clast<CR>", { noremap = true, silent = true })

-- locationlist の移動
vim.keymap.set("n", "[w", ":lprevious<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "]w", ":lnext<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "[W", ":<C-u>lfirst<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "]W", ":<C-u>llast<CR>", { noremap = true, silent = true })

-- argument list の移動
vim.keymap.set("n", "[a", ":previous<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "]a", ":next<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "[A", ":<C-u>first<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "]A", ":<C-u>last<CR>", { noremap = true, silent = true })

-- ; と :
vim.keymap.set("n", ";", ":", { noremap = true })
vim.keymap.set("v", ";", ":", { noremap = true })
vim.keymap.set("n", ":", ";", { noremap = true })
vim.keymap.set("v", ":", ";", { noremap = true })
vim.keymap.set("n", "@;", "@:", { noremap = true })
vim.keymap.set("v", "@;", "@:", { noremap = true })
vim.keymap.set("n", "@:", "@;", { noremap = true })
vim.keymap.set("v", "@:", "@;", { noremap = true })

-- Toggle系オプション
vim.api.nvim_set_keymap("n", "\\w", ":<C-u>setl wrap! wrap?<CR>", { noremap = true, silent = true })

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

vim.api.nvim_set_keymap("n", "\\s", "", { noremap = true, silent = true, callback = toggle_syntax })
vim.api.nvim_set_keymap("n", "\\n", "", { noremap = true, silent = true, callback = toggle_number })
vim.api.nvim_set_keymap("n", "\\m", "", { noremap = true, silent = true, callback = toggle_mouse })
vim.api.nvim_set_keymap("n", "\\h", ":<C-u>setl hlsearch!<CR>", { noremap = true, silent = true })

-- 選択範囲内をExpressionレジスタで評価 -> 置換
vim.keymap.set("v", "Q", "y:g/^.*$//e", { noremap = true })

-- 指定データをクリップボードにつながるレジスタへ保存
local function clip(data)
  local root = vim.fn.getcwd() .. "/"
  local d = data:gsub("^" .. root, "")
  vim.fn.setreg("*", d)
  print("[clipped] " .. d)
end

vim.api.nvim_create_user_command("ClipPath", function()
  clip(vim.fn.expand("%:p"))
end, {})

vim.api.nvim_create_user_command("ClipFile", function()
  clip(vim.fn.expand("%:t"))
end, {})

vim.api.nvim_create_user_command("ClipDir", function()
  clip(vim.fn.expand("%:p:h"))
end, {})

vim.keymap.set("n", "<Leader>cp", ":ClipPath<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "<Leader>cf", ":ClipFile<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "<Leader>cd", ":ClipDir<CR>", { noremap = true, silent = true })

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

-- incsearch
vim.api.nvim_create_augroup("vimrc-incsearch-highlight", {})
vim.api.nvim_create_autocmd({ "CmdlineEnter" }, {
  group = "vimrc-incsearch-highlight",
  pattern = { "/", "?" },
  command = "set hlsearch",
})
vim.api.nvim_create_autocmd({ "CmdlineLeave" }, {
  group = "vimrc-incsearch-highlight",
  pattern = { "/", "?" },
  command = "set nohlsearch",
})

-- タブの操作、移動
vim.opt.showtabline = 2 -- 常にタブラインを表示

vim.api.nvim_create_augroup("tabline", {})

vim.keymap.set("n", "[Tag]", "<Nop>", { noremap = true })
vim.keymap.set("n", "t", "[Tag]", { noremap = true })

-- 画面分割用のキーマップ
vim.keymap.set("n", "s", "<Nop>", { noremap = true })
vim.keymap.set("n", "sj", "<C-w>j", { noremap = true })
vim.keymap.set("n", "sk", "<C-w>k", { noremap = true })
vim.keymap.set("n", "sl", "<C-w>l", { noremap = true })
vim.keymap.set("n", "sh", "<C-w>h", { noremap = true })
vim.keymap.set("n", "sN", ":<C-u>bn<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "sP", ":<C-u>bp<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "sn", "gt", { noremap = true })
vim.keymap.set("n", "sp", "gT", { noremap = true })
vim.keymap.set("n", "sw", "<C-w>w", { noremap = true })
vim.keymap.set("n", "st", ":<C-u>tabnew<CR>", { noremap = true, silent = true })

-- quickfix/locationlist の open/close
vim.keymap.set("n", "<Space>co", ":copen<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "<Space>cc", ":cclose<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "<Space>lo", ":lopen<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "<Space>lc", ":lclose<CR>", { noremap = true, silent = true })

-- 現在のタブページ以外全て閉じる
vim.keymap.set("n", "<C-w>O", ":<C-u>tabo<CR>", { noremap = true, silent = true })

-- Switches to tab with specific number.
for i = 1, 9 do
  vim.keymap.set("n", "<Leader>" .. i, i .. "gt", { noremap = true, silent = true })
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

vim.keymap.set("t", "<C-[>", "<C-\\><C-n>", { noremap = true, silent = true })
vim.keymap.set("t", "<Esc>", "<C-\\><C-n>", { noremap = true, silent = true })

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
if vim.fn.executable("rg") == 1 then
  vim.opt.grepprg = "rg --vimgrep --no-heading --hidden -g !.git"
  vim.opt.grepformat = { "%f:%l:%c:%m", "%f:%l:%m" }
end

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
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile", "BufNewFile" }, {
  group = "fileTypeDetect",
  pattern = ".eslintrc",
  command = "setlocal ft=json",
})
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile", "BufNewFile" }, {
  group = "fileTypeDetect",
  pattern = ".stylelintrc",
  command = "setlocal ft=json",
})
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile", "BufNewFile" }, {
  group = "fileTypeDetect",
  pattern = ".prettierrc",
  command = "setlocal ft=json",
})
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile", "BufNewFile" }, {
  group = "fileTypeDetect",
  pattern = ".babelrc",
  command = "setlocal ft=json",
})
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile", "BufNewFile" }, {
  group = "fileTypeDetect",
  pattern = ".textlintrc",
  command = "setlocal ft=json",
})

-- =============================================================
-- Plugins
-- =============================================================

local function lsp_on_attach(client, bufnr)
  local function set_opt(...)
    vim.api.nvim_buf_set_option(bufnr, ...)
  end

  local function set_keymap(...)
    vim.api.nvim_buf_set_keymap(bufnr, ...)
  end

  -- Disable LSP Semantic tokens
  client.server_capabilities.semanticTokensProvider = nil

  -- Enable completion triggered by <C-x><C-o>
  set_opt("omnifunc", "v:lua.vim.lsp.omnifunc")

  -- Mappings
  local opts = { noremap = true, silent = true }
  set_keymap("n", "<C-]>", "<cmd>lua vim.lsp.buf.definition()<CR>", opts)
  set_keymap("n", "<C-w><C-]>", "<cmd>split<CR><cmd>lua vim.lsp.buf.definition()<CR>", opts)
  set_keymap("n", "K", "<cmd>lua vim.lsp.buf.type_definition()<CR>", opts)
  set_keymap("n", "<Leader>i", "<cmd>lua vim.lsp.buf.hover()<CR>", opts)
  set_keymap("n", "<C-^>", "<cmd>lua vim.lsp.buf.references()<CR>", opts)
  set_keymap("n", "<Leader>r", "<cmd>lua vim.lsp.buf.rename()<CR>", opts)
  set_keymap("n", "<Leader>a", "<cmd>lua vim.lsp.buf.code_action()<CR>", opts)
  set_keymap("n", "<space>wa", "<cmd>lua vim.lsp.buf.add_workspace_folder()<CR>", opts)
  set_keymap("n", "<space>wr", "<cmd>lua vim.lsp.buf.remove_workspace_folder()<CR>", opts)
  set_keymap("n", "<space>wl", "<cmd>lua print(vim.inspect(vim.lsp.buf.list_workspace_folders()))<CR>", opts)
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
  install = {
    colorscheme = {
      "habamax",
      -- "dogrun",
    },
  },

  checker = {
    -- enabled = true,
  },

  ui = {
    border = "rounded",
    backdrop = 100,
  },

  dev = {
    path = "~/develop/github.com",
    -- fallback = true,
  },

  performance = {
    rtp = {
      reset = true,
      disabled_plugins = {
        "gzip",
        "matchit",
        "matchparen",
        "netrwPlugin",
        "tarPlugin",
        "tohtml",
        "tutor",
        "zipPlugin",
      },
    },
  },

  spec = {
    -- =============================================================
    -- Colorscheme
    -- =============================================================
    {
      -- TODO: dev mode is not working...
      -- "wadackel/vim-dogrun",
      -- dev = true,
      "wadackel/vim-dogrun",
      dir = vim.fn.isdirectory(vim.fn.expand("$HOME") .. "/develop/github.com/wadackel/vim-dogrun") == 1
          and "~/develop/github.com/wadackel/vim-dogrun"
        or nil,
      dev = true,
      config = function()
        vim.cmd("colorscheme dogrun")
        vim.cmd("highlight Normal guibg=NONE")
      end,
    },

    -- =============================================================
    -- LSP x Completion
    -- =============================================================
    {
      "WhoIsSethDaniel/mason-tool-installer.nvim",
      event = "VeryLazy",
      dependencies = {
        { "williamboman/mason.nvim" },
      },
      opts = {
        ensure_installed = {
          -- LSP
          "astro",
          "denols",
          "pyright",
          "rust_analyzer",
          "terraformls",
          "tsserver",
          "lua_ls",
          "vimls",
          "gopls",

          -- Linter
          "actionlint",
          "eslint_d",
          "stylelint",
          "textlint",

          -- Formatter
          "prettierd",
          "gofumpt",
          "goimports",
          "stylua",
        },
      },
    },

    {
      "neovim/nvim-lspconfig",
      -- event = "VeryLazy",
      dependencies = {
        { "williamboman/mason.nvim" },
        { "williamboman/mason-lspconfig.nvim" },
        { "hrsh7th/cmp-nvim-lsp" },
        { "jose-elias-alvarez/typescript.nvim" },
        { "mrcjkb/rustaceanvim" },
      },
      config = function()
        require("mason").setup()

        local lspconfig = require("lspconfig")

        -- Base
        local signs = {
          { name = "DiagnosticSignError", text = "•" },
          { name = "DiagnosticSignWarn", text = "•" },
          { name = "DiagnosticSignHint", text = "•" },
          { name = "DiagnosticSignInfo", text = "•" },
        }

        for _, sign in ipairs(signs) do
          vim.fn.sign_define(sign.name, { texthl = sign.name, text = sign.text, numhl = "" })
        end

        vim.diagnostic.config({
          float = { border = "rounded" },
        })

        vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, { border = "rounded" })

        vim.lsp.handlers["textDocument/publishDiagnostics"] = vim.lsp.with(vim.lsp.diagnostic.on_publish_diagnostics, {
          virtual_text = {
            prefix = "",
            spacing = 0,
          },
          signs = {
            active = signs,
          },
        })

        -- Mappings
        local opts = { noremap = true, silent = true }
        vim.api.nvim_set_keymap("n", "<Leader>ee", "<cmd>lua vim.diagnostic.open_float()<CR>", opts)
        vim.api.nvim_set_keymap("n", "[g", "<cmd>lua vim.diagnostic.goto_prev()<CR>", opts)
        vim.api.nvim_set_keymap("n", "]g", "<cmd>lua vim.diagnostic.goto_next()<CR>", opts)
        vim.api.nvim_set_keymap("n", "<Space>q", "<cmd>lua vim.diagnostic.setloclist()<CR>", opts)

        -- Setup servers
        local capabilities = require("cmp_nvim_lsp").default_capabilities()

        require("mason-lspconfig").setup({
          handlers = {
            function(name)
              local node_root_dir = lspconfig.util.root_pattern("package.json")
              local is_node_repo = node_root_dir(vim.fn.getcwd()) ~= nil

              local options = {
                capabilities = capabilities,
                on_attach = lsp_on_attach,
              }

              -- Delegate to 'typescript' module
              if name == "tsserver" then
                if not is_node_repo then
                  return
                end
                require("typescript").setup({
                  debug = false,
                  disable_commands = false,
                  go_to_source_definition = {
                    fallback = true,
                  },
                  server = {
                    on_attach = function(client, bufnr)
                      lsp_on_attach(client, bufnr)
                      vim.api.nvim_buf_set_keymap(
                        bufnr,
                        "n",
                        "<space>o",
                        ":TypescriptOrganizeImportsFixed<CR>",
                        { noremap = true, silent = true }
                      )
                    end,
                    root_dir = node_root_dir,
                    init_options = {
                      maxTsServerMemory = 8192,
                    },
                    -- https://github.com/jose-elias-alvarez/typescript.nvim/issues/24#issuecomment-1428801350
                    commands = {
                      TypescriptOrganizeImportsFixed = {
                        function()
                          local params = {
                            command = "_typescript.organizeImports",
                            arguments = { vim.api.nvim_buf_get_name(0) },
                            title = "",
                          }
                          vim.lsp.buf.execute_command(params)
                        end,
                        description = "Organize Imports",
                      },
                    },
                  },
                })
                return
              end

              if name == "denols" then
                if is_node_repo then
                  return
                end
                options.root_dir = lspconfig.util.root_pattern("deno.json", "deno.jsonc", "import_map.json")
                options.init_options = {
                  lint = true,
                  unstable = true,
                  suggest = {
                    imports = {
                      hosts = {
                        ["https://deno.land"] = true,
                        ["https://cdn.nest.land"] = true,
                        ["https://crux.land"] = true,
                      },
                    },
                  },
                }
              end

              if name == "rust_analyzer" then
                -- Use rustaceanvim
                return
              end

              if name == "lua_ls" then
                options.settings = {
                  Lua = {
                    diagnostics = {
                      globals = { "vim" },
                    },
                  },
                }
              end

              lspconfig[name].setup(options)
            end,
          },
        })

        -- rustaceanvim
        vim.g.rustaceanvim = {
          tools = {
            float_win_config = {
              border = "rounded",
            },
          },
          server = {
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
      "akinsho/flutter-tools.nvim",
      dependencies = {
        "nvim-lua/plenary.nvim",
        "stevearc/dressing.nvim",
        "hrsh7th/cmp-nvim-lsp",
      },
      ft = { "dart" },
      config = function()
        require("flutter-tools").setup({
          flutter_path = nil,
          flutter_lookup_cmd = "asdf where flutter",
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
          lsp = {
            on_attach = function(client, bufnr)
              lsp_on_attach(client, bufnr)
            end,
            capabilities = function()
              require("cmp_nvim_lsp").default_capabilities()
            end,
          },
        })
      end,
    },

    {
      "hrsh7th/nvim-cmp",
      dependencies = {
        "hrsh7th/cmp-nvim-lsp",
        "hrsh7th/cmp-nvim-lsp-signature-help",
        "hrsh7th/cmp-buffer",
        "hrsh7th/cmp-path",
        "hrsh7th/cmp-cmdline",
        "hrsh7th/cmp-vsnip",
        "hrsh7th/vim-vsnip",
        "onsails/lspkind-nvim",
      },
      event = "VeryLazy",
      config = function()
        local cmp = require("cmp")

        cmp.setup({
          window = {
            completion = cmp.config.window.bordered({
              winhighlight = "Normal:Normal,FloatBorder:Comment,CursorLine:Visual,Search:None",
            }),
            documentation = cmp.config.window.bordered({
              winhighlight = "Normal:Normal,FloatBorder:Comment,CursorLine:Visual,Search:None",
            }),
          },
          snippet = {
            expand = function(args)
              vim.fn["vsnip#anonymous"](args.body)
            end,
          },
          mapping = cmp.mapping.preset.insert({
            ["<C-b>"] = cmp.mapping.scroll_docs(-4),
            ["<C-f>"] = cmp.mapping.scroll_docs(4),
            ["<C-Space>"] = cmp.mapping.complete(),
            ["<C-e>"] = cmp.mapping.abort(),
            ["<C-y>"] = cmp.mapping.confirm({ select = true }),
            ["<C-l>"] = cmp.mapping.confirm({ select = true }),
          }),
          sources = cmp.config.sources({
            { name = "nvim_lsp" },
            { name = "nvim_lsp_signature_help" },
            { name = "path" },
            { name = "vsnip" },
            { name = "buffer" },
          }),
        })

        -- Set configuration for specific filetype.
        cmp.setup.filetype("gitcommit", {
          sources = cmp.config.sources({
            { name = "cmp_git" },
          }, {
            { name = "buffer" },
          }),
        })

        -- Icons
        local lspkind = require("lspkind")
        cmp.setup({
          formatting = {
            format = lspkind.cmp_format({
              mode = "symbol_text",
              maxwidth = 50,
            }),
          },
        })
      end,
    },

    {
      "j-hui/fidget.nvim",
      event = "VeryLazy",
      opts = {
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
      event = "VeryLazy",
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

    {
      "mfussenegger/nvim-lint",
      event = "VeryLazy",
      config = function()
        local lint = require("lint")

        local eslint_d = lint.linters.eslint_d
        lint.linters.eslint_d = {
          cmd = eslint_d.cmd,
          args = eslint_d.args,
          stdin = eslint_d.stdin,
          stream = eslint_d.stream,
          ignore_exitcode = eslint_d.ignore_exitcode,
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
        }

        lint.linters_by_ft = {
          -- TODO: Support Deno
          javascript = { "eslint_d" },
          typescript = { "eslint_d" },
          javascriptreact = { "eslint_d" },
          typescriptreact = { "eslint_d" },
          css = { "stylelint" },
          yaml = { "actionlint" },
          terraform = { "tflint" },
        }

        vim.api.nvim_create_autocmd({ "BufReadPost", "BufWritePost", "InsertLeave", "TextChanged" }, {
          callback = function()
            lint.try_lint()
          end,
        })
      end,
    },

    {
      "stevearc/conform.nvim",
      event = "VeryLazy",
      dependencies = {
        "nvim-lua/plenary.nvim",
      },
      config = function()
        local prettier_formatter = { "prettierd" }
        local js_formatter = {
          { "eslint_d" },
          prettier_formatter,
        }

        local conform = require("conform")
        local Job = require("plenary.job")

        local eslint_d = conform.get_formatter_info("eslint_d")

        conform.setup({
          -- notify_on_error = false,
          formatters = {
            eslint_d = {
              condition = function()
                -- Suppress "No ESLint found" error
                local bufnr = vim.api.nvim_get_current_buf()
                local filename = vim.api.nvim_buf_get_name(bufnr)
                local result = Job:new({
                  command = eslint_d.command,
                  args = {
                    "--print-config",
                    filename,
                  },
                  cwd = eslint_d.cwd,
                }):sync()
                if result[1] ~= nil then
                  local msg = result[1]
                  if string.match(msg, "No ESLint found") then
                    return false
                  end
                  if string.match(msg, "Could not find config file") then
                    return false
                  end
                end
                return true
              end,
              inherit = true,
            },
          },
          formatters_by_ft = {
            javascript = js_formatter,
            javascriptreact = js_formatter,
            typescript = js_formatter,
            typescriptreact = js_formatter,
            css = {
              { "stylelint" },
              prettier_formatter,
            },
            json = prettier_formatter,
            markdown = prettier_formatter,
            html = prettier_formatter,
            rust = { "rustfmt" },
            go = { "gofumpt", "goimports" },
            terraform = { "terraform_fmt" },
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

        vim.keymap.set("n", "<Leader>p", function()
          conform.format({
            async = true,
          })
        end, { noremap = true, silent = true })
      end,
    },

    {
      "github/copilot.vim",
      event = "VeryLazy",
    },

    -- =============================================================
    -- Syntax Extention
    -- =============================================================
    {
      "nvim-treesitter/playground",
      event = "VeryLazy",
      keys = {
        { "<Space>si", "<cmd>TSHighlightCapturesUnderCursor<CR>", mode = "n", noremap = true, silent = true },
      },
    },

    {
      "nvim-treesitter/nvim-treesitter",
      dependencies = {
        "nvim-treesitter/playground",
        "yioneko/nvim-yati",
      },
      build = ":TSUpdate",
      config = function()
        local configs = require("nvim-treesitter.configs")

        configs.setup({
          ensure_installed = {
            "astro",
            "awk",
            "bash",
            "c",
            "c_sharp",
            "clojure",
            "cmake",
            "comment",
            "commonlisp",
            "cpp",
            "css",
            "cue",
            "dart",
            "devicetree",
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
            "glsl",
            "go",
            "godot_resource",
            "gomod",
            "gosum",
            "gowork",
            "graphql",
            "hack",
            "haskell",
            "hjson",
            "hlsl",
            "html",
            "htmldjango",
            "http",
            "ini",
            "java",
            "javascript",
            "jq",
            "jsdoc",
            "json",
            "json5",
            "jsonc",
            "jsonnet",
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
            "matlab",
            "mermaid",
            "ninja",
            "nix",
            "ocaml",
            "ocaml_interface",
            "ocamllex",
            "org",
            "pascal",
            "passwd",
            "perl",
            "php",
            "phpdoc",
            "prisma",
            "proto",
            "prql",
            "pug",
            "python",
            "ql",
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
            "twig",
            "typescript",
            "ungrammar",
            "verilog",
            "vhs",
            "vim",
            "vimdoc",
            "vue",
            "yaml",
            "zig",
          },
          highlight = {
            enable = true,
            additional_vim_regex_highlighting = false,
          },
          yati = {
            enable = true,
          },
          indent = {
            enable = false, -- disable builtin indent module (use yati's indent)
          },
          playground = {
            enable = true,
            disable = {},
            updatetime = 25, -- Debounced time for highlighting nodes in the playground from source code
            persist_queries = false, -- Whether the query persists across vim sessions
            keybindings = {
              toggle_query_editor = "o",
              toggle_hl_groups = "i",
              toggle_injected_languages = "t",
              toggle_anonymous_nodes = "a",
              toggle_language_display = "I",
              focus_language = "f",
              unfocus_language = "F",
              update = "R",
              goto_node = "<cr>",
              show_help = "?",
            },
          },
        })
      end,
    },

    {
      "Wansmer/treesj",
      event = "VeryLazy",
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
      opts = {
        map_c_h = true,
        map_c_w = true,
      },
    },

    -- =============================================================
    -- Filer
    -- =============================================================
    {
      "nvim-tree/nvim-tree.lua",
      event = "VeryLazy",
      dependencies = {
        "nvim-tree/nvim-web-devicons",
        "antosha417/nvim-lsp-file-operations",
        "akinsho/toggleterm.nvim",
        "kwkarlwang/bufresize.nvim",
      },
      keys = {
        { "<C-j>", "<cmd>NvimTreeToggle<CR>", mode = "n", noremap = true, silent = true },
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
        filters = {
          -- dotfiles = false,
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

          -- open as vsplit on current node
          local function vsplit_preview()
            local node = api.tree.get_node_under_cursor()

            if node.nodes ~= nil then
              -- expand or collapse folder
              api.node.open.edit()
            else
              -- open file as vsplit
              api.node.open.vertical()
              -- FIXME use preview
            end

            -- Finally refocus on tree if it was lost
            api.tree.focus()
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

          vim.keymap.set("n", "q", api.tree.close, opts("Close"))
          vim.keymap.set("n", ".", api.tree.toggle_gitignore_filter, opts("Toggle Gitignore"))
          vim.keymap.set("n", "h", api.node.navigate.parent_close, opts("Parent"))
          vim.keymap.set("n", "H", api.tree.change_root_to_parent, opts("Change Root To Parent"))
          vim.keymap.set("n", "l", api.node.open.edit, opts("Edit Or Open"))
          vim.keymap.set("n", "L", api.tree.change_root_to_node, opts("Change Root To Current Node"))
          vim.keymap.set("n", "o", api.node.open.edit, opts("Edit Or Open"))
          vim.keymap.set("n", "<CR>", api.node.open.edit, opts("Edit Or Open"))
          vim.keymap.set("n", "<C-]>", api.tree.change_root_to_node, opts("CD"))
          vim.keymap.set("n", "<C-t>", api.tree.change_root_to_parent, opts("Change Root To Parent"))
          vim.keymap.set("n", "<C-h>", api.tree.change_root_to_parent, opts("Change Root To Parent"))
          vim.keymap.set("n", "t", api.node.open.tab, opts("Open: New Tab"))
          vim.keymap.set("n", "O", api.node.open.vertical, opts("Open: Vertical Split"))
          vim.keymap.set("n", "<Tab>", vsplit_preview, opts("Preview: Vertical Split"))
          vim.keymap.set("n", "<C-c>", change_root_to_global_cwd, opts("Change Root To Global CWD"))
          vim.keymap.set("n", "E", api.tree.expand_all, opts("Expand All"))
          vim.keymap.set("n", "W", api.tree.collapse_all, opts("Collapse All"))
          vim.keymap.set("n", "-", api.tree.change_root_to_parent, opts("Up"))
          vim.keymap.set("n", ")", api.node.navigate.sibling.next, opts("Next Sibling"))
          vim.keymap.set("n", "(", api.node.navigate.sibling.prev, opts("Previous Sibling"))
          vim.keymap.set("n", "]c", api.node.navigate.git.next, opts("Next Git"))
          vim.keymap.set("n", "[c", api.node.navigate.git.prev, opts("Previous Git"))
          vim.keymap.set("n", "N", api.fs.create, opts("Create New File"))
          vim.keymap.set("n", "c", mark_copy, opts("Copy File"))
          vim.keymap.set("n", "C", mark_cut, opts("Cut File"))
          vim.keymap.set("n", "p", api.fs.paste, opts("Copy File"))
          vim.keymap.set("n", "d", mark_remove, opts("Delete File"))
          vim.keymap.set("n", "m", api.marks.bulk.move, opts("Move Marked"))
          vim.keymap.set("n", "r", mark_rename, opts("Rename File"))
          vim.keymap.set("n", "x", api.node.run.system, opts("Run System"))
          vim.keymap.set("n", "y", api.fs.copy.filename, opts("Copy Name"))
          vim.keymap.set("n", "Y", api.fs.copy.relative_path, opts("Copy Relative Path"))
          vim.keymap.set("n", "<Space>", mark_move_j, opts("Toggle Mark"))
          vim.keymap.set("n", "<C-[>", api.marks.clear, opts("Clear Marks"))
          vim.keymap.set("n", "i", api.node.show_info_popup, opts("Show Info Node"))
          vim.keymap.set("n", "f", api.live_filter.start, opts("Filter"))
          vim.keymap.set("n", "F", api.live_filter.start, opts("Clean Filter"))
          vim.keymap.set("n", "?", api.tree.toggle_help, opts("Help"))
        end,
      },
      config = function(_, opts)
        require("nvim-tree").setup(opts)

        NvimTreeToggle = function()
          local api = require("nvim-tree.api")
          local view = require("nvim-tree.view")
          local bufresize = require("bufresize")

          bufresize.block_register()

          if view.is_visible() then
            api.tree.close()
            bufresize.resize_close()
          else
            api.tree.open({ update_root = true, find_file = true })
            bufresize.resize_open()
          end
        end

        vim.keymap.set("n", "<C-j>", ":lua NvimTreeToggle()<CR>", { noremap = true, silent = true })
      end,
    },

    {
      "antosha417/nvim-lsp-file-operations",
      event = "VeryLazy",
      dependencies = {
        "nvim-lua/plenary.nvim",
        "nvim-tree/nvim-tree.lua",
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
      "nvim-telescope/telescope.nvim",
      dependencies = {
        "nvim-lua/plenary.nvim",
        { "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
        "nvim-telescope/telescope-github.nvim",
      },
      keys = {
        { "<C-p>", "<cmd>Telescope find_files<CR>", mode = "n", noremap = true },
        { "<Leader>gg", "<cmd>Telescope live_grep<CR>", mode = "n", noremap = true },
        { "<Leader>bb", "<cmd>Telescope buffers<CR>", mode = "n", noremap = true },
        { "<Leader>cc", "<cmd>Telescope commands<CR>", mode = "n", noremap = true },
        { "<Leader>cl", "<cmd>Telescope command_history<CR>", mode = "n", noremap = true },
        { "<Leader>gb", "<cmd>Telescope git_branches<CR>", mode = "n", noremap = true },
        { "<Leader>gl", "<cmd>Telescope git_commits<CR>", mode = "n", noremap = true },
        { "<Leader>gc", "<cmd>Telescope git_bcommits<CR>", mode = "n", noremap = true },
        { "<Leader>gp", "<cmd>Telescope gh pull_request<CR>", mode = "n", noremap = true },
        { "<Leader>hl", "<cmd>Telescope highlights<CR>", mode = "n", noremap = true },
        { "<Leader>el", "<cmd>Telescope diagnostics<CR>", mode = "n", noremap = true },
      },
      config = function()
        local telescope = require("telescope")
        local action = require("telescope.actions")
        local action_state = require("telescope.actions.state")
        local action_layout = require("telescope.actions.layout")

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
          },
        })

        telescope.load_extension("fzf")
        telescope.load_extension("gh")
      end,
    },

    -- =============================================================
    -- Layout
    -- =============================================================
    {
      "kwkarlwang/bufresize.nvim",
      dependencies = {
        { "kana/vim-submode" },
      },
      lazy = true,
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

        local function map(submode, mode, lhs, rhs)
          vim.fn["submode#map"](submode, mode, "", lhs, rhs .. '<cmd>lua require("bufresize").register()<CR>')
        end

        enter("winsize", "n", "s>", "4<C-w>>")
        map("winsize", "n", ">", "4<C-w>>")

        enter("winsize", "n", "s<", "4<C-w><")
        map("winsize", "n", "<", "4<C-w><")

        enter("winsize", "n", "s+", "4<C-w>+")
        map("winsize", "n", "+", "4<C-w>+")

        enter("winsize", "n", "s-", "4<C-w>-")
        map("winsize", "n", "-", "4<C-w>-")
      end,
    },

    -- =============================================================
    -- Terminal
    -- =============================================================
    {
      "akinsho/toggleterm.nvim",
      dependencies = {
        "kwkarlwang/bufresize.nvim",
      },
      event = "VeryLazy",
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
          start_in_insert = false,
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

        local keymap = vim.api.nvim_set_keymap
        local opts = { noremap = true, silent = true }

        keymap("n", "<Leader>tt", ':lua ToggleTerm("float")<CR>', opts)
        keymap("n", "<Leader>ts", [[:lua ToggleTerm("horizontal")<CR>]], opts)
        keymap("n", "<Leader>tv", [[:lua ToggleTerm("vertical")<CR>]], opts)
        keymap(
          "t",
          "<C-q>",
          "<C-\\><C-n>"
            .. ':lua require("bufresize").block_register()<CR>'
            .. "<C-w>c"
            .. ':lua require("bufresize").resize_close()<CR>',
          opts
        )

        vim.keymap.set("n", "<Leader>tl", ":TermSelect<CR>", { noremap = true, silent = true })
      end,
    },

    -- =============================================================
    -- Statusline
    -- =============================================================
    {
      "nvim-lualine/lualine.nvim",
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

        local bubbles_theme = {
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
            theme = bubbles_theme,
            component_separators = " ",
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
                "filetype",
                icon_only = true,
                padding = {
                  left = 1,
                  right = 0,
                },
                colored = false,
              },
              {
                "filename",
                padding = 0,
                path = 1,
                show_modified_status = true,
                symbols = {
                  modified = "∙",
                  readonly = "",
                  unnamed = "[No Name]",
                  newfile = "∙",
                },
              },
              {
                "diagnostics",
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
                padding = 0,
                colored = false,
              },
              "encoding",
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
            lualine_z = { "location" },
          },
          tabline = {
            lualine_a = {},
            lualine_b = {},
            lualine_c = {
              {
                "tabs",
                mode = 2,
                max_length = function()
                  return vim.o.columns
                end,
                separator = { right = "" },
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

    -- =============================================================
    -- Git
    -- =============================================================
    {
      "tpope/vim-fugitive",
      event = "VeryLazy",
      keys = {
        { "<Leader>gs", "<cmd>Git<CR>", mode = "n", noremap = true, silent = true },
        { "<Leader>gd", "<cmd>Gvdiffsplit<CR>", mode = "n", noremap = true, silent = true },
      },
      config = function()
        local function OpenFugitiveOpenPullRequest()
          local line = vim.fn.getline(".")
          local pos = string.find(line, " ")
          local hash = string.sub(line, 1, pos - 1)
          print(vim.fn.system("git openpr " .. hash))
        end

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
              callback = OpenFugitiveOpenPullRequest,
            })
          end,
        })
      end,
    },

    {
      "rhysd/conflict-marker.vim",
      event = "VeryLazy",
    },

    {
      "lewis6991/gitsigns.nvim",
      event = "VeryLazy",
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
      event = "VeryLazy",
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
    -- Editing
    -- =============================================================
    {
      "editorconfig/editorconfig-vim",
      event = "VeryLazy",
    },

    {
      "deton/jasegment.vim",
      event = "VeryLazy",
    },

    {
      "thinca/vim-qfreplace",
      event = "VeryLazy",
    },

    {
      "itchyny/vim-qfedit",
      event = "VeryLazy",
    },

    {
      "skanehira/qfopen.vim",
      event = "VeryLazy",
      config = function()
        local map = function(mode, key, rhs)
          vim.api.nvim_set_keymap(mode, key, rhs, { noremap = true, silent = true })
        end

        vim.api.nvim_create_autocmd("FileType", {
          group = vim.api.nvim_create_augroup("qfopen_bufenter", { clear = true }),
          pattern = "qf",
          callback = function()
            map("n", "<C-v>", "<Plug>(qfopen-open-vsplit)")
            map("n", "<C-x>", "<Plug>(qfopen-open-split)")
            map("n", "<C-t>", "<Plug>(qfopen-open-tab)")
          end,
        })
      end,
    },

    {
      "kazhala/close-buffers.nvim",
      event = "VeryLazy",
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
      "junegunn/vim-easy-align",
      event = "VeryLazy",
      keys = {
        { "ga", "<Plug>(EasyAlign)", mode = "n" },
        { "ga", "<Plug>(EasyAlign)", mode = "x" },
      },
    },

    {
      "andymass/vim-matchup",
      lazy = true,
      dependencies = {
        "nvim-treesitter/nvim-treesitter",
      },
      init = function()
        vim.g.matchup_matchparen_offscreen = {}
      end,
    },

    {
      "mattn/emmet-vim",
      event = "VeryLazy",
      keys = {
        { "<C-e>,", "<plug>(emmet-expand-abbr)", mode = "i" },
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
      "machakann/vim-sandwich",
      event = "VeryLazy",
      config = function()
        vim.g["sandwich#recipes"] = vim.fn.deepcopy(vim.g["sandwich#default_recipes"])

        table.insert(vim.g["sandwich#recipes"], {
          external = { "it", "at" },
          noremap = 1,
          filetype = { "html" },
          input = { "t" },
        })

        table.insert(vim.g["sandwich#recipes"], {
          buns = { "TagInput(1)", "TagInput(0)" },
          expr = 1,
          filetype = { "html" },
          kind = { "add", "replace" },
          action = { "add" },
          input = { "t" },
        })

        local TagLast = ""

        function TagInput(is_head)
          if is_head == 1 then
            TagLast = vim.fn.input("Tag Name: ")
            if TagLast ~= "" then
              return string.format("<%s>", TagLast)
            else
              error("OperatorSandwichCancel")
            end
          else
            return string.format("</%s>", string.match(TagLast, "^\a[^[:blank:]>/]*"))
          end
        end

        _G.TagInput = TagInput
      end,
    },

    {
      "David-Kunz/treesitter-unit",
      event = "VeryLazy",
      dependencies = {
        "nvim-treesitter/nvim-treesitter",
      },
      keys = {
        { "iu", ':lua require"treesitter-unit".select()<CR>', mode = "x", noremap = true },
        { "au", ':lua require"treesitter-unit".select(true)<CR>', mode = "x", noremap = true },
        { "iu", ':<C-u>lua require"treesitter-unit".select()<CR>', mode = "o", noremap = true },
        { "au", ':<C-u>lua require"treesitter-unit".select(true)<CR>', mode = "o", noremap = true },
      },
    },

    {
      "gbprod/substitute.nvim",
      event = "VeryLazy",
      config = function()
        require("substitute").setup({})
        vim.keymap.set("n", "r", require("substitute").operator, { noremap = true })
        vim.keymap.set("n", "rp", require("substitute").line, { noremap = true })
        vim.keymap.set("n", "rr", "r", { noremap = true })
        vim.keymap.set("x", "r", require("substitute").visual, { noremap = true })
      end,
    },

    {
      "numToStr/Comment.nvim",
      event = "VeryLazy",
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
      "folke/flash.nvim",
      event = "VeryLazy",
      config = function()
        local flash = require("flash")

        flash.setup({
          modes = {
            search = {
              enabled = false,
              highlight = { backdrop = true },
            },
            char = {
              enabled = true,
              keys = { "f", "F", "t", "T" },
              highlight = { backdrop = false },
              char_actions = function(motion)
                -- clever-f style
                if motion == "f" or motion == "t" then
                  return {
                    ["f"] = "next",
                    ["F"] = "prev",
                  }
                else
                  return {
                    ["f"] = "prev",
                    ["F"] = "next",
                  }
                end
              end,
            },
          },
          prompt = {
            prefix = {
              { " ", "FlashPromptIcon" },
            },
          },
        })

        local function set_keymap(modes, lhs, rhs)
          for _, mode in pairs(modes) do
            vim.keymap.set(mode, lhs, rhs, { noremap = true, silent = true })
          end
        end

        set_keymap({ "n", "v" }, "<Leader>f", function()
          flash.jump({
            search = { multi_window = false },
          })
        end)

        set_keymap({ "n", "v" }, "z/", function()
          flash.jump({
            search = { mode = "fuzzy", incremental = true },
          })
        end)

        set_keymap({ "n", "v" }, "z?", function()
          flash.ump({
            search = { mode = "fuzzy", incremental = true, forward = false },
          })
        end)
      end,
    },

    {
      "haya14busa/vim-asterisk",
      event = "VeryLazy",
      dependencies = {
        { "haya14busa/is.vim" },
      },
      keys = {
        { "*", "<Plug>(asterisk-*)<Plug>(is-nohl-1)", mode = "n", noremap = false },
        { "#", "<Plug>(asterisk-#)<Plug>(is-nohl-1)", mode = "n", noremap = false },
        { "g*", "<Plug>(asterisk-g*)<Plug>(is-nohl-1)", mode = "n", noremap = false },
        { "g#", "<Plug>(asterisk-g#)<Plug>(is-nohl-1)", mode = "n", noremap = false },
        { "z*", "<Plug>(asterisk-z*)<Plug>(is-nohl-1)", mode = "n", noremap = false },
        { "gz*", "<Plug>(asterisk-gz*)<Plug>(is-nohl-1)", mode = "n", noremap = false },
        { "z#", "<Plug>(asterisk-z#)<Plug>(is-nohl-1)", mode = "n", noremap = false },
        { "gz#", "<Plug>(asterisk-gz#)<Plug>(is-nohl-1)", mode = "n", noremap = false },
      },
      init = function()
        vim.g.asterisk_keeppos = 1
      end,
    },

    -- =============================================================
    -- Debug
    -- =============================================================
    {
      "thinca/vim-quickrun",
      event = "VeryLazy",
      keys = {
        { "<Leader>q", ":<C-u>QuickRun<CR>", mode = "n", noremap = true, silent = true },
        { "<Leader>q", ":QuickRun<CR>", mode = "v", noremap = true, silent = true },
      },
      init = function()
        vim.g.quickrun_no_default_key_mappings = 1
      end,
    },

    -- =============================================================
    -- Rust
    -- =============================================================
    {
      "rust-lang/rust.vim",
      event = "VeryLazy",
      init = function()
        vim.g.rustfmt_autosave = 0
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
      event = "VeryLazy",
      init = function()
        vim.g.vim_markdown_no_default_key_mappings = 1
        vim.g.vim_markdown_folding_disabled = 1
      end,
    },

    {
      "rhysd/vim-gfm-syntax",
      event = "VeryLazy",
    },

    {
      "iamcco/markdown-preview.nvim",
      build = "cd app && yarn install",
      event = "VeryLazy",
      init = function()
        vim.g.mkdp_auto_close = 0
        vim.g.mkdp_page_title = "${name}"
        vim.g.mkdp_preview_options = {
          disable_sync_scroll = 1,
        }
      end,
    },

    -- =============================================================
    -- TODO: Dart x Flutter
    -- =============================================================
  },
})
