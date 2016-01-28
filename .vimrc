" NeoBundle
if 0 | endif

filetype off

if has('vim_starting')
  if &compatible
    set nocompatible
  endif

  set runtimepath+=~/.vim/bundle/neobundle.vim
endif

call neobundle#begin(expand('~/.vim/bundle/'))

" Plugins
NeoBundle 'Shougo/unite.vim'
NeoBundle 'Shougo/neosnippet'
NeoBundle 'Shougo/neosnippet-snippets'
NeoBundle 'scrooloose/nerdtree'
NeoBundle 'kana/vim-submode'
NeoBundle 'itchyny/lightline.vim'
NeoBundle 'editorconfig/editorconfig-vim'
NeoBundle 'tyru/caw.vim.git'
NeoBundle 'airblade/vim-gitgutter'
NeoBundle 'othree/html5-syntax.vim'
NeoBundle 'mattn/emmet-vim'
NeoBundle 'myhere/vim-nodejs-complete'
NeoBundle 'vim-scripts/JavaScript-Indent'
NeoBundle 'othree/yajs.vim'
NeoBundle 'othree/es.next.syntax.vim'
NeoBundle 'moll/vim-node'
NeoBundle 'mattn/jscomplete-vim'
NeoBundle 'kchmck/vim-coffee-script'
NeoBundle 'tpope/vim-surround'
NeoBundle 'hail2u/vim-css3-syntax'
NeoBundle 'cakebaker/scss-syntax.vim'
NeoBundle 'plasticboy/vim-markdown'
NeoBundle 'tukiyo/previm'
NeoBundle 'tyru/open-browser.vim'
NeoBundle 'lilydjwg/colorizer'
NeoBundle 'kewah/vim-cssfmt'
NeoBundle 'kmnk/vim-unite-giti'
NeoBundle 'tpope/vim-fugitive'
NeoBundle 'Valloric/MatchTagAlways'

" ColorScheme
NeoBundle 'w0ng/vim-hybrid'

call neobundle#end()

filetype plugin indent on
filetype indent on

NeoBundleCheck


" Colorschemeの設定
syntax on
let g:hybrid_custom_term_colors = 1
colorscheme hybrid
set background=dark


" 各種基本設定
set regexpengine=1
set encoding=utf-8
set fileencoding=utf-8
set fileencodings=utf-8,cp932,ico-2022-jp,sjis,euc-jp,latin1
set number
set incsearch
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
set nowrap
set clipboard=unnamed
set laststatus=2
set noswapfile
set ambiwidth=double
set wildmode=longest,full
nnoremap p "0p
nnoremap P "0P

" 括弧の補完
inoremap {<Enter> {}<Left><CR><ESC><S-o>
inoremap [<Enter> []<Left><CR><ESC><S-o>
inoremap (<Enter> ()<Left><CR><ESC><S-o>

"タブ、空白、改行の可視化
set list
set listchars=tab:>.,trail:_,extends:>,precedes:<,nbsp:%

" JS関連の設定
setl omnifunc=jscomplete#CompleteJS
if !exists('g:neocomplcache_omni_functions')
  let g:neocomplcache_omni_functions = {}
endif
let g:neocomplcache_omni_functions.javascript = 'nodejscomplete#CompleteJS'
let g:node_usejscomplete = 1


" Lightline
let g:lightline = {
  \ 'colorscheme': 'jellybeans',
  \ 'active': {
  \   'left': [ [ 'mode', 'paste' ],
  \             [ 'fugitive', 'filename' ] ]
  \ },
  \ 'component_function': {
  \   'fugitive': 'LightLineFugitive',
  \   'modified': 'LightLineModified',
  \   'filename': 'LightLineFilename'
  \ }
  \ }

function! LightLineModified()
  if &filetype == "help"
    return ""
  elseif &modified
    return "+"
  elseif &modifiable
    return ""
  else
    return ""
  endif
endfunction

function! LightLineFugitive()
  return exists('*fugitive#head') ? fugitive#head() : ''
endfunction

function! LightLineFilename()
  return ('' != expand('%:t') ? expand('%:t') : '[No Name]') .
       \ ('' != LightLineModified() ? ' ' . LightLineModified() : '')
endfunction


" NERDTree
map <C-n> :NERDTreeToggle<CR>
nmap <C-K> <Plug>(caw:i:toggle)
vmap <C-K> <Plug>(caw:i:toggle)


" </で閉じタグを自動補完
autocmd FileType html inoremap <silent> <buffer> </ </<C-x><C-o>


" ペースト時のオートインデントを無効化
if &term =~ "xterm"
  let &t_ti .= "\e[?2004h"
  let &t_te .= "\e[?2004l"
  let &pastetoggle = "\e[201~"

  function XTermPasteBegin(ret)
    set paste
    return a:ret
  endfunction

  noremap <special> <expr> <Esc>[200~ XTermPasteBegin("0i")
  inoremap <special> <expr> <Esc>[200~ XTermPasteBegin("")
  cnoremap <special> <Esc>[200~ <nop>
  cnoremap <special> <Esc>[201~ <nop>
endif


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
nnoremap so <C-w>_<C-w>|
nnoremap sO <C-w>=
nnoremap sN :<C-u>bn<CR>
nnoremap sP :<C-u>bp<CR>
nnoremap st :<C-u>tabnew<CR>
nnoremap sT :<C-u>Unite tab<CR>
nnoremap ss :<C-u>sp<CR>
nnoremap sv :<C-u>vs<CR>
nnoremap sq :<C-u>q<CR>
nnoremap sQ :<C-u>bd<CR>
nnoremap sb :<C-u>Unite buffer_tab -buffer-name=file<CR>
nnoremap sB :<C-u>Unite buffer -buffer-name=file<CR>

call submode#enter_with('bufmove', 'n', '', 's>', '<C-w>>')
call submode#enter_with('bufmove', 'n', '', 's<', '<C-w><')
call submode#enter_with('bufmove', 'n', '', 's+', '<C-w>+')
call submode#enter_with('bufmove', 'n', '', 's-', '<C-w>-')
call submode#map('bufmove', 'n', '', '>', '<C-w>>')
call submode#map('bufmove', 'n', '', '<', '<C-w><')
call submode#map('bufmove', 'n', '', '+', '<C-w>+')


" Emmet
let g:user_emmet_mode = 'iv'
let g:user_emmet_leader_key = '<C-e>'
let g:use_emmet_complete_tag = 1
let g:user_emmet_settings = {
  \ 'lang' : 'ja',
  \ 'html' : {
  \   'filters' : 'html',
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

