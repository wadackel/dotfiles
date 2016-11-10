" Colorschemeの設定
syntax on
set background=dark


" プラグインが有効な場合とそれ以外で分ける
try
  if has("termguicolors")
    set termguicolors
  endif

  " let g:quantum_black = 1
  " colorscheme quantum
  colorscheme hybrid

catch /^Vim\%((\a\+)\)\=:E185/
  " 行番号
  autocmd ColorScheme * highlight LineNr ctermfg=237

  colorscheme desert
endtry

