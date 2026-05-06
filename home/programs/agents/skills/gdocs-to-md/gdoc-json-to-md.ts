#!/usr/bin/env -S deno run
// Google Docs API JSON → GitHub Flavored Markdown converter.
// Usage: gws docs documents get --params '{"documentId":"<ID>"}' | deno run gdoc-json-to-md.ts

// --- Types ---

export interface GdocDocument {
  title: string;
  body: { content: StructuralElement[] };
  lists?: Record<string, GdocList>;
}

interface GdocList {
  listProperties?: {
    nestingLevels?: NestingLevel[];
  };
}

interface NestingLevel {
  glyphType?: string;
  glyphSymbol?: string;
}

type StructuralElement =
  | { paragraph: Paragraph; table?: never; sectionBreak?: never }
  | { table: Table; paragraph?: never; sectionBreak?: never }
  | { sectionBreak: Record<string, unknown>; paragraph?: never; table?: never };

interface Paragraph {
  paragraphStyle?: { namedStyleType?: string };
  bullet?: { listId: string; nestingLevel?: number };
  elements?: ParagraphElement[];
}

type ParagraphElement =
  | { textRun: TextRun; person?: never; dateElement?: never; inlineObjectElement?: never }
  | { person: PersonElement; textRun?: never; dateElement?: never; inlineObjectElement?: never }
  | { dateElement: DateElement; textRun?: never; person?: never; inlineObjectElement?: never }
  | { inlineObjectElement: InlineObjectElement; textRun?: never; person?: never; dateElement?: never };

interface TextRun {
  content: string;
  textStyle?: TextStyle;
}

interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  link?: { url?: string };
  weightedFontFamily?: { fontFamily?: string };
}

interface PersonElement {
  personProperties?: { name?: string; email?: string };
  textStyle?: TextStyle;
}

interface DateElement {
  dateElementProperties?: { displayText?: string };
  textStyle?: TextStyle;
}

interface InlineObjectElement {
  inlineObjectId?: string;
  textStyle?: TextStyle;
}

interface Table {
  tableRows?: TableRow[];
}

interface TableRow {
  tableCells?: TableCell[];
}

interface TableCell {
  content?: StructuralElement[];
}

// --- Heading level map ---

const HEADING_LEVEL: Record<string, number> = {
  TITLE: 1,
  HEADING_1: 1,
  HEADING_2: 2,
  HEADING_3: 3,
  HEADING_4: 4,
  HEADING_5: 5,
  HEADING_6: 6,
};

const MONOSPACE_FONTS = new Set([
  "Courier New", "Courier", "Consolas", "Menlo", "Monaco",
  "Lucida Console", "DejaVu Sans Mono", "Source Code Pro",
]);

// --- Element extractors ---

function extractTextRun(run: TextRun): string {
  let text = run.content.replace(/\n$/, "");
  const ts = run.textStyle ?? {};

  const isMonospace =
    ts.weightedFontFamily?.fontFamily != null &&
    MONOSPACE_FONTS.has(ts.weightedFontFamily.fontFamily);

  if (isMonospace) {
    return text.trim() ? "`" + text + "`" : text;
  }

  if (text.trim()) {
    if (ts.bold && ts.italic) text = `***${text}***`;
    else if (ts.bold) text = `**${text}**`;
    else if (ts.italic) text = `*${text}*`;
    if (ts.strikethrough) text = `~~${text}~~`;
  }

  if (ts.link?.url) {
    text = `[${text}](${ts.link.url})`;
  }

  return text;
}

function extractElement(el: ParagraphElement): string {
  if (el.textRun) return extractTextRun(el.textRun);
  if (el.person) {
    const p = el.person.personProperties;
    return p ? `${p.name ?? ""} (${p.email ?? ""})` : "";
  }
  if (el.dateElement) {
    return el.dateElement.dateElementProperties?.displayText ?? "";
  }
  if (el.inlineObjectElement) {
    return "<!-- image omitted -->";
  }
  return "";
}

function extractParagraphText(para: Paragraph): string {
  return (para.elements ?? []).map(extractElement).join("");
}

// --- Paragraph renderer ---

function renderParagraph(para: Paragraph, lists: Record<string, GdocList>): string {
  const style = para.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT";
  const text = extractParagraphText(para).trimEnd();
  const bullet = para.bullet;

  if (bullet) {
    const nestingLevel = bullet.nestingLevel ?? 0;
    const listDef = lists[bullet.listId]?.listProperties?.nestingLevels?.[nestingLevel];
    const glyphType = listDef?.glyphType;
    const isOrdered =
      glyphType != null &&
      ["DECIMAL", "ALPHA", "ROMAN", "UPPER_ROMAN", "UPPER_ALPHA"].some((t) =>
        glyphType.includes(t)
      );
    const prefix = isOrdered ? "1." : "-";
    const indent = "  ".repeat(nestingLevel);
    return `${indent}${prefix} ${text}`;
  }

  const level = HEADING_LEVEL[style];
  if (level != null) {
    return `${"#".repeat(level)} ${text}`;
  }

  return text;
}

// --- Table renderer ---

function extractCellText(cell: TableCell): string {
  const parts: string[] = [];
  for (const elem of cell.content ?? []) {
    if (elem.paragraph) {
      parts.push(extractParagraphText(elem.paragraph).trim());
    }
  }
  return parts.join(" ").replace(/\|/g, "\\|");
}

function renderTable(table: Table): string {
  const rows = table.tableRows ?? [];
  if (rows.length === 0) return "";

  const lines: string[] = [];
  rows.forEach((row, idx) => {
    const cells = (row.tableCells ?? []).map(extractCellText);
    lines.push(`| ${cells.join(" | ")} |`);
    if (idx === 0) {
      lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    }
  });
  return lines.join("\n");
}

// --- Main converter ---

export function convertGdocToMarkdown(doc: GdocDocument): string {
  const lists = doc.lists ?? {};
  const lines: string[] = [];

  for (const elem of doc.body.content) {
    if (elem.sectionBreak) continue;

    if (elem.paragraph) {
      lines.push(renderParagraph(elem.paragraph, lists));
      continue;
    }

    if (elem.table) {
      lines.push("");
      lines.push(renderTable(elem.table));
      lines.push("");
      continue;
    }
  }

  return lines.join("\n") + "\n";
}

// --- CLI entry point ---

if (import.meta.main) {
  const json = await new Response(Deno.stdin.readable).text();
  const doc = JSON.parse(json) as GdocDocument;
  Deno.stdout.writeSync(new TextEncoder().encode(convertGdocToMarkdown(doc)));
}
