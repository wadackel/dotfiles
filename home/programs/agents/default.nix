{ config, lib, ... }:

{
  # This directory is imported automatically by home/programs/default.nix.
  # Cross-agent assets live under ./skills, ./memo, and ./shared.
  # Agent-specific skill directories are still owned by each agent module, but
  # shared skill symlink publication is synchronized here.
  home.activation.syncSharedAgentSkills = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    DOTFILES="${config.home.homeDirectory}/dotfiles"
    SHARED="$DOTFILES/home/programs/agents/skills"

    if [ ! -d "$SHARED" ]; then
      echo "shared skills root is missing: $SHARED; skipping shared skill sync" >&2
    else
      for skill_file in "$SHARED"/*/SKILL.md; do
        [ -f "$skill_file" ] || continue

        name="$(/usr/bin/basename "$(/usr/bin/dirname "$skill_file")")"
        target="../../agents/skills/$name"

        for public in \
          "$DOTFILES/home/programs/claude/skills" \
          "$DOTFILES/home/programs/codex/skills"
        do
          if [ ! -d "$public" ]; then
            echo "public skills root is missing: $public; skipping $name" >&2
            continue
          fi

          link="$public/$name"
          if [ -L "$link" ]; then
            current="$(/usr/bin/readlink "$link")"
            if [ "$current" != "$target" ]; then
              echo "shared skill $link points to $current, expected $target; leaving unchanged" >&2
            fi
          elif [ -e "$link" ]; then
            echo "shared skill $link is shadowed by an agent-specific entry; leaving unchanged" >&2
          else
            run /bin/ln -s "$target" "$link"
          fi
        done
      done
    fi
  '';
}
