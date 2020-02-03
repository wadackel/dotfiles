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
set completeopt=menuone,preview
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
set clipboard=unnamed
set laststatus=2
if ! isdirectory($HOME.'/.vim/swap')
  call mkdir($HOME.'/.vim/swap', 'p')
endif
set directory=~/.vim/swap
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
  set grepprg=rg\ --vimgrep\ --no-heading
  set grepformat=%f:%l:%c:%m,%f:%l:%m
endif


" =============================================================
" Filetypes
" =============================================================
augroup fileTypeDetect
  autocmd BufRead,BufNew,BufNewFile *.ts set filetype=typescript
  autocmd BufRead,BufNew,BufNewFile *.tsx set filetype=typescript.tsx
  autocmd BufRead,BufNew,BufNewFile *.mdx set filetype=markdown
  autocmd BufRead,BufNew,BufNewFile *.ejs setlocal ft=html

  autocmd BufRead,BufNew,BufNewFile gitconfig setlocal ft=gitconfig
  autocmd BufRead,BufNew,BufNewFile .eslintrc setlocal ft=json
  autocmd BufRead,BufNew,BufNewFile .stylelintrc setlocal ft=json
  autocmd BufRead,BufNew,BufNewFile .prettierrc setlocal ft=json
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

call plug#begin('~/.vim/plugged')

" vim-scripts
Plug 'vim-scripts/sudo.vim'

" base
Plug 'mattn/webapi-vim'

" completion
" Plug 'prabirshrestha/async.vim'
" Plug 'prabirshrestha/asyncomplete.vim'
" Plug 'prabirshrestha/asyncomplete-lsp.vim'
" Plug 'prabirshrestha/asyncomplete-file.vim'
" Plug 'prabirshrestha/asyncomplete-buffer.vim'
" Plug 'prabirshrestha/vim-lsp'
" Plug 'mattn/vim-lsp-settings'
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'neoclide/coc-json', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-html', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-css', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-rls', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-yaml', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-yank', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-tsserver', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-tslint-plugin', {'do': 'yarn --frozen-lockfile'}
Plug 'iamcco/coc-flutter', {'do': 'yarn --frozen-lockfile'}

" editing
Plug 'mattn/emmet-vim'
Plug 'andymass/vim-matchup'
Plug 'machakann/vim-sandwich'
Plug 'editorconfig/editorconfig-vim'
Plug 'h1mesuke/vim-alignta'
Plug 'kana/vim-submode'
Plug 'https://github.com/tyru/caw.vim.git'
Plug 'tpope/vim-commentary'
Plug 'deton/jasegment.vim'
Plug 'thinca/vim-qfreplace'
Plug 'jceb/vim-editqf'
Plug 'rhysd/clever-f.vim'
Plug 'haya14busa/vim-asterisk'
Plug 'haya14busa/is.vim'
Plug 'easymotion/vim-easymotion'

" debug
Plug 'thinca/vim-quickrun'

" filer
" Plug 'lambdalisue/fern.vim'
Plug 'kristijanhusak/defx-git'
Plug 'kristijanhusak/defx-icons'
Plug 'Shougo/defx.nvim', { 'do': ':UpdateRemotePlugins' }
Plug 'ryanoasis/vim-devicons'
Plug 'liuchengxu/vim-clap', { 'do': ':Clap install-binary' }
Plug 'junegunn/fzf', {'do': './install --all'}
Plug 'junegunn/fzf.vim'

" formatter
Plug 'prettier/vim-prettier', { 'for': ['javascript', 'typescript', 'typescript.tsx', 'css', 'less', 'scss', 'json', 'graphql', 'markdown', 'html'] }

" sign
Plug 'airblade/vim-gitgutter'
Plug 'cohama/agit.vim'

" git
Plug 'tpope/vim-fugitive'
Plug 'rhysd/conflict-marker.vim'
Plug 'APZelos/blamer.nvim'
Plug 'tyru/open-browser.vim'

" memo
Plug 'glidenote/memolist.vim', {'on': ['MemoNew', 'MemoList']}

" javascript
Plug 'pangloss/vim-javascript', {'for': 'javascript'}
Plug 'chemzqm/vim-jsx-improve', {'for': ['javascript', 'typescript', 'typescript.tsx']}
Plug 'heavenshell/vim-syntax-flowtype', {'for': ['javascript']}

" typescript
Plug 'HerringtonDarkholme/yats.vim'

" golang
Plug 'fatih/vim-go', {'for': 'go'}

" Rust
Plug 'rust-lang/rust.vim'

" HTML
Plug 'othree/html5.vim', {'for': 'html'}

" Stylesheet (CSS / Sass)
Plug 'hail2u/vim-css3-syntax', {'for': 'css'}
Plug 'cakebaker/scss-syntax.vim', {'for': 'scss'}

" markdown
Plug 'plasticboy/vim-markdown', {'for': ['markdown', 'md']}
Plug 'tukiyo/previm', {'for': ['markdown', 'md']}
Plug 'iamcco/markdown-preview.nvim', {'do': { -> mkdp#util#install() }}
Plug 'dhruvasagar/vim-table-mode', {'for': ['markdown', 'md']}
Plug 'rhysd/vim-gfm-syntax', {'for': ['markdown', 'md']}
Plug 'mzlogin/vim-markdown-toc', {'for': ['markdown', 'md']}

" toml
Plug 'cespare/vim-toml',  {'for' : 'toml'}

" Flutter
Plug 'dart-lang/dart-vim-plugin'

" varnish
Plug 'fgsch/vim-varnish'

" statusline
Plug 'itchyny/lightline.vim'

" syntax checking
Plug 'w0rp/ale'

" syntax extention
Plug 'Shougo/context_filetype.vim'

" colorschema
Plug 'rakr/vim-one'
" Plug 'wadackel/vim-dogrun'
Plug 'rhysd/vim-color-spring-night'
Plug 'wadackel/nvim-syntax-info'

" development
Plug '~/develop/github.com/wadackel/vim-dogrun'

call plug#end()


" " vim-lsp x asyncomplete
" let g:lsp_signs_enabled = 1
" let g:lsp_text_edit_enabled = 1
" let g:lsp_highlight_references_enabled = 1
" let g:lsp_diagnostics_echo_cursor = 1
" let g:lsp_fold_enabled = 0
" let g:lsp_semantic_enabled = 1
" let g:asyncomplete_popup_delay = 80
" " let g:lsp_log_file = expand('~/vim-lsp.log')
"
" function! s:on_lsp_buffer_enabled() abort
"   setlocal omnifunc=lsp#complete
"   setlocal signcolumn=yes
"
"   inoremap <expr> <CR> pumvisible() ? "\<C-y>\<CR>" : "\<CR>"
"
"   nmap <silent> <buffer> <C-]> <Plug>(lsp-definition)
"   nmap <silent> <buffer> <Leader>a <Plug>(lsp-code-action)
"   nmap <silent> <buffer> <C-^> <Plug>(lsp-references)
"   nmap <silent> <buffer> <Leader>i <Plug>(lsp-hover)
"   nmap <silent> <buffer> <f2> <Plug>(lsp-rename)
"   nmap <silent> <buffer> [g <Plug>(lsp-previous-diagnostic)
"   nmap <silent> <buffer> ]g <Plug>(lsp-next-diagnostic)
" endfunction
"
" augroup lsp_install
"   au!
"   autocmd User lsp_buffer_enabled call s:on_lsp_buffer_enabled()
" augroup END


" coc.nvim

" Use `[g` and `]g` to navigate diagnostics
nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)

" Use <CR> to confirm completion, `<C-g>u` means break undo chain at current position.
" Coc only does snippet and additional edit on confirm.
inoremap <expr> <CR> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"

" Remap keys for gotos
autocmd! FileType rust,go,c,javascript,typescript,typescript.tsx nmap <silent> <buffer> <C-]> <Plug>(coc-definition)
nnoremap <silent> <C-w><C-]> :<C-u>execute "split \| call CocActionAsync('jumpDefinition')"<CR>
nmap <silent> K <Plug>(coc-type-definition)
nmap <silent> <C-^> <Plug>(coc-references)
nmap <silent> <Leader>a <Plug>(coc-codeaction)
nmap <silent> <Leader>r <Plug>(coc-refactor)

" Remap for rename current word
nmap <F2> <Plug>(coc-rename)

" Show documentation in preview window
function! s:show_documentation()
  if (index(['vim','help'], &filetype) >= 0)
    execute 'h '.expand('<cword>')
  else
    call CocAction('doHover')
  endif
endfunction

nnoremap <silent> <Leader>i :call <SID>show_documentation()<CR>

" Use <CR> to confirm completion, `<C-g>u` means break undo chain at current position.
" Coc only does snippet and additional edit on confirm.
inoremap <expr> <CR> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"

" Highlight symbol under cursor on CursorHold
autocmd CursorHold * silent call CocActionAsync('highlight')

" diagnostics
nnoremap <silent> <space>d :<C-u>CocList diagnostics<CR>

" yank
nnoremap <silent> <space>y :<C-u>CocList -A --normal yank<CR>


" 画面分割用のキーマップ
call submode#enter_with('bufmove', 'n', '', 's>', '<C-w>>')
call submode#enter_with('bufmove', 'n', '', 's<', '<C-w><')
call submode#enter_with('bufmove', 'n', '', 's+', '<C-w>+')
call submode#enter_with('bufmove', 'n', '', 's-', '<C-w>-')
call submode#map('bufmove', 'n', '', '>', '<C-w>>')
call submode#map('bufmove', 'n', '', '<', '<C-w><')
call submode#map('bufmove', 'n', '', '+', '<C-w>+')


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
 \             ['fugitive', 'readonly', 'filename']],
 \   'right': [['lineinfo'],
 \             ['percent'],
 \             ['fileformat', 'fileencoding', 'filetype', 'cocstatus']],
 \ },
 \ 'component': {
 \   'lineinfo': '%3l:%-2v ¶',
 \ },
 \ 'component_function': {
 \   'filename': 'LightLineFilename',
 \   'fugitive': 'LightLineFugitive',
 \   'readonly': 'LightLineReadonly',
 \   'cocstatus': 'coc#status',
 \ },
 \ 'separator': { 'left': '', 'right': ''},
 \ 'subseparator': { 'left': '❯', 'right': '❮'}
 \ }

function! LightLineFilename()
  let filename = expand('%:t') !=# '' ? expand('%:t') : '[No Name]'
  let modified = &modified ? ' ∙' : ''
  return filename . modified
endfunction

function! LightlineModified(n) abort
  let winnr = tabpagewinnr(a:n)
  return gettabwinvar(a:n, winnr, '&modified') ? '∙' : gettabwinvar(a:n, winnr, '&modifiable') ? '' : '-'
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
  let branch = fugitive#head()
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


" defx
let g:WebDevIconsUnicodeDecorateFolderNodes = 1


call defx#custom#option('_', {
      \ 'columns': 'git:indent:icons:filename:type',
      \ 'ignored_files': '.DS_Store,.git',
      \ })

call defx#custom#column('git', 'indicators', {
     \ 'Modified'  : '∙',
     \ 'Staged'    : '∙',
     \ 'Untracked' : '∙',
     \ 'Renamed'   : '➜',
     \ 'Unmerged'  : '═',
     \ 'Ignored'   : '∙',
     \ 'Deleted'   : '✖',
     \ 'Unknown'   : '?'
     \ })

call defx#custom#option('_', {
     \ 'root_marker': ':',
     \ })

call defx#custom#column('filename', {
     \ 'root_marker_highlight': 'Ignore',
     \ })

nnoremap <silent><C-j> :Defx `expand('%:p:h')` -search=`expand('%:p')` -toggle -split=vertical -winwidth=40 -direction=topleft<CR>

autocmd FileType defx call s:defx_my_settings()
function! s:defx_my_settings() abort
  " Define mappings
  nnoremap <silent><buffer><expr> <CR> defx#do_action('drop')
  nnoremap <silent><buffer><expr> l defx#do_action('drop')
  nnoremap <silent><buffer><expr> c defx#do_action('copy')
  nnoremap <silent><buffer><expr> m defx#do_action('move')
  nnoremap <silent><buffer><expr> p defx#do_action('paste')
  nnoremap <silent><buffer><expr> E defx#do_action('multi', [['drop', 'vsplit'], 'quit'])
  nnoremap <silent><buffer><expr> P defx#do_action('open', 'pedit')
  nnoremap <silent><buffer><expr> t defx#do_action('open', 'tabe')
  nnoremap <silent><buffer><expr> o defx#do_action('open_or_close_tree')
  nnoremap <silent><buffer><expr> K defx#do_action('new_directory')
  nnoremap <silent><buffer><expr> N defx#do_action('new_file')
  nnoremap <silent><buffer><expr> M defx#do_action('new_multiple_files')
  nnoremap <silent><buffer><expr> C defx#do_action('toggle_columns', 'mark:indent:icon:filename:type:size:time')
  nnoremap <silent><buffer><expr> d defx#do_action('remove')
  nnoremap <silent><buffer><expr> r defx#do_action('rename')
  nnoremap <silent><buffer><expr> ! \ defx#do_action('execute_command')
  nnoremap <silent><buffer><expr> x defx#do_action('execute_system')
  nnoremap <silent><buffer><expr> yy defx#do_action('yank_path')
  nnoremap <silent><buffer><expr> . defx#do_action('toggle_ignored_files')
  nnoremap <silent><buffer><expr> h defx#do_action('cd', ['..'])
  nnoremap <silent><buffer><expr> ~ defx#do_action('cd')
  nnoremap <silent><buffer><expr> q defx#do_action('quit')
  nnoremap <silent><buffer><expr> <Space> defx#do_action('toggle_select') . 'j'
  nnoremap <silent><buffer><expr> * defx#do_action('toggle_select_all')
  nnoremap <silent><buffer><expr> j line('.') == line('$') ? 'gg' : 'j'
  nnoremap <silent><buffer><expr> k line('.') == 1 ? 'G' : 'k'
  nnoremap <silent><buffer><expr> <C-r> defx#do_action('redraw')
  nnoremap <silent><buffer><expr> <C-g> defx#do_action('print')
  nnoremap <silent><buffer><expr> cd defx#do_action('change_vim_cwd')
  " defx-git
  nmap <buffer><silent> [c <Plug>(defx-git-prev)
  nmap <buffer><silent> ]c <Plug>(defx-git-next)
endfunction

augroup defx_as_netrw
  autocmd!
  autocmd BufEnter,VimEnter,BufNew,BufWinEnter,BufRead,BufCreate
        \ * call s:browse_check(expand('<amatch>'))
augroup END

function! s:browse_check(path) abort
  augroup FileExplorer
    autocmd!
  augroup END

  let path = a:path
  if fnamemodify(path, ':t') ==# '~'
    let path = '~'
  endif

  if &filetype ==# 'defx' && line('$') != 1
    return
  endif

  if isdirectory(path)
    exec 'Defx -new ' . path
  endif
endfunction


" vim-clap
" git branches
let s:clap_git_branches = {}

function! s:clap_git_branches.source() abort
  if !executable('git')
    call clap#helper#echo_error('git executable not found')
    return []
  endif

  let branches = systemlist('git branch')
  if v:shell_error
    call clap#helper#echo_error('Error occurs on calling `git branch`, maybe you are not in a git repository.')
    return []
  else
    return map(branches, 'split(v:val)[-1]')
  endif
endfunction

function! s:clap_git_branches.sink(line) abort
  call system('git switch ' . a:line)
  if v:shell_error
    call clap#helper#echo_error('Error occurs on calling `git switch %`, maybe you have any changed files or staged files.')
  else
    call clap#helper#echo_info('switched to "' . a:line . '"')
  endif
endfunction

let s:clap_git_branches.enable_rooter = v:true
let g:clap#provider#git_branches# = s:clap_git_branches

" configure
let g:clap_theme = 'dogrun'

let g:clap_layout = { 'relative': 'editor' }

let g:clap_current_selection_sign = {
    \ 'text': '»',
    \ 'texthl': 'WarningMsg',
    \ 'linehl': 'ClapCurrentSelection',
    \ }

let g:clap_selected_sign = {
    \ 'text': '❯',
    \ 'texthl': 'WarningMsg',
    \ 'linehl': 'ClapSelected',
    \ }

let g:clap_search_box_border_symbols = {
    \ 'arrow': ["\ue0b2", "\ue0b0"],
    \ 'curve': ["\ue0b6", "\ue0b4"],
    \ 'nil': ['', ''],
    \ }

let g:clap_prompt_format = '%spinner% %provider_id%❯ '
let g:clap_spinner_frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

let g:clap_builtin_fuzzy_filter_threshold = 1000
let g:clap_on_move_delay = 16
let g:clap_popup_input_delay = 16
let g:clap_provider_grep_delay = 16
let g:clap_provider_grep_opts = "-H --no-heading --vimgrep --smart-case --no-ignore-dot"

nnoremap <silent> <C-p> :Clap files ++finder=fd --hidden -E '.git/' --type f<CR>
nnoremap <silent> <Leader>gg :Clap grep<CR>
nnoremap <silent> <Leader>bb :Clap buffers<CR>
nnoremap <silent> <Leader>ch :Clap history<CR>
nnoremap <silent> <Leader>cl :Clap command_history<CR>
nnoremap <silent> <Leader>gb :Clap git_branches<CR>


" easymotion
let g:EasyMotion_do_mapping = 0
let g:EasyMotion_smartcase = 0

map <Leader> <Plug>(easymotion-prefix)
nmap <Leader>f <Plug>(easymotion-overwin-f)
xmap <Leader>f <Plug>(easymotion-s)
map <Leader>s <Plug>(easymotion-s2)


" fugitive
nnoremap <silent> <Leader>gs :Gstatus<CR>
nnoremap <silent> <Leader>gd :Gdiff<CR>


" GitGutter
let g:gitgutter_override_sign_column_highlight = 0
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
let g:vim_markdown_folding_disabled = 1


" markdown-preview
let g:mkdp_preview_options = {
      \ 'disable_sync_scroll': 0,
      \ }


" caw (comment out)
autocmd FileType typescript let b:caw_oneline_comment = '//'
autocmd FileType typescript let b:caw_wrap_oneline_comment = ['/*', '*/']


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

let g:ale_linter_aliases = {
      \ 'typescript': ['typescript'],
      \ 'typescript.tsx': ['typescript', 'css'],
      \ 'typescriptreact': ['typescript', 'css'],
      \ }

let g:ale_fixers = {
      \  '*': ['remove_trailing_lines', 'trim_whitespace'],
      \  'markdown': ['prettier'],
      \  'html': [],
      \  'javascript': ['prettier', 'eslint'],
      \  'typescript': ['prettier', 'tslint', 'eslint'],
      \  'typescript.tsx': ['prettier', 'tslint', 'eslint', 'stylelint'],
      \  'typescriptreact': ['prettier', 'tslint', 'eslint', 'stylelint'],
      \}

let g:ale_javascript_eslint_options = '--no-ignore'
let g:ale_typescript_tslint_use_global = 0
let g:ale_typescript_tslint_config_path = ''
let g:ale_go_gometalinter_options = '--fast --enable=goimports --enable=gosimple --enable=unused --enable=staticcheck'

nnoremap \ll :ALELint<CR>
nnoremap \lf :ALEFix<CR>
nnoremap \lt :ALEToggle<CR>


" ファイル置換時に BufWritePost 処理をトグル
function! s:enableBufWritePost()
  let g:ale_fix_on_save = 1
  ALEEnable
  CocEnable
endfunction

function! s:disableBufWritePost()
  let g:ale_fix_on_save = 0
  ALEDisable
  CocDisable
endfunction

command! EnableBufWritePost call <SID>enableBufWritePost()
command! DisableBufWritePost call <SID>disableBufWritePost()


" =============================================================
" Colors
" =============================================================

syntax on
colorscheme dogrun
