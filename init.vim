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
  autocmd BufRead,BufNew,BufNewFile .textlintrc setlocal ft=json
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

" completion
Plug 'neoclide/coc-css', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-html', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-json', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-rls', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-tsserver', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-python', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-yaml', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc-yank', {'do': 'yarn --frozen-lockfile'}
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'iamcco/coc-flutter', {'do': 'yarn --frozen-lockfile'}
Plug 'josa42/coc-go', {'do': 'yarn --frozen-lockfile'}

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
Plug 'itchyny/vim-qfedit'
Plug 'rhysd/clever-f.vim'
Plug 'haya14busa/vim-asterisk'
Plug 'haya14busa/is.vim'
Plug 'easymotion/vim-easymotion'

" debug
Plug 'thinca/vim-quickrun'

" filer
Plug 'lambdalisue/nerdfont.vim'
Plug 'lambdalisue/fern.vim'
Plug 'lambdalisue/fern-renderer-nerdfont.vim'
" Plug 'liuchengxu/vim-clap', { 'do': ':Clap install-binary' }
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
Plug 'mattn/vim-goimports', {'for': 'go'}

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

" C++
Plug 'octol/vim-cpp-enhanced-highlight'

" Flutter
Plug 'dart-lang/dart-vim-plugin'

" varnish
Plug 'fgsch/vim-varnish'

" GraphQL
Plug 'jparise/vim-graphql'

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

" commands
nnoremap <silent> <space>c :<C-u>CocList commands<CR>

" outline
nnoremap <silent> <space>o :<C-u>CocList outline<CR>

" yank
nnoremap <silent> <space>y :<C-u>CocList -A --normal yank<CR>

" latest coc list
nnoremap <silent> <space>p :<C-u>CocListResume<CR>

nnoremap <silent><expr><up> coc#float#has_float() ? coc#float#scroll(0, 1) : "\<up>"
nnoremap <silent><expr><down> coc#float#has_float() ? coc#float#scroll(1, 1) : "\<down>"


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
 \             ['branch', 'readonly', 'filename']],
 \   'right': [['lineinfo'],
 \             ['percent'],
 \             ['cocstatus', 'cocwarning', 'cocerror'],
 \             ['fileformat', 'fileencoding', 'filetype']],
 \ },
 \ 'component': {
 \   'lineinfo': '%3l:%-2v ¶',
 \ },
 \ 'component_expand': {
 \   'cocwarning': 'LightlineCocWarning',
 \   'cocerror': 'LightlineCocError',
 \ },
 \ 'component_type': {
 \   'cocwarning': 'warning',
 \   'cocerror': 'error',
 \ },
 \ 'component_function': {
 \   'filename': 'LightlineFilename',
 \   'branch': 'LightlineFugitive',
 \   'readonly': 'LightlineReadonly',
 \   'cocstatus': 'LightlineCocStatus',
 \ },
 \ 'separator': { 'left': '', 'right': ''},
 \ 'subseparator': { 'left': '❯', 'right': '❮'}
 \ }

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

function! LightlineFugitive() abort
  let branch = fugitive#head()
  return branch !=# '' ? ' '.branch : ''
endfunction

function! LightlineCocWarning() abort
  let info = get(b:, 'coc_diagnostic_info', {})
  return get(info, 'warning', 0) != 0 ? '∙ ' . info['warning'] : ''
endfunction

function! LightlineCocError() abort
  let info = get(b:, 'coc_diagnostic_info', {})
  return get(info, 'error', 0) != 0 ? '∙ ' . info['error'] : ''
endfunction

function! LightlineCocStatus() abort
  return get(g:, 'coc_status', '')
endfunction

augroup UpdateLightline
  autocmd!
  autocmd User CocDiagnosticChange call lightline#update()
augroup END

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
        \ <Plug>(fern-my-expand-or-enter)
        \ fern#smart#drawer(
        \   "\<Plug>(fern-open-or-expand)",
        \   "\<Plug>(fern-open-or-enter)",
        \ )

  nmap <buffer> <expr>
        \ <Plug>(fern-my-collapse-or-leave)
        \ fern#smart#drawer(
        \   "\<Plug>(fern-action-collapse)",
        \   "\<Plug>(fern-action-leave)",
        \ )

  nmap <silent><buffer><nowait> <CR> <Plug>(fern-open-or-enter)
  nmap <silent><buffer><nowait> o <Plug>(fern-my-expand-or-enter)
  nmap <silent><buffer><nowait> l <Plug>(fern-my-expand-or-enter)
  nmap <silent><buffer><nowait> h <Plug>(fern-my-collapse-or-leave)
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

  nnoremap <silent><buffer><nowait> q :<C-u>quit<CR>
endfunction

augroup fern_custom
  autocmd!
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


" " vim-clap
" " git branches
" let s:clap_git_branches = {}
"
" function! s:clap_git_branches.source() abort
"   if !executable('git')
"     call clap#helper#echo_error('git executable not found')
"     return []
"   endif
"
"   let branches = systemlist('git branch')
"   if v:shell_error
"     call clap#helper#echo_error('Error occurs on calling `git branch`, maybe you are not in a git repository.')
"     return []
"   else
"     return map(branches, 'split(v:val)[-1]')
"   endif
" endfunction
"
" function! s:clap_git_branches.sink(line) abort
"   call system('git switch ' . a:line)
"   if v:shell_error
"     call clap#helper#echo_error('Error occurs on calling `git switch %`, maybe you have any changed files or staged files.')
"   else
"     call clap#helper#echo_info('switched to "' . a:line . '"')
"   endif
" endfunction
"
" let s:clap_git_branches.enable_rooter = v:true
" let g:clap#provider#git_branches# = s:clap_git_branches
"
" " configure
" let g:clap_theme = 'dogrun'
"
" let g:clap_layout = { 'relative': 'editor' }
"
" let g:clap_current_selection_sign = {
"    \ 'text': '»',
"    \ 'texthl': 'WarningMsg',
"    \ 'linehl': 'ClapCurrentSelection',
"    \ }
"
" let g:clap_selected_sign = {
"    \ 'text': '❯',
"    \ 'texthl': 'WarningMsg',
"    \ 'linehl': 'ClapSelected',
"    \ }
"
" let g:clap_search_box_border_symbols = {
"    \ 'arrow': ["\ue0b2", "\ue0b0"],
"    \ 'curve': ["\ue0b6", "\ue0b4"],
"    \ 'nil': ['', ''],
"    \ }
"
" let g:clap_prompt_format = '%spinner% %provider_id%❯ '
" let g:clap_spinner_frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
"
" let g:clap_insert_mode_only = v:true
" let g:clap_builtin_fuzzy_filter_threshold = 1000
" let g:clap_on_move_delay = 16
" let g:clap_popup_input_delay = 16
" let g:clap_provider_grep_delay = 16
" let g:clap_provider_grep_opts = "-H --no-heading --vimgrep --smart-case --no-ignore-dot"
"
" nnoremap <silent> <C-p> :Clap files +no-cache ++finder=fd --hidden -E '.git/' --type f<CR>
" nnoremap <silent> <Leader>gg :Clap grep<CR>
" nnoremap <silent> <Leader>bb :Clap buffers<CR>
" nnoremap <silent> <Leader>ch :Clap history<CR>
" nnoremap <silent> <Leader>cl :Clap command_history<CR>
" nnoremap <silent> <Leader>gb :Clap git_branches<CR>

" fzf
if executable('fzf')
  let g:fzf_history_dir = '~/.local/share/fzf-history'
  let g:fzf_buffers_jump = 1
  let g:fzf_preview_window = 'right:60%'
  let g:fzf_layout = { 'window': { 'width': 0.9, 'height': 0.7, 'highlight': 'Comment' } }

  let g:fzf_action = {
        \ 'ctrl-t': 'tab split',
        \ 'ctrl-x': 'split',
        \ 'ctrl-v': 'vsplit' }

  augroup fzf-transparent-windows
    autocmd!
    autocmd FileType fzf set winblend=6
  augroup END

  if executable('rg')
    function! RgFzf(query, fullscreen)
      let command_fmt = 'rg --column --line-number --no-heading --color=always --smart-case -- %s || true'
      let initial_command = printf(command_fmt, shellescape(a:query))
      let reload_command = printf(command_fmt, '{q}')
      let spec = {'options': ['--phony', '--query', a:query, '--bind', 'change:reload:'.reload_command, '--prompt=grep ❯ ']}
      call fzf#vim#grep(initial_command, 1, fzf#vim#with_preview(spec), a:fullscreen)
    endfunction
    command! -nargs=* -bang Rg call RgFzf(<q-args>, <bang>0)

    command! RgFzfFiles call fzf#run(fzf#wrap('rg', {
        \ 'options': ['--reverse', '--prompt=files ❯ '],
        \ 'source': 'rg --files --color=never --hidden --iglob "!.git" --glob ""',
        \ }, <bang>0))

    nnoremap <silent> <C-p> :RgFzfFiles<CR>
  elseif
    nnoremap <silent> <C-p> :Files<CR>
  endif

  nnoremap <silent> <Leader>bl :BLines<CR>
  nnoremap <silent> <Leader>bb :Buffers<CR>
  nnoremap <silent> <Leader>bc :BCommits<CR>
  nnoremap <silent> <Leader>ch :History<CR>
  nnoremap <silent> <Leader>cl :History:<CR>
endif


" Memo List
let g:memolist_path = '~/Dropbox/memolist'
let g:memolist_memo_suffix = "md"
let g:memolist_template_dir_path = '~/dotfiles/templates/memolist'
let g:memolist_delimiter_yaml_start = '---'
let g:memolist_delimiter_yaml_end  = '---'

nnoremap <silent> <Leader>mc :MemoNew<CR>
nnoremap <silent> <Leader>mg :MemoGrep<CR>

if executable('fzf') && executable('rg')
  command! FZFMemoList call fzf#run(fzf#wrap('rg', {
        \ 'source': 'rg --files --color=never --hidden --iglob "!.git" --glob ""',
        \ 'dir': g:memolist_path,
        \ }, <bang>0))

  nnoremap <Leader>mp :FZFMemoList<CR>
endif


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
let g:vim_markdown_no_default_key_mappings = 1
let g:vim_markdown_folding_disabled = 1


" markdown-preview
let g:mkdp_auto_close = 0
let g:mkdp_page_title = '${name}'

let g:mkdp_preview_options = {
      \ 'disable_sync_scroll': 1,
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

let g:ale_linters = {
      \ 'markdown': ['textlint'],
      \ }

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
  GitGutterEnable
endfunction

function! s:disableBufWritePost()
  let g:ale_fix_on_save = 0
  ALEDisable
  CocDisable
  GitGutterDisable
endfunction

command! EnableBufWritePost call <SID>enableBufWritePost()
command! DisableBufWritePost call <SID>disableBufWritePost()


" =============================================================
" Colors
" =============================================================

syntax on
colorscheme dogrun
