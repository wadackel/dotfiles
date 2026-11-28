import { assertEquals } from "@std/assert";
import { test } from "bun:test";
import {
  buildStatus,
  bumpKind,
  isNewer,
  lineOf,
  parseNotice,
} from "./status.ts";

test("lineOf keeps python and go on major.minor, node on major, rust on nightly", () => {
  assertEquals(lineOf("python", "3.13.17"), "3.13");
  assertEquals(lineOf("go", "1.27.1"), "1.27");
  assertEquals(lineOf("node", "26.13.1"), "26");
  assertEquals(lineOf("rust", "nightly-2026-09-23"), "nightly");
  assertEquals(lineOf("uv", "0.12.17"), null);
});

test("bumpKind marks a major bump and a minor bump below 1.0", () => {
  assertEquals(bumpKind("6.11.0", "7.4.1"), "major");
  assertEquals(bumpKind("0.12.17", "0.13.10"), "0.x-minor");
  assertEquals(bumpKind("0.1.21", "0.1.25"), "patch");
  assertEquals(bumpKind("1.7.12", "1.8.0"), "minor");
  assertEquals(bumpKind("nightly-2026-09-23", "nightly-2026-11-28"), "other");
});

test("parseNotice reads the tool and a vendored or verified version", () => {
  assertEquals(
    parseNotice(
      "gws-gmail",
      "gws-gmail\nTool: npm:@googleworkspace/cli\nVendored version: 0.22.5\n",
    ),
    {
      skill: "gws-gmail",
      tool: "npm:@googleworkspace/cli",
      version: "0.22.5",
      kind: "vendored",
    },
  );
  assertEquals(
    parseNotice(
      "agent-browser",
      "Tool: npm:agent-browser\nVerified version: 0.45.0\n",
    ),
    {
      skill: "agent-browser",
      tool: "npm:agent-browser",
      version: "0.45.0",
      kind: "verified",
    },
  );
  assertEquals(
    parseNotice("figma-use", "Source: figma\nVendored version: 1\n"),
    null,
  );
  assertEquals(
    parseNotice("broken", "Tool:\nSource: x\nVendored version: 1\n"),
    null,
  );
});

test("buildStatus splits languages, tools, stale skills and pins that are not installed", () => {
  const status = buildStatus({
    pins: {
      python: "3.13.17",
      go: "1.27.4",
      rust: { version: "nightly-2026-09-23", components: ["rust-src"] },
      uv: "0.12.17",
      "npm:agent-browser": "0.45.0",
      "npm:@googleworkspace/cli": "0.22.5",
    },
    active: {
      python: "3.13.17",
      go: "1.27.1",
      rust: "nightly-2026-09-23",
      uv: "0.12.17",
      "npm:agent-browser": "0.45.0",
      "npm:@googleworkspace/cli": "0.22.5",
    },
    newest: { python: "3.15.2", rust: "nightly-2026-11-28", uv: "0.13.10" },
    newestInLine: { python: "3.13.18", go: "1.27.4" },
    notices: [
      {
        skill: "gws-gmail",
        tool: "npm:@googleworkspace/cli",
        version: "0.21.0",
        kind: "vendored",
      },
      {
        skill: "gws-drive",
        tool: "npm:@googleworkspace/cli",
        version: "0.21.0",
        kind: "vendored",
      },
      {
        skill: "agent-browser",
        tool: "npm:agent-browser",
        version: "0.45.0",
        kind: "verified",
      },
      {
        skill: "old-tool",
        tool: "npm:removed",
        version: "1.0.0",
        kind: "vendored",
      },
    ],
  });
  assertEquals(status.languages, [
    { tool: "python", pinned: "3.13.17", inLine: "3.13.18", overall: "3.15.2" },
    {
      tool: "rust",
      pinned: "nightly-2026-09-23",
      inLine: "nightly-2026-11-28",
      overall: null,
    },
  ]);
  assertEquals(status.tools, [{
    tool: "uv",
    pinned: "0.12.17",
    latest: "0.13.10",
    kind: "0.x-minor",
  }]);
  assertEquals(status.staleSkills, [
    {
      tool: "npm:@googleworkspace/cli",
      pinned: "0.22.5",
      recorded: "0.21.0",
      kind: "vendored",
      skills: ["gws-drive", "gws-gmail"],
    },
  ]);
  assertEquals(status.pinMismatch, [{
    tool: "go",
    pinned: "1.27.4",
    active: "1.27.1",
  }]);
  assertEquals(status.unknownTools, [{
    tool: "npm:removed",
    skills: ["old-tool"],
  }]);
  assertEquals(status.errors, []);
  assertEquals(status.upToDate, [
    "npm:agent-browser",
    "npm:@googleworkspace/cli",
  ]);
});

test("isNewer orders numeric versions and nightly dates, not mere difference", () => {
  assertEquals(isNewer("0.1.21", "0.1.25"), true);
  assertEquals(isNewer("0.1.26", "0.1.25"), false);
  assertEquals(isNewer("1.27.4", "1.27.4"), false);
  assertEquals(isNewer("3.13.9", "3.13.10"), true);
  assertEquals(isNewer("nightly-2026-09-23", "nightly-2026-11-28"), true);
  assertEquals(isNewer("nightly-2026-11-28", "nightly-2026-09-23"), false);
});

test("buildStatus does not offer a release older than a pin pushed from the other machine", () => {
  const status = buildStatus({
    pins: { "npm:@playwright/cli": "0.1.26", node: "26.14.0" },
    active: { "npm:@playwright/cli": "0.1.21", node: "26.13.1" },
    newest: { "npm:@playwright/cli": "0.1.25" },
    newestInLine: { node: "26.13.1" },
    notices: [],
  });
  assertEquals(status.tools, []);
  assertEquals(status.languages, []);
  assertEquals(status.pinMismatch.map((m) => m.tool), [
    "npm:@playwright/cli",
    "node",
  ]);
});

test("buildStatus keeps a same-line release in-line when the in-line lookup failed", () => {
  const status = buildStatus({
    pins: { go: "1.27.1", python: "3.13.17" },
    active: { go: "1.27.1", python: "3.13.17" },
    newest: { go: "1.27.4", python: "3.15.2" },
    newestInLine: {},
    notices: [],
  });
  assertEquals(status.languages, [
    { tool: "go", pinned: "1.27.1", inLine: "1.27.4", overall: null },
    { tool: "python", pinned: "3.13.17", inLine: null, overall: "3.15.2" },
  ]);
});
