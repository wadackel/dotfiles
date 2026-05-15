import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  activateBypass,
  isBypassPrompt,
  normalizeHookInput,
} from "./codex-plan-marker-grant-tracker.ts";
import { bypassMarkerInfo } from "./codex-plan-gate.ts";

async function setupHome(): Promise<{ home: string; cwd: string }> {
  const home = await Deno.makeTempDir({ prefix: "codex-pmg-home-" });
  const cwd = await Deno.makeTempDir({ prefix: "codex-pmg-cwd-" });
  Deno.env.set("HOME", home);
  return { home, cwd };
}

Deno.test("isBypassPrompt: matches $plan-marker-grant variants only", () => {
  assertEquals(isBypassPrompt("$plan-marker-grant"), true);
  assertEquals(isBypassPrompt("  $plan-marker-grant"), true);
  assertEquals(isBypassPrompt("$plan-marker-grant reason"), true);
  assertEquals(isBypassPrompt("$plan-marker-grant\nreason"), true);

  assertEquals(isBypassPrompt("/plan-marker-grant"), false);
  assertEquals(isBypassPrompt("$plan-marker-grant-extra"), false);
  assertEquals(isBypassPrompt("please $plan-marker-grant"), false);
  assertEquals(isBypassPrompt("$bypass-plan-gate"), false);
  assertEquals(isBypassPrompt(""), false);
});

Deno.test("activateBypass writes a session/cwd scoped marker", async () => {
  const { cwd } = await setupHome();
  const result = await activateBypass({
    prompt: "$plan-marker-grant",
    cwd,
    session_id: "session-1",
  });

  assertEquals(result.activated, true);
  assertEquals(result.reason, "activated");
  const info = await bypassMarkerInfo(cwd, "session-1");
  const marker = JSON.parse(await Deno.readTextFile(info.path));
  assertEquals(marker.version, 1);
  assertEquals(marker.cwdHash, info.cwdHash);
  assertEquals(marker.sessionHash, info.sessionHash);
  assertEquals(marker.session_id, "session-1");
  assertEquals(info.path.includes("session-1"), false);
});

Deno.test("activateBypass requires cwd and session_id", async () => {
  await setupHome();

  assertEquals(
    await activateBypass({ prompt: "$plan-marker-grant", session_id: "s1" }),
    { activated: false, reason: "missing-fields" },
  );
  assertEquals(
    await activateBypass({ prompt: "$plan-marker-grant", cwd: "/tmp" }),
    { activated: false, reason: "missing-fields" },
  );
});

Deno.test("activateBypass marker path never contains raw session_id", async () => {
  const { cwd } = await setupHome();
  const sessionId = "session/with/../slashes && $(echo unsafe)";
  const result = await activateBypass({
    prompt: "$plan-marker-grant",
    cwd,
    session_id: sessionId,
  });

  assertEquals(result.activated, true);
  const path = result.marker?.path ?? "";
  assertEquals(path.includes("session/with"), false);
  assertEquals(path.includes("unsafe"), false);
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const match = basename.match(
    /^\.bypass-plan-gate-[0-9a-f]{16}-([0-9a-f]{32})\.json$/,
  );
  assertEquals(match !== null, true);
  assertStringIncludes(path, ".bypass-plan-gate-");
  const marker = JSON.parse(await Deno.readTextFile(path));
  assertEquals(marker.session_id, sessionId);
});

Deno.test("normalizeHookInput accepts only object string fields", () => {
  assertEquals(normalizeHookInput(null), {});
  assertEquals(normalizeHookInput([]), {});
  assertEquals(
    normalizeHookInput({
      prompt: "$plan-marker-grant",
      cwd: 123,
      session_id: "s1",
    }),
    {
      prompt: "$plan-marker-grant",
      cwd: "",
      session_id: "s1",
    },
  );
});
