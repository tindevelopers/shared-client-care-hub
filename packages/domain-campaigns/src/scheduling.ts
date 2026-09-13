function parseHmToMinutes(hm: string | null | undefined, fallback: string): number {
  const [h, m] = String(hm ?? fallback)
    .split(":")
    .map((s) => parseInt(s, 10));
  const fh = parseInt(fallback.split(":")[0]!, 10) || 0;
  const fm = parseInt(fallback.split(":")[1]!, 10) || 0;
  const hh = Number.isFinite(h) ? h : fh;
  const mm = Number.isFinite(m) ? m : fm;
  return Math.max(0, Math.min(24 * 60 - 1, hh * 60 + mm));
}

function getOffsetMinutes(timeZone: string, date: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = tz.match(/^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!m) return 0;
    const sign = m[1] === "-" ? -1 : 1;
    const hours = parseInt(m[2]!, 10) || 0;
    const mins = m[3] ? parseInt(m[3], 10) || 0 : 0;
    return sign * (hours * 60 + mins);
  } catch {
    return 0;
  }
}

function zonedLocalTimeToUtc(params: {
  timeZone: string;
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
}): Date {
  const { timeZone, year, month, day, hour, minute } = params;
  const baseUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let utcGuess = new Date(baseUtcMs);
  for (let i = 0; i < 3; i++) {
    const offsetMinutes = getOffsetMinutes(timeZone, utcGuess);
    const next = new Date(baseUtcMs - offsetMinutes * 60_000);
    if (Math.abs(next.getTime() - utcGuess.getTime()) < 1_000) return next;
    utcGuess = next;
  }
  return utcGuess;
}

function getZonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  weekdayNum: number;
  timeMinutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const WEEKDAY_TO_NUM: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const year = parseInt(map.year ?? "1970", 10);
  const month = parseInt(map.month ?? "01", 10);
  const day = parseInt(map.day ?? "01", 10);
  const hour = parseInt(map.hour ?? "0", 10);
  const minute = parseInt(map.minute ?? "0", 10);
  const weekdayNum = WEEKDAY_TO_NUM[map.weekday ?? "Sun"] ?? 0;
  const timeMinutes = hour * 60 + minute;
  return { year, month, day, weekdayNum, timeMinutes };
}

function isWithinCallingWindowAt(params: {
  date: Date;
  timeZone: string;
  callingWindowStart: string;
  callingWindowEnd: string;
  callingDays: number[] | null | undefined;
}): boolean {
  const { date, timeZone, callingWindowStart, callingWindowEnd, callingDays } = params;
  const z = getZonedParts(date, timeZone);
  const days = callingDays && callingDays.length > 0 ? callingDays : [1, 2, 3, 4, 5];
  if (!days.includes(z.weekdayNum)) return false;

  const startMinutes = parseHmToMinutes(callingWindowStart, "09:00");
  const endMinutes = parseHmToMinutes(callingWindowEnd, "20:00");

  return startMinutes <= endMinutes
    ? z.timeMinutes >= startMinutes && z.timeMinutes < endMinutes
    : z.timeMinutes >= startMinutes || z.timeMinutes < endMinutes;
}

function addDaysToYmd(
  ymd: { year: number; month: number; day: number },
  days: number
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days, 12, 0, 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function nextAllowedStartUtc(params: {
  fromUtc: Date;
  timeZone: string;
  callingWindowStart: string;
  callingWindowEnd: string;
  callingDays: number[] | null | undefined;
}): Date {
  const { fromUtc, timeZone, callingWindowStart, callingWindowEnd, callingDays } = params;
  const days = callingDays && callingDays.length > 0 ? callingDays : [1, 2, 3, 4, 5];
  const startMinutes = parseHmToMinutes(callingWindowStart, "09:00");
  const endMinutes = parseHmToMinutes(callingWindowEnd, "20:00");
  const startH = Math.floor(startMinutes / 60);
  const startM = startMinutes % 60;

  if (
    isWithinCallingWindowAt({
      date: fromUtc,
      timeZone,
      callingWindowStart,
      callingWindowEnd,
      callingDays: days,
    })
  ) {
    return fromUtc;
  }

  const z = getZonedParts(fromUtc, timeZone);
  const crossesMidnight = startMinutes > endMinutes;
  let targetYmd = { year: z.year, month: z.month, day: z.day };

  const dayAllowed = days.includes(z.weekdayNum);

  if (!dayAllowed) {
    for (let i = 1; i <= 7; i++) {
      const next = addDaysToYmd(targetYmd, i);
      const nextWeekday = (z.weekdayNum + i) % 7;
      if (days.includes(nextWeekday)) {
        targetYmd = next;
        break;
      }
    }
    return zonedLocalTimeToUtc({ timeZone, ...targetYmd, hour: startH, minute: startM });
  }

  if (!crossesMidnight) {
    if (z.timeMinutes < startMinutes) {
      return zonedLocalTimeToUtc({ timeZone, ...targetYmd, hour: startH, minute: startM });
    }
    for (let i = 1; i <= 7; i++) {
      const next = addDaysToYmd(targetYmd, i);
      const nextWeekday = (z.weekdayNum + i) % 7;
      if (days.includes(nextWeekday)) {
        targetYmd = next;
        break;
      }
    }
    return zonedLocalTimeToUtc({ timeZone, ...targetYmd, hour: startH, minute: startM });
  }

  // Window crosses midnight and we're in the "gap" [end, start).
  return zonedLocalTimeToUtc({ timeZone, ...targetYmd, hour: startH, minute: startM });
}

