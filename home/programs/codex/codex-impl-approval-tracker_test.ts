import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isApprovalPrompt,
  promote,
} from "./codex-impl-approval-tracker.ts";

async function setupHome(
  setup: (home: string, hash: string, cwd: string) => Promise<void>,
): Promise<{ home: string; hash: string; cwd: string }> {
  const { cwdHash } = await import("./codex-plan-gate.ts");
  const home = await Deno.makeTempDir({ prefix: "codex-tracker-test-home-" });
  const cwd = await Deno.makeTempDir({ prefix: "codex-tracker-test-cwd-" });
  const hash = await cwdHash(cwd);
  await Deno.mkdir(`${home}/.codex/plans`, { recursive: true });
  await setup(home, hash, cwd);
  Deno.env.set("HOME", home);
  return { home, hash, cwd };
}

Deno.test("isApprovalPrompt: matches $impl-codex variants only", () => {
  // accepted
  assertEquals(isApprovalPrompt("$impl-codex"), true);
  assertEquals(isApprovalPrompt("$impl-codex foo"), true);
  assertEquals(isApprovalPrompt("$impl-codex\n続けて"), true);
  // rejected: leading whitespace allowed (we trim), but not in middle
  assertEquals(isApprovalPrompt("  $impl-codex"), true);
  // rejected: not first / wrong prefix
  assertEquals(isApprovalPrompt("/impl-codex"), false);
  assertEquals(isApprovalPrompt("$impl"), false);
  assertEquals(isApprovalPrompt("$impl-codex-extra"), false);
  assertEquals(isApprovalPrompt("please $impl-codex"), false);
  assertEquals(isApprovalPrompt(""), false);
});

Deno.test("scenario 1: prompt match + valid pending → promote", async () => {
  const { hash, cwd, home } = await setupHome(async (h, hh) => {
    await Deno.writeTextFile(`${h}/.codex/plans/.pending-${hh}`, "/plans/X.md\n");
  });
  const result = await promote(cwd);
  assertEquals(result.promoted, true);
  assertEquals(result.reason, "promoted");
  // active now contains the previous pending content
  const activeContent = await Deno.readTextFile(`${home}/.codex/plans/.active-${hash}`);
  assertEquals(activeContent, "/plans/X.md\n");
  // pending removed
  let pendingExists = true;
  try { await Deno.stat(`${home}/.codex/plans/.pending-${hash}`); }
  catch { pendingExists = false; }
  assertEquals(pendingExists, false);
});

Deno.test("scenario 2: prompt does not match → entry-point no-op (regex check)", () => {
  // Verified at the entry point via isApprovalPrompt; promote() is not called.
  // The hook script gates on isApprovalPrompt before invoking promote.
  assertEquals(isApprovalPrompt("hello there"), false);
  assertEquals(isApprovalPrompt("/impl-codex"), false); // wrong prefix
});

Deno.test("scenario 3: pending absent → no-op with no-pending reason", async () => {
  const { cwd } = await setupHome(async () => {/* no pending */});
  const result = await promote(cwd);
  assertEquals(result.promoted, false);
  assertEquals(result.reason, "no-pending");
});

Deno.test("scenario 4: pending expired (>24h) → no-op with expired reason", async () => {
  const { cwd } = await setupHome(async (h, hh) => {
    const path = `${h}/.codex/plans/.pending-${hh}`;
    await Deno.writeTextFile(path, "/plans/Y.md");
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await Deno.utime(path, stale, stale);
  });
  const result = await promote(cwd);
  assertEquals(result.promoted, false);
  assertEquals(result.reason, "expired");
});

Deno.test("scenario 5: active already exists with pending → defensive no-op (already-active)", async () => {
  const { cwd } = await setupHome(async (h, hh) => {
    await Deno.writeTextFile(`${h}/.codex/plans/.active-${hh}`, "/plans/OLD.md");
    await Deno.writeTextFile(`${h}/.codex/plans/.pending-${hh}`, "/plans/NEW.md");
  });
  const result = await promote(cwd);
  // Defensive (matches Claude plan-approval-tracker.ts behavior): do NOT overwrite
  // an existing active marker. The /plan-codex Phase 6 bash already removes .active
  // before writing .pending, so this state is only reachable as a race condition.
  // Plan task 3 description listed "上書き promote" but Claude reference implementation
  // is defensive — adopting safer semantic here, deviation noted in evidence.
  assertEquals(result.promoted, false);
  assertEquals(result.reason, "already-active");
});
