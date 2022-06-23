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
  set grepprg=rg\ --vimgrep\ --no-heading\ --hidden
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


" " vim-polyglot
" let g:polyglot_disabled = ['csv']


" =============================================================
" Plugins
" =============================================================

call plug#begin('~/.vim/plugged')

" vim-scripts
Plug 'vim-scripts/sudo.vim'

" lua
Plug 'nvim-lua/plenary.nvim'
Plug 'lewis6991/impatient.nvim'
Plug 'kyazdani42/nvim-web-devicons'

" completion
Plug 'neovim/nvim-lspconfig'
Plug 'williamboman/nvim-lsp-installer'
Plug 'hrsh7th/nvim-cmp'
Plug 'hrsh7th/cmp-nvim-lsp'
Plug 'hrsh7th/cmp-nvim-lsp-signature-help'
Plug 'hrsh7th/cmp-buffer'
Plug 'hrsh7th/cmp-path'
Plug 'hrsh7th/cmp-cmdline'
Plug 'hrsh7th/cmp-vsnip'
Plug 'hrsh7th/vim-vsnip'
Plug 'onsails/lspkind-nvim'

" syntax checking
Plug 'w0rp/ale'

" syntax extention
Plug 'Shougo/context_filetype.vim'
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}

" editing
" Plug 'sheerun/vim-polyglot'
Plug 'mattn/emmet-vim'
Plug 'andymass/vim-matchup'
Plug 'machakann/vim-sandwich'
Plug 'David-Kunz/treesitter-unit'
Plug 'tommcdo/vim-exchange'
Plug 'editorconfig/editorconfig-vim'
Plug 'h1mesuke/vim-alignta'
Plug 'kana/vim-submode'
Plug 'tyru/caw.vim'
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
Plug 'airblade/vim-gitgutter'

" git
Plug 'sindrets/diffview.nvim'
Plug 'tpope/vim-fugitive'
Plug 'rhysd/conflict-marker.vim'
Plug 'APZelos/blamer.nvim'
Plug 'tyru/open-browser.vim'

" memo
Plug 'glidenote/memolist.vim', {'on': ['MemoNew', 'MemoList']}

" Go
Plug 'mattn/vim-goimports', {'for': 'go'}

" Rust
Plug 'rust-lang/rust.vim'

" TypeScript
Plug 'jose-elias-alvarez/nvim-lsp-ts-utils'
Plug 'HerringtonDarkholme/yats.vim'

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

" C++
Plug 'octol/vim-cpp-enhanced-highlight'

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
Plug 'itchyny/lightline.vim'
Plug 'spywhere/lightline-lsp'
Plug 'j-hui/fidget.nvim'

" colorschema
Plug 'rhysd/vim-color-spring-night'

if isdirectory($HOME.'/develop/github.com/wadackel/nvim-syntax-info')
  Plug '~/develop/github.com/wadackel/nvim-syntax-info'
else
  Plug 'wadackel/nvim-syntax-info'
endif

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
    { name = "DiagnosticSignError", text = "⦿" },
    { name = "DiagnosticSignWarn", text = "⦿" },
    { name = "DiagnosticSignHint", text = "⦿" },
    { name = "DiagnosticSignInfo", text = "⦿" },
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
        prefix = "»",
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
      ['<CR>'] = cmp.mapping.confirm({ select = true }),
    }),
    sources = cmp.config.sources({
      { name = 'nvim_lsp' },
      { name = 'nvim_lsp_signature_help' },
      { name = 'path' },
      { name = 'copilot' },
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

  -- Use cmdline & path source for ':' (if you enabled `native_menu`, this won't work anymore).
  cmp.setup.cmdline(':', {
    mapping = cmp.mapping.preset.cmdline(),
    sources = cmp.config.sources({
      { name = 'path' }
    }, {
      { name = 'cmdline' }
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

  local create_attacher = function(server)
    local on_attach = function(client, bufnr)
      local function set_opt(...)
        vim.api.nvim_buf_set_option(bufnr, ...)
      end

      local function set_keymap(...)
        vim.api.nvim_buf_set_keymap(bufnr, ...)
      end

      -- Enable completion triggered by <C-x><C-o>
      set_opt('omnifunc', 'v:lua.vim.lsp.omnifunc')

      -- Mappings.
      set_keymap('n', '<C-]>', '<cmd>lua vim.lsp.buf.definition()<CR>', opts)
      set_keymap('n', 'K', '<cmd>lua vim.lsp.buf.type_definition()<CR>', opts)
      set_keymap('n', '<Leader>i', '<cmd>lua vim.lsp.buf.hover()<CR>', opts)
      set_keymap('n', '<C-^>', '<cmd>lua vim.lsp.buf.references()<CR>', opts)
      set_keymap('n', '<Leader>r', '<cmd>lua vim.lsp.buf.rename()<CR>', opts)
      set_keymap('n', '<Leader>a', '<cmd>lua vim.lsp.buf.code_action()<CR>', opts)
      set_keymap('n', '<space>wa', '<cmd>lua vim.lsp.buf.add_workspace_folder()<CR>', opts)
      set_keymap('n', '<space>wr', '<cmd>lua vim.lsp.buf.remove_workspace_folder()<CR>', opts)
      set_keymap('n', '<space>wl', '<cmd>lua print(vim.inspect(vim.lsp.buf.list_workspace_folders()))<CR>', opts)

      if server.name == 'tsserver' then
        local ts_utils = require('nvim-lsp-ts-utils')

        ts_utils.setup({
          debug = false,
          disable_commands = false,
          enable_import_on_completion = false,

          -- import all
          import_all_timeout = 5000, -- ms
          import_all_priorities = {
            same_file = 1, -- add to existing import statement
            local_files = 2, -- git files or files with relative path markers
            buffer_content = 3, -- loaded buffer content
            buffers = 4, -- loaded buffer names
          },
          import_all_scan_buffers = 100,
          import_all_select_source = false,
          always_organize_imports = true,

          -- filter diagnostics
          filter_out_diagnostics_by_severity = {},
          filter_out_diagnostics_by_code = {},

          -- update imports on file move
          update_imports_on_move = false,
          require_confirmation_on_move = false,
          watch_dir = nil,

          -- required to fix code action ranges and filter diagnostics
          ts_utils.setup_client(client)
        })

        set_keymap('n', '<space>o', ':TSLspOrganize<CR>', opts)
      end
    end

    return on_attach
  end

  -- Setup servers
  local installer = require('nvim-lsp-installer')

  installer.on_server_ready(function(server)
    local capabilities = vim.lsp.protocol.make_client_capabilities()
    capabilities = require('cmp_nvim_lsp').update_capabilities(capabilities)

    local opts = {
      on_attach = create_attacher(server),
      capabilities = capabilities,
    }

    server:setup(opts)
  end)

  -- Setup fidget
  require'fidget'.setup {
    text = {
      spinner = 'dots',
    },
  }
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


" lightline configure
let g:lightline = {
  \ 'colorscheme': 'dogrun',
  \ 'active': {
  \   'left': [['mode', 'paste'],
  \             ['branch', 'readonly', 'filename']],
  \   'right': [['lineinfo'],
  \             ['percent'],
  \             ['lsp_status', 'lsp_warnings', 'lsp_errors'],
  \             ['fileformat', 'fileencoding', 'filetype']],
  \ },
  \ 'component': {
  \   'lineinfo': '%3l:%-2v ¶',
  \ },
  \ 'component_expand': {
  \   'lsp_hints': 'lightline#lsp#hints',
  \   'lsp_infos': 'lightline#lsp#infos',
  \   'lsp_warnings': 'lightline#lsp#warnings',
  \   'lsp_errors': 'lightline#lsp#errors',
  \   'lsp_ok': 'lightline#lsp#ok',
  \ },
  \ 'component_type': {
  \   'lsp_hints': 'right',
  \   'lsp_infos': 'right',
  \   'lsp_warnings': 'warning',
  \   'lsp_errors': 'error',
  \   'lsp_ok': 'right',
  \ },
  \ 'component_function': {
  \   'filename': 'LightlineFilename',
  \   'branch': 'LightlineFugitiveBranch',
  \   'readonly': 'LightlineReadonly',
  \ },
  \ 'separator': { 'left': '', 'right': ''},
  \ 'subseparator': { 'left': '❯', 'right': '❮'}
  \ }

let g:lightline#lsp#indicator_warnings = '∙ '
let g:lightline#lsp#indicator_errors = '∙ '

function! LightlineFilename() abort
  let filename = expand('%:t') !=# '' ? expand('%:t') : '[No Name]'
  let modified = &modified ? ' ∙' : ''
  return filename . modified
endfunction

function! LightlineModified(n) abort
  let winnr = tabpagewinnr(a:n)
  return gettabwinvar(a:n, winnr, '&modified') ? '∙' : gettabwinvar(a:n, winnr, '&modifiable') ? '' : '-'
endfunction

function! LightlineReadonly() abort
  if &filetype == "help"
    return ""
  elseif &readonly
    return "\u2b64"
  else
    return ""
  endif
endfunction

function! LightlineFugitiveBranch() abort
  let branch = FugitiveHead()
  return branch !=# '' ? ' '.branch : ''
endfunction

let g:lightline.tabline = {
     \ 'active': [ 'tabnum', 'filename', 'modified' ],
     \ 'inactive': [ 'tabnum', 'filename', 'modified' ]
     \ }

let g:lightline.tabline_subseparator = { 'left': '', 'right': '' }

let g:lightline.tab_component_function = {
     \ 'filename': 'lightline#tab#filename',
     \ 'modified': 'LightlineModified',
     \ 'readonly': 'lightline#tab#readonly',
     \ 'tabnum': 'lightline#tab#tabnum' }


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
      live_grep = wrap_dropdown_opts({}),
      buffers = wrap_dropdown_opts({
        only_cwd = true,
        sort_lastused = true,
        sort_mru = true,
        ignore_current_buffer = true,
      }),
      commands = wrap_dropdown_opts({}),
      command_history = wrap_dropdown_opts({}),
      git_branches = {
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


" Memo List
let g:memolist_path = '~/Dropbox/memolist'
let g:memolist_memo_suffix = "md"
let g:memolist_template_dir_path = '~/dotfiles/templates/memolist'
let g:memolist_delimiter_yaml_start = '---'
let g:memolist_delimiter_yaml_end  = '---'

nnoremap <silent> <Leader>mc :MemoNew<CR>
nnoremap <silent> <Leader>mg :MemoGrep<CR>

" if executable('fzf') && executable('rg')
"   command! FZFMemoList call fzf#run(fzf#wrap('rg', {
"        \ 'source': 'rg --files --color=never --hidden --iglob "!.git" --glob ""',
"        \ 'dir': g:memolist_path,
"        \ }, <bang>0))
"
"   nnoremap <Leader>mp :FZFMemoList<CR>
" endif


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

augroup fugitive_setup
  autocmd!
  autocmd FileType fugitive nnoremap <silent> <buffer> q <C-w>c
augroup END


" GitGutter
let g:gitgutter_sign_added = '∙'
let g:gitgutter_sign_modified = '∙'
let g:gitgutter_sign_removed = '∙'
let g:gitgutter_sign_modified_removed = '∙'

nnoremap \g :GitGutterToggle<CR>


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


" caw (comment out)
let g:caw_no_default_keymappings = 1

nmap <C-k> <Plug>(caw:hatpos:toggle)
vmap <C-k> <Plug>(caw:hatpos:toggle)


" Dart
augroup dart_settings
  autocmd!
  autocmd FileType dart nnoremap <silent> <buffer> <Leader>p :DartFmt<CR>
augroup END


" Go
let g:goimports_simplify_cmd = 'gofumpt'
let g:goimports = 0
let g:goimports_simplify = 1

augroup go_settings
  autocmd!
  autocmd FileType go :highlight goErr cterm=bold ctermfg=214
  autocmd FileType go :match goErr /\<err\>/
  autocmd FileType go nnoremap <silent> <buffer> <Leader>p :GoImportRun<CR>
augroup END


" rust.vim
let g:rustfmt_autosave = 1


" nvim-syntax-info
nmap <silent> <Space>si <Plug>(syntax-info-toggle)


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


" ALE
" global options
let g:ale_open_list = 1
let g:ale_set_loclist = 1
let g:ale_set_quickfix = 0
let g:ale_list_window_size = 5
let g:ale_keep_list_window_open = 0
let g:ale_sign_column_always = 1

let g:ale_sign_warning = '⦿'
let g:ale_sign_error = '⦿'

let g:ale_lint_on_save = 0
let g:ale_lint_on_text_changed = 'normal'
let g:ale_lint_on_filetype_changed = 1
let g:ale_lint_on_enter = 1

let g:ale_fix_on_save = 1

let g:ale_completion_enabled = 0
let g:ale_disable_lsp = 1

let g:ale_linters = {
      \ 'go': ['staticcheck'],
      \ 'markdown': ['textlint'],
      \ 'json': ['jq', 'jsonlint', 'cspell'],
      \ }

let g:ale_linter_aliases = {
      \ 'typescript': ['typescript'],
      \ 'typescriptreact': ['typescript', 'css'],
      \ }

let g:ale_fixers = {
      \ '*': ['remove_trailing_lines', 'trim_whitespace'],
      \ 'markdown': ['prettier'],
      \ 'html': [],
      \ 'css': ['prettier'],
      \ 'less': ['prettier'],
      \ 'scss': ['prettier'],
      \ 'json': ['prettier'],
      \ 'graphql': ['prettier'],
      \ 'vue': ['prettier'],
      \ 'svelte': ['prettier'],
      \ 'yaml': ['prettier'],
      \ 'javascript': ['prettier', 'eslint'],
      \ 'javascriptreact': ['prettier', 'eslint', 'stylelint'],
      \ 'typescript': ['prettier', 'tslint', 'eslint'],
      \ 'typescriptreact': ['prettier', 'tslint', 'eslint', 'stylelint'],
      \ }

let g:ale_javascript_eslint_options = '--no-ignore'
let g:ale_typescript_tslint_use_global = 0
let g:ale_typescript_tslint_config_path = ''

nnoremap <silent> \ll :ALELint<CR>
nnoremap <silent> \lt :ALEToggle<CR>
nnoremap <silent> \lf :ALEFix<CR>
nnoremap <silent> <Leader>p :ALEFix<CR>


" ファイル置換時に BufWritePost 処理をトグル
function! s:enableBufWritePost()
  let g:ale_fix_on_save = 1
  ALEEnable
  GitGutterEnable
endfunction

function! s:disableBufWritePost()
  let g:ale_fix_on_save = 0
  ALEDisable
  GitGutterDisable
endfunction

command! EnableBufWritePost call <SID>enableBufWritePost()
command! DisableBufWritePost call <SID>disableBufWritePost()


" nvim-treesitter
lua << EOF
  require'nvim-treesitter.configs'.setup {
    highlight = {
      enable = true,
    },
  }
EOF


" =============================================================
" Colors
" =============================================================

syntax on
colorscheme dogrun
