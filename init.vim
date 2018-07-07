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


" `%` 移動の拡張
source $VIMRUNTIME/macros/matchit.vim


" <Leader>を`,`に設定
let mapleader = ","


" for tmux
set termguicolors
set t_8b=^[[48;2;%lu;%lu;%lum
set t_8f=^[[38;2;%lu;%lu;%lum<Paste>

" 各種基本設定
language en_US

set encoding=utf-8
set fileencoding=utf-8
set fileencodings=utf-8,cp932,ico-2022-jp,sjis,euc-jp,latin1
set completeopt=menuone
set autoread
set t_ut=
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
" set clipboard=unnamed
set clipboard=unnamed,unnamedplus
set laststatus=2
if ! isdirectory($HOME.'/.config/nvim/swap')
  call mkdir($HOME.'/.config/nvim/swap', 'p')
endif
set directory=~/.config/nvim/swap
set ambiwidth=double
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

" commandモードはEmacs風に
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

" locationlistの移動
nnoremap [w :lprevious<CR>
nnoremap ]w :lnext<CR>
nnoremap [W :<C-u>lfirst<CR>
nnoremap ]W :<C-u>llast<CR>

" ; と :
noremap ; :
noremap : ;
noremap @; @:
noremap @: @;

" Toggle系オプション
nnoremap <silent> \w :<C-u>setl wrap! wrap?<CR>
nnoremap <silent> \s :call <SID>toggle_syntax()<CR>
nnoremap <silent> \h :<C-u>setl hlsearch!<CR>

function! s:toggle_syntax() abort
  if exists('g:syntax_on')
    syntax off
    redraw
    echo 'syntax off'
  else
    syntax on
    redraw
    echo 'syntax on'
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


" QuickFix の設定
augroup QuickfixConfigure
  autocmd!

  " help & QuickFix を q だけで閉じる
  autocmd FileType help nnoremap <buffer> q <C-w>c
  autocmd FileType qf nnoremap <buffer> q <C-w>c

  " QuickFix は折り返しを無効化する
  autocmd FileType qf setlocal nowrap

  " QuickFix を自動で開く
  autocmd QuickfixCmdPost make,grep,grepadd,vimgrep,vim,**grep** if len(getqflist()) != 0 | copen | endif
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


" </で閉じタグを自動補完
autocmd! FileType html inoremap <silent> <buffer> </ </<C-x><C-o>


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


" タブの操作/移動
" http://qiita.com/wadako111/items/755e753677dd72d8036d

" Anywhere SID.
function! s:SID_PREFIX()
  return matchstr(expand('<sfile>'), '<SNR>\d\+_\zeSID_PREFIX$')
endfunction

" Set tabline.
set showtabline=2 " 常にタブラインを表示

" The prefix key.
nnoremap    [Tag]   <Nop>
nmap    t [Tag]

" Tab jump
" t1 で1番左のタブ、t2 で1番左から2番目のタブにジャンプ
for n in range(1, 9)
  execute 'nnoremap <silent> [Tag]'.n  ':<C-u>tabnext'.n.'<CR>'
endfor


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
nnoremap sr <C-w>r
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

" terminal
function! TermHelper(...) abort
  let h_or_v = get(a:, 1, 'h')

  if h_or_v == 'h'
    topleft split | Eterminal
  else
    topleft vsplit | Eterminal
  endif
endfun

command! Hterminal :call TermHelper('h')
command! Vterminal :call TermHelper('v')
command! Eterminal :terminal

" open terminal
nnoremap <silent> <Leader>tt :Eterminal<CR>
nnoremap <silent> <Leader>ts :Hterminal<CR>
nnoremap <silent> <Leader>tv :Vterminal<CR>

tnoremap <silent> <Leader>tt <C-\><C-n>:Eterminal<CR>
tnoremap <silent> <Leader>ts <C-\><C-n>:Hterminal<CR>
tnoremap <silent> <Leader>tv <C-\><C-n>:Vterminal<CR>

" close terminal
tnoremap <C-[><C-v> <C-\><C-n>
tnoremap <C-[><C-[> <C-\><C-n>:q<CR>

" 前後タブの移動
tnoremap <C-[><C-n> <C-\><C-n>:tabnext<CR>
tnoremap <C-[><C-p> <C-\><C-n>:tabprevious<CR>
tnoremap <C-[><C-t> <C-\><C-n>:tabnew<CR>

" 上下左右
tnoremap <C-[><C-h> <C-\><C-n><C-w>h
tnoremap <C-[><C-j> <C-\><C-n><C-w>j
tnoremap <C-[><C-k> <C-\><C-n><C-w>k
tnoremap <C-[><C-l> <C-\><C-n><C-w>l
tnoremap <C-[>J <C-\><C-n><C-w>J
tnoremap <C-[>K <C-\><C-n><C-w>K
tnoremap <C-[>H <C-\><C-n><C-w>H
tnoremap <C-[>L <C-\><C-n><C-w>L

" タブサイズ
tnoremap <C-[>= <C-\><C-n><C-w>=



" =============================================================
" Filetypes
" =============================================================
augroup fileTypeDetect
  autocmd BufRead,BufNew,BufNewFile *.ts set filetype=typescript
  autocmd BufRead,BufNew,BufNewFile *.tsx set filetype=typescript
  autocmd BufRead,BufNew,BufNewFile *.js.flow set filetype=typescript

  autocmd BufRead,BufNew,BufNewFile gitconfig setlocal ft=gitconfig
  autocmd BufRead,BufNew,BufNewFile .eslintrc setlocal ft=json
  autocmd BufRead,BufNew,BufNewFile .stylelintrc setlocal ft=json
  autocmd BufRead,BufNew,BufNewFile .babelrc setlocal ft=json
augroup END

augroup fileTypeIndent
  autocmd!
  autocmd BufNewFile,BufRead *.php setlocal tabstop=4 softtabstop=4 shiftwidth=4
  autocmd BufNewFile,BufRead *.blade.php setlocal tabstop=2 softtabstop=2 shiftwidth=2
augroup END




" =============================================================
" Plugins
" =============================================================

if &compatible
  set nocompatible
endif

" dein configurations.
let g:dein#install_max_processes = 48
let g:dein#install_progress_type = 'echo'
let g:dein#install_message_type = 'echo'
let g:dein#enable_notification = 1

augroup PluginInstall
  autocmd!
  autocmd VimEnter * if dein#check_install() | call dein#install() | endif
augroup END
command! -nargs=0 PluginUpdate call dein#update()

let s:plugin_dir = expand('~/.config/nvim/bundle/')
let s:dein_dir = s:plugin_dir . 'repos/github.com/Shougo/dein.vim'
execute 'set runtimepath+=' . s:dein_dir

if !isdirectory(s:dein_dir)
  call mkdir(s:dein_dir, 'p')
  silent execute printf('!git clone %s %s', 'https://github.com/Shougo/dein.vim', s:dein_dir)
endif

if dein#load_state(s:plugin_dir)
  call dein#begin(s:plugin_dir)
  call dein#add('Shougo/dein.vim')
  call dein#add('mattn/benchvimrc-vim', {'lazy': 1, 'on_cmd': ['BenchVimrc']})

  " vim-scripts
  call dein#add('vim-scripts/sudo.vim', {'lazy': 1})

  " base
  call dein#add('vim-jp/vimdoc-ja')
  call dein#add('Shougo/vimproc.vim', {'build' : 'make'})
  call dein#add('jremmen/vim-ripgrep')
  call dein#add('mattn/webapi-vim')

  " deoplete
  call dein#add('Shougo/deoplete.nvim')

  " deoplete - lang
  call dein#add('zchee/deoplete-go', {'on_ft': 'go'})
  call dein#add('rudism/deoplete-tsuquyomi', {'on_ft': 'typescript'})

  " Language Server Protocol
  call dein#add('autozimu/LanguageClient-neovim', {
        \ 'rev': 'next',
        \ 'build': 'bash install.sh',
        \ })

  " unite
  call dein#add('Shougo/unite.vim')

  " editing
  call dein#add('mattn/emmet-vim')
  call dein#add('tpope/vim-surround')
  call dein#add('thinca/vim-visualstar')
  call dein#add('editorconfig/editorconfig-vim')
  call dein#add('h1mesuke/vim-alignta')
  call dein#add('kana/vim-submode')
  call dein#add('tyru/caw.vim.git')
  call dein#add('deton/jasegment.vim')
  call dein#add('thinca/vim-qfreplace')
  call dein#add('jceb/vim-editqf')
  call dein#add('rhysd/clever-f.vim')
  call dein#add('easymotion/vim-easymotion')
  call dein#add('haya14busa/incsearch.vim')
  call dein#add('haya14busa/incsearch-fuzzy.vim')

  " debug
  call dein#add('thinca/vim-quickrun')

  " filer
  call dein#add('Shougo/vimfiler', {'depends': 'Shougo/unite.vim'})
  call dein#add('junegunn/fzf', {'build': './install --all'})
  call dein#add('junegunn/fzf.vim')

  " formatter
  call dein#add('prettier/vim-prettier', {
    \ 'on_ft': ['javascript', 'typescript', 'css', 'less', 'scss', 'json', 'graphql', 'markdown'],
    \ 'lazy': 1,
    \ })

  " sign
  call dein#add('airblade/vim-gitgutter')
  call dein#add('cohama/agit.vim')

  " git
  call dein#add('tpope/vim-fugitive')
  call dein#add('tyru/open-browser.vim', {'lazy': 1})

  " memo
  call dein#add('glidenote/memolist.vim', {
    \ 'lazy': 1,
    \ 'on_cmd': ['MemoNew', 'MemoList'],
    \ })

  " toml
  call dein#add('cespare/vim-toml',  {'on_ft' : 'toml', 'lazy': 1})

  " markdown
  call dein#add('plasticboy/vim-markdown', {'on_ft': ['markdown', 'md']})
  call dein#add('tukiyo/previm', {'on_ft': ['markdown', 'md']})
  call dein#add('dhruvasagar/vim-table-mode', {'on_ft': ['markdown', 'md']})
  call dein#add('rhysd/vim-gfm-syntax', {'on_ft': ['markdown', 'md']})
  call dein#add('mzlogin/vim-markdown-toc', {'on_ft': ['markdown', 'md']})

  " coffee
  call dein#add('kchmck/vim-coffee-script', {'on_ft' : 'coffee'})

  " typescript
  call dein#add('leafgarland/typescript-vim')
  call dein#add('mhartington/nvim-typescript', {'build': './install.sh'})

  " flow
  call dein#add('flowtype/vim-flow', {'on_ft': 'javascript'})

  " javascript
  call dein#add('jason0x43/vim-js-indent', {'on_ft': ['javascript', 'typescript']})
  call dein#add('pangloss/vim-javascript', {'on_ft': 'javascript'})
  call dein#add('chemzqm/vim-jsx-improve', {'on_ft': ['javascript', 'typescript']})
  call dein#add('heavenshell/vim-syntax-flowtype', {'on_ft': ['javascript']})

  " PHP
  call dein#add('jwalton512/vim-blade', {'on_ft': 'php'})

  " golang
  call dein#add('fatih/vim-go', {'on_ft': 'go'})

  " Rust
  call dein#add('rust-lang/rust.vim')

  " statusline
  call dein#add('itchyny/lightline.vim')

  " syntax checking
  call dein#add('w0rp/ale')

  " syntax
  call dein#add('Shougo/context_filetype.vim')
  call dein#add('hail2u/vim-css3-syntax', {'on_ft': 'css'})
  call dein#add('othree/html5.vim', {'on_ft': 'html'})
  call dein#add('nikvdp/ejs-syntax', {'on_ft': 'ejs'})
  call dein#add('digitaltoad/vim-jade', {'on_ft': 'jade'})
  call dein#add('cakebaker/scss-syntax.vim', {'on_ft': 'scss'})

  " editor
  call dein#add('junegunn/goyo.vim', {
    \ 'lazy': 1,
    \ 'on_cmd': ['Goyo'],
    \ })

  " colorschema
  call dein#add('rhysd/vim-color-spring-night')
  call dein#add('rakr/vim-one')

  call dein#end()
  call dein#save_state()
endif

if dein#check_install()
  call dein#install()
endif

filetype plugin indent on
syntax enable


" 画面分割用のキーマップ
" http://qiita.com/tekkoc/items/98adcadfa4bdc8b5a6ca
nnoremap sT :<C-u>Unite tab<CR>
nnoremap sb :<C-u>Unite buffer_tab -buffer-name=file<CR>
nnoremap sB :<C-u>Unite buffer -buffer-name=file<CR>
nnoremap sF :<C-u>Unite -buffer-name=file file<CR>

call submode#enter_with('bufmove', 'n', '', 's>', '<C-w>>')
call submode#enter_with('bufmove', 'n', '', 's<', '<C-w><')
call submode#enter_with('bufmove', 'n', '', 's+', '<C-w>+')
call submode#enter_with('bufmove', 'n', '', 's-', '<C-w>-')
call submode#map('bufmove', 'n', '', '>', '<C-w>>')
call submode#map('bufmove', 'n', '', '<', '<C-w><')
call submode#map('bufmove', 'n', '', '+', '<C-w>+')


" deoplete
let g:deoplete#enable_at_startup = 1
let g:deoplete#enable_smart_case = 1
let g:deoplete#file#enable_buffer_path = 1
let g:deoplete#max_menu_width = 60

" close popup and delete backword char
inoremap <expr><C-h> deoplete#smart_close_popup()."\<C-h>"
inoremap <expr><BS> deoplete#smart_close_popup()."\<C-h>"

" close popup and save indent
inoremap <silent> <CR> <C-r>=<SID>my_cr_function()<CR>
function! s:my_cr_function() abort
  return deoplete#close_popup() . "\<CR>"
endfunction


" lightline my theme
let s:p = {'normal': {}, 'inactive': {}, 'insert': {}, 'replace': {}, 'visual': {}, 'tabline': {}}

let s:nordext0 = ["#2E3440", "NONE"]
let s:nordext1 = ["#3B4252", 0]
let s:nordext2 = ["#434C5E", "NONE"]
let s:nordext3 = ["#2C323D", 8]
let s:nordext4 = ["#D8DEE9", "NONE"]
let s:nordext5 = ["#ECEFF4", 7]
let s:nordext6 = ["#ECEFF4", 15]
let s:nordext7 = ["#8FBCBB", 14]
let s:nordext8 = ["#88C0D0", 6]
let s:nordext9 = ["#81A1C1", 4]
let s:nordext10 = ["#5E81AC", 12]
let s:nordext11 = ["#BF616A", 1]
let s:nordext12 = ["#D08770", 11]
let s:nordext13 = ["#EBCB8B", 3]
let s:nordext14 = ["#A3BE8C", 2]
let s:nordext15 = ["#B48EAD", 5]

let s:p.normal.left = [ [ s:nordext1, s:nordext8 ], [ s:nordext5, s:nordext1 ] ]
let s:p.normal.middle = [ [ s:nordext5, s:nordext3 ] ]
let s:p.normal.right = [ [ s:nordext5, s:nordext1 ], [ s:nordext5, s:nordext1 ] ]
let s:p.normal.warning = [ [ s:nordext1, s:nordext13 ] ]
let s:p.normal.error = [ [ s:nordext1, s:nordext11 ] ]

let s:p.inactive.left =  [ [ s:nordext1, s:nordext8 ], [ s:nordext5, s:nordext1 ] ]
let s:p.inactive.middle = [ [ s:nordext5, s:nordext1 ] ]
let s:p.inactive.right = [ [ s:nordext5, s:nordext1 ], [ s:nordext5, s:nordext1 ] ]

let s:p.insert.left = [ [ s:nordext1, s:nordext6 ], [ s:nordext5, s:nordext1 ] ]
let s:p.replace.left = [ [ s:nordext1, s:nordext13 ], [ s:nordext5, s:nordext1 ] ]
let s:p.visual.left = [ [ s:nordext1, s:nordext7 ], [ s:nordext5, s:nordext1 ] ]

let s:p.tabline.left = [ [ s:nordext5, s:nordext3 ] ]
let s:p.tabline.middle = [ [ s:nordext5, s:nordext3 ] ]
let s:p.tabline.right = [ [ s:nordext5, s:nordext3 ] ]
let s:p.tabline.tabsel = [ [ s:nordext1, s:nordext8 ] ]

let g:lightline#colorscheme#nordext#palette = lightline#colorscheme#flatten(s:p)

" lightline configure
let g:lightline = {
  \ 'colorscheme': 'nordext',
  \ 'active': {
  \   'left': [ [ 'mode', 'paste' ],
  \             [ 'fugitive', 'readonly', 'filename' ] ],
  \ },
  \ 'component_function': {
  \   'filename': 'LightLineFilename',
  \   'fugitive': 'LightLineFugitive',
  \   'readonly': 'LightLineReadonly',
  \ },
  \ 'separator': { 'left': "\u2b80", 'right': "\u2b82" },
  \ 'subseparator': { 'left': "\u2b81", 'right': "\u2b83" }
  \ }

function! LightLineFilename()
  let filename = expand('%:t') !=# '' ? expand('%:t') : '[No Name]'
  let modified = &modified ? ' ∙' : ''
  return filename . modified
endfunction

function! LightLineReadonly()
  if &filetype == "help"
    return ""
  elseif &readonly
    return "\u2b64"
  else
    return ""
  endif
endfunction

function! LightLineFugitive()
  if exists("*fugitive#head")
    let branch = fugitive#head()
    return branch !=# '' ? "\u2b60 ".branch : ''
  endif
  return ''
endfunction


" QuickRun
let g:quickrun_no_default_key_mappings = 1

nnoremap <silent><Leader>q :<C-u>QuickRun<CR>
vnoremap <silent><Leader>q :QuickRun<CR>


" Clever-f
let g:clever_f_smart_case = 1
let g:clever_f_across_no_line = 1
let g:clever_f_fix_key_direction = 1
let g:clever_f_repeat_last_char_inputs = []


" VimFiler
let g:vimfiler_as_default_explorer = 1
let g:vimfiler_safe_mode_by_default = 0
let g:vimfiler_ignore_pattern = ['^\.git$', '^\.DS_Store$']

nnoremap <C-N> :VimFiler -split -simple -winwidth=35 -toggle -no-quit<CR>
nnoremap <C-H> :VimFilerBufferDir -split -simple -winwidth=35 -toggle -no-quit<CR>

augroup vimfiler
  autocmd!
  autocmd FileType vimfiler call s:vimfiler_settings()
augroup END

function! s:vimfiler_settings()
  nnoremap <silent><buffer><expr> t vimfiler#do_switch_action('tabopen')
endfunction


" fzf
if executable('fzf')
  let g:fzf_buffers_jump = 1
  let g:fzf_layout = {'down': '~25%'}
  let g:fzf_action = {
        \ 'ctrl-t': 'tab split',
        \ 'ctrl-x': 'split',
        \ 'ctrl-v': 'vsplit' }

  if executable('rg')
    command! FZFFileList call fzf#run(fzf#wrap('rg', {
          \ 'source': 'rg --files --color=never --hidden --iglob "!.git" --glob ""',
          \ }, <bang>0))
  endif

  nnoremap <silent> <C-p> :FZFFileList<CR>
  nnoremap <silent> <Leader>b :Buffers<CR>
  nnoremap <silent> <Leader>; :History:<CR>
  nnoremap <silent> <Leader>: :History:<CR>
endif


" easymotion
let g:EasyMotion_do_mapping = 0
let g:EasyMotion_smartcase = 1

map <Leader> <Plug>(easymotion-prefix)
nmap <Leader>f <Plug>(easymotion-overwin-f)
xmap <Leader>f <Plug>(easymotion-s)
map <Leader>j <Plug>(easymotion-j)
map <Leader>k <Plug>(easymotion-k)


" incsearch
map /  <Plug>(incsearch-forward)
map ?  <Plug>(incsearch-backward)
map g/ <Plug>(incsearch-stay)


" incsearch-fuzzy
map z/ <Plug>(incsearch-fuzzy-/)
map z? <Plug>(incsearch-fuzzy-?)
map zg/ <Plug>(incsearch-fuzzy-stay)


" fugitive
nnoremap <silent> <Leader>gs :Gstatus<CR>
nnoremap <silent> <Leader>gd :Gdiff<CR>


" GitGutter
let g:gitgutter_sign_added = '∙'
let g:gitgutter_sign_modified = '∙'
let g:gitgutter_sign_removed = '∙'
let g:gitgutter_sign_modified_removed = '∙'

nnoremap \g :GitGutterToggle<CR>


" Agit
nnoremap <silent> <Leader>gl :Agit<CR>
nnoremap <silent> <Leader>gf :AgitFile<CR>


" Memo List
let g:memolist_path = '~/Dropbox/memolist'
let g:memolist_memo_suffix = "md"
let g:memolist_template_dir_path = "~/dotfiles/templates/memolist"
let g:memolist_delimiter_yaml_start = '---'
let g:memolist_delimiter_yaml_end  = '---'

nnoremap <Leader>mc :MemoNew<CR>
nnoremap <Leader>ml :MemoList<CR>
nnoremap <Leader>mg :MemoGrep<CR>

if executable('fzf') && executable('rg')
  command! FZFMemoList call fzf#run(fzf#wrap('rg', {
        \ 'source': 'rg --files --color=never --hidden --iglob "!.git" --glob ""',
        \ 'dir': g:memolist_path,
        \ }, <bang>0))

  nnoremap <Leader>mp :FZFMemoList<CR>
endif


" caw
nmap <C-K> <Plug>(caw:hatpos:toggle)
vmap <C-K> <Plug>(caw:hatpos:toggle)


" Emmet
let g:user_emmet_mode = 'iv'
let g:user_emmet_leader_key = '<C-e>'
let g:use_emmet_complete_tag = 1
let g:user_emmet_settings = {
  \ 'lang' : 'ja',
  \ 'html' : {
  \   'filters' : 'html',
  \   'snippets' : {
  \      'html:5' : "<!DOCTYPE html>\n"
  \               ."<html lang=\"ja\">\n"
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
let g:previm_open_cmd = 'open -a Google\ Chrome'
let g:vim_markdown_folding_disabled=1
let g:previm_disable_default_css = 1
let g:previm_custom_css_path = '~/dotfiles/templates/previm/markdown.css'


" TypeScript
autocmd FileType typescript let b:caw_oneline_comment = '//'
autocmd FileType typescript let b:caw_wrap_oneline_comment = ['/*', '*/']

" nvim-typescript
augroup TSSettings
  autocmd!
  autocmd FileType typescript nnoremap <buffer> <Leader>i :TSType<CR>
  autocmd FileType typescript nnoremap <buffer> <C-]> :TSDef<CR>
  autocmd FileType typescript nnoremap <buffer> <C-^> :TSRefs<CR>
  autocmd FileType typescript nnoremap <buffer> <F2> :TSRename
augroup END


" vim-go
let g:go_fmt_command = "goimports"
let g:go_highlight_functions = 1
let g:go_highlight_methods = 1
let g:go_highlight_structs = 1
let g:go_highlight_operators = 1
let g:go_term_enabled = 1
let g:go_highlight_build_constraints = 1

augroup GolangSettings
  autocmd!
  autocmd FileType go :highlight goErr cterm=bold ctermfg=214
  autocmd FileType go :match goErr /\<err\>/
  autocmd FileType go nnoremap <silent> <buffer> <C-^> :GoReferrers<CR>
  autocmd FileType go nnoremap <silent> <buffer> <Leader>i :GoInfo<CR>
augroup END


" LanguageClient
let g:LanguageClient_selectionUI = 'location-list'


" rust.vim
let g:rustfmt_autosave = 1

" rust - rls
let g:LanguageClient_serverCommands = {
    \ 'rust': ['rustup', 'run', 'nightly', 'rls'],
    \ }

augroup RustSettings
  autocmd!
  autocmd FileType rust nnoremap <silent> <buffer> <C-]> :call LanguageClient#textDocument_definition()<CR>
  autocmd FileType rust nnoremap <silent> <buffer> <C-^> :call LanguageClient#textDocument_references()<CR>
  autocmd FileType rust nnoremap <silent> <buffer> <Leader>i :call LanguageClient#textDocument_hover()<CR>
  autocmd FileType rust nnoremap <silent> <buffer> <F2> :call LanguageClient#textDocument_rename()<CR>
augroup END


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
let g:ale_open_list = 1
let g:ale_set_loclist = 1
let g:ale_set_quickfix = 0
let g:ale_sign_column_always = 1
let g:ale_list_window_size = 5
let g:ale_keep_list_window_open = 0

let g:ale_sign_warning = '▲'
let g:ale_sign_error = '✗'

let g:ale_lint_on_save = 1
let g:ale_lint_on_text_changed = 'never'
let g:ale_lint_on_filetype_changed = 0
let g:ale_lint_on_enter = 0

let g:ale_linters = {
\   'html': [],
\   'go': ['gometalinter', 'gofmt'],
\   'typescript': ['tslint', 'tsserver', 'typecheck'],
\}

let g:ale_javascript_eslint_options = '--no-ignore'

let g:ale_go_gometalinter_options = '--fast --enable=goimports --enable=gosimple --enable=unused --enable=staticcheck'

nnoremap \b :ALEToggleBuffer<CR>



" =============================================================
" Colors
" =============================================================

" Colorschemeの設定
syntax on
set background=dark
colorscheme one
" colorscheme spring-night
