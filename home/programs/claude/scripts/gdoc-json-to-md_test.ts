import { assertEquals } from "jsr:@std/assert";
import { convertGdocToMarkdown } from "./gdoc-json-to-md.ts";
import type { GdocDocument } from "./gdoc-json-to-md.ts";

// Helper: minimal document wrapper
function doc(content: GdocDocument["body"]["content"], lists?: GdocDocument["lists"]): GdocDocument {
  return { title: "Test", body: { content }, lists };
}

function para(
  text: string,
  style: string = "NORMAL_TEXT",
  textStyle: Record<string, unknown> = {},
): GdocDocument["body"]["content"][number] {
  return {
    paragraph: {
      paragraphStyle: { namedStyleType: style },
      elements: [{ textRun: { content: text + "\n", textStyle } }],
    },
  };
}

function bulletPara(
  text: string,
  listId: string,
  nestingLevel: number = 0,
): GdocDocument["body"]["content"][number] {
  return {
    paragraph: {
      paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
      bullet: { listId, nestingLevel },
      elements: [{ textRun: { content: text + "\n", textStyle: {} } }],
    },
  };
}

// --- Headings ---

Deno.test("heading: TITLE -> #", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("My Title", "TITLE")])),
    "# My Title\n",
  );
});

Deno.test("heading: HEADING_2 -> ##", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("Section", "HEADING_2")])),
    "## Section\n",
  );
});

Deno.test("heading: HEADING_3 -> ###", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("Sub", "HEADING_3")])),
    "### Sub\n",
  );
});

Deno.test("heading: HEADING_4 -> ####", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("Deep", "HEADING_4")])),
    "#### Deep\n",
  );
});

// --- Normal text ---

Deno.test("normal text: plain paragraph", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("Hello world")])),
    "Hello world\n",
  );
});

Deno.test("normal text: empty paragraph", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("")])),
    "\n",
  );
});

// --- Inline styles ---

Deno.test("inline: bold", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("word", "NORMAL_TEXT", { bold: true })])),
    "**word**\n",
  );
});

Deno.test("inline: italic", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("word", "NORMAL_TEXT", { italic: true })])),
    "*word*\n",
  );
});

Deno.test("inline: bold+italic", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("word", "NORMAL_TEXT", { bold: true, italic: true })])),
    "***word***\n",
  );
});

Deno.test("inline: strikethrough", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("word", "NORMAL_TEXT", { strikethrough: true })])),
    "~~word~~\n",
  );
});

Deno.test("inline: code (monospace weighted)", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("code", "NORMAL_TEXT", { weightedFontFamily: { fontFamily: "Courier New" } })])),
    "`code`\n",
  );
});

Deno.test("inline: link", () => {
  assertEquals(
    convertGdocToMarkdown(doc([para("click", "NORMAL_TEXT", { link: { url: "https://example.com" } })])),
    "[click](https://example.com)\n",
  );
});

Deno.test("inline: empty text with bold -> no marker", () => {
  const d: GdocDocument = {
    title: "Test",
    body: {
      content: [{
        paragraph: {
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          elements: [{ textRun: { content: " \n", textStyle: { bold: true } } }],
        },
      }],
    },
  };
  const result = convertGdocToMarkdown(d);
  // should not produce **  ** or similar
  assertEquals(result.includes("**"), false);
});

// --- Lists ---

Deno.test("list: unordered bullet", () => {
  const lists = {
    "list1": {
      listProperties: {
        nestingLevels: [{ glyphSymbol: "●" }],
      },
    },
  };
  assertEquals(
    convertGdocToMarkdown(doc([bulletPara("Item A", "list1", 0)], lists)),
    "- Item A\n",
  );
});

Deno.test("list: ordered (DECIMAL)", () => {
  const lists = {
    "list1": {
      listProperties: {
        nestingLevels: [{ glyphType: "DECIMAL" }],
      },
    },
  };
  assertEquals(
    convertGdocToMarkdown(doc([bulletPara("Step 1", "list1", 0)], lists)),
    "1. Step 1\n",
  );
});

Deno.test("list: nested (level 1)", () => {
  const lists = {
    "list1": {
      listProperties: {
        nestingLevels: [{ glyphSymbol: "●" }, { glyphSymbol: "○" }],
      },
    },
  };
  assertEquals(
    convertGdocToMarkdown(doc([bulletPara("Child", "list1", 1)], lists)),
    "  - Child\n",
  );
});

// --- Table ---

Deno.test("table: simple 2-column", () => {
  const d: GdocDocument = {
    title: "Test",
    body: {
      content: [{
        table: {
          tableRows: [
            {
              tableCells: [
                { content: [{ paragraph: { paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, elements: [{ textRun: { content: "Name\n", textStyle: {} } }] } }] },
                { content: [{ paragraph: { paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, elements: [{ textRun: { content: "Age\n", textStyle: {} } }] } }] },
              ],
            },
            {
              tableCells: [
                { content: [{ paragraph: { paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, elements: [{ textRun: { content: "Alice\n", textStyle: {} } }] } }] },
                { content: [{ paragraph: { paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, elements: [{ textRun: { content: "30\n", textStyle: {} } }] } }] },
              ],
            },
          ],
        },
      }],
    },
  };
  assertEquals(
    convertGdocToMarkdown(d),
    "\n| Name | Age |\n| --- | --- |\n| Alice | 30 |\n\n",
  );
});

Deno.test("table: pipe in cell is escaped", () => {
  const d: GdocDocument = {
    title: "Test",
    body: {
      content: [{
        table: {
          tableRows: [
            {
              tableCells: [
                { content: [{ paragraph: { paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, elements: [{ textRun: { content: "a|b\n", textStyle: {} } }] } }] },
              ],
            },
          ],
        },
      }],
    },
  };
  const result = convertGdocToMarkdown(d);
  assertEquals(result.includes("a\\|b"), true);
});

// --- Special elements ---

Deno.test("person element: Name (email)", () => {
  const d: GdocDocument = {
    title: "Test",
    body: {
      content: [{
        paragraph: {
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          elements: [{
            person: {
              personProperties: { name: "Alice Smith", email: "alice@example.com" },
              textStyle: {},
            },
          }, { textRun: { content: "\n", textStyle: {} } }],
        },
      }],
    },
  };
  assertEquals(convertGdocToMarkdown(d), "Alice Smith (alice@example.com)\n");
});

Deno.test("dateElement: displayText", () => {
  const d: GdocDocument = {
    title: "Test",
    body: {
      content: [{
        paragraph: {
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          elements: [{
            dateElement: {
              dateElementProperties: { displayText: "2026年3月5日" },
              textStyle: {},
            },
          }, { textRun: { content: "\n", textStyle: {} } }],
        },
      }],
    },
  };
  assertEquals(convertGdocToMarkdown(d), "2026年3月5日\n");
});

Deno.test("inlineObjectElement: placeholder comment", () => {
  const d: GdocDocument = {
    title: "Test",
    body: {
      content: [{
        paragraph: {
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          elements: [{
            inlineObjectElement: { inlineObjectId: "img1", textStyle: {} },
          }, { textRun: { content: "\n", textStyle: {} } }],
        },
      }],
    },
  };
  assertEquals(convertGdocToMarkdown(d), "<!-- image omitted -->\n");
});

Deno.test("sectionBreak: skipped", () => {
  const d: GdocDocument = {
    title: "Test",
    body: {
      content: [
        { sectionBreak: { sectionStyle: {} } },
        { paragraph: { paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, elements: [{ textRun: { content: "Hello\n", textStyle: {} } }] } },
      ],
    },
  };
  assertEquals(convertGdocToMarkdown(d), "Hello\n");
});

// --- Compound ---

Deno.test("compound: heading + paragraph + list", () => {
  const lists = {
    "l1": { listProperties: { nestingLevels: [{ glyphSymbol: "●" }] } },
  };
  const d = doc([
    para("Title", "HEADING_2"),
    para("Intro text"),
    bulletPara("Item 1", "l1"),
    bulletPara("Item 2", "l1"),
  ], lists);
  assertEquals(
    convertGdocToMarkdown(d),
    "## Title\nIntro text\n- Item 1\n- Item 2\n",
  );
});
