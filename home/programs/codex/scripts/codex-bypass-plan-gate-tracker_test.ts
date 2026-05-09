import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  activateBypass,
  isBypassPrompt,
  normalizeHookInput,
} from "./codex-bypass-plan-gate-tracker.ts";
import { bypassMarkerInfo } from "./codex-plan-gate.ts";

async function setupHome(): Promise<{ home: string; cwd: string }> {
  const home = await Deno.makeTempDir({ prefix: "codex-bypass-home-" });
  const cwd = await Deno.makeTempDir({ prefix: "codex-bypass-cwd-" });
  Deno.env.set("HOME", home);
  return { home, cwd };
}

Deno.test("isBypassPrompt: matches $bypass-plan-gate variants only", () => {
  assertEquals(isBypassPrompt("$bypass-plan-gate"), true);
  assertEquals(isBypassPrompt("  $bypass-plan-gate"), true);
  assertEquals(isBypassPrompt("$bypass-plan-gate reason"), true);
  assertEquals(isBypassPrompt("$bypass-plan-gate\nreason"), true);

  assertEquals(isBypassPrompt("/bypass-plan-gate"), false);
  assertEquals(isBypassPrompt("$bypass-plan-gate-extra"), false);
  assertEquals(isBypassPrompt("please $bypass-plan-gate"), false);
  assertEquals(isBypassPrompt(""), false);
});

Deno.test("activateBypass writes a session/cwd scoped marker", async () => {
  const { cwd } = await setupHome();
  const result = await activateBypass({
    prompt: "$bypass-plan-gate",
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
    await activateBypass({ prompt: "$bypass-plan-gate", session_id: "s1" }),
    { activated: false, reason: "missing-fields" },
  );
  assertEquals(
    await activateBypass({ prompt: "$bypass-plan-gate", cwd: "/tmp" }),
    { activated: false, reason: "missing-fields" },
  );
});

Deno.test("activateBypass marker path never contains raw session_id", async () => {
  const { cwd } = await setupHome();
  const sessionId = "session/with/../slashes && $(echo unsafe)";
  const result = await activateBypass({
    prompt: "$bypass-plan-gate",
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
      prompt: "$bypass-plan-gate",
      cwd: 123,
      session_id: "s1",
    }),
    {
      prompt: "$bypass-plan-gate",
      cwd: "",
      session_id: "s1",
    },
  );
});
