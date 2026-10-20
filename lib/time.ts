function parseOffsetMinutes(offset: string | null): number | null {
  if (!offset) return null;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === "-" ? -1 : 1) * minutes;
}

export function formatTheatreTime(
  isoInstant: string | null | undefined,
  timeZone: string | null,
  utcOffset: string | null,
): string {
  if (
    !isoInstant ||
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(isoInstant) ||
    !Number.isFinite(Date.parse(isoInstant))
  ) {
    return "Unavailable";
  }
  const date = new Date(isoInstant);

  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone,
        timeZoneName: "short",
      }).format(date);
    } catch {
      // Invalid provider time zone falls back to its published UTC offset.
    }
  }

  const offset = parseOffsetMinutes(utcOffset);
  if (offset === null) {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(date);
  }

  const local = new Date(date.getTime() + offset * 60_000);
  const formatted = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(local);
  const sign = offset < 0 ? "−" : "+";
  const absoluteOffset = Math.abs(offset);
  const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const minutes = String(absoluteOffset % 60).padStart(2, "0");
  return `${formatted} UTC${sign}${hours}:${minutes}`;
}
