{
  config,
  pkgs,
  lib,
  ...
}:

{
  programs.git = {
    enable = true;
    package = pkgs.git;

    # Git LFS
    lfs.enable = true;

    # グローバルignore（~/.config/git/ignore に生成）
    ignores = [
      ".DS_Store"
      ".wadackel"
      ".rooignore"
      ".serena"
      "/.worktrees"
      ".ofsht.toml"
      "**/.claude/settings.local.json"
      "**/.claude/commands/wadackel-*"
      "/.playwright-mcp"
      "CLAUDE.local.md"
    ];

    # includeIf設定
    includes = [
      {
        condition = "gitdir:~/develop/github.com/";
        path = "~/develop/github.com/.gitconfig";
      }
    ];

    # git 設定
    settings = {
      user = {
        name = "wadackel";
        email = "wadackel@gmail.com";
      };

      color.ui = "auto";
      init.defaultBranch = "main";
      push.default = "simple";

      core = {
        editor = "nvim";
        precomposeUnicode = true;
        ignorecase = false;
        untrackedcache = true;
        fsmonitor = true;
      };

      merge = {
        tool = "nvimdiff";
        conflictstyle = "diff3";
      };

      pull.ff = "only";
      fetch.prune = true;

      diff = {
        tool = "nvimdiff";
        colorMoved = "default";
      };

      difftool.nvimdiff.cmd = "nvim -R -d -c \"wincmd l\" -d \"$LOCAL\" \"$REMOTE\"";
      mergetool.nvimdiff.cmd = "nvim -d -c \"4wincmd w | wincmd J\" \"$LOCAL\" \"$BASE\" \"$REMOTE\" \"$MERGED\"";

      ghq.root = "~/develop";
      github.user = "wadackel";

      # 40個以上のalias
      alias = {
        aliases = "!git config --get-regexp alias";
        me = "!git config --get-regexp user";
        st = "status";
        ss = "status --short";
        unstage = "reset -q HEAD --";
        discard = "switch --";
        nevermind = "!git reset --hard HEAD && git clean -d -f";
        uncommit = "reset --mixed HEAD~";
        save = "commit -m";
        wip = "!git add -A; git rm $(git ls-files --deleted) 2> /dev/null; git commit --no-verify --no-gpg-sign --message \"--wip-- $(date +'%F %T')\"";
        unwip = "!git reset HEAD~1";
        resave = "commit --amend";
        amend = "commit --amend";
        invert = "revert";
        pushf = "push --force-with-lease";
        last = "log -1 HEAD --format=format:\"%Cred%H\"";
        summary = "status -u -s";
        graph = "log --graph --date=short --decorate=short --pretty=format:'%Cgreen%h %Creset%cd %Cblue%cn %Cred%d %Creset%s'";
        history = "log -10 --format=format:'%Cgreen%h %Creset• %s (%cN, %ar)'";
        tags = "tag";
        branchout = "switch -c";
        branches = "branch -a";
        cleanbranches = "!git branch --merged | grep -v '*' | xargs -I % git branch -d %";
        writelines = "!git ls-files | xargs -n1 git --no-pager blame -w | wc -l";
        stashes = "stash list";
        remotes = "remote -v";
        prestage = "diff -w --word-diff=color";
        precommit = "diff --cached -w --word-diff=color --word-diff-regex='[^[:space:]<>]+'";
        move = "mv";
        remove = "rm";
        unmerged = "branch --no-merged";
        unstash = "stash pop";
        what = "show -w";
        untrack = "rm -r --cached";
        rewrite = "rebase -i";
        back = "switch \"-\"";
        contributors = "shortlog -s -n";
        filetrail = "git log --follow -p -w";
        mergetrail = "log --ancestry-path --merges";
        cancel = "reset --soft HEAD^";
        nerge = "merge --no-ff";
        fixup = "commit --fixup";
        autosquash = "rebase -i --autosquash";
        web = "!gh repo view --web";
        lines = "!f() { git log --numstat --pretty=\"%H\" --author=$1 --since=$2 --until=$3 --no-merges | awk 'NF==3 {plus+=$1; minus+=$2} END {printf(\"%d (+%d, -%d)\\n\", plus+minus, plus, minus)}';}; f";
      };
    };
  };

  # Delta（diff表示の改善）
  programs.delta = {
    enable = true;
    enableGitIntegration = true;
    options = {
      navigate = true;
      features = "side-by-side line-numbers decorations";
      syntax-theme = "Nord";
      plus-style = "syntax \"#1c394b\"";
      plus-emph-style = "bold \"#c7cef3\" \"#1c394b\"";
      plus-empty-line-marker-style = "normal \"#1c394b\"";
      minus-style = "syntax \"#5e3e5e\"";
      minus-emph-style = "bold \"#d2d9ff\" \"#5e3e5e\"";
      minus-empty-line-marker-style = "syntax \"#5e3e5e\"";

      decorations = {
        commit-decoration-style = "bold yellow box ul";
        file-style = "bold white ul";
        file-decoration-style = "none";
        hunk-header-decoration-style = "cyan box ul";
      };

      line-numbers = {
        line-numbers-left-style = "#545c8c";
        line-numbers-right-style = "#545c8c";
        line-numbers-plus-style = "#7cbe8c";
        line-numbers-minus-style = "#ff9494";
      };
    };
  };
}
