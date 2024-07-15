-- =============================================================
-- Basic
-- =============================================================

local function merge_table(a, b)
  local result = {}
  for k, v in pairs(a) do
    result[k] = v
  end
  for k, v in pairs(b) do
    result[k] = v
  end
  return result
end

local function keymap(modes, lhs, rhs, options)
  local opts = merge_table({ noremap = true, silent = true }, options or {})
  for _, mode in pairs(modes) do
    vim.keymap.set(mode, lhs, rhs, opts)
  end
end

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
keymap({ "n", "v" }, "\\", ",", { silent = false })

-- <C-c> の動作を <Esc> に合わせる
keymap({ "i" }, "<C-c>", "<Esc>", { silent = false })

-- increment, decrement で選択状態を維持
keymap({ "v" }, "<C-a>", "<C-a>gv", { silent = false })
keymap({ "v" }, "<C-x>", "<C-x>gv", { silent = false })

-- j, k による移動を折り返されたテキストでも自然に振る舞うように変更
keymap({ "n", "v" }, "j", "gj", { silent = false })
keymap({ "n", "v" }, "k", "gk", { silent = false })

-- x でレジスタを使わずに切り取り
keymap({ "n" }, "x", '"_x', { silent = true })

-- マーク使わないので無効化
keymap({ "n" }, "m", "<Nop>", { silent = true })

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

-- 選択範囲内をExpressionレジスタで評価 -> 置換
keymap({ "v" }, "Q", "y:g/^.*$//e")

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

keymap({ "n" }, "<Leader>cp", ":ClipPath<CR>")
keymap({ "n" }, "<Leader>cf", ":ClipFile<CR>")
keymap({ "n" }, "<Leader>cd", ":ClipDir<CR>")

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
  local function kmap(mode, lhs, rhs)
    vim.api.nvim_buf_set_keymap(bufnr, mode, lhs, rhs, { noremap = true, silent = true })
  end

  -- Disable LSP Semantic tokens
  client.server_capabilities.semanticTokensProvider = nil

  -- Enable completion triggered by <C-x><C-o>
  vim.api.nvim_buf_set_option(bufnr, "omnifunc", "v:lua.vim.lsp.omnifunc")

  -- Mappings
  kmap("n", "<C-]>", "<cmd>lua vim.lsp.buf.definition()<CR>")
  kmap("n", "<C-w><C-]>", "<cmd>split<CR><cmd>lua vim.lsp.buf.definition()<CR>")
  kmap("n", "K", "<cmd>lua vim.lsp.buf.type_definition()<CR>")
  kmap("n", "<Leader>i", "<cmd>lua vim.lsp.buf.hover()<CR>")
  kmap("n", "<C-^>", "<cmd>lua vim.lsp.buf.references()<CR>")
  kmap("n", "<Leader>r", "<cmd>lua vim.lsp.buf.rename()<CR>")
  kmap("n", "<Leader>a", "<cmd>lua vim.lsp.buf.code_action()<CR>")
  kmap("n", "<space>wa", "<cmd>lua vim.lsp.buf.add_workspace_folder()<CR>")
  kmap("n", "<space>wr", "<cmd>lua vim.lsp.buf.remove_workspace_folder()<CR>")
  kmap("n", "<space>wl", "<cmd>lua print(vim.inspect(vim.lsp.buf.list_workspace_folders()))<CR>")
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
    },
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
        keymap({ "n" }, "<Leader>ee", "<cmd>lua vim.diagnostic.open_float()<CR>")
        keymap({ "n" }, "[g", "<cmd>lua vim.diagnostic.goto_prev()<CR>")
        keymap({ "n" }, "]g", "<cmd>lua vim.diagnostic.goto_next()<CR>")
        keymap({ "n" }, "<Space>q", "<cmd>lua vim.diagnostic.setloclist()<CR>")

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
                        "<Space>o",
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
        "nvim-telescope/telescope.nvim",
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
          closing_tags = {
            prefix = "∙ ",
          },
          dev_log = {
            enabled = true,
            notify_errors = false,
            open_cmd = "tabedit",
          },
          lsp = {
            on_attach = function(client, bufnr)
              vim.api.nvim_buf_set_keymap(
                bufnr,
                "n",
                "<Space>ff",
                "<cmd>lua require('telescope').extensions.flutter.commands()<CR>",
                { noremap = true, silent = true }
              )
              lsp_on_attach(client, bufnr)
            end,
            capabilities = function()
              require("cmp_nvim_lsp").default_capabilities()
            end,
            settings = {
              showTodos = false,
            },
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

        local actionlint = lint.linters.actionlint
        lint.linters.actionlint = {
          cmd = actionlint.cmd,
          args = actionlint.args,
          stdin = actionlint.stdin,
          ignore_exitcode = actionlint.ignore_exitcode,
          parser = function(output, bufnr)
            -- Only GHA files
            local fpath = vim.api.nvim_buf_get_name(bufnr)
            if fpath:match("^.*%.github/.+%.y[a]?ml$") == nil then
              return {}
            end

            return actionlint.parser(output, bufnr)
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
            -- enable = true,
            enable = false,
          },
          indent = {
            -- enable = false, -- disable builtin indent module (use yati's indent)
            enable = true, -- disable builtin indent module (use yati's indent)
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
      event = "VeryLazy",
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
          keymap({ "n" }, "<Tab>", vsplit_preview, opts("Preview: Vertical Split"))
          keymap({ "n" }, "<C-c>", change_root_to_global_cwd, opts("Change Root To Global CWD"))
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
          keymap({ "n" }, "?", api.tree.toggle_help, opts("Help"))
        end,
      },
      config = function(_, opts)
        require("nvim-tree").setup(opts)

        keymap({ "n" }, "<C-j>", function()
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
        end)
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
      event = "VeryLazy",
      dependencies = {
        "nvim-lua/plenary.nvim",
        { "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
        "nvim-telescope/telescope-github.nvim",
        "akinsho/flutter-tools.nvim",
      },
      keys = {
        { "<C-p>", "<cmd>Telescope find_files<CR>", mode = "n", noremap = true },
        { "z/", "<cmd>Telescope current_buffer_fuzzy_find<CR>", mode = "n", noremap = true },
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
        telescope.load_extension("flutter")
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

        local kmap = vim.api.nvim_set_keymap
        local opts = { noremap = true, silent = true }

        kmap("n", "<Leader>tt", ':lua ToggleTerm("float")<CR>', opts)
        kmap("n", "<Leader>ts", [[:lua ToggleTerm("horizontal")<CR>]], opts)
        kmap("n", "<Leader>tv", [[:lua ToggleTerm("vertical")<CR>]], opts)
        kmap(
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
      event = "VeryLazy",
      dependencies = {
        "nvim-tree/nvim-tree.lua",
        "tpope/vim-fugitive",
        "akinsho/toggleterm.nvim",
      },
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
        vim.api.nvim_create_autocmd("FileType", {
          group = vim.api.nvim_create_augroup("qfopen_bufenter", { clear = true }),
          pattern = "qf",
          callback = function()
            local bufnr = vim.api.nvim_get_current_buf()
            local function kmap(mode, key, rhs)
              vim.api.nvim_buf_set_keymap(bufnr, mode, key, rhs, { noremap = true, silent = true })
            end
            kmap("n", "<C-v>", "<Plug>(qfopen-open-vsplit)")
            kmap("n", "<C-x>", "<Plug>(qfopen-open-split)")
            kmap("n", "<C-t>", "<Plug>(qfopen-open-tab)")
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
      opts = {
        highlight_substituted_text = {
          enabled = false,
        },
      },
      config = function(_, opts)
        local substitute = require("substitute")

        substitute.setup(opts)

        keymap({ "n" }, "r", substitute.operator)
        keymap({ "n" }, "rr", substitute.line)
        keymap({ "x" }, "r", substitute.visual)
        keymap({ "n", "x" }, "R", "r")
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
      "echasnovski/mini.jump",
      event = "VeryLazy",
      opts = {
        mappings = {
          repeat_jump = "<Nop>",
        },
        delay = {
          highlight = 0,
        },
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
              enabled = false,
            },
          },
          label = {
            reuse = "all",
          },
          prompt = {
            prefix = {
              { " ", "FlashPromptIcon" },
            },
          },
        })

        keymap({ "n", "v" }, "<Leader>f", function()
          flash.jump({
            search = { multi_window = false },
          })
        end)

        keymap({ "o" }, "r", function()
          flash.remote({
            search = { multi_window = false },
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
        { "*", "<Plug>(asterisk-*)<Plug>(is-nohl-1)", mode = { "n", "v" }, noremap = false },
        { "#", "<Plug>(asterisk-#)<Plug>(is-nohl-1)", mode = { "n", "v" }, noremap = false },
        { "g*", "<Plug>(asterisk-g*)<Plug>(is-nohl-1)", mode = { "n", "v" }, noremap = false },
        { "g#", "<Plug>(asterisk-g#)<Plug>(is-nohl-1)", mode = { "n", "v" }, noremap = false },
        { "z*", "<Plug>(asterisk-z*)<Plug>(is-nohl-1)", mode = { "n", "v" }, noremap = false },
        { "gz*", "<Plug>(asterisk-gz*)<Plug>(is-nohl-1)", mode = { "n", "v" }, noremap = false },
        { "z#", "<Plug>(asterisk-z#)<Plug>(is-nohl-1)", mode = { "n", "v" }, noremap = false },
        { "gz#", "<Plug>(asterisk-gz#)<Plug>(is-nohl-1)", mode = { "n", "v" }, noremap = false },
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
  },
})
