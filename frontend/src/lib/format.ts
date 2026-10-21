/**
 * Display formatting. Times from the API carry the UTC offset of the place they refer to
 * (departure and checkpoint arrivals use the origin's), so they are shown as that local wall
 * time with the offset labelled, never converted to the viewer's time zone.
 */

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const ISO_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function formatMiles(miles: number): string {
  const text =
    miles < 10 && !Number.isInteger(miles) ? ONE_DECIMAL.format(miles) : WHOLE.format(miles);
  return `${text} mi`;
}

export function formatWeight(pounds: number): string {
  return `${WHOLE.format(pounds)} lb`;
}

/** "15 h 10 min", "45 min". */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${String(minutes)} min`;
  return `${String(hours)} h ${String(minutes).padStart(2, "0")} min`;
}

interface LocalTime {
  date: Date;
  clock: string;
  offset: string;
}

function parse(iso: string): LocalTime {
  const match = ISO_TIME.exec(iso);
  if (!match) throw new RangeError(`Not an ISO 8601 time with an offset: ${iso}`);
  const [, year, month, day, hour, minute, offset] = match;
  return {
    // Midday UTC on the local calendar date, so the weekday never shifts.
    date: new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12)),
    clock: `${hour ?? ""}:${minute ?? ""}`,
    offset: offset ?? "Z",
  };
}

/** "UTC−7", "UTC+5:30", "UTC". */
export function formatOffset(iso: string): string {
  const { offset } = parse(iso);
  if (offset === "Z" || offset === "+00:00" || offset === "-00:00") return "UTC";
  const sign = offset.startsWith("-") ? "−" : "+";
  const hours = String(Number(offset.slice(1, 3)));
  const minutes = offset.slice(4, 6);
  return `UTC${sign}${hours}${minutes === "00" ? "" : `:${minutes}`}`;
}

/** "Thu, Oct 22". */
export function formatDay(iso: string): string {
  return DAY.format(parse(iso).date);
}

/** "08:00". */
export function formatClock(iso: string): string {
  return parse(iso).clock;
}

/** "Thu, Oct 22, 08:00 (UTC−7)". */
export function formatLocalTime(iso: string): string {
  return `${formatDay(iso)}, ${formatClock(iso)} (${formatOffset(iso)})`;
}

/** The value for an <input type="datetime-local"> showing ``date`` in the browser's time zone. */
export function toDatetimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** The next whole hour from ``now``, in the browser's time zone. */
export function nextWholeHour(now: Date): Date {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}
