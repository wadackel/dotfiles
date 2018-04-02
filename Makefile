.PHONY: setup
setup:
	@./scripts/setup

.PHONY: symlinks
symlinks:
	@./scripts/symlinks

.PHONY: vim-update
vim-update:
	@brew reinstall vim --with-lua --HEAD

.PHONY: colors
colors:
	@./scripts/colors
