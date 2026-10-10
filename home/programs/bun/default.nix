{
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  home.packages = [ pkgs.bun ];

  # Scripts run from the worktree and resolve packages from its node_modules,
  # so a missing or stale install breaks every hook at once. Not `|| true`:
  # a rebuild that fails here is easier to notice than hooks failing later.
  # Before setupLaunchAgents: an agent restarted by the switch (the Hermes
  # gateway) starts scripts that need node_modules right away.
  home.activation.installDotfilesDeps =
    lib.hm.dag.entryBetween [ "setupLaunchAgents" ] [ "writeBoundary" ]
      ''
        run --quiet ${pkgs.bun}/bin/bun install --frozen-lockfile --ignore-scripts \
          --cwd "${dotfiles.root}"
      '';
}
