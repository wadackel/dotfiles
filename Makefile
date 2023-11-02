.PHONY: setup
setup:
	@./scripts/setup

.PHONY: symlinks
symlinks:
	@./scripts/symlinks

.PHONY: defaults
defaults:
	@./scripts/defaults

.PHONY: brew-bundle-install
brew-bundle-install:
	@brew bundle

.PHONY: brew-bundle-dump
brew-bundle-dump:
	@brew bundle dump -f

.PHONY: brew-bundle-clean
brew-bundle-clean:
	@brew bundle cleanup

.PHONY: colors
colors:
	@./scripts/colors
