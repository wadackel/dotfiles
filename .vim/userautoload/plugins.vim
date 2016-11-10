if &compatible
  set nocompatible
endif

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
  call dein#add('Shougo/neossh.vim')
  call dein#add('vim-jp/vital.vim')
  call dein#add('rking/ag.vim')

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
  call dein#add('rhysd/github-complete.vim')
  call dein#add('tyru/open-browser-github.vim')
  call dein#add('tyru/open-browser.vim')

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
  call dein#add('flowtype/vim-flow', {'on_ft': 'javascript'})

  " coffee
  call dein#add('kchmck/vim-coffee-script', {'on_ft' : 'coffee'})

  " typescript
  call dein#add('leafgarland/typescript-vim', {'on_ft' : 'typescript'})
  call dein#add('clausreinke/typescript-tools', {'on_ft' : 'typescript'})

  " css
  call dein#add('kewah/vim-cssfmt')

  " statusline
  call dein#add('itchyny/lightline.vim')

  " syntax checking
  call dein#add('neomake/neomake')
  call dein#add('benjie/neomake-local-eslint.vim')

  " syntax
  call dein#add('Shougo/context_filetype.vim')
  call dein#add('hail2u/vim-css3-syntax')
  call dein#add('othree/html5.vim')
  call dein#add('nikvdp/ejs-syntax')
  call dein#add('digitaltoad/vim-jade')
  call dein#add('cakebaker/scss-syntax.vim')

  " colorschema
  call dein#add('w0ng/vim-hybrid')
  call dein#add('tyrannicaltoucan/vim-quantum')

  call dein#end()
  call dein#save_state()
endif

if dein#check_install()
  call dein#install()
endif

filetype plugin indent on


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


" Ag
" ctrlpの置き換え
if executable('ag')
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


" Flowtype
let g:flow#autoclose = 1


" table-mode
let g:table_mode_corner = '|'


" Cssfmt
nnoremap <silent> <leader>cs :Cssfmt<CR>
vnoremap <silent> <leader>cs :CssfmtVisual<CR>


" neomake
autocmd! BufWritePost *.js,*.jsx,*.scss,*.sass,*.css Neomake
let g:neomake_error_sign = {'text': '>>', 'texthl': 'Error'}
let g:neomake_warning_sign = {'text': '>>',  'texthl': 'Todo'}
let g:neomake_open_list = 4

" neomake - javascript
let g:neomake_javascript_enabled_makers = ['eslint']

" neomake - css,scss,sass
" TODO: refactor
let b:neomake_scss_stylelint_exe = substitute(system('PATH=$(npm bin):$PATH && which stylelint'), '^\n*\s*\(.\{-}\)\n*\s*$', '\1', '')
let g:neomake_scss_enabled_makers = ['stylelint']
let g:neomake_scss_stylelint_maker = {
  \ 'exe': b:neomake_scss_stylelint_exe,
  \ 'args': ['--syntax', 'scss'],
  \ 'errorformat':
    \ '%+P%f,' .
      \ '%*\s%l:%c  %t  %m,' .
    \ '%-Q'
\ }

