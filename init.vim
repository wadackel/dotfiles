" =============================================================
" Basic
" =============================================================

" 不要なプラグインを停止
let g:loaded_gzip          = 1
let g:loaded_tar           = 1
let g:loaded_tarPlugin     = 1
let g:loaded_zip           = 1
let g:loaded_zipPlugin     = 1
let g:loaded_rrhelper      = 1
let g:loaded_2html_plugin  = 1
let g:loaded_vimball       = 1
let g:loaded_vimballPlugin = 1


" `init.vim` の再読み込み
command! ReloadVimrc e $MYVIMRC

" debug
command! -nargs=*
\   Debug
\   try
\|      echom <q-args> ":" string(<args>)
\|  catch
\|      echom <q-args>
\|  endtry

" python (pyenv)
let g:python3_host_prog = '~/.pyenv/versions/py3neovim/bin/python'


" `%` 移動の拡張
source $VIMRUNTIME/macros/matchit.vim


" <Leader>を`,`に設定
let mapleader = ","


" 各種基本設定
set encoding=utf-8
set fileencoding=utf-8
set fileencodings=utf-8,cp932,ico-2022-jp,sjis,euc-jp,latin1
set completeopt=menu,menuone,noselect
set autoread
set t_ut=
set termguicolors
set nohlsearch
set incsearch
set formatoptions+=mM
set display+=lastline
set ignorecase
set smartcase
set wrapscan
set showmatch
set showmode
set title
set ruler
set tabstop=2
set shiftwidth=2
set signcolumn=yes
set autoindent
set smartindent
set expandtab
set wrap
if has('mac')
  set clipboard=unnamed
elseif has('unix')
  set clipboard=unnamedplus
endif
set laststatus=2
if !isdirectory($HOME.'/.vim/swap')
  call mkdir($HOME.'/.vim/swap', 'p')
endif
set directory=~/.vim/swap
" set ambiwidth=double
set wildmenu
set wildmode=longest,full
set noshowmode
set iminsert=0
set imsearch=0
set noimdisable
set noimcmdline
set backspace=indent,eol,start
set matchpairs& matchpairs+=<:>
set lazyredraw
set nrformats=
set guicursor=n-v-ve-o-r-c-cr-sm:block,i-ci:block-blinkwait300-blinkon200-blinkoff150

" 起動時のメッセージ非表示
set shortmess& shortmess+=I

" 改行時のコメントを無効化
set formatoptions-=r
set formatoptions-=o

" ビープ音を消す
set vb t_vb=
set novisualbell

" タブ、空白、改行の可視化
set list
set listchars=tab:>.,trail:_,extends:>,precedes:<,nbsp:%

" マウス無効化
set mouse=


" `system()` の末尾空白を削除して結果を返す
function! TrimedSystem(...)
  return substitute(call('system', a:000), '\n\+$', '', '')
endfunction


" 基本キーマップ

" leader を \ に退避
nnoremap \ ,
vnoremap \ ,

" <C-c> の動作を <Esc> に合わせる
inoremap <C-c> <Esc>

" increment, decrement で選択状態を維持
vnoremap <c-a> <c-a>gv
vnoremap <c-x> <c-x>gv

" j, k による移動を折り返されたテキストでも自然に振る舞うように変更
nnoremap j gj
vnoremap j gj
nnoremap k gk
vnoremap k gk

" x でレジスタを使わずに切り取り
nnoremap x "_x

" マーク使わないので無効化
nnoremap m <Nop>

" 行頭, 文末の移動
nnoremap M g^
vnoremap M g^
nnoremap H g0
vnoremap H g0
nnoremap L g$
vnoremap L g$

nnoremap mH 0
vnoremap mH 0
nnoremap mL $
vnoremap mL $

" スクリーン内での移動
nnoremap gh H
nnoremap gm M
nnoremap gl L
vnoremap gh H
vnoremap gm M
vnoremap gl L

" 検索後の位置調整
nnoremap n nzz
nnoremap N Nzz
nnoremap * *zz
nnoremap # #zz
nnoremap g* g*zz
nnoremap g# g#zz

" command モードは Emacs 風に
cmap <C-f> <Right>
cmap <C-b> <Left>
cmap <C-a> <Home>
cmap <C-e> <End>
cmap <C-d> <Del>
cmap <C-h> <BackSpace>

" QuickFix の移動
nnoremap [q :cprevious<CR>
nnoremap ]q :cnext<CR>
nnoremap [Q :<C-u>cfirst<CR>
nnoremap ]Q :<C-u>clast<CR>

" locationlist の移動
nnoremap [w :lprevious<CR>
nnoremap ]w :lnext<CR>
nnoremap [W :<C-u>lfirst<CR>
nnoremap ]W :<C-u>llast<CR>

" argument list の移動
nnoremap [a :previous<CR>
nnoremap ]a :next<CR>
nnoremap [A :<C-u>first<CR>
nnoremap ]A :<C-u>last<CR>

" ; と :
noremap ; :
noremap : ;
noremap @; @:
noremap @: @;

" Toggle系オプション
nnoremap <silent> \w :<C-u>setl wrap! wrap?<CR>
nnoremap <silent> \s :call <SID>toggle_syntax()<CR>
nnoremap <silent> \m :call <SID>toggle_mouse()<CR>
nnoremap <silent> \h :<C-u>setl hlsearch!<CR>

function! s:toggle_syntax() abort
  if exists('g:syntax_on')
    syntax off
    TSDisable highlight
    redraw
    echo 'syntax off'
  else
    syntax on
    TSEnable highlight
    redraw
    echo 'syntax on'
  endif
endfunction

function! s:toggle_mouse() abort
  if &mouse == 'a'
    set mouse=
    echo 'mouse off'
  else
    set mouse=a
    echo 'mouse on'
  endif
endfunction

" スーパーユーザとして保存
cnoremap w!! w !sudo tee > /dev/null %

" 括弧の補完
inoremap {<Enter> {}<Left><CR><ESC><S-o>
inoremap [<Enter> []<Left><CR><ESC><S-o>
inoremap (<Enter> ()<Left><CR><ESC><S-o>

" 選択範囲内をExpressionレジスタで評価->置換
vnoremap Q "0ygvc<C-r>=<C-r>0<CR><ESC>

" 指定データをクリップボードにつながるレジスタへ保存
function! s:clip(data)
  let root = finddir('.git/..', expand('%:p:h') . ';') . '/'
  let data = substitute(a:data, '^' . root, '', '')
  let @* = data
  echo '[clipped] ' . data
endfunction

" 現在開いているファイルのパス
command! -nargs=0 ClipPath call s:clip(expand('%:p'))

" 現在開いているファイルのファイル名
command! -nargs=0 ClipFile call s:clip(expand('%:t'))

" 現在開いているファイルのディレクトリパス
command! -nargs=0 ClipDir  call s:clip(expand('%:p:h'))


" QuickFix の設定
augroup QuickfixConfigure
  autocmd!

  " help & QuickFix を q だけで閉じる
  autocmd FileType help nnoremap <buffer> q <C-w>c
  autocmd FileType qf nnoremap <buffer> q <C-w>c

  " QuickFix は折り返しを無効化する
  autocmd FileType qf setlocal nowrap

  " signcolumn を無効化
  autocmd FileType qf setlocal signcolumn=no

  " QuickFix を自動で開く
  autocmd QuickfixCmdPost make,grep,grepadd,vimgrep,vim,**grep** nested if len(getqflist()) != 0 | copen | endif
augroup END


" ペースト時のオートインデントを無効化
if &term =~ "xterm"
  let &t_ti .= "\e[?2004h"
  let &t_te .= "\e[?2004l"
  let &pastetoggle = "\e[201~"

  function! XTermPasteBegin(ret)
    set paste
    return a:ret
  endfunction

  noremap <special> <expr> <Esc>[200~ XTermPasteBegin("0i")
  inoremap <special> <expr> <Esc>[200~ XTermPasteBegin("")
  cnoremap <special> <Esc>[200~ <nop>
  cnoremap <special> <Esc>[201~ <nop>
endif


" ファイルタイプショートカット
autocmd! FileType md setlocal filetype=markdown
autocmd! FileType js setlocal filetype=javascript


" カーソル位置の復元
augroup restoreCursorPosition
  autocmd BufReadPost *
      \ if line("'\"") > 1 && line("'\"") <= line("$") |
      \   exe "normal! g`\"" |
      \ endif
augroup END


" incsearch
augroup vimrc-incsearch-highlight
  autocmd!
  autocmd CmdlineEnter [/\?] :set hlsearch
  autocmd CmdlineLeave [/\?] :set nohlsearch
augroup END


" タブの操作/移動
" http://qiita.com/wadako111/items/755e753677dd72d8036d

" Anywhere SID.
function! s:SID_PREFIX()
  return matchstr(expand('<sfile>'), '<SNR>\d\+_\zeSID_PREFIX$')
endfunction

" Set tabline.
set showtabline=2 " 常にタブラインを表示

" The prefix key.
nnoremap [Tag] <Nop>
nmap t [Tag]


" 画面分割用のキーマップ
" http://qiita.com/tekkoc/items/98adcadfa4bdc8b5a6ca
nnoremap s <Nop>
nnoremap sj <C-w>j
nnoremap sk <C-w>k
nnoremap sl <C-w>l
nnoremap sh <C-w>h
nnoremap sJ <C-w>J
nnoremap sK <C-w>K
nnoremap sL <C-w>L
nnoremap sH <C-w>H
nnoremap sn gt
nnoremap sp gT
nnoremap s= <C-w>=
nnoremap sw <C-w>w
nnoremap so <C-w>_<C-w><Bar>
nnoremap sO <C-w>=
nnoremap sN :<C-u>bn<CR>
nnoremap sP :<C-u>bp<CR>
nnoremap st :<C-u>tabnew<CR>
nnoremap ss :<C-u>sp<CR>
nnoremap sv :<C-u>vs<CR>
nnoremap sq :<C-u>q<CR>
nnoremap sQ :<C-u>bd<CR>

" quickfix/locationlist の open/close
nnoremap <space>co :copen<CR>
nnoremap <space>cc :cclose<CR>
nnoremap <space>lo :lopen<CR>
nnoremap <space>lc :lclose<CR>

" 現在のタブページ以外全て閉じる
nnoremap <C-w>O :<C-u>tabo<CR>

" Switches to tab with specific number.
nnoremap <silent> <Leader>1 1gt
nnoremap <silent> <Leader>2 2gt
nnoremap <silent> <Leader>3 3gt
nnoremap <silent> <Leader>4 4gt
nnoremap <silent> <Leader>5 5gt
nnoremap <silent> <Leader>6 6gt
nnoremap <silent> <Leader>7 7gt
nnoremap <silent> <Leader>8 8gt
nnoremap <silent> <Leader>9 9gt


" Terminal
augroup terminal-config
  autocmd!
  autocmd TermOpen * startinsert
  autocmd TermOpen * setlocal signcolumn=no
augroup END

" open terminal
nnoremap <silent> <Leader>tt :<C-u>terminal<CR>
nnoremap <silent> <Leader>ts :<C-u>execute 'split \| terminal'<CR>
nnoremap <silent> <Leader>tv :<C-u>execute 'vsplit \| terminal'<CR>
tnoremap <silent> <Leader>ts <C-\><C-n>:execute 'split \| terminal'<CR>
tnoremap <silent> <Leader>tv <C-\><C-n>:execute 'vsplit \| terminal'<CR>

" to normal mode
tnoremap <silent> <C-[> <C-\><C-n>
tnoremap <silent> <Esc> <C-\><C-n>

" close terminal
tnoremap <silent> <C-q> <C-\><C-n>:q<CR>

function! s:auto_update_colorscheme(...) abort
    setlocal autoread noswapfile
    let interval = a:0 > 0 ? a:1 : 3000
    let timer = timer_start(interval, {-> execute('checktime')}, {'repeat' : -1})
    autocmd! BufReadPost <buffer> source $MYVIMRC
endfunction
command! -nargs=? AutoUpdateColorscheme call <SID>auto_update_colorscheme(<f-args>)


" ripgrep
if executable('rg')
  set grepprg=rg\ --vimgrep\ --no-heading\ --hidden\ -g\ !.git
  set grepformat=%f:%l:%c:%m,%f:%l:%m
endif


" =============================================================
" Filetypes
" =============================================================
augroup fileTypeDetect
  autocmd BufRead,BufNew,BufNewFile *.mdx setlocal filetype=markdown
  autocmd BufRead,BufNew,BufNewFile *.ejs setlocal ft=html

  autocmd BufRead,BufNew,BufNewFile gitconfig setlocal ft=gitconfig
  autocmd BufRead,BufNew,BufNewFile .eslintrc setlocal ft=json
  autocmd BufRead,BufNew,BufNewFile .stylelintrc setlocal ft=json
  autocmd BufRead,BufNew,BufNewFile .prettierrc setlocal ft=json
  autocmd BufRead,BufNew,BufNewFile .babelrc setlocal ft=json
  autocmd BufRead,BufNew,BufNewFile .textlintrc setlocal ft=json
augroup END


" =============================================================
" Plugins
" =============================================================

call plug#begin('~/.nvim/plugged')

" vim-scripts
Plug 'vim-scripts/sudo.vim'

" lua
Plug 'nvim-lua/plenary.nvim'
Plug 'lewis6991/impatient.nvim'
Plug 'kyazdani42/nvim-web-devicons'

" completion
Plug 'williamboman/mason.nvim'
Plug 'williamboman/mason-lspconfig.nvim'
Plug 'neovim/nvim-lspconfig'
Plug 'hrsh7th/nvim-cmp'
Plug 'hrsh7th/cmp-nvim-lsp'
Plug 'hrsh7th/cmp-nvim-lsp-signature-help'
Plug 'hrsh7th/cmp-buffer'
Plug 'hrsh7th/cmp-path'
Plug 'hrsh7th/cmp-cmdline'
Plug 'hrsh7th/cmp-vsnip'
Plug 'hrsh7th/vim-vsnip'
Plug 'onsails/lspkind-nvim'
Plug 'stevearc/dressing.nvim'
Plug 'jose-elias-alvarez/null-ls.nvim'

" syntax extention
Plug 'Shougo/context_filetype.vim'
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}
Plug 'nvim-treesitter/playground'

" editing
Plug 'mattn/emmet-vim'
Plug 'andymass/vim-matchup'
Plug 'machakann/vim-sandwich'
Plug 'David-Kunz/treesitter-unit'
Plug 'tommcdo/vim-exchange'
Plug 'editorconfig/editorconfig-vim'
Plug 'junegunn/vim-easy-align'
Plug 'kana/vim-submode'
Plug 'numToStr/Comment.nvim'
Plug 'JoosepAlviste/nvim-ts-context-commentstring'
Plug 'deton/jasegment.vim'
Plug 'thinca/vim-qfreplace'
Plug 'itchyny/vim-qfedit'
Plug 'skanehira/qfopen.vim'
Plug 'rhysd/clever-f.vim'
Plug 'haya14busa/vim-asterisk'
Plug 'haya14busa/is.vim'
Plug 'easymotion/vim-easymotion'
Plug 'haya14busa/incsearch.vim'
Plug 'haya14busa/incsearch-fuzzy.vim'

" debug
Plug 'thinca/vim-quickrun'

" filer
Plug 'lambdalisue/nerdfont.vim'
Plug 'lambdalisue/glyph-palette.vim'
Plug 'lambdalisue/fern.vim'
Plug 'lambdalisue/fern-renderer-nerdfont.vim'
Plug 'nvim-telescope/telescope.nvim'
Plug 'nvim-telescope/telescope-fzf-native.nvim', { 'do': 'make' }
Plug 'nvim-telescope/telescope-github.nvim'

" sign
Plug 'lewis6991/gitsigns.nvim'

" git
Plug 'sindrets/diffview.nvim'
Plug 'tpope/vim-fugitive'
Plug 'rhysd/conflict-marker.vim'
Plug 'APZelos/blamer.nvim'
Plug 'tyru/open-browser.vim'

" Rust
Plug 'rust-lang/rust.vim'

" TypeScript
Plug 'jose-elias-alvarez/typescript.nvim'

" HTML
Plug 'othree/html5.vim', {'for': 'html'}

" Stylesheet (CSS / Sass)
Plug 'hail2u/vim-css3-syntax', {'for': 'css'}
Plug 'cakebaker/scss-syntax.vim', {'for': 'scss'}

" Markdown
Plug 'plasticboy/vim-markdown', {'for': ['markdown', 'md']}
Plug 'tukiyo/previm', {'for': ['markdown', 'md']}
Plug 'iamcco/markdown-preview.nvim', {'do': 'cd app && yarn install', 'for': ['markdown', 'md']}
Plug 'dhruvasagar/vim-table-mode', {'for': ['markdown', 'md']}
Plug 'rhysd/vim-gfm-syntax', {'for': ['markdown', 'md']}
Plug 'mzlogin/vim-markdown-toc', {'for': ['markdown', 'md']}

" toml
Plug 'cespare/vim-toml',  {'for' : 'toml'}

" Dart
Plug 'dart-lang/dart-vim-plugin'

" Flutter
Plug 'thosakwe/vim-flutter'

" Java
Plug 'tfnico/vim-gradle'

" varnish
Plug 'fgsch/vim-varnish'

" GraphQL
Plug 'jparise/vim-graphql'

" statusline
Plug 'nvim-lualine/lualine.nvim'
Plug 'j-hui/fidget.nvim'

" colorscheme
if isdirectory($HOME.'/develop/github.com/wadackel/vim-dogrun')
  Plug '~/develop/github.com/wadackel/vim-dogrun'
else
  Plug 'wadackel/vim-dogrun'
endif

call plug#end()


" impatient.nvim
lua require('impatient')


" qfopen
augroup qfopen_bufenter
  function! s:qfopen_keymap() abort
    nmap <buffer> <C-v> <Plug>(qfopen-open-vsplit)
    nmap <buffer> <C-x> <Plug>(qfopen-open-split)
    nmap <buffer> <C-t> <Plug>(qfopen-open-tab)
  endfunction

  au!
  au FileType qf call s:qfopen_keymap()
augroup END


" lsp
lua << EOF
  local signs = {
    { name = "DiagnosticSignError", text = "•" },
    { name = "DiagnosticSignWarn", text = "•" },
    { name = "DiagnosticSignHint", text = "•" },
    { name = "DiagnosticSignInfo", text = "•" },
  }

  for _, sign in ipairs(signs) do
    vim.fn.sign_define(sign.name, { texthl = sign.name, text = sign.text, numhl = "" })
  end

  vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, {
    border = "rounded",
  })

  vim.lsp.handlers["textDocument/publishDiagnostics"] = vim.lsp.with(
    vim.lsp.diagnostic.on_publish_diagnostics, {
      virtual_text = {
        prefix = "",
        spacing = 0,
      },
      signs = {
        active = signs,
      },
      float = {
        focus = false,
        style = "minimal",
        border = "rounded",
        source = "always",
      },
    }
  )

  -- Setup nvim-cmp.
  local cmp = require'cmp'

  cmp.setup({
    window = {
      completion = cmp.config.window.bordered({ winhighlight = 'Normal:Normal,FloatBorder:Comment,CursorLine:Visual,Search:None' }),
      documentation = cmp.config.window.bordered({ winhighlight = 'Normal:Normal,FloatBorder:Comment,CursorLine:Visual,Search:None' }),
    },
    snippet = {
      expand = function(args)
        vim.fn["vsnip#anonymous"](args.body)
      end,
    },
    mapping = cmp.mapping.preset.insert({
      ['<C-b>'] = cmp.mapping(cmp.mapping.scroll_docs(-4), { 'i', 'c' }),
      ['<C-f>'] = cmp.mapping(cmp.mapping.scroll_docs(4), { 'i', 'c' }),
      ['<C-Space>'] = cmp.mapping(cmp.mapping.complete(), { 'i', 'c' }),
      ['<C-e>'] = cmp.mapping({
        i = cmp.mapping.abort(),
        c = cmp.mapping.close(),
      }),
      ['<C-y>'] = cmp.mapping.confirm({ select = true }),
    }),
    sources = cmp.config.sources({
      { name = 'nvim_lsp' },
      { name = 'nvim_lsp_signature_help' },
      { name = 'path' },
      { name = 'vsnip' },
    }, {
      { name = 'buffer' },
    }),
  })

  -- Set configuration for specific filetype.
  cmp.setup.filetype('gitcommit', {
    sources = cmp.config.sources({
      { name = 'cmp_git' }, -- You can specify the `cmp_git` source if you were installed it.
    }, {
      { name = 'buffer' },
    })
  })

  -- Icons
  local lspkind = require('lspkind')
  cmp.setup {
    formatting = {
      format = lspkind.cmp_format({
        mode = 'symbol_text',
        maxwidth = 50,
      })
    }
  }

  -- Mappings.
  local lspconfig = require('lspconfig')

  local opts = { noremap=true, silent=true }
  vim.api.nvim_set_keymap('n', '<space>e', '<cmd>lua vim.diagnostic.open_float()<CR>', opts)
  vim.api.nvim_set_keymap('n', '[g', '<cmd>lua vim.diagnostic.goto_prev()<CR>', opts)
  vim.api.nvim_set_keymap('n', ']g', '<cmd>lua vim.diagnostic.goto_next()<CR>', opts)
  vim.api.nvim_set_keymap('n', '<space>q', '<cmd>lua vim.diagnostic.setloclist()<CR>', opts)

  -- Setup servers
  local capabilities = require('cmp_nvim_lsp').default_capabilities()

  local function on_attach(client, bufnr)
    local function set_opt(...)
      vim.api.nvim_buf_set_option(bufnr, ...)
    end

    local function set_keymap(...)
      vim.api.nvim_buf_set_keymap(bufnr, ...)
    end

    -- Disable LSP Semantic tokens
    client.server_capabilities.semanticTokensProvider = nil

    -- Enable completion triggered by <C-x><C-o>
    set_opt('omnifunc', 'v:lua.vim.lsp.omnifunc')

    -- Mappings
    set_keymap('n', '<C-]>', '<cmd>lua vim.lsp.buf.definition()<CR>', opts)
    set_keymap('n', '<C-w><C-]>', '<cmd>split<CR><cmd>lua vim.lsp.buf.definition()<CR>', opts)
    set_keymap('n', 'K', '<cmd>lua vim.lsp.buf.type_definition()<CR>', opts)
    set_keymap('n', '<Leader>i', '<cmd>lua vim.lsp.buf.hover()<CR>', opts)
    set_keymap('n', '<C-^>', '<cmd>lua vim.lsp.buf.references()<CR>', opts)
    set_keymap('n', '<Leader>r', '<cmd>lua vim.lsp.buf.rename()<CR>', opts)
    set_keymap('n', '<Leader>a', '<cmd>lua vim.lsp.buf.code_action()<CR>', opts)
    set_keymap('n', '<space>wa', '<cmd>lua vim.lsp.buf.add_workspace_folder()<CR>', opts)
    set_keymap('n', '<space>wr', '<cmd>lua vim.lsp.buf.remove_workspace_folder()<CR>', opts)
    set_keymap('n', '<space>wl', '<cmd>lua print(vim.inspect(vim.lsp.buf.list_workspace_folders()))<CR>', opts)
  end

  require('mason').setup()
  require('mason-lspconfig').setup {
    ensure_installed = {
      'astro',
      'denols',
      'pyright',
      'rust_analyzer',
      'terraformls',
      'tsserver',
      'lua_ls',
      'vimls',
    },

    handlers = {
      function (name)
        local node_root_dir = lspconfig.util.root_pattern('package.json')
        local is_node_repo = node_root_dir(vim.fn.getcwd()) ~= nil

        local opts = {
          capabilities = capabilities,
          on_attach = on_attach,
        }

        -- Delegate to 'typescript' module
        if name == 'tsserver' then
          if not is_node_repo then
            return
          end
          require('typescript').setup {
            debug = false,
            disable_commands = false,
            go_to_source_definition = {
              fallback = true,
            },
            server = {
              on_attach = function(client, bufnr)
                on_attach(client, bufnr)
                vim.api.nvim_buf_set_keymap(bufnr, 'n', '<space>o', ':TypescriptOrganizeImportsFixed<CR>', { noremap=true, silent=true })
              end,
              root_dir = node_root_dir,
              init_options = {
                maxTsServerMemory = 8192,
              },
              -- https://github.com/jose-elias-alvarez/typescript.nvim/issues/24#issuecomment-1428801350
              commands = {
                TypescriptOrganizeImportsFixed = {
                  function ()
                    local params = {
                      command = '_typescript.organizeImports',
                      arguments = {vim.api.nvim_buf_get_name(0)},
                      title = ''
                    }
                    vim.lsp.buf.execute_command(params)
                  end,
                  description = 'Organize Imports',
                },
              },
            },
          }
          return
        end

        if name == 'denols' then
          if is_node_repo then
            return
          end
          opts.root_dir = lspconfig.util.root_pattern('deno.json', 'deno.jsonc', 'import_map.json')
          opts.init_options = {
            lint = true,
            unstable = true,
            suggest = {
              imports = {
                hosts = {
                  ['https://deno.land'] = true,
                  ['https://cdn.nest.land'] = true,
                  ['https://crux.land'] = true,
                },
              },
            },
          }
        end

        lspconfig[name].setup(opts)
      end,
    },
  }

  -- Setup fidget
  require'fidget'.setup {
    text = {
      spinner = 'dots',
    },
    window = {
      relative = 'editor',
      blend = 0,
    },
    sources = {
      ['null-ls'] = { ignore = true },
    },
  }
EOF


" dressing.nvim
lua << EOF
  require('dressing').setup({
    input = {
      -- Set to false to disable the vim.ui.input implementation
      enabled = true,

      -- Default prompt string
      default_prompt = "Input:",

      -- Can be 'left', 'right', or 'center'
      prompt_align = "left",

      -- When true, <Esc> will close the modal
      insert_only = true,

      -- When true, input will start in insert mode.
      start_in_insert = true,

      -- These are passed to nvim_open_win
      anchor = "SW",
      border = "rounded",
      -- 'editor' and 'win' will default to being centered
      relative = "cursor",

      -- These can be integers or a float between 0 and 1 (e.g. 0.4 for 40%)
      prefer_width = 40,
      width = nil,
      -- min_width and max_width can be a list of mixed types.
      -- min_width = {20, 0.2} means "the greater of 20 columns or 20% of total"
      max_width = { 140, 0.9 },
      min_width = { 20, 0.2 },

      buf_options = {},
      win_options = {
        -- Window transparency (0-100)
        winblend = 0,
        -- Disable line wrapping
        wrap = false,
      },

      -- Set to `false` to disable
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

      override = function(conf)
        -- This is the config that will be passed to nvim_open_win.
        -- Change values here to customize the layout
        return conf
      end,

      -- see :help dressing_get_config
      get_config = nil,
    },
    select = {
      -- Set to false to disable the vim.ui.select implementation
      enabled = true,

      -- Priority list of preferred vim.select implementations
      backend = { "telescope", "builtin" },

      -- Trim trailing `:` from prompt
      trim_prompt = true,

      -- Options for telescope selector
      -- These are passed into the telescope picker directly. Can be used like:
      -- telescope = require('telescope.themes').get_ivy({...})
      telescope = nil,

      -- Options for built-in selector
      builtin = {
        -- These are passed to nvim_open_win
        anchor = "NW",
        border = "rounded",
        -- 'editor' and 'win' will default to being centered
        relative = "editor",

        buf_options = {},
        win_options = {
          -- Window transparency (0-100)
          winblend = 10,
        },

        -- These can be integers or a float between 0 and 1 (e.g. 0.4 for 40%)
        -- the min_ and max_ options can be a list of mixed types.
        -- max_width = {140, 0.8} means "the lesser of 140 columns or 80% of total"
        width = nil,
        max_width = { 140, 0.8 },
        min_width = { 40, 0.2 },
        height = nil,
        max_height = 0.9,
        min_height = { 10, 0.2 },

        -- Set to `false` to disable
        mappings = {
          ["<Esc>"] = "Close",
          ["<C-c>"] = "Close",
          ["<CR>"] = "Confirm",
        },

        override = function(conf)
          -- This is the config that will be passed to nvim_open_win.
          -- Change values here to customize the layout
          return conf
        end,
      },

      -- Used to override format_item. See :help dressing-format
      format_item_override = {},

      -- see :help dressing_get_config
      get_config = nil,
    },
  })
EOF


" null-ls
lua << EOF
local null_ls = require('null-ls')
local augroup = vim.api.nvim_create_augroup("LspFormatting", {})

null_ls.setup {
  diagnostics_format = '#{m} (#{s}: #{c})',

  diagnostic_config = {
    virtual_text = {
      prefix = '',
    },
  },

  border = 'rounded',

  on_attach = function(client, bufnr)
    if client.supports_method('textDocument/formatting') then
      vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })
      vim.api.nvim_create_autocmd('BufWritePre', {
        group = augroup,
        buffer = bufnr,
        callback = function()
          vim.lsp.buf_request(
            bufnr,
            "textDocument/formatting",
            vim.lsp.util.make_formatting_params({}),
            function(err, res, ctx)
              if err then
                local err_msg = type(err) == "string" and err or err.message
                vim.notify("formatting: " .. err_msg, vim.log.levels.WARN)
                return
              end

              if not vim.api.nvim_buf_is_loaded(bufnr) or vim.api.nvim_buf_get_option(bufnr, "modified") then
                return
              end

              if res then
                local client = vim.lsp.get_client_by_id(ctx.client_id)
                vim.lsp.util.apply_text_edits(res, bufnr, client and client.offset_encoding or "utf-16")
                vim.api.nvim_buf_call(bufnr, function()
                vim.cmd("silent noautocmd update")
                end)
              end
            end
          )
        end,
      })
    end
  end,

  sources = {
    null_ls.builtins.diagnostics.eslint.with {
      only_local = true,
    },
    null_ls.builtins.formatting.eslint.with {
      only_local = true,
    },

    null_ls.builtins.formatting.deno_fmt.with {
      condition = function(utils)
        return utils.root_has_file {
          'deno.json',
          'deno.jsonc',
          'import_map.json',
        }
      end,
    },

    null_ls.builtins.formatting.prettier.with {
      only_local = true,
      condition = function(utils)
        return utils.root_has_file {
          'package.json',
        }
      end,
    },

    null_ls.builtins.diagnostics.stylelint.with {
      only_local = true,
    },
    null_ls.builtins.formatting.stylelint.with {
      only_local = true,
    },

    null_ls.builtins.diagnostics.textlint.with {
      only_local = true,
    },
    null_ls.builtins.formatting.textlint.with {
      only_local = true,
    },

    null_ls.builtins.diagnostics.commitlint.with {
      only_local = true,
    },

    null_ls.builtins.diagnostics.actionlint,
    null_ls.builtins.formatting.dart_format,
    null_ls.builtins.formatting.gofmt,
    null_ls.builtins.formatting.goimports,
    null_ls.builtins.formatting.rustfmt,
    null_ls.builtins.formatting.terraform_fmt,
    null_ls.builtins.completion.spell,
  },
}

vim.keymap.set('n', '<Leader>p', function() vim.lsp.buf.format { async = true } end)
EOF


" 画面分割用のキーマップ
call submode#enter_with('bufmove', 'n', '', 's>', '<C-w>>')
call submode#enter_with('bufmove', 'n', '', 's<', '<C-w><')
call submode#enter_with('bufmove', 'n', '', 's+', '<C-w>+')
call submode#enter_with('bufmove', 'n', '', 's-', '<C-w>-')
call submode#map('bufmove', 'n', '', '>', '<C-w>>')
call submode#map('bufmove', 'n', '', '<', '<C-w><')
call submode#map('bufmove', 'n', '', '+', '<C-w>+')


" treesitter unit
xnoremap iu :lua require"treesitter-unit".select()<CR>
xnoremap au :lua require"treesitter-unit".select(true)<CR>
onoremap iu :<c-u>lua require"treesitter-unit".select()<CR>
onoremap au :<c-u>lua require"treesitter-unit".select(true)<CR>


" vim-easy-align
nmap ga <Plug>(EasyAlign)
xmap ga <Plug>(EasyAlign)


" vim-sandwich
let g:sandwich#recipes = deepcopy(g:sandwich#default_recipes)

let g:sandwich#recipes += [
      \   {
      \     'external': ['it', 'at'],
      \     'noremap' : 1,
      \     'filetype': ['html'],
      \     'input'   : ['t'],
      \   },
      \ ]

let g:sandwich#recipes += [
     \   {
     \     'buns'    : ['TagInput(1)', 'TagInput(0)'],
     \     'expr'    : 1,
     \     'filetype': ['html'],
     \     'kind'    : ['add', 'replace'],
     \     'action'  : ['add'],
     \     'input'   : ['t'],
     \   },
     \ ]

function! TagInput(is_head) abort
  if a:is_head
    let s:TagLast = input('Tag Name: ')
    if s:TagLast !=# ''
      let tag = printf('<%s>', s:TagLast)
    else
      throw 'OperatorSandwichCancel'
    endif
  else
    let tag = printf('</%s>', matchstr(s:TagLast, '^\a[^[:blank:]>/]*'))
  endif
  return tag
endfunction


" matchup
let g:matchup_matchparen_offscreen = {}


" lualine
lua << END
local colors = {
  purple = '#929be5',
  teal   = '#73c1a9',
  pink   = '#b871b8',
  red    = '#dc6f7a',

  bg     = '#282a3a',
  fg     = '#4b4e6d',

  inactive = {
    bg = '#282a3a',
    fg = '#4b4e6d',
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

require('lualine').setup {
  options = {
    theme = bubbles_theme,
    component_separators = ' ',
    section_separators = { left = '', right = '' },
    globalstatus = true,
    always_divide_middle = false,
  },
  sections = {
    lualine_a = {
      {
        'mode',
        separator = { left = '', right = '' },
      },
    },
    lualine_b = {
      {
        'branch',
        padding = { left = 1 },
      },
      {
        'filename',
        show_modified_status = true,
        symbols = {
          modified = '∙',
          readonly = '',
          unnamed = '[No Name]',
          newfile = '∙',
        },
      },
      {
        'diagnostics',
        sources = {
          'nvim_diagnostic',
        },
        sections = {
          'error',
          'warn',
          'info',
        },
        symbols = {
          error = ' ',
          warn = ' ',
          info = 'כֿ ',
        },
      },
    },
    lualine_c = {},
    lualine_x = {},
    lualine_y = {
      {
        'filetype',
        padding = 0,
        colored = false,
      },
      'encoding',
      {
        'fileformat',
        padding = { right = 2 },
      },
    },
    lualine_z = {
      {
        'location',
        padding = 1,
        icon = { '¶', align = 'right' },
        separator = { left= '', right = '' },
      },
    },
  },
  inactive_sections = {
    lualine_a = {
      'filename',
    },
    lualine_b = {},
    lualine_c = {},
    lualine_x = {},
    lualine_y = {},
    lualine_z = { 'location' },
  },
  tabline = {
    lualine_a = {},
    lualine_b = {},
    lualine_c = {
      {
        'tabs',
        mode = 2,
        max_length = function()
          return vim.o.columns
        end,
        separator = { right = '' },
        tabs_color = {
          active = 'lualine_a_normal',
          inactive = 'lualine_a_inactive',
        },
        fmt = function(name, context)
          local buflist = vim.fn.tabpagebuflist(context.tabnr)
          local winnr = vim.fn.tabpagewinnr(context.tabnr)
          local bufnr = buflist[winnr]
          local mod = vim.fn.getbufvar(bufnr, '&mod')
          return name .. (mod == 1 and ' ∙' or '')
        end
      },
    },
    lualine_x = {},
    lualine_y = {},
    lualine_z = {},
  },
  extensions = {
    'fern',
    'fugitive',
    'quickfix',
  },
}
END


" QuickRun
let g:quickrun_no_default_key_mappings = 1

nnoremap <silent><Leader>q :<C-u>QuickRun<CR>
vnoremap <silent><Leader>q :QuickRun<CR>


" Clever-f
let g:clever_f_smart_case = 1
let g:clever_f_across_no_line = 1
let g:clever_f_fix_key_direction = 1
let g:clever_f_repeat_last_char_inputs = []


" vim-asterisk
let g:asterisk#keeppos = 1

map *   <Plug>(asterisk-*)<Plug>(is-nohl-1)
map #   <Plug>(asterisk-#)<Plug>(is-nohl-1)
map g*  <Plug>(asterisk-g*)<Plug>(is-nohl-1)
map g#  <Plug>(asterisk-g#)<Plug>(is-nohl-1)
map z*  <Plug>(asterisk-z*)<Plug>(is-nohl-1)
map gz* <Plug>(asterisk-gz*)<Plug>(is-nohl-1)
map z#  <Plug>(asterisk-z#)<Plug>(is-nohl-1)
map gz# <Plug>(asterisk-gz#)<Plug>(is-nohl-1)


" dev-icons
let g:WebDevIconsUnicodeDecorateFolderNodes = 1


" fern.vim
let g:fern#default_hidden = 1
let g:fern#disable_default_mappings = 1
let g:fern#renderer = "nerdfont"

nnoremap <silent> <C-j> :Fern . -width=40 -drawer -reveal=% -toggle<CR>

function! s:init_fern() abort
  nmap <buffer> <expr>
        \ <Plug>(fern-expand-or-enter)
        \ fern#smart#drawer(
        \   "\<Plug>(fern-action-open-or-expand)",
        \   "\<Plug>(fern-action-open-or-enter)",
        \ )

  nmap <buffer> <expr>
        \ <Plug>(fern-collapse-or-leave)
        \ fern#smart#drawer(
        \   "\<Plug>(fern-action-collapse)",
        \   "\<Plug>(fern-action-leave)",
        \ )

  nmap <silent><buffer><nowait> <CR> <Plug>(fern-action-open-or-enter)
  nmap <silent><buffer><nowait> o <Plug>(fern-expand-or-enter)
  nmap <silent><buffer><nowait> l <Plug>(fern-expand-or-enter)
  nmap <silent><buffer><nowait> h <Plug>(fern-collapse-or-leave)
  nmap <silent><buffer><nowait> <C-h> <Plug>(fern-action-leave)
  nmap <silent><buffer><nowait> e <Plug>(fern-action-open)
  nmap <silent><buffer><nowait> E <Plug>(fern-action-open:side)
  nmap <silent><buffer><nowait> t <Plug>(fern-action-open:tabedit)
  nmap <silent><buffer><nowait> i <Plug>(fern-action-reveal)
  nmap <silent><buffer><nowait> <C-c> <Plug>(fern-action-cancel)
  nmap <silent><buffer><nowait> <F5> <Plug>(fern-action-reload)
  nmap <silent><buffer><nowait> - <Plug>(fern-action-mark:toggle)
  nmap <silent><buffer><nowait> <Space> <Plug>(fern-action-mark:toggle)j
  vmap <silent><buffer><nowait> - <Plug>(fern-action-mark:toggle)
  vmap <silent><buffer><nowait> <Space> <Plug>(fern-action-mark:toggle)
  nmap <silent><buffer><nowait> x <Plug>(fern-action-open:system)
  nmap <silent><buffer><nowait> X <Plug>(fern-action-terminal)
  nmap <silent><buffer><nowait> N <Plug>(fern-action-new-file)
  nmap <silent><buffer><nowait> K <Plug>(fern-action-new-dir)
  nmap <silent><buffer><nowait> c <Plug>(fern-action-copy)
  nmap <silent><buffer><nowait> m <Plug>(fern-action-move)
  nmap <silent><buffer><nowait> C <Plug>(fern-action-clipboard-copy)
  nmap <silent><buffer><nowait> M <Plug>(fern-action-clipboard-move)
  nmap <silent><buffer><nowait> P <Plug>(fern-action-clipboard-paste)
  nmap <silent><buffer><nowait> dd <Plug>(fern-action-remove)
  nmap <silent><buffer><nowait> r <Plug>(fern-action-rename)
  nmap <silent><buffer><nowait> y <Plug>(fern-action-yank:label)
  nmap <silent><buffer><nowait> Y <Plug>(fern-action-yank:path)

  nnoremap <silent><buffer><nowait> q :<C-u>quit<CR>
endfunction

augroup fern_custom
  autocmd!
  autocmd FileType fern call glyph_palette#apply()
  autocmd FileType fern call s:init_fern()
augroup END

" netrw hijack
let g:loaded_netrw             = 1
let g:loaded_netrwPlugin       = 1
let g:loaded_netrwSettings     = 1
let g:loaded_netrwFileHandlers = 1

function! s:hijack_directory() abort
  if !isdirectory(expand('%'))
    return
  endif
  Fern %
endfunction

augroup fern_as_netrw
  autocmd!
  autocmd BufEnter * ++nested call s:hijack_directory()
augroup END


" telescope
nnoremap <silent> <C-p> :Telescope find_files<CR>
nnoremap <silent> <Leader>gg :Telescope live_grep<CR>
nnoremap <silent> <Leader>bb :Telescope buffers<CR>
nnoremap <silent> <Leader>cc :Telescope commands<CR>
nnoremap <silent> <Leader>cl :Telescope command_history<CR>
nnoremap <silent> <Leader>gb :Telescope git_branches<CR>
nnoremap <silent> <Leader>gl :Telescope git_commits<CR>
nnoremap <silent> <Leader>gp :Telescope gh pull_request<CR>
nnoremap <silent> <Leader>hl :Telescope highlights<CR>

lua << EOF
  local action = require('telescope.actions')
  local action_state = require('telescope.actions.state')
  local action_layout = require('telescope.actions.layout')

  function action_yank(prompt_bufnr)
    local selection = action_state.get_selected_entry()
    vim.fn.setreg('*', selection.value)
    print('Yanked!')
  end

  function wrap_dropdown_opts(opts)
    opts = opts or {}
    opts.theme = 'dropdown'
    opts.layout_config = {
      width = 0.8,
      height = 0.6,
    }
    return opts
  end

  require'telescope'.setup{
    defaults = {
      prompt_prefix = '❯ ',
      selection_caret = ' ',
      multi_icon = ' ',
      path_display = { 'truncate' },
      layout_config = {
        width = 0.8,
        height = 0.6,
      },
      preview = {
        hide_on_startup = false,
      },
      mappings = {
        i = {
          ['<C-u>'] = false,
          ['<C-w>'] = false,
          ['<C-d>'] = { '<Del>', type = 'command' },
          ['<C-h>'] = { '<BS>', type = 'command' },
          ['<C-a>'] = { '<Home>', type = 'command' },
          ['<C-e>'] = { '<End>', type = 'command', opts = { nowait = true } },
          ['<C-f>'] = { '<Right>', type = 'command' },
          ['<C-b>'] = { '<Left>', type = 'command' },
          ['<C-j>'] = 'move_selection_next',
          ['<C-k>'] = 'move_selection_previous',
          ['<C-p>'] = 'cycle_history_prev',
          ['<C-n>'] = 'cycle_history_next',
          ['<C-q>'] = action.smart_send_to_qflist + action.open_qflist,
          ['<C-y>'] = action_yank,
          ['<Up>'] = 'preview_scrolling_up',
          ['<Down>'] = 'preview_scrolling_down',
          ['<C-\\>'] = action_layout.toggle_preview,
        },
        n = {
          ['<C-k>'] = 'preview_scrolling_up',
          ['<C-j>'] = 'preview_scrolling_down',
          ['<C-\\>'] = action_layout.toggle_preview,
        },
      },
      vimgrep_arguments = {
        'rg',
        '--color=never',
        '--no-heading',
        '--with-filename',
        '--line-number',
        '--column',
        '--smart-case',
        '--trim',
      },
    },
    pickers = {
      find_files = wrap_dropdown_opts({
        find_command = {
          'fd',
          '--type',
          'f',
          '--strip-cwd-prefix',
          '--hidden',
          '-E',
          '.git',
        },
      }),
      live_grep = wrap_dropdown_opts({
        additional_args = function()
          return {
            '--hidden',
            '-g',
            '!.git',
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
      command_history = wrap_dropdown_opts({}),
      git_branches = {
        show_remote_tracking_branches = false,
        mappings = {
          i = {
            ['<C-y>'] = action_yank,
            ['<C-m>'] = 'git_merge_branch',
          },
        },
      },
    },
    extensions = {
      fzf = {
        fuzzy = true,
        override_generic_sorter = true,
        override_file_sorter = true,
        case_mode = 'smart_case',
      },
    },
  }

  require('telescope').load_extension('fzf')
  require('telescope').load_extension('gh')
EOF


" easymotion
let g:EasyMotion_do_mapping = 0
let g:EasyMotion_smartcase = 0

map <Leader> <Plug>(easymotion-prefix)
nmap <Leader>f <Plug>(easymotion-overwin-f)
xmap <Leader>f <Plug>(easymotion-s)
map <Leader>s <Plug>(easymotion-s2)


" incsearch
function! s:config_fuzzyall(...) abort
  return extend(copy({
  \   'converters': [
  \     incsearch#config#fuzzy#converter(),
  \     incsearch#config#fuzzyspell#converter()
  \   ],
  \ }), get(a:, 1, {}))
endfunction

noremap <silent><expr> z/ incsearch#go(<SID>config_fuzzyall())
noremap <silent><expr> z? incsearch#go(<SID>config_fuzzyall({'command': '?'}))
noremap <silent><expr> zg? incsearch#go(<SID>config_fuzzyall({'is_stay': 1}))


" Diffview.nvim
lua << EOF
  local cb = require'diffview.config'.diffview_callback
  require'diffview'.setup {
    diff_binaries = false,    -- Show diffs for binaries
    enhanced_diff_hl = false, -- See ':h diffview-config-enhanced_diff_hl'
    use_icons = true,         -- Requires nvim-web-devicons
    icons = {                 -- Only applies when use_icons is true.
      folder_closed = '',
      folder_open = '',
    },
    signs = {
      fold_closed = '',
      fold_open = '',
    },
    file_panel = {
      win_config = {
        position = 'left',                  -- One of 'left', 'right', 'top', 'bottom'
        width = 35,                         -- Only applies when position is 'left' or 'right'
        height = 10,                        -- Only applies when position is 'top' or 'bottom'
      },
      listing_style = 'tree',             -- One of 'list' or 'tree'
      tree_options = {                    -- Only applies when listing_style is 'tree'
        flatten_dirs = true,              -- Flatten dirs that only contain one single dir
        folder_statuses = 'only_folded',  -- One of 'never', 'only_folded' or 'always'.
      },
    },
    file_history_panel = {
      win_config = {
        position = 'bottom',
        width = 35,
        height = 16,
      },
      log_options = {
        git = {
          single_file = {
            max_count = 256,      -- Limit the number of commits
            follow = false,       -- Follow renames (only for single file)
            all = false,          -- Include all refs under 'refs/' including HEAD
            merges = false,       -- List only merge commits
            no_merges = false,    -- List no merge commits
            reverse = false,      -- List commits in reverse order
          },
        },
      },
    },
    default_args = {    -- Default args prepended to the arg-list for the listed commands
      DiffviewOpen = {},
      DiffviewFileHistory = {},
    },
    hooks = {},         -- See ':h diffview-config-hooks'
    key_bindings = {
      disable_defaults = false,                   -- Disable the default key bindings
      -- The `view` bindings are active in the diff buffers, only when the current
      -- tabpage is a Diffview.
      view = {
        ['<tab>']      = cb('select_next_entry'),  -- Open the diff for the next file
        ['<s-tab>']    = cb('select_prev_entry'),  -- Open the diff for the previous file
        ['gf']         = cb('goto_file'),          -- Open the file in a new split in previous tabpage
        ['<C-w><C-f>'] = cb('goto_file_split'),    -- Open the file in a new split
        ['<C-w>gf']    = cb('goto_file_tab'),      -- Open the file in a new tabpage
        ['<leader>e']  = cb('focus_files'),        -- Bring focus to the files panel
        ['<leader>b']  = cb('toggle_files'),       -- Toggle the files panel.
      },
      file_panel = {
        ['j']             = cb('next_entry'),           -- Bring the cursor to the next file entry
        ['<down>']        = cb('next_entry'),
        ['k']             = cb('prev_entry'),           -- Bring the cursor to the previous file entry.
        ['<up>']          = cb('prev_entry'),
        ['<cr>']          = cb('select_entry'),         -- Open the diff for the selected entry.
        ['o']             = cb('select_entry'),
        ['<2-LeftMouse>'] = cb('select_entry'),
        ['-']             = cb('toggle_stage_entry'),   -- Stage / unstage the selected entry.
        ['S']             = cb('stage_all'),            -- Stage all entries.
        ['U']             = cb('unstage_all'),          -- Unstage all entries.
        ['X']             = cb('restore_entry'),        -- Restore entry to the state on the left side.
        ['R']             = cb('refresh_files'),        -- Update stats and entries in the file list.
        ['<tab>']         = cb('select_next_entry'),
        ['<s-tab>']       = cb('select_prev_entry'),
        ['gf']            = cb('goto_file'),
        ['<C-w><C-f>']    = cb('goto_file_split'),
        ['<C-w>gf']       = cb('goto_file_tab'),
        ['i']             = cb('listing_style'),        -- Toggle between 'list' and 'tree' views
        ['f']             = cb('toggle_flatten_dirs'),  -- Flatten empty subdirectories in tree listing style.
        ['<leader>e']     = cb('focus_files'),
        ['<leader>b']     = cb('toggle_files'),
      },
      file_history_panel = {
        ['g!']            = cb('options'),            -- Open the option panel
        ['<C-A-d>']       = cb('open_in_diffview'),   -- Open the entry under the cursor in a diffview
        ['y']             = cb('copy_hash'),          -- Copy the commit hash of the entry under the cursor
        ['zR']            = cb('open_all_folds'),
        ['zM']            = cb('close_all_folds'),
        ['j']             = cb('next_entry'),
        ['<down>']        = cb('next_entry'),
        ['k']             = cb('prev_entry'),
        ['<up>']          = cb('prev_entry'),
        ['<cr>']          = cb('select_entry'),
        ['o']             = cb('select_entry'),
        ['<2-LeftMouse>'] = cb('select_entry'),
        ['<tab>']         = cb('select_next_entry'),
        ['<s-tab>']       = cb('select_prev_entry'),
        ['gf']            = cb('goto_file'),
        ['<C-w><C-f>']    = cb('goto_file_split'),
        ['<C-w>gf']       = cb('goto_file_tab'),
        ['<leader>e']     = cb('focus_files'),
        ['<leader>b']     = cb('toggle_files'),
      },
      option_panel = {
        ['<tab>'] = cb('select'),
        ['q']     = cb('close'),
      },
    },
  }
EOF


" fugitive
nnoremap <silent> <Leader>gs :Git<CR>
nnoremap <silent> <Leader>gd :Gdiffsplit<CR>

function! s:OpenFugitiveOpenPullRequest() abort
  let l:line = getline('.')
  let l:pos = stridx(l:line, ' ')
  let l:hash = l:line[0:l:pos]
  echo system('git openpr ' . l:hash)
endfunction

augroup fugitive_setup
  autocmd!
  autocmd FileType fugitive nnoremap <silent> <buffer> q <C-w>c
  autocmd FileType fugitiveblame nmap <silent> <buffer> q gq
  autocmd FileType fugitiveblame nnoremap <silent> <buffer> gp :call <SID>OpenFugitiveOpenPullRequest()<CR>
augroup END


" gitsigns
lua << EOF
require('gitsigns').setup {
  signs = {
    add          = { hl = 'GitSignsAdd'   , text = '│', numhl='GitSignsAddNr'   , linehl='GitSignsAddLn'    },
    change       = { hl = 'GitSignsChange', text = '│', numhl='GitSignsChangeNr', linehl='GitSignsChangeLn' },
    delete       = { hl = 'GitSignsDelete', text = '│', numhl='GitSignsDeleteNr', linehl='GitSignsDeleteLn' },
    topdelete    = { hl = 'GitSignsDelete', text = '│', numhl='GitSignsDeleteNr', linehl='GitSignsDeleteLn' },
    changedelete = { hl = 'GitSignsChange', text = '│', numhl='GitSignsChangeNr', linehl='GitSignsChangeLn' },
    untracked    = { hl = 'GitSignsAdd'   , text = '│', numhl='GitSignsAddNr'   , linehl='GitSignsAddLn'    },
  },
  signcolumn = true,  -- Toggle with `:Gitsigns toggle_signs`
  numhl      = false, -- Toggle with `:Gitsigns toggle_numhl`
  linehl     = false, -- Toggle with `:Gitsigns toggle_linehl`
  word_diff  = false, -- Toggle with `:Gitsigns toggle_word_diff`
  watch_gitdir = {
    interval = 1000,
    follow_files = true
  },
  attach_to_untracked = true,
  current_line_blame = true, -- Toggle with `:Gitsigns toggle_current_line_blame`
  current_line_blame_opts = {
    virt_text = true,
    virt_text_pos = 'eol', -- 'eol' | 'overlay' | 'right_align'
    delay = 1000,
    ignore_whitespace = false,
  },
  current_line_blame_formatter = ' <author>, <author_time:%Y-%m-%d> - <summary>',
  sign_priority = 6,
  update_debounce = 100,
  status_formatter = nil, -- Use default
  max_file_length = 40000, -- Disable if file is longer than this (in lines)
  preview_config = {
    -- Options passed to nvim_open_win
    border = 'single',
    style = 'minimal',
    relative = 'cursor',
    row = 0,
    col = 1
  },
  yadm = {
    enable = false
  },
  on_attach = function(bufnr)
    local gs = package.loaded.gitsigns
    local function map(mode, l, r, opts)
      opts = opts or {}
      opts.buffer = bufnr
      vim.keymap.set(mode, l, r, opts)
    end

    -- Navigation
    map('n', ']c', function()
      if vim.wo.diff then return ']c' end
      vim.schedule(function() gs.next_hunk() end)
      return '<Ignore>'
    end, {expr=true})

    map('n', '[c', function()
      if vim.wo.diff then return '[c' end
      vim.schedule(function() gs.prev_hunk() end)
      return '<Ignore>'
    end, {expr=true})

    -- Actions
    map('n', '<Space>gp', gs.preview_hunk)
    map('n', '<Space>gb', gs.toggle_current_line_blame)

    -- Text object
    map({'o', 'x'}, 'ih', ':<C-U>Gitsigns select_hunk<CR>')
  end
}
EOF


" Emmet
let g:user_emmet_mode = 'iv'
let g:user_emmet_leader_key = '<C-e>'
let g:use_emmet_complete_tag = 1
let g:user_emmet_settings = {
  \ 'lang' : 'en',
  \ 'html' : {
  \   'filters' : 'html',
  \   'snippets' : {
  \      'html:5' : "<!doctype html>\n"
  \               ."<html lang=\"en\">\n"
  \               ."<head>\n"
  \               ."  <meta charset=\"${charset}\">\n"
  \               ."  <meta http-equiv=\"X-UA-Compatible\" content=\"IE=edge\">\n"
  \               ."  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\">\n"
  \               ."  <meta name=\"format-detection\" content=\"telephone=no,address=no,email=no\">\n"
  \               ."  <meta name=\"description\" content=\"\">\n"
  \               ."  <link rel=\"shortcut icon\" href=\"/favicon.ico\">\n"
  \               ."  <link rel=\"stylesheet\" href=\"/style.css\">\n"
  \               ."  <title></title>\n"
  \               ."</head>\n"
  \               ."<body>\n"
  \               ."  ${child}|\n"
  \               ."</body>\n"
  \               ."</html>"
  \   }
  \ },
  \ 'css' : {
  \   'filters' : 'fc',
  \ },
  \ 'php' : {
  \   'extends' : 'html',
  \   'filters' : 'html',
  \ },
  \}
augroup EmmitVim


" Markdown
let g:vim_markdown_no_default_key_mappings = 1
let g:vim_markdown_folding_disabled = 1


" markdown-preview
let g:mkdp_auto_close = 0
let g:mkdp_page_title = '${name}'

let g:mkdp_preview_options = {
      \ 'disable_sync_scroll': 1,
      \ }


" Comment
lua << EOF
  require('Comment').setup {
    mappings = {
      basic = false,
      extra = false,
    },
    pre_hook = require('ts_context_commentstring.integrations.comment_nvim').create_pre_hook(),
  }
EOF

nnoremap <silent> <C-k> <Plug>(comment_toggle_linewise_current)
vnoremap <silent> <C-k> <Plug>(comment_toggle_linewise_visual)


" Dart
augroup dart_settings
  autocmd!
  autocmd FileType dart nnoremap <silent> <buffer> <Leader>p :DartFmt<CR>
augroup END


" Go
augroup go_settings
  autocmd!
  autocmd FileType go :highlight goErr cterm=bold ctermfg=214
  autocmd FileType go :match goErr /\<err\>/
augroup END


" rust.vim
let g:rustfmt_autosave = 1


" Astro
augroup astro_settings
  autocmd!
  autocmd BufRead,BufEnter *.astro set filetype=astro
augroup END


" nvim-treesitter/playground
nnoremap <silent> <Space>h :TSHighlightCapturesUnderCursor<CR>


" table-mode
" corner character
let g:table_mode_corner = '|'

" 自動整列は使わない
let g:table_mode_auto_align = 0

" 使わなそうなマッピングは適当なところに退避
let g:table_mode_delete_row_map = '<Leader><C-+>0'
let g:table_mode_delete_column_map = '<Leader><C-+>1'
let g:table_mode_sort_map = '<Leader><C-+>2'
let g:table_mode_tableize_map = '<Leader><C-+>3'
let g:table_mode_add_formula_map = '<Leader><C-+>4'
let g:table_mode_eval_formula_map = '<Leader><C-+>5'
let g:table_mode_echo_cell_map = '<Leader><C-+>6'
let g:table_mode_tableize_d_map = '<Leader><C-+>7'


" ファイル置換時に BufWritePost 処理をトグル
function! s:enableBufWritePost()
  LspStart
  GitGutterEnable
endfunction

function! s:disableBufWritePost()
  LspStop
  GitGutterDisable
endfunction

command! EnableBufWritePost call <SID>enableBufWritePost()
command! DisableBufWritePost call <SID>disableBufWritePost()


" nvim-treesitter
lua << EOF
  require'nvim-treesitter.configs'.setup {
    highlight = {
      enable = true,
      additional_vim_regex_highlighting = false,
    },
    indent = {
      enable = true,
    },
    context_commentstring = {
      enable = true,
      enable_autocmd = false,
    },
    playground = {
      enable = true,
      disable = {},
      updatetime = 25, -- Debounced time for highlighting nodes in the playground from source code
      persist_queries = false, -- Whether the query persists across vim sessions
      keybindings = {
        toggle_query_editor = 'o',
        toggle_hl_groups = 'i',
        toggle_injected_languages = 't',
        toggle_anonymous_nodes = 'a',
        toggle_language_display = 'I',
        focus_language = 'f',
        unfocus_language = 'F',
        update = 'R',
        goto_node = '<cr>',
        show_help = '?',
      },
    },
  }
EOF


" nvim-treesitter/playground
nnoremap <Space>si :TSHighlightCapturesUnderCursor<CR>


" =============================================================
" Colors
" =============================================================

syntax on
colorscheme dogrun

hi Normal guibg=NONE
hi FidgetTask guibg=NONE
hi NormalFloat guibg=NONE
hi NullLsInfoBorder guibg=NONE
