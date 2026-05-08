import { assertEquals } from "jsr:@std/assert@1.0.19";
import { isApprovalPrompt, promote } from "./codex-impl-approval-tracker.ts";

const LEGACY_IMPL = "$impl-" + "codex";

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

async function writePlan(home: string, name: string): Promise<string> {
  const path = `${home}/.codex/plans/${name}`;
  await Deno.writeTextFile(path, "# Plan\n");
  return await Deno.realPath(path);
}

Deno.test("isApprovalPrompt: matches $impl variants only", () => {
  // accepted
  assertEquals(isApprovalPrompt("$impl"), true);
  assertEquals(isApprovalPrompt("$impl foo"), true);
  assertEquals(isApprovalPrompt("$impl\n続けて"), true);
  assertEquals(isApprovalPrompt("  $impl"), true);
  assertEquals(isApprovalPrompt(LEGACY_IMPL), false);
  assertEquals(isApprovalPrompt(`${LEGACY_IMPL} foo`), false);
  assertEquals(isApprovalPrompt(`${LEGACY_IMPL}\n続けて`), false);
  assertEquals(isApprovalPrompt(`  ${LEGACY_IMPL}`), false);
  // rejected: not first / wrong prefix
  assertEquals(isApprovalPrompt("/impl"), false);
  assertEquals(isApprovalPrompt("$impl-extra"), false);
  assertEquals(isApprovalPrompt("please $impl"), false);
  assertEquals(isApprovalPrompt(""), false);
});

Deno.test("scenario 1: prompt match + valid pending → promote", async () => {
  const { hash, cwd, home } = await setupHome(async (h, hh) => {
    const plan = await writePlan(h, "X.md");
    await Deno.writeTextFile(
      `${h}/.codex/plans/.pending-${hh}`,
      `${plan}\n`,
    );
  });
  const result = await promote(cwd);
  assertEquals(result.promoted, true);
  assertEquals(result.reason, "promoted");
  // active now contains the previous pending content
  const activeContent = await Deno.readTextFile(
    `${home}/.codex/plans/.active-${hash}`,
  );
  assertEquals(
    activeContent,
    `${await Deno.realPath(`${home}/.codex/plans/X.md`)}\n`,
  );
  // pending removed
  let pendingExists = true;
  try {
    await Deno.stat(`${home}/.codex/plans/.pending-${hash}`);
  } catch {
    pendingExists = false;
  }
  assertEquals(pendingExists, false);
});

Deno.test("scenario 2: prompt does not match → entry-point no-op (regex check)", () => {
  // Verified at the entry point via isApprovalPrompt; promote() is not called.
  // The hook script gates on isApprovalPrompt before invoking promote.
  assertEquals(isApprovalPrompt("hello there"), false);
  assertEquals(isApprovalPrompt("/impl"), false); // wrong prefix
  assertEquals(isApprovalPrompt(LEGACY_IMPL), false);
});

Deno.test("scenario 3: pending absent → no-op with no-pending reason", async () => {
  const { cwd } = await setupHome(async () => {/* no pending */});
  const result = await promote(cwd);
  assertEquals(result.promoted, false);
  assertEquals(result.reason, "no-pending");
});

Deno.test("scenario 4: pending expired (>24h) → no-op with expired reason", async () => {
  const { cwd } = await setupHome(async (h, hh) => {
    const plan = await writePlan(h, "Y.md");
    const path = `${h}/.codex/plans/.pending-${hh}`;
    await Deno.writeTextFile(path, plan);
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await Deno.utime(path, stale, stale);
  });
  const result = await promote(cwd);
  assertEquals(result.promoted, false);
  assertEquals(result.reason, "expired");
});

Deno.test("scenario 5: active already exists with pending → defensive no-op (already-active)", async () => {
  const { cwd } = await setupHome(async (h, hh) => {
    const oldPlan = await writePlan(h, "OLD.md");
    const newPlan = await writePlan(h, "NEW.md");
    await Deno.writeTextFile(
      `${h}/.codex/plans/.active-${hh}`,
      oldPlan,
    );
    await Deno.writeTextFile(
      `${h}/.codex/plans/.pending-${hh}`,
      newPlan,
    );
  });
  const result = await promote(cwd);
  // Defensive (matches Claude plan-approval-tracker.ts behavior): do NOT overwrite
  // an existing active marker. The $plan Phase 6 bash already removes .active
  // before writing .pending, so this state is only reachable as a race condition.
  // Plan task 3 description listed "上書き promote" but Claude reference implementation
  // is defensive — adopting safer semantic here, deviation noted in evidence.
  assertEquals(result.promoted, false);
  assertEquals(result.reason, "already-active");
});
