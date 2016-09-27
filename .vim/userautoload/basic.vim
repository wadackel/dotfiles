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


" 各種基本設定
set encoding=utf-8
set fileencoding=utf-8
set fileencodings=utf-8,cp932,ico-2022-jp,sjis,euc-jp,latin1
set completeopt=menuone
set autoread
set number
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
set noswapfile
set ambiwidth=double
set wildmode=list:full
set noshowmode
set iminsert=0
set imsearch=0
set noimdisable
set noimcmdline
set backspace=indent,eol,start
set matchpairs& matchpairs+=<:>


" ビープ音を消す
set vb t_vb=
set novisualbell


"タブ、空白、改行の可視化
set list
set listchars=tab:>.,trail:_,extends:>,precedes:<,nbsp:%


" <Leader>を`,`に設定
let mapleader = ","


" .vimrcのリロード
if has('vim_starting')
  function! s:reload_vimrc() abort
    execute printf('source %s', $MYVIMRC)
    if has('gui_running')
      execute printf('source %s', $MYGVIMRC)
    endif
    redraw
    echo printf('.vimrc/.gvimrc has reloaded (%s).', strftime('%c'))
  endfunction
endif

nmap <silent> <Plug>(my-reload-vimrc) :<C-u>call <SID>reload_vimrc()<CR>
nmap <Leader><Leader>r <Plug>(my-reload-vimrc)


" Toggle系オプション
nnoremap <silent> <Leader>t :<C-u>setl expandtab! expandtab?<CR>
nnoremap <silent> <Leader>w :<C-u>setl wrap! wrap?<CR>
nnoremap <silent> <Leader>s :call <SID>toggle_syntax()<CR>

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


" 検索後の位置調整
nnoremap n nzz
nnoremap N Nzz
nnoremap * *zz
nnoremap # #zz
nnoremap g* g*zz
nnoremap g# g#zz


" j, k による移動を折り返されたテキストでも自然に振る舞うように変更
nnoremap j gj
nnoremap k gk


" スーパーユーザとして保存
cnoremap w!! w !sudo tee > /dev/null %


" 画面の再描画 (redraw!のalias, :Refresh)
:command! Refresh call RefreshFunc()

function! RefreshFunc()
  redraw!
endfunction


" 括弧の補完
inoremap {<Enter> {}<Left><CR><ESC><S-o>
inoremap [<Enter> []<Left><CR><ESC><S-o>
inoremap (<Enter> ()<Left><CR><ESC><S-o>


" commandモードはEmacs風に
cmap <C-f> <Right>
cmap <C-b> <Left>
cmap <C-a> <Home>
cmap <C-e> <End>
cmap <C-d> <Del>
cmap <C-h> <BackSpace>


" quickfixの移動
nnoremap [q :cprevious<CR>
nnoremap ]q :cnext<CR>
nnoremap [Q :<C-u>cfirst<CR>
nnoremap ]Q :<C-u>clast<CR>


" quickfixを自動で開く
autocmd QuickfixCmdPost make,grep,grepadd,vimgrep,vim,**grep** if len(getqflist()) != 0 | copen | endif


" visualモードで検索文字列を指定
xnoremap * :<C-u>call <SID>VSetSearch()<CR>/<C-R>=@/<CR><CR>
xnoremap # :<C-u>call <SID>VSetSearch()<CR>?<C-R>=@/<CR><CR>

function! s:VSetSearch()
  let tmp = @s
  norm! gv"sy
  let @/ = '\V' . substitute(escape(@s, '/\'), '\n', '\\n', 'g')
  let @s = tmp
endfunction


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
autocmd FileType html inoremap <silent> <buffer> </ </<C-x><C-o>


" ファイルタイプショートカット
au FileType md setlocal filetype=markdown
au FileType js setlocal filetype=javascript


" ファイルサイズを表示
function! GetFilesize(file)
  let size = getfsize(expand(a:file))
  echo 'Size of ' a:file ' is ' size ' bytes'
endfunction

map <leader>fs :call GetFilesize(@%)<CR>

" ファイルパス/名前をコピー&出力
function! CopyPath()
  let @*=expand('%:p')
  echo @*
endfunction

function! CopyFileName()
  let @*=expand('%:t')
  echo @*
endfunction

nmap <leader>fp :call CopyPath()<CR>
nmap <leader>ff :call CopyFileName()<CR>


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

" tc 新しいタブを一番右に作る
map <silent> [Tag]c :tablast <bar> tabnew<CR>

" tx タブを閉じる
map <silent> [Tag]x :tabclose<CR>

" tn 次のタブ
map <silent> [Tag]n :tabnext<CR>

" tp 前のタブ
map <silent> [Tag]p :tabprevious<CR>


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
