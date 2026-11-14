import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildBoard, embedJson, validateBoard } from "./build-board.ts";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "build-board.ts");
const template = readFileSync(join(here, "..", "assets", "board.html"), "utf8");

const sample = {
  title: "Scroll <area>",
  target: "the scroll control's look",
  stage: "style-tile",
  decisions: [{
    stage: "define",
    text: "Only the scroll area is in scope",
    over: "redesigning the radial menu too",
  }],
  rounds: [
    {
      id: "r1",
      stage: "style-tile",
      question: "Which direction should be refined?",
      options: [
        {
          id: "A",
          name: "Halftone",
          axis: "material: print halftone",
          file: "variants/a.html",
          width: 390,
          height: 844,
        },
        {
          id: "B",
          name: "Edge notch",
          file: "variants/b.html",
          width: 390,
          height: 844,
        },
      ],
    },
  ],
};

function withBoard(
  board: unknown,
  files: Record<string, string>,
  fn: (dir: string) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "ui-design-board-"));
  try {
    writeFileSync(join(dir, "board.json"), JSON.stringify(board));
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function extractData(html: string): any {
  const m = html.match(
    /<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/,
  );
  assert(m, "board-data script not found");
  return JSON.parse(m[1]);
}

test("inlines each option's HTML and keeps it intact through the JSON block", () => {
  const variantA =
    "<!DOCTYPE html><html><body><script>let x = '</script>'</script><!-- c --></body></html>";
  withBoard(sample, {
    "variants/a.html": variantA,
    "variants/b.html": "<p>b</p>",
  }, (dir) => {
    const { html, errors } = buildBoard(dir, template);
    assertEquals(errors, []);
    assert(html);
    const data = extractData(html);
    assertEquals(data.rounds[0].options[0].html, variantA);
    assertEquals(data.rounds[0].options[1].html, "<p>b</p>");
    assertEquals(data.decisions[0].over, "redesigning the radial menu too");
    assertStringIncludes(html, "<title>Scroll &lt;area&gt;</title>");
    assert(!html.includes("__BOARD_DATA__"));
  });
});

test("lists every missing file instead of stopping at the first", () => {
  withBoard(sample, {}, (dir) => {
    const { html, errors } = buildBoard(dir, template);
    assertEquals(html, undefined);
    assertEquals(errors.length, 2);
    assertStringIncludes(errors[0], "option A: file variants/a.html not found");
  });
});

test("rejects an unknown stage, duplicate ids and out-of-range sizes with the field named", () => {
  const bad = structuredClone(sample) as any;
  bad.stage = "polish";
  bad.rounds[0].options[1].id = "A";
  bad.rounds[0].options[0].width = 10;
  const { board, errors } = validateBoard(bad);
  assertEquals(board, undefined);
  assert(errors.some((e) => e.startsWith('stage: got "polish"')));
  assert(errors.some((e) => e.includes("duplicate A in round r1")));
  assert(errors.some((e) => e.includes("options[0].width")));
});

test("embedJson escapes the characters that would end or comment out the script element", () => {
  const out = embedJson({ s: "</script><!--" });
  assert(!out.includes("<"));
  assertEquals(JSON.parse(out).s, "</script><!--");
});

test("the CLI writes index.html and exits 1 with the errors on a bad board", () => {
  withBoard(sample, {
    "variants/a.html": "<p>a</p>",
    "variants/b.html": "<p>b</p>",
  }, (dir) => {
    const ok = spawnSync(script, [dir], { encoding: "utf8" });
    assertEquals(ok.status, 0, ok.stderr);
    assertStringIncludes(
      readFileSync(join(dir, "index.html"), "utf8"),
      "<!DOCTYPE html>",
    );
  });
  withBoard({ ...sample, title: "" }, {}, (dir) => {
    const bad = spawnSync(script, [dir], { encoding: "utf8" });
    assertEquals(bad.status, 1);
    assertStringIncludes(bad.stderr, "title: required string");
  });
});

test("rejects option files outside variants/ by name: absolute, parent, other directory", () => {
  for (
    const file of [
      "/etc/hosts",
      "../secret.html",
      "variants/../board.json",
      "other/a.html",
      "variants/a.txt",
    ]
  ) {
    const board = structuredClone(sample) as any;
    board.rounds[0].options[0].file = file;
    const { errors } = validateBoard(board);
    assert(
      errors.some((e) =>
        e.includes("options[0].file") && e.includes("variants/<name>.html")
      ),
      file,
    );
  }
});

test("rejects a variant that is a symlink leading out of variants/, and a symlinked variants/ directory", () => {
  const outside = mkdtempSync(join(tmpdir(), "ui-design-outside-"));
  try {
    writeFileSync(join(outside, "secret.html"), "SECRET");
    withBoard(sample, { "variants/b.html": "<p>b</p>" }, (dir) => {
      symlinkSync(
        join(outside, "secret.html"),
        join(dir, "variants", "a.html"),
      );
      const { html, errors } = buildBoard(dir, template);
      assertEquals(html, undefined);
      assert(
        errors.some((e) => e.includes("option A") && e.includes("outside")),
      );
    });
    const dir = mkdtempSync(join(tmpdir(), "ui-design-board-"));
    try {
      writeFileSync(join(dir, "board.json"), JSON.stringify(sample));
      writeFileSync(join(outside, "a.html"), "SECRET");
      writeFileSync(join(outside, "b.html"), "SECRET");
      symlinkSync(outside, join(dir, "variants"));
      const { html, errors } = buildBoard(dir, template);
      assertEquals(html, undefined);
      assertEquals(errors.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("the CLI refuses to write index.html through a symlink, even a dangling one", () => {
  withBoard(sample, {
    "variants/a.html": "<p>a</p>",
    "variants/b.html": "<p>b</p>",
  }, (dir) => {
    const target = join(dir, "elsewhere.txt");
    symlinkSync(target, join(dir, "index.html"));
    const run = spawnSync(script, [dir], { encoding: "utf8" });
    assertEquals(run.status, 1);
    assertStringIncludes(run.stderr, "symbolic link");
    assertEquals(spawnSync("test", ["-e", target]).status, 1);
  });
});

test("artifact, when present, must carry slug and version", () => {
  const board = { ...structuredClone(sample), artifact: { slug: "abc" } };
  assert(validateBoard(board).errors.some((e) => e.startsWith("artifact:")));
  assertEquals(
    validateBoard({
      ...structuredClone(sample),
      artifact: { slug: "abc", version: "1" },
    }).errors,
    [],
  );
});

test("one run lists schema errors and missing files together", () => {
  const board = structuredClone(sample) as any;
  board.stage = "polish";
  withBoard(board, { "variants/b.html": "<p>b</p>" }, (dir) => {
    const { errors } = buildBoard(dir, template);
    assert(errors.some((e) => e.startsWith("stage:")));
    assert(
      errors.some((e) =>
        e.includes("option A: file variants/a.html not found")
      ),
    );
  });
});

test("a variant path that is a directory is reported, not thrown", () => {
  withBoard(sample, { "variants/b.html": "<p>b</p>" }, (dir) => {
    mkdirSync(join(dir, "variants", "a.html"));
    const { errors } = buildBoard(dir, template);
    assert(
      errors.some((e) =>
        e.includes("option A") && e.includes("not a regular file")
      ),
    );
  });
});

test("a title containing the data placeholder does not receive the data", () => {
  withBoard({ ...sample, title: "__BOARD_DATA__ と __TITLE__" }, {
    "variants/a.html": "<p>a</p>",
    "variants/b.html": "<p>b</p>",
  }, (dir) => {
    const { html } = buildBoard(dir, template);
    assert(html);
    assertStringIncludes(html, "<title>__BOARD_DATA__ と __TITLE__</title>");
    assertEquals(extractData(html).title, "__BOARD_DATA__ と __TITLE__");
  });
});
