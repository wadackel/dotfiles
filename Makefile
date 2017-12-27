.PHONY: setup
setup:
	./scripts/setup

.PHONY: symlinks
symlinks:
	./scripts/symlinks

.PHONY: vim-update
vim-update:
	./scripts/vim update

.PHONY: colors
colors:
	./scripts/colors
