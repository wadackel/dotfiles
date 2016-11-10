" Colorschemeの設定
syntax on
set background=dark


" 行番号
autocmd ColorScheme * highlight LineNr ctermfg=237


" プラグインが有効な場合とそれ以外で分ける
try
  if has("termguicolors")
    set termguicolors
  endif
  let g:quantum_black = 1
  colorscheme quantum

catch /^Vim\%((\a\+)\)\=:E185/
  colorscheme desert
endtry

