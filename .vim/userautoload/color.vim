" Colorschemeの設定
syntax on
let g:hybrid_custom_term_colors = 1
set background=dark

try
  colorscheme hybrid
catch /^Vim\%((\a\+)\)\=:E185/
  " ...
endtry
