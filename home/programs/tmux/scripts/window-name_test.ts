import { test } from "bun:test";
import { assertEquals } from "@std/assert";
import {
  type NamedWindow,
  type Place,
  sessionNames,
  words,
} from "./window-name.ts";

const GH = "/Users/me/develop/github.com";

function repo(path: string): Place {
  const m = path.match(/^(.*\/([^/]+))\/([^/]+?)-worktrees\/([^/]+)$/);
  if (m) {
    const root = `${m[1]}/${m[3]}`;
    return { key: path, label: m[3], parent: m[2], root, worktree: m[4] };
  }
  const parts = path.split("/");
  return { key: path, label: parts.at(-1)!, parent: parts.at(-2)!, root: path };
}

function dir(path: string): Place {
  const parts = path.split("/");
  return {
    key: path,
    label: parts.at(-1)!,
    parent: parts.at(-2)!,
    home: path === "/Users/me",
  };
}

function names(places: Place[]): string[] {
  const windows: NamedWindow[] = places.map((place, i) => ({
    id: `@${i}`,
    session: "$0",
    place,
  }));
  return [...sessionNames(windows).values()];
}

test("a window alone takes the head of its first word", () => {
  assertEquals(
    names([
      repo("/Users/me/dotfiles"),
      repo(`${GH}/me/ofsht`),
      repo(`${GH}/me/mflux-ui`),
      repo(`${GH}/me/vitest-mutation-testing-sandbox`),
      repo(`${GH}/me/vim-dogrun`),
      repo(`${GH}/me/eda.nvim`),
      repo(`${GH}/me/blog.example.me`),
      dir("/Users/me/Documents/Main"),
    ]),
    ["dot", "ofs", "mfl", "vit", "vim", "eda", "blog", "main"],
  );
});

test("a worktree alone is named after its repository", () => {
  assertEquals(names([repo(`${GH}/me/ofsht-worktrees/o2`)]), ["ofs"]);
});

test("repositories sharing a head are told apart by their last word", () => {
  assertEquals(
    names([
      repo(`${GH}/me/zmk-config-dax5`),
      repo(`${GH}/me/zmk-config-dax6`),
      repo(`${GH}/me/zmk-config-daxs`),
      repo(`${GH}/me/zmk-dax-modules`),
    ]),
    ["dax5", "dax6", "daxs", "mod"],
  );
  assertEquals(
    names([repo(`${GH}/me/zmk-config-dax5`), repo(`${GH}/me/zmk-dax-modules`)]),
    ["dax5", "mod"],
  );
  assertEquals(names([repo(`${GH}/me/daxial`), repo(`${GH}/me/daxial-p5`)]), [
    "dax",
    "p5",
  ]);
});

test("different first words are lengthened instead", () => {
  assertEquals(
    names([
      repo(`${GH}/me/vitant-yaml-proof`),
      repo(`${GH}/me/vitant-yaml-speed`),
      repo(`${GH}/me/vitant-yaml-progress`),
      repo(`${GH}/me/vitest-mutation-testing-sandbox`),
    ]),
    ["proo", "spe", "prog", "vite"],
  );
});

test("a worktree shows its own name only beside its repository", () => {
  assertEquals(
    names([repo(`${GH}/me/ofsht`), repo(`${GH}/me/ofsht-worktrees/o2`)]),
    ["ofs", "o2"],
  );
  assertEquals(
    names([
      repo(`${GH}/me/obsidian-web-clip`),
      repo(`${GH}/me/obsidian-web-clip-worktrees/plan`),
      repo(`${GH}/me/obsidian-web-clip-worktrees/pstack`),
      repo(`${GH}/me/obsidian-dashboard`),
      dir("/Users/me/Documents/Main"),
    ]),
    ["clip", "plan", "pst", "das", "main"],
  );
});

test("worktrees of one repository are told apart by the same word rules", () => {
  const main = repo(`${GH}/me/vitest-mutation-testing-sandbox`);
  const worktree = (name: string): Place => ({
    ...main,
    key: `${GH}/me/${name}`,
    worktree: name,
  });
  assertEquals(
    names([
      main,
      worktree("vitant-yaml-proof"),
      worktree("vitant-yaml-speed"),
      worktree("vitant-yaml-progress"),
    ]),
    ["vit", "proo", "spe", "prog"],
  );
});

test("forks are told apart by their owner's initial", () => {
  assertEquals(
    names([
      repo(`${GH}/reg-viz/storycap-testrun`),
      repo(`${GH}/me/storycap-testrun`),
    ]),
    ["rsto", "msto"],
  );
});

test("windows in the same place share a name", () => {
  const dotfiles = repo("/Users/me/dotfiles");
  assertEquals(names([dotfiles, dotfiles]), ["dot", "dot"]);
});

test("a name returns to its short form once the other window is gone", () => {
  const dax5 = repo(`${GH}/me/zmk-config-dax5`);
  assertEquals(names([dax5, repo(`${GH}/me/zmk-config-dax6`)]), [
    "dax5",
    "dax6",
  ]);
  assertEquals(names([dax5]), ["zmk"]);
});

test("names no rule separates are numbered", () => {
  assertEquals(
    names([
      { key: "/a/x/src", label: "src", parent: "x" },
      { key: "/b/x/src", label: "src", parent: "x" },
    ]),
    ["src1", "src2"],
  );
});

test("outside a repository the directory itself names the window", () => {
  assertEquals(
    names([
      dir("/Users/me"),
      dir("/tmp"),
      dir("/Users/me/Documents/Main/02_Notes"),
      dir("/Users/me/Downloads"),
    ]),
    ["~", "tmp", "not", "dow"],
  );
});

test("words drops editor suffixes and a leading number", () => {
  assertEquals(words("eda.nvim"), ["eda"]);
  assertEquals(words("02_Notes"), ["notes"]);
  assertEquals(words("Main"), ["main"]);
});
