#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

const DAY = 86400000;

/** 日付（"YYYY-MM-DD"）が属する ISO 週を "YYYY-WNN" で返す。年は ISO 週の年 */
export function isoWeekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const thursday = new Date(d.getTime() + (4 - (d.getUTCDay() || 7)) * DAY);
  const year = thursday.getUTCFullYear();
  const week = Math.floor(
    (thursday.getTime() - Date.UTC(year, 0, 1)) / DAY / 7,
  ) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** ISO 週の月〜日の日付と前後の週番号を計算する。その年にない週は例外 */
export function computeIsoWeekDates(isoWeek: string): {
  dates: string[]; // 7 elements: Mon–Sun "YYYY-MM-DD"
  prev: string; // "YYYY-WNN"
  next: string; // "YYYY-WNN"
} {
  const m = isoWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`not an ISO week (YYYY-WNN): ${isoWeek}`);
  const [y, w] = [Number(m[1]), Number(m[2])];
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = jan4.getTime() +
    ((w - 1) * 7 - ((jan4.getUTCDay() || 7) - 1)) * DAY;
  const day = (offset: number) =>
    new Date(mon + offset * DAY).toISOString().slice(0, 10);
  if (isoWeekOf(day(0)) !== isoWeek) {
    throw new Error(`${y} has no week ${m[2]}`);
  }
  return {
    dates: [0, 1, 2, 3, 4, 5, 6].map(day),
    prev: isoWeekOf(day(-7)),
    next: isoWeekOf(day(7)),
  };
}

if (import.meta.main) {
  try {
    const result = computeIsoWeekDates(process.argv[2] ?? "");
    result.dates.forEach((d) => console.log(d));
    console.log(`PREV:${result.prev}`);
    console.log(`NEXT:${result.next}`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
