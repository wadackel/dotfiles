" 開発中のプラグインなど
let s:dev_plugin_install = 0

if s:dev_plugin_install
  let s:devdir = $HOME . '/.vim-dev'
  if isdirectory(s:devdir)
    exe 'set runtimepath+=' . s:devdir
    for plug in split(glob(s:devdir . '/*'), '\n')
      exe 'set runtimepath+=' . plug
    endfor
  endif

endif


" ローカルな設定の読み込み
if filereadable(expand('~/.vimrc.local'))
  source ~/.vimrc.local
endif



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


" 各種基本設定
set encoding=utf-8
set fileencoding=utf-8
set fileencodings=utf-8,cp932,ico-2022-jp,sjis,euc-jp,latin1
set completeopt=menuone
set autoread
set t_ut=
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

" 起動時のメッセージ非表示
set shortmess& shortmess+=I

" 改行時のコメントを無効化
set formatoptions-=r
set formatoptions-=o

" ビープ音を消す
set vb t_vb=
set novisualbell


"タブ、空白、改行の可視化
set list
set listchars=tab:>.,trail:_,extends:>,precedes:<,nbsp:%


" increment, decrement で選択状態を維持
vnoremap <c-a> <c-a>gv
vnoremap <c-x> <c-x>gv


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


" help & quickfixをqだけで閉じる
autocmd! FileType help,qf nnoremap <buffer> q <C-w>c


" Toggle系オプション
nnoremap <silent> <Leader>t :<C-u>setl expandtab! expandtab?<CR>
nnoremap <silent> <Leader>w :<C-u>setl wrap! wrap?<CR>
nnoremap <silent> <Leader>s :call <SID>toggle_syntax()<CR>
nnoremap <silent> <Leader>h :<C-u>setl hlsearch!<CR>

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


" x でレジスタを使わずに切り取り
nnoremap x "_x

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
autocmd FileType md setlocal filetype=markdown
autocmd FileType js setlocal filetype=javascript


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


" 選択範囲内をExpressionレジスタで評価->置換
vnoremap Q "0ygvc<C-r>=<C-r>0<CR><ESC>




" =============================================================
" Filetypes
" =============================================================
augroup fileTypeDetect
  autocmd BufRead,BufNew,BufNewFile *.ts set filetype=typescript
  autocmd BufRead,BufNew,BufNewFile *.tsx set filetype=typescript
  autocmd BufRead,BufNew,BufNewFile *.js.flow set filetype=typescript

  autocmd BufRead,BufNew,BufNewFile gitconfig setlocal ft=gitconfig
  autocmd BufRead,BufNew,BufNewFile .eslintrc setlocal ft=json
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
let g:dein#install_progress_type = 'title'
let g:dein#install_message_type = 'none'
let g:dein#enable_notification = 1

augroup PluginInstall
  autocmd!
  autocmd VimEnter * if dein#check_install() | call dein#install() | endif
augroup END
command! -nargs=0 PluginUpdate call dein#update()

let s:plugin_dir = expand('~/.vim/bundle/')
let s:dein_dir = s:plugin_dir . 'repos/github.com/Shougo/dein.vim'
execute 'set runtimepath+=' . s:dein_dir

if !isdirectory(s:dein_dir)
  call mkdir(s:dein_dir, 'p')
  silent execute printf('!git clone %s %s', 'https://github.com/Shougo/dein.vim', s:dein_dir)
endif

if dein#load_state(s:plugin_dir)
  call dein#begin(s:plugin_dir)
  call dein#add('Shougo/dein.vim')

  " vim-scripts
  call dein#add('vim-scripts/sudo.vim')

  " base
  call dein#add('vim-jp/vimdoc-ja')
  call dein#add('Shougo/neocomplete.vim', {
        \ 'if' : has('lua')
        \ })
  call dein#add('Shougo/vimproc.vim', {'build' : 'make'})
  call dein#add('Shougo/neosnippet')
  call dein#add('Shougo/neosnippet-snippets')
  call dein#add('mileszs/ack.vim')
  call dein#add('mattn/webapi-vim')
  call dein#add('thinca/vim-quickrun')

  " unite
  call dein#add('Shougo/unite.vim')
  call dein#add('Shougo/unite-outline', {'depends': 'Shougo/unite.vim'})

  " editing
  call dein#add('mattn/emmet-vim')
  call dein#add('tpope/vim-surround')
  call dein#add('editorconfig/editorconfig-vim')
  call dein#add('h1mesuke/vim-alignta')
  call dein#add('Chiel92/vim-autoformat')
  call dein#add('kana/vim-submode')
  call dein#add('tyru/caw.vim.git')
  call dein#add('deton/jasegment.vim')
  call dein#add('thinca/vim-qfreplace')
  call dein#add('jceb/vim-editqf')

  " filer
  call dein#add('Shougo/vimfiler', {'depends': 'Shougo/unite.vim'})
  call dein#add('ctrlpvim/ctrlp.vim')

  " sign
  call dein#add('airblade/vim-gitgutter')
  call dein#add('Valloric/MatchTagAlways')

  " git
  call dein#add('tpope/vim-fugitive')
  call dein#add('idanarye/vim-merginal', {'depends': 'tpope/vim-fugitive'})
  call dein#add('cohama/agit.vim')
  call dein#add('tyru/open-browser.vim')

  " gist
  call dein#add('mattn/gist-vim')

  " memo
  call dein#add('glidenote/memolist.vim')
  call dein#add('tsuyoshiwada/slack-memo-vim', {'depends': 'mattn/webapi-vim'})

  " toml
  call dein#add('cespare/vim-toml',  {'on_ft' : 'toml'})

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
  call dein#add('Quramy/tsuquyomi', {'on_ft': 'typescript'})

  " flow
  call dein#add('flowtype/vim-flow', {'on_ft': 'javascript'})

  " javascript
  call dein#add('jason0x43/vim-js-indent', {'on_ft': ['javascript', 'typescript']})
  call dein#add('pangloss/vim-javascript', {'on_ft': 'javascript'})
  call dein#add('chemzqm/vim-jsx-improve', {'on_ft': ['javascript', 'typescript']})
  call dein#add('heavenshell/vim-syntax-flowtype', {'on_ft': ['javascript']})
  call dein#add('fleischie/vim-styled-components', {'on_ft': ['javascript']})

  " css
  call dein#add('kewah/vim-stylefmt')

  " PHP
  call dein#add('jwalton512/vim-blade', {'on_ft': 'php'})

  " golang
  call dein#add('fatih/vim-go', {'on_ft': 'go'})

  " statusline
  call dein#add('itchyny/lightline.vim')

  " syntax checking
  call dein#add('w0rp/ale')

  " syntax
  call dein#add('Shougo/context_filetype.vim')
  call dein#add('hail2u/vim-css3-syntax')
  call dein#add('othree/html5.vim')
  call dein#add('nikvdp/ejs-syntax')
  call dein#add('digitaltoad/vim-jade')
  call dein#add('cakebaker/scss-syntax.vim')

  " colorschema
  call dein#add('w0ng/vim-hybrid')
  call dein#add('rhysd/vim-color-spring-night')

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


" neocomplete
let g:acp_enableAtStartup = 0

" Use neocomplete.
let g:neocomplete#enable_at_startup = 1

" Use smartcase.
let g:neocomplete#enable_smart_case = 1

" Set minimum syntax keyword length.
let g:neocomplete#sources#syntax#min_keyword_length = 2
let g:neocomplete#lock_buffer_name_pattern = '\*ku\*'

" Define dictionary.
let g:neocomplete#sources#dictionary#dictionaries = {
    \ 'default' : '',
    \ 'vimshell' : $HOME.'/.vimshell_hist',
    \ 'scheme' : $HOME.'/.gosh_completions'
    \ }

" Define keyword.
if !exists('g:neocomplete#keyword_patterns')
    let g:neocomplete#keyword_patterns = {}
endif
let g:neocomplete#keyword_patterns['default'] = '\h\w*'

" Enable omni completion.
autocmd FileType css setlocal omnifunc=csscomplete#CompleteCSS
autocmd FileType html,markdown setlocal omnifunc=htmlcomplete#CompleteTags
autocmd FileType python setlocal omnifunc=pythoncomplete#Complete
autocmd FileType xml setlocal omnifunc=xmlcomplete#CompleteTags
autocmd FileType javascript setlocal omnifunc=flowcomplete#Complete

" Enable heavy omni completion.
let g:neocomplete#sources#vim#complete_functions = {
    \ 'Unite' : 'unite#complete_source',
    \ 'VimFiler' : 'vimfiler#complete',
    \}
let g:neocomplete#force_overwrite_completefunc = 1
if !exists('g:neocomplete#force_omni_input_patterns')
    let g:neocomplete#force_omni_input_patterns = {}
endif
let g:neocomplete#force_omni_input_patterns.typescript = '[^. \t]\.\%(\h\w*\)\?'

" Plugin key-mappings.
inoremap <expr><C-g>     neocomplete#undo_completion()
inoremap <expr><C-l>     neocomplete#complete_common_string()

" Recommended key-mappings.
" <CR>: close popup and save indent.
inoremap <silent> <CR> <C-r>=<SID>my_cr_function()<CR>
function! s:my_cr_function()
  return (pumvisible() ? "\<C-y>" : "" ) . "\<CR>"
endfunction

" completion.
inoremap <expr><TAB> pumvisible() ? "\<C-n>" : "\<TAB>"
inoremap <expr><C-f> pumvisible() ? "\<down>" : neocomplete#start_manual_complete()

" close popup and delete backword char.
inoremap <expr><C-h> neocomplete#smart_close_popup()."\<C-h>"
inoremap <expr><BS> neocomplete#smart_close_popup()."\<C-h>"


" lightline
let g:lightline = {
  \ 'colorscheme': 'wombat',
  \ 'active': {
  \   'left': [ [ 'mode', 'paste' ],
  \             [ 'fugitive', 'readonly', 'filename', 'modified' ] ]
  \ },
  \ 'component_function': {
  \   'fugitive': 'LightLineFugitive',
  \   'readonly': 'LightLineReadonly',
  \   'modified': 'LightLineModified'
  \ },
  \ 'separator': { 'left': "\u2b80", 'right': "\u2b82" },
  \ 'subseparator': { 'left': "\u2b81", 'right': "\u2b83" }
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


" Ag
if executable('ag')
  " for ack.vim
  let g:ackprg = 'ag --vimgrep'

  " ctrlpの置き換え
  let g:ctrlp_use_caching = 0
  let g:ctrlp_user_command = 'ag %s -i --hidden --nocolor --nogroup -g ""'
endif


" VimFiler
let g:vimfiler_as_default_explorer = 1
let g:vimfiler_safe_mode_by_default = 0
let g:vimfiler_ignore_pattern = ['^\.git$', '^\.DS_Store$']

autocmd FileType vimfiler nmap <buffer> <CR> <Plug>(vimfiler_expand_or_edit)
map <C-N> :VimFiler -split -simple -winwidth=35 -toggle -no-quit<CR>
map <C-H> :VimFilerBufferDir -split -simple -winwidth=35 -toggle -no-quit<CR>


" ctrlp
let g:ctrlp_custom_ignore = '\v[\/](node_modules|build|\.git|\.hg|\.svn)$'
let g:ctrlp_show_hidden = 1


" fugitive
nnoremap <silent> gs :Gstatus<CR>
nnoremap <silent> gd :Gdiff<CR>


" Agit
nnoremap <silent> gl :Agit<CR>


" Merginal
nnoremap <silent> gb :Merginal<CR>


" SlackMemoVim
nnoremap smp :SlackMemoPost<CR>
nnoremap sml :SlackMemoList<CR>
nnoremap smc :SlackMemoCtrlP<CR>

" Memo List
let g:memolist_path = '~/Dropbox/memolist'
let g:memolist_memo_suffix = "md"
let g:memolist_template_dir_path = "~/dotfiles/templates/memolist"
let g:memolist_delimiter_yaml_start = '---'
let g:memolist_delimiter_yaml_end  = '---'

nnoremap <Leader>mc :MemoNew<CR>
nnoremap <Leader>ml :MemoList<CR>
nnoremap <Leader>mg :MemoGrep<CR>


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


" flow
let g:flow#enable = 0
let g:flow#autoclose = 1
let g:flow#omnifunc = 1

" use local flow
let local_flow = finddir('node_modules', '.;') . '/.bin/flow'

if matchstr(local_flow, "^\/\\w") == ''
    let local_flow= getcwd() . "/" . local_flow
endif

if executable(local_flow)
  let g:flow#flowpath = local_flow
endif

let g:javascript_plugin_flow = 1


" TypeScript
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
  autocmd FileType go :highlight goErr cterm=bold ctermfg=214
  autocmd FileType go :match goErr /\<err\>/
augroup END


" table-mode
let g:table_mode_corner = '|'


" Stylefmt
nnoremap <silent> <leader>cs :Stylefmt<CR>
vnoremap <silent> <leader>cs :StylefmtVisual<CR>


" ALE
let g:ale_open_list = 1
let g:ale_set_loclist = 0
let g:ale_set_quickfix = 1
let g:ale_sign_column_always = 1

let g:ale_lint_on_save = 1
let g:ale_lint_on_text_changed = 0
let g:ale_lint_on_enter = 0

let g:ale_linters = {
\   'html': [],
\   'go': ['gofmt -e', 'go vet', 'golint', 'gosimple', 'staticcheck'],
\}




" =============================================================
" Colors
" =============================================================

" Colorschemeの設定
syntax on
set background=dark

" プラグインが有効な場合とそれ以外で分ける
try
  if has("termguicolors")
    set termguicolors
  endif

  func! s:overwrite_spring_night()
    exe 'highlight LineNr guifg=#3c3c3c guibg=NONE'
    exe 'highlight Normal guibg=#282828'
  endfunc

  autocmd ColorScheme * call s:overwrite_spring_night()

  colorscheme spring-night
  " colorscheme hybrid

catch /^Vim\%((\a\+)\)\=:E185/
  " 行番号
  autocmd ColorScheme * highlight LineNr ctermfg=237

  colorscheme desert
endtry
