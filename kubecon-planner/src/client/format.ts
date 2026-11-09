/**
 * Display of event-local times. The server's times are Salt Lake City wall-clock text
 * (`YYYY-MM-DDTHH:MM:SS`, no offset); they are shown as written, never converted to the
 * browser's time zone.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-09" → "Mon, Nov 9". */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return day;
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${weekday}, ${MONTHS[m - 1] ?? ""} ${d}`;
}

/** "Mon" for "2026-11-09". */
export function weekday(day: string): string {
  return dayLabel(day).split(",")[0] ?? day;
}

/** Minutes after midnight → "9:05 AM"; 1440 → "12:00 AM". */
export function clock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "2026-11-09T09:05:00" → minutes after that day's midnight. */
export function minutesOf(time: string): number {
  return Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));
}

/** "9:00 AM – 9:31 AM" for a start and end time (the end may be on the next day). */
export function timeRange(startsAt: string, endsAt: string): string {
  const nextDay = endsAt.slice(0, 10) > startsAt.slice(0, 10);
  return `${clock(minutesOf(startsAt))} – ${clock(minutesOf(endsAt))}${nextDay && minutesOf(endsAt) > 0 ? " (+1 day)" : ""}`;
}
