let g:dein#install_max_processes = 48
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

  " vim-scripts
  call dein#add('vim-scripts/sudo.vim')

  " base
  call dein#add('Shougo/dein.vim')
  call dein#add('vim-jp/vimdoc-ja')
  call dein#add('Shougo/neocomplete.vim', {
        \ 'if' : has('lua')
        \ })
  call dein#add('Shougo/vimproc.vim', {'build' : 'make'})
  call dein#add('Shougo/neosnippet')
  call dein#add('Shougo/neosnippet-snippets')
  call dein#add('Shougo/neossh.vim')
  call dein#add('vim-jp/vital.vim')

  " unite
  call dein#add('Shougo/unite.vim')
  call dein#add('ujihisa/unite-colorscheme', {'depends' : 'Shougo/unite.vim'})
  call dein#add('kmnk/vim-unite-giti', {'depends': 'Shougo/unite.vim'})

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

  " filer
  call dein#add('Shougo/vimfiler', {'depends': 'Shougo/unite.vim'})
  call dein#add('ctrlpvim/ctrlp.vim')

  " sign
  call dein#add('airblade/vim-gitgutter')
  call dein#add('Valloric/MatchTagAlways')

  " git
  call dein#add('tpope/vim-fugitive')
  call dein#add('jaxbot/github-issues.vim', {'lazy' : 1})
  call dein#add('moznion/github-commit-comment.vim', {'lazy' : 1})
  call dein#add('rhysd/github-complete.vim')
  call dein#add('tyru/open-browser-github.vim')
  call dein#add('tyru/open-browser.vim')
  call dein#add('takahirojin/gbr.vim')

  " toml
  call dein#add('cespare/vim-toml',  {'on_ft' : 'toml'})

  " markdown
  call dein#add('plasticboy/vim-markdown', {'on_ft': ['markdown', 'md']})
  call dein#add('tukiyo/previm', {'on_ft': ['markdown', 'md']})
  call dein#add('dhruvasagar/vim-table-mode', {'on_ft': ['markdown', 'md']})

  " javascript
  call dein#add('gavocanov/vim-js-indent', {'on_ft' : 'javascript'})
  call dein#add('myhere/vim-nodejs-complete', {'on_ft': 'javascript'})
  call dein#add('mxw/vim-jsx', {'on_ft': 'javascript'})
  call dein#add('othree/yajs.vim', {'on_ft': 'javascript'})
  call dein#add('othree/es.next.syntax.vim', {'on_ft': 'javascript'})
  call dein#add('moll/vim-node', {'on_ft': 'javascript'})
  call dein#add('mattn/jscomplete-vim', {'on_ft': 'javascript'})

  " coffee
  call dein#add('kchmck/vim-coffee-script', {'on_ft' : 'coffee'})

  " typescript
  call dein#add('leafgarland/typescript-vim', {'on_ft' : 'typescript'})
  call dein#add('clausreinke/typescript-tools', {'on_ft' : 'typescript'})

  " css
  call dein#add('lilydjwg/colorizer')
  call dein#add('kewah/vim-cssfmt')

  " statusline
  call dein#add('itchyny/lightline.vim')

  " syntax checking
  call dein#add('scrooloose/syntastic')
  call dein#add('mtscout6/syntastic-local-eslint.vim', {'depends': 'scrooloose/syntastic'})
  call dein#add('gcorne/vim-sass-lint')

  " syntax
  call dein#add('Shougo/context_filetype.vim')
  call dein#add('hail2u/vim-css3-syntax')
  call dein#add('othree/html5-syntax.vim')
  call dein#add('nikvdp/ejs-syntax')
  call dein#add('digitaltoad/vim-jade')
  call dein#add('cakebaker/scss-syntax.vim')

  " gist
  call dein#add('mattn/gist-vim')
  call dein#add('lambdalisue/vim-gista')

  " colorschema
  call dein#add('w0ng/vim-hybrid')


  call dein#end()
  call dein#save_state()
endif

filetype plugin indent on




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


" Colorschemeの設定
syntax on
let g:hybrid_custom_term_colors = 1
colorscheme hybrid
set background=dark


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
set wildmode=longest,full
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
  function s:reload_vimrc() abort
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
nnoremap sT :<C-u>Unite tab<CR>
nnoremap ss :<C-u>sp<CR>
nnoremap sv :<C-u>vs<CR>
nnoremap sq :<C-u>q<CR>
nnoremap sQ :<C-u>bd<CR>
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
" Disable AutoComplPop.
let g:acp_enableAtStartup = 0

" Use neocomplete.
let g:neocomplete#enable_at_startup = 1

" Use smartcase.
let g:neocomplete#enable_smart_case = 1

" Set minimum syntax keyword length.
let g:neocomplete#sources#syntax#min_keyword_length = 2
let g:neocomplete#lock_buffer_name_pattern = '\*ku\*'

" Define keyword.
if !exists('g:neocomplete#keyword_patterns')
    let g:neocomplete#keyword_patterns = {}
endif
let g:neocomplete#keyword_patterns['default'] = '\h\w*'

" Plugin key-mappings.
inoremap <expr><C-g>     neocomplete#undo_completion()
inoremap <expr><C-l>     neocomplete#complete_common_string()

" Recommended key-mappings.
" <CR>: close popup and save indent.
inoremap <silent> <CR> <C-r>=<SID>my_cr_function()<CR>
function! s:my_cr_function()
  return (pumvisible() ? "\<C-y>" : "" ) . "\<CR>"
endfunction

" <TAB>: completion.
inoremap <expr><TAB>  pumvisible() ? "\<C-n>" : "\<TAB>"

" <C-h>, <BS>: close popup and delete backword char.
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
  \ 'separator': { 'left': "\ue0b0", 'right': "\ue0b2" },
  \ 'subseparator': { 'left': "\ue0b1", 'right': "\ue0b3" }
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
    return "\ue0a2"
  else
    return ""
  endif
endfunction

function! LightLineFugitive()
  if exists("*fugitive#head")
    let _ = fugitive#head()
    return strlen(_) ? "\ue0a0 "._ : ''
  endif
  return ''
endfunction


" VimFiler
let g:vimfiler_as_default_explorer = 1
let g:vimfiler_safe_mode_by_default = 0
let g:vimfiler_ignore_pattern = ['^\.git$', '^\.DS_Store$']

autocmd FileType vimfiler nmap <buffer> <CR> <Plug>(vimfiler_expand_or_edit)
map <C-N> :VimFiler -split -simple -winwidth=35 -toggle -no-quit<CR>
map <C-J> :VimFilerBufferDir -split -simple -winwidth=35 -toggle -no-quit<CR>


" ctrlp
let g:ctrlp_custom_ignore = '\v[\/](node_modules|build|\.git|\.hg|\.svn)$'
let g:ctrlp_show_hidden = 1


" fugitive
nnoremap <silent> gs :Gstatus<CR>
nnoremap <silent> gd :Gdiff<CR>


" Unite x giti
nnoremap <silent> gl :Unite giti/log<CR>
nnoremap <silent> gb :Unite giti/branch_all<CR>


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
  \               ."\t<meta charset=\"${charset}\">\n"
  \               ."\t<meta http-equiv=\"X-UA-Compatible\" content=\"IE=edge\">\n"
  \               ."\t<meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0,user-scalable=no\">\n"
  \               ."\t<meta name=\"format-detection\" content=\"telephone=no,address=no,email=no\">\n"
  \               ."\t<meta name=\"description\" content=\"\">\n"
  \               ."\t<title></title>\n"
  \               ."\t<link rel=\"shortcut icon\" href=\"/favicon.ico\">\n"
  \               ."\t<link rel=\"stylesheet\" href=\"/style.css\">\n"
  \               ."</head>\n"
  \               ."<body>\n\t${child}|\n</body>\n"
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


" table-mode
let g:table_mode_corner = '|'


" Cssfmt
nnoremap <silent> <leader>cs :Cssfmt<CR>
vnoremap <silent> <leader>cs :CssfmtVisual<CR>


" syntastic
let g:syntastic_always_populate_loc_list = 1
let g:syntastic_auto_loc_list = 1
let g:syntastic_check_on_open = 0
let g:syntastic_check_on_wq = 0

let g:syntastic_mode_map = {
    \ "mode": "active",
    \ "active_filetypes": ["sass", "scss", "javascript"],
    \ "passive_filetypes": ["html", "php"] }

let g:syntastic_sass_checkers = ["sass_lint"]
let g:syntastic_scss_checkers = ["sass_lint"]
let g:syntastic_javascript_checkers = ["eslint"]

" syntastic - eslint
let g:syntastic_javascript_eslint_args = "--no-ignore"

" syntastic - local sass-lint
let s:sasslint_path = system('PATH=$(npm bin):$PATH && which sass-lint')
let s:sasslint_exec_path = substitute(s:sasslint_path, '^\n*\s*\(.\{-}\)\n*\s*$', '\1', '')
let s:sasslint_config_file = resolve(fnamemodify(s:sasslint_exec_path, ":h") . "/../../.sass-lint.yml")

if filereadable(s:sasslint_config_file)
  let g:synstastic_enable_sass_checker = 1
  let g:synstastic_enable_scss_checker = 1
  let b:syntastic_sass_sass_lint_exec = s:sasslint_exec_path
  let b:syntastic_sass_sass_lint_exec = s:sasslint_exec_path
else
  let g:synstastic_enable_sass_checker = 0
  let g:synstastic_enable_scss_checker = 0
endif
