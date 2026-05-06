/** ISO 週の月〜日の日付と前後の週番号を計算する */
export function computeIsoWeekDates(isoWeek: string): {
  dates: string[]; // 7 elements: Mon–Sun "YYYY-MM-DD"
  prev: string; // "YYYY-WNN"
  next: string; // "YYYY-WNN"
} {
  const [y, w] = isoWeek.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const mon = new Date(
    jan4.getTime() + ((w - 1) * 7 - (dayOfWeek - 1)) * 86400000,
  );
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon.getTime() + i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }
  const prevW = w === 1 ? 52 : w - 1;
  const nextW = w >= 52 ? 1 : w + 1;
  const prevY = w === 1 ? y - 1 : y;
  const nextY = w >= 52 ? y + 1 : y;
  return {
    dates,
    prev: `${prevY}-W${String(prevW).padStart(2, "0")}`,
    next: `${nextY}-W${String(nextW).padStart(2, "0")}`,
  };
}

if (import.meta.main) {
  const result = computeIsoWeekDates(Deno.args[0]);
  result.dates.forEach((d) => console.log(d));
  console.log(`PREV:${result.prev}`);
  console.log(`NEXT:${result.next}`);
}
