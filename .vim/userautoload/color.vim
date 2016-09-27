" Colorschemeの設定
syntax on
set background=dark


" 行番号
autocmd ColorScheme * highlight LineNr ctermfg=237


" プラグインが有効な場合とそれ以外で分ける
try
  let g:hybrid_custom_term_colors = 1
  colorscheme hybrid
catch /^Vim\%((\a\+)\)\=:E185/
  colorscheme desert
endtry
