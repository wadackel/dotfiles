.PHONY: setup
setup:
	@./scripts/setup

.PHONY: symlinks
symlinks:
	@./scripts/symlinks

.PHONY: vim-update
vim-update:
	@brew upgrade vim

.PHONY: colors
colors:
	@./scripts/colors
