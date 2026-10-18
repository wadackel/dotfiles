# Nix review card
Trigger: `.nix` among the changed files.
Scope: nixpkgs / home-manager / nix-darwin modules for `code-reviewer`. A script a module invokes is reviewed under its own card.

## Check
**Activation and build**
- A stamp or hash that decides whether to rebuild must cover what the build actually reads (worktree files, the runtime's store path), not the flake source copy.
- `home.activation` entries: idempotent, ordered after what they need (`entryAfter`), and a failure stops the switch where intended rather than leaving half a generation.
- A timeout or limit set in Nix that another layer caps (a 600 s timeout under a 420 s tool deadline): the effective limit is the smaller one, and the comment should say so.
**Values and links**
- The same path, directory or value written in Nix and again in a script or config; derive one from the other or name the single source.
- `home.file` with `recursive = true` links each file through the store, so a new file needs a switch; a directory that grows is linked whole with `linkHere`.
- `source = ./path` must exist in the flake source (tracked by git); `pathHere` asserts this at eval.
- Profile-dependent settings branch on `profile` consistently; a module that takes `profile` and never uses it.
**Options and purity**
- Option names that nixpkgs accepts silently when misspelled; types matching the option schema (bool vs enum vs int).
- `builtins.fetchurl` / `fetchTarball` without a hash; `import <nixpkgs>` inside a module instead of a flake input.
- Homebrew formulas or casks duplicated across `brews` / `casks`, or added for something nixpkgs already ships without a documented reason.
**Comments**
- A comment narrower than the behavior ("defined" when the code means "defined and enabled"); a limit cited that is not the effective one.

## Do not flag
- Style (`lib.optional` vs `if … then [] else []`) above NIT.
- `nix flake check` output; the main session runs it.
- Documented nixpkgs-gap exceptions (Python, tree-sitter-cli) in Homebrew.
