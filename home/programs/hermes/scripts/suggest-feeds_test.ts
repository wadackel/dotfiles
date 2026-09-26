import { assertEquals } from "jsr:@std/assert@1";
import { rankSites } from "./suggest-feeds.ts";

const clip = (url: string, date = "2026-09-20", title = url) => ({
  date,
  genres: [],
  title,
  url,
});

Deno.test("rankSites keeps frequently clipped, unsubscribed sites", () => {
  const clips = [
    ...[1, 2, 3].map((n) => clip(`https://zenn.dev/mizchi/articles/${n}`)),
    ...[1, 2, 3, 4].map((n) => clip(`https://blog.example.com/p/${n}`)),
    ...[1, 2, 3].map((n) => clip(`https://subscribed.test/${n}`)),
    ...[1, 2, 3].map((n) => clip(`https://x.com/u/status/${n}`)),
    ...[1, 2].map((n) => clip(`https://rare.test/${n}`)),
    ...[1, 2, 3].map((n) => clip(`https://old.test/${n}`, "2026-01-01")),
  ];
  const got = rankSites(clips, {
    since: "2026-06-25",
    exclude: new Set(["subscribed.test"]),
  });
  assertEquals(got.map((s) => [s.site, s.origin, s.clips.length]), [
    ["blog.example.com", "https://blog.example.com", 4],
    ["zenn.dev/mizchi", "https://zenn.dev/mizchi", 3],
  ]);
});

Deno.test("rankSites takes a lower threshold and skips press-release sites", () => {
  const clips = [
    ...[1, 2].map((n) => clip(`https://rare.test/${n}`, "2020-01-01")),
    ...[1, 2, 3].map((n) => clip(`https://prtimes.jp/main/html/rd/p/${n}`)),
    clip("https://once.test/1"),
  ];
  const got = rankSites(clips, { since: "", exclude: new Set(), minClips: 2 });
  assertEquals(got.map((s) => s.site), ["rare.test"]);
});
