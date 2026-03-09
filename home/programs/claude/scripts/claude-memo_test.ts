import { assertEquals } from "jsr:@std/assert";
import { resolveRepoName } from "./claude-memo.ts";

// --- resolveRepoName ---

Deno.test("resolveRepoName: normal repo (relative .git)", () => {
  assertEquals(resolveRepoName("/Users/me/myrepo", ".git"), "myrepo");
});

Deno.test("resolveRepoName: worktree outside repo (absolute path)", () => {
  assertEquals(
    resolveRepoName("/Users/me/worktrees/feat", "/Users/me/myrepo/.git"),
    "myrepo",
  );
});

Deno.test("resolveRepoName: worktree inside repo (relative ../../.git)", () => {
  assertEquals(
    resolveRepoName("/Users/me/myrepo/.worktrees/feat", "../../.git"),
    "myrepo",
  );
});

Deno.test("resolveRepoName: trailing slash on .git/", () => {
  assertEquals(
    resolveRepoName("/Users/me/myrepo", ".git/"),
    "myrepo",
  );
});

Deno.test("resolveRepoName: empty gitCommonDir falls back to empty string", () => {
  assertEquals(resolveRepoName("/Users/me/myrepo", ""), "");
});
