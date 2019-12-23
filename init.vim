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
function! s:Clip(data)
  let @*=a:data
  echo "clipped: " . a:data
endfunction

" 現在開いているファイルのパス
command! -nargs=0 ClipPath call s:Clip(expand('%:p'))

" 現在開いているファイルのファイル名
command! -nargs=0 ClipFile call s:Clip(expand('%:t'))

" 現在開いているファイルのディレクトリパス
command! -nargs=0 ClipDir  call s:Clip(expand('%:p:h'))


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


" Terminal
augroup termina-config
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

function! s:get_syn_id(transparent)
  let synid = synID(line("."), col("."), 1)
  if a:transparent
    return synIDtrans(synid)
  else
    return synid
  endif
endfunction
function! s:get_syn_attr(synid)
  let name = synIDattr(a:synid, "name")
  let ctermfg = synIDattr(a:synid, "fg", "cterm")
  let ctermbg = synIDattr(a:synid, "bg", "cterm")
  let guifg = synIDattr(a:synid, "fg", "gui")
  let guibg = synIDattr(a:synid, "bg", "gui")
  return {
        \ "name": name,
        \ "ctermfg": ctermfg,
        \ "ctermbg": ctermbg,
        \ "guifg": guifg,
        \ "guibg": guibg}
endfunction
function! s:get_syn_info()
  let baseSyn = s:get_syn_attr(s:get_syn_id(0))
  echo "name: " . baseSyn.name .
        \ " ctermfg: " . baseSyn.ctermfg .
        \ " ctermbg: " . baseSyn.ctermbg .
        \ " guifg: " . baseSyn.guifg .
        \ " guibg: " . baseSyn.guibg
  let linkedSyn = s:get_syn_attr(s:get_syn_id(1))
  echo "link to"
  echo "name: " . linkedSyn.name .
        \ " ctermfg: " . linkedSyn.ctermfg .
        \ " ctermbg: " . linkedSyn.ctermbg .
        \ " guifg: " . linkedSyn.guifg .
        \ " guibg: " . linkedSyn.guibg
endfunction
command! SyntaxInfo call s:get_syn_info()


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
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'neoclide/coc-json', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-html', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-css', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-rls', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-yaml', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-yank', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-tsserver', {'do': 'yarn install --frozen-lockfile'}
Plug 'neoclide/coc-tslint-plugin', {'do': 'yarn install --frozen-lockfile'}

" Plug 'prabirshrestha/async.vim'
" Plug 'prabirshrestha/vim-lsp'
" Plug 'ryanolsonx/vim-lsp-typescript'
" Plug 'prabirshrestha/asyncomplete.vim'
" Plug 'prabirshrestha/asyncomplete-lsp.vim'
" Plug 'prabirshrestha/asyncomplete-file.vim'
" Plug 'prabirshrestha/asyncomplete-buffer.vim'

" editing
Plug 'mattn/emmet-vim'
Plug 'andymass/vim-matchup'
Plug 'tpope/vim-surround'
Plug 'thinca/vim-visualstar'
Plug 'editorconfig/editorconfig-vim'
Plug 'h1mesuke/vim-alignta'
Plug 'kana/vim-submode'
Plug 'https://github.com/tyru/caw.vim.git'
Plug 'tpope/vim-commentary'
Plug 'deton/jasegment.vim'
Plug 'thinca/vim-qfreplace'
Plug 'jceb/vim-editqf'
Plug 'rhysd/clever-f.vim'
Plug 'easymotion/vim-easymotion'

" debug
Plug 'thinca/vim-quickrun'

" filer
Plug 'Shougo/unite.vim'
Plug 'Shougo/vimfiler'
Plug 'liuchengxu/vim-clap'
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
Plug '~/develop/github.com/wadackel/vim-dogrun'
Plug 'rhysd/vim-color-spring-night'

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
nnoremap <silent> <Leader>i :call <SID>show_documentation()<CR>

" Use <CR> to confirm completion, `<C-g>u` means break undo chain at current position.
" Coc only does snippet and additional edit on confirm.
inoremap <expr> <CR> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"

function! s:show_documentation()
  if (index(['vim','help'], &filetype) >= 0)
    execute 'h '.expand('<cword>')
  else
    call CocAction('doHover')
  endif
endfunction

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
  if exists("*fugitive#head")
    let branch = fugitive#head()
    return branch !=# '' ? ' '.branch : ''
  endif
  return ''
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
let g:clever_f_smart_case = 0
let g:clever_f_across_no_line = 1
let g:clever_f_fix_key_direction = 1
let g:clever_f_repeat_last_char_inputs = []


" VimFiler
let g:vimfiler_as_default_explorer = 1
let g:vimfiler_safe_mode_by_default = 0
let g:vimfiler_ignore_pattern = ['^\.git$', '^\.DS_Store$']

nnoremap <C-n> :VimFiler -split -simple -winwidth=35 -toggle -no-quit<CR>
nnoremap <C-j> :VimFilerBufferDir -split -simple -winwidth=35 -toggle -no-quit<CR>

augroup vimfiler
  autocmd!
  autocmd FileType vimfiler call s:vimfiler_settings()
  autocmd FileType vimfiler nmap <buffer> <C-j> <Plug>(vimfiler_close)
augroup END

function! s:vimfiler_settings()
  nnoremap <silent><buffer><expr> t vimfiler#do_switch_action('tabopen')
endfunction


" " vim-clap
" let g:clap_current_selection_sign = {
"      \ 'text': '»',
"      \ 'texthl': 'WarningMsg',
"      \ 'linehl': 'ClapCurrentSelection',
"      \ }
"
" let g:clap_selected_sign = {
"      \ 'text': '❯',
"      \ 'texthl': 'WarningMsg',
"      \ 'linehl': 'ClapSelected',
"      \ }
"
" nnoremap <C-p> :Clap files<CR>
" nnoremap <Leader>gg :Clap grep<CR>
" nnoremap <Leader>b :Clap buffers<CR>
"
" command! -nargs=0 History :Clap command_history


" fzf
if executable('fzf')
  let g:fzf_history_dir = '~/.local/share/fzf-history'
  let g:fzf_buffers_jump = 1
  let g:fzf_action = {
       \ 'ctrl-t': 'tab split',
       \ 'ctrl-x': 'split',
       \ 'ctrl-v': 'vsplit' }

  let $FZF_DEFAULT_OPTS='--layout=reverse'
  let g:fzf_layout = { 'window': 'call FloatingFZF()' }

  augroup fzf-transparent-windows
    autocmd!
    autocmd FileType fzf set winblend=5
  augroup END

  function! FloatingFZF()
    let buf = nvim_create_buf(v:false, v:true)
    call setbufvar(buf, '&signcolumn', 'no')

    let height = float2nr(&lines * 0.8)
    let width = float2nr(&columns * 0.95)
    let col = float2nr((&columns - width) / 2)

    let opts = {
        \ 'relative': 'editor',
        \ 'row': float2nr(&lines / 2 - height / 2),
        \ 'col': col,
        \ 'width': width,
        \ 'height': height,
        \ }

    call nvim_open_win(buf, v:true, opts)
  endfunction

  if executable('rg')
    set grepprg=rg\ --vimgrep\ --no-heading
    set grepformat=%f:%l:%c:%m,%f:%l:%m

    command! FZFFileList call fzf#run(fzf#wrap('rg', {
         \ 'source': 'rg --files --color=never --hidden --iglob "!.git" --glob ""',
         \ }, <bang>0))

    command! -bang -nargs=* Rg
         \ call fzf#vim#grep(
         \ 'rg --column --line-number --hidden --ignore-case --no-heading --color=always '.shellescape(<q-args>), 1,
         \ <bang>0 ? fzf#vim#with_preview({'options': '--delimiter : --nth 4..'}, 'up:60%')
         \ : fzf#vim#with_preview({'options': '--delimiter : --nth 4..'}, 'right:50%:hidden', '?'),
         \ <bang>0)
  endif

  nnoremap <silent> <C-p> :FZFFileList<CR>
  nnoremap <silent> <Leader>bb :Buffers<CR>
  nnoremap <silent> <Leader>bc :BCommits<CR>
  nnoremap <silent> <Leader>; :History:<CR>
  nnoremap <silent> <Leader>/ :History/<CR>
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
let g:previm_open_cmd = 'open -a Google\ Chrome'
let g:vim_markdown_folding_disabled = 1
let g:previm_disable_default_css = 1
let g:previm_custom_css_path = '~/dotfiles/templates/previm/markdown.css'


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
      \  'html': ['prettier'],
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
