import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  articleMessage,
  type Entry,
  interestProfile,
  normalizeUrl,
  parentMessage,
  parseClipHead,
  parseFeed,
  parseOpml,
  selectCandidates,
  siteKey,
  stripHtml,
} from "./feeds.ts";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>じゃあ、おうちで学べる </title>
  <link>https://syu-m-5151.hatenablog.com/</link>
  <item>
    <title>Rust で &amp; 書く</title>
    <link>https://syu-m-5151.hatenablog.com/entry/1</link>
    <guid isPermaLink="false">hatenablog://entry/1</guid>
    <pubDate>Wed, 23 Sep 2026 12:36:04 +0900</pubDate>
    <description><![CDATA[<p>本文の<b>先頭</b></p>]]></description>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>blog.jxck.io</title>
<link rel="alternate" href="https://blog.jxck.io/"/>
<link rel="self" href="https://blog.jxck.io/feeds/atom.xml"/>
<entry>
  <title type="html">mozaic.fm v4 リリースノート</title>
  <link href="https://blog.jxck.io/entries/2026-09-17/mozaic.html"/>
  <id>tag:blog.jxck.io,2026:1</id>
  <updated>2026-09-17T00:00:00Z</updated>
  <summary>要約</summary>
</entry>
</feed>`;

Deno.test("parseFeed reads RSS 2.0 items", () => {
  const f = parseFeed(RSS, "https://syu-m-5151.hatenablog.com/rss");
  assertEquals(f.title, "じゃあ、おうちで学べる");
  assertEquals(f.entries.length, 1);
  const e = f.entries[0];
  assertEquals(e.id, "hatenablog://entry/1");
  assertEquals(e.title, "Rust で & 書く");
  assertEquals(e.url, "https://syu-m-5151.hatenablog.com/entry/1");
  assertEquals(e.summary, "本文の 先頭");
  assertEquals(e.published, Date.parse("2026-09-23T03:36:04Z"));
});

Deno.test("parseFeed reads Atom entries and picks the alternate link", () => {
  const f = parseFeed(ATOM, "https://blog.jxck.io/feeds/atom.xml");
  assertEquals(f.siteUrl, "https://blog.jxck.io/");
  assertEquals(
    f.entries[0].url,
    "https://blog.jxck.io/entries/2026-09-17/mozaic.html",
  );
  assertEquals(f.entries[0].id, "tag:blog.jxck.io,2026:1");
});

Deno.test("stripHtml decodes numeric character references", () => {
  assertEquals(
    stripHtml("OpenAI&#8217;s GPT &#x2014; new"),
    "OpenAI\u2019s GPT \u2014 new",
  );
});

Deno.test("parseFeed rejects documents that are not feeds", () => {
  assertThrows(() => parseFeed("<html><body>404</body></html>", "x"));
});

Deno.test("parseOpml flattens nested outlines", () => {
  const opml = `<opml version="1.0"><body>
    <outline text="01_REQUIRED">
      <outline type="rss" title="V8" xmlUrl="https://v8.dev/blog.atom" htmlUrl="https://v8.dev/"/>
    </outline>
    <outline type="rss" text="solo" xmlUrl="https://x.test/feed"/>
  </body></opml>`;
  assertEquals(parseOpml(opml), [
    {
      url: "https://v8.dev/blog.atom",
      title: "V8",
      htmlUrl: "https://v8.dev/",
    },
    { url: "https://x.test/feed", title: "solo", htmlUrl: undefined },
  ]);
});

Deno.test("siteKey splits blog platforms by author", () => {
  assertEquals(siteKey("https://www.example.com/a/b"), "example.com");
  assertEquals(
    siteKey("https://zenn.dev/mizchi/articles/x"),
    "zenn.dev/mizchi",
  );
  assertEquals(
    siteKey("https://medium.com/@SlackEng/x"),
    "medium.com/@SlackEng",
  );
});

Deno.test("normalizeUrl drops tracking parameters, hashes and trailing slashes", () => {
  assertEquals(
    normalizeUrl("https://a.test/p/?utm_source=x&id=1#top"),
    "https://a.test/p/?id=1",
  );
  assertEquals(normalizeUrl("https://a.test/p/"), "https://a.test/p");
});

function entry(o: Partial<Entry>): Entry {
  return {
    id: "id",
    url: "https://a.test/1",
    title: "t",
    published: 2_000,
    summary: "",
    feedUrl: "https://a.test/feed",
    feedTitle: "A",
    ...o,
  };
}

Deno.test("selectCandidates drops old, seen, clipped, undated and duplicate entries", () => {
  const got = selectCandidates(
    [
      entry({ id: "old", url: "https://a.test/old", published: 500 }),
      entry({ id: "seen", url: "https://a.test/seen" }),
      entry({ id: "clipped", url: "https://a.test/clipped?utm_medium=rss" }),
      entry({
        id: "undated",
        url: "https://a.test/undated",
        published: undefined,
      }),
      entry({ id: "keep", url: "https://a.test/keep", published: 3_000 }),
      entry({ id: "dup", url: "https://a.test/keep/", published: 2_500 }),
      entry({ id: "newer", url: "https://a.test/newer", published: 4_000 }),
    ],
    {
      since: 1_000,
      seenIds: new Set(["seen"]),
      clippedUrls: new Set(["https://a.test/clipped"]),
    },
  );
  assertEquals(got.map((e) => e.id), ["newer", "dup"]);
});

Deno.test("parseClipHead reads date, genres and the source URL of web clips", () => {
  const head = [
    "---",
    "tags:",
    "  - memo/web",
    "  - clip/Frontend",
    "  - clip/Architecture",
    "date: 2026-09-23",
    "type: source",
    "---",
    "[The Grand Unifying Architecture](https://dev.to/playful/x)",
    "## Summary",
  ].join("\n");
  assertEquals(parseClipHead("The Grand Unifying Architecture.md", head), {
    date: "2026-09-23",
    genres: ["Frontend", "Architecture"],
    title: "The Grand Unifying Architecture",
    url: "https://dev.to/playful/x",
  });
  assertEquals(
    parseClipHead("x.md", head.replace("memo/web", "memo/conversation")),
    undefined,
  );
});

Deno.test("interestProfile counts genres within 60 days, newest titles first", () => {
  const p = interestProfile(
    [
      { date: "2026-09-20", genres: ["AI", "Frontend"], title: "b" },
      { date: "2026-09-22", genres: ["AI"], title: "a" },
      { date: "2026-06-01", genres: ["Design"], title: "old" },
    ],
    [],
    "2026-09-24",
  );
  assertEquals(p.genres, [["AI", 2], ["Frontend", 1]]);
  assertEquals(p.titles, ["a", "b"]);
});

Deno.test("messages escape Slack control characters and mark explore picks", () => {
  const e = entry({
    title: "A <b> & c",
    published: Date.parse("2026-09-23T03:00:00Z"),
  });
  const parent = parentMessage("2026-09-24", [
    { entry: e, reason: "r", explore: true },
  ], [{ feedTitle: "GitHub Changelog", items: [{ entry: e, reason: "x" }] }]);
  assert(parent.startsWith("📰 9/24 のフィード（2 件・🧭 1）"));
  assert(parent.includes("・🧭 A &lt;b&gt; &amp; c"));
  assert(parent.includes("・GitHub Changelog：注目 1 件"));
  assert(parent.endsWith("今後出さない\n🧭 は関心の外から選んだ記事"));
  assert(
    !parentMessage(
      "2026-09-24",
      [{ entry: e, reason: "r", explore: false }],
      [],
    )
      .includes("🧭"),
  );
  assertEquals(
    articleMessage({ entry: e, reason: "関心 & 近い", explore: false }),
    "<https://a.test/1|A &lt;b&gt; &amp; c>\nA · 9/23\n理由：関心 &amp; 近い",
  );
});
